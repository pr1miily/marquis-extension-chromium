// Firefox runs background.js as an event page (a document), where importScripts does not exist.
// platform/firefox/manifest.json lists every file background.js imports, in the same order and before it,
// so each importScripts call there has nothing left to load.
globalThis.importScripts ??= () => {};
