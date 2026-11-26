// ==========================================
// 🔔 NOTIFICATIONS
// ==========================================
// One path for every Marquis event, notify(event): it records the event in the in-app list (storage.local
// marquisNotifications, newest first, at most 50; unreadNotifCount mirrors the unread count) and, unless the
// preferences say otherwise, shows one device notification with the same title and text.
//   event: { id?, source, title, message, level?: 'info' | 'success' | 'error' | 'reminder', silent? }
//     id      the same id replaces the earlier entry and pop-up (no duplicates); default: a new id
//     source  a key of MarquisNotifySources (scripts/notify_sources.js)
//     silent  record it in the list only (the user is already looking at the result)
//   other contexts -> SW  { action: 'notify', event }  |  { action: 'notifyDismiss', id?, source?, text? }
// Preferences, storage.local notifyPrefs: { dnd, dndReminders, popups: { [source]: false } }
//   Do Not Disturb pauses device pop-ups only: events still land in the list (unread), background work goes
//   on, nothing is replayed when it ends, and due-date reminders get through only when dndReminders is on.
//   A tool switched off in popups records to the list without a pop-up.
importScripts('/scripts/notify_sources.js');

const NOTIFY_MAX = 50;
let notifyChain = Promise.resolve(); // one list write at a time, so two events at once cannot drop one
let notifyIconUrl = null;

function notify(event) {
    notifyChain = notifyChain.then(() => notifyNow(event)).catch(err => console.warn('Notify failed:', err));
    return notifyChain;
}

async function notifyNow({ id, source, title, message = '', level = 'info', silent = false }) {
    const src = MarquisNotifySources[source] ? source : 'marquis';
    id = String(id || `${src}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const { marquisNotifications: list = [], notifyPrefs: prefs = {} } =
        await chrome.storage.local.get(['marquisNotifications', 'notifyPrefs']);
    const entry = { id, source: src, title: String(title), message: String(message), level, isRead: false, date: new Date().toISOString() };
    const next = [entry, ...list.filter(n => String(n.id) !== id)].slice(0, NOTIFY_MAX);
    await chrome.storage.local.set({ marquisNotifications: next, unreadNotifCount: next.filter(n => !n.isRead).length });
    if (silent || !wantsPopup(prefs, src, level)) return;
    notifyIconUrl ||= await getPaddedIcon(chrome.runtime.getURL('img/46087a1c-4b4d-4a36-a268-1b57cb06908c.png'));
    const options = {
        type: 'basic',
        iconUrl: notifyIconUrl,
        title: entry.title,
        message: entry.message,
        contextMessage: `Marquis · ${MarquisNotifySources[src].label}`,
        priority: level === 'reminder' ? 2 : level === 'error' ? 1 : 0
    };
    // requireInteraction keeps a reminder on screen; Firefox rejects the option, so show it without there.
    try { await chrome.notifications.create(id, { ...options, requireInteraction: level === 'reminder' }); }
    catch { await chrome.notifications.create(id, options); }
}

function wantsPopup(prefs, source, level) {
    if (prefs.popups && prefs.popups[source] === false) return false;
    if (prefs.dnd) return level === 'reminder' && !!prefs.dndReminders;
    return true;
}

// Every list edit runs here, in the same queue as notify(), so an edit from the popup cannot overwrite an
// event recorded at the same moment.
//   { action: 'notifyDismiss', id?, source?, text? }  remove by id, or a source's entries whose text mentions
//                                                    `text` (older entries had numeric ids); closes their pop-ups
//   { action: 'notifyEdit', op: 'readAll' | 'clear' }
function editNotifications(edit) {
    notifyChain = notifyChain.then(async () => {
        const { marquisNotifications: list = [] } = await chrome.storage.local.get('marquisNotifications');
        const next = edit(list);
        if (next === list) return;
        list.filter(n => !next.some(m => m.id === n.id)).forEach(n => chrome.notifications.clear(String(n.id)));
        await chrome.storage.local.set({ marquisNotifications: next, unreadNotifCount: next.filter(n => !n.isRead).length });
    }).catch(err => console.warn('Notification edit failed:', err));
    return notifyChain;
}

function notifyDismiss({ id, source, text }) {
    const hit = (n) => (id != null && String(n.id) === String(id)) || (source && text && n.source === source && `${n.title} ${n.message}`.includes(text));
    return editNotifications(list => (list.some(hit) ? list.filter(n => !hit(n)) : list));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'notify') notify(request.event || {});
    else if (request.action === 'notifyDismiss') notifyDismiss(request);
    else if (request.action === 'notifyEdit' && request.op === 'readAll') editNotifications(list => (list.some(n => !n.isRead) ? list.map(n => ({ ...n, isRead: true })) : list));
    else if (request.action === 'notifyEdit' && request.op === 'clear') editNotifications(list => (list.length ? [] : list));
    else return false;
    sendResponse({ ok: true });
    return false;
});

// A click marks the entry read, closes the pop-up and opens the tool's page when it has one.
chrome.notifications.onClicked.addListener(async (id) => {
    chrome.notifications.clear(id);
    const { marquisNotifications: list = [] } = await chrome.storage.local.get('marquisNotifications');
    const entry = list.find(n => String(n.id) === id);
    if (!entry) return;
    editNotifications(l => l.map(n => (String(n.id) === id ? { ...n, isRead: true } : n)));
    const page = MarquisNotifySources[entry.source]?.open;
    if (page) chrome.tabs.create({ url: chrome.runtime.getURL(page) });
});

// Toolbar badge: the unread count, except while the recorder window is open (it shows REC / II there).
async function syncNotifyBadge() {
    const { recorderWindowId } = await chrome.storage.session.get('recorderWindowId');
    if (recorderWindowId) return;
    const { marquisNotifications: list = [] } = await chrome.storage.local.get('marquisNotifications');
    const unread = list.filter(n => !n.isRead).length;
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    chrome.action.setBadgeText({ text: unread ? (unread > 99 ? '99+' : String(unread)) : '' });
}
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.marquisNotifications) syncNotifyBadge();
});

// Notes & Tasks reminders: one alarm per open task with a due date, at 9:00 that day (tasks carry a date, no
// time). Rebuilt from marquisTasks whenever it changes, so editing, completing or deleting a task moves or
// drops its reminder.
const TASK_ALARM = 'task_due_';
async function syncTaskReminders() {
    const { marquisTasks: tasks = [] } = await chrome.storage.local.get('marquisTasks');
    const want = new Map();
    for (const t of tasks) {
        if (!t || t.completed || !t.date || t.id == null) continue;
        const when = new Date(`${t.date}T09:00`).getTime();
        if (Number.isFinite(when) && when > Date.now()) want.set(TASK_ALARM + t.id, when);
    }
    for (const a of await chrome.alarms.getAll()) {
        if (a.name.startsWith(TASK_ALARM) && want.get(a.name) !== a.scheduledTime) await chrome.alarms.clear(a.name);
    }
    const have = new Set((await chrome.alarms.getAll()).map(a => a.name));
    for (const [name, when] of want) if (!have.has(name)) await chrome.alarms.create(name, { when });
}
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.marquisTasks) syncTaskReminders().catch(err => console.warn('Task reminders:', err));
});
syncTaskReminders().catch(() => {});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith(TASK_ALARM)) return;
    const { marquisTasks: tasks = [] } = await chrome.storage.local.get('marquisTasks');
    const task = tasks.find(t => t && TASK_ALARM + t.id === alarm.name);
    if (!task || task.completed) return;
    notify({ id: alarm.name, source: 'tasks', level: 'reminder', title: 'Task due today', message: task.title || 'Untitled task' });
});

// True while the toolbar popup is open: it shows results itself, so events from it need no pop-up.
async function popupIsOpen() {
    try { return (await chrome.runtime.getContexts({ contextTypes: ['POPUP'] })).length > 0; } catch { return false; }
}

// ==========================================
// 📸 SCREENSHOT CAPTURE ENGINE
// ==========================================
//
// Message contract
//   popup / dock -> SW  { action: 'capture', type: 'visible' | 'full' | 'region', tabId? }
//                <- SW  { ok: true, id, parts?, notes? }  saved to CaptureStore, preview.html?id= opened
//                       { ok: true, id: null }             region selection cancelled
//                       { ok: false, error, state? }       nothing saved; error is user-readable
//   popup / page HUD -> SW  { action: 'captureCancel' }    stops a running full-page capture
//   SW -> anyone         { action: 'captureProgress', state, text, done, total }   (nobody may be listening)
//
// Full page: scripts/fullpage.js (in the page) measures, prepares and scrolls; this worker plans the tiles,
// captures them at most twice a second, stitches them into segments (scripts/fullpage_stitch.js), saves
// them and always has the page restored. States: ANALYZING -> PREPARING -> CAPTURING -> STITCHING ->
// EXPORTING -> COMPLETED, or CANCELLED / FAILED / TIMED_OUT / INTERRUPTED. `_capture` is the lock: claimed
// synchronously, released in runCapture's finally.

importScripts('/scripts/capture_store.js', '/scripts/fullpage_stitch.js');

const CAPTURE_TYPES = ['visible', 'full', 'region'];
const TILE_INTERVAL_MS = 550; // Chrome allows 2 captureVisibleTab calls per second
const FULL = { maxTiles: 400, maxParts: 10, maxMs: 240000, captureRetries: 4 };
let _capture = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'captureCancel') {
        _capture?.cancel('Capture cancelled.', 'CANCELLED');
        sendResponse({ ok: !!_capture });
        return false;
    }
    if (request.action === 'capture') {
        if (!CAPTURE_TYPES.includes(request.type)) return false;
        const tabId = Number.isInteger(request.tabId) ? request.tabId : null;
        runCapture(request.type, tabId, sender).then(
            (result) => sendResponse({ ok: true, ...result }),
            (err) => sendResponse({ ok: false, error: err.message || String(err), state: err.state || 'FAILED' })
        );
        return true;
    }
    return false;
});

function newCapture(type) {
    const c = {
        type, state: 'IDLE', startedAt: Date.now(), stop: null, stopState: null,
        cancel(message, state = 'CANCELLED') {
            if (c.stop) return;
            c.stop = message; c.stopState = state;
            if (c.tabId) chrome.scripting.executeScript({ target: { tabId: c.tabId }, func: () => window.__marquisFullPage?.cancel() }).catch(() => {});
        },
        // Throws once the capture was cancelled, interrupted or ran out of time.
        check() {
            if (!c.stop && Date.now() - c.startedAt > FULL.maxMs) { c.stop = 'The capture took longer than 4 minutes and was stopped.'; c.stopState = 'TIMED_OUT'; }
            if (c.stop) throw Object.assign(new Error(c.stop), { state: c.stopState });
        },
    };
    return c;
}

function captureProgress(c, state, text, done = 0, total = 0) {
    c.state = state;
    chrome.runtime.sendMessage({ action: 'captureProgress', state, text, done, total }).catch(() => {});
}

async function runCapture(type, tabId, sender) {
    if (_capture) throw new Error('Another capture is still running. Wait for it to finish.');
    const c = _capture = newCapture(type);
    let tab = null, previous = null;
    try {
        tab = tabId ? await chrome.tabs.get(tabId)
            : sender.tab || (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
        if (!tab) throw new Error('No tab to capture.');
        if (!tab.url || !isUrlAllowed(tab.url)) throw new Error('Chrome does not allow capturing this page.');
        Object.assign(c, { tabId: tab.id, windowId: tab.windowId });
        chrome.action.setBadgeText({ text: '', tabId: tab.id }); // clear an ERR left by a previous failure

        // Chrome can only capture the visible tab of a window: show the chosen tab, and put the previous one
        // back if a full-page capture does not finish.
        [previous] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
        await chrome.tabs.update(tab.id, { active: true });
        if (type !== 'visible') await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
        await sleep(300);

        if (type === 'full') return await saveFullPage(c, tab, await captureFullPage(c, tab));

        const rect = type === 'region' ? await selectRegion(tab.id) : null;
        if (type === 'region' && !rect) return { id: null };
        const blob = await captureViewport(tab, rect);
        const bmp = await createImageBitmap(blob);
        const record = { type, createdAt: Date.now(), title: tab.title || '', url: tab.url, width: bmp.width, height: bmp.height, blob, thumb: await makeThumb(bmp) };
        bmp.close();
        const id = await CaptureStore.add(record);
        await chrome.tabs.create({ url: chrome.runtime.getURL(`preview.html?id=${id}`), windowId: tab.windowId, index: tab.index + 1, openerTabId: tab.id });
        return { id };
    } catch (err) {
        const state = err.state || 'FAILED';
        if (type === 'full') captureProgress(c, state, err.message);
        if (tab && state !== 'CANCELLED') {
            chrome.action.setBadgeText({ text: 'ERR', tabId: tab.id });
            chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId: tab.id });
        }
        if (type === 'full' && previous && previous.id !== tab?.id && state !== 'INTERRUPTED') {
            chrome.tabs.update(previous.id, { active: true }).catch(() => {});
        }
        if (state === 'FAILED') console.error('Capture error:', err);
        // The popup usually closed when the tab was activated, so an error would go unseen: record it, with a
        // device pop-up unless the popup is still open to show it. A cancel is the user's own doing.
        if (state !== 'CANCELLED') {
            notify({ source: 'capture', level: 'error', title: type === 'full' ? 'Full-page screenshot failed' : 'Screenshot failed',
                message: err.message || 'The capture did not finish.', silent: await popupIsOpen() });
        }
        throw err;
    } finally {
        _capture = null;
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function captureVisibleTab(windowId) {
    return new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
            if (chrome.runtime.lastError || !dataUrl) reject(new Error(chrome.runtime.lastError?.message || 'Capture failed'));
            else resolve(dataUrl);
        });
    });
}

const dataUrlToBlob = async (dataUrl) => (await fetch(dataUrl)).blob();

// 320 px wide JPEG of the top of the capture, for the history list (full-page captures are very tall).
async function makeThumb(bmp) {
    const tw = Math.min(320, bmp.width);
    const th = Math.min(Math.round(bmp.height * tw / bmp.width), 240);
    const canvas = new OffscreenCanvas(tw, th);
    canvas.getContext('2d').drawImage(bmp, 0, 0, bmp.width, th * bmp.width / tw, 0, 0, tw, th);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}

// Hide Marquis' own floating UI so it never appears in a screenshot. Resolves after the next paint.
function setOwnUiHidden(tabId, hidden, progressText) {
    return chrome.scripting.executeScript({
        target: { tabId },
        func: (h, text) => new Promise((paintDone) => {
            for (const id of ['marquis-floating-root', 'odh-capture-hud']) {
                const el = document.getElementById(id);
                if (el) el.style.visibility = h ? 'hidden' : '';
            }
            const prog = document.getElementById('odh-capture-progress');
            if (prog && text) prog.textContent = text;
            requestAnimationFrame(() => requestAnimationFrame(paintDone));
        }),
        args: [hidden, progressText || '']
    }).catch(() => {}); // pages Chrome won't script (e.g. the Web Store) are still captured, just without hiding
}

async function captureViewport(tab, rect) {
    await setOwnUiHidden(tab.id, true);
    let dataUrl;
    try {
        dataUrl = await captureVisibleTab(tab.windowId);
    } finally {
        await setOwnUiHidden(tab.id, false);
    }
    const blob = await dataUrlToBlob(dataUrl);
    return rect ? cropBlob(blob, rect) : blob;
}

// rect is in CSS px of a viewport `vw` CSS px wide; the capture is in device px.
async function cropBlob(blob, { x, y, w, h, vw }) {
    const bmp = await createImageBitmap(blob);
    try {
        const scale = bmp.width / vw;
        const sx = Math.round(x * scale), sy = Math.round(y * scale);
        const sw = Math.max(1, Math.min(Math.round(w * scale), bmp.width - sx));
        const sh = Math.max(1, Math.min(Math.round(h * scale), bmp.height - sy));
        const canvas = new OffscreenCanvas(sw, sh);
        canvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
        return await canvas.convertToBlob({ type: 'image/png' });
    } finally {
        bmp.close();
    }
}

// Injected: lets the user drag a rectangle. Resolves { x, y, w, h, vw } in CSS px, or null on Esc / click.
function regionPicker() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(15,23,42,.35);';
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;display:none;border:2px solid #6366f1;box-shadow:0 0 0 100vmax rgba(15,23,42,.45);pointer-events:none;';
        const hint = document.createElement('div');
        hint.textContent = 'Drag to select an area · Esc to cancel';
        hint.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:999px;background:#0f172a;color:#f8fafc;font:600 13px system-ui,sans-serif;pointer-events:none;';
        overlay.append(box, hint);
        document.documentElement.appendChild(overlay);

        let start = null;
        const rectFrom = (e) => ({ x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) });
        const finish = (rect) => {
            removeEventListener('keydown', onKey, true);
            overlay.remove();
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(rect))); // overlay gone from the next frame
        };
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
        addEventListener('keydown', onKey, true);

        overlay.addEventListener('pointerdown', (e) => {
            start = { x: e.clientX, y: e.clientY };
            overlay.setPointerCapture(e.pointerId);
            overlay.style.background = 'transparent';
            hint.remove();
        });
        overlay.addEventListener('pointermove', (e) => {
            if (!start) return;
            const r = rectFrom(e);
            Object.assign(box.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
        });
        overlay.addEventListener('pointerup', (e) => {
            if (!start) return;
            const r = rectFrom(e);
            finish(r.w > 4 && r.h > 4 ? { ...r, vw: innerWidth } : null);
        });
    });
}

async function selectRegion(tabId) {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: regionPicker });
    return injection?.result || null;
}

// Drives scripts/fullpage.js tile by tile. Returns { parts: [{ blob, width, height }], notes: [text] }.
async function captureFullPage(c, tab) {
    const tabId = tab.id;
    const page = async (name, ...args) => {
        c.check();
        const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: (n, a) => window.__marquisFullPage[n](...a), args: [name, args] });
        c.check();
        return res?.result;
    };
    // Chrome captures whatever tab is visible: stop rather than capture the wrong tab or a new page.
    const onRemoved = (id) => { if (id === tabId) c.cancel('The tab was closed during the capture.', 'INTERRUPTED'); };
    const onUpdated = (id, info) => { if (id === tabId && info.status === 'loading') c.cancel('The page navigated away during the capture.', 'INTERRUPTED'); };
    const onActivated = (info) => {
        if (info.windowId === tab.windowId && info.tabId !== tabId) c.cancel('Another tab came to the front, so the capture stopped (Chrome can only capture the visible tab).', 'INTERRUPTED');
    };
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1', tabId });
    try {
        captureProgress(c, 'ANALYZING', 'Analyzing page...');
        try {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['scripts/fullpage.js'] });
        } catch {
            throw new Error('Chrome does not let extensions scroll this page (Chrome Web Store, PDF viewer or another protected page). Use Visible Area instead.');
        }
        await page('hud', 'Preparing page...');
        captureProgress(c, 'PREPARING', 'Loading the whole page...');
        chrome.action.setBadgeText({ text: 'SCAN', tabId });
        const info = await page('prepare');
        if (!info) throw new Error('The page stopped responding while it was prepared.');
        if (info.pdf) throw new Error('PDFs open in the Chrome viewer cannot be scrolled by extensions. Use Visible Area instead.');
        const notes = fullPageNotes(info);

        let m = info, stitcher = null, scale = 0, done = 0, limitH = Infinity;
        const remaining = (after) => FullPageStitch.plan({ ...m, fullH: Math.min(m.fullH, limitH) })
            .filter((q) => !after || q.y > after.y || (q.y === after.y && q.x > after.x));
        let queue = remaining(null);
        captureProgress(c, 'CAPTURING', 'Capturing...', 0, queue.length);
        while (queue.length) {
            if (done >= FULL.maxTiles) { notes.push(`Stopped after ${FULL.maxTiles} screenshots; the rest of the page is not in the image.`); break; }
            const p = queue.shift();
            const r = await page('shot', p.x, p.y, p.y === 0);
            const wait = TILE_INTERVAL_MS - (Date.now() - (c.lastShot || 0));
            if (wait > 0) await sleep(wait);
            const [front] = await chrome.tabs.query({ active: true, windowId: c.windowId });
            if (front?.id !== tabId) c.cancel('Another tab came to the front, so the capture stopped (Chrome can only capture the visible tab).', 'INTERRUPTED');
            c.check();
            const dataUrl = await captureWithRetry(c);
            c.lastShot = Date.now();
            done++;
            const bmp = await createImageBitmap(await dataUrlToBlob(dataUrl));
            const s = bmp.width / r.innerW;                        // device px per CSS px, including zoom
            if (!stitcher) {
                scale = s;
                stitcher = new FullPageStitch.Stitcher({ width: Math.round(m.fullW * s), height: Math.round(m.fullH * s), bg: info.bg });
                const maxRows = Math.max(1, Math.floor(FULL.maxParts / stitcher.cols));
                if (stitcher.rows > maxRows) {                     // never more than maxParts images: stop there, and say so
                    limitH = Math.floor(maxRows * stitcher.segH / s);
                    stitcher.H = Math.round(limitH * s);
                    notes.push(`The page is ${Math.round(m.fullH).toLocaleString()} px tall; the first ${limitH.toLocaleString()} px were captured (${FULL.maxParts} images is the limit).`);
                    queue = remaining(p);
                }
            } else if (Math.abs(s - scale) > 0.01) {
                bmp.close();
                throw new Error('The page zoom changed during the capture. Try again without zooming.');
            }
            if (r.fullH > m.fullH + 1 && m.fullH < limitH) {       // the page grew (lazy sections): extend the plan
                m = { ...m, fullH: r.fullH };
                stitcher.setHeight(Math.round(Math.min(m.fullH, limitH) * s));
                queue = remaining(p);
            }
            const sx = Math.round(r.clipX * s), sy = Math.round(r.clipY * s);
            await stitcher.add({ bmp, sx, sy, sw: Math.min(Math.round(r.viewW * s), bmp.width - sx), sh: Math.min(Math.round(r.viewH * s), bmp.height - sy),
                dx: Math.round(r.x * s), dy: Math.round(r.y * s) });
            const total = done + queue.length;
            captureProgress(c, 'CAPTURING', `Capturing ${done} of ${total}...`, done, total);
            if (queue.length) await page('hud', `Capturing ${done} of ${total}... Esc to cancel`);
        }
        captureProgress(c, 'STITCHING', 'Stitching images...');
        await page('hud', 'Stitching images...').catch(() => {});
        const parts = await stitcher.finish();
        if (parts.length > 1) notes.push(`The page was too large for one image, so it was saved as ${parts.length} images in order.`);
        return { parts, notes };
    } finally {
        chrome.tabs.onRemoved.removeListener(onRemoved);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onActivated.removeListener(onActivated);
        chrome.action.setBadgeText({ text: '', tabId });
        await chrome.scripting.executeScript({ target: { tabId }, func: () => window.__marquisFullPage?.restore() }).catch(() => {});
    }
}

// What the user should know about the result: parts of the page that cannot be in it, and why.
function fullPageNotes(info) {
    const notes = [];
    if (info.mode === 'element') notes.push('This page scrolls inside a panel, so the image shows that panel in full.');
    if (info.frames?.crossOrigin) notes.push(`${info.frames.crossOrigin} embedded frame(s) from other sites appear as shown on screen; content scrolled inside them is not captured.`);
    if (info.notes?.includes('growing')) notes.push('The page kept loading more content (an endless feed), so it was captured as far as it had loaded.');
    if (info.notes?.includes('limit')) notes.push('The page is extremely long; it was captured up to 60,000 px.');
    if (info.notes?.includes('slow')) notes.push('Some content was still loading after 15 seconds and may be missing.');
    return notes;
}

async function captureWithRetry(c) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await captureVisibleTab(c.windowId);
        } catch (err) {
            const rate = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota/i.test(err.message);
            if (!rate || attempt >= FULL.captureRetries) {
                throw new Error(rate ? 'Chrome kept refusing screenshots (too many requests). Try again in a moment.' : `Chrome refused the screenshot: ${err.message}`);
            }
            await sleep(TILE_INTERVAL_MS * attempt);            // back off, then retry
            c.check();
        }
    }
}

// Each part becomes one capture; titles and fields (part / parts) keep them in order.
async function saveFullPage(c, tab, { parts, notes }) {
    captureProgress(c, 'EXPORTING', 'Saving...');
    const createdAt = Date.now();
    const ids = [];
    for (const [i, part] of parts.entries()) {
        const bmp = await createImageBitmap(part.blob);
        const suffix = parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : '';
        ids.push(await CaptureStore.add({ type: 'full', createdAt, title: (tab.title || '') + suffix, url: tab.url, width: part.width, height: part.height,
            blob: part.blob, thumb: await makeThumb(bmp), ...(parts.length > 1 ? { part: i + 1, parts: parts.length } : {}) }));
        bmp.close();
    }
    await chrome.tabs.create({ url: chrome.runtime.getURL(`preview.html?id=${ids[0]}`), windowId: tab.windowId, index: tab.index + 1, openerTabId: tab.id });
    captureProgress(c, 'COMPLETED', parts.length > 1 ? `Saved as ${parts.length} images.` : 'Saved.');
    return { id: ids[0], parts: parts.length, notes };
}

function isUrlAllowed(url) {
  return !['chrome://', 'chrome-extension://', 'moz-extension://', 'edge://', 'about:'].some(p => url.startsWith(p));
}

// ==========================================
// 🎬 SCREEN RECORDER WINDOW
// ==========================================
//   popup / dock -> SW  { action: 'openRecorder', tabId?, options?: { mic, cam, draw, mode: 'screen' | 'camera' } }
//                <- SW  { ok: true } | { ok: false, error }
// recorder.html owns the streams, MediaRecorder and the recording state machine. Only one recorder window
// exists at a time (its id is kept in storage.session), so a second request focuses it instead of
// starting an overlapping session.
let _openingRecorder = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'openRecorder') return false;
    _openingRecorder = _openingRecorder || openRecorder(request, sender).finally(() => { _openingRecorder = null; });
    _openingRecorder.then(() => sendResponse({ ok: true }), (err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
});

async function openRecorder(request, sender) {
    const { recorderWindowId } = await chrome.storage.session.get('recorderWindowId');
    if (recorderWindowId) {
        try {
            await chrome.windows.update(recorderWindowId, { focused: true, drawAttention: true });
            return;
        } catch { /* the window is gone: open a new one */ }
    }
    const params = new URLSearchParams();
    const tabId = Number.isInteger(request.tabId) ? request.tabId : sender.tab?.id;
    if (tabId) params.set('tab', String(tabId));
    const o = request.options || {};
    for (const k of ['mic', 'cam', 'draw']) if (k in o) params.set(k, o[k] ? '1' : '0');
    if (o.mode === 'screen' || o.mode === 'camera') params.set('mode', o.mode);
    // Chrome's share picker (Chrome Tab / Window / Entire Screen) opens inside this window and can be no wider
    // than it: at 400px its tabs and previews were clipped. 680px fits the picker; it is clamped to, and centred
    // on, the browser window the user is in so it never opens past the edge of a small screen.
    const host = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
    const fit = host && host.state !== 'minimized' && host.width && host.height ? host : null;
    const width = Math.min(680, fit ? fit.width : 680), height = Math.min(680, fit ? fit.height : 680);
    const place = fit ? { left: fit.left + Math.round((fit.width - width) / 2), top: fit.top + Math.round((fit.height - height) / 2) } : {};
    const win = await chrome.windows.create({ url: chrome.runtime.getURL(`recorder.html?${params}`), type: 'popup', width, height, ...place, focused: true });
    await chrome.storage.session.set({ recorderWindowId: win.id });
}

chrome.windows.onRemoved.addListener(async (windowId) => {
    const { recorderWindowId } = await chrome.storage.session.get('recorderWindowId');
    if (windowId !== recorderWindowId) return;
    await chrome.storage.session.remove('recorderWindowId');
    syncNotifyBadge(); // the window can't clear REC itself when it is closed mid-recording; the unread count comes back
});

// ==========================================
// UNINSTALL EXTENSION
// ==========================================
try {
    importScripts('/config.js'); 
} catch (e) {}

chrome.runtime.onInstalled.addListener(() => {
    if (typeof CONFIG !== "undefined" && CONFIG.UNINSTALL_URL) {
        chrome.runtime.setUninstallURL(CONFIG.UNINSTALL_URL);
        console.log("✅ Uninstall URL set:", CONFIG.UNINSTALL_URL);
    } else {
        console.warn("⚠️ CONFIG.UNINSTALL_URL not found");
    }

    // Theme key migration (4.0.x): sync.marquis_theme is now the only theme key. Before, the dock wrote
    // local.dockTheme alone, so a dock-only choice is adopted once. local.dockTheme is left in place.
    Promise.all([chrome.storage.sync.get('marquis_theme'), chrome.storage.local.get('dockTheme')])
        .then(([sync, local]) => {
            if (!sync.marquis_theme && local.dockTheme) chrome.storage.sync.set({ marquis_theme: local.dockTheme });
        })
        .catch(err => console.warn('Theme migration skipped:', err));

    // Screenshots now go through IndexedDB (CaptureStore). The old transfer buffer, the last capture's
    // base64 tiles in local.screenshotMeta + chunk_N, is no longer read by anything; drop only those keys.
    chrome.storage.local.get('screenshotMeta').then(({ screenshotMeta: meta }) => {
        if (!meta) return;
        const count = meta.type === 'visible' ? 1 : (meta.totalChunks || 0);
        return chrome.storage.local.remove(['screenshotMeta', ...Array.from({ length: count }, (_, i) => `chunk_${i}`)]);
    }).catch(err => console.warn('Screenshot buffer cleanup skipped:', err));

    injectDockLoaderIntoOpenTabs().catch(() => {});

    // An update can land mid-session: rebuild the focus rules and alarm from storage.
    syncFocus();
});


// ==========================================
// 🛡️ FOCUS TIMER: SITE BLOCKER + SESSION END
// ==========================================
// focusState is written by the popup and the dock (scripts/focus_timer.js). This worker:
//   - redirects the block list to blocked.html with DNR rules while a focus session runs, so the
//     request never reaches the site (the old tabs.onUpdated redirect let the page start loading);
//   - ends sessions: an alarm at the end time clears focusState and shows one notification.
// Rules and alarm are rebuilt from storage, so a restarted browser or worker resumes correctly.
importScripts('/scripts/focus_timer.js');

const FOCUS_RULE_IDS = { first: 7000, last: 7999 }; // dynamic rule ids owned by the focus blocker
const FOCUS_ALARM = 'focusTimerEnd';

// Serialized: overlapping syncs could add the same rule ids twice.
let focusSyncChain = Promise.resolve();
function syncFocus() {
    focusSyncChain = focusSyncChain.then(syncFocusNow).catch(err => console.warn('Focus sync failed:', err));
    return focusSyncChain;
}

async function syncFocusNow() {
    const { focusState: state, focusBlockedSites } = await chrome.storage.local.get(['focusState', 'focusBlockedSites']);
    if (state && state.isRunning && FocusTimer.secondsLeft(state) === 0) {
        await chrome.storage.local.remove('focusState'); // that change queues the sync that lifts the rules
        notifyFocusEnded(state.mode);
        return;
    }
    const blocking = !!(state && state.isRunning && state.mode === 'focus');
    const addRules = blocking ? await focusRules(focusBlockedSites || FocusTimer.DEFAULT_SITES) : [];
    const removeRuleIds = (await chrome.declarativeNetRequest.getDynamicRules())
        .map(r => r.id).filter(id => id >= FOCUS_RULE_IDS.first && id <= FOCUS_RULE_IDS.last);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
    if (state && state.isRunning) await chrome.alarms.create(FOCUS_ALARM, { when: FocusTimer.endsAt(state) });
    else await chrome.alarms.clear(FOCUS_ALARM);
}

async function focusRules(sites) {
    const rules = [];
    for (const site of sites) {
        const regex = FocusTimer.siteRegex(site);
        if (!regex || FOCUS_RULE_IDS.first + rules.length > FOCUS_RULE_IDS.last) continue;
        const { isSupported } = await chrome.declarativeNetRequest.isRegexSupported({ regex });
        if (!isSupported) continue;
        rules.push({
            id: FOCUS_RULE_IDS.first + rules.length,
            priority: 1,
            action: { type: 'redirect', redirect: { extensionPath: '/blocked.html' } },
            condition: { regexFilter: regex, resourceTypes: ['main_frame'] }
        });
    }
    return rules;
}

function notifyFocusEnded(mode) {
    notify(mode === 'focus'
        ? { id: 'focus_timer_ended', source: 'focus', level: 'success', title: 'Focus session complete', message: 'Blocked sites are open again. Time for a break.' }
        : { id: 'focus_timer_ended', source: 'focus', title: 'Break is over', message: 'Start another focus session when you are ready.' });
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.focusState || changes.focusBlockedSites)) syncFocus();
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === FOCUS_ALARM) syncFocus(); });
chrome.runtime.onStartup.addListener(() => syncFocus());

// popup / dock -> SW { action: 'focusCheck' }: a visible countdown reached 0, end the session now rather
// than at the alarm (alarms may fire a little late).
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'focusCheck') syncFocus();
});


// ==========================================
// 🧩 FLOATING DOCK INJECTION
// ==========================================
// scripts/dock_loader.js is the only declared content script. While dockEnabled is true it asks for the dock:
//   loader -> SW { action: 'injectDock' }; the dock is injected into that frame only.
const DOCK_FILES = ['scripts/safe_html.js', 'scripts/kanban_store.js', 'scripts/focus_timer.js', 'scripts/mq_float.js', 'scripts/screen_picker.js', 'scripts/inject_dock.js'];

chrome.runtime.onMessage.addListener((request, sender) => {
    if (request.action !== 'injectDock' || !sender.tab) return;
    chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [sender.frameId] }, files: DOCK_FILES })
        .catch(err => console.warn('Dock injection skipped:', err.message));
});

// Colour picker for browsers without the EyeDropper API (scripts/screen_picker.js, Firefox): a screenshot of
// the sender's visible tab, taken with Marquis' own floating UI hidden.
//   content script -> SW { action: 'captureVisibleForPicker' } -> { dataUrl } | { error }
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'captureVisibleForPicker' || !sender.tab) return false;
    const tab = sender.tab;
    (async () => {
        await setOwnUiHidden(tab.id, true);
        try { return { dataUrl: await captureVisibleTab(tab.windowId) }; }
        finally { await setOwnUiHidden(tab.id, false); }
    })().then(sendResponse, err => sendResponse({ error: err.message || String(err) }));
    return true;
});

// Tabs opened before an install/update never got the declared loader, and switching the dock on must
// reach them too. Injecting it is cheap and idempotent; it then loads the dock if the dock is enabled.
async function injectDockLoaderIntoOpenTabs() {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    await Promise.allSettled(tabs.map(tab =>
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['scripts/dock_loader.js'] })));
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.dockEnabled && changes.dockEnabled.newValue === true) {
        injectDockLoaderIntoOpenTabs().catch(() => {});
    }
});

// Dock widget APIs are fetched here so the request carries the extension's origin, not the visited site's.
//   dock -> SW { action: 'dockFetchJson', url } <- { ok, status, data } | { ok: false, status: 0, error }
// Only these hosts, over https; nothing else can be fetched through this message.
const DOCK_API_HOSTS = new Set(['api.datamuse.com', 'api.dictionaryapi.dev', 'api.open-meteo.com', 'geocoding-api.open-meteo.com']);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'dockFetchJson') return false;
    let url;
    try { url = new URL(request.url); } catch (err) { url = null; }
    if (!url || url.protocol !== 'https:' || !DOCK_API_HOSTS.has(url.hostname)) {
        sendResponse({ ok: false, status: 0, error: 'URL not allowed' });
        return false;
    }
    fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
        .then(async (res) => sendResponse({ ok: res.ok, status: res.status, data: await res.json().catch(() => null) }))
        .catch(err => sendResponse({ ok: false, status: 0, error: err.message }));
    return true;
});

// Dock icon font and launcher logo, read here (the extension's own origin) and sent as bytes, so the dock
// never loads a chrome-extension:// URL from the visited page (some sites refuse it: "Unsafe attempt to
// load URL ...") and a site's CSP cannot block them either.
//   dock -> SW { action: 'dockAssets' } <- { ok: true, font: base64 woff2, logo: base64 PNG } | { ok: false, error }
const DOCK_LOGO_PX = 128; // drawn at 40px; 128 stays sharp on high-DPI screens (the source PNG is 900 KB)
let dockAssets = null;

function bytesToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

async function shrinkImage(blob, px) {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, px / Math.max(bmp.width, bmp.height));
    const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return canvas.convertToBlob({ type: 'image/png' });
}

async function loadDockAssets() {
    const [font, logo] = await Promise.all([
        fetch(chrome.runtime.getURL('styles/bootstrap-icons.woff2')).then(r => r.arrayBuffer()),
        fetch(chrome.runtime.getURL('img/46087a1c-4b4d-4a36-a268-1b57cb06908c.png'))
            .then(r => r.blob()).then(b => shrinkImage(b, DOCK_LOGO_PX)).then(b => b.arrayBuffer()),
    ]);
    return { ok: true, font: bytesToBase64(font), logo: bytesToBase64(logo) };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'dockAssets') return false;
    dockAssets ||= loadDockAssets().catch(err => { dockAssets = null; return { ok: false, error: err.message }; });
    dockAssets.then(sendResponse);
    return true;
});

// ==========================================
// 🗂️ WORKSPACE SWITCH
// ==========================================
// popup / workspace page -> SW { action: 'switchWorkspace', id, windowId } <- { ok: true } | { ok: false, error }
// Runs here because the popup closes as soon as the first new tab is activated, which cut the switch short.
// Same order as before: open the workspace's tabs (first one active), group them, close the window's old
// unpinned tabs. Saved tabs are read from local `odh_workspaces` ([{ id, name, tabs: [{ url, title, favIconUrl }] }]).
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'switchWorkspace') return false;
    switchWorkspace(request.id, request.windowId).then(
        () => sendResponse({ ok: true }),
        async (err) => {
            sendResponse({ ok: false, error: err.message || String(err) });
            // The popup closes as soon as the first new tab opens, so a failure part-way would go unseen.
            notify({ source: 'workspace', level: 'error', title: 'Workspace switch failed', message: err.message || String(err), silent: await popupIsOpen() });
        });
    return true;
});

// Same refusal list as isAllowedUrl in scripts/workspace.js.
const isWorkspaceUrl = (url) => !!url && !['chrome://', 'chrome-extension://', 'moz-extension://', 'edge://', 'about:', 'file://'].some(p => url.startsWith(p));

async function switchWorkspace(id, windowId) {
    const { odh_workspaces: workspaces = [] } = await chrome.storage.local.get('odh_workspaces');
    const workspace = workspaces.find(w => w.id === id);
    if (!workspace) throw new Error('That workspace no longer exists.');
    const scope = typeof windowId === 'number' ? { windowId } : { lastFocusedWindow: true };

    const oldTabIds = (await chrome.tabs.query({ ...scope, pinned: false })).map(t => t.id);
    const urls = workspace.tabs.map(t => t.url).filter(isWorkspaceUrl);
    const target = typeof windowId === 'number' ? { windowId } : {};

    if (urls.length > 0) {
        const newTabIds = [];
        for (const [i, url] of urls.entries()) {
            newTabIds.push((await chrome.tabs.create({ ...target, url, active: i === 0 })).id);
        }
        try {
            const groupId = await chrome.tabs.group({ tabIds: newTabIds });
            await chrome.tabGroups.update(groupId, { title: workspace.name, collapsed: false });
        } catch (e) {
            console.warn('Tab grouping failed:', e);
        }
    } else {
        // Empty workspace: keep the window open with a blank tab.
        await chrome.tabs.create({ ...target, active: true });
    }

    if (oldTabIds.length > 0) await chrome.tabs.remove(oldTabIds);
}

// ==========================================
// ⚡ POWER & TIMER LOGIC
// ==========================================

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'setPowerMode') {
        setPowerMode(req.mode);
        sendResponse({ success: true });
    }
    if (req.action === 'startPowerTimer') {
        createPowerTimer(req.minutes, req.actions);
        sendResponse({ success: true });
    }
    if (req.action === 'stopPowerTimer') {
        clearPowerTimer();
        sendResponse({ success: true });
    }
});

async function setPowerMode(mode) {
    // Firefox has no power API: the state stays at default there, and the Keep Awake panel says why (script.js).
    if (!chrome.power) return void chrome.storage.local.set({ kaCurrentMode: 'default' });
    if (mode === 'display') {
        chrome.power.requestKeepAwake('display');
        await manageHeartbeat(true); 
    } else if (mode === 'system') {
        chrome.power.requestKeepAwake('system');
        await manageHeartbeat(true); 
    } else {
        chrome.power.releaseKeepAwake();
        await manageHeartbeat(false); 
    }
    chrome.storage.local.set({ kaCurrentMode: mode });
}

async function manageHeartbeat(start) {
    const offscreenUrl = chrome.runtime.getURL('heartbeat.html');
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
    });

    if (start && existingContexts.length === 0) {
        await chrome.offscreen.createDocument({
            url: 'heartbeat.html',
            reasons: ['AUDIO_PLAYBACK'], 
            justification: 'Keep device awake for productivity session'
        });
    } else if (!start && existingContexts.length > 0) {
        await chrome.offscreen.closeDocument();
    }
}

function createPowerTimer(minutes, actions) {
    const endTime = Date.now() + (minutes * 60 * 1000);
    chrome.storage.local.set({ 
        kaTimer: { endTime, actions } 
    });
    chrome.alarms.create('kaTimerAlarm', { when: endTime });
}

function clearPowerTimer() {
    chrome.alarms.clear('kaTimerAlarm');
    chrome.storage.local.remove('kaTimer');
}


// ==========================================
// 🟢 KANBAN AND KA TIMER
// ==========================================
chrome.alarms.onAlarm.addListener(async (alarm) => {
    // ── Keep Awake Timer ─────────────────────────────────────────────────────
    if (alarm.name === 'kaTimerAlarm') {
        const data = await chrome.storage.local.get(['kaTimer']);
        if (data.kaTimer && data.kaTimer.actions) {
            const actions = data.kaTimer.actions;
            notify({
                id: 'ka_timer_ended', source: 'keepawake', title: 'Keep Awake timer ended',
                message: actions.resetMode ? 'Normal sleep settings are back.' : 'The timer has run out.'
            });

            if (actions.closeTab) {
                const audibleTabs = await chrome.tabs.query({ audible: true });
                if (audibleTabs.length > 0) {
                    chrome.tabs.remove(audibleTabs[0].id);
                } else {
                    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                    if (activeTabs.length > 0) chrome.tabs.remove(activeTabs[0].id);
                }
            }

            if (actions.resetMode) setPowerMode('default');
        }
        clearPowerTimer();
    }

    // ── Kanban Due Notifications ──────────────────────────────────────────────
    if (alarm.name.startsWith('kanban_due_')) {
        const data = await chrome.storage.local.get(['kanbanAlarms']);
        const title = (data.kanbanAlarms && data.kanbanAlarms[alarm.name]) ? data.kanbanAlarms[alarm.name] : 'A scheduled card';
        // The id is the alarm name (kanban_due_<cardId>): completing the card removes this entry (kanban.js).
        notify({ id: alarm.name, source: 'kanban', level: 'reminder', title: 'Card due now', message: title });
        if (data.kanbanAlarms) {
            delete data.kanbanAlarms[alarm.name];
            chrome.storage.local.set({ kanbanAlarms: data.kanbanAlarms });
        }
    }
});

// 🟢 BULK URL OPENER
// popup / bulk page / dock -> SW
//   { action: 'bulk_open_urls', urls: [lines of user text], target?, delayMs?, max?, sequential?, dedupe? }
//     target: 'tabs' | 'window' (one new window) | 'windowPerHost' | 'groupPerHost' (tab group per domain)
//             | 'windowPerUrl';  sequential: true is the dock's "one by one" (tabs, 1 s apart)
//   <- { ok: true, total, skipped: [lines], duplicates }   answered before the tabs open, so the sender may close
//      { ok: false, busy: true, error }                     a batch is still opening
//   { action: 'bulk_stop' } <- { ok: true }                 no URL that has not opened yet will open
// Progress for any open Bulk URL view: storage.session bulkJob
//   { id, state: 'running' | 'done' | 'stopped' | 'interrupted', target, total, opened, failed: [{ url, error }],
//     startedAt, endedAt? }
// One batch at a time, one URL after another (never hundreds of tab requests at once), parsed by the same
// MarquisUrlList the views use. Already opened tabs are not closed by Stop.
importScripts('/scripts/url_list.js');

let bulkJob = null; // { cancelled } while a batch runs in this worker

// A worker restart ends a running batch: say so instead of showing it as running forever.
chrome.storage.session.get('bulkJob').then(({ bulkJob: j }) => {
    if (j && j.state === 'running') chrome.storage.session.set({ bulkJob: { ...j, state: 'interrupted', endedAt: Date.now() } });
}).catch(() => {});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'bulk_stop') {
        if (bulkJob) bulkJob.cancelled = true;
        sendResponse({ ok: true });
        return false;
    }
    if (request.action !== 'bulk_open_urls') return false;
    if (bulkJob) {
        sendResponse({ ok: false, busy: true, error: 'A batch is still opening. Stop it or wait for it to finish.' });
        return false;
    }
    const urls = [], skipped = [], seen = new Set();
    let duplicates = 0;
    for (const line of Array.isArray(request.urls) ? request.urls.map(String) : []) {
        if (!line.trim()) continue;
        const { url } = MarquisUrlList.normalize(line);
        if (!url) { skipped.push(line.trim()); continue; }
        if (request.dedupe !== false && seen.has(url)) { duplicates++; continue; }
        seen.add(url);
        urls.push(url);
    }
    const max = Number(request.max) > 0 ? Number(request.max) : Infinity;
    const list = urls.slice(0, max);
    const target = request.sequential ? 'tabs' : (request.target || 'tabs');
    const delayMs = request.sequential ? 1000 : Math.min(600000, Math.max(0, Number(request.delayMs) || 0));
    sendResponse({ ok: true, total: list.length, skipped, duplicates });
    if (!list.length) return false;
    const job = bulkJob = { cancelled: false };
    runBulkJob(job, list, target, delayMs)
        .catch(err => console.warn('Bulk open stopped:', err))
        .finally(() => { if (bulkJob === job) bulkJob = null; });
    return false;
});

async function runBulkJob(job, urls, target, delayMs) {
    const status = { id: Date.now(), state: 'running', target, total: urls.length, opened: 0, failed: [], startedAt: Date.now() };
    const publish = () => chrome.storage.session.set({ bulkJob: status }).catch(() => {});
    await publish();
    const windows = new Map(), groups = new Map(); // group key -> window id / tab group id
    for (const [i, url] of urls.entries()) {
        if (i > 0 && delayMs) await workerSleep(delayMs, job);
        if (job.cancelled) break;
        try {
            await openOne(url, target, windows, groups);
            status.opened++;
        } catch (err) {
            status.failed.push({ url, error: err.message || String(err) });
        }
        await publish();
    }
    status.state = job.cancelled ? 'stopped' : 'done';
    status.endedAt = Date.now();
    await publish();
    // Long or failed batches end while the user is elsewhere: say how it went (no pop-up if the popup shows it).
    if (status.failed.length || delayMs || urls.length > 20) {
        const done = `${status.opened} of ${status.total} opened`;
        notify({
            id: `bulk_${status.id}`, source: 'bulk', level: status.failed.length ? 'error' : status.state === 'stopped' ? 'info' : 'success',
            title: status.state === 'stopped' ? 'Batch stopped' : status.failed.length ? 'Batch finished with errors' : 'Batch opened',
            message: status.failed.length ? `${done}, ${status.failed.length} failed.` : `${done}.`,
            silent: await popupIsOpen()
        });
    }
}

async function openOne(url, target, windows, groups) {
    if (target === 'windowPerUrl') return void await chrome.windows.create({ url });
    if (target === 'window' || target === 'windowPerHost') {
        const key = target === 'window' ? '' : MarquisUrlList.groupKey(url);
        if (windows.has(key)) {
            try { return void await chrome.tabs.create({ windowId: windows.get(key), url, active: false }); }
            catch { windows.delete(key); } // the user closed that window: start a new one
        }
        windows.set(key, (await chrome.windows.create({ url })).id);
        return;
    }
    const tab = await chrome.tabs.create({ url, active: false });
    if (target !== 'groupPerHost') return;
    const key = MarquisUrlList.groupKey(url);
    if (groups.has(key)) {
        try { return void await chrome.tabs.group({ groupId: groups.get(key), tabIds: tab.id }); }
        catch { groups.delete(key); } // the group was closed or ungrouped
    }
    const groupId = await chrome.tabs.group({ tabIds: tab.id });
    groups.set(key, groupId);
    await chrome.tabGroups.update(groupId, { title: key }).catch(() => {});
}

// Waits ms, or less once job.cancelled is set (checked every 250 ms). The worker is stopped after 30 s without
// events or extension API calls, so a long wait pings an API every 20 s (each call resets that timer, Chrome 110+).
async function workerSleep(ms, job) {
    const end = Date.now() + ms;
    let pinged = Date.now();
    while (Date.now() < end && !job?.cancelled) {
        await new Promise(r => setTimeout(r, Math.min(250, end - Date.now())));
        if (Date.now() - pinged >= 20000) { pinged = Date.now(); await chrome.runtime.getPlatformInfo(); }
    }
}

// ==========================================
// 🟢 DOCK "OPEN IN HUB" -> POPUP SECTION
// The popup reads marquisOpenSection on boot (script.js) and shows that section.
// ==========================================
const DOCK_TOOL_SECTIONS = { qa: 'qadevSection' };

chrome.runtime.onMessage.addListener((request, sender) => {
    if (request.action !== 'launch_tool') return;
    const section = DOCK_TOOL_SECTIONS[request.tool];
    if (!section || !sender.tab) return;

    chrome.storage.session.set({ marquisOpenSection: section }).then(() =>
        chrome.action.openPopup({ windowId: sender.tab.windowId })
    ).catch(() =>
        // openPopup can fail (unfocused window, older Chrome): show the hub in a popup-sized window instead.
        chrome.windows.create({ url: chrome.runtime.getURL('Marquis.html'), type: 'popup', width: 616, height: 640 })
    );
});

// ==========================================
// 🟢 NOTIFICATION ICON PADDER (Fixes OS Cropping)
// ==========================================
async function getPaddedIcon(imageUrl) {
    try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);
        
        // Create a virtual canvas
        const canvas = new OffscreenCanvas(256, 256);
        const ctx = canvas.getContext('2d');
        
        // Draw the image with a 50px transparent padding on all sides
        const pad = 50; 
        ctx.drawImage(bitmap, pad, pad, 256 - (pad * 2), 256 - (pad * 2));
        
        // Convert back to a Data URL that the OS can read
        const outBlob = await canvas.convertToBlob({ type: 'image/png' });
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(outBlob);
        });
    } catch (err) {
        console.error("Failed to pad icon:", err);
        return imageUrl; // Fallback to the original image if anything fails
    }
}