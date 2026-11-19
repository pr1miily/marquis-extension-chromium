// Handle clicks on Notifications
if (chrome.notifications && chrome.notifications.onClicked) {
    chrome.notifications.onClicked.addListener((notifId) => {
        // Clear Keep Awake OR Kanban notifications when clicked
        if (notifId === 'ka_timer_ended' || notifId === 'focus_timer_ended' || notifId.startsWith('kanban_due_')) {
            chrome.notifications.clear(notifId); 
        }
    });
}

// ==========================================
// 📸 SCREENSHOT CAPTURE ENGINE
// ==========================================
//
// Message contract
//   popup / dock -> SW  { action: 'capture', type: 'visible' | 'full' | 'region', tabId? }
//                <- SW  { ok: true, id }        saved to CaptureStore, preview.html?id= opened
//                       { ok: true, id: null }  region selection cancelled
//                       { ok: false, error }    nothing saved; error is user-readable
//   page.js      -> SW  { msg: 'capture', x, y, complete, windowWidth, windowHeight, totalWidth, totalHeight }
//                <- SW  true = tile stored, scroll on; false = stop
//
// Lifecycle: idle -> (selecting) -> capturing -> saving -> idle. `_capture` is the lock and the only
// capture state; it is claimed synchronously and always released in runCapture's finally.

importScripts('/scripts/capture_store.js');

const CAPTURE_TYPES = ['visible', 'full', 'region'];
const TILE_INTERVAL_MS = 550; // Chrome allows 2 captureVisibleTab calls per second
let _capture = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.msg === 'capture') {
        const c = _capture;
        if (!c || c.type !== 'full' || sender.tab?.id !== c.tabId) return false;
        captureTile(c, request).then(() => sendResponse(true), (err) => { c.error = err; sendResponse(false); });
        return true;
    }
    if (request.action === 'capture') {
        if (!CAPTURE_TYPES.includes(request.type)) return false;
        const tabId = Number.isInteger(request.tabId) ? request.tabId : null;
        runCapture(request.type, tabId, sender).then(
            (id) => sendResponse({ ok: true, id }),
            (err) => sendResponse({ ok: false, error: err.message || String(err) })
        );
        return true;
    }
    return false;
});

async function runCapture(type, tabId, sender) {
    if (_capture) throw new Error('Another capture is still running. Wait for it to finish.');
    _capture = { type };
    let tab = null;
    try {
        tab = tabId ? await chrome.tabs.get(tabId)
            : sender.tab || (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
        if (!tab) throw new Error('No tab to capture.');
        if (!tab.url || !isUrlAllowed(tab.url)) throw new Error('Chrome does not allow capturing this page.');
        Object.assign(_capture, { tabId: tab.id, windowId: tab.windowId });
        chrome.action.setBadgeText({ text: '', tabId: tab.id }); // clear an ERR left by a previous failure

        await chrome.tabs.update(tab.id, { active: true });
        if (type !== 'visible') await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
        await sleep(300);

        let blob;
        if (type === 'full') {
            blob = await captureFullPage(_capture, tab);
        } else {
            const rect = type === 'region' ? await selectRegion(tab.id) : null;
            if (type === 'region' && !rect) return null;
            blob = await captureViewport(tab, rect);
        }

        const bmp = await createImageBitmap(blob);
        const record = { type, createdAt: Date.now(), title: tab.title || '', url: tab.url, width: bmp.width, height: bmp.height, blob, thumb: await makeThumb(bmp) };
        bmp.close();
        const id = await CaptureStore.add(record);
        await chrome.tabs.create({ url: chrome.runtime.getURL(`preview.html?id=${id}`), windowId: tab.windowId, index: tab.index + 1, openerTabId: tab.id });
        return id;
    } catch (err) {
        console.error('Capture error:', err);
        if (tab) {
            chrome.action.setBadgeText({ text: 'ERR', tabId: tab.id });
            chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId: tab.id });
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

async function captureFullPage(c, tab) {
    c.tiles = [];
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1', tabId: tab.id });
    chrome.action.setBadgeText({ text: 'SCAN', tabId: tab.id });
    try {
        const [{ result: bg } = {}] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                if (!document.getElementById('odh-capture-hud')) {
                    const hud = document.createElement('div');
                    hud.id = 'odh-capture-hud';
                    hud.style.cssText = 'position: fixed; top: 30px; right: 30px; z-index: 2147483647; background: rgba(15, 23, 42, 0.95); color: #f8fafc; padding: 12px 24px; border-radius: 50px; font-family: system-ui, sans-serif; font-size: 14px; font-weight: bold; box-shadow: 0 10px 30px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 12px; border: 1px solid rgba(255,255,255,0.15); pointer-events: none;';
                    hud.innerHTML = '<div style="width:18px;height:18px;border:3px solid #6366f1;border-top-color:transparent;border-radius:50%;animation:odh-spin 1s linear infinite;"></div><span id="odh-capture-progress">Scanning... 0%</span><style>@keyframes odh-spin{to{transform:rotate(360deg);}}</style>';
                    document.body.appendChild(hud);
                }
                return getComputedStyle(document.body).backgroundColor;
            }
        });
        const bgColor = !bg || bg === 'transparent' || /,\s*0\)$/.test(bg) ? '#ffffff' : bg;

        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['scripts/page.js'] });
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Capture timed out after 3 minutes.')), 180000);
            chrome.tabs.sendMessage(tab.id, { msg: 'scrollPage' }, () => {
                clearTimeout(timeout);
                const err = chrome.runtime.lastError;
                err ? reject(new Error(err.message)) : resolve();
            });
        });

        if (c.error) throw c.error;
        if (!c.tiles.length) throw new Error('No part of the page could be captured.');
        return await stitchTiles(c.tiles, c.size, bgColor);
    } finally {
        chrome.action.setBadgeText({ text: '', tabId: tab.id });
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                document.getElementById('odh-capture-hud')?.remove();
                delete window._marquisPageCapturing;
            }
        }).catch(() => {});
    }
}

async function captureTile(c, req) {
    c.size = { windowWidth: req.windowWidth, totalWidth: req.totalWidth, totalHeight: req.totalHeight };
    await setOwnUiHidden(c.tabId, true, `Scanning... ${Math.round(req.complete * 100)}%`);
    try {
        const wait = TILE_INTERVAL_MS - (Date.now() - (c.lastShot || 0));
        if (wait > 0) await sleep(wait);
        let dataUrl;
        try {
            dataUrl = await captureVisibleTab(c.windowId);
        } catch {
            await sleep(TILE_INTERVAL_MS); // quota hiccup: one retry, then fail loudly instead of leaving a gap
            dataUrl = await captureVisibleTab(c.windowId);
        }
        c.lastShot = Date.now();
        c.tiles.push({ blob: await dataUrlToBlob(dataUrl), x: req.x, y: req.y });
    } finally {
        if (req.complete < 1) await setOwnUiHidden(c.tabId, false);
    }
}

// Tiles are { blob, x, y } at CSS-px scroll offsets; output is one PNG in device px (capped at 32000 px a side).
async function stitchTiles(tiles, { windowWidth, totalWidth, totalHeight }, bgColor) {
    const bitmaps = await Promise.all(tiles.map(t => createImageBitmap(t.blob)));
    try {
        const dpr = bitmaps[0].width / windowWidth;
        const MAX_DIM = 32000;
        let w = Math.round(totalWidth * dpr), h = Math.round(totalHeight * dpr), scale = 1;
        if (w > MAX_DIM || h > MAX_DIM) {
            scale = Math.min(MAX_DIM / w, MAX_DIM / h);
            w = Math.floor(w * scale);
            h = Math.floor(h * scale);
        }
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = scale !== 1; // unscaled seams stay pixel-exact
        tiles.forEach((t, i) => {
            const b = bitmaps[i];
            ctx.drawImage(b, Math.floor(t.x * dpr * scale), Math.floor(t.y * dpr * scale), b.width * scale, b.height * scale);
        });
        return await canvas.convertToBlob({ type: 'image/png' });
    } finally {
        bitmaps.forEach(b => b.close());
    }
}

function isUrlAllowed(url) {
  return !['chrome://', 'chrome-extension://', 'edge://', 'about:'].some(p => url.startsWith(p));
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
    const win = await chrome.windows.create({ url: chrome.runtime.getURL(`recorder.html?${params}`), type: 'popup', width: 400, height: 680, focused: true });
    await chrome.storage.session.set({ recorderWindowId: win.id });
}

chrome.windows.onRemoved.addListener(async (windowId) => {
    const { recorderWindowId } = await chrome.storage.session.get('recorderWindowId');
    if (windowId !== recorderWindowId) return;
    await chrome.storage.session.remove('recorderWindowId');
    chrome.action.setBadgeText({ text: '' }); // the window can't clear REC itself when it is closed mid-recording
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

async function notifyFocusEnded(mode) {
    chrome.notifications.create('focus_timer_ended', {
        type: 'basic',
        iconUrl: await getPaddedIcon(chrome.runtime.getURL('img/46087a1c-4b4d-4a36-a268-1b57cb06908c.png')),
        title: 'Marquis Focus Timer',
        message: mode === 'focus' ? 'Focus session complete! Take a break.' : 'Break is over! Back to work.',
        priority: 2
    });
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
const DOCK_FILES = ['scripts/safe_html.js', 'scripts/kanban_store.js', 'scripts/focus_timer.js', 'scripts/mq_float.js', 'scripts/inject_dock.js'];

chrome.runtime.onMessage.addListener((request, sender) => {
    if (request.action !== 'injectDock' || !sender.tab) return;
    chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [sender.frameId] }, files: DOCK_FILES })
        .catch(err => console.warn('Dock injection skipped:', err.message));
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
        (err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
});

// Same refusal list as isAllowedUrl in scripts/workspace.js.
const isWorkspaceUrl = (url) => !!url && !['chrome://', 'chrome-extension://', 'edge://', 'about:', 'file://'].some(p => url.startsWith(p));

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
        const data = await chrome.storage.local.get(['kaTimer', 'marquisNotifications', 'unreadNotifCount']);
        if (data.kaTimer && data.kaTimer.actions) {
            const actions = data.kaTimer.actions;
            const safeIcon = await getPaddedIcon(chrome.runtime.getURL('img/46087a1c-4b4d-4a36-a268-1b57cb06908c.png'));

            chrome.notifications.create('ka_timer_ended', {
                type: 'basic',
                iconUrl: safeIcon,
                title: 'Power Session Ended',
                message: 'Your Keep Awake timer has expired and settings have been reset.',
                priority: 2
            });

            let notifs = data.marquisNotifications || [];
            let unreadCount = data.unreadNotifCount || 0;
            notifs.unshift({
                id: Date.now(),
                title: `Timer Complete`,
                message: `Your power session has ended and normal sleep settings have been restored.`,
                type: "info",
                isRead: false,
                date: new Date().toISOString(),
                source: "keepawake"
            });
            if (notifs.length > 50) notifs = notifs.slice(0, 50);

            chrome.storage.local.set({ marquisNotifications: notifs, unreadNotifCount: unreadCount + 1 });

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
        const data = await chrome.storage.local.get(['kanbanAlarms', 'marquisNotifications', 'unreadNotifCount']);
        const title = (data.kanbanAlarms && data.kanbanAlarms[alarm.name]) ? data.kanbanAlarms[alarm.name] : 'A scheduled task';
        const safeIcon = await getPaddedIcon(chrome.runtime.getURL('img/46087a1c-4b4d-4a36-a268-1b57cb06908c.png'));

        chrome.notifications.create(alarm.name, {
            type: 'basic',
            iconUrl: safeIcon,
            title: 'Task Deadline Reached!',
            message: `Your task "${title}" is now due.`,
            priority: 2,
            requireInteraction: true
        });

        chrome.action.getBadgeText({}, (currentText) => {
            let count = parseInt(currentText) || 0;
            chrome.action.setBadgeText({ text: (count + 1).toString() });
            chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
        });

        let notifs = data.marquisNotifications || [];
        let unreadCount = data.unreadNotifCount || 0;
        notifs.unshift({
            id: Date.now(),
            title: `Deadline Reached`,
            message: `Your task "${title}" is now due.`,
            type: "info",
            isRead: false,
            date: new Date().toISOString(),
            source: "kanban"
        });
        if (notifs.length > 50) notifs = notifs.slice(0, 50);

        const updateData = { marquisNotifications: notifs, unreadNotifCount: unreadCount + 1 };
        if (data.kanbanAlarms) {
            delete data.kanbanAlarms[alarm.name];
            updateData.kanbanAlarms = data.kanbanAlarms;
        }
        chrome.storage.local.set(updateData);
    }
});

// 🟢 BULK URL OPENER
// popup / bulk page / dock -> SW
//   { action: 'bulk_open_urls', urls: [lines of user text], target?: 'tabs' | 'window' | 'windowPerUrl' | 'windowPerHost',
//     delayMs?, max?, sequential? }   (sequential: true is the dock's "one by one" = tabs, 1 s apart)
//   <- { ok: true, opened, skipped: [lines] }   answered before the tabs open, so the sender may close
// Opening happens here so a closing popup cannot cut a slow list short.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'bulk_open_urls') return false;
    const lines = Array.isArray(request.urls) ? request.urls.map(String) : [];
    const urls = [], skipped = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const url = toHttpUrl(line);
        if (url) urls.push(url); else skipped.push(line.trim());
    }
    const max = Number(request.max) > 0 ? Number(request.max) : Infinity;
    const list = urls.slice(0, max);
    const target = request.target || 'tabs';
    const delayMs = request.sequential ? 1000 : Math.max(0, Number(request.delayMs) || 0);
    sendResponse({ ok: true, opened: list.length, skipped });
    bulkOpen(list, target, delayMs).catch(err => console.warn('Bulk open stopped:', err));
    return false;
});

// One line of user text -> an http(s) URL, or null. Bare hosts ("example.com/x", "localhost:3000") get http://.
function toHttpUrl(line) {
    const s = String(line).trim();
    if (!s || /^(javascript|data|vbscript|blob|about|mailto|file|chrome|chrome-extension|edge):/i.test(s)) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) return null;
    try {
        const url = new URL(/^https?:\/\//i.test(s) ? s : `http://${s}`);
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url.href : null;
    } catch (err) {
        return null;
    }
}

async function bulkOpen(urls, target, delayMs) {
    if (!urls.length) return;
    if (target === 'window') return void await chrome.windows.create({ url: urls });
    if (target === 'windowPerHost') {
        const byHost = new Map();
        for (const url of urls) {
            const host = new URL(url).hostname;
            byHost.set(host, [...(byHost.get(host) || []), url]);
        }
        for (const group of byHost.values()) await chrome.windows.create({ url: group });
        return;
    }
    for (const [i, url] of urls.entries()) {
        if (i > 0 && delayMs) await workerSleep(delayMs);
        try {
            if (target === 'windowPerUrl') await chrome.windows.create({ url });
            else await chrome.tabs.create({ url, active: false });
        } catch (err) {
            console.warn('Bulk open skipped', url, err.message);
        }
    }
}

// Waits ms. The worker is stopped after 30 s without events or extension API calls, so a long wait pings
// an API every 20 s (each call resets that timer, Chrome 110+) and a slow list is not cut short.
async function workerSleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        await new Promise(r => setTimeout(r, Math.min(20000, end - Date.now())));
        await chrome.runtime.getPlatformInfo();
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