// The only declared content script. The floating dock itself (scripts/inject_dock.js, ~280 KB) is
// injected by the background worker, and only while the dock is enabled, so a page with the dock off
// runs this file alone.
//   loader -> SW { action: 'injectDock' }   (handled in background.js)
// Also injected into already-open tabs on install/update and when the dock is switched on.
(() => {
    if (window.marquisDockLoader) return;
    window.marquisDockLoader = true;

    function injectDock() {
        if (window.hasMarquisDockInjected) return; // set by inject_dock.js in this same content-script world
        chrome.runtime.sendMessage({ action: 'injectDock' }).catch(() => {}); // extension reloaded: nothing to do
    }

    chrome.storage.local.get('dockEnabled')
        .then(res => { if (res.dockEnabled === true) injectDock(); })
        .catch(() => {});

    // Switching the dock on in another tab or in the popup reaches every open page through storage.
    // Switching it off is handled by the dock itself.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.dockEnabled && changes.dockEnabled.newValue === true) injectDock();
    });
})();
