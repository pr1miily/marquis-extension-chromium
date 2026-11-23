// MARQUIS — fullpage.js: the page side of full-page capture. background.js injects it into the capture tab
// (isolated world) and drives it tile by tile through window.__marquisFullPage:
//   prepare()            measure, find the scroller, prepare the page, load lazy content; returns the size
//   shot(x, y, firstRow) scroll to a tile, wait until it settles, hide own UI; returns the measured position
//   hud(text)            show progress (with Cancel / Esc) between shots
//   cancel()             stop a running prepare()
//   restore()            undo everything (also run by a watchdog if the background stops talking to us)
// Nothing is kept: every style or attribute changed here is recorded and put back exactly in restore().
(() => {
    if (window.__marquisFullPage) return;

    const STYLE_ID = 'marquis-fullpage-style';
    const SCROLLER_ATTR = 'data-marquis-fp';
    const OWN_UI = ['marquis-floating-root', 'odh-capture-hud'];
    const WATCHDOG_MS = 20000;
    const LAZY = { stepWaitMs: 350, bottomWaitMs: 600, maxMs: 15000, maxGrowths: 4, maxHeight: 60000 };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

    let saved = null;     // what prepare() changed, for restore()
    let cancelled = false;
    let watchdog = 0;
    const touch = () => { clearTimeout(watchdog); watchdog = setTimeout(() => api.restore(), WATCHDOG_MS); };

    const docScroller = () => document.scrollingElement || document.documentElement;
    const isOwnUi = (el) => OWN_UI.some((id) => el.id === id || el.closest?.('#' + id));

    // Largest visible element that scrolls vertically: web apps (mail, dashboards) whose document does not scroll.
    function findInnerScroller() {
        let best = null, bestArea = 0;
        const vw = innerWidth, vh = innerHeight;
        for (const el of document.querySelectorAll('body *')) {
            if (el.scrollHeight <= el.clientHeight + 8 || el.clientHeight < vh * 0.3) continue;
            if (!/^(auto|scroll|overlay)$/.test(getComputedStyle(el).overflowY)) continue;
            const r = el.getBoundingClientRect();
            const area = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
            if (area > bestArea) { best = el; bestArea = area; }
        }
        return bestArea >= vw * vh * 0.25 ? best : null;
    }

    // Size of the scrolled content and of the visible part, in CSS px. fullW/fullH include the reachable extent
    // found by actually scrolling (reachW/reachH), not only scrollHeight, which some layouts misreport.
    function measure() {
        const s = saved.scroller;
        const base = { innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio };
        if (saved.mode === 'element') {
            const r = s.getBoundingClientRect();
            return { ...base, mode: 'element', fullW: Math.max(s.scrollWidth, saved.reachW), fullH: Math.max(s.scrollHeight, saved.reachH),
                viewW: s.clientWidth, viewH: s.clientHeight, clipX: r.left + s.clientLeft, clipY: r.top + s.clientTop, x: s.scrollLeft, y: s.scrollTop };
        }
        const d = document.documentElement;
        return { ...base, mode: 'window', fullW: Math.max(s.scrollWidth, d.clientWidth, saved.reachW), fullH: Math.max(s.scrollHeight, d.clientHeight, saved.reachH),
            viewW: d.clientWidth, viewH: d.clientHeight, clipX: 0, clipY: 0, x: scrollX, y: scrollY };
    }

    function scrollToPos(x, y) {
        if (saved.mode === 'element') saved.scroller.scrollTo({ left: x, top: y, behavior: 'instant' });
        else window.scrollTo({ left: x, top: y, behavior: 'instant' });
    }

    // Wait until the scroll position and height hold for two frames and the images in view have loaded (bounded).
    async function settle(maxMs) {
        const t0 = performance.now();
        let last = null, still = 0;
        while (performance.now() - t0 < maxMs) {
            await frame();
            const m = measure();
            const key = `${m.x},${m.y},${m.fullH}`;
            still = key === last ? still + 1 : 0;
            last = key;
            if (still >= 2 && imagesInViewLoaded(m)) return;
        }
    }
    function imagesInViewLoaded(m) {
        for (const img of document.images) {
            if (img.complete) continue;
            const r = img.getBoundingClientRect();
            if (r.width && r.height && r.bottom > m.clipY && r.top < m.clipY + m.viewH && r.right > m.clipX && r.left < m.clipX + m.viewW) return false;
        }
        return true;
    }

    // An element's style attribute is recorded once, before its first change, and put back as it was.
    function keepStyle(el) { if (!saved.styles.has(el)) saved.styles.set(el, el.getAttribute('style')); }
    function setStyle(el, prop, value) { keepStyle(el); el.style.setProperty(prop, value, 'important'); }

    // Sticky elements become plain in-flow boxes (relative, no offset): they appear once, where they belong,
    // instead of in every tile. Fixed backgrounds scroll with the page so tiles join without seams.
    // Fixed elements: page headers (top half) show in the first row only; floating widgets (bottom half:
    // chat buttons, cookie bars) are hidden because they would cover content; full-screen layers are kept.
    function scanFloating() {
        const top = [], floating = [];
        const vw = innerWidth, vh = innerHeight;
        for (const el of document.querySelectorAll('body *')) {
            if (isOwnUi(el)) continue;
            const cs = getComputedStyle(el);
            if (cs.position === 'sticky') { setStyle(el, 'position', 'relative'); setStyle(el, 'inset', 'auto'); continue; }
            if (cs.backgroundAttachment.includes('fixed')) setStyle(el, 'background-attachment', 'scroll');
            if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' && !saved.hiddenTop.has(el)) continue;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || (r.height >= vh * 0.5 && r.width >= vw * 0.5)) continue;
            (r.top + r.height / 2 < vh / 2 ? top : floating).push(el);
        }
        for (const el of [document.documentElement, document.body]) {
            if (el && getComputedStyle(el).backgroundAttachment.includes('fixed')) setStyle(el, 'background-attachment', 'scroll');
        }
        return { top, floating };
    }
    function applyFloating(showTop) {
        const { top, floating } = scanFloating(); // re-scanned each tile: pages add or re-show bars while scrolling
        for (const el of floating) setStyle(el, 'visibility', 'hidden');
        for (const el of top) {
            if (!showTop) { setStyle(el, 'visibility', 'hidden'); saved.hiddenTop.add(el); }
            else if (saved.hiddenTop.delete(el)) el.style.removeProperty('visibility');
        }
    }
    function setOwnUiVisible(visible) {
        for (const id of OWN_UI) { const el = document.getElementById(id); if (el) el.style.visibility = visible ? '' : 'hidden'; }
    }

    // Scroll through the page once so lazy images and appended sections load. Stops at the bottom once the
    // height holds, and never follows an endless feed past the limits (reported back as notes).
    async function loadLazyContent() {
        const t0 = performance.now();
        let y = 0, growths = 0;
        for (;;) {
            if (cancelled) throw new Error('cancelled');
            scrollToPos(0, y);
            await settle(LAZY.stepWaitMs);
            const m = measure();
            saved.reachH = Math.max(saved.reachH, m.y + m.viewH);
            const atBottom = m.y + m.viewH >= m.fullH - 1 || m.y < y - 1; // could not scroll further
            if (atBottom) {
                await sleep(LAZY.bottomWaitMs);
                if (measure().fullH <= m.fullH + 1) break;   // height held: done
                if (++growths >= LAZY.maxGrowths) { saved.notes.push('growing'); break; }
            }
            if (m.fullH > LAZY.maxHeight) { saved.notes.push('limit'); break; }
            if (performance.now() - t0 > LAZY.maxMs) { saved.notes.push('slow'); break; }
            y = m.y + m.viewH;
        }
        // Reachable width too (wide pages), then back to the top-left corner.
        scrollToPos(1e7, 0);
        await settle(200);
        const right = measure();
        saved.reachW = Math.max(saved.reachW, right.x + right.viewW);
        scrollToPos(0, 0);
        await settle(1500);
    }

    function frameInfo() {
        let sameOrigin = 0, crossOrigin = 0;
        for (const f of document.querySelectorAll('iframe, frame')) {
            const r = f.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            try { f.contentDocument ? sameOrigin++ : crossOrigin++; } catch { crossOrigin++; }
        }
        return { sameOrigin, crossOrigin };
    }

    function pageBackground() {
        for (const el of [document.body, document.documentElement]) {
            const bg = el && getComputedStyle(el).backgroundColor;
            if (bg && bg !== 'transparent' && !/,\s*0\)$/.test(bg)) return bg;
        }
        return '#ffffff';
    }

    const api = {
        async prepare() {
            touch();
            cancelled = false;
            if (document.contentType === 'application/pdf') return { pdf: true };
            if (saved) api.restore();
            const sel = getSelection();
            const se = docScroller();
            const inner = se.scrollHeight - se.clientHeight < innerHeight * 0.5 ? findInnerScroller() : null;
            saved = {
                mode: inner ? 'element' : 'window', scroller: inner || se,
                scroll: { x: scrollX, y: scrollY, ix: inner?.scrollLeft || 0, iy: inner?.scrollTop || 0 },
                styles: new Map(), hiddenTop: new Set(), lazy: [], notes: [], reachW: 0, reachH: 0, onKey: null,
                focus: document.activeElement, ranges: Array.from({ length: sel.rangeCount }, (_, i) => sel.getRangeAt(i).cloneRange()),
            };
            if (inner) inner.setAttribute(SCROLLER_ATTR, '');
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = `html, body, [${SCROLLER_ATTR}] { scroll-behavior: auto !important; scroll-snap-type: none !important; scrollbar-width: none !important; }
html::-webkit-scrollbar, body::-webkit-scrollbar, [${SCROLLER_ATTR}]::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
*, *::before, *::after { transition: none !important; caret-color: transparent !important; }`;
            (document.head || document.documentElement).appendChild(style);
            for (const el of document.querySelectorAll('img[loading="lazy"], iframe[loading="lazy"]')) { saved.lazy.push(el); el.setAttribute('loading', 'eager'); }
            await Promise.race([document.fonts?.ready, sleep(1000)]);
            applyFloating(true);
            try { await loadLazyContent(); } catch (err) { if (cancelled) return { cancelled: true }; throw err; }
            return { ...measure(), frames: frameInfo(), notes: saved.notes, bg: pageBackground() };
        },

        async shot(x, y, firstRow) {
            touch();
            applyFloating(firstRow);
            scrollToPos(x, y);
            await settle(1500);
            setOwnUiVisible(false);
            await frame(); await frame(); // own UI gone from the frame the capture reads
            return measure();
        },

        hud(text) {
            touch();
            let host = document.getElementById('odh-capture-hud');
            if (!host) {
                host = document.createElement('div');
                host.id = 'odh-capture-hud';
                host.style.cssText = 'position:fixed;top:24px;right:24px;z-index:2147483647;';
                const root = host.attachShadow({ mode: 'open' });
                root.innerHTML = `<style>
.hud{display:flex;align-items:center;gap:12px;padding:8px 8px 8px 16px;border-radius:999px;background:rgba(15,23,42,.95);color:#f8fafc;
 font:600 13px system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.15)}
.spin{width:14px;height:14px;border:3px solid #6366f1;border-top-color:transparent;border-radius:50%;animation:s 1s linear infinite}
button{all:unset;cursor:pointer;padding:4px 12px;border-radius:999px;background:rgba(255,255,255,.14);font:600 12px system-ui,sans-serif}
button:hover,button:focus-visible{background:rgba(255,255,255,.26)} @keyframes s{to{transform:rotate(360deg)}}</style>
<div class="hud" role="status"><div class="spin"></div><span id="t"></span><button type="button" title="Cancel (Esc)">Cancel</button></div>`;
                const cancel = () => chrome.runtime.sendMessage({ action: 'captureCancel' }).catch(() => {});
                root.querySelector('button').addEventListener('click', cancel);
                if (saved) {
                    saved.onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } };
                    addEventListener('keydown', saved.onKey, true);
                }
                document.documentElement.appendChild(host);
            }
            host.shadowRoot.getElementById('t').textContent = text;
            setOwnUiVisible(true);
        },

        cancel() { cancelled = true; },

        restore() {
            clearTimeout(watchdog);
            document.getElementById('odh-capture-hud')?.remove();
            if (!saved) return;
            const s = saved;
            saved = null;
            const steps = [
                () => document.getElementById(STYLE_ID)?.remove(),
                () => s.onKey && removeEventListener('keydown', s.onKey, true),
                () => s.styles.forEach((orig, el) => (orig === null ? el.removeAttribute('style') : el.setAttribute('style', orig))),
                () => s.lazy.forEach((el) => el.setAttribute('loading', 'lazy')),
                () => s.scroller.removeAttribute(SCROLLER_ATTR),
                () => { if (s.mode === 'element') s.scroller.scrollTo({ left: s.scroll.ix, top: s.scroll.iy, behavior: 'instant' }); },
                () => window.scrollTo({ left: s.scroll.x, top: s.scroll.y, behavior: 'instant' }),
                () => { if (s.focus && s.focus !== document.body && s.focus.isConnected) s.focus.focus({ preventScroll: true }); },
                () => { if (s.ranges.length) { const sel = getSelection(); sel.removeAllRanges(); s.ranges.forEach((r) => sel.addRange(r)); } },
            ];
            for (const step of steps) { try { step(); } catch { /* restore as much as possible */ } }
            setOwnUiVisible(true);
        },
    };
    window.__marquisFullPage = api;
})();
