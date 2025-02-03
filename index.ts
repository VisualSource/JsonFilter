import home from "./index.html";

console.log(`Starting server on port ${Bun.color("green", "ansi")}${Bun.env.PORT ?? 3000}${Bun.color("white", "ansi-16m")}`)
Bun.serve({
    development: true,
    static: {
        "/": home
    },
    fetch() {
        return new Response("hello world");
    }
});