// @ts-ignore
if (typeof globalThis.DOMMatrix === "undefined") globalThis.DOMMatrix = class DOMMatrix { constructor() {} };

await import("./logging.ts");
await import("./app.ts");
