import type JSONEditor from "jsoneditor";

type Filter = {
    id: string;
    editor?: AceAjax.Editor;
    type: "filter" | "select" | "map";
    func: (...args: unknown[]) => unknown
}

type ElementProps = {
    class?: string;
    id?: string;
    value?: string;
    selected?: boolean;
}

function debounce(func: (...args: unknown[]) => unknown, timeout = 300) {
    let timer: Timer;
    return (...args: unknown[]) => {
        clearTimeout(timer);
        //@ts-ignore
        timer = setTimeout(() => func.apply(this, args), timeout);
    }
}

function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: ElementProps) {
    const el = document.createElement(tag);

    if (attrs) for (const [key, value] of Object.entries(attrs)) {
        if (typeof value === "boolean") {
            if (value) el.setAttribute(key, "");
            continue;
        }

        el.setAttribute(key, value);
    }

    return el;
}

function createSelectElement(options: { label: string; value: string, selected?: boolean }[], attrs?: ElementProps) {
    const el = createElement("select", attrs);

    for (const option of options) {
        const opt = createElement("option", { value: option.value, selected: option.selected });
        opt.innerText = option.label;
        el.appendChild(opt);
    }

    return el;
}

function getElement<T = HTMLElement>(target: string): T {
    const el = document.getElementById(target);
    if (!el) throw new Error(`Failed to get element with id of "${target}"`);
    return el as T;
}

function getFunctionContent(func: Function) {
    const text = func.toString();
    return text.slice(text.indexOf("{") + 1, text.lastIndexOf("}")).trim();
}

function sterilizeFunction(key: string, value: unknown) {
    if (key === "func" && typeof value === "function") {
        return getFunctionContent(value);
    }
    if (key === "editor") return undefined;
    return value;
}
function desterilizeFunction(key: string, value: unknown) {
    // @ts-ignore
    if (key === "func" && typeof value === "string") return new Function(["e", "idx", "list"], value);
    return value;
}

class App {
    static INSTANCE: App | null = null;
    static get() {
        if (!App.INSTANCE) {
            App.INSTANCE = new App();
        }

        return App.INSTANCE;
    }

    private editor: JSONEditor;
    private source?: string;
    private content?: unknown;
    private filtersGroups: Filter[][] = [];
    private activeFilterGroup: number = 0;

    private constructor() {
        const container = getElement("json-editor");
        //@ts-expect-error
        this.editor = new JSONEditor(container, {});
        this.load().then(() => this.init());
    }

    private init() {
        // load content
        const btnLoadJson = getElement<HTMLButtonElement>("btn-load-json");
        btnLoadJson.addEventListener("click", this.loadJson);

        // filter control
        const btnFilterReset = getElement<HTMLButtonElement>("btn-filter-reset");
        const btnFilterAdd = getElement<HTMLButtonElement>("btn-filter-add");
        const btnFilterGroupAdd = getElement<HTMLButtonElement>("btn-filter-groups-add");
        const btnFilterGroupDel = getElement<HTMLElement>("btn-filter-groups-del");

        btnFilterReset.addEventListener("click", this.btnFiltersReset);
        btnFilterAdd.addEventListener("click", this.bntFiltersAdd);
        btnFilterGroupAdd.addEventListener("click", this.btnFilterGroupAdd);
        btnFilterGroupDel.addEventListener("click", this.btnFitlerGroupDel);

        const selectGroups = getElement<HTMLSelectElement>("select-filter-groups");
        for (let i = 0; i < this.filtersGroups.length; i++) {
            const opt = createElement("option", { value: i.toString(), selected: i === this.activeFilterGroup });
            opt.innerText = `Group ${i + 1}`;
            selectGroups.appendChild(opt);
        }
        selectGroups.addEventListener("change", this.selectFilterGroupChange);

        this.updateDisplay();

    }

    private updateDisplay() {
        const filters = this.filtersGroups.at(this.activeFilterGroup);
        if (!filters) return;

        const list = getElement<HTMLUListElement>("filters");

        let nodes: Node[] = [];

        for (const filter of filters) {
            const root = createElement("li", { class: "filter-item" })

            const select = createSelectElement(["filter", "select", "map"].map(e => ({
                label: e.replace(/^\w/, e[0].toUpperCase()),
                value: e,
                selected: filter.type === e
            })));

            select.addEventListener("change", (event) => {
                const g = this.filtersGroups.at(this.activeFilterGroup);
                if (!g) return;
                const idx = g.findIndex(e => e.id === filter.id);
                if (idx === -1) return;
                //@ts-expect-error
                const value = event.target?.value;
                if (!value) return;
                this.filtersGroups[this.activeFilterGroup][idx].type = value;
                this.process();
            });

            const input = createElement("pre", { id: filter.id });
            if (filter.editor) filter.editor.destroy();

            const btn = createElement("button", { class: "btn btn-error" });
            btn.innerText = "X";
            btn.addEventListener("click", () => {
                if (!this.filtersGroups[this.activeFilterGroup]) return;
                this.filtersGroups[this.activeFilterGroup] = this.filtersGroups[this.activeFilterGroup].filter(e => e.id !== filter.id);

                this.updateDisplay();
                this.process();
            });

            const container = createElement("div");
            container.appendChild(select);
            container.appendChild(btn);

            root.appendChild(container);
            root.appendChild(input);

            nodes.push(root);
        }

        list.replaceChildren(...nodes);

        for (const filter of filters) {
            const content = getFunctionContent(filter.func);
            const idx = this.filtersGroups[this.activeFilterGroup].findIndex(e => e.id === filter.id);
            if (idx === -1) continue;

            //@ts-expect-error
            this.filtersGroups[this.activeFilterGroup][idx].editor = ace.edit(filter.id, {
                mode: "ace/mode/javascript",
                theme: "ace/theme/github",
                minLines: 4,
                maxLines: 50,
                autoScrollEditorIntoView: true,
                value: content
            });
            const handler = debounce(() => this.handleFilterChange(idx));
            this.filtersGroups[this.activeFilterGroup][idx].editor?.session.on("change", handler);
        }
    }

    private handleFilterChange = (index: number) => {
        const filter = this.filtersGroups.at(this.activeFilterGroup)?.at(index);
        if (!filter) return;
        const value = filter.editor?.getValue();

        //@ts-ignore
        this.filtersGroups[this.activeFilterGroup][index].func = new Function(["e", "idx", "list"], value);

        this.process();

        this.save();
    }

    private process() {
        let data = this.content;
        if (!data) return;

        const filters = this.filtersGroups.at(this.activeFilterGroup);

        if (filters) for (const filter of filters) {
            switch (filter.type) {
                case "filter":
                    if (!Array.isArray(data)) break;
                    data = data.filter(filter.func);
                    break;
                case "select":
                    if (!data || typeof data !== "object") return;
                    //@ts-expect-error
                    data = data[filter.func()];
                    break;
                case "map":
                    if (!Array.isArray(data)) break;
                    data = data.map(filter.func);
                    break;
                default:
                    break;
            }
        }

        this.editor.set(data);
    }

    private loadJson = async () => {
        const input = getElement<HTMLInputElement>("content-url");
        const url = input.value.trim();

        try {
            const response = await fetch(url);
            this.content = await response.json();
            this.source = url;
            this.process();
            this.save();
        } catch (error) {
            console.error(error);
            alert("There was an error loading the json file");
        }
    }
    private selectFilterGroupChange = (ev: Event) => {
        try {
            const v = parseInt((ev.target as HTMLSelectElement).value);

            this.activeFilterGroup = v;
            this.updateDisplay();
            this.process();
            this.save();
        } catch (error) {
            console.error(error);
        }
    }
    private btnFiltersReset = () => {
        if (this.filtersGroups[this.activeFilterGroup]) {
            this.filtersGroups[this.activeFilterGroup] = [];
            this.updateDisplay();
            this.save();
        }

    }
    private bntFiltersAdd = () => {
        if (!this.filtersGroups[this.activeFilterGroup]) {
            this.filtersGroups[this.activeFilterGroup] = [];
        }

        this.filtersGroups[this.activeFilterGroup].push({
            id: crypto.randomUUID(),
            type: "select",
            //@ts-ignore
            func: new Function(["e", "idx", "list"], "return e;")
        });

        try {
            this.updateDisplay();
            this.process();
            this.save();
        } catch (error) {
            console.log(error);
        }
    }
    private btnFilterGroupAdd = () => {
        try {
            this.filtersGroups.push([]);

            const idx = this.filtersGroups.length - 1;
            this.activeFilterGroup = idx;

            const opt = createElement("option", { value: idx.toString(), selected: true });
            opt.innerText = `Group ${idx + 1}`;

            const selectGroups = getElement<HTMLSelectElement>("select-filter-groups");
            selectGroups.appendChild(opt);

            this.updateDisplay();
            this.process();
            this.save();
        } catch (error) {
            console.error(error);
        }
    }
    private btnFitlerGroupDel = () => {
        try {
            this.save();
        } catch (error) {
            console.error(error);
        }
    }
    private save() {
        localStorage.setItem("jfs", JSON.stringify({
            source: this.source,
            filters: this.filtersGroups,
            active: this.activeFilterGroup
        }, sterilizeFunction));
    }
    private async load() {
        const state = localStorage.getItem("jfs");
        if (!state) return;

        const data = JSON.parse(state, desterilizeFunction) as { source?: string; filters: Filter[][], active: number; };

        this.filtersGroups = data.filters;
        this.activeFilterGroup = data.active;

        this.source = data.source;

        if (this.source) {
            const el = getElement<HTMLInputElement>("content-url");
            el.value = this.source;
            await this.loadJson();
        }
    }
}

function main() {
    const app = App.get();
}

document.addEventListener("DOMContentLoaded", main);