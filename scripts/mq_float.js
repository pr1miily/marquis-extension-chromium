// MarquisFloat: the one floating-panel system for Marquis (popup, full-screen pages, the dock's shadow DOM).
// No dependencies; Bootstrap is optional (used only to dispose a Bootstrap dropdown that menu() takes over).
//
//   place(anchor, panel, opts)      fixed positioning: flips above/below, clamps to the viewport, caps height
//   menu(trigger, content, opts)    action menu (WAI-ARIA menu button). content: item array or an existing .dropdown-menu
//   select(selectEl, opts)          themed listbox for a native <select> (WAI-ARIA select-only combobox).
//                                   The <select> stays in the DOM, hidden, as the source of truth: its value,
//                                   'change'/'input' events, form data and the scripts that read it are unchanged.
//   popover(trigger, panelEl, opts) floating panel with any content (checkbox lists, colour grids); closes on outside
//                                   click / Escape, and on an inside button click unless data-bs-auto-close="outside"
//   enhanceAll(root, opts)          select() every eligible <select>, and menu()/popover() every Bootstrap
//                                   [data-bs-toggle="dropdown"], under root, now and when added later
//   close()                         close whichever panel is open
//   <script src=".../mq_float.js" data-enhance>  runs enhanceAll(document) on DOMContentLoaded
//
// Panels render in a top layer (the trigger's .modal, its shadow root, or <body>) so card overflow, transforms and
// backdrop-filter never clip or offset them. Colours come only from the --mq-* theme tokens, so an open panel
// follows a theme change immediately.
(() => {
    if (globalThis.MarquisFloat) return;

    const CSS = `
.mq-select-native{display:none!important}
.mq-select{display:flex;align-items:center;gap:8px;width:100%;min-width:0;min-height:calc(var(--mq-fs-base,14px)*1.5 + 2*var(--mq-ctl-py,5px) + 2px);
 padding:var(--mq-ctl-py,5px) var(--mq-ctl-px,10px);font:inherit;font-size:var(--mq-fs-base,14px);line-height:1.5;text-align:start;
 color:var(--mq-text,var(--bs-body-color,#212529));background:var(--mq-bg,var(--bs-body-bg,#fff));border:1px solid var(--mq-border,var(--bs-border-color,#dee2e6));
 border-radius:var(--mq-radius,6px);cursor:pointer}
.mq-select.mq-select-sm{min-height:calc(var(--mq-fs-sm,13px)*1.5 + 2*var(--mq-ctl-sm-py,4px) + 2px);padding:var(--mq-ctl-sm-py,4px) var(--mq-ctl-sm-px,8px);font-size:var(--mq-fs-sm,13px)}
.mq-select:hover:not(:disabled){border-color:color-mix(in srgb,var(--mq-border,#dee2e6) 70%,var(--mq-text,#212529))}
.mq-select:disabled{opacity:.6;cursor:default}
.mq-select:focus-visible{outline:2px solid var(--mq-focus,var(--bs-primary,#0d6efd));outline-offset:-2px}
.input-group>.mq-select{flex:1 1 auto;width:1%;min-width:0}
.input-group>.mq-select-native:first-child+.mq-select{margin-left:0!important;border-top-left-radius:var(--mq-radius,6px)!important;border-bottom-left-radius:var(--mq-radius,6px)!important}
.mq-select-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mq-select-value.is-placeholder{color:var(--mq-text-muted,#6c757d)}
.mq-select-caret{flex:none;width:12px;height:12px;color:var(--mq-text-2,currentColor);transition:transform 120ms}
.mq-select[aria-expanded="true"] .mq-select-caret{transform:rotate(180deg)}
.mq-float{position:fixed;z-index:var(--mq-float-z,1075);pointer-events:auto;display:block;box-sizing:border-box;min-width:160px;max-width:calc(100vw - 16px);margin:0;padding:4px;overflow:auto;overscroll-behavior:contain;
 list-style:none;font-size:var(--mq-fs-base,14px);line-height:1.4;text-align:start;color:var(--mq-text,var(--bs-body-color,#212529));
 background:var(--mq-surface,var(--bs-body-bg,#fff));border:1px solid var(--mq-border-subtle,var(--bs-border-color,#dee2e6));
 border-radius:var(--mq-radius-lg,8px);box-shadow:var(--mq-shadow-2,0 10px 28px rgb(0 0 0 / .2));animation:mq-float-in 120ms ease-out}
.mq-float[hidden]{display:none!important}
.mq-float[data-side="top"]{animation-name:mq-float-in-up}
@keyframes mq-float-in{from{opacity:0;transform:translateY(-4px)}}
@keyframes mq-float-in-up{from{opacity:0;transform:translateY(4px)}}
.mq-float-item,.mq-float .dropdown-item{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;padding:6px 10px;border:0;
 border-radius:var(--mq-radius-sm,4px);background:none;color:inherit;font:inherit;text-align:start;text-decoration:none;white-space:normal;cursor:pointer}
.mq-float-item:hover,.mq-float-item.is-active,.mq-float .dropdown-item:hover,.mq-float .dropdown-item:focus{background:var(--mq-hover,rgb(0 0 0 / .06));color:inherit;outline:none}
.mq-float-item:focus-visible,.mq-float .dropdown-item:focus-visible{outline:2px solid var(--mq-focus,#0d6efd);outline-offset:-2px;box-shadow:none}
.mq-float .dropdown-item.active,.mq-float .dropdown-item:active{background:var(--mq-selected,rgb(13 110 253 / .15));color:inherit}
.mq-float-item[aria-selected="true"]{font-weight:600}
.mq-float-item[aria-disabled="true"],.mq-float .dropdown-item.disabled{opacity:.5;cursor:default;background:none}
.mq-float-item.is-danger{color:var(--mq-danger,#dc3545)}
.mq-float-icon{flex:none;width:16px;text-align:center;color:var(--mq-text-2,currentColor)}
.mq-float-tile{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:var(--mq-radius-lg,8px);font-size:12px;
 color:color-mix(in srgb,var(--tile) 65%,var(--mq-text,currentColor));background:color-mix(in srgb,var(--tile) 20%,var(--mq-surface,#fff))}
.mq-float-text{flex:1;min-width:0}
.mq-float-desc{display:block;font-size:var(--mq-fs-xs,12px);font-weight:400;color:var(--mq-text-muted,#6c757d)}
.mq-float-check{flex:none;width:14px;height:14px;margin-inline-start:auto;color:var(--mq-accent,#0d6efd);visibility:hidden}
.mq-float-item[aria-selected="true"] .mq-float-check{visibility:visible}
.mq-float-header,.mq-float .dropdown-header{display:block;padding:6px 10px 4px;font-size:var(--mq-fs-xs,12px);font-weight:700;letter-spacing:.04em;
 text-transform:uppercase;color:var(--mq-text-muted,#6c757d)}
.mq-float-divider,.mq-float .dropdown-divider{height:0;margin:4px 0;border:0;border-top:1px solid var(--mq-divider,#dee2e6);opacity:1}
.mq-listbox{display:flex;flex-direction:column;overflow:hidden}
.mq-listbox>[role="listbox"]{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain}
.mq-float-search{flex:none;margin:-4px -4px 4px;padding:6px;border-bottom:1px solid var(--mq-divider,#dee2e6)}
.mq-float-search input{box-sizing:border-box;width:100%;padding:4px 8px;font:inherit;font-size:var(--mq-fs-sm,13px);color:inherit;
 background:var(--mq-bg,#fff);border:1px solid var(--mq-border,#dee2e6);border-radius:var(--mq-radius-sm,4px);outline-offset:-2px}
.mq-float-empty{padding:8px 10px;font-size:var(--mq-fs-sm,13px);color:var(--mq-text-muted,#6c757d)}
@media (prefers-reduced-motion:reduce){.mq-float{animation:none}.mq-select-caret{transition:none}}`;

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const icon = (cls, d, viewBox = '0 0 16 16') => {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', cls);
        svg.setAttribute('viewBox', viewBox);
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
        return svg;
    };
    const CARET = 'M3 6l5 5 5-5';
    const CHECK = 'M3 8.5l3.5 3.5L13 5';

    let uid = 0;
    const nextId = (p) => `mq-${p}-${++uid}`;

    // One <style> per tree: document.head, or each shadow root a panel or trigger lives in.
    const styled = new WeakSet();
    function ensureStyle(node) {
        const root = node.getRootNode();
        const key = root instanceof ShadowRoot ? root : document;
        if (styled.has(key)) return;
        const style = document.createElement('style');
        style.dataset.mqFloat = '';
        style.textContent = CSS;
        (key === document ? document.head : key).appendChild(style);
        styled.add(key);
    }

    // Top layer for a panel: inside an open .modal (Bootstrap's focus trap must keep seeing the focus),
    // else the trigger's shadow root, else <body>.
    function layerFor(trigger) {
        const modal = trigger.closest('.modal');
        if (modal) return modal;
        const root = trigger.getRootNode();
        return root instanceof ShadowRoot ? root : document.body;
    }

    // ---------- positioning ----------
    let grownPopup = null; // body.popup-mode min-height we set so a panel fits; restored on close

    function place(anchor, panel, { placement = 'bottom-start', offset = 4, margin = 8, matchWidth = false, maxHeight = 320 } = {}) {
        const a = anchor.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        let vh = window.innerHeight;
        panel.style.minWidth = matchWidth ? `${Math.round(a.width)}px` : '';
        panel.style.maxHeight = `${maxHeight}px`;
        panel.style.left = '0px';
        panel.style.top = '0px';
        const wanted = panel.offsetHeight;

        // The extension popup sizes itself to <body>; grow it (up to Chrome's 600px cap) instead of squeezing the list.
        const body = document.body;
        if (body.classList.contains('popup-mode') && wanted > Math.max(vh - a.bottom, a.top) - offset - margin && vh < 600) {
            if (grownPopup === null) grownPopup = body.style.minHeight;
            body.style.minHeight = `${Math.min(600, Math.ceil(a.bottom + offset + wanted + margin))}px`;
            vh = window.innerHeight; // the popup resizes asynchronously; the resize listener calls place() again
        }

        const below = vh - a.bottom - offset - margin;
        const above = a.top - offset - margin;
        const side = wanted <= below || below >= above ? 'bottom' : 'top';
        panel.style.maxHeight = `${Math.max(64, Math.min(maxHeight, side === 'bottom' ? below : above))}px`;
        const h = panel.offsetHeight;
        const w = Math.min(panel.offsetWidth, vw - 2 * margin);
        const end = placement.endsWith('end');
        const left = Math.min(Math.max(margin, end ? a.right - w : a.left), vw - margin - w);
        const top = side === 'bottom' ? a.bottom + offset : a.top - offset - h;
        // A transformed/filtered ancestor makes `fixed` relative to itself: shift by where its origin sits.
        // Measured on an unanimated probe; measuring the panel picked up its open animation's translateY,
        // so every later re-place (on scroll) moved the panel by a few pixels.
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none';
        panel.parentNode.appendChild(probe);
        const o = probe.getBoundingClientRect();
        probe.remove();
        panel.style.left = `${left - (Math.abs(o.left) > 0.5 ? o.left : 0)}px`;
        panel.style.top = `${top - (Math.abs(o.top) > 0.5 ? o.top : 0)}px`;
        panel.dataset.side = side;
    }

    // ---------- registry: a panel portalled to a layer outlives a re-rendered trigger, so drop it then ----------
    const registry = new Set(); // { trigger, dispose }
    const register = (trigger, dispose) => registry.add({ trigger, dispose });
    function sweep() {
        for (const r of registry) if (!r.trigger.isConnected) { r.dispose(); registry.delete(r); }
    }
    // Menus and listboxes keep focus and text selection where they were (a rich-text editor's selection
    // must survive picking a font size); search boxes and form fields still take focus.
    const keepFocus = (e) => { if (!e.target.closest('input, textarea, select, [contenteditable="true"]')) e.preventDefault(); };
    // Take a trigger over from Bootstrap's dropdown so the two never toggle it together.
    function takeOver(trigger) {
        if (trigger.getAttribute('data-bs-toggle') !== 'dropdown') return;
        globalThis.bootstrap?.Dropdown?.getInstance(trigger)?.dispose();
        trigger.removeAttribute('data-bs-toggle');
    }

    // ---------- open/close manager (one floating panel open at a time) ----------
    let current = null; // { trigger, panel, opts, onClose }
    let raf = 0;

    const reposition = (e) => {
        // Scrolling the panel's own list does not move its trigger: nothing to re-place.
        if (e?.type === 'scroll' && current && e.target instanceof Node && current.panel.contains(e.target)) return;
        if (raf) return;
        raf = requestAnimationFrame(() => {
            raf = 0;
            if (!current) return;
            if (!current.trigger.isConnected || !current.trigger.getClientRects().length) return close(false);
            place(current.anchor, current.panel, current.opts);
        });
    };
    // Outside-click: listen on the document and, for a panel in a shadow root, on that root too.
    // A closed shadow root (the dock) hides its internals from document-level composedPath(), so the
    // document listener leaves clicks on that host to the root listener, which sees the full path.
    const onPointerDown = (e) => {
        if (!current) return;
        const path = e.composedPath();
        if (path.includes(current.panel) || path.includes(current.trigger)) return;
        if (e.currentTarget === document && current.root !== document && path.includes(current.root.host)) return;
        if (current.opts.closeOutside === false) return;
        close(false);
    };

    function open(trigger, panel, opts, onClose) {
        if (current && current.panel === panel) return;
        close(false);
        sweep();
        ensureStyle(trigger);
        const layer = layerFor(trigger);
        if (panel.parentNode !== layer) layer.appendChild(panel);
        ensureStyle(panel);
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        const root = panel.getRootNode() instanceof ShadowRoot ? panel.getRootNode() : document;
        const anchor = opts.anchor?.() || trigger;
        current = { trigger, panel, opts, onClose, root, anchor };
        place(anchor, panel, opts);
        document.addEventListener('pointerdown', onPointerDown, true);
        if (root !== document) root.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
    }

    function close(restoreFocus = false) {
        if (!current) return;
        const { trigger, panel, onClose, root } = current;
        current = null;
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', onPointerDown, true);
        if (root !== document) root.removeEventListener('pointerdown', onPointerDown, true);
        window.removeEventListener('scroll', reposition, true);
        window.removeEventListener('resize', reposition);
        if (grownPopup !== null) { document.body.style.minHeight = grownPopup; grownPopup = null; }
        if (onClose) onClose();
        if (restoreFocus) trigger.focus();
    }

    // ---------- menu (action menu) ----------
    function buildMenu(items) {
        const panel = document.createElement('div');
        for (const it of items) {
            if (it.divider) { const hr = document.createElement('div'); hr.className = 'mq-float-divider'; hr.setAttribute('role', 'separator'); panel.appendChild(hr); continue; }
            if (it.header) { const h = document.createElement('div'); h.className = 'mq-float-header'; h.setAttribute('role', 'presentation'); h.textContent = it.header; panel.appendChild(h); continue; }
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'mq-float-item' + (it.danger ? ' is-danger' : '');
            if (it.icon) { const i = document.createElement('i'); i.className = `mq-float-icon ${it.icon}`; i.setAttribute('aria-hidden', 'true'); b.appendChild(i); }
            const t = document.createElement('span');
            t.className = 'mq-float-text';
            t.textContent = it.label;
            if (it.description) { const d = document.createElement('span'); d.className = 'mq-float-desc'; d.textContent = it.description; t.appendChild(d); }
            b.appendChild(t);
            if (it.disabled) b.setAttribute('aria-disabled', 'true');
            if (it.keepOpen) b.dataset.keepOpen = '';
            if (it.onSelect) b.addEventListener('click', (e) => { if (!it.disabled) it.onSelect(e); });
            panel.appendChild(b);
        }
        return panel;
    }

    // Bootstrap's dropdown key handler is delegated on document in the capture phase and matches any
    // .dropdown-menu: on an adopted panel it finds no toggle and throws (or toggles another dropdown).
    // Adopted panels therefore drop .dropdown-menu; .mq-float styles them, and .dropdown-menu-end still sets placement.
    const unBootstrap = (el) => el.classList.remove('dropdown-menu', 'show');

    // Adopt Bootstrap dropdown markup in place: keeps the items' classes and click handlers.
    function adoptMenu(el) {
        unBootstrap(el);
        el.querySelectorAll(':scope > li').forEach((li) => li.setAttribute('role', 'none'));
        el.querySelectorAll('.dropdown-item').forEach((it) => {
            if (it.classList.contains('disabled') || it.disabled) it.setAttribute('aria-disabled', 'true');
        });
        el.querySelectorAll('.dropdown-header').forEach((h) => h.setAttribute('role', 'presentation'));
        el.querySelectorAll('.dropdown-divider').forEach((d) => d.setAttribute('role', 'separator'));
        return el;
    }

    function menu(trigger, content, opts = {}) {
        if (trigger._mqMenu) return trigger._mqMenu;
        takeOver(trigger);
        const panel = Array.isArray(content) ? buildMenu(content) : adoptMenu(content);
        panel.classList.add('mq-float', 'mq-menu');
        panel.setAttribute('role', 'menu');
        panel.id ||= nextId('menu');
        panel.hidden = true;
        if (opts.label) panel.setAttribute('aria-label', opts.label);
        else if (trigger.id) panel.setAttribute('aria-labelledby', trigger.id);
        trigger.setAttribute('aria-haspopup', 'menu');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-controls', panel.id);
        const placement = opts.placement || (panel.classList.contains('dropdown-menu-end') ? 'bottom-end' : 'bottom-start');
        const floatOpts = { placement, maxHeight: opts.maxHeight || 360, offset: opts.offset ?? 4 };

        const items = () => [...panel.querySelectorAll('.mq-float-item, .dropdown-item')].filter((i) => i.getAttribute('aria-disabled') !== 'true' && i.getClientRects().length);
        const prep = () => panel.querySelectorAll('.mq-float-item, .dropdown-item').forEach((i) => { i.setAttribute('role', 'menuitem'); i.tabIndex = -1; });
        const focusItem = (idx) => { const list = items(); if (list.length) list[(idx + list.length) % list.length].focus(); };
        const show = (focusIdx) => { prep(); open(trigger, panel, floatOpts, opts.onClose); if (focusIdx !== null) focusItem(focusIdx); opts.onOpen?.(); };
        const isOpen = () => current?.panel === panel;

        trigger.addEventListener('click', (e) => { e.preventDefault(); if (isOpen()) close(false); else show(e.detail === 0 ? 0 : null); });
        trigger.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(0); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); show(-1); }
        });
        panel.addEventListener('keydown', (e) => {
            const list = items();
            const i = list.indexOf(panel.getRootNode().activeElement);
            const handled = () => { e.preventDefault(); e.stopPropagation(); }; // keep Bootstrap's .dropdown-menu key handler out
            if (e.key === 'ArrowDown') { handled(); focusItem(i + 1); }
            else if (e.key === 'ArrowUp') { handled(); focusItem(i < 0 ? -1 : i - 1); }
            else if (e.key === 'Home') { handled(); focusItem(0); }
            else if (e.key === 'End') { handled(); focusItem(-1); }
            else if (e.key === 'Escape') { handled(); close(true); }
            else if (e.key === 'Tab') close(false);
            else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) { handled(); list[i].click(); }
        });
        panel.addEventListener('mousedown', keepFocus);
        // After an item's own click handlers have run (bubble phase), close unless it asks to stay open.
        panel.addEventListener('click', (e) => {
            const item = e.target.closest('.mq-float-item, .dropdown-item');
            if (!item || item.getAttribute('aria-disabled') === 'true') return;
            if (item.getAttribute('href') === '#') e.preventDefault();
            if (!('keepOpen' in item.dataset)) close(true);
        });
        register(trigger, () => panel.remove());
        return (trigger._mqMenu = { panel, open: () => show(null), close: () => isOpen() && close(false), isOpen });
    }

    // ---------- popover (any content) ----------
    function popover(trigger, panel, opts = {}) {
        if (trigger._mqPopover) return trigger._mqPopover;
        const autoClose = opts.autoClose ?? trigger.dataset.bsAutoClose ?? 'true'; // Bootstrap's values: true|outside|inside|false
        takeOver(trigger);
        unBootstrap(panel);
        panel.classList.add('mq-float', 'mq-popover');
        panel.id ||= nextId('popover');
        panel.hidden = true;
        if (!panel.hasAttribute('role')) panel.setAttribute('role', 'dialog');
        if (!panel.hasAttribute('aria-label') && !panel.hasAttribute('aria-labelledby') && trigger.textContent.trim()) {
            panel.setAttribute('aria-label', trigger.textContent.trim());
        }
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-controls', panel.id);
        const floatOpts = {
            placement: opts.placement || (panel.classList.contains('dropdown-menu-end') ? 'bottom-end' : 'bottom-start'),
            maxHeight: opts.maxHeight || 420,
            closeOutside: autoClose === 'true' || autoClose === 'outside',
        };
        const isOpen = () => current?.panel === panel;
        const focusables = () => [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.getClientRects().length);
        const show = (focusFirst) => {
            open(trigger, panel, floatOpts, opts.onClose);
            if (focusFirst) focusables()[0]?.focus();
            opts.onOpen?.();
        };
        trigger.addEventListener('click', (e) => { e.preventDefault(); if (isOpen()) close(false); else show(e.detail === 0); });
        panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); } });
        if (autoClose === 'true' || autoClose === 'inside') {
            panel.addEventListener('click', (e) => { if (e.target.closest('button, a[href]')) close(true); });
        }
        register(trigger, () => panel.remove());
        return (trigger._mqPopover = { panel, open: () => show(false), close: () => isOpen() && close(false), isOpen });
    }

    // ---------- select (themed listbox for a native <select>) ----------
    const SIZE_CLASS = { 'form-select': null, 'form-select-sm': 'mq-select-sm', 'form-select-lg': null };
    const NATIVE = {
        value: Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value'),
        selectedIndex: Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex'),
    };

    // An option's data-icon ("bi bi-x") is drawn before its text; with data-color it is a tile tinted in that colour.
    function optionIcon(o) {
        const i = document.createElement('i');
        i.className = `mq-float-icon ${o.dataset.icon}${o.dataset.color ? ' mq-float-tile' : ''}`;
        if (o.dataset.color) i.style.setProperty('--tile', o.dataset.color);
        i.setAttribute('aria-hidden', 'true');
        return i;
    }

    function select(sel, opts = {}) {
        if (sel._mqSelect) return sel._mqSelect;
        if (sel.multiple || sel.size > 1 || 'native' in sel.dataset) return null;

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.id = sel.id ? `${sel.id}__mq` : nextId('select');
        trigger.setAttribute('role', 'combobox');
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        const valueEl = document.createElement('span');
        valueEl.className = 'mq-select-value';
        trigger.append(valueEl, icon('mq-select-caret', CARET));
        if (sel.style.cssText) trigger.style.cssText = sel.style.cssText;

        const panel = document.createElement('div');
        panel.className = 'mq-float mq-listbox';
        panel.hidden = true;
        const list = document.createElement('div');
        list.id = nextId('listbox');
        list.setAttribute('role', 'listbox');
        trigger.setAttribute('aria-controls', list.id);

        // Accessible name: the select's <label>s (clicking one now focuses the trigger), else aria-label/title/name.
        const labels = [...(sel.labels || [])];
        if (labels.length) {
            labels.forEach((l) => { l.id ||= nextId('label'); l.addEventListener('click', (e) => { e.preventDefault(); trigger.focus(); }); });
            trigger.setAttribute('aria-labelledby', labels.map((l) => l.id).join(' '));
            list.setAttribute('aria-labelledby', labels.map((l) => l.id).join(' '));
        } else {
            const name = sel.getAttribute('aria-label') || sel.title || sel.name;
            if (name) { trigger.setAttribute('aria-label', name); list.setAttribute('aria-label', name); }
        }

        const searchable = opts.search ?? ('search' in sel.dataset || sel.options.length > (opts.searchThreshold ?? 10));
        let search = null;
        if (searchable) {
            const wrap = document.createElement('div');
            wrap.className = 'mq-float-search';
            search = document.createElement('input');
            search.type = 'search';
            search.placeholder = opts.searchPlaceholder || 'Search…';
            search.setAttribute('aria-label', 'Search options');
            search.setAttribute('role', 'combobox');
            search.setAttribute('aria-controls', list.id);
            search.setAttribute('aria-expanded', 'true');
            search.autocomplete = 'off';
            wrap.appendChild(search);
            panel.appendChild(wrap);
        }
        panel.appendChild(list);

        let loading = false;
        let rows = [];     // [{ el, option }] visible, in order
        let active = -1;   // index into rows

        const focusEl = () => search || trigger;
        const setActive = (i, scroll = true) => {
            rows[active]?.el.classList.remove('is-active');
            active = i;
            const row = rows[i];
            if (!row) { focusEl().removeAttribute('aria-activedescendant'); return; }
            row.el.classList.add('is-active');
            focusEl().setAttribute('aria-activedescendant', row.el.id);
            if (scroll) row.el.scrollIntoView({ block: 'nearest' });
        };
        const step = (from, dir) => {
            for (let i = from + dir; i >= 0 && i < rows.length; i += dir) if (!rows[i].option.disabled) return i;
            return from;
        };
        const firstEnabled = () => step(-1, 1);
        const lastEnabled = () => step(rows.length, -1);

        function render() {
            const q = search ? search.value.trim().toLowerCase() : '';
            list.textContent = '';
            rows = [];
            const addOption = (option, parent) => {
                // A disabled empty option is a placeholder: shown on the trigger, not offered in the list.
                if (option.hidden || (option.disabled && option.value === '')) return;
                const text = option.textContent.trim();
                const desc = option.dataset.description || '';
                if (q && !`${text} ${desc}`.toLowerCase().includes(q)) return;
                const el = document.createElement('div');
                el.className = 'mq-float-item';
                el.id = nextId('opt');
                el.setAttribute('role', 'option');
                el.setAttribute('aria-selected', String(option.selected));
                if (option.disabled) el.setAttribute('aria-disabled', 'true');
                if (option.dataset.icon) el.appendChild(optionIcon(option));
                const t = document.createElement('span');
                t.className = 'mq-float-text';
                t.textContent = text;
                if (desc) { const d = document.createElement('span'); d.className = 'mq-float-desc'; d.textContent = desc; t.appendChild(d); }
                el.append(t, icon('mq-float-check', CHECK));
                const index = rows.length;
                el.addEventListener('pointermove', () => { if (active !== index) setActive(index, false); });
                el.addEventListener('click', () => commit(index));
                rows.push({ el, option });
                parent.appendChild(el);
            };
            for (const child of sel.children) {
                if (child.tagName === 'OPTGROUP') {
                    const group = document.createElement('div');
                    group.setAttribute('role', 'group');
                    const head = document.createElement('div');
                    head.className = 'mq-float-header';
                    head.id = nextId('group');
                    head.textContent = child.label;
                    group.setAttribute('aria-labelledby', head.id);
                    group.appendChild(head);
                    const before = rows.length;
                    for (const o of child.children) if (o.tagName === 'OPTION') addOption(o, group);
                    if (rows.length > before) list.appendChild(group);
                } else if (child.tagName === 'OPTION') addOption(child, list);
            }
            if (loading || !rows.length) {
                const empty = document.createElement('div');
                empty.className = 'mq-float-empty';
                empty.textContent = loading ? 'Loading…' : (q ? 'No matches' : 'No options');
                list.appendChild(empty);
            }
            const selected = rows.findIndex((r) => r.option.selected);
            setActive(selected >= 0 && !q ? selected : firstEnabled(), true);
        }

        function sync() {
            const o = sel.options[NATIVE.selectedIndex.get.call(sel)];
            valueEl.textContent = o ? o.textContent.trim() : '';
            valueEl.classList.toggle('is-placeholder', !o || (o.value === '' && o.disabled));
            const oldIcon = valueEl.previousElementSibling?.tagName === 'I' ? valueEl.previousElementSibling : null;
            if (o?.dataset.icon) { const i = optionIcon(o); if (oldIcon) oldIcon.replaceWith(i); else trigger.prepend(i); }
            else oldIcon?.remove();
            trigger.disabled = sel.disabled;
            trigger.title = sel.title;
            // Mirror the select's classes (layout utilities, sizing, d-none toggles) onto the trigger.
            const cls = ['mq-select'];
            for (const c of sel.classList) {
                if (c === 'mq-select-native') continue;
                if (c in SIZE_CLASS) { if (SIZE_CLASS[c]) cls.push(SIZE_CLASS[c]); continue; }
                cls.push(c);
            }
            trigger.className = cls.join(' ');
            trigger.hidden = sel.hidden;
            trigger.style.display = sel.style.display === 'none' ? 'none' : '';
            if (current?.panel === panel) render();
        }

        function commit(index) {
            const row = rows[index];
            if (!row || row.option.disabled) return;
            const changed = !row.option.selected;
            NATIVE.selectedIndex.set.call(sel, row.option.index);
            close(true);
            sync();
            if (changed) {
                sel.dispatchEvent(new Event('input', { bubbles: true }));
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        const isOpen = () => current?.panel === panel;
        // A borderless trigger inside a bordered field shell (icon + select + chevron pill): line the list up
        // with the shell, which is the edge the user sees.
        const fieldEdge = () => {
            const shell = trigger.parentElement;
            if (!shell || parseFloat(getComputedStyle(trigger).borderTopWidth)) return trigger;
            const snug = shell.getBoundingClientRect().height - trigger.getBoundingClientRect().height <= 24; // not a whole card
            return snug && parseFloat(getComputedStyle(shell).borderTopWidth) ? shell : trigger;
        };
        const floatOpts = { matchWidth: true, maxHeight: opts.maxHeight || 300, placement: opts.placement || 'bottom-start', anchor: fieldEdge };
        function show() {
            if (isOpen() || trigger.disabled) return;
            if (search) search.value = '';
            render();
            open(trigger, panel, floatOpts, () => { focusEl().removeAttribute('aria-activedescendant'); });
            if (search) search.focus();
            setActive(active, true);
        }

        // Type-ahead on the closed or open list (no search box): jump to the next option starting with the typed text.
        let typed = '';
        let typedAt = 0;
        function typeahead(ch) {
            const now = Date.now();
            typed = now - typedAt > 600 ? ch : typed + ch;
            typedAt = now;
            if (!isOpen()) render();
            const start = typed.length > 1 ? active : active + 1;
            for (let k = 0; k < rows.length; k++) {
                const i = (start + k) % rows.length;
                if (!rows[i].option.disabled && rows[i].option.textContent.trim().toLowerCase().startsWith(typed)) {
                    if (isOpen()) setActive(i); else commit(i);
                    return;
                }
            }
        }

        function onKey(e) {
            const open_ = isOpen();
            const k = e.key;
            if (!open_) {
                if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); show(); }
                else if (k === 'Home' || k === 'End') { e.preventDefault(); show(); setActive(k === 'Home' ? firstEnabled() : lastEnabled()); }
                else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeahead(k.toLowerCase());
                return;
            }
            const inSearch = e.target === search;
            if (k === 'ArrowDown') { e.preventDefault(); setActive(e.altKey ? active : step(active, 1)); }
            else if (k === 'ArrowUp') { e.preventDefault(); if (e.altKey) commit(active); else setActive(step(active, -1)); }
            else if (k === 'PageDown') { e.preventDefault(); let i = active; for (let n = 0; n < 8; n++) i = step(i, 1); setActive(i); }
            else if (k === 'PageUp') { e.preventDefault(); let i = active; for (let n = 0; n < 8; n++) i = step(i, -1); setActive(i); }
            else if ((k === 'Home' || k === 'End') && !inSearch) { e.preventDefault(); setActive(k === 'Home' ? firstEnabled() : lastEnabled()); }
            else if (k === 'Enter' || (k === ' ' && !inSearch)) { e.preventDefault(); commit(active); }
            else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
            else if (k === 'Tab') close(false);
            else if (!inSearch && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeahead(k.toLowerCase());
        }

        trigger.addEventListener('click', () => (isOpen() ? close(false) : show()));
        trigger.addEventListener('keydown', onKey);
        if (search) {
            search.addEventListener('keydown', onKey);
            search.addEventListener('input', () => render());
        }

        // The <select> stays the source of truth: code that sets .value/.selectedIndex, refills options,
        // or toggles disabled/visibility updates the trigger.
        for (const p of ['value', 'selectedIndex']) {
            Object.defineProperty(sel, p, {
                configurable: true,
                get() { return NATIVE[p].get.call(this); },
                set(v) { NATIVE[p].set.call(this, v); sync(); },
            });
        }
        const mo = new MutationObserver(sync);
        mo.observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'class', 'style', 'hidden', 'label', 'selected'] });
        sel.addEventListener('change', sync);

        panel.addEventListener('mousedown', keepFocus);
        sel.classList.add('mq-select-native');
        sel.after(trigger);
        ensureStyle(trigger);
        sync();
        register(trigger, () => { mo.disconnect(); panel.remove(); });

        return (sel._mqSelect = {
            trigger, panel, open: show, close: () => isOpen() && close(false), isOpen, refresh: sync,
            setLoading(v) { loading = !!v; if (isOpen()) render(); },
            destroy() {
                if (isOpen()) close(false);
                mo.disconnect();
                sel.removeEventListener('change', sync);
                delete sel.value; delete sel.selectedIndex;
                sel.classList.remove('mq-select-native');
                trigger.remove(); panel.remove();
                delete sel._mqSelect;
            },
        });
    }

    // ---------- enhanceAll ----------
    const watched = new WeakSet();
    function enhanceAll(root = document, opts = {}) {
        // Bootstrap dropdown -> menu() when it lists .dropdown-items, else popover() (checkbox lists, colour grids).
        const adopt = (toggle) => {
            const panel = toggle.parentElement?.querySelector(':scope > .dropdown-menu');
            if (!panel) return;
            if (panel.querySelector('.dropdown-item')) menu(toggle, panel, opts);
            else popover(toggle, panel, opts);
        };
        const TOGGLE = '[data-bs-toggle="dropdown"]';
        const run = (node) => {
            if (node.nodeType !== 1 && node.nodeType !== 11) return; // element, or a shadow root / fragment
            if (node.tagName === 'SELECT') return void select(node, opts);
            if (node.matches?.(TOGGLE)) return void adopt(node);
            node.querySelectorAll?.('select').forEach((s) => select(s, opts));
            node.querySelectorAll?.(TOGGLE).forEach(adopt);
        };
        run(root.nodeType === 9 ? root.documentElement : root);
        if (!watched.has(root)) {
            watched.add(root);
            new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach(run); })
                .observe(root, { childList: true, subtree: true });
        }
    }

    globalThis.MarquisFloat = { place, menu, popover, select, enhanceAll, close: () => close(false), css: CSS };

    // <script src="scripts/mq_float.js" data-enhance> enhances the whole page once the DOM is ready
    // (extension pages allow no inline script to call enhanceAll themselves).
    if (document.currentScript?.hasAttribute('data-enhance')) {
        const go = () => enhanceAll(document);
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
        else go();
    }
})();
