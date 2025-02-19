import type JSONEditor from "jsoneditor";

type Filter = {
    id: string;
    editor?: AceAjax.Editor;
    type: "filter" | "select" | "map" | "flatmap";
    func: (...args: unknown[]) => unknown
}

type ElementProps = {
    textContent?: string;
    type?: string;
    name?: string;
    placeholder?: string;
    required?: boolean;
    minlength?: number;
    readonly?: boolean;
    class?: string;
    id?: string;
    value?: string;
    [dataAttr: `data-${string}`]: string;
    selected?: boolean;
    onClick?: (ev: Event) => void
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

    if (attrs) {
        const { textContent, onClick, ...props } = attrs;
        if (textContent) el.textContent = textContent;
        if (onClick) el.addEventListener("click", onClick);
        for (const [key, value] of Object.entries(props)) {
            if (typeof value === "boolean") {
                if (value) el.setAttribute(key, "");
                continue;
            } else if (typeof value === "number") {
                el.setAttribute(key, value.toString());
                continue;
            } else if (value) {
                el.setAttribute(key, value);
            }
        }
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

/**
 * Gets a element by id, throws if it can be found.
 *
 * @template T
 * @param {string} target
 * @return {*}  {T}
 */
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
    private sources: { id: string; url: string }[] = [];
    private content: { id: string; data: unknown }[] = [];
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
        const dialogEdit = getElement<HTMLDialogElement>("source-input-url");
        const btnAddSource = getElement<HTMLButtonElement>("add-source");
        btnAddSource.addEventListener("click", () => {
            dialogEdit.showModal();
        });

        const btnCancel = getElement<HTMLButtonElement>("dialog-add-btn-cancel");
        btnCancel.addEventListener("click", () => {
            dialogEdit.close();
        });

        const dialogForm = getElement<HTMLFormElement>("dialog-form");
        dialogForm.addEventListener("submit", (ev) => {
            const content = new FormData(ev.target as HTMLFormElement);
            const source = content.get("source")?.toString().trim();
            if (!source) return;

            const contentId = crypto.randomUUID();
            this.sources.push({ url: source, id: contentId });
            this.createSourcesList();

            fetch(source).then(e => e.json()).then(item => {
                this.content.push({ id: contentId, data: item });
                this.process();
                this.save();
            }).catch((error) => {
                alert("Failed to load source")
                console.error(error)
            });
        });

        const dialogEdiForm = getElement<HTMLFormElement>("dialog-edit-form");
        dialogEdiForm.addEventListener("submit", (ev) => {
            const content = new FormData(ev.target as HTMLFormElement);
            const url = content.get("source")?.toString().trim();
            const id = content.get("id")?.toString();
            if (!id || !url) return;

            const idx = this.sources.findIndex(e => e.id === id);
            if (idx === -1) return;

            this.sources[idx].url = url;

            fetch(url).then(e => e.json()).then((item) => {
                const contentIdx = this.content.findIndex(e => e.id === id);
                if (contentIdx === -1) return;
                this.content[contentIdx].data = item;

                this.process();
                this.save();
            }).catch(e => {
                console.error(e);
                alert("Failed to load source");
            });
        });

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

            const select = createSelectElement(["filter", "select", "map", "flatmap"].map(e => ({
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
        let data: unknown[] = this.content.map(e => e.data);
        console.log(data);

        const filters = this.filtersGroups.at(this.activeFilterGroup);

        if (filters) for (const filter of filters) {
            switch (filter.type) {
                case "filter":
                    if (!Array.isArray(data)) break;
                    data = data.filter(filter.func);
                    break;
                case "flatmap":
                    if (!Array.isArray(data)) break;
                    data = data.flatMap(filter.func);
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
            sources: this.sources,
            filters: this.filtersGroups,
            active: this.activeFilterGroup
        }, sterilizeFunction));
    }

    private createSourcesList() {
        const list = getElement("source-list");

        for (let index = 0; index < list.children.length; index++) {
            list.children.item(index)?.remove();
        }

        for (const source of this.sources) {
            const el = createElement("li", { class: "source-li", "data-id": source.id });
            el.appendChild(createElement("input", {
                class: "input-cl",
                type: "url",
                readonly: true,
                value: source.url.split("/").at(-1),
                placeholder: "https://urltofile.json"
            }));
            el.appendChild(createElement("button", {
                type: "button",
                textContent: "Edit",
                class: "btn",
                onClick: (ev) => {
                    const parent = (ev.target as HTMLLIElement).parentElement;
                    const id = parent?.getAttribute("data-id");
                    if (!id) return;
                    const core = this.sources.find(e => e.id === id);
                    if (!core) return;

                    const dialog = getElement<HTMLDialogElement>("source-edit-dialog");

                    const inputs = dialog.querySelectorAll("input")
                    const idInput = inputs.item(0);
                    const urlInput = inputs.item(1);
                    idInput.value = core.id;
                    urlInput.value = core.url;
                    dialog.showModal();
                },
            }));
            el.appendChild(createElement("button", {
                type: "button",
                textContent: "X",
                class: "btn btn-error",
                onClick: (ev) => {
                    const parent = (ev.target as HTMLLIElement).parentElement;
                    const id = parent?.getAttribute("data-id");
                    if (!id) return;
                    const idx = this.sources.findIndex(e => e.id === id);
                    if (idx === -1) return;
                    if (parent) parent.remove();
                    this.sources.splice(idx, 1);
                    this.content.splice(idx, 1);
                    this.process();
                    this.save();
                },
            }));
            list.appendChild(el);


        }
    }

    private async load() {
        const state = localStorage.getItem("jfs");
        if (!state) return;

        const data = JSON.parse(state, desterilizeFunction) as { sources: { id: string; url: string }[]; filters: Filter[][], active: number; };

        this.filtersGroups = data.filters;
        this.activeFilterGroup = data.active;

        this.sources = data.sources;
        if (this.sources.length) {
            this.createSourcesList();
        }

        const requests = this.sources.map(e => fetch(e.url).then(d => d.json()).then((item) => ({ data: item, id: e.id })));

        await Promise.all(requests).then((items) => {
            this.content = items;
            this.process();
        }).catch(e => {
            console.error(e);
            alert("Failed to load sources")
        });
    }
}

function main() {
    const app = App.get();
}

document.addEventListener("DOMContentLoaded", main);