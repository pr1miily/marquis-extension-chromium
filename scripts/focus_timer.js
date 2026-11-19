// Focus timer, shared by the background worker (importScripts), the popup Focus section and the dock.
//
// chrome.storage.local `focusState` (shape unchanged from earlier versions):
//   running: { isRunning: true, startTime, duration, mode }   startTime in ms, duration in seconds
//   paused:  { isRunning: false, timeLeft, mode }             timeLeft in seconds
//   idle:    key absent
// The popup and the dock only write this key (start / pause / reset). background.js owns the end of a
// session: its alarm clears the key and notifies, and it turns a running focus session into DNR rules
// that redirect the block list (local `focusBlockedSites`) to blocked.html.
// Assigned to globalThis so it can be loaded by importScripts and injected into pages more than once.
globalThis.FocusTimer = globalThis.FocusTimer || (() => {
    const MODES = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
    const DEFAULT_SITES = ['facebook.com', 'threads.com', 'x.com', 'instagram.com', 'youtube.com', 'tiktok.com'];

    const length = (mode) => MODES[mode] || MODES.focus;

    // Seconds left, from the wall clock, so a throttled background tab never drifts.
    function secondsLeft(state, now = Date.now()) {
        if (!state) return null;
        if (state.isRunning) return Math.max(0, Math.ceil((state.startTime + state.duration * 1000 - now) / 1000));
        return state.timeLeft > 0 ? state.timeLeft : length(state.mode);
    }

    const endsAt = (state) => state && state.isRunning ? state.startTime + state.duration * 1000 : null;

    const start = (mode, seconds) =>
        chrome.storage.local.set({ focusState: { isRunning: true, startTime: Date.now(), duration: seconds, mode } });
    const pause = (mode, seconds) =>
        chrome.storage.local.set({ focusState: { isRunning: false, timeLeft: seconds, mode } });
    const reset = () => chrome.storage.local.remove('focusState');

    // Block-list entry -> RE2 regex for a DNR rule (case-insensitive by default). Entries are stored
    // without scheme or "www." (see focus.js):
    //   "x.com"          -> x.com and *.x.com only (not netflix.com)
    //   "reddit"         -> any host with a "reddit" label (reddit.com, old.reddit.com)
    //   "reddit.com/r/a" -> that host plus a path prefix
    // Returns null for entries that cannot be a host name.
    function siteRegex(site) {
        // A leading "www." is dropped as focus.js does on add; older entries kept it and never matched.
        const [host, ...pathParts] = String(site || '').trim().toLowerCase().replace(/^www\./, '').split('/');
        if (!host || !/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.')) return null;
        const re = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const label = '[^/?#:@]*';
        const hostRe = `(?:${label}\\.)?${re(host)}` + (host.includes('.') ? '' : `(?:\\.${label})?`);
        const path = pathParts.join('/');
        const tail = path ? re('/' + path) : '(?:[/?#]|$)';
        return `^https?://(?:[^/?#@]*@)?${hostRe}(?::[0-9]+)?${tail}`;
    }

    return { MODES, DEFAULT_SITES, length, secondsLeft, endsAt, start, pause, reset, siteRegex };
})();
