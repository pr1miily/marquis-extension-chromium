(function() {
    if (window.hasMarquisDockInjected) return;
    window.hasMarquisDockInjected = true;

    // Re-injection into this content-script world stops at the guard above, so a dock already in the page
    // belongs to an extension context that has since been reloaded or updated: its buttons are dead.
    document.getElementById('marquis-floating-root')?.remove();

    // For templates that interpolate API, page or stored text (scripts/safe_html.js is injected first).
    const escHtml = MarquisHtml.esc;

    // Widget APIs (dictionary, weather) are fetched by the background worker ('dockFetchJson' in
    // background.js): a fetch from here would carry the visited site's origin to the API.
    // Returns the parts of a Response the widgets use; rejects on network failure like fetch().
    async function apiFetch(url) {
        const res = await chrome.runtime.sendMessage({ action: 'dockFetchJson', url });
        if (!res || res.status === 0) throw new Error((res && res.error) || 'Network error');
        return { ok: res.ok, status: res.status, json: async () => res.data };
    }

    let dockRoot = null;
    let wrapper = null;
    let stickyWidget = null;
    let bulkWidget = null;
    let fpWidget = null;
    let kanbanWidget = null;
    let qaWidget = null;
    let seoWidget = null;
    let dictWidget = null;
    let hlWidget = null;
    let isDragging = false;
    let langWidget = null;
    let focusWidget = null;
    let calcWidget = null;
    let weatherWidget = null;
    let isExpanded = false;
    let dragStartX, dragStartY, startLeft, startTop;
    let dockLayout = 'floating';
    let settingsWidget = null;

    let dockTools = [];
    // icon / color: the same Bootstrap icon and tool colour as the tool's tile on the popup's Home.
    const defaultTools = [
        { id: 'sticky', icon: 'journal-text', color: '#eab308', title: 'Smart Note', enabled: true },
        { id: 'bulk', icon: 'rocket-takeoff-fill', color: '#06b6d4', title: 'Bulk URL', enabled: true },
        { id: 'fp', icon: 'camera-reels-fill', color: '#ef4444', title: 'Capture & Record', enabled: true },
        { id: 'kanban', icon: 'trello', color: '#8b5cf6', title: 'Task Inbox', enabled: true },
        { id: 'qa', icon: 'bug-fill', color: '#f43f5e', title: 'QA Tool', enabled: true },
        { id: 'seo', icon: 'search-heart', color: '#84cc16', title: 'SEO Audit', enabled: true },
        { id: 'dict', icon: 'book-half', color: '#a855f7', title: 'Dictionary', enabled: true },
        { id: 'hl', icon: 'pen-fill', color: '#eab308', title: 'Highlighter', enabled: true },
        { id: 'lang', icon: 'translate', color: '#14b8a6', title: 'Locale Tools', enabled: false },
        { id: 'focus', icon: 'stopwatch', color: '#4f46e5', title: 'Focus Timer', enabled: false },
        { id: 'calc', icon: 'calculator', color: '#8b5cf6', title: 'Calculator', enabled: false },
        { id: 'weather', icon: 'cloud-sun-fill', color: '#38bdf8', title: 'Weather', enabled: false }
    ];

    // Bootstrap Icons glyphs (codepoints from styles/bootstrap-icons.css) for the icons the dock uses.
    // The font is added to the page as a private family from bytes the background sends (dockAssets): the
    // page never loads a chrome-extension:// URL, which some sites refuse and a site's CSP could block.
    // Glyphs stay hidden until it is loaded (no empty boxes).
    const BI = {
        'journal-text': 'f444', 'rocket-takeoff-fill': 'f844', 'camera-reels-fill': 'f21a', 'trello': 'f84a',
        'bug-fill': 'f1db', 'search-heart': 'f787', 'book-half': 'f193', 'pen-fill': 'f4c7', 'translate': 'f658',
        'stopwatch': 'f597', 'calculator': 'f1e0', 'cloud-sun-fill': 'f2bd', 'x-lg': 'f659', 'x': 'f62a',
        'box-arrow-up-right': 'f1c5', 'aspect-ratio': 'f150', 'arrow-down-square': 'f126', 'display': 'f302',
        'person-video': 'f677', 'mic-fill': 'f48d', 'camera-video-fill': 'f21c', 'pencil-fill': 'f4c9', 'magic': 'f675',
        'bounding-box': 'f1b6', 'layout-three-columns': 'f465', 'image': 'f42a', 'search': 'f52a', 'trash3': 'f78b',
        'sun': 'f5a2', 'cloud-sun': 'f2be', 'clouds': 'f2c3', 'cloud': 'f2c1', 'cloud-fog2': 'f2a2',
        'cloud-drizzle': 'f29d', 'cloud-rain': 'f2b6', 'cloud-rain-heavy': 'f2b5', 'snow': 'f56d',
        'cloud-lightning-rain': 'f2ab', 'droplet': 'f30d', 'exclamation-triangle': 'f33b',
        'exclamation-triangle-fill': 'f33a', 'hourglass-split': 'f41f', 'check-circle-fill': 'f26a', 'clock': 'f293',
        'x-circle': 'f623'
    };
    const ico = (name, style = '') => `<i class="mq-bi" aria-hidden="true"${style ? ` style="${style}"` : ''}>&#x${BI[name]};</i>`;
    // For markup placed in the page itself (outside the dock's shadow root, where .mq-bi has no CSS).
    const pageIco = (name) => `<i aria-hidden="true" style="font-family: marquis-bi; font-style: normal; font-weight: normal; line-height: 1;">&#x${BI[name]};</i>`;
    const toolIcon = (t, size) => `<span class="dock-tool-icon" style="--tool: ${t.color};${size ? ` --size: ${size}px;` : ''}">${ico(t.icon)}</span>`;
    // { font, logo } as base64 from the background (see dockAssets in background.js), asked once per page.
    let assets = null;
    const fromBase64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    function getAssets() {
        assets ||= chrome.runtime.sendMessage({ action: 'dockAssets' }).then(res => {
            if (!res || !res.ok) throw new Error((res && res.error) || 'Dock assets unavailable');
            return res;
        });
        return assets;
    }
    let iconFont = null;
    function loadIconFont() {
        iconFont ||= getAssets()
            .then(a => new FontFace('marquis-bi', fromBase64(a.font)).load())
            .then(face => { document.fonts.add(face); });
        return iconFont;
    }
    // The launcher logo is drawn from bytes too (no image URL for the page to load or a CSP to block).
    function drawLogo(canvas) {
        getAssets()
            .then(a => createImageBitmap(new Blob([fromBase64(a.logo)], { type: 'image/png' })))
            .then(bmp => {
                canvas.width = bmp.width;
                canvas.height = bmp.height;
                canvas.getContext('2d').drawImage(bmp, 0, 0);
                bmp.close();
            })
            .catch(() => {});
    }

    // dockToolsConfig keeps its stored shape ({ id, icon, title, enabled }), but only the order, id and
    // enabled flag are read from it. Title and icon always come from defaultTools, so renamed tools never
    // go stale and stored strings never reach the menu markup. Unknown ids are dropped, new tools appended.
    function toolsFromConfig(saved) {
        const known = new Map(defaultTools.map(t => [t.id, t]));
        const seen = new Set();
        const list = (Array.isArray(saved) ? saved : [])
            .filter(t => t && known.has(t.id) && !seen.has(t.id) && seen.add(t.id))
            .map(t => ({ ...known.get(t.id), enabled: !!t.enabled }));
        return [...list, ...defaultTools.filter(t => !seen.has(t.id)).map(t => ({ ...t }))];
    }

    function createDock() {
        if (document.getElementById('marquis-floating-root')) return;

        dockRoot = document.createElement('div');
        dockRoot.id = 'marquis-floating-root';
        dockRoot.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147483647; overflow: visible; transform: translateZ(0);';
        document.body.appendChild(dockRoot);
        // An attribute, not a class: applying a theme replaces dockRoot.className.
        loadIconFont().then(() => dockRoot.setAttribute('data-icons-ready', ''), () => {});

        // Closed: page scripts must not read dock content (notes, tasks, drafts) via element.shadowRoot.
        const shadow = dockRoot.attachShadow({ mode: 'closed' });
        // Before any dock handler runs, drop the dock if the extension was reloaded or removed meanwhile.
        dockRoot.addEventListener('pointerdown', removeIfOrphaned, true);

        const style = document.createElement('style');
        style.textContent = `
        /* 🟢 NEW: THEME VARIABLES */
            :host {
                --bg-base: #1e293b;
                --border-base: #334155;
                --border-width: 2px;
                --icon-base: #94a3b8;
                --icon-hover-bg: rgba(59, 130, 246, 0.2);
                --icon-hover-color: #3b82f6;
                --glass-blur: none;
            }
            :host(.theme-glass) {
                --bg-base: rgba(15, 23, 42, 0.25); /* 🟢 FIXED: Much more transparent */
                --border-base: rgba(255, 255, 255, 0.15);
                --border-width: 1px; /* 🟢 FIXED: Thinner border for elegance */
                --icon-base: #ffffff;
                --icon-hover-bg: rgba(255, 255, 255, 0.15);
                --icon-hover-color: #ffffff;
                --glass-blur: blur(24px) saturate(180%); /* 🟢 FIXED: High blur + Saturation makes it pop like iOS */
            }
            :host(.theme-light) {
                --bg-base: #ffffff;
                --border-base: #e2e8f0;
                --border-width: 2px;
                --icon-base: #475569;
                --icon-hover-bg: #f1f5f9;
                --icon-hover-color: #0f172a;
            }
            :host(.theme-oled) {
                --bg-base: #000000;
                --border-base: #333333;
                --border-width: 2px;
            }
            :host(.theme-neon) {
                --bg-base: #050505;
                --border-base: #00ffaa;
                --border-width: 2px;
                --icon-base: #00aa77;
                --icon-hover-bg: rgba(0, 255, 170, 0.2);
                --icon-hover-color: #00ffaa;
            }
            :host(.theme-dracula) {
                --bg-base: #282a36;
                --border-base: #bd93f9;
                --border-width: 2px;
                --icon-base: #f8f8f2;
                --icon-hover-bg: rgba(189, 147, 249, 0.2);
                --icon-hover-color: #bd93f9;
            }
            :host(.theme-cyber) {
                --bg-base: #27272a;
                --border-base: #fde047;
                --border-width: 2px;
                --icon-base: #fde047;
                --icon-hover-bg: rgba(253, 224, 71, 0.2);
                --icon-hover-color: #fde047;
            }
            :host(.theme-aqua) {
                --bg-base: #0f172a;
                --border-base: #06b6d4;
                --border-width: 2px;
                --icon-base: #a5f3fc;
                --icon-hover-bg: rgba(6, 182, 212, 0.2);
                --icon-hover-color: #22d3ee;
            }
            :host(.theme-custom-alpha) {
                /* 🟢 DISTINCT 'GHOST' LOOK: Pure black transparency, NO frosted blur */
                --bg-base: rgba(0, 0, 0, var(--alpha-val, 0.3));
                --border-base: rgba(255, 255, 255, calc(var(--alpha-val, 0.3) + 0.15));
                --border-width: 1px;
                --icon-base: #e2e8f0;
                --icon-hover-bg: rgba(255, 255, 255, 0.15);
                --icon-hover-color: #ffffff;
                --glass-blur: none; /* Removing the blur separates it completely from the 'Glass' theme */
            }

            /* Shared Marquis tokens (same names as styles/main.css) so MarquisFloat panels, scrollbars and widgets
               follow the dock theme. Each theme sets its palette (opaque surface, text, accent); the rest derives.
               Sizes are px: inside a web page, rem follows the host site's root font size. */
            :host {
                color-scheme: dark;
                /* Floating panels sit at the top of this shadow root and would inherit the host page's font. */
                font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                --mq-surface: #1e293b; --mq-text: #f8fafc; --mq-accent: #3b82f6; --mq-on-accent: #0f172a;
                --mq-bg: var(--mq-surface);
                --mq-sunken: color-mix(in srgb, var(--mq-surface) 80%, #000);
                --mq-surface-2: color-mix(in srgb, var(--mq-surface) 90%, var(--mq-text));
                --mq-text-2: color-mix(in srgb, var(--mq-text) 80%, var(--mq-surface));
                --mq-text-muted: color-mix(in srgb, var(--mq-text) 64%, var(--mq-surface));
                --mq-border: color-mix(in srgb, var(--mq-text) 24%, var(--mq-surface));
                --mq-border-subtle: color-mix(in srgb, var(--mq-text) 14%, var(--mq-surface));
                --mq-divider: var(--mq-border-subtle);
                --mq-hover: color-mix(in srgb, var(--mq-text) 9%, transparent);
                --mq-selected: color-mix(in srgb, var(--mq-accent) 22%, transparent);
                --mq-focus: var(--mq-accent);
                --mq-success: #4ade80; --mq-warning: #fbbf24; --mq-danger: #f87171; --mq-info: #38bdf8;
                --mq-shadow-1: 0 1px 2px rgb(0 0 0 / 0.3);
                --mq-shadow-2: 0 10px 28px rgb(0 0 0 / 0.45);
                --mq-scroll-thumb: color-mix(in srgb, var(--mq-text) 40%, transparent);
                --mq-scroll-thumb-hover: color-mix(in srgb, var(--mq-text) 60%, transparent);
                --mq-fs-xs: 12px; --mq-fs-sm: 13px; --mq-fs-base: 14px;
                --mq-ctl-py: 5px; --mq-ctl-px: 10px; --mq-ctl-sm-py: 4px; --mq-ctl-sm-px: 8px;
                --mq-radius-sm: 4px; --mq-radius: 6px; --mq-radius-lg: 8px;
                --mq-float-z: 2147483647; /* above the widgets (2147483646) */
            }
            :host(.theme-glass)   { --mq-surface: #1e293b; --mq-text: #ffffff; --mq-accent: #ffffff; --mq-on-accent: #1e293b; }
            :host(.theme-light)   { color-scheme: light; --mq-surface: #ffffff; --mq-text: #0f172a; --mq-accent: #0f172a; --mq-on-accent: #ffffff;
                                    --mq-sunken: #f8fafc; --mq-success: #15803d; --mq-warning: #b45309; --mq-danger: #b91c1c; --mq-info: #0e7490;
                                    --mq-shadow-1: 0 1px 2px rgb(15 23 42 / 0.08); --mq-shadow-2: 0 10px 28px rgb(15 23 42 / 0.16);
                                    --mq-scroll-thumb: color-mix(in srgb, var(--mq-text) 50%, transparent); }
            :host(.theme-oled)    { --mq-surface: #0a0a0a; --mq-text: #e2e8f0; --mq-accent: #3b82f6; --mq-on-accent: #000000; }
            :host(.theme-neon)    { --mq-surface: #050505; --mq-text: #00ffaa; --mq-accent: #00ffaa; --mq-on-accent: #050505; }
            :host(.theme-dracula) { --mq-surface: #282a36; --mq-text: #f8f8f2; --mq-accent: #bd93f9; --mq-on-accent: #282a36; }
            :host(.theme-cyber)   { --mq-surface: #27272a; --mq-text: #fde047; --mq-accent: #fde047; --mq-on-accent: #18181b; }
            :host(.theme-aqua)    { --mq-surface: #0f172a; --mq-text: #a5f3fc; --mq-accent: #22d3ee; --mq-on-accent: #0f172a; }
            :host(.theme-custom-alpha) { --mq-surface: #0b0b0b; --mq-text: #ffffff; --mq-accent: #ffffff; --mq-on-accent: #000000; }
            /* Ghost panels are see-through, so light sites show behind white text: a soft shadow keeps it readable. */
            :host(.theme-custom-alpha) .marquis-widget, :host(.theme-custom-alpha) #tools-menu { text-shadow: 0 1px 2px rgb(0 0 0 / .7); }

            /* Themed scrollbars everywhere in the dock (thin, inset thumb, transparent track). */
            ::-webkit-scrollbar { width: 8px; height: 8px; }
            ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
            ::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: var(--mq-scroll-thumb) padding-box; }
            ::-webkit-scrollbar-thumb:hover { background-color: var(--mq-scroll-thumb-hover); }

            #dock-wrapper {
                position: absolute !important;
                width: 56px !important; height: 56px !important;
                pointer-events: none !important; opacity: 0; 
                will-change: left, top, transform !important; /* 🟢 Forces GPU layer */
                transform: translateZ(0) !important;
            }

            #launcher {
                position: absolute !important; 
                inset: 0 !important; /* 🟢 Locks all 4 corners perfectly */
                box-sizing: border-box !important;
                background: var(--bg-base) !important;
                border: var(--border-width) solid var(--border-base) !important; 
                border-radius: 50% !important;
                box-shadow: 0 10px 25px rgba(0,0,0,0.5) !important;
                backdrop-filter: var(--glass-blur) !important;
                -webkit-backdrop-filter: var(--glass-blur) !important; 
                cursor: grab; 
                display: flex !important; 
                align-items: center !important; 
                justify-content: center !important;
                transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.2s ease !important; 
                pointer-events: auto !important;
                user-select: none !important; 
                
                /* 🟢 THE CHROME JITTER KILLERS */
                will-change: transform !important; 
                transform-style: preserve-3d !important;
                transform: scale(1) translateZ(0) !important; /* Pre-loads the animation layer */
                transform-origin: center center !important;
            }
            
            /* Hover and press show an accent ring around the launcher; it no longer grows or shrinks. */
            #launcher:hover {
                box-shadow: 0 10px 25px rgba(0,0,0,0.5), 0 0 0 3px color-mix(in srgb, var(--icon-hover-color) 45%, transparent) !important;
            }

            #launcher:active {
                cursor: grabbing !important;
            }
            
            .logo-img { 
                width: 40px !important; height: 40px !important; 
                margin: 0 !important; padding: 0 !important; 
                display: block !important;
                pointer-events: none !important; 
                object-fit: contain !important; 
                -webkit-user-drag: none !important; 
                image-rendering: -webkit-optimize-contrast !important; /* Keeps the logo crisp */
                transform: translateZ(0) !important; /* Stops the child from vibrating */
            }

            #tools-menu {
                position: absolute !important; top: calc(100% + 10px) !important; left: 50% !important;
                transform: translateX(-50%) scale(0.5) translateY(-20px);
                display: flex !important; flex-direction: column !important; gap: 12px !important;
                background: var(--bg-base) !important; border: var(--border-width) solid var(--border-base) !important;
                backdrop-filter: var(--glass-blur) !important;
                -webkit-backdrop-filter: var(--glass-blur) !important; 
                border-radius: 25px !important; padding: 12px 8px !important;
                opacity: 0 !important; transform-origin: top center !important; pointer-events: none !important;
                transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            }
            /* The tools menu shows a thin themed scrollbar when it overflows (it was hidden, so overflow went unnoticed). */
            #tools-menu::-webkit-scrollbar { width: 4px; height: 4px; }
            
            #dock-wrapper.dock-bottom #tools-menu {
                top: auto !important; bottom: calc(100% + 10px) !important;
                transform-origin: bottom center !important; transform: translateX(-50%) scale(0.5) translateY(20px);
                flex-direction: column-reverse !important;
            }
            #dock-wrapper.expanded #tools-menu {
                opacity: 1 !important; transform: translateX(-50%) scale(1) translateY(0) !important; pointer-events: auto !important;
            }
            #dock-wrapper.expanded.force-down #tools-menu {
                top: calc(100% + 10px) !important; bottom: auto !important;
                transform-origin: top center !important; transform: translateX(-50%) scale(1) translateY(0) !important;
            }
            #dock-wrapper.expanded.force-up #tools-menu {
                top: auto !important; bottom: calc(100% + 10px) !important;
                transform-origin: bottom center !important; transform: translateX(-50%) scale(1) translateY(0) !important;
            }

            .dock-item-btn {
                background: transparent !important; border: none !important; color: var(--icon-base) !important;
                font-size: 20px !important; cursor: pointer !important; width: 42px !important; height: 42px !important;
                display: flex !important; align-items: center !important; justify-content: center !important;
                border-radius: 50% !important; transition: all 0.2s !important;
                padding: 0 !important; margin: 0 !important; line-height: 1 !important;
            }
            .dock-item-btn:hover { background: var(--icon-hover-bg) !important; color: var(--icon-hover-color) !important; }
            .dock-divider { width: 20px !important; height: 2px !important; background: var(--border-base) !important; margin: 2px 0 !important; align-self: center !important; }

            /* Bootstrap Icons glyph (see loadIconFont) and the tool tile, same look as the popup's Home tiles. */
            .mq-bi { font-family: "marquis-bi" !important; font-style: normal; font-weight: normal !important; font-variant: normal;
                text-transform: none; line-height: 1; display: inline-block; vertical-align: -.125em; -webkit-font-smoothing: antialiased; visibility: hidden; }
            :host([data-icons-ready]) .mq-bi { visibility: visible; }
            .dock-tool-icon { --size: 30px; width: var(--size); height: var(--size); flex: none; display: inline-flex; align-items: center;
                justify-content: center; border-radius: 8px; font-size: calc(var(--size) * 0.5); text-shadow: none;
                color: color-mix(in srgb, var(--tool) 65%, var(--mq-text)); background: color-mix(in srgb, var(--tool) 20%, var(--mq-surface)); }
            .dock-tool-icon .mq-bi { vertical-align: 0; }

            /* 🟢 LAYOUT MODES (Horizontal Flex for Top/Bottom) */
            #dock-wrapper.layout-bottom, #dock-wrapper.layout-top {
                width: auto !important;
                height: 56px !important;
                display: flex !important;
                flex-direction: row !important;
                align-items: center !important;
                left: 50% !important; 
                transform: translateX(-50%) !important; 
                right: auto !important;
            }
            #dock-wrapper.layout-bottom { top: auto !important; bottom: 20px !important; }
            #dock-wrapper.layout-top { top: 20px !important; bottom: auto !important; }

            /* Override Launcher for Flex */
            #dock-wrapper.layout-bottom #launcher, #dock-wrapper.layout-top #launcher {
                position: relative !important;
                width: 56px !important; height: 56px !important;
                flex-shrink: 0 !important;
                z-index: 2 !important;
            }

            /* Override Tools Menu for Side-by-Side Expansion */
            #dock-wrapper.layout-bottom #tools-menu, #dock-wrapper.layout-top #tools-menu {
                position: relative !important;
                top: auto !important; bottom: auto !important; left: auto !important; right: auto !important;
                transform: none !important;
                flex-direction: row !important;
                opacity: 0 !important;
                max-width: 0 !important;
                margin-left: 0 !important;
                padding: 0 !important;
                border-width: 0 !important;
                overflow: hidden !important;
                pointer-events: none !important;
                transition: max-width 0.4s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.3s ease, margin-left 0.3s ease, padding 0.3s ease !important;
            }
            
            #dock-wrapper.layout-bottom.expanded #tools-menu, #dock-wrapper.layout-top.expanded #tools-menu {
                max-width: 600px !important; /* Smooth flex expansion */
                opacity: 1 !important;
                margin-left: 12px !important;
                padding: 6px 12px !important;
                border-width: 2px !important;
                pointer-events: auto !important;
            }

            #dock-wrapper.layout-bottom .dock-divider, #dock-wrapper.layout-top .dock-divider {
                width: 2px !important; height: 24px !important; margin: 0 4px !important; align-self: center !important;
            }

            .marquis-widget.centered-widget {
                left: 50% !important; right: auto !important;
                transform: translateX(-50%) scale(0.9) !important;
                transform-origin: center center !important;
            }
            .marquis-widget.centered-widget.show {
                transform: translateX(-50%) scale(1) !important;
            }
            
            .layout-sel-btn { transition: all 0.2s; }
            .layout-sel-btn:hover { background: var(--mq-surface-2) !important; color: var(--mq-text) !important; }
            .layout-sel-btn.active { background: var(--icon-hover-bg) !important; border-color: var(--icon-hover-color) !important; color: var(--icon-hover-color) !important; box-shadow: 0 0 10px color-mix(in srgb, var(--icon-hover-color) 30%, transparent); }

            /* 🟢 UNIFIED WIDGET CSS */
            .marquis-widget {
                position: fixed; width: 360px;
                background: var(--bg-base) !important;
                border: var(--border-width) solid var(--border-base) !important;
                backdrop-filter: var(--glass-blur) !important;
                -webkit-backdrop-filter: var(--glass-blur) !important;
                border-radius: 12px; box-shadow: 0 15px 35px rgba(0,0,0,0.4);
                display: flex; flex-direction: column; z-index: 2147483646;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                visibility: hidden; opacity: 0; pointer-events: none;
                transition: opacity 0.2s ease, transform 0.2s ease;
                transform: scale(0.9);
                overflow: hidden !important; 
            }
            .marquis-widget.show { visibility: visible; opacity: 1; transform: scale(1); pointer-events: auto; }
            
            .widget-header {
                padding: 8px 12px; border-bottom: 1px solid var(--border-base) !important;
                background: rgba(0,0,0,0.1) !important; 
                color: var(--icon-base) !important;
                display: flex; justify-content: space-between; align-items: center;
                cursor: grab; font-weight: bold; font-size: 14px; user-select: none;
            }
            .widget-header:active { cursor: grabbing; }


            .bs-btn { border: none; border-radius: 6px; padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
            /* 🟢 UPGRADED: Theme-Aware Action Buttons */
            .btn-primary, .btn-success, .btn-danger { background: var(--icon-hover-bg); color: var(--icon-hover-color); border: 1px solid var(--icon-hover-color); }
            .btn-primary:hover, .btn-success:hover, .btn-danger:hover { background: var(--icon-hover-color); color: var(--bg-base); }

            /* STICKY NOTE SPECIFIC */
            #sticky-toolbar { background: rgba(0,0,0,0.05); padding: 6px 8px; border-bottom: 1px solid var(--border-base); display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
            .sn-btn-group { display: flex; background: transparent; border: 1px solid var(--border-base); border-radius: 6px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
            .sn-cmd { background: transparent; border: none; border-right: 1px solid var(--border-base); cursor: pointer; padding: 6px 12px; color: var(--icon-base); transition: all 0.15s; display: flex; align-items: center; justify-content: center; height: 32px; }
            .sn-cmd:last-child { border-right: none; }
            .sn-cmd:hover { background: var(--icon-hover-bg); color: var(--icon-hover-color); }
            #sn-color-palette, #sn-emoji-picker { background: rgba(0,0,0,0.1); border-bottom: 1px solid var(--border-base); padding: 10px; display: none; gap: 10px; flex-wrap: wrap; justify-content: center; }
            /* Hover marks a swatch or emoji with a ring/tint in place (they used to grow). */
            .sn-color-swatch { width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid rgba(0,0,0,0.1); transition: border-color 0.1s, box-shadow 0.1s; box-shadow: 0 1px 2px rgba(0,0,0,0.2); }
            .sn-color-swatch:hover { border-color: var(--border-base); box-shadow: 0 0 0 2px var(--icon-hover-color); }
            .sn-emoji { cursor: pointer; font-size: 18px; border-radius: 6px; transition: background-color 0.1s; }
            .sn-emoji:hover { background-color: var(--icon-hover-bg); }
            #sn-image-preview-container { display: none; padding: 12px; background: rgba(0,0,0,0.05); border-bottom: 1px solid var(--border-base); position: relative; align-items: center; justify-content: center; }
            #sn-image-preview { max-height: 120px; max-width: 100%; border-radius: 6px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
            #sn-remove-image { position: absolute; top: 18px; right: 18px; background: #ef4444; color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
            #sticky-editor { padding: 12px; min-height: 120px; max-height: 50vh; overflow-y: auto; font-size: 14px; color: var(--icon-base); outline: none; line-height: 1.5; background: transparent; border-radius: 0 0 12px 12px; }
            #sticky-editor[placeholder]:empty:before { content: attr(placeholder); color: var(--icon-base); opacity: 0.5; pointer-events: none; }

            /* BULK URL SPECIFIC */
            #bulk-editor { padding: 12px; min-height: 120px; max-height: 40vh; overflow-y: auto; font-size: 13px; color: var(--icon-base); outline: none; line-height: 1.5; background: transparent; border: none; resize: none; width: 100%; box-sizing: border-box; font-family: monospace; white-space: pre; }
            #bulk-editor::placeholder { color: var(--icon-base); opacity: 0.5; }
            #bulk-footer { background: rgba(0,0,0,0.1); padding: 12px; border-top: 1px solid var(--border-base); border-radius: 0 0 12px 12px; display: flex; gap: 8px; justify-content: space-between; }
            .btn-bulk-primary { background: var(--mq-accent); color: var(--mq-on-accent); flex: 1; justify-content: center; border: 1px solid transparent; }
            .btn-bulk-primary:hover { background: transparent; border: 1px solid var(--border-base); color: var(--icon-hover-color); }
            .btn-bulk-secondary { background: transparent; border: 1px solid var(--border-base); color: var(--icon-base); flex: 1; justify-content: center; }
            .btn-bulk-secondary:hover { background: var(--icon-hover-bg); color: var(--icon-hover-color); }

            /* CAPTURE & RECORD SPECIFIC */
            .fp-title { font-size: 12px; font-weight: bold; color: var(--icon-base); text-transform: uppercase; letter-spacing: 1px; margin: 12px 0 8px 0; opacity: 0.7; }
            .fp-btn-outline { background: transparent; border: 1px solid var(--border-base); color: var(--icon-base); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; cursor: pointer; transition: all 0.2s; flex: 1; }
            .fp-btn-outline:hover { background: var(--icon-hover-bg); border-color: var(--icon-hover-color); color: var(--icon-hover-color); }
            .fp-radio-group { display: flex; background: rgba(0,0,0,0.1); border-radius: 8px; padding: 4px; gap: 4px; border: 1px solid var(--border-base); }
            .fp-radio-label { flex: 1; text-align: center; padding: 8px 0; font-size: 12px; font-weight: 600; color: var(--icon-base); opacity: 0.7; cursor: pointer; border-radius: 6px; transition: all 0.2s; margin: 0; }
            .fp-radio-input:checked + .fp-radio-label { background: var(--mq-accent); color: var(--mq-on-accent); font-weight: bold; opacity: 1; box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
            /* Light mode fallback for selected radio */
            :host(.theme-light) .fp-radio-input:checked + .fp-radio-label { color: var(--icon-hover-color); background: var(--icon-hover-bg); }
            .fp-toggle-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(0,0,0,0.05); border-radius: 8px; border: 1px solid var(--border-base); margin-bottom: 8px; }
            .fp-toggle-info { display: flex; align-items: center; gap: 12px; }
            .fp-toggle-info div span:first-child { color: var(--icon-base) !important; font-weight: bold; }
            .fp-toggle-info div span:last-child { color: var(--icon-base) !important; opacity: 0.6; }
            .fp-switch { position: relative; display: inline-block; width: 36px; height: 20px; margin: 0; }
            .fp-switch input { opacity: 0; width: 0; height: 0; }
            .fp-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--border-base); transition: .2s; border-radius: 20px; opacity: 0.5; }
            .fp-slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: var(--icon-base); transition: .2s; border-radius: 50%; }
            .fp-switch input:checked + .fp-slider { background-color: #10b981; opacity: 1; }
            .fp-switch input:checked + .fp-slider:before { transform: translateX(16px); background-color: white; }

            /* KANBAN MINI WIDGET SPECIFIC */
            .kb-mini-quick-add { display: flex; gap: 6px; padding: 8px 12px; background: rgba(0,0,0,0.1); border-bottom: 1px solid var(--border-base); }
            .kb-mini-input { flex-grow: 1; background: transparent; border: 1px solid var(--border-base); color: var(--icon-base); border-radius: 6px; padding: 6px 10px; font-size: 13px; outline: none; }
            .kb-mini-input:focus { border-color: var(--icon-hover-color); }
            .kb-mini-target { background: transparent; border: 1px solid var(--border-base); color: var(--icon-base); border-radius: 6px; padding: 6px 20px 6px 10px; font-size: 12px; outline: none; max-width: 120px; cursor: pointer; }
            .kb-mini-target option { background: var(--bg-base); color: var(--icon-base); }
            .kb-mini-list-header { background: rgba(0,0,0,0.1); padding: 8px 12px; font-weight: bold; font-size: 12px; color: var(--icon-base); cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none; border-top: 1px solid var(--border-base); transition: background 0.2s; }
            .kb-mini-list-header:hover { background: rgba(0,0,0,0.2); }
            .kb-mini-list-header:first-child { border-top: none; }
            .kb-mini-cards { display: none; padding: 8px; background: transparent; flex-direction: column; gap: 6px; max-height: 280px; overflow-y: auto; }
            .kb-mini-cards.open { display: flex; }
            .kb-mini-card { background: rgba(0,0,0,0.05); border: 1px solid var(--border-base); border-radius: 6px; padding: 8px; display: flex; gap: 8px; align-items: flex-start; transition: border-color 0.2s; }
            .kb-mini-card:hover { border-color: var(--icon-hover-color); }
            .kb-mini-card.completed .kb-mini-title { text-decoration: line-through; opacity: 0.5; }
            .kb-mini-title { font-size: 13px; color: var(--icon-base); word-break: break-word; line-height: 1.4; margin-top: 1px; flex-grow: 1; }

            /* QA MINI WIDGET SPECIFIC */
            .qa-mini-section { padding: 12px; border-bottom: 1px solid var(--border-base); }
            .qa-mini-section:last-child { border-bottom: none; }
            .qa-mini-title { font-size: 12px; font-weight: bold; color: var(--icon-base); opacity: 0.7; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
            .qa-btn-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
            .qa-device-btn { background: rgba(0,0,0,0.1); border: 1px solid var(--border-base); color: var(--icon-base); border-radius: 8px; padding: 8px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; cursor: pointer; transition: all 0.2s; }
            .qa-device-btn:hover { background: var(--icon-hover-bg); border-color: var(--icon-hover-color); color: var(--icon-hover-color); }
            .qa-select { width: 100%; background: transparent; border: 1px solid var(--border-base); color: var(--icon-base); border-radius: 6px; padding: 8px 12px; font-size: 13px; outline: none; cursor: pointer; }
            .qa-select:focus { border-color: var(--icon-hover-color); }
            .qa-select option { background: var(--bg-base); color: var(--icon-base); }

            /* SEO MINI WIDGET SPECIFIC */
            .seo-meta-box { background: rgba(0,0,0,0.1); border: 1px solid var(--border-base); border-radius: 6px; padding: 10px; font-size: 12px; color: var(--icon-base); line-height: 1.5; margin-bottom: 12px; word-break: break-word; }
            .seo-meta-box strong { color: var(--icon-hover-color); opacity: 0.8; }
            .seo-metric-card { background: rgba(0,0,0,0.1); border: 1px solid var(--border-base); border-radius: 6px; padding: 10px 5px; text-align: center; }
            .seo-metric-val { font-size: 18px; font-weight: bold; margin-bottom: 2px; }
            .seo-metric-label { font-size: 12px; color: var(--icon-base); opacity: 0.7; text-transform: uppercase; }

            /* DICTIONARY MINI WIDGET SPECIFIC */
            .dict-mini-input { width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.1); border: 1px solid var(--border-base); color: var(--icon-base); border-radius: 6px; padding: 8px 12px; font-size: 13px; outline: none; transition: border-color 0.2s; }
            .dict-mini-input:focus { border-color: var(--icon-hover-color); }
            .dict-mini-result { min-height: 300px; max-height: 450px; overflow-y: auto; padding: 12px; }
            .dict-word { font-size: 16px; font-weight: bold; color: var(--icon-hover-color); margin-bottom: 2px; }
            .dict-phonetic { font-size: 12px; color: var(--icon-base); opacity: 0.7; font-family: monospace; margin-bottom: 12px; }
            .dict-pos { font-size: 12px; font-weight: bold; color: var(--mq-success); text-transform: uppercase; margin-bottom: 6px; border-bottom: 1px solid var(--border-base); padding-bottom: 4px; }
            .dict-def { font-size: 12px; color: var(--icon-base); margin-bottom: 6px; padding-left: 8px; border-left: 2px solid var(--border-base); line-height: 1.4; }
            .dict-example { font-size: 12px; color: var(--icon-base); opacity: 0.7; font-style: italic; margin-top: 2px; }

            /* 🟢 NEW: Suggestion Dropdown Items */
            .dict-sug-item { padding: 8px 16px; font-size: 13px; color: var(--icon-base); cursor: pointer; border-bottom: 1px solid var(--border-base); transition: background 0.2s; text-align: left; }
            .dict-sug-item:last-child { border-bottom: none; }
            .dict-sug-item:hover { background: var(--icon-hover-bg); color: var(--icon-hover-color); }

            /* HIGHLIGHTER WIDGET SPECIFIC */
            .hl-input-group { display: flex; gap: 8px; padding: 8px 12px; background: rgba(0,0,0,0.1); border-bottom: 1px solid var(--border-base); }
            .hl-input { flex-grow: 1; background: transparent; border: 1px solid var(--border-base); color: var(--icon-base); border-radius: 6px; padding: 6px 10px; font-size: 13px; outline: none; }
            .hl-input:focus { border-color: var(--icon-hover-color); }
            .hl-chip-container { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px; max-height: 150px; overflow-y: auto; }
            .hl-chip { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: bold; color: #000; cursor: pointer; user-select: none; transition: filter 0.1s; }
            .hl-chip:active { filter: brightness(0.9); }
            .hl-chip-close { background: rgba(0,0,0,0.2); border: none; border-radius: 50%; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #000; font-size: 12px; transition: background 0.2s; }
            .hl-chip-close:hover { background: rgba(0,0,0,0.4); color: white; }
            .hl-controls { padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-base); background: rgba(0,0,0,0.1); font-size: 12px; color: var(--icon-base); }
            .hl-nav { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(0,0,0,0.1); border-top: 1px solid var(--border-base); justify-content: space-between; }
            .hl-context { padding: 12px; font-size: 12px; color: var(--icon-base); font-family: monospace; background: rgba(0,0,0,0.05); border-top: 1px solid var(--border-base); display: none; line-height: 1.4; max-height: 100px; overflow-y: auto; }
            .hl-context-match { background: #eab308; color: #000; padding: 0 4px; border-radius: 3px; font-weight: bold; }
            
            /* 🟢 OVERRIDES FOR INLINE HTML STYLES */
            #dict-widget > div:nth-child(2) { background: rgba(0,0,0,0.1) !important; border-bottom: 1px solid var(--border-base) !important; }
            #settings-widget > div:last-child { background: transparent !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
            #settings-widget > div.widget-header { border-bottom: 1px solid var(--border-base) !important; background: rgba(0,0,0,0.1) !important; }

            /* LANGUAGE WIDGET SPECIFIC */
            .lang-mini-input { width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.1); border: 1px solid var(--border-base); color: var(--icon-base); border-radius: 6px; padding: 8px 12px; font-size: 13px; outline: none; transition: border-color 0.2s; }
            .lang-mini-input:focus { border-color: var(--icon-hover-color); }
            .lang-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border-base); font-size: 13px; color: var(--icon-base); cursor: pointer; transition: background 0.2s; }
            .lang-item:last-child { border-bottom: none; }
            .lang-item:hover { background: var(--icon-hover-bg); color: var(--icon-hover-color); }
            .lang-code { font-family: monospace; font-weight: bold; color: var(--icon-hover-color); background: rgba(0,0,0,0.2); padding: 3px 8px; border-radius: 4px; font-size: 12px; }
            
            /* FOCUS WIDGET SPECIFIC */
            #focus-display { font-size: 48px; font-weight: bold; font-family: monospace; text-align: center; margin: 10px 0; color: var(--icon-hover-color); text-shadow: 0 2px 10px rgba(0,0,0,0.2); font-variant-numeric: tabular-nums; }
            .focus-mode-btn { flex: 1; padding: 6px; font-size: 12px; font-weight: bold; background: transparent; border: 1px solid var(--border-base); color: var(--icon-base); transition: all 0.2s; cursor: pointer; }
            .focus-mode-btn.active { background: var(--icon-hover-bg); color: var(--icon-hover-color); border-color: var(--icon-hover-color); }
            .focus-mode-btn:first-child { border-radius: 6px 0 0 6px; }
            .focus-mode-btn:nth-child(2) { border-left: none; border-right: none; }
            .focus-mode-btn:last-child { border-radius: 0 6px 6px 0; }
            #launcher-badge { position: absolute; bottom: -4px; right: -4px; background: #ef4444; color: white; font-size: 12px; font-weight: bold; padding: 2px 5px; border-radius: 10px; border: 2px solid var(--bg-base); display: none; pointer-events: none; transition: all 0.2s; z-index: 10; font-family: monospace; letter-spacing: -0.5px;}
        
            /* CALCULATOR WIDGET SPECIFIC */
            .calc-btn { background: rgba(0,0,0,0.1); border: 1px solid var(--border-base); color: var(--icon-base); font-size: 16px; font-weight: bold; padding: 8px 0; justify-content: center; border-radius: 8px; cursor: pointer; transition: all 0.1s; display: flex; align-items: center; user-select: none; }
            .calc-btn:hover { background: var(--icon-hover-bg); color: var(--icon-hover-color); border-color: var(--icon-hover-color); }
            .calc-btn:active, .calc-btn.active { background: var(--icon-hover-color); color: var(--bg-base); }
            .calc-btn-primary { color: var(--mq-accent); border-color: color-mix(in srgb, var(--mq-accent) 30%, transparent); }
            .calc-btn-danger { color: var(--mq-danger); border-color: rgba(239, 68, 68, 0.3); }
            .calc-btn-info { color: var(--mq-success); border-color: rgba(16, 185, 129, 0.3); }
            .calc-btn-success { background: rgba(16, 185, 129, 0.1); color: var(--mq-success); border-color: #10b981; }
            .calc-input { width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.1); border: 1px solid var(--border-base); color: var(--icon-base); border-radius: 6px; padding: 8px 12px; font-size: 13px; outline: none; margin-bottom: 8px; }
            .calc-input:focus { border-color: var(--icon-hover-color); }
            .calc-label { font-size: 12px; font-weight: bold; color: var(--icon-base); opacity: 0.8; margin-bottom: 4px; display: block; text-transform: uppercase; }
            .calc-input option { background-color: var(--bg-base); color: var(--icon-hover-color); font-weight: bold; }
        
            /* WEATHER WIDGET SPECIFIC */
            .wx-card { border-radius: 12px; padding: 14px; color: white; margin-bottom: 12px; transition: background 0.3s; position: relative; overflow: hidden; box-shadow: 0 10px 20px rgba(0,0,0,0.2); }
            .wx-card::before { content: ''; position: absolute; top: -50px; right: -50px; width: 150px; height: 150px; background: rgba(255,255,255,0.1); border-radius: 50%; pointer-events: none; }
            .wx-search { width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.1); border: 1px solid var(--border-base); color: var(--icon-base); border-radius: 20px; padding: 8px 12px 8px 36px; font-size: 13px; outline: none; font-weight: bold; }
            .wx-search:focus { border-color: #38bdf8; }
            .wx-sug-item { padding: 10px 16px; border-bottom: 1px solid var(--border-base); font-size: 13px; color: var(--icon-base); cursor: pointer; transition: background 0.2s; display: flex; justify-content: space-between; }
            .wx-sug-item:last-child { border-bottom: none; }
            .wx-sug-item:hover { background: var(--icon-hover-bg); color: var(--mq-info); }
            .wx-hourly-item { display: flex; flex-direction: column; align-items: center; min-width: 60px; padding: 10px 5px; background: rgba(0,0,0,0.1); border-radius: 8px; margin-right: 8px; border: 1px solid var(--border-base); flex-shrink: 0; }
            .wx-daily-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(0,0,0,0.1); font-size: 13px; color: var(--icon-base); font-weight: 600; }
            .wx-daily-item:last-child { border-bottom: none; }
            #wx-radar-container { display: none; position: absolute; inset: 0; background: var(--bg-base); z-index: 20; flex-direction: column; border-radius: 12px; overflow: hidden; }

            /* 🟢 RESPONSIVE DESIGN FOR SMALL SCREENS */
            @media (max-width: 500px) {
                #dock-wrapper { width: 48px !important; height: 48px !important; }
                #launcher { width: 48px !important; height: 48px !important; }
                .logo-img { width: 32px !important; height: 32px !important; }
                .dock-item-btn { width: 36px !important; height: 36px !important; font-size: 16px !important; }
                .dock-item-btn .dock-tool-icon { --size: 26px; }
                
                #dock-wrapper.layout-bottom #launcher, #dock-wrapper.layout-top #launcher {
                    width: 48px !important; height: 48px !important;
                }
                
                .marquis-widget { 
                    width: calc(100vw - 24px) !important; 
                    max-width: 360px !important; 
                }
            }
        `;
        shadow.appendChild(style);
        // Every <select> in the dock (now and in widgets added later) opens a themed MarquisFloat listbox
        // inside this shadow root instead of the browser's native list; the selects stay the data source.
        globalThis.MarquisFloat?.enhanceAll(shadow);

        // --- 1. DOCK MENU ---
        wrapper = document.createElement('div');
        wrapper.id = 'dock-wrapper';
        wrapper.innerHTML = `
            <div id="launcher">
                <canvas class="logo-img" width="128" height="128" aria-hidden="true"></canvas>
                <div id="launcher-badge">25:00</div> </div>
            <div id="tools-menu">
            </div>
        `;
        shadow.appendChild(wrapper);
        drawLogo(wrapper.querySelector('canvas.logo-img'));

        // --- 2. STICKY NOTE WIDGET ---
        stickyWidget = document.createElement('div');
        stickyWidget.id = 'sticky-widget';
        stickyWidget.className = 'marquis-widget';
        stickyWidget.innerHTML = `
            <div id="sticky-header" class="widget-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 0A1.5 1.5 0 0 0 0 1.5v13A1.5 1.5 0 0 0 1.5 16h13a1.5 1.5 0 0 0 1.5-1.5V4.5L11.5 0h-10zM2 1.5a.5.5 0 0 1 .5-.5h8v4a1 1 0 0 0 1 1h4v8a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-13z"/></svg>
                    <span>Quick Scratchpad</span>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button id="sn-save" class="bs-btn btn-success">Save</button>
                    <button id="sn-close" class="bs-btn btn-danger" aria-label="Close">${ico('x-lg')}</button>
                </div>
            </div>
            <div id="sticky-toolbar">
                <div class="sn-btn-group">
                    <button class="sn-cmd" data-cmd="bold" title="Bold" style="font-weight: 900;">B</button>
                    <button class="sn-cmd" data-cmd="italic" title="Italic" style="font-style: italic; font-family: serif;">I</button>
                    <button class="sn-cmd" data-cmd="underline" title="Underline" style="text-decoration: underline;">U</button>
                </div>
                
                <div class="sn-btn-group">
                    <button class="sn-cmd" data-cmd="justifyLeft" title="Align Left"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M2 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/></svg></button>
                    <button class="sn-cmd" data-cmd="justifyCenter" title="Center"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M4 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm2-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/></svg></button>
                    <button class="sn-cmd" data-cmd="justifyRight" title="Align Right"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M6 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-4-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm4-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-4-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/></svg></button>
                </div>

                <div class="sn-btn-group">
                    <button class="sn-cmd" data-cmd="insertUnorderedList" title="Bullet List"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1H5.5a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1H5.5a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1H5.5a.5.5 0 0 1-.5-.5zM3.854 2.146a.5.5 0 0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708 0l-.5-.5a.5.5 0 1 1 .708-.708L2 3.293l1.146-1.147a.5.5 0 0 1 .708 0zm0 4a.5.5 0 0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708 0l-.5-.5a.5.5 0 1 1 .708-.708L2 7.293l1.146-1.147a.5.5 0 0 1 .708 0zm0 4a.5.5 0 0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708 0l-.5-.5a.5.5 0 0 1 .708-.708l.146.147 1.146-1.147a.5.5 0 0 1 .708 0z"/></svg></button>
                    <button id="sn-attach-btn" class="sn-cmd" title="Attach Image"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0V3z"/></svg></button>
                </div>

                <div class="sn-btn-group">
                    <button id="sn-color-btn" class="sn-cmd" title="Text Color" style="color: var(--mq-danger);">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L3 12h2l1.333-3h3.334L11 12h2L8 1zm-2.333 7L8 3.5 10.333 8H5.667zM1 14h14v2H1v-2z"/></svg>
                    </button>
                    <select id="sn-size-picker" class="sn-cmd" title="Font Size" style="width: auto; padding: 0 4px; outline: none; background: transparent; font-size: 12px;">
                        <option value="2">Normal</option>
                        <option value="4">Large</option>
                        <option value="6">Huge</option>
                    </select>
                </div>
                
                <div class="sn-btn-group">
                    <button id="sn-emoji-btn" class="sn-cmd" title="Symbols & Emoji"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M4.285 9.567a.5.5 0 0 1 .683.183A3.498 3.498 0 0 0 8 11.5a3.498 3.498 0 0 0 3.032-1.75.5.5 0 1 1 .866.5A4.498 4.498 0 0 1 8 12.5a4.498 4.498 0 0 1-3.898-2.25.5.5 0 0 1 .183-.683zM7 6.5C7 7.328 6.552 8 6 8s-1-.672-1-1.5S5.448 5 6 5s1 .672 1 1.5zm4 0c0 .828-.448 1.5-1 1.5s-1-.672-1-1.5S9.448 5 10 5s1 .672 1 1.5z"/></svg></button>
                </div>
            </div>
            
            <div id="sn-color-palette">
                <div class="sn-color-swatch" data-color="#000000" style="background: #000000;" title="Black"></div>
                <div class="sn-color-swatch" data-color="#475569" style="background: #475569;" title="Slate"></div>
                <div class="sn-color-swatch" data-color="#ef4444" style="background: #ef4444;" title="Red"></div>
                <div class="sn-color-swatch" data-color="#f97316" style="background: #f97316;" title="Orange"></div>
                <div class="sn-color-swatch" data-color="#eab308" style="background: #eab308;" title="Yellow"></div>
                <div class="sn-color-swatch" data-color="#22c55e" style="background: #22c55e;" title="Green"></div>
                <div class="sn-color-swatch" data-color="#3b82f6" style="background: #3b82f6;" title="Blue"></div>
                <div class="sn-color-swatch" data-color="#a855f7" style="background: #a855f7;" title="Purple"></div>
                <div class="sn-color-swatch" data-color="#ec4899" style="background: #ec4899;" title="Pink"></div>
            </div>

            <div id="sn-emoji-picker">
                <span class="sn-emoji">✅</span><span class="sn-emoji">❌</span><span class="sn-emoji">⭐</span>
                <span class="sn-emoji">📌</span><span class="sn-emoji">🔥</span><span class="sn-emoji">💡</span>
                <span class="sn-emoji">❓</span><span class="sn-emoji">❗</span><span class="sn-emoji">🎯</span>
                <span class="sn-emoji">🛑</span><span class="sn-emoji">⚠️</span><span class="sn-emoji">🔔</span>
                
                <span class="sn-emoji">🚀</span><span class="sn-emoji">🐛</span><span class="sn-emoji">💻</span>
                <span class="sn-emoji">🛠️</span><span class="sn-emoji">⚙️</span><span class="sn-emoji">⚡</span>
                <span class="sn-emoji">⏳</span><span class="sn-emoji">📅</span><span class="sn-emoji">📝</span>
                <span class="sn-emoji">🔗</span><span class="sn-emoji">🔒</span><span class="sn-emoji">🔑</span>
                
                <span class="sn-emoji">😀</span><span class="sn-emoji">🤔</span><span class="sn-emoji">💯</span>
                <span class="sn-emoji">👍</span><span class="sn-emoji">👎</span><span class="sn-emoji">👏</span>
                <span class="sn-emoji">🙌</span><span class="sn-emoji">💬</span><span class="sn-emoji">☕</span>
                <span class="sn-emoji">💰</span><span class="sn-emoji">🎨</span><span class="sn-emoji">🧪</span>
            </div>

            <input type="file" id="sn-file-input" accept="image/*" style="display: none;">
            
            <div id="sn-image-preview-container">
                <img id="sn-image-preview">
                <button id="sn-remove-image" aria-label="Remove image">${ico('x-lg')}</button>
            </div>

            <div id="sticky-editor" contenteditable="true" placeholder="Jot down a quick note..."></div>
        `;
        shadow.appendChild(stickyWidget);

        // --- 3. BULK URL WIDGET ---
        bulkWidget = document.createElement('div');
        bulkWidget.id = 'bulk-widget';
        bulkWidget.className = 'marquis-widget'; 
        bulkWidget.innerHTML = `
            <div id="bulk-header" class="widget-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M11 2.5a2.5 2.5 0 1 1 .603 1.628l-6.718 3.12a2.499 2.499 0 0 1 0 1.504l6.718 3.12a2.5 2.5 0 1 1-.488.876l-6.718-3.12a2.5 2.5 0 1 1 0-3.256l6.718-3.12A2.5 2.5 0 0 1 11 2.5z"/></svg>
                    <span>Bulk URL Launch</span>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button id="bw-open-full" class="bs-btn btn-primary" style="padding: 2px 8px; font-size: 12px;" title="Open Bulk URL Tools">${ico('box-arrow-up-right')} Tools</button>
                    <button id="bw-close" class="bs-btn btn-danger" style="padding: 2px 6px;" aria-label="Close">${ico('x-lg')}</button>
                </div>
            </div>
            <textarea id="bulk-editor" placeholder="Paste URLs here...&#10;https://example.com&#10;https://google.com"></textarea>
            <div id="bulk-footer">
                <button id="bw-open-all" class="bs-btn btn-bulk-primary" title="Open all at once">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" class="me-1"><path fill-rule="evenodd" d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V11a.5.5 0 0 0-1 0v3.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/><path fill-rule="evenodd" d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z"/></svg> Open All
                </button>
                <button id="bw-open-seq" class="bs-btn btn-bulk-secondary" title="Open sequentially">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" class="me-1"><path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0V3z"/></svg> 1-by-1
                </button>
            </div>
        `;
        shadow.appendChild(bulkWidget);

        // --- 4. CAPTURE & RECORD WIDGET ---
        fpWidget = document.createElement('div');
        fpWidget.id = 'fp-widget';
        fpWidget.className = 'marquis-widget';
        fpWidget.innerHTML = `
            <div id="fp-header" class="widget-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M10.5 8.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/><path d="M2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4H2zm.5 2a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm9 2.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z"/></svg>
                    <span>Capture & Record</span>
                </div>
                <button id="fp-close" class="bs-btn btn-danger" style="padding: 2px 6px;" aria-label="Close">${ico('x-lg')}</button>
            </div>
            <div style="padding: 12px; overflow-y: auto; max-height: 70vh;">
                <div class="fp-title">Image Capture</div>
                <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                    <button id="fp-cap-vis" class="fp-btn-outline"><span style="font-size: 20px; margin-bottom: 2px;">${ico('aspect-ratio')}</span><span>Visible Area</span></button>
                    <button id="fp-cap-full" class="fp-btn-outline"><span style="font-size: 20px; margin-bottom: 2px;">${ico('arrow-down-square')}</span><span>Full Page</span></button>
                </div>

                <div class="fp-title">Record Video</div>
                <div class="fp-radio-group" style="margin-bottom: 12px;">
                    <input type="radio" id="recTab" name="recMode" class="fp-radio-input" style="display:none;" checked>
                    <label for="recTab" class="fp-radio-label">${ico('display')} Tab/Desktop</label>
                    <input type="radio" id="recCamera" name="recMode" class="fp-radio-input" style="display:none;">
                    <label for="recCamera" class="fp-radio-label">${ico('person-video')} Camera Only</label>
                </div>

                <div class="fp-toggle-row">
                    <div class="fp-toggle-info">${ico('mic-fill', 'color: var(--mq-accent); font-size: 16px;')}<div><span style="display:block; font-size: 13px; font-weight:600; color: var(--icon-hover-color);">Microphone</span><span style="font-size:12px; color: var(--icon-base); opacity: 0.7;">Record audio input</span></div></div>
                    <label class="fp-switch"><input type="checkbox" id="recMicToggle" checked><span class="fp-slider"></span></label>
                </div>
                <div class="fp-toggle-row">
                    <div class="fp-toggle-info">${ico('camera-video-fill', 'color: var(--mq-success); font-size: 16px;')}<div><span style="display:block; font-size: 13px; font-weight:600; color: var(--icon-hover-color);">Camera PIP</span><span style="font-size:12px; color: var(--icon-base); opacity: 0.7;">Floating webcam bubble</span></div></div>
                    <label class="fp-switch"><input type="checkbox" id="recCamToggle"><span class="fp-slider"></span></label>
                </div>
                <div class="fp-toggle-row" style="margin-bottom: 20px;">
                    <div class="fp-toggle-info">${ico('pencil-fill', 'color: var(--mq-warning); font-size: 16px;')}<div><span style="display:block; font-size: 13px; font-weight:600; color: var(--icon-hover-color);">Drawing Tools</span><span style="font-size:12px; color: var(--icon-base); opacity: 0.7;">Inject floating UI</span></div></div>
                    <label class="fp-switch"><input type="checkbox" id="recDrawToggle" checked><span class="fp-slider"></span></label>
                </div>

                <button id="fp-start-rec" class="bs-btn btn-danger" style="width: 100%; padding: 8px; font-size: 14px; justify-content: center; border-radius: 50px;">
                    <div style="width: 12px; height: 12px; background: currentColor; border-radius: 50%; margin-right: 4px;"></div> START RECORDING
                </button>
            </div>
        `;
        shadow.appendChild(fpWidget);

        // --- 5. KANBAN MINI WIDGET ---
        kanbanWidget = document.createElement('div');
        kanbanWidget.id = 'kanban-widget';
        kanbanWidget.className = 'marquis-widget';
        kanbanWidget.innerHTML = `
            <div id="kanban-header" class="widget-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M2.5 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2h-11zm5 2h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm-5 1a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1V3zm9-1h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/></svg>
                    <span>Task Inbox</span>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button id="kb-open-full" class="bs-btn btn-primary" style="padding: 2px 8px; font-size: 12px;" title="Open Full Board">${ico('box-arrow-up-right')} Board</button>
                    <button id="kb-close" class="bs-btn btn-danger" style="padding: 2px 6px;" aria-label="Close">${ico('x-lg')}</button>
                </div>
            </div>
            <div class="kb-mini-quick-add">
                <input type="text" id="kb-mini-input" class="kb-mini-input" placeholder="Quick add task...">
                <select id="kb-mini-target" class="kb-mini-target" aria-label="List for the new task"></select>
                <button id="kb-mini-add-btn" class="bs-btn btn-success" style="padding: 4px 10px; font-weight: bold;">+</button>
            </div>
            <div id="kb-mini-container" class="custom-scrollbar" style="overflow-y: auto; max-height: 50vh;">
                <div style="padding: 20px; text-align: center; color: var(--icon-base); opacity: 0.7; font-size: 13px;">Loading board...</div>
            </div>
        `;
        shadow.appendChild(kanbanWidget);

        // --- 6. QA MINI WIDGET ---
        qaWidget = document.createElement('div');
        qaWidget.id = 'qa-widget';
        qaWidget.className = 'marquis-widget';
        qaWidget.innerHTML = `
            <div id="qa-header" class="widget-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M4.355.522a.5.5 0 0 1 .623.333l.291.956A4.979 4.979 0 0 1 8 1c1.007 0 1.946.298 2.731.811l.29-.956a.5.5 0 1 1 .957.29l-.41 1.352A4.985 4.985 0 0 1 13 6h.5a.5.5 0 0 0 .5-.5V5a.5.5 0 0 1 1 0v.5A1.5 1.5 0 0 1 13.5 7H13v1h1.5a.5.5 0 0 1 0 1H13v1h.5a1.5 1.5 0 0 1 1.5 1.5v.5a.5.5 0 1 1-1 0v-.5a.5.5 0 0 0-.5-.5H13a5 5 0 0 1-10 0h-.5a.5.5 0 0 0-.5.5v.5a.5.5 0 1 1-1 0v-.5A1.5 1.5 0 0 1 2.5 10H3V9H1.5a.5.5 0 0 1 0-1H3V7h-.5A1.5 1.5 0 0 1 1 5.5V5a.5.5 0 0 1 1 0v.5a.5.5 0 0 0 .5.5H3c0-1.36.547-2.601 1.458-3.535l-.41-1.352a.5.5 0 0 1 .307-.591zM3 6v4a4 4 0 0 0 8 0V6a4 4 0 0 0-8 0zm3.5 1.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm4.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/></svg>
                    <span>QA Utility Belt</span>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button id="qa-open-full" class="bs-btn btn-primary" style="padding: 2px 8px; font-size: 12px;" title="Open Full QA Hub">${ico('box-arrow-up-right')} Hub</button>
                    <button id="qa-close" class="bs-btn btn-danger" style="padding: 2px 6px;" aria-label="Close">${ico('x-lg')}</button>
                </div>
            </div>
            
            <div style="overflow-y: auto; max-height: 70vh;" class="custom-scrollbar">
                
                <div class="qa-mini-section">
                    <div class="qa-mini-title">Instant Emulation</div>
                        <div class="qa-btn-grid">
                        <div class="qa-device-btn" data-sim="phone">
                            <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16" style="margin-bottom: 4px;">
                                <path d="M11 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zM5 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/>
                                <path d="M8 14a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/>
                            </svg>
                            <span style="font-size: 12px;">Mobile</span>
                        </div>
                        <div class="qa-device-btn" data-sim="tablet">
                            <svg width="20" height="20" fill="currentColor" fill-rule="evenodd" viewBox="0 0 16 16" style="margin-bottom: 2px;">
                                <path d="M1 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1zm-1 0a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2z"/>
                                <path d="M14 8a1 1 0 1 0-2 0 1 1 0 0 0 2 0z"/>
                            </svg>
                            <span style="font-size: 12px;">Tablet</span>
                        </div>
                        <div class="qa-device-btn" data-sim="laptop">
                            <svg width="20" height="20" fill="currentColor" viewBox="0 0 16 16" style="margin-bottom: 2px;">
                                <path d="M13.5 3a.5.5 0 0 1 .5.5V11H2V3.5a.5.5 0 0 1 .5-.5h11zm-11-1A1.5 1.5 0 0 0 1 3.5V12h14V3.5A1.5 1.5 0 0 0 13.5 2h-11zM0 12.5h16a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 12.5z"/>
                            </svg>
                            <span style="font-size: 12px;">Laptop</span>
                        </div>
                        <div class="qa-device-btn" data-sim="desktop">
                            <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16" style="margin-bottom: 4px;">
                                <path d="M0 4s0-2 2-2h12s2 0 2 2v6s0 2-2 2h-4c0 .667.083 1.167.25 1.5H11a.5.5 0 0 1 0 1H5a.5.5 0 0 1 0-1h.75c.167-.333.25-.833.25-1.5H2s-2 0-2-2V4zm1.398-.855a.758.758 0 0 0-.254.302A1.46 1.46 0 0 0 1 4.01V10c0 .325.078.502.145.602.07.105.17.188.302.254a1.464 1.464 0 0 0 .538.143L2.01 11H14c.325 0 .502-.078.602-.145a.758.758 0 0 0 .254-.302 1.464 1.464 0 0 0 .143-.538L15 9.99V4c0-.325-.078-.502-.145-.602a.757.757 0 0 0-.302-.254A1.46 1.46 0 0 0 13.99 3H2c-.325 0-.502.078-.602.145z"/>
                            </svg>
                            <span style="font-size: 12px;">Desktop</span>
                        </div>
                    </div>
                </div>

                <div class="qa-mini-section">
                    <div class="fp-toggle-row" style="padding: 0; background: transparent; border: none; margin-bottom: 16px;">
                        <div class="fp-toggle-info">
                            ${ico('magic', 'color: #a855f7; font-size: 18px;')}
                            <div>
                                <span style="display:block; font-size: 13px; font-weight:600; color: var(--icon-hover-color);">Live CSS Inspector</span>
                                <span style="font-size:12px; color: var(--icon-base); opacity: 0.7;">Hover to copy element styles</span>
                            </div>
                        </div>
                        <label class="fp-switch"><input type="checkbox" id="qa-mini-css-inspector"><span class="fp-slider"></span></label>
                    </div>

                    <div class="fp-toggle-row" style="padding: 0; background: transparent; border: none; margin-bottom: 16px;">
                        <div class="fp-toggle-info">
                            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style="color: #ec4899; flex-shrink: 0;">
                                <path d="M13.354.646a1.207 1.207 0 0 0-1.708 0L8.5 3.793l-.646-.647a.5.5 0 1 0-.708.708L8.293 5l-7.147 7.146A.5.5 0 0 0 1 12.5v1.793l-.854.853a.5.5 0 1 0 .708.707L1.707 15H3.5a.5.5 0 0 0 .354-.146L11 7.707l1.146 1.147a.5.5 0 0 0 .708-.708l-.647-.646 3.147-3.146a1.207 1.207 0 0 0 0-1.708l-2-2zM2 12.707l7-7L10.293 7l-7 7H2v-1.293z"/>
                            </svg>
                            <div>
                                <span style="display:block; font-size: 13px; font-weight:600; color: var(--icon-hover-color);">Eyedropper</span>
                                <span style="font-size:12px; color: var(--icon-base); opacity: 0.7;">Pick colors from the page</span>
                            </div>
                        </div>
                        <button id="qa-mini-eyedropper-btn" class="bs-btn btn-primary" style="padding: 4px 10px; font-size: 12px;">Pick Color</button>
                    </div>

                    <div class="fp-toggle-row" style="padding: 0; background: transparent; border: none; margin-bottom: 16px;">
                        <div class="fp-toggle-info">
                            ${ico('bounding-box', 'color: var(--mq-warning); font-size: 18px;')}
                            <div>
                                <span style="display:block; font-size: 13px; font-weight:600; color: var(--icon-hover-color);">X-Ray Outlines</span>
                                <span style="font-size:12px; color: var(--icon-base); opacity: 0.7;">Highlight all DOM elements</span>
                            </div>
                        </div>
                        <label class="fp-switch"><input type="checkbox" id="qa-mini-xray"><span class="fp-slider"></span></label>
                    </div>

                    <div class="fp-toggle-row" style="padding: 0; background: transparent; border: none;">
                        <div class="fp-toggle-info">
                            ${ico('layout-three-columns', 'color: var(--mq-success); font-size: 18px;')}
                            <div>
                                <span style="display:block; font-size: 13px; font-weight:600; color: var(--icon-hover-color);">Layout Grid (12-Col)</span>
                                <span style="font-size:12px; color: var(--icon-base); opacity: 0.7;">Check alignment & spacing</span>
                            </div>
                        </div>
                        <label class="fp-switch"><input type="checkbox" id="qa-mini-grid"><span class="fp-slider"></span></label>
                    </div>

                    <div class="fp-toggle-row" style="padding: 0; background: transparent; border: none;">
                        <div class="fp-toggle-info">
                            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style="color: #8b5cf6; flex-shrink: 0;">
                                <path d="M15.825.14c-.648-.646-1.741-.536-2.583.306l-4.708 4.708a3.53 3.53 0 0 0-1.455-.308c-1.402 0-2.82.525-3.805 1.51L1.146 8.484a.5.5 0 0 0 .153.827l3.606 1.442-.647.647a.5.5 0 0 0 .708.708l.647-.647 1.442 3.606a.5.5 0 0 0 .827.153l2.128-2.128c.985-.985 1.51-2.403 1.51-3.805 0-.528-.106-1.018-.308-1.455l4.708-4.708c.842-.842.952-1.935.306-2.583zM10.8 11.2a2.53 2.53 0 0 1-2.4 1.1l-1.3-.5-1.9 1.9-1.1-2.8 1.1-1.1-1.1-1.1 2.8-1.1 1.9 1.9.5-1.3a2.53 2.53 0 0 1 1.1-2.4l3.8-3.8c.4-.4 1-.4 1.3-.1.3.3.3.9-.1 1.3l-3.8 3.8z"/>
                                <path d="M1 12.5a2.5 2.5 0 0 0 2.5 2.5h.5a.5.5 0 0 0 0-1h-.5a1.5 1.5 0 0 1-1.5-1.5v-.5a.5.5 0 0 0-1 0v.5z"/>
                            </svg>
                            <div>
                                <span style="display:block; font-size: 13px; font-weight:600; color: var(--icon-hover-color);">Web Paint</span>
                                <span style="font-size:12px; color: var(--icon-base); opacity: 0.7;">Draw directly on the page</span>
                            </div>
                        </div>
                        <label class="fp-switch"><input type="checkbox" id="qa-mini-paint"><span class="fp-slider"></span></label>
                    </div>
                </div>

                <div class="qa-mini-section">
                    <div class="qa-mini-title">Vision & Accessibility</div>
                    <select id="qa-mini-vision" class="qa-select" aria-label="Vision simulation">
                        <option value="none">Normal Vision (Reset)</option>
                        <option value="blur(4px)">Squint Test (Blur)</option>
                        <option value="grayscale(100%)">Grayscale (No Color)</option>
                        <option value="invert(100%) hue-rotate(180deg)">Invert Colors</option>
                        <option value="protanopia">Protanopia (Red-Blind)</option>
                        <option value="deuteranopia">Deuteranopia (Green-Blind)</option>
                    </select>
                </div>
                
            </div>
        `;
        shadow.appendChild(qaWidget);
        
        // --- 7. SEO MINI WIDGET ---
        seoWidget = document.createElement('div');
        seoWidget.id = 'seo-widget';
        seoWidget.className = 'marquis-widget';
        seoWidget.innerHTML = `
            <div id="seo-header" class="widget-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z"/><path d="M7.938 2.016A.13.13 0 0 1 8.002 2a.13.13 0 0 1 .063.016.146.146 0 0 1 .054.057l6.857 11.667c.036.06.035.124.002.183a.163.163 0 0 1-.054.06.116.116 0 0 1-.066.017H1.146a.115.115 0 0 1-.066-.017.163.163 0 0 1-.054-.06.176.176 0 0 1 .002-.183L7.884 2.073a.147.147 0 0 1 .054-.057zm1.044-.45a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566z"/><path d="M7.002 12a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 5.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995z"/></svg>
                    <span>SEO Quick Audit</span>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button id="seo-close" class="bs-btn btn-danger" style="padding: 2px 6px;" aria-label="Close">${ico('x-lg')}</button>
                </div>
            </div>
            
            <div style="padding: 12px; max-height: 70vh; overflow-y: auto;" class="custom-scrollbar">
                
                <button id="seo-mini-crawl-btn" class="bs-btn btn-primary" style="width: 100%; padding: 10px; justify-content: center; margin-bottom: 16px;">
                    ${ico('search', 'margin-right: 6px;')} Crawl Current Page
                </button>

                <div id="seo-mini-results" style="display: none; animation: animate__fadeIn 0.3s;">
                    <div class="qa-mini-title">Metadata Overview</div>
                    <div class="seo-meta-box">
                        <strong>Title:</strong> <span id="seo-mini-title">...</span><br>
                        <strong style="margin-top: 6px; display: inline-block;">Desc:</strong> <span id="seo-mini-desc">...</span><br>
                        <strong style="margin-top: 6px; display: inline-block;">Robots:</strong> <span id="seo-mini-robots">...</span>
                    </div>

                    <div class="qa-mini-title" style="margin-top: 16px;">Quick Metrics</div>
                    <div class="qa-btn-grid" style="margin-bottom: 16px;">
                        <div class="seo-metric-card">
                            <div id="seo-mini-words" class="seo-metric-val" style="color: var(--mq-info);">0</div>
                            <div class="seo-metric-label">Words</div>
                        </div>
                        <div class="seo-metric-card">
                            <div id="seo-mini-links" class="seo-metric-val" style="color: #a855f7;">0</div>
                            <div class="seo-metric-label">Links</div>
                        </div>
                        <div class="seo-metric-card">
                            <div id="seo-mini-imgs" class="seo-metric-val" style="color: var(--mq-danger);">0</div>
                            <div class="seo-metric-label">Missing Alt</div>
                        </div>
                    </div>
                </div>

                <div class="qa-mini-title" style="margin-top: 8px;">Visual Tools</div>
                <div class="fp-toggle-row" style="background: transparent; border: 1px solid var(--mq-border-subtle); padding: 12px; border-radius: 8px;">
                    <div class="fp-toggle-info">
                        ${ico('image', 'color: var(--mq-success); font-size: 18px;')}
                        <div>
                            <span style="display:block; font-size: 13px; font-weight:600; color: var(--icon-hover-color);">Alt Text Overlay</span>
                            <span style="font-size:12px; color: var(--icon-base); opacity: 0.7;">Highlight missing alt tags</span>
                        </div>
                    </div>
                    <label class="fp-switch"><input type="checkbox" id="seo-mini-alt-toggle"><span class="fp-slider"></span></label>
                </div>
            </div>
        `;
        shadow.appendChild(seoWidget);

        // --- 7.5 DICTIONARY MINI WIDGET ---
        dictWidget = document.createElement('div');
        dictWidget.id = 'dict-widget';
        dictWidget.className = 'marquis-widget';
        dictWidget.innerHTML = `
            <div id="dict-header" class="widget-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.156 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811V2.828zm7.5-.141c.654-.596 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492V2.687zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783z"/></svg>
                    <span>Dictionary</span>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button id="dict-close" class="bs-btn btn-danger" style="padding: 2px 6px;" aria-label="Close">${ico('x-lg')}</button>
                </div>
            </div>
            
            <div style="padding: 12px; background: rgba(0,0,0,0.1); border-bottom: 1px solid var(--border-base); position: relative;">
                
                <div style="display: flex; align-items: center; background: var(--bg-base); border: 1px solid var(--icon-hover-color); border-radius: 20px; overflow: hidden; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">
                    <div style="padding: 0 12px; color: var(--icon-hover-color);">
                        <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/></svg>
                    </div>
                    <input type="text" id="dict-mini-input" placeholder="Type a word..." autocomplete="off" style="flex-grow: 1; border: none; background: transparent; color: var(--icon-base); padding: 8px 0; font-size: 13px; outline: none; font-weight: bold;">
                    <button id="dict-mini-search-btn" class="bs-btn btn-primary" style="border-radius: 0; height: 100%; padding: 8px 16px; border: none;">Search</button>
                </div>
                
                <div id="dict-mini-suggestions" class="custom-scrollbar" style="position: absolute; top: calc(100% - 4px); left: 16px; right: 16px; background: var(--bg-base); border: 1px solid var(--border-base); border-top: none; border-radius: 0 0 12px 12px; box-shadow: 0 10px 20px rgba(0,0,0,0.5); z-index: 100; display: none; max-height: 200px; overflow-y: auto;"></div>
            
            </div>
            
            <div id="dict-mini-results" class="dict-mini-result custom-scrollbar">
                <div class="text-center" style="color: var(--icon-base); opacity: 0.7; padding: 20px 0; font-style: italic;">Results will appear here...</div>
            </div>
        `;
        shadow.appendChild(dictWidget);

        // --- 7.6 HIGHLIGHTER MINI WIDGET ---
        hlWidget = document.createElement('div');
        hlWidget.id = 'hl-widget';
        hlWidget.className = 'marquis-widget';
        hlWidget.innerHTML = `
            <div id="hl-header" class="widget-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M13.498.795l.149-.149a1.207 1.207 0 1 1 1.707 1.708l-.149.148a1.5 1.5 0 0 1-.059 2.059L4.854 14.854a.5.5 0 0 1-.233.131l-4 1a.5.5 0 0 1-.606-.606l1-4a.5.5 0 0 1 .131-.232l9.642-9.642a.5.5 0 0 0-.642.056L6.854 4.854a.5.5 0 1 1-.708-.708L9.44.854A1.5 1.5 0 0 1 11.5.796a1.5 1.5 0 0 1 1.998-.001zm-.644.766a.5.5 0 0 0-.707 0L1.95 11.756l-.764 3.057 3.057-.764L14.44 3.854a.5.5 0 0 0 0-.708l-1.584-1.585z"/></svg>
                    <span>Multi-Highlighter</span>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button id="hl-close" class="bs-btn btn-danger" style="padding: 2px 6px;" aria-label="Close">${ico('x-lg')}</button>
                </div>
            </div>
            <div class="hl-input-group">
                <input type="text" id="hl-mini-input" class="hl-input" placeholder="Type word & hit Enter..." autocomplete="off">
                <button id="hl-mini-add" class="bs-btn btn-success" style="padding: 4px 10px; font-weight: bold;">+</button>
            </div>
            <div class="hl-controls">
                <div style="display: flex; gap: 12px;">
                    <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; margin: 0;"><input type="checkbox" id="hl-mini-case"> Case Sensitive</label>
                    <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; margin: 0;"><input type="checkbox" id="hl-mini-whole"> Whole Word</label>
                </div>
                <button id="hl-mini-clear" style="background: none; border: none; color: var(--mq-danger); cursor: pointer; font-size: 14px; padding: 0;" title="Clear All" aria-label="Clear all">${ico('trash3')}</button>
            </div>
            <div id="hl-mini-chips" class="hl-chip-container custom-scrollbar">
                <div style="color: var(--icon-base); opacity: 0.7; font-style: italic; width: 100%; text-align: center; padding: 10px 0;">No active keywords...</div>
            </div>
            <div class="hl-nav">
                <span id="hl-mini-count" style="color: var(--mq-text-2); font-size: 12px; font-weight: bold;">0 Matches</span>
                <div style="display: flex; gap: 4px;">
                    <button id="hl-mini-prev" class="bs-btn btn-primary" style="padding: 2px 8px;">▲</button>
                    <button id="hl-mini-next" class="bs-btn btn-primary" style="padding: 2px 8px;">▼</button>
                </div>
            </div>
            <div id="hl-mini-context" class="hl-context custom-scrollbar"></div>
        `;
        shadow.appendChild(hlWidget);

        // --- 7.7 LANGUAGE CODES MINI WIDGET ---
        langWidget = document.createElement('div');
        langWidget.id = 'lang-widget';
        langWidget.className = 'marquis-widget';
        langWidget.innerHTML = `
            <div id="lang-header" class="widget-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path d="M4.545 6.714 4.11 8H3l1.862-5h1.284L8 8H6.833l-.435-1.286H4.545zm1.634-.736L5.5 3.956h-.049l-.679 2.022H6.18z"/><path d="M0 2a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v3h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-3H2a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H2zm7.138 9.995c.193.301.402.583.63.846-.748.575-1.673 1.001-2.768 1.292.178.217.451.635.555.867 1.125-.359 2.08-.844 2.886-1.494.777.665 1.739 1.165 2.93 1.472.133-.254.414-.673.629-.89-1.125-.253-2.057-.694-2.82-1.284.681-.747 1.222-1.651 1.621-2.757H14V8h-3v1.047h.765c-.318.844-.74 1.546-1.272 2.13a6.066 6.066 0 0 1-.415-.492 1.988 1.988 0 0 1-.14-.234L8.084 11.23l.53-.84h.023l.504.78.02-.023v-.006l-.004-.006a4.817 4.817 0 0 0-.152-.222L9.138 10.995z"/></svg>
                    <span>Global Tools</span>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button id="lang-close" class="bs-btn btn-danger" style="padding: 2px 6px;" aria-label="Close">${ico('x-lg')}</button>
                </div>
            </div>
            <div style="display: flex; background: rgba(0,0,0,0.2); border-bottom: 1px solid var(--border-base);">
                <button id="tab-lang" class="bs-btn" style="flex: 1; justify-content: center; border-radius: 0; background: transparent; color: var(--icon-hover-color); border-bottom: 2px solid var(--icon-hover-color);">Languages</button>
                <button id="tab-time" class="bs-btn" style="flex: 1; justify-content: center; border-radius: 0; background: transparent; color: var(--icon-base); border-bottom: 2px solid transparent;">Time Zones</button>
            </div>
            <div style="padding: 12px; background: rgba(0,0,0,0.1); border-bottom: 1px solid var(--border-base);">
                <input type="text" id="global-mini-search" class="lang-mini-input" placeholder="Search language or code..." autocomplete="off" style="margin: 0;">
            </div>
            <div id="global-mini-list" class="custom-scrollbar" style="max-height: 350px; overflow-y: auto;">
            </div>
        `;
        shadow.appendChild(langWidget);

        // --- 7.8 FOCUS TIMER WIDGET ---
        focusWidget = document.createElement('div');
        focusWidget.id = 'focus-widget';
        focusWidget.className = 'marquis-widget';
        focusWidget.innerHTML = `
            <div id="focus-header" class="widget-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path d="M8.5 5.6a.5.5 0 1 0-1 0v2.9h-3a.5.5 0 0 0 0 1H8a.5.5 0 0 0 .5-.5V5.6z"/><path d="M6.5 1A.5.5 0 0 1 7 .5h2a.5.5 0 0 1 0 1v.57c1.36.196 2.594.78 3.584 1.64a.715.715 0 0 1 .012-.013l.354-.354-.354-.353a.5.5 0 0 1 .707-.708l1.414 1.415a.5.5 0 1 1-.707.707l-.353-.354-.354.354a.512.512 0 0 1-.013.012A7 7 0 1 1 7 2.071V1.5a.5.5 0 0 1-.5-.5zM8 3a6 6 0 1 0 .001 12A6 6 0 0 0 8 3z"/></svg>
                    <span>Focus Catalyst</span>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button id="focus-close" class="bs-btn btn-danger" style="padding: 2px 6px;" aria-label="Close">${ico('x-lg')}</button>
                </div>
            </div>
            <div style="padding: 12px; text-align: center; background: rgba(0,0,0,0.1);">
                <div style="display: flex; justify-content: center; margin-bottom: 16px;">
                    <button class="focus-mode-btn active" data-mode="focus">Focus</button>
                    <button class="focus-mode-btn" data-mode="short">Short Break</button>
                    <button class="focus-mode-btn" data-mode="long">Long Break</button>
                </div>
                <div id="focus-display">25:00</div>
                <div style="color: var(--icon-base); opacity: 0.7; font-size: 12px; margin-bottom: 24px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;" id="focus-status">Ready to focus</div>
                <div style="display: flex; gap: 8px; justify-content: center;">
                    <button id="focus-start-btn" class="bs-btn btn-primary" style="padding: 8px 24px; font-size: 13px; border-radius: 20px; width: 100px; justify-content: center;">Start</button>
                    <button id="focus-reset-btn" class="bs-btn" style="background: transparent; border: 1px solid var(--border-base); color: var(--icon-base); padding: 8px 16px; border-radius: 20px; justify-content: center;">Reset</button>
                </div>
            </div>
        `;
        shadow.appendChild(focusWidget);

        // --- 7.9 CALCULATOR WIDGET ---
        calcWidget = document.createElement('div');
        calcWidget.id = 'calc-widget';
        calcWidget.className = 'marquis-widget';
        calcWidget.innerHTML = `
            <div id="calc-header" class="widget-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style="color: var(--mq-accent);"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm2 .5v2a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5h-7a.5.5 0 0 0-.5.5zm0 4v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5zM4.5 9a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1zM4 12.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5zM7.5 6a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1zM7 9.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5zm.5 2.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1zM10 6.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5zm.5 2.5a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5h-1z"/></svg>
                    <span>Omni Calculator</span>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button id="calc-close" class="bs-btn btn-danger" style="padding: 2px 6px;" aria-label="Close">${ico('x-lg')}</button>
                </div>
            </div>
            
            <div style="padding: 12px; background: rgba(0,0,0,0.1); border-bottom: 1px solid var(--border-base); position: relative;">
                <select id="calc-mode-select" class="calc-input" aria-label="Calculator mode" style="margin: 0; font-weight: bold; cursor: pointer; appearance: none; padding-right: 30px;">
                    <option value="basic">Standard Calculator</option>
                    <option value="scientific">Scientific Calculator</option>
                    <option value="unit">Unit Converter</option>
                    <option value="percentage">Percentage Calc</option>
                    <option value="date">Date & Time Calc</option>
                    <option value="mortgage">Mortgage Calc</option>
                    <option value="health">Health (BMI/BMR)</option>
                    <option value="tip">Tip Splitter</option>
                </select>
                <div style="position: absolute; right: 24px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--icon-base);">
                    <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z"/></svg>
                </div>
            </div>
            
            <div id="calc-standard-display" style="padding: 12px; background: rgba(0,0,0,0.2); border-bottom: 1px solid var(--border-base); text-align: right;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span id="calc-memory-val" style="font-size: 12px; font-weight: bold; color: var(--mq-success); visibility: hidden;">M: 0</span>
                    <span id="calc-history-val" style="font-size: 12px; color: var(--icon-base); opacity: 0.7; min-height: 18px;"></span>
                </div>
                <input type="text" id="calc-display-val" aria-label="Calculator display" style="width: 100%; background: transparent; border: none; text-align: right; font-size: 32px; font-weight: bold; color: var(--icon-hover-color); outline: none; padding: 0;" readonly value="0">
            </div>

            <div id="calc-body" style="padding: 12px; max-height: 450px; overflow-y: auto; overflow-x: hidden;" class="custom-scrollbar"></div>
        `;
        shadow.appendChild(calcWidget);

        // --- 7.10 WEATHER WIDGET ---
        weatherWidget = document.createElement('div');
        weatherWidget.id = 'wx-widget';
        weatherWidget.className = 'marquis-widget';
        weatherWidget.innerHTML = `
            <div id="wx-header" class="widget-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style="color: var(--mq-info);"><path d="M11.473 11a4.5 4.5 0 0 0-8.72-.99A3 3 0 0 0 3 16h8.5a2.5 2.5 0 0 0 0-5h-.027z"/><path d="M10.5 1.5a.5.5 0 0 0-1 0v1a.5.5 0 0 0 1 0v-1zm3.743 1.964a.5.5 0 1 0-.707-.707l-.708.707a.5.5 0 0 0 .708.708l.707-.708zm-7.779-.707a.5.5 0 0 0-.707.707l.707.708a.5.5 0 1 0 .708-.708l-.708-.707zm1.734 3.374a2 2 0 1 1 3.296 2.198c.199.281.372.58.516.898a3 3 0 1 0-4.84-3.225c.352.011.696.055 1.028.129z"/></svg>
                    <span>Weather Center</span>
                </div>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 12px; color: var(--icon-base); font-weight: bold;" id="wx-unit-lbl">°C</span>
                        <label class="fp-switch" style="transform: scale(0.8); margin: 0;" title="Toggle °C / °F">
                            <input type="checkbox" id="wx-unit-toggle"><span class="fp-slider"></span>
                        </label>
                    </div>
                    <button id="wx-close" class="bs-btn btn-danger" style="padding: 2px 6px;" aria-label="Close">${ico('x-lg')}</button>
                </div>
            </div>
            
            <div style="padding: 12px; position: relative; z-index: 15;">
                <div style="position: absolute; left: 24px; top: 50%; transform: translateY(-50%); color: var(--icon-base); opacity: 0.7; pointer-events: none;">
                    <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/></svg>
                </div>
                <input type="text" id="wx-search-input" class="wx-search" placeholder="Search city..." autocomplete="off">
                <div id="wx-search-results" class="custom-scrollbar" style="display: none; position: absolute; top: calc(100% - 4px); left: 12px; right: 12px; background: var(--bg-base); border: 1px solid #38bdf8; border-radius: 0 0 12px 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-height: 200px; overflow-y: auto;"></div>
            </div>

            <div id="wx-loader" style="padding: 24px 0; color: var(--icon-base); text-align: center;">
                <svg width="32" height="32" fill="currentColor" viewBox="0 0 16 16" style="opacity: 0.5; margin-bottom: 8px;"><path fill-rule="evenodd" d="M7.646 10.854a.5.5 0 0 0 .708 0l2-2a.5.5 0 0 0-.708-.708L8.5 9.293V5.5a.5.5 0 0 0-1 0v3.793L6.354 8.146a.5.5 0 1 0-.708.708l2 2z"/><path d="M4.406 3.342A5.53 5.53 0 0 1 8 2c2.69 0 4.923 2 5.166 4.579C14.758 6.804 16 8.137 16 9.773 16 11.569 14.502 13 12.687 13H3.781C1.708 13 0 11.366 0 9.318c0-1.763 1.266-3.223 2.942-3.593.143-.863.698-1.723 1.464-2.383zm.653.757c-.757.653-1.153 1.44-1.153 2.056v.448l-.445.049C2.064 6.805 1 7.952 1 9.318 1 10.785 2.23 12 3.781 12h8.906C13.98 12 15 10.988 15 9.773c0-1.216-1.02-2.228-2.313-2.228h-.5v-.5C12.188 4.825 10.328 3 8 3a4.53 4.53 0 0 0-2.941 1.1z"/></svg>
                <span style="font-size: 12px; font-weight: bold; display: block;">Loading Atmosphere...</span>
            </div>

            <div id="wx-content" class="custom-scrollbar" style="display: none; padding: 0 16px 16px; overflow-y: auto; max-height: 500px;">
                <div id="wx-card-bg" class="wx-card">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
                        <div>
                            <h3 id="wx-city-name" style="margin: 0; font-size: 20px; font-weight: 800;">City</h3>
                            <div id="wx-date" style="font-size: 12px; opacity: 0.8; margin-top: 2px;">Date</div>
                        </div>
                        <button id="wx-btn-radar" class="bs-btn" style="background: rgba(0,0,0,0.2); color: white; border: 1px solid rgba(255,255,255,0.2); padding: 4px 8px; font-size: 12px; display: flex; align-items: center; gap: 4px;">
                            <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M6.634 1.135A7 7 0 0 1 15 8a.5.5 0 0 1-1 0 6 6 0 1 0-6.5 5.98v-1.005A5 5 0 1 1 13 8a.5.5 0 0 1-1 0 4 4 0 1 0-4.5 3.969v-1.011A2.999 2.999 0 1 1 11 8a.5.5 0 0 1-1 0 2 2 0 1 0-2.5 1.936v-1.07a1 1 0 1 1 1 0V15.5a.5.5 0 0 1-1 0v-.518a7 7 0 0 1-1.134-13.847z"/></svg> Radar
                        </button>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div id="wx-temp" style="font-size: 48px; font-weight: 900; line-height: 1; margin-bottom: 4px; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">--°</div>
                            <div id="wx-cond" style="font-size: 14px; font-weight: 600;">--</div>
                            <div style="font-size: 12px; opacity: 0.8; margin-top: 2px;">Feels like <span id="wx-feels">--°</span></div>
                        </div>
                        <div id="wx-icon" style="font-size: 64px; line-height: 1; text-shadow: 0 4px 10px rgba(0,0,0,0.3);">${ico('cloud')}</div>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; text-align: center;">
                    <div style="background: rgba(0,0,0,0.1); padding: 10px 5px; border-radius: 8px; border: 1px solid var(--border-base);">
                        <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16" style="color: var(--mq-info); margin-bottom: 4px;"><path fill-rule="evenodd" d="M7.21.8C7.69.295 8 0 8 0s.31.295.79.8c1.609 1.733 4.654 5.02 4.654 8.91 0 3.006-2.467 5.29-5.444 5.29-2.978 0-5.444-2.284-5.444-5.29 0-3.89 3.045-7.177 4.654-8.91zm-1.125 1.547C4.697 3.86 2.112 6.865 2.112 9.71c0 2.454 2.023 4.29 4.444 4.29V2.347z"/></svg>
                        <div id="wx-hum" style="font-weight: bold; font-size: 12px; color: var(--icon-hover-color);">--%</div>
                    </div>
                    <div style="background: rgba(0,0,0,0.1); padding: 10px 5px; border-radius: 8px; border: 1px solid var(--border-base);">
                        <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16" style="color: var(--mq-text-2); margin-bottom: 4px;"><path d="M12.5 2A2.5 2.5 0 0 0 10 4.5a.5.5 0 0 1-1 0A3.5 3.5 0 1 1 12.5 8H.5a.5.5 0 0 1 0-1h12a2.5 2.5 0 0 0 0-5zm-7 1a1 1 0 0 0-1 1 .5.5 0 0 1-1 0 2 2 0 1 1 2 2h-5a.5.5 0 0 1 0-1h5a1 1 0 0 0 0-2zM0 9.5A.5.5 0 0 1 .5 9h10.042a3 3 0 1 1-3 3 .5.5 0 0 1 1 0 2 2 0 1 0 2-2H.5a.5.5 0 0 1-.5-.5z"/></svg>
                        <div id="wx-wind" style="font-weight: bold; font-size: 12px; color: var(--icon-hover-color);">--</div>
                    </div>
                    <div style="background: rgba(0,0,0,0.1); padding: 10px 5px; border-radius: 8px; border: 1px solid var(--border-base);">
                        <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16" style="color: #facc15; margin-bottom: 4px;"><path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0zm0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13zm8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5zM3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8zm10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0zm-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0zm9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707zM4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708z"/></svg>
                        <div id="wx-uv" style="font-weight: bold; font-size: 12px; color: var(--icon-hover-color);">--</div>
                    </div>
                    <div style="background: rgba(0,0,0,0.1); padding: 10px 5px; border-radius: 8px; border: 1px solid var(--border-base);">
                        <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16" style="color: #4ade80; margin-bottom: 4px;"><path fill-rule="evenodd" d="M8 14.933a.615.615 0 0 0 .1-.025c.076-.023.174-.061.294-.118.24-.113.547-.29.893-.533a10.726 10.726 0 0 0 2.287-2.233c1.527-1.997 2.807-5.031 2.253-9.188a.48.48 0 0 0-.328-.39c-.651-.213-1.75-.56-2.837-.855C9.552 1.29 8.531 1.067 8 1.067v13.866zM5.072.56C6.157.265 7.31 0 8 0s1.843.265 2.928.56c1.11.3 2.229.655 2.887.87a1.54 1.54 0 0 1 1.044 1.262c.596 4.477-.787 7.795-2.465 9.99a11.775 11.775 0 0 1-2.517 2.453 7.159 7.159 0 0 1-1.048.625c-.28.132-.581.24-.829.24s-.548-.108-.829-.24a7.158 7.158 0 0 1-1.048-.625 11.777 11.777 0 0 1-2.517-2.453C1.928 10.487.545 7.169 1.141 2.692A1.54 1.54 0 0 1 2.185 1.43 62.456 62.456 0 0 1 5.072.56z"/></svg>
                        <div id="wx-aqi" style="font-weight: bold; font-size: 12px; color: var(--icon-hover-color);">--</div>
                    </div>
                </div>

                <div style="font-size: 12px; font-weight: bold; color: var(--icon-base); opacity: 0.7; margin-bottom: 8px; text-transform: uppercase;">24-Hour Forecast</div>
                <div id="wx-hourly-scroll" class="custom-scrollbar" style="display: flex; overflow-x: auto; padding-bottom: 8px; margin-bottom: 16px;"></div>

                <div style="font-size: 12px; font-weight: bold; color: var(--icon-base); opacity: 0.7; margin-bottom: 8px; text-transform: uppercase;">7-Day Forecast</div>
                <div id="wx-daily-list" style="background: rgba(0,0,0,0.05); border: 1px solid var(--border-base); border-radius: 8px; padding: 0 12px;"></div>
            </div>

            <div id="wx-radar-container">
                <div class="widget-header" style="background: var(--bg-base); z-index: 25;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" class="text-info" style="color: var(--mq-info);"><path d="M6.634 1.135A7 7 0 0 1 15 8a.5.5 0 0 1-1 0 6 6 0 1 0-6.5 5.98v-1.005A5 5 0 1 1 13 8a.5.5 0 0 1-1 0 4 4 0 1 0-4.5 3.969v-1.011A2.999 2.999 0 1 1 11 8a.5.5 0 0 1-1 0 2 2 0 1 0-2.5 1.936v-1.07a1 1 0 1 1 1 0V15.5a.5.5 0 0 1-1 0v-.518a7 7 0 0 1-1.134-13.847z"/></svg>
                        <span>Live Radar</span>
                    </div>
                    <button id="wx-close-radar" class="bs-btn btn-danger" style="padding: 2px 6px;" aria-label="Close radar">${ico('x-lg')}</button>
                </div>
                <!-- The radar iframe is created when the radar opens: an idle iframe costs every page a browsing context. -->
            </div>
        `;
        shadow.appendChild(weatherWidget);

        // --- 8. SETTINGS WIDGET ---
        settingsWidget = document.createElement('div');
        settingsWidget.id = 'settings-widget';
        settingsWidget.className = 'marquis-widget';
        settingsWidget.style.width = '300px'; 
        settingsWidget.innerHTML = `
        <div class="widget-header" style="background: var(--bg-base); border-bottom: 1px solid var(--border-base); color: var(--icon-base); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);">
            <div style="display: flex; align-items: center; gap: 8px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" style="flex-shrink: 0;"><path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/></svg>
                <span>Dock Settings</span>
            </div>
            <button id="set-close" class="bs-btn btn-danger" style="padding: 2px 6px;" aria-label="Close">${ico('x-lg')}</button>
        </div>
        <div style="padding: 12px; background: var(--bg-base); border-radius: 0 0 12px 12px; max-height: 450px; overflow-y: auto; backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);">
            
            <p style="color: var(--icon-base); font-size: 12px; margin-top: 0; margin-bottom: 12px; font-weight: bold;">CHOOSE THEME:</p>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button class="bs-btn theme-sel-btn active" data-theme="default" style="background: #1e293b; color: #e2e8f0; border: 1px solid #334155; flex: 1; min-width: 70px; padding: 6px; justify-content: center;">Default</button>
                <button class="bs-btn theme-sel-btn" data-theme="glass" style="background: rgba(30,41,59,0.6); color: #e2e8f0; border: 1px solid rgba(255,255,255,0.2); flex: 1; min-width: 70px; padding: 6px; justify-content: center;">Glass</button>
                <button class="bs-btn theme-sel-btn" data-theme="light" style="background: #ffffff; color: #475569; border: 1px solid #e2e8f0; flex: 1; min-width: 70px; padding: 6px; justify-content: center;">Light</button>
                <button class="bs-btn theme-sel-btn" data-theme="oled" style="background: #000000; color: #e2e8f0; border: 1px solid #333333; flex: 1; min-width: 70px; padding: 6px; justify-content: center;">OLED</button>
                <button class="bs-btn theme-sel-btn" data-theme="neon" style="background: #050505; color: #00ffaa; border: 1px solid #00ffaa; flex: 1; min-width: 70px; padding: 6px; justify-content: center;">Neon</button>
                <button class="bs-btn theme-sel-btn" data-theme="dracula" style="background: #282a36; color: #bd93f9; border: 1px solid #bd93f9; flex: 1; min-width: 70px; padding: 6px; justify-content: center;">Dracula</button>
                <button class="bs-btn theme-sel-btn" data-theme="cyber" style="background: #27272a; color: #fde047; border: 1px solid #fde047; flex: 1; min-width: 70px; padding: 6px; justify-content: center;">Cyber</button>
                <button class="bs-btn theme-sel-btn" data-theme="aqua" style="background: #0f172a; color: #22d3ee; border: 1px solid #06b6d4; flex: 1; min-width: 70px; padding: 6px; justify-content: center;">Aqua</button>
                
                <button class="bs-btn theme-sel-btn" data-theme="custom-alpha" style="background: radial-gradient(circle at top right, #334155, #000000); color: #e2e8f0; border: 1px dashed rgba(255,255,255,0.4); flex: 1; min-width: 70px; padding: 6px; justify-content: center;">Ghost</button>
            </div>
            
            <div id="alpha-slider-container" style="display: none; align-items: center; gap: 10px; margin-top: 12px; background: rgba(0,0,0,0.1); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-base);">
                <span style="color: var(--icon-base); font-size: 12px; font-weight: bold;">OPACITY</span>
                <input type="range" id="alpha-slider" min="0" max="1" step="0.05" value="0.3" style="flex: 1; cursor: pointer; accent-color: var(--mq-accent);">
                <span id="alpha-val-display" style="color: var(--icon-base); font-size: 12px; font-family: monospace; width: 28px; text-align: right;">0.30</span>
            </div>

            <p style="color: var(--icon-base); font-size: 12px; margin-top: 20px; margin-bottom: 12px; font-weight: bold;">CHOOSE POSITION:</p>
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <button class="bs-btn layout-sel-btn" data-layout="floating" style="background: var(--bg-base); color: var(--icon-base); border: 1px solid var(--border-base); width: 100%; justify-content: flex-start; padding: 10px; gap: 10px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style="flex-shrink: 0;"><path d="M0 3.5A1.5 1.5 0 0 1 1.5 2h13A1.5 1.5 0 0 1 16 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 12.5v-9zM1.5 3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5h-13z"/><path d="M8 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5v-3z"/></svg> Free Float
                </button>
                
                <button class="bs-btn layout-sel-btn" data-layout="bottom" style="background: var(--bg-base); color: var(--icon-base); border: 1px solid var(--border-base); width: 100%; justify-content: flex-start; padding: 10px; gap: 10px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style="flex-shrink: 0;"><rect width="4" height="12" x="6" y="1" rx="1"/><path d="M1.5 14a.5.5 0 0 0 0 1v-1zm13 1a.5.5 0 0 0 0-1v1zm-13 0h13v-1h-13v1z"/></svg> Bottom Anchored
                </button>
                
                <button class="bs-btn layout-sel-btn" data-layout="top" style="background: var(--bg-base); color: var(--icon-base); border: 1px solid var(--border-base); width: 100%; justify-content: flex-start; padding: 10px; gap: 10px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style="flex-shrink: 0;"><rect width="4" height="12" x="6" y="3" rx="1"/><path d="M1.5 2a.5.5 0 0 1 0-1v1zm13-1a.5.5 0 0 1 0 1V1zm-13 0h13v1h-13V1z"/></svg> Top Anchored
                </button>
            </div>

            <p style="color: var(--icon-base); font-size: 12px; margin-top: 20px; margin-bottom: 12px; font-weight: bold;">MANAGE TOOLS:</p>
            <div id="settings-tools-list" style="display: flex; flex-direction: column; gap: 6px;"></div>

        </div>
        `;
        shadow.appendChild(settingsWidget);

        // Every widget panel by its menu action: the one list the opener, layout and sync code use.
        const widgetsById = {
            settings: settingsWidget, sticky: stickyWidget, bulk: bulkWidget, fp: fpWidget, kanban: kanbanWidget,
            qa: qaWidget, seo: seoWidget, dict: dictWidget, hl: hlWidget, lang: langWidget, focus: focusWidget,
            calc: calcWidget, weather: weatherWidget
        };
        const allWidgets = Object.values(widgetsById);

        // --- Dock Logic & Positioner ---
        function applyDocking(hSide, topPx) {
            wrapper.style.bottom = 'auto'; 
            wrapper.style.top = topPx;
            wrapper.style.right = 'auto'; // 🟢 FIXED: Never use 'right' to prevent CSS animation conflicts
            
            if (hSide === 'left') { 
                wrapper.style.left = '25px'; 
            } else { 
                // 56px dock width + 25px padding = 81px
                wrapper.style.left = (window.innerWidth - 81) + 'px'; 
            }
            
            let isBottom = (typeof topPx === 'string' && topPx.includes('%')) 
                ? parseFloat(topPx) > 50 : parseFloat(topPx) > (window.innerHeight / 2);
            wrapper.classList.toggle('dock-bottom', isBottom);
        }

        // 🟢 NEW: Layout Applier
        function applyDockLayout(layout) {
            dockLayout = layout;
            
            // 1. Turn off animations immediately
            wrapper.style.transition = 'none'; 
            
            // 2. Helper to safely switch classes and restore animations
            const finalizeLayout = () => {
                wrapper.classList.remove('layout-floating', 'layout-bottom', 'layout-top');
                wrapper.classList.add(`layout-${layout}`);

                shadow.querySelectorAll('.layout-sel-btn').forEach(btn => {
                    if (btn.getAttribute('data-layout') === layout) btn.classList.add('active');
                    else btn.classList.remove('active');
                });
                
                // 🟢 FIXED: Force the browser to calculate the new position instantly (Reflow)
                void wrapper.offsetWidth; 

                setTimeout(() => {
                    allWidgets.forEach(w => {
                        if (w && w.classList.contains('show')) {
                            positionWidgetBesideDock(w);
                        }
                    });
                    
                    // Turn animations back on
                    wrapper.style.transition = 'left 0.3s cubic-bezier(0.19, 1, 0.22, 1), right 0.3s cubic-bezier(0.19, 1, 0.22, 1), top 0.3s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.2s ease';
                }, 50); 
            };

            if (layout !== 'floating') {
                wrapper.style.left = '';
                wrapper.style.top = '';
                wrapper.style.right = '';
                wrapper.style.bottom = '';
                wrapper.classList.remove('dock-bottom', 'force-up', 'force-down');
                finalizeLayout(); // Execute immediately
            } else {
                // 🟢 FIXED: Fetch storage FIRST, before stripping the layout classes!
                chrome.storage.local.get(['dockPosition'], (res) => {
                    if (res.dockPosition) applyDocking(res.dockPosition.hSide, res.dockPosition.top);
                    else applyDocking('right', '70%');
                    finalizeLayout(); // Execute AFTER coordinates are applied
                });
            }
        }

        // 🟢 NEW: Theme Applier
        function applyDockTheme(theme) {
            dockRoot.className = `theme-${theme}`;
            
            // Update active state in settings
            shadow.querySelectorAll('.theme-sel-btn').forEach(btn => {
                if (btn.getAttribute('data-theme') === theme) btn.classList.add('active');
                else btn.classList.remove('active');
            });

            // 🟢 Toggle Slider Visibility
            const sliderBox = shadow.querySelector('#alpha-slider-container');
            if (sliderBox) {
                sliderBox.style.display = theme === 'custom-alpha' ? 'flex' : 'none';
            }
        }

        chrome.storage.local.get(['dockPosition', 'dockLayout', 'dockTheme', 'themeAlpha', 'activeMarquisWidget', 'bulkDraftText', 'stickyDraftText'], (res) => {
            // 🟢 Restore Custom Alpha
            const alphaVal = res.themeAlpha !== undefined ? res.themeAlpha : '0.3';
            dockRoot.style.setProperty('--alpha-val', alphaVal);
            if (shadow.querySelector('#alpha-slider')) {
                shadow.querySelector('#alpha-slider').value = alphaVal;
                shadow.querySelector('#alpha-val-display').innerText = parseFloat(alphaVal).toFixed(2);
            }

            // sync.marquis_theme is the shared theme key; local.dockTheme is the pre-4.0.x dock-only key.
            chrome.storage.sync.get('marquis_theme', (s) => applyDockTheme(s.marquis_theme || res.dockTheme || 'default'));

            if (res.dockLayout && res.dockLayout !== 'floating') {
                applyDockLayout(res.dockLayout);
            } else if (res.dockPosition) {
                applyDocking(res.dockPosition.hSide, res.dockPosition.top);
                applyDockLayout('floating');
            } else {
                applyDocking('right', '70%');
                applyDockLayout('floating');
            }

            // Restore Input Drafts
            if (res.bulkDraftText && shadow.querySelector('#bulk-editor')) {
                shadow.querySelector('#bulk-editor').value = res.bulkDraftText;
            }
            if (res.stickyDraftText && shadow.querySelector('#sticky-editor')) {
                // The draft syncs into every open site's dock: render formatting tags only.
                shadow.querySelector('#sticky-editor').innerHTML = MarquisHtml.sanitize(res.stickyDraftText);
            }

            setTimeout(() => {
                if (wrapper) {
                    wrapper.style.opacity = '1';
                    wrapper.style.transition = 'left 0.3s cubic-bezier(0.19, 1, 0.22, 1), right 0.3s cubic-bezier(0.19, 1, 0.22, 1), top 0.3s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.2s ease';
                }
                // Restore Active Widget
                if (res.activeMarquisWidget) {
                    openWidgetById(res.activeMarquisWidget);
                }
            }, 50);
        });

        // 🟢 FIXED: Smart Widget Positioning with Viewport Edge Clamping
        function positionWidgetBesideDock(widgetEl, overrideRect = null) {
            if (dockLayout === 'bottom') {
                widgetEl.classList.add('centered-widget');
                widgetEl.style.top = 'auto';
                widgetEl.style.bottom = '100px';
                widgetEl.style.left = ''; widgetEl.style.right = '';
            } else if (dockLayout === 'top') {
                widgetEl.classList.add('centered-widget');
                widgetEl.style.top = '100px';
                widgetEl.style.bottom = 'auto';
                widgetEl.style.left = ''; widgetEl.style.right = '';
            } else {
                widgetEl.classList.remove('centered-widget');
                const dockRect = overrideRect || wrapper.getBoundingClientRect();
                const isRightSide = dockRect.left > (window.innerWidth / 2);
                const isBottomHalf = dockRect.top > (window.innerHeight / 2);
                
                // Calculate dynamic width (respecting mobile CSS shrinkage)
                const wWidth = Math.min(widgetEl.offsetWidth || 360, window.innerWidth - 24);
                const wHeight = widgetEl.offsetHeight || 400;

                widgetEl.style.right = 'auto';
                widgetEl.style.bottom = 'auto';

                // Horizontal Placement
                let calcLeft = 0;
                if (isRightSide) {
                    calcLeft = dockRect.left - wWidth - 15;
                } else {
                    const rightEdge = dockRect.right !== undefined ? dockRect.right : (dockRect.left + (window.innerWidth <= 500 ? 48 : 56));
                    calcLeft = rightEdge + 15;
                }
                
                // 🟢 Clamp horizontally to keep it perfectly on-screen
                calcLeft = Math.max(12, Math.min(calcLeft, window.innerWidth - wWidth - 12));
                widgetEl.style.left = calcLeft + 'px';
                
                // Vertical Placement
                let calcTop = 0;
                if (isBottomHalf) {
                    const bottomEdge = dockRect.bottom !== undefined ? dockRect.bottom : (dockRect.top + (window.innerWidth <= 500 ? 48 : 56));
                    const bottomGap = Math.max(20, window.innerHeight - bottomEdge);
                    calcTop = window.innerHeight - bottomGap - wHeight;
                } else {
                    calcTop = Math.max(20, dockRect.top);
                }
                
                // 🟢 Clamp vertically so tall widgets don't bleed off the top/bottom
                calcTop = Math.max(12, Math.min(calcTop, window.innerHeight - wHeight - 12));
                widgetEl.style.top = calcTop + 'px';
            }
        }

        function toggleDock() {
            const menu = shadow.querySelector('#tools-menu');
            const rect = wrapper.getBoundingClientRect();
            
            menu.style.transition = 'none';

            if (dockLayout === 'floating') {
                const spaceAbove = rect.top;
                const spaceBelow = window.innerHeight - rect.bottom;
                const openUpwards = spaceBelow < spaceAbove; 

                wrapper.classList.toggle('dock-bottom', openUpwards);
                wrapper.classList.remove('force-up', 'force-down');
                
                // Smart constraint ONLY for Floating Mode
                if (openUpwards) {
                    menu.style.maxHeight = Math.max(100, spaceAbove - 30) + 'px';
                } else {
                    menu.style.maxHeight = Math.max(100, spaceBelow - 30) + 'px';
                }
                menu.style.overflowY = 'auto';
            } else {
                // 🟢 FIXED: Strip out all inline styles so the CSS can natively handle the horizontal row!
                menu.style.maxHeight = '';
                menu.style.overflowY = '';
                menu.style.overflowX = ''; 
                
                wrapper.classList.remove('dock-bottom', 'force-up', 'force-down');
            }

            void menu.offsetWidth;

            isExpanded = !isExpanded;
            menu.style.transition = 'max-width 0.4s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.3s ease, margin-left 0.3s ease, padding 0.3s ease, transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            wrapper.classList.toggle('expanded', isExpanded);
        }

        function hideWidgets(skipStorage = false) {
            allWidgets.forEach(w => w.classList.remove('show'));

            // Sync the close action to all tabs
            if (!skipStorage) chrome.storage.local.set({ activeMarquisWidget: null });
        }

        // 🟢 NEW: Centralized widget opener
        function openWidgetById(action) {
            hideWidgets(true);
            const targetWidget = Object.hasOwn(widgetsById, action) ? widgetsById[action] : null;
            if (targetWidget) {
                positionWidgetBesideDock(targetWidget);
                targetWidget.classList.add('show');
                if (action === 'weather') refreshWeatherIfStale();
            }
        }

        // --- DRAG EVENT & CLICK HANDLING ---
        const launcher = shadow.querySelector('#launcher');
        
        launcher.addEventListener('click', () => {
            if (dockLayout !== 'floating') toggleDock();
        });

        launcher.addEventListener('mousedown', (e) => {
            if (dockLayout !== 'floating') return; // Disable drag if locked

            isDragging = false;
            dragStartX = e.clientX; dragStartY = e.clientY;
            const rect = wrapper.getBoundingClientRect();
            startLeft = rect.left; startTop = rect.top;
            
            wrapper.style.transition = 'none';
            allWidgets.forEach(w => {
                if (w) w.style.transition = 'none';
            });

            const onMouseMove = (moveEvent) => {
                const dx = moveEvent.clientX - dragStartX;
                const dy = moveEvent.clientY - dragStartY;
                if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                    if (!isDragging && isExpanded) toggleDock();
                    isDragging = true;
                    let newTop = Math.max(20, Math.min(window.innerHeight - 80, startTop + dy));
                    let newLeft = startLeft + dx;
                    
                    wrapper.style.left = newLeft + 'px';
                    wrapper.style.top = newTop + 'px';
                    wrapper.style.right = 'auto';

                    allWidgets.forEach(w => {
                        if (w && w.classList.contains('show')) {
                            positionWidgetBesideDock(w);
                        }
                    });
                }
            };

            const onMouseUp = (upEvent) => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                
                const springAnim = 'all 0.3s cubic-bezier(0.19, 1, 0.22, 1)';
                wrapper.style.transition = springAnim;
                
                if (isDragging) {
                    allWidgets.forEach(w => { if(w) w.style.transition = springAnim; });

                    const hSide = upEvent.clientX < window.innerWidth / 2 ? 'left' : 'right';
                    const finalLeft = hSide === 'left' ? 25 : (window.innerWidth - 81);
                    wrapper.style.left = finalLeft + 'px';
                    
                    if (chrome.runtime && chrome.runtime.id) {
                        chrome.storage.local.set({ dockPosition: { hSide, top: wrapper.style.top } });
                    }

                    // 🟢 FIXED: Feed the exact future coordinates so widgets fly to the edge side-by-side
                    const topVal = parseFloat(wrapper.style.top) || 0;
                    const simulatedRect = {
                        left: finalLeft,
                        right: finalLeft + 56,
                        top: topVal,
                        bottom: topVal + 56
                    };
                    
                    allWidgets.forEach(w => {
                        if (w && w.classList.contains('show')) {
                            positionWidgetBesideDock(w, simulatedRect);
                        }
                    });

                    setTimeout(() => {
                        allWidgets.forEach(w => { if(w) w.style.transition = 'opacity 0.2s ease, transform 0.2s ease'; });
                    }, 300);

                } else {
                    allWidgets.forEach(w => { if(w) w.style.transition = 'opacity 0.2s ease, transform 0.2s ease'; });
                    toggleDock();
                }
            };
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        // 🟢 NEW: Dynamic Dock & Settings Renderer
        function renderDockAndSettings() {
            const menu = shadow.querySelector('#tools-menu');
            const toolsList = shadow.querySelector('#settings-tools-list');
            
            // 1. Render the main Dock Menu (with bulletproof SVG)
            menu.innerHTML = `<button class="dock-item-btn" id="dock-settings-btn" title="Dock Position" data-action="settings"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/></svg></button><div class="dock-divider"></div>`;
            
            dockTools.forEach(t => {
                if (t.enabled) {
                    menu.innerHTML += `<button class="dock-item-btn" title="${t.title}" aria-label="${t.title}" data-action="${t.id}">${toolIcon(t)}</button>`;
                }
            });

            // 2. Render the Settings UI List (Theme Aware)
            toolsList.innerHTML = '';
            dockTools.forEach((t, i) => {
                toolsList.innerHTML += `
                    <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(128, 128, 128, 0.1); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-base);">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <input type="checkbox" class="tool-toggle" data-index="${i}" aria-label="Show ${t.title} in the dock" ${t.enabled ? 'checked' : ''} style="cursor: pointer; width: 14px; height: 14px; margin: 0;">
                            <span style="display: inline-flex; align-items: center; gap: 8px; color: var(--icon-base); font-size: 13px; transition: opacity 0.2s; opacity: ${t.enabled ? '1' : '0.4'};">${toolIcon(t, 22)} ${t.title}</span>
                        </div>
                        <div style="display: flex; gap: 6px;">
                            <button class="bs-btn tool-move-up" data-index="${i}" ${i === 0 ? 'disabled' : ''} style="padding: 2px 8px; background: transparent; border: 1px solid var(--border-base); color: var(--icon-base); opacity: ${i === 0 ? '0.3' : '1'}; font-size: 12px; cursor: ${i === 0 ? 'default' : 'pointer'};">▲</button>
                            <button class="bs-btn tool-move-down" data-index="${i}" ${i === dockTools.length - 1 ? 'disabled' : ''} style="padding: 2px 8px; background: transparent; border: 1px solid var(--border-base); color: var(--icon-base); opacity: ${i === dockTools.length - 1 ? '0.3' : '1'}; font-size: 12px; cursor: ${i === dockTools.length - 1 ? 'default' : 'pointer'};">▼</button>
                        </div>
                    </div>
                `;
            });

            bindMenuAndSettingsEvents(); 
        }

        // 🟢 NEW: Save config & refresh
        function updateToolsConfig() {
            chrome.storage.local.set({ dockToolsConfig: dockTools }, () => {
                renderDockAndSettings();
            });
        }

        // 🟢 UPDATED: Event Binders
        function bindMenuAndSettingsEvents() {
            // Main Dock Buttons
            shadow.querySelectorAll('.dock-item-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.getAttribute('data-action');
                    
                    if (Object.hasOwn(widgetsById, action)) {
                        // Save the open state to storage so other tabs see it!
                        chrome.storage.local.set({ activeMarquisWidget: action });
                        openWidgetById(action);
                    } else {
                        chrome.runtime.sendMessage({ action: "launch_tool", tool: action });
                    }
                    if (isExpanded) toggleDock();
                });
            });

            // Settings: Toggle Visibility
            shadow.querySelectorAll('.tool-toggle').forEach(chk => {
                chk.addEventListener('change', (e) => {
                    const idx = parseInt(e.target.getAttribute('data-index'));
                    dockTools[idx].enabled = e.target.checked;
                    updateToolsConfig();
                });
            });

            // Settings: Move Up
            shadow.querySelectorAll('.tool-move-up').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                    if (idx > 0) {
                        const temp = dockTools[idx];
                        dockTools[idx] = dockTools[idx - 1];
                        dockTools[idx - 1] = temp;
                        updateToolsConfig();
                    }
                });
            });

            // Settings: Move Down
            shadow.querySelectorAll('.tool-move-down').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                    if (idx < dockTools.length - 1) {
                        const temp = dockTools[idx];
                        dockTools[idx] = dockTools[idx + 1];
                        dockTools[idx + 1] = temp;
                        updateToolsConfig();
                    }
                });
            });
        }

        // --- 🟢 SETTINGS LAYOUT LOGIC ---
        shadow.querySelector('#set-close').addEventListener('click', () => settingsWidget.classList.remove('show'));

        // 🟢 FIXED: The missing theme button listeners!
        shadow.querySelectorAll('.theme-sel-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const newTheme = btn.getAttribute('data-theme');
                chrome.storage.sync.set({ marquis_theme: newTheme }, () => {
                    applyDockTheme(newTheme);
                });
            });
        });

        // 🟢 NEW: Ghost Opacity Slider Listeners
        const alphaSlider = shadow.querySelector('#alpha-slider');
        const alphaDisplay = shadow.querySelector('#alpha-val-display');
        if (alphaSlider) {
            alphaSlider.addEventListener('input', (e) => {
                const val = e.target.value;
                dockRoot.style.setProperty('--alpha-val', val);
                if (alphaDisplay) alphaDisplay.innerText = parseFloat(val).toFixed(2);
            });
            alphaSlider.addEventListener('change', (e) => {
                chrome.storage.local.set({ themeAlpha: e.target.value });
            });
        }

        // 🟢 RESTORED: The missing layout button listeners!
        shadow.querySelectorAll('.layout-sel-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const newLayout = btn.getAttribute('data-layout');
                chrome.storage.local.set({ dockLayout: newLayout }, () => {
                    applyDockLayout(newLayout);
                });
            });
        });

        // 🟢 LOAD TOOLS ON STARTUP
        chrome.storage.local.get(['dockToolsConfig'], (res) => {
            // Merge with default in case we add new tools to the code later
            dockTools = toolsFromConfig(res.dockToolsConfig);
            renderDockAndSettings();
        });

        // --- STICKY NOTE LOGIC ---
        const snEditor = shadow.querySelector('#sticky-editor');
        const sizePicker = shadow.querySelector('#sn-size-picker');
        const fileInput = shadow.querySelector('#sn-file-input');
        const imgPreviewBox = shadow.querySelector('#sn-image-preview-container');
        const imgPreview = shadow.querySelector('#sn-image-preview');
        
        const emojiBtn = shadow.querySelector('#sn-emoji-btn');
        const emojiPicker = shadow.querySelector('#sn-emoji-picker');
        const colorBtn = shadow.querySelector('#sn-color-btn');
        const colorPalette = shadow.querySelector('#sn-color-palette');
        
        let currentImageBase64 = null;

        shadow.querySelector('#sticky-toolbar').addEventListener('mousedown', (e) => {
            if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') e.preventDefault();
        });
        shadow.querySelector('#sn-color-palette').addEventListener('mousedown', (e) => e.preventDefault());
        shadow.querySelector('#sn-emoji-picker').addEventListener('mousedown', (e) => e.preventDefault());

        shadow.querySelectorAll('.sn-cmd').forEach(btn => {
            if(btn.id === 'sn-color-btn' || btn.id === 'sn-size-picker' || btn.id === 'sn-emoji-btn' || btn.id === 'sn-attach-btn') return;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                document.execCommand(btn.getAttribute('data-cmd'), false, null);
            });
        });

        sizePicker.addEventListener('change', (e) => {
            document.execCommand('fontSize', false, e.target.value);
        });

        colorBtn.addEventListener('click', () => {
            const isShowing = colorPalette.style.display === 'flex';
            colorPalette.style.display = isShowing ? 'none' : 'flex';
            if (emojiPicker) emojiPicker.style.display = 'none';
        });

        shadow.querySelectorAll('.sn-color-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                document.execCommand('foreColor', false, swatch.getAttribute('data-color'));
                colorPalette.style.display = 'none';
            });
        });

        emojiBtn.addEventListener('click', () => {
            const isShowing = emojiPicker.style.display === 'flex';
            emojiPicker.style.display = isShowing ? 'none' : 'flex';
            colorPalette.style.display = 'none';
        });

        shadow.querySelectorAll('.sn-emoji').forEach(emj => {
            emj.addEventListener('click', () => {
                document.execCommand('insertText', false, emj.textContent);
                emojiPicker.style.display = 'none';
            });
        });

        shadow.querySelector('#sn-attach-btn').addEventListener('click', () => fileInput.click());
        
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    currentImageBase64 = ev.target.result;
                    imgPreview.src = currentImageBase64;
                    imgPreviewBox.style.display = 'flex';
                };
                reader.readAsDataURL(file);
            }
        });

        shadow.querySelector('#sn-remove-image').addEventListener('click', () => {
            currentImageBase64 = null;
            fileInput.value = '';
            imgPreviewBox.style.display = 'none';
        });

        const snSaveBtn = shadow.querySelector('#sn-save');
        snSaveBtn.addEventListener('click', () => {
            const text = snEditor.innerHTML.trim();
            if(!text && !currentImageBase64) return;
            
            const newNote = {
                id: Date.now(),
                text: text,
                image: currentImageBase64,
                createdAt: new Date().toISOString()
            };
            
            chrome.storage.local.get(['stickyNotes'], (res) => {
                const notes = res.stickyNotes || [];
                notes.unshift(newNote);
                chrome.storage.local.set({ stickyNotes: notes }, () => {
                    
                    snEditor.innerHTML = '';
                    if (currentImageBase64) {
                        shadow.querySelector('#sn-remove-image').click();
                    }
                    
                    // Visual feedback
                    const originalHTML = snSaveBtn.innerHTML;
                    snSaveBtn.innerHTML = 'Saved!';
                    snSaveBtn.classList.replace('btn-success', 'btn-primary');
                    
                    setTimeout(() => {
                        snSaveBtn.innerHTML = originalHTML;
                        snSaveBtn.classList.replace('btn-primary', 'btn-success');
                    }, 1500);
                });
            });
        });

        shadow.querySelector('#sn-close').addEventListener('click', () => {
            stickyWidget.classList.remove('show');
            colorPalette.style.display = 'none';
            emojiPicker.style.display = 'none';
        });

        // Make Sticky Note Draggable INDEPENDENTLY
        const stickyHeader = shadow.querySelector('#sticky-header');
        let isDraggingSticky = false;
        let sStartX, sStartY, sStartLeft, sStartTop;

        stickyHeader.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('.bs-btn')) return; 
            isDraggingSticky = true;
            sStartX = e.clientX; sStartY = e.clientY;
            const rect = stickyWidget.getBoundingClientRect();
            sStartLeft = rect.left; sStartTop = rect.top;

            const onMouseMoveSticky = (moveEvent) => {
                if(!isDraggingSticky) return;
                stickyWidget.style.left = (sStartLeft + (moveEvent.clientX - sStartX)) + 'px';
                stickyWidget.style.top = (sStartTop + (moveEvent.clientY - sStartY)) + 'px';
                stickyWidget.style.right = 'auto'; 
            };

            const onMouseUpSticky = () => {
                isDraggingSticky = false;
                document.removeEventListener('mousemove', onMouseMoveSticky);
                document.removeEventListener('mouseup', onMouseUpSticky);
            };

            document.addEventListener('mousemove', onMouseMoveSticky);
            document.addEventListener('mouseup', onMouseUpSticky);
        });

        // --- BULK URL WIDGET LOGIC & DRAGGING ---
        const bwEditor = shadow.querySelector('#bulk-editor');
                
        shadow.querySelector('#bw-close').addEventListener('click', () => {
            bulkWidget.classList.remove('show'); 
        });

        // 🟢 NEW: Open the full bulk URL tools page
        shadow.querySelector('#bw-open-full').addEventListener('click', () => {
            window.open(chrome.runtime.getURL('bulk_url_tools.html'), '_blank');
            bulkWidget.classList.remove('show');
            chrome.storage.local.set({ activeMarquisWidget: null }); // ✅ FIX: action-triggered close must clear storage
        });

        // Raw lines: background.js ('bulk_open_urls') validates them (http/https only) and adds http:// to bare hosts.
        function getUrls() {
            return bwEditor.value.split('\n')
                .map(u => u.trim())
                .filter(u => u.length > 0);
        }

        function openBulk(sequential) {
            const urls = getUrls();
            if(!urls.length) return;
            chrome.runtime.sendMessage({ action: "bulk_open_urls", urls: urls, sequential }).catch(() => {});
            bwEditor.value = '';
            bulkWidget.classList.remove('show');
            // ✅ FIX: action-triggered close; the saved draft is cleared too, or it came back on the next page.
            chrome.storage.local.set({ activeMarquisWidget: null, bulkDraftText: '' });
        }

        shadow.querySelector('#bw-open-all').addEventListener('click', () => openBulk(false));
        shadow.querySelector('#bw-open-seq').addEventListener('click', () => openBulk(true));

        const bulkHeader = shadow.querySelector('#bulk-header');
        let isDraggingBulk = false;
        let bStartX, bStartY, bStartLeft, bStartTop;

        bulkHeader.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return; 
            isDraggingBulk = true;
            bStartX = e.clientX; bStartY = e.clientY;
            const rect = bulkWidget.getBoundingClientRect();
            bStartLeft = rect.left; bStartTop = rect.top;

            const onMouseMoveBulk = (moveEvent) => {
                if(!isDraggingBulk) return;
                bulkWidget.style.left = (bStartLeft + (moveEvent.clientX - bStartX)) + 'px';
                bulkWidget.style.top = (bStartTop + (moveEvent.clientY - bStartY)) + 'px';
                bulkWidget.style.right = 'auto'; 
            };

            const onMouseUpBulk = () => {
                isDraggingBulk = false;
                document.removeEventListener('mousemove', onMouseMoveBulk);
                document.removeEventListener('mouseup', onMouseUpBulk);
            };

            document.addEventListener('mousemove', onMouseMoveBulk);
            document.addEventListener('mouseup', onMouseUpBulk);
        });

        // --- 🟢 KANBAN MINI LOGIC & DRAGGING ---
        shadow.querySelector('#kb-close').addEventListener('click', () => kanbanWidget.classList.remove('show'));
        shadow.querySelector('#kb-open-full').addEventListener('click', () => {
            window.open(chrome.runtime.getURL('kanban_fullscreen.html'), '_blank');
            kanbanWidget.classList.remove('show');
        });

        const kbHeader = shadow.querySelector('#kanban-header');
        let isDraggingKb = false;
        let kStartX, kStartY, kStartLeft, kStartTop;

        kbHeader.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDraggingKb = true;
            kStartX = e.clientX; kStartY = e.clientY;
            const rect = kanbanWidget.getBoundingClientRect();
            kStartLeft = rect.left; kStartTop = rect.top;

            const onMouseMoveKb = (moveEvent) => {
                if (!isDraggingKb) return;
                kanbanWidget.style.left = (kStartLeft + (moveEvent.clientX - kStartX)) + 'px';
                kanbanWidget.style.top = (kStartTop + (moveEvent.clientY - kStartY)) + 'px';
                kanbanWidget.style.right = 'auto';
            };
            const onMouseUpKb = () => {
                isDraggingKb = false;
                document.removeEventListener('mousemove', onMouseMoveKb);
                document.removeEventListener('mouseup', onMouseUpKb);
            };
            document.addEventListener('mousemove', onMouseMoveKb);
            document.addEventListener('mouseup', onMouseUpKb);
        });

        // Due badge look per KanbanStore.due() status: [background, icon].
        const KB_MINI_DUE_LOOK = { overdue: ['#ef4444', 'exclamation-triangle-fill'], soon: ['#f59e0b', 'hourglass-split'], done: ['#10b981', 'check-circle-fill'], scheduled: ['#64748b', 'clock'] };

        // Board text is user content shown inside the host page, so it only ever goes in through
        // textContent or option text, never through innerHTML.
        function loadAndRenderKanbanMini() {
            KanbanStore.load().then((board) => {
                const container = shadow.querySelector('#kb-mini-container');
                const select = shadow.querySelector('#kb-mini-target');
                
                // Preserve active selection if it exists
                const currentSelection = select.value;
                container.replaceChildren();
                select.replaceChildren();

                board.columns.forEach((col) => {
                    // Populate quick-add dropdown
                    select.append(new Option(col.title, col.id));

                    // Build Accordion List
                    const header = document.createElement('div');
                    header.className = 'kb-mini-list-header';
                    const name = document.createElement('span');
                    name.textContent = col.title;
                    const count = document.createElement('span');
                    count.className = 'badge rounded-pill';
                    count.style.cssText = 'padding: 2px 6px; background: var(--bg-base); border: 1px solid var(--border-base); color: var(--icon-base);';
                    count.textContent = col.cards.length;
                    header.append(name, count);

                    const cardsDiv = document.createElement('div');
                    cardsDiv.className = 'kb-mini-cards'; 

                    header.onclick = () => cardsDiv.classList.toggle('open');

                    col.cards.forEach(card => {
                        const row = document.createElement('div');
                        row.className = card.completed ? 'kb-mini-card completed' : 'kb-mini-card';
                        row.innerHTML = `
                                <input type="checkbox" class="kb-mini-check" style="margin-top: 4px; cursor: pointer; transform: scale(1.1);">
                                <div><div class="kb-mini-title"></div></div>`;
                        const check = row.querySelector('.kb-mini-check');
                        check.checked = card.completed;
                        check.addEventListener('change', () => setMiniCardDone(col.id, card.id, check.checked));
                        row.querySelector('.kb-mini-title').textContent = card.title;

                        // Due date badge, same rules as the board
                        const due = KanbanStore.due(card);
                        if (due) {
                            const [bCol, icon] = KB_MINI_DUE_LOOK[due.status];
                            const badge = document.createElement('span');
                            badge.style.cssText = `font-size: 12px; padding: 2px 6px; background: ${bCol}; color: white; border-radius: 4px; margin-top: 4px; display: inline-block;`;
                            badge.innerHTML = `${ico(icon)} ${escHtml(due.text)}`;
                            row.lastElementChild.append(badge);
                        }
                        cardsDiv.append(row);
                    });

                    if (col.cards.length === 0) {
                        cardsDiv.innerHTML += '<div style="font-size: 12px; color: var(--icon-base); opacity: 0.7; text-align: center; padding: 8px; font-style: italic;">No tasks</div>';
                    }

                    container.appendChild(header);
                    container.appendChild(cardsDiv);
                });

                if (currentSelection) select.value = currentSelection;
            });
        }

        // Handle Checkbox Clicks (Syncs back to main board)
        function setMiniCardDone(colId, cardId, done) {
            KanbanStore.update((board) => {
                const card = board.columns.find(c => c.id === colId)?.cards.find(c => c.id === cardId);
                if (card) card.completed = done;
            }).then(loadAndRenderKanbanMini);
        }

        // Handle Quick Add
        shadow.querySelector('#kb-mini-add-btn').addEventListener('click', () => {
            const input = shadow.querySelector('#kb-mini-input');
            const title = input.value.trim();
            const colId = shadow.querySelector('#kb-mini-target').value;
            if (!title || !colId) return;

            let added = false;
            KanbanStore.update((board) => {
                const targetCol = board.columns.find(c => c.id === colId);
                if (targetCol) {
                    targetCol.cards.push(KanbanStore.newCard({ title }));
                    added = true;
                }
            }).then(() => {
                if (added) input.value = '';
                loadAndRenderKanbanMini();
            });
        });

        shadow.querySelector('#kb-mini-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') shadow.querySelector('#kb-mini-add-btn').click();
        });

        // 🟢 FIXED: Live Sync across ALL open tabs
        if (!window.marquisSyncAttached) {
                    
            // Listen for typing in Bulk & Sticky to save drafts in real-time
            shadow.querySelector('#bulk-editor').addEventListener('input', (e) => {
                chrome.storage.local.set({ bulkDraftText: e.target.value });
            });
            shadow.querySelector('#sticky-editor').addEventListener('input', (e) => {
                chrome.storage.local.set({ stickyDraftText: e.target.innerHTML });
            });

            // ✅ FIX: All widget close buttons — every panel ID must be listed here so
            //    activeMarquisWidget is cleared in storage on close. Missing entries = widget
            //    ghost-reopens when a new tab loads and reads stale storage.
            const closeBtnIds = '#sn-close, #bw-close, #fp-close, #kb-close, #qa-close, #seo-close, #dict-close, #hl-close, #set-close, #lang-close, #focus-close, #calc-close, #wx-close';
            shadow.querySelectorAll(closeBtnIds).forEach(btn => {
                btn.addEventListener('click', () => {
                    chrome.storage.local.set({ activeMarquisWidget: null });
                });
            });

            // ✅ FIX + Safe Live Sync (Catches orphaned script errors during hot-reloads)
            chrome.storage.onChanged.addListener((changes, area) => {
                try {
                    // If the extension was reloaded, chrome.runtime.id will be gone. Abort safely!
                    if (!chrome.runtime || !chrome.runtime.id) return;
                    const _root = document.getElementById('marquis-floating-root');
                    // Theme applies even while hidden, so a re-shown dock is never stale.
                    if (area === 'sync' && changes.marquis_theme) {
                        applyDockTheme(changes.marquis_theme.newValue || 'default');
                        return;
                    }
                    // ✅ FIX: Also bail if the dock is currently hidden (dock toggled off).
                    // Without this guard, storage changes from other tabs could silently mutate
                    // widget state inside a display:none dock, causing ghost reopens on re-enable.
                    if (area !== 'local' || !_root || _root.style.display === 'none') return;

                    // 1. Sync Active Widget
                    if (changes.activeMarquisWidget) {
                        if (changes.activeMarquisWidget.newValue) {
                            openWidgetById(changes.activeMarquisWidget.newValue);
                        } else {
                            hideWidgets(true);
                        }
                    }

                    // 2. Sync Input Drafts (Checks if value is different to prevent cursor jumping)
                    if (changes.bulkDraftText && shadow.querySelector('#bulk-editor').value !== changes.bulkDraftText.newValue) {
                        shadow.querySelector('#bulk-editor').value = changes.bulkDraftText.newValue || '';
                    }
                    if (changes.stickyDraftText && shadow.querySelector('#sticky-editor').innerHTML !== changes.stickyDraftText.newValue) {
                        shadow.querySelector('#sticky-editor').innerHTML = MarquisHtml.sanitize(changes.stickyDraftText.newValue);
                    }

                    // 3. Sync Kanban Mini-Board
                    if (changes.kanbanBoard && kanbanWidget && kanbanWidget.classList.contains('show')) {
                        loadAndRenderKanbanMini();
                    }
                    
                    // 4. Sync Dock Layout (Top/Bottom/Floating)
                    if (changes.dockLayout) {
                        applyDockLayout(changes.dockLayout.newValue);
                    }

                    // 5. Sync Floating Position
                    if (changes.dockPosition && dockLayout === 'floating') {
                        applyDocking(changes.dockPosition.newValue.hSide, changes.dockPosition.newValue.top);
                    }

                    // 6. Sync Tools Menu
                    if (changes.dockToolsConfig) {
                        dockTools = toolsFromConfig(changes.dockToolsConfig.newValue);
                        renderDockAndSettings();
                    }

                    // 7. Sync Focus Timer State
                    if (changes.focusState) fApply(changes.focusState.newValue, changes.focusState.oldValue);

                    // 9. Sync Ghost Opacity
                    if (changes.themeAlpha) {
                        const val = changes.themeAlpha.newValue;
                        dockRoot.style.setProperty('--alpha-val', val);
                        
                        // Update the slider in the dock's own settings menu if it's open
                        const alphaSlider = shadow.querySelector('#alpha-slider');
                        const alphaDisplay = shadow.querySelector('#alpha-val-display');
                        if (alphaSlider) alphaSlider.value = val;
                        if (alphaDisplay) alphaDisplay.innerText = parseFloat(val).toFixed(2);
                    }
                } catch (e) {
                    // Silently catch the invalidated context error so it doesn't flood the console
                    console.debug("[The Marquis] Orphaned sync listener caught and suppressed.");
                }
            });
            window.marquisSyncAttached = true;
        }
        
        loadAndRenderKanbanMini();

        // 🟢 FIXED: Handle Window Resize seamlessly and block orphaned script crashes
        let resizeTimer;
        window.addEventListener('resize', () => {
            if (window.hasMarquisDockInjected === false) return;
            try { if (!chrome.runtime || !chrome.runtime.id) return; } catch(e) { return; }

            clearTimeout(resizeTimer);
            
            // 1. Instantly kill transitions
            if (wrapper) wrapper.style.transition = 'none';
            allWidgets.forEach(w => {
                if (w) w.style.transition = 'none';
            });

            resizeTimer = setTimeout(() => {
                if (window.hasMarquisDockInjected === false) return;

                // 2. Snap dock to correct position
                if (dockLayout === 'floating') {
                    try {
                        chrome.storage.local.get(['dockPosition'], (res) => {
                            if (window.hasMarquisDockInjected === false) return;
                            if (res.dockPosition) applyDocking(res.dockPosition.hSide, res.dockPosition.top);
                            else applyDocking('right', '70%');
                        });
                    } catch(e) {
                        return; // Catch orphaned script error silently
                    }
                }
                
                // 3. Snap open widgets to new position
                allWidgets.forEach(w => {
                    if (w && w.classList.contains('show')) positionWidgetBesideDock(w);
                });

                // 4. Restore smooth animations on next frame
                requestAnimationFrame(() => {
                    if (window.hasMarquisDockInjected === false) return;
                    if (wrapper) wrapper.style.transition = 'left 0.3s cubic-bezier(0.19, 1, 0.22, 1), right 0.3s cubic-bezier(0.19, 1, 0.22, 1), top 0.3s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.2s ease';
                    allWidgets.forEach(w => {
                        if (w) w.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
                    });
                });
            }, 150); 
        });

        // --- 🟢 CAPTURE & RECORD LOGIC & DRAGGING ---
        shadow.querySelector('#fp-close').addEventListener('click', () => fpWidget.classList.remove('show'));

        const fpHeader = shadow.querySelector('#fp-header');
        let isDraggingFp = false;
        let fStartX, fStartY, fStartLeft, fStartTop;

        fpHeader.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return; 
            isDraggingFp = true;
            fStartX = e.clientX; fStartY = e.clientY;
            const rect = fpWidget.getBoundingClientRect();
            fStartLeft = rect.left; fStartTop = rect.top;

            const onMouseMoveFp = (moveEvent) => {
                if(!isDraggingFp) return;
                fpWidget.style.left = (fStartLeft + (moveEvent.clientX - fStartX)) + 'px';
                fpWidget.style.top = (fStartTop + (moveEvent.clientY - fStartY)) + 'px';
                fpWidget.style.right = 'auto'; 
            };
            const onMouseUpFp = () => {
                isDraggingFp = false;
                document.removeEventListener('mousemove', onMouseMoveFp);
                document.removeEventListener('mouseup', onMouseUpFp);
            };
            document.addEventListener('mousemove', onMouseMoveFp);
            document.addEventListener('mouseup', onMouseUpFp);
        });

        // Image Captures
        shadow.querySelector('#fp-cap-vis').addEventListener('click', () => {
            fpWidget.classList.remove('show');
            chrome.storage.local.set({ activeMarquisWidget: null }); // ✅ FIX: action-triggered close
            if (isExpanded) toggleDock(); // 🟢 NEW: Collapse the menu
            // background.js hides #marquis-floating-root around each screenshot, so no opacity timers here.
            chrome.runtime.sendMessage({ action: "capture", type: "visible" });
        });

        shadow.querySelector('#fp-cap-full').addEventListener('click', () => {
            fpWidget.classList.remove('show');
            chrome.storage.local.set({ activeMarquisWidget: null }); // ✅ FIX: action-triggered close
            if (isExpanded) toggleDock(); // 🟢 NEW: Collapse the menu
            chrome.runtime.sendMessage({ action: "capture", type: "full" });
        });

        // Recording runs in Marquis' own recorder window (recorder.html), never inside this page:
        // camera/mic prompts name the extension, and the page can't see the streams.
        shadow.querySelector('#fp-start-rec').addEventListener('click', () => {
            fpWidget.classList.remove('show');
            chrome.storage.local.set({ activeMarquisWidget: null }); // ✅ FIX: action-triggered close
            if (isExpanded) toggleDock();
            chrome.runtime.sendMessage({
                action: 'openRecorder',
                options: {
                    mic: shadow.querySelector('#recMicToggle').checked,
                    cam: shadow.querySelector('#recCamToggle').checked,
                    draw: shadow.querySelector('#recDrawToggle').checked,
                    mode: shadow.querySelector('#recCamera').checked ? 'camera' : 'screen'
                }
            }).catch(() => {}); // extension reloaded: nothing to open
        });

        // --- 🟢 QA MINI LOGIC & DRAGGING ---
        shadow.querySelector('#qa-close').addEventListener('click', () => qaWidget.classList.remove('show'));
        shadow.querySelector('#qa-open-full').addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: "launch_tool", tool: 'qa' });
            qaWidget.classList.remove('show');
        });

        const qaHeader = shadow.querySelector('#qa-header');
        let isDraggingQa = false;
        let qStartX, qStartY, qStartLeft, qStartTop;

        qaHeader.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDraggingQa = true;
            qStartX = e.clientX; qStartY = e.clientY;
            const rect = qaWidget.getBoundingClientRect();
            qStartLeft = rect.left; qStartTop = rect.top;

            const onMouseMoveQa = (moveEvent) => {
                if (!isDraggingQa) return;
                qaWidget.style.left = (qStartLeft + (moveEvent.clientX - qStartX)) + 'px';
                qaWidget.style.top = (qStartTop + (moveEvent.clientY - qStartY)) + 'px';
                qaWidget.style.right = 'auto';
            };
            const onMouseUpQa = () => {
                isDraggingQa = false;
                document.removeEventListener('mousemove', onMouseMoveQa);
                document.removeEventListener('mouseup', onMouseUpQa);
            };
            document.addEventListener('mousemove', onMouseMoveQa);
            document.addEventListener('mouseup', onMouseUpQa);
        });

        // 1. Emulation Launcher
        shadow.querySelectorAll('.qa-device-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const sim = btn.getAttribute('data-sim');
                const url = encodeURIComponent(window.location.href);
                let query = '';
                
                if (sim === 'phone') query = `w=393&h=852&type=phone&notch=notch-dynamic&os=ios`; // iPhone 15
                if (sim === 'tablet') query = `w=820&h=1180&type=tablet&notch=notch-none&os=ios`; // iPad Air
                if (sim === 'laptop') query = `w=1536&h=960&type=desktop&notch=notch-mac&os=mac`; // Macbook Pro
                if (sim === 'desktop') query = `w=1920&h=1080&type=desktop&notch=notch-none&os=win`; // Desktop FHD
                
                window.open(chrome.runtime.getURL(`simulator.html?url=${url}&${query}`), '_blank');
            });
        });

        // 2. CSS Grid Injector
        shadow.querySelector('#qa-mini-grid').addEventListener('change', (e) => {
            const show = e.target.checked;
            let grid = document.getElementById('odh-layout-grid');
            
            if (!show) {
                if (grid) grid.remove();
                return;
            }
            if (!grid) {
                grid = document.createElement('div');
                grid.id = 'odh-layout-grid';
                grid.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 999998; pointer-events: none; display: flex; justify-content: center;`;
                document.body.appendChild(grid);
            }

            let innerHtml = `<div style="display: flex; width: 100%; max-width: 1140px; height: 100%; gap: 24px; padding: 0 12px;">`;
            for (let i=0; i<12; i++) {
                innerHtml += `<div style="flex: 1; height: 100%; background-color: rgba(255, 0, 0, 0.15);"></div>`;
            }
            innerHtml += `</div>`;
            grid.innerHTML = innerHtml;
        });

        // 3. Vision Filters
        shadow.querySelector('#qa-mini-vision').addEventListener('change', (e) => {
            const type = e.target.value;
            
            // Inject SVG definitions if testing colorblindness
            let svg = document.getElementById('odh-vision-filters');
            if (!svg) {
                svg = document.createElement('div');
                svg.id = 'odh-vision-filters';
                svg.style.display = 'none';
                svg.innerHTML = `
                    <svg>
                        <defs>
                            <filter id="odh-protanopia">
                                <feColorMatrix type="matrix" values="0.567, 0.433, 0, 0, 0  0.558, 0.442, 0, 0, 0  0, 0.242, 0.758, 0, 0  0, 0, 0, 1, 0"/>
                            </filter>
                            <filter id="odh-deuteranopia">
                                <feColorMatrix type="matrix" values="0.625, 0.375, 0, 0, 0  0.7, 0.3, 0, 0, 0  0, 0.3, 0.7, 0, 0  0, 0, 0, 1, 0"/>
                            </filter>
                        </defs>
                    </svg>
                `;
                document.body.appendChild(svg);
            }

            if (type === 'none') {
                document.documentElement.style.filter = '';
            } else if (type === 'protanopia' || type === 'deuteranopia') {
                document.documentElement.style.filter = `url(#odh-${type})`;
            } else {
                document.documentElement.style.filter = type;
            }
        });

        // 4. Live CSS Inspector
        let cssTooltip = null;
        let hoveredEl = null;
        let origOutline = '';

        function rgb2hex(rgb) {
            let res = rgb.match(/\d+/g);
            if (!res || res.length < 3) return rgb;
            return "#" + res.slice(0,3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
        }

        const onInspectHover = (e) => {
            // 🟢 Prevent the inspector from highlighting the Dock itself!
            if (e.target.closest('#marquis-floating-root')) return;
            
            e.preventDefault(); e.stopPropagation();
            const el = e.target;
            if (el.id === 'odh-css-tooltip') return;

            origOutline = el.style.outline;
            el.style.outline = '2px dashed #0d6efd';
            hoveredEl = el;

            const comp = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            
            const fontStack = comp.fontFamily.split(',')[0].replace(/['"]/g, '');
            const hexColor = rgb2hex(comp.color);
            const hexBg = rgb2hex(comp.backgroundColor);

            // Check if className is a string (SVG elements have objects instead of strings)
            const elClass = (el.className && typeof el.className === 'string') ? '.' + el.className.split(' ').join('.') : '';

            cssTooltip.innerHTML = `
                <div style="font-weight:bold; color:#0d6efd; margin-bottom:8px; font-size:14px; border-bottom: 1px solid #495057; padding-bottom:4px;">
                    ${el.tagName.toLowerCase()}${escHtml(elClass)}
                </div>
                <div style="display:grid; grid-template-columns: 50px 1fr; gap: 4px; line-height: 1.4;">
                    <span style="color:#adb5bd;">Size</span> <span style="font-weight:bold;">${rect.width.toFixed(1)} x ${rect.height.toFixed(1)}</span>
                    <span style="color:#adb5bd;">Font</span> <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(fontStack)}">${escHtml(fontStack)}</span>
                    <span style="color:#adb5bd;">Text</span> <span>${comp.fontSize} / ${comp.fontWeight}</span>
                    <span style="color:#adb5bd;">Color</span> <div style="display:flex;align-items:center;"><div style="width:12px;height:12px;background:${comp.color};border:1px solid #666;margin-right:6px;border-radius:2px;"></div> ${hexColor}</div>
                    <span style="color:#adb5bd;">Bg</span> <div style="display:flex;align-items:center;"><div style="width:12px;height:12px;background:${comp.backgroundColor};border:1px solid #666;margin-right:6px;border-radius:2px;"></div> ${hexBg}</div>
                </div>
                <div style="margin-top:8px; font-size:12px; color:#ffc107; text-align:center; opacity: 0.8;">Click element to copy CSS</div>
            `;
            cssTooltip.style.display = 'block';

            let top = e.clientY + 15; let left = e.clientX + 15;
            if (top + cssTooltip.offsetHeight > window.innerHeight) top = window.innerHeight - cssTooltip.offsetHeight - 10;
            if (left + cssTooltip.offsetWidth > window.innerWidth) left = window.innerWidth - cssTooltip.offsetWidth - 10;
            cssTooltip.style.top = top + 'px'; cssTooltip.style.left = left + 'px';
        };

        const onInspectOut = (e) => {
            if (hoveredEl) hoveredEl.style.outline = origOutline;
            cssTooltip.style.display = 'none';
        };

        const onInspectClick = (e) => {
            if (e.target.closest('#marquis-floating-root')) return;
            e.preventDefault(); e.stopPropagation();
            if(!hoveredEl) return;
            
            const comp = window.getComputedStyle(hoveredEl);
            let cssText = `font-family: ${comp.fontFamily};\nfont-size: ${comp.fontSize};\nfont-weight: ${comp.fontWeight};\ncolor: ${rgb2hex(comp.color)};\nbackground-color: ${rgb2hex(comp.backgroundColor)};\n`;
            navigator.clipboard.writeText(cssText);
            
            const originalBg = cssTooltip.style.background;
            cssTooltip.style.background = '#198754'; 
            setTimeout(() => { cssTooltip.style.background = originalBg; }, 300);
        };

        shadow.querySelector('#qa-mini-css-inspector').addEventListener('change', (e) => {
            const turnOn = e.target.checked;
            
            if (!turnOn) {
                document.removeEventListener('mouseover', onInspectHover, true);
                document.removeEventListener('mouseout', onInspectOut, true);
                document.removeEventListener('click', onInspectClick, true);
                if (cssTooltip) cssTooltip.style.display = 'none';
                if (hoveredEl) hoveredEl.style.outline = origOutline;
                return;
            }

            if (!cssTooltip) {
                cssTooltip = document.createElement('div');
                cssTooltip.id = 'odh-css-tooltip';
                cssTooltip.style.cssText = `
                    position: fixed; z-index: 2147483647; background: #212529; color: #f8f9fa;
                    font-family: monospace; font-size: 12px; padding: 12px; border-radius: 8px;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.4); pointer-events: none;
                    max-width: 280px; display: none; border: 1px solid #495057;
                `;
                document.body.appendChild(cssTooltip);
            }

            document.addEventListener('mouseover', onInspectHover, true);
            document.addEventListener('mouseout', onInspectOut, true);
            document.addEventListener('click', onInspectClick, true);
        });

        // 4.5. Eyedropper / Color Picker
        const eyedropperBtn = shadow.querySelector('#qa-mini-eyedropper-btn');
        if (eyedropperBtn) {
            eyedropperBtn.addEventListener('click', async () => {
                // Firefox has no EyeDropper: scripts/screen_picker.js (injected with the dock) picks from a screenshot.
                const eyeDropper = new (window.EyeDropper || globalThis.MarquisEyeDropper)();
                
                // Optional: Provide visual feedback that it's active
                const originalText = eyedropperBtn.innerText;
                eyedropperBtn.innerText = 'Picking...';
                eyedropperBtn.disabled = true;

                try {
                    const result = await eyeDropper.open();
                    const hexColor = result.sRGBHex;
                    
                    // Copy to clipboard
                    await navigator.clipboard.writeText(hexColor);
                    
                    // Success feedback
                    eyedropperBtn.innerText = hexColor;
                    eyedropperBtn.style.background = hexColor;
                    // Ensure text is readable against light/dark picked colors
                    const rgb = parseInt(hexColor.slice(1), 16);
                    const r = (rgb >> 16) & 0xff;
                    const g = (rgb >>  8) & 0xff;
                    const b = (rgb >>  0) & 0xff;
                    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b; // per ITU-R BT.709
                    eyedropperBtn.style.color = luma < 128 ? 'white' : 'black';

                    if (window.showGlobalAlert) {
                        window.showGlobalAlert("Color Copied!", `Hex code ${hexColor} copied to clipboard.`, "success");
                    }
                } catch (e) {
                    // User canceled the eyedropper
                    console.log("[The Marquis] Eyedropper canceled by user.");
                } finally {
                    // Reset button after 3 seconds if a color was picked, or immediately if canceled
                    setTimeout(() => {
                        eyedropperBtn.innerText = originalText;
                        eyedropperBtn.disabled = false;
                        eyedropperBtn.style.background = '';
                        eyedropperBtn.style.color = '';
                    }, 3000);
                }
            });
        }

        // 5. X-Ray Layout Outlines
        shadow.querySelector('#qa-mini-xray').addEventListener('change', (e) => {
            const turnOn = e.target.checked;
            const styleId = 'odh-xray-styles';
            let styleEl = document.getElementById(styleId);
            
            if (turnOn) {
                if (!styleEl) {
                    styleEl = document.createElement('style');
                    styleEl.id = styleId;
                    // Inject outlines into the host page, skipping the shadow DOM dock!
                    styleEl.textContent = `
                        html * { outline: 1px solid rgba(255, 0, 0, 0.15) !important; }
                        div { outline: 1px solid rgba(13, 110, 253, 0.3) !important; }
                        section, article, header, footer, nav { outline: 2px solid rgba(25, 135, 84, 0.4) !important; background: rgba(25, 135, 84, 0.05) !important; }
                        img, svg, picture, video { outline: 2px solid rgba(255, 193, 7, 0.5) !important; background: rgba(255, 193, 7, 0.05) !important; }
                        a, button { outline: 1px solid rgba(220, 53, 69, 0.4) !important; }
                    `;
                    document.head.appendChild(styleEl);
                }
            } else {
                if (styleEl) styleEl.remove();
            }
        });

        // 6. Web Paint Engine
        shadow.querySelector('#qa-mini-paint').addEventListener('change', (e) => {
            const turnOn = e.target.checked;
            let canvas = document.getElementById('odh-qa-paint-canvas');
            let toolbar = document.getElementById('odh-qa-paint-toolbar');
            
            // If toggled off, destroy the canvas and toolbar
            if (!turnOn) {
                if (canvas) canvas.remove();
                if (toolbar) toolbar.remove();
                return;
            }

            if (!canvas) {
                // 1. Create the drawing canvas overlay
                canvas = document.createElement('canvas');
                canvas.id = 'odh-qa-paint-canvas';
                canvas.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483645; pointer-events: auto; cursor: crosshair;';
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
                document.body.appendChild(canvas);

                const ctx = canvas.getContext('2d');
                ctx.lineWidth = 4;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.strokeStyle = '#ef4444';

                let isDrawing = false;

                // 2. Bind drawing events
                canvas.addEventListener('mousedown', (ev) => {
                    isDrawing = true;
                    ctx.beginPath();
                    ctx.moveTo(ev.clientX, ev.clientY);
                });
                canvas.addEventListener('mousemove', (ev) => {
                    if (isDrawing) {
                        ctx.lineTo(ev.clientX, ev.clientY);
                        ctx.stroke();
                    }
                });
                canvas.addEventListener('mouseup', () => isDrawing = false);
                canvas.addEventListener('mouseleave', () => isDrawing = false);

                // Handle window resizing safely
                window.addEventListener('resize', () => {
                    if (document.getElementById('odh-qa-paint-canvas')) {
                        canvas.width = window.innerWidth;
                        canvas.height = window.innerHeight;
                        ctx.lineWidth = document.getElementById('odh-qa-paint-size')?.value || 4;
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                        ctx.strokeStyle = document.getElementById('odh-qa-paint-color')?.value || '#ef4444';
                    }
                });

                // 3. Create the floating toolbar
                toolbar = document.createElement('div');
                toolbar.id = 'odh-qa-paint-toolbar';
                // The toolbar sits in the page, outside the shadow root: copy the dock theme's resolved tokens onto it.
                const hostCss = getComputedStyle(dockRoot);
                ['--mq-surface', '--mq-text', '--mq-accent', '--mq-danger'].forEach((k) => toolbar.style.setProperty(k, hostCss.getPropertyValue(k).trim()));
                toolbar.style.cssText += 'position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); z-index: 2147483646; background: color-mix(in srgb, var(--mq-surface, #0f172a) 95%, transparent); backdrop-filter: blur(10px); padding: 10px 20px; border-radius: 50px; display: flex; gap: 15px; align-items: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1);';
                
                toolbar.innerHTML = `
                    <div style="color: var(--mq-text, white); font-family: sans-serif; font-size: 12px; font-weight: bold; letter-spacing: 0.5px;">WEB PAINT</div>
                    <div style="width: 1px; height: 16px; background: color-mix(in srgb, var(--mq-text, white) 20%, transparent);"></div>
                    <input type="color" id="odh-qa-paint-color" value="#ef4444" style="width: 26px; height: 26px; padding: 0; border: none; border-radius: 50%; cursor: pointer; background: transparent;" title="Brush Color">
                    <input type="range" id="odh-qa-paint-size" min="2" max="30" value="4" style="width: 80px; accent-color: var(--mq-accent, #3b82f6); cursor: pointer;" title="Brush Size">
                    <button id="odh-qa-paint-clear" style="background: none; border: none; color: var(--mq-text, white); font-size: 18px; cursor: pointer; transition: opacity 0.1s;" title="Clear Canvas" aria-label="Clear canvas">${pageIco('trash3')}</button>
                    <div style="width: 1px; height: 16px; background: color-mix(in srgb, var(--mq-text, white) 20%, transparent);"></div>
                    <button id="odh-qa-paint-close" style="background: none; border: none; color: var(--mq-danger); font-size: 18px; cursor: pointer; transition: opacity 0.1s;" title="Exit Paint" aria-label="Exit paint">${pageIco('x-circle')}</button>
                `;
                document.body.appendChild(toolbar);

                // 4. Toolbar Event Listeners
                document.getElementById('odh-qa-paint-color').addEventListener('input', (ev) => ctx.strokeStyle = ev.target.value);
                document.getElementById('odh-qa-paint-size').addEventListener('input', (ev) => ctx.lineWidth = ev.target.value);
                
                const btnClear = document.getElementById('odh-qa-paint-clear');
                btnClear.addEventListener('click', () => ctx.clearRect(0, 0, canvas.width, canvas.height));
                // Press feedback dims the button in place (it used to shrink).
                btnClear.addEventListener('mousedown', () => btnClear.style.opacity = '0.6');
                btnClear.addEventListener('mouseup', () => btnClear.style.opacity = '');
                btnClear.addEventListener('mouseleave', () => btnClear.style.opacity = '');

                const btnClose = document.getElementById('odh-qa-paint-close');
                btnClose.addEventListener('click', () => {
                    canvas.remove();
                    toolbar.remove();
                    // Turn off the switch in the dock UI automatically
                    const toggle = shadow.querySelector('#qa-mini-paint');
                    if(toggle) toggle.checked = false;
                });
                btnClose.addEventListener('mousedown', () => btnClose.style.opacity = '0.6');
                btnClose.addEventListener('mouseup', () => btnClose.style.opacity = '');
                btnClose.addEventListener('mouseleave', () => btnClose.style.opacity = '');
            }
        });

        // --- 🟢 SEO MINI LOGIC & DRAGGING ---
        shadow.querySelector('#seo-close').addEventListener('click', () => seoWidget.classList.remove('show'));

        const seoHeader = shadow.querySelector('#seo-header');
        let isDraggingSeo = false;
        let seoStartX, seoStartY, seoStartLeft, seoStartTop;

        seoHeader.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDraggingSeo = true;
            seoStartX = e.clientX; seoStartY = e.clientY;
            const rect = seoWidget.getBoundingClientRect();
            seoStartLeft = rect.left; seoStartTop = rect.top;

            const onMouseMoveSeo = (moveEvent) => {
                if (!isDraggingSeo) return;
                seoWidget.style.left = (seoStartLeft + (moveEvent.clientX - seoStartX)) + 'px';
                seoWidget.style.top = (seoStartTop + (moveEvent.clientY - seoStartY)) + 'px';
                seoWidget.style.right = 'auto';
            };
            const onMouseUpSeo = () => {
                isDraggingSeo = false;
                document.removeEventListener('mousemove', onMouseMoveSeo);
                document.removeEventListener('mouseup', onMouseUpSeo);
            };
            document.addEventListener('mousemove', onMouseMoveSeo);
            document.addEventListener('mouseup', onMouseUpSeo);
        });

        // 1. Crawl Current Page
        shadow.querySelector('#seo-mini-crawl-btn').addEventListener('click', (e) => {
            const btn = e.target;
            const originalHtml = btn.innerHTML;
            btn.innerHTML = 'Crawling...';
            btn.disabled = true;

            try {
                // 🟢 FIXED: We are already inside the page, just read the DOM directly!
                const getMeta = (n) => document.querySelector(`meta[name="${n}"]`)?.content || null;
                const bodyText = document.body.innerText || "";
                const wordCount = bodyText.trim().split(/\s+/).length;
                const links = document.querySelectorAll('a[href]').length;
                const images = Array.from(document.images).filter(i => i.width > 10 && i.height > 10 && !i.src.startsWith('data:'));
                const badImages = images.filter(i => !(i.alt && i.alt.trim().length > 0)).length;

                const data = {
                    title: document.title || "Missing Title",
                    desc: getMeta('description') || "Missing Meta Description",
                    robots: getMeta('robots') || 'index, follow',
                    wordCount,
                    links,
                    badImages
                };

                shadow.querySelector('#seo-mini-title').innerText = data.title;
                shadow.querySelector('#seo-mini-title').style.color = data.title === "Missing Title" ? '#ef4444' : 'var(--icon-hover-color)';
                
                shadow.querySelector('#seo-mini-desc').innerText = data.desc;
                shadow.querySelector('#seo-mini-desc').style.color = data.desc === "Missing Meta Description" ? '#ef4444' : 'var(--icon-hover-color)';
                
                shadow.querySelector('#seo-mini-robots').innerText = data.robots;
                
                shadow.querySelector('#seo-mini-words').innerText = data.wordCount.toLocaleString();
                shadow.querySelector('#seo-mini-links').innerText = data.links.toLocaleString();
                shadow.querySelector('#seo-mini-imgs').innerText = data.badImages.toLocaleString();
                
                if (data.badImages === 0) shadow.querySelector('#seo-mini-imgs').style.color = 'var(--mq-success)';

                shadow.querySelector('#seo-mini-results').style.display = 'block';

            } catch (err) {
                console.warn("[The Marquis] My SEO inspection was thwarted:", err.message);
                btn.innerHTML = 'Audit Thwarted';
            }

            setTimeout(() => {
                btn.innerHTML = originalHtml;
                btn.disabled = false;
            }, 500); 
        });

        // 2. Alt Text Visualizer Overlay
        shadow.querySelector('#seo-mini-alt-toggle').addEventListener('change', (e) => {
            const show = e.target.checked;
            
            // 🟢 FIXED: Direct DOM manipulation
            document.querySelectorAll('.omnidesk-alt-overlay').forEach(el => el.remove());
            
            if (!show) {
                document.querySelectorAll('img').forEach(img => img.style.outline = ''); // Clear outlines
                return;
            }

            document.querySelectorAll('img').forEach(img => {
                if (img.width < 20 || img.height < 20) return;
                
                const hasAlt = img.alt && img.alt.trim().length > 0;
                const color = hasAlt ? '#198754' : '#dc3545';
                const text = hasAlt ? `ALT: ${img.alt}` : 'MISSING ALT';
                
                const rect = img.getBoundingClientRect();
                if (rect.width === 0) return;

                const badge = document.createElement('div');
                badge.className = 'omnidesk-alt-overlay';
                badge.textContent = text;
                badge.style.cssText = `
                    position: absolute;
                    left: ${rect.left + window.scrollX}px;
                    top: ${rect.top + window.scrollY}px;
                    background-color: ${color};
                    color: white;
                    padding: 2px 6px;
                    font-size: 12px;
                    font-weight: bold;
                    border-radius: 4px;
                    z-index: 2147483645;
                    pointer-events: none;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                    max-width: ${rect.width}px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                `;
                document.body.appendChild(badge);
                img.style.outline = `3px solid ${color}`;
            });
        });

        // --- 🟢 DICTIONARY MINI LOGIC & DRAGGING ---
        shadow.querySelector('#dict-close').addEventListener('click', () => dictWidget.classList.remove('show'));
            
        // 🟢 FIXED: The "Open Full" button listener is deleted here!

        const dictHeader = shadow.querySelector('#dict-header');
        let isDraggingDict = false;
        let dictStartX, dictStartY, dictStartLeft, dictStartTop;

        dictHeader.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDraggingDict = true;
            dictStartX = e.clientX; dictStartY = e.clientY;
            const rect = dictWidget.getBoundingClientRect();
            dictStartLeft = rect.left; dictStartTop = rect.top;

            const onMouseMoveDict = (moveEvent) => {
                if (!isDraggingDict) return;
                // 🟢 FIXED: Explicitly clear right/bottom so manual drags don't fight the dock
                dictWidget.style.right = 'auto';
                dictWidget.style.bottom = 'auto';
                dictWidget.style.left = (dictStartLeft + (moveEvent.clientX - dictStartX)) + 'px';
                dictWidget.style.top = (dictStartTop + (moveEvent.clientY - dictStartY)) + 'px';
            };
            const onMouseUpDict = () => {
                isDraggingDict = false;
                document.removeEventListener('mousemove', onMouseMoveDict);
                document.removeEventListener('mouseup', onMouseUpDict);
            };
            document.addEventListener('mousemove', onMouseMoveDict);
            document.addEventListener('mouseup', onMouseUpDict);
        });

        // 🟢 FIXED: Complete Dictionary API Engine with Autocomplete & Secure Audio
        const dictInput = shadow.querySelector('#dict-mini-input');
        const dictSearchBtn = shadow.querySelector('#dict-mini-search-btn');
        const dictResultsBox = shadow.querySelector('#dict-mini-results');
        const dictSugBox = shadow.querySelector('#dict-mini-suggestions');
        let dictTimeout;

        // Auto-Suggest Logic
        dictInput.addEventListener('input', (e) => {
            clearTimeout(dictTimeout);
            const query = e.target.value.trim();
            if (query.length < 2) {
                dictSugBox.style.display = 'none';
                return;
            }
            dictTimeout = setTimeout(async () => {
                try {
                    // 🟢 REVERTED: Hardcoded back to English Datamuse
                    const sugUrl = `https://api.datamuse.com/sug?s=${encodeURIComponent(query)}`;
                    const res = await apiFetch(sugUrl);
                    const data = await res.json();
                    dictSugBox.innerHTML = '';
                    if (data.length === 0) {
                        dictSugBox.style.display = 'none';
                        return;
                    }
                    data.slice(0, 6).forEach(item => {
                        const div = document.createElement('div');
                        div.className = 'dict-sug-item';
                        // Third-party API text: escaped, with the typed prefix in bold (no RegExp built from input).
                        const word = String(item.word);
                        const typed = word.toLowerCase().startsWith(query.toLowerCase()) ? query.length : 0;
                        div.innerHTML = `<b style="color: var(--icon-hover-color);">${escHtml(word.slice(0, typed))}</b>${escHtml(word.slice(typed))}`;
                        
                        div.addEventListener('click', () => {
                            dictInput.value = item.word;
                            dictSugBox.style.display = 'none';
                            fetchMiniDictionary(item.word);
                        });
                        dictSugBox.appendChild(div);
                    });
                    dictSugBox.style.display = 'block';
                } catch(err) { console.error("[The Marquis] Alas, my suggestion engine encountered a hitch:", err); }
            }, 300);
        });

        // Close suggestions if clicked outside
        shadow.addEventListener('click', (e) => {
            if (e.target !== dictInput && !dictSugBox.contains(e.target)) dictSugBox.style.display = 'none';
        });

        // Trigger Searches
        dictInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                dictSugBox.style.display = 'none';
                fetchMiniDictionary(dictInput.value.trim());
            }
        });
        
        dictSearchBtn.addEventListener('click', () => {
            dictSugBox.style.display = 'none';
            fetchMiniDictionary(dictInput.value.trim());
        });

        // Main Fetcher
        async function fetchMiniDictionary(query) {
            if (!query) return;
            dictResultsBox.innerHTML = '<div class="text-center" style="color: var(--icon-base); opacity: 0.7; padding: 20px 0;">Searching...</div>';

            try {
                // 🟢 REVERTED: Hardcoded back to English Free Dictionary
                const response = await apiFetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`);
                const data = await response.json();

                if (!response.ok) {
                    dictResultsBox.innerHTML = `<div class="text-center" style="color: var(--mq-danger); padding: 20px 0;"><b>Word Absent</b><br>The Marquis's archives hold no record for "${escHtml(query)}".</div>`;
                    return;
                }

                const entry = data[0];
                const phoneticText = entry.phonetic || (entry.phonetics.find(p => p.text) || {}).text || 'N/A';
                
                // 🟢 FIXED: Find audio and FORCE it to use secure https://
                const audioObj = entry.phonetics.find(p => p.audio && p.audio.length > 0);
                let safeAudioUrl = '';
                if (audioObj) {
                    safeAudioUrl = audioObj.audio.startsWith('//') ? 'https:' + audioObj.audio : audioObj.audio;
                    if (!/^https:\/\//i.test(safeAudioUrl)) safeAudioUrl = ''; // falls back to speech synthesis
                }
                // Everything below comes from a third-party API and is shown inside the host page.
                const word = escHtml(entry.word);
                const phonetic = escHtml(phoneticText);
                const audioSrc = escHtml(safeAudioUrl);

                // 🟢 FIXED: Inject a hidden <audio> tag to bypass detached autoplay blocks, and prepare TTS fallback
                let html = `
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border-base); padding-bottom: 8px; margin-bottom: 12px;">
                        <div>
                            <div class="dict-word" style="margin-bottom: 0;">${word}</div>
                            <div class="dict-phonetic" style="margin-bottom: 0; margin-top: 4px;">${phonetic}</div>
                        </div>
                        ${safeAudioUrl ? `
                        <audio id="dict-mini-audio-player" src="${audioSrc}"></audio>
                        <button id="dict-mini-audio" data-word="${word}" class="bs-btn btn-primary" style="border-radius: 50%; width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; flex-shrink: 0;" title="Play Audio">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z"/><path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.61 3.89l.706.706z"/><path d="M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z"/></svg>
                        </button>
                        ` : `
                        <button id="dict-mini-audio-tts" data-word="${word}" class="bs-btn btn-primary" style="border-radius: 50%; width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; flex-shrink: 0;" title="Play Audio">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z"/><path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.61 3.89l.706.706z"/><path d="M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z"/></svg>
                        </button>
                        `}
                    </div>
                `;

                entry.meanings.forEach(meaning => {
                    html += `<div class="dict-pos">${escHtml(meaning.partOfSpeech)}</div>`;
                    meaning.definitions.slice(0, 3).forEach((def, i) => {
                        html += `<div class="dict-def"><b>${i+1}.</b> ${escHtml(def.definition)}`;
                        if (def.example) html += `<div class="dict-example">"${escHtml(def.example)}"</div>`;
                        html += `</div>`;
                    });
                });

                dictResultsBox.innerHTML = html;

                // 🟢 FIXED: Bind Audio with TTS Fallback Engine
                const audioBtn = dictResultsBox.querySelector('#dict-mini-audio');
                const audioPlayer = dictResultsBox.querySelector('#dict-mini-audio-player');
                const ttsBtn = dictResultsBox.querySelector('#dict-mini-audio-tts');

                // The ultimate fallback: Native OS Text-to-Speech
                const playTTS = (word) => {
                    const utterance = new SpeechSynthesisUtterance(word);
                    utterance.lang = 'en-US';
                    window.speechSynthesis.speak(utterance);
                };

                if (audioBtn && audioPlayer) {
                    audioBtn.addEventListener('click', (e) => {
                        const word = e.currentTarget.getAttribute('data-word');
                        audioPlayer.currentTime = 0;
                        audioPlayer.play().catch(err => {
                            console.warn("[The Marquis] The host page's security restricts my native audio. Fear not, I shall employ my robotic understudy (TTS) instead.", err);
                            playTTS(word);
                        });
                    });
                }

                if (ttsBtn) {
                    ttsBtn.addEventListener('click', (e) => {
                        playTTS(e.currentTarget.getAttribute('data-word'));
                    });
                }

            } catch (err) {
                dictResultsBox.innerHTML = `<div class="text-center" style="color: var(--mq-danger); padding: 20px 0;">Network Interrupted. Pray, check your connection and summon me again.</div>`;
            }
        }

        // --- 🟢 HIGHLIGHTER MINI LOGIC & DRAGGING ---
        shadow.querySelector('#hl-close').addEventListener('click', () => hlWidget.classList.remove('show'));

        const hlHeader = shadow.querySelector('#hl-header');
        let isDraggingHl = false;
        let hStartX, hStartY, hStartLeft, hStartTop;

        hlHeader.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDraggingHl = true;
            hStartX = e.clientX; hStartY = e.clientY;
            const rect = hlWidget.getBoundingClientRect();
            hStartLeft = rect.left; hStartTop = rect.top;

            const onMouseMoveHl = (moveEvent) => {
                if (!isDraggingHl) return;
                hlWidget.style.right = 'auto';
                hlWidget.style.bottom = 'auto';
                hlWidget.style.left = (hStartLeft + (moveEvent.clientX - hStartX)) + 'px';
                hlWidget.style.top = (hStartTop + (moveEvent.clientY - hStartY)) + 'px';
            };
            const onMouseUpHl = () => {
                isDraggingHl = false;
                document.removeEventListener('mousemove', onMouseMoveHl);
                document.removeEventListener('mouseup', onMouseUpHl);
            };
            document.addEventListener('mousemove', onMouseMoveHl);
            document.addEventListener('mouseup', onMouseUpHl);
        });

        // Core Native DOM Highlighter Engine
        let hlActiveTerms = [];
        const HL_PALETTE = ['#fef08a', '#7dd3fc', '#86efac', '#67e8f9', '#fdba74', '#fca5a5', '#d8b4fe', '#cbd5e1'];
        let hlNavIndex = -1;
        let hlTermNav = {};

        const hlInput = shadow.querySelector('#hl-mini-input');
        const hlAddBtn = shadow.querySelector('#hl-mini-add');
        const hlClearBtn = shadow.querySelector('#hl-mini-clear');
        const hlChipsContainer = shadow.querySelector('#hl-mini-chips');
        const hlCount = shadow.querySelector('#hl-mini-count');
        const hlPrev = shadow.querySelector('#hl-mini-prev');
        const hlNext = shadow.querySelector('#hl-mini-next');
        const hlContext = shadow.querySelector('#hl-mini-context');
        const hlCase = shadow.querySelector('#hl-mini-case');
        const hlWhole = shadow.querySelector('#hl-mini-whole');

        function hlRenderUI(counts = {}) {
            hlChipsContainer.innerHTML = '';
            if (hlActiveTerms.length === 0) {
                hlChipsContainer.innerHTML = '<div style="color: var(--icon-base); opacity: 0.7; font-style: italic; width: 100%; text-align: center; padding: 10px 0;">No active keywords...</div>';
                hlCount.innerText = '0 Matches';
                hlContext.style.display = 'none';
                return;
            }

            hlActiveTerms.forEach((term, idx) => {
                const color = HL_PALETTE[idx % HL_PALETTE.length];
                const chip = document.createElement('div');
                chip.className = 'hl-chip';
                chip.style.backgroundColor = color;
                chip.innerHTML = `
                    <span>${escHtml(term)}</span>
                    <span style="background: rgba(255,255,255,0.6); padding: 2px 6px; border-radius: 4px; font-size: 12px;">${counts[term] || 0}</span>
                    <button class="hl-chip-close" aria-label="Remove keyword">${ico('x')}</button>
                `;
                
                chip.addEventListener('click', (e) => {
                    if(e.target.tagName === 'BUTTON') return;
                    hlJumpToSpecific(term);
                });

                chip.querySelector('.hl-chip-close').addEventListener('click', (e) => {
                    e.stopPropagation();
                    hlActiveTerms = hlActiveTerms.filter(t => t !== term);
                    hlUpdatePage();
                });

                hlChipsContainer.appendChild(chip);
            });
        }

        function hlClearHighlights() {
            document.querySelectorAll('mark.marquis-hl').forEach(m => m.outerHTML = m.innerHTML);
            document.normalize();
            hlNavIndex = -1;
        }

        function hlUpdatePage() {
            hlClearHighlights();
            if (hlActiveTerms.length === 0) {
                hlRenderUI();
                return;
            }

            const caseSensitive = hlCase.checked;
            const wholeWord = hlWhole.checked;
            
            const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const sortedTerms = [...hlActiveTerms].sort((a, b) => b.length - a.length);
            const patternParts = sortedTerms.map(t => {
                const esc = escapeRegExp(t);
                return wholeWord ? `\\b${esc}\\b` : esc;
            });
            
            const flags = caseSensitive ? 'g' : 'gi';
            const regex = new RegExp(`(${patternParts.join('|')})`, flags);

            let total = 0;
            let counts = {};
            hlActiveTerms.forEach(t => counts[t] = 0);

            // Navigate Document Body, bypassing Shadow DOM automatically
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let nodesToReplace = [];

            while (walker.nextNode()) {
                const node = walker.currentNode;
                if (['SCRIPT', 'STYLE', 'MARK', 'TEXTAREA', 'INPUT'].includes(node.parentElement.tagName) || node.parentElement.isContentEditable) continue;
                if (regex.test(node.nodeValue)) nodesToReplace.push(node);
            }

            nodesToReplace.forEach(node => {
                const fragment = document.createDocumentFragment();
                const text = node.nodeValue;
                let lastIdx = 0;
                let match;
                regex.lastIndex = 0; 

                while ((match = regex.exec(text)) !== null) {
                    fragment.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));

                    const mark = document.createElement('mark');
                    mark.className = 'marquis-hl';
                    mark.textContent = match[0];
                    
                    const matchedText = match[0];
                    const termKey = hlActiveTerms.find(t => caseSensitive ? t === matchedText : t.toLowerCase() === matchedText.toLowerCase());
                    
                    if (termKey) {
                        const idx = hlActiveTerms.indexOf(termKey);
                        mark.style.backgroundColor = HL_PALETTE[idx % HL_PALETTE.length];
                        mark.dataset.term = termKey; 
                        counts[termKey]++;
                    } else {
                        mark.style.backgroundColor = '#ffff00';
                    }
                    
                    mark.style.color = '#222'; mark.style.borderRadius = '3px'; mark.style.padding = '0 2px'; mark.style.boxShadow = '0 1px 2px rgba(0,0,0,0.2)';

                    fragment.appendChild(mark);
                    lastIdx = regex.lastIndex;
                    total++;
                }
                fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
                node.parentNode.replaceChild(fragment, node);
            });

            hlCount.innerText = `${total} Matches`;
            hlRenderUI(counts);
        }

        function hlShowContext(target) {
            const range = 60;
            const textContent = target.parentElement.textContent || "";
            const fullText = textContent.replace(/\s+/g, ' ').trim();
            const termTxt = target.textContent;
            
            const idx = fullText.indexOf(termTxt);
            if (idx === -1) {
                hlContext.textContent = fullText.substring(0, 100) + "...";
                hlContext.style.display = 'block';
                return;
            }

            const start = Math.max(0, idx - range);
            const end = Math.min(fullText.length, idx + termTxt.length + range);
            
            let snippet = fullText.substring(start, end);
            if (start > 0) snippet = "..." + snippet;
            if (end < fullText.length) snippet = snippet + "...";
            
            // Split on the raw term, then escape each piece: page text never reaches markup unescaped.
            hlContext.innerHTML = snippet.split(termTxt).map(escHtml).join(`<span class="hl-context-match">${escHtml(termTxt)}</span>`);
            hlContext.style.display = 'block';
        }

        function hlJumpToSpecific(term) {
            if(typeof hlTermNav[term] === 'undefined') hlTermNav[term] = -1;
            const marks = Array.from(document.querySelectorAll('mark.marquis-hl')).filter(m => m.dataset.term === term);
            if (marks.length === 0) return;

            const prevIdx = hlTermNav[term];
            if (prevIdx >= 0 && marks[prevIdx]) { marks[prevIdx].style.outline = 'none'; marks[prevIdx].style.zIndex = 'auto'; }

            let nextIdx = prevIdx + 1;
            if (nextIdx >= marks.length) nextIdx = 0;
            hlTermNav[term] = nextIdx;

            const target = marks[nextIdx];
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.style.outline = '3px solid #dc3545';
            target.style.zIndex = '999999';
            target.style.position = 'relative';
            
            hlShowContext(target);
        }

        function hlNavigateGlobal(dir) {
            const marks = document.querySelectorAll('mark.marquis-hl');
            if (marks.length === 0) return;

            if (hlNavIndex >= 0 && marks[hlNavIndex]) { marks[hlNavIndex].style.outline = 'none'; marks[hlNavIndex].style.zIndex = 'auto'; }

            hlNavIndex += dir;
            if (hlNavIndex >= marks.length) hlNavIndex = 0;
            if (hlNavIndex < 0) hlNavIndex = marks.length - 1;

            const target = marks[hlNavIndex];
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.style.outline = '4px solid #0d6efd';
            target.style.zIndex = '999999';
            target.style.position = 'relative';

            hlShowContext(target);
        }

        hlInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') hlAddBtn.click(); });
        hlAddBtn.addEventListener('click', () => {
            const val = hlInput.value.trim();
            if (!val) return;
            const newTerms = val.split(',').map(t => t.trim()).filter(t => t);
            newTerms.forEach(term => { if (!hlActiveTerms.includes(term)) hlActiveTerms.push(term); });
            hlInput.value = '';
            hlUpdatePage();
        });

        hlClearBtn.addEventListener('click', () => { hlActiveTerms = []; hlUpdatePage(); });
        hlCase.addEventListener('change', hlUpdatePage);
        hlWhole.addEventListener('change', hlUpdatePage);
        hlPrev.addEventListener('click', () => hlNavigateGlobal(-1));
        hlNext.addEventListener('click', () => hlNavigateGlobal(1));

            // --- 🟢 LANGUAGE WIDGET LOGIC & DRAGGING ---
        shadow.querySelector('#lang-close').addEventListener('click', () => langWidget.classList.remove('show'));

        const langHeader = shadow.querySelector('#lang-header');
        let isDraggingLang = false;
        let lStartX, lStartY, lStartLeft, lStartTop;

        langHeader.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDraggingLang = true;
            lStartX = e.clientX; lStartY = e.clientY;
            const rect = langWidget.getBoundingClientRect();
            lStartLeft = rect.left; lStartTop = rect.top;

            const onMouseMoveLang = (moveEvent) => {
                if (!isDraggingLang) return;
                langWidget.style.right = 'auto';
                langWidget.style.bottom = 'auto';
                langWidget.style.left = (lStartLeft + (moveEvent.clientX - lStartX)) + 'px';
                langWidget.style.top = (lStartTop + (moveEvent.clientY - lStartY)) + 'px';
            };
            const onMouseUpLang = () => {
                isDraggingLang = false;
                document.removeEventListener('mousemove', onMouseMoveLang);
                document.removeEventListener('mouseup', onMouseUpLang);
            };
            document.addEventListener('mousemove', onMouseMoveLang);
            document.addEventListener('mouseup', onMouseUpLang);
        });

        // 🟢 DUAL ENGINE: Languages & Time Zones
        const isoLanguages = [
            { code: "aa", name: "Afar" },
            { code: "ab", name: "Abkhazian" },
            { code: "ae", name: "Avestan" },
            { code: "af", name: "Afrikaans" },
            { code: "af-ZA", name: "Afrikaans (South Africa)" },
            { code: "ak", name: "Akan" },
            { code: "am", name: "Amharic" },
            { code: "an", name: "Aragonese" },
            { code: "ar", name: "Arabic" },
            { code: "ar-AE", name: "Arabic (U.A.E.)" },
            { code: "ar-BH", name: "Arabic (Bahrain)" },
            { code: "ar-DZ", name: "Arabic (Algeria)" },
            { code: "ar-EG", name: "Arabic (Egypt)" },
            { code: "ar-IQ", name: "Arabic (Iraq)" },
            { code: "ar-JO", name: "Arabic (Jordan)" },
            { code: "ar-KW", name: "Arabic (Kuwait)" },
            { code: "ar-LB", name: "Arabic (Lebanon)" },
            { code: "ar-LY", name: "Arabic (Libya)" },
            { code: "ar-MA", name: "Arabic (Morocco)" },
            { code: "ar-OM", name: "Arabic (Oman)" },
            { code: "ar-QA", name: "Arabic (Qatar)" },
            { code: "ar-SA", name: "Arabic (Saudi Arabia)" },
            { code: "ar-SY", name: "Arabic (Syria)" },
            { code: "ar-TN", name: "Arabic (Tunisia)" },
            { code: "ar-YE", name: "Arabic (Yemen)" },
            { code: "as", name: "Assamese" },
            { code: "av", name: "Avaric" },
            { code: "ay", name: "Aymara" },
            { code: "az", name: "Azeri (Latin)" },
            { code: "az-AZ", name: "Azeri (Latin) (Azerbaijan)" },
            { code: "az-AZ", name: "Azeri (Cyrillic) (Azerbaijan)" },
            { code: "ba", name: "Bashkir" },
            { code: "be", name: "Belarusian" },
            { code: "be-BY", name: "Belarusian (Belarus)" },
            { code: "bg", name: "Bulgarian" },
            { code: "bg-BG", name: "Bulgarian (Bulgaria)" },
            { code: "bh", name: "Bihari" },
            { code: "bi", name: "Bislama" },
            { code: "bm", name: "Bambara" },
            { code: "bn", name: "Bengali" },
            { code: "bo", name: "Tibetan" },
            { code: "br", name: "Breton" },
            { code: "bs", name: "Bosnian" },
            { code: "bs-BA", name: "Bosnian (Bosnia and Herzegovina)" },
            { code: "ca", name: "Catalan" },
            { code: "ca-ES", name: "Catalan (Spain)" },
            { code: "ce", name: "Chechen" },
            { code: "ch", name: "Chamorro" },
            { code: "co", name: "Corsican" },
            { code: "cr", name: "Cree" },
            { code: "cs", name: "Czech" },
            { code: "cs-CZ", name: "Czech (Czech Republic)" },
            { code: "cu", name: "Church Slavonic" },
            { code: "cv", name: "Chuvash" },
            { code: "cy", name: "Welsh" },
            { code: "cy-GB", name: "Welsh (United Kingdom)" },
            { code: "da", name: "Danish" },
            { code: "da-DK", name: "Danish (Denmark)" },
            { code: "de", name: "German" },
            { code: "de-AT", name: "German (Austria)" },
            { code: "de-CH", name: "German (Switzerland)" },
            { code: "de-DE", name: "German (Germany)" },
            { code: "de-LI", name: "German (Liechtenstein)" },
            { code: "de-LU", name: "German (Luxembourg)" },
            { code: "div", name: "Divehi" },
            { code: "dv", name: "Divehi" },
            { code: "dv-MV", name: "Divehi (Maldives)" },
            { code: "dz", name: "Bhutani" },
            { code: "ee", name: "Ewe" },
            { code: "el", name: "Greek" },
            { code: "el-GR", name: "Greek (Greece)" },
            { code: "en", name: "English" },
            { code: "en-AU", name: "English (Australia)" },
            { code: "en-BZ", name: "English (Belize)" },
            { code: "en-CA", name: "English (Canada)" },
            { code: "en-CB", name: "English (Caribbean)" },
            { code: "en-GB", name: "English (United Kingdom)" },
            { code: "en-IE", name: "English (Ireland)" },
            { code: "en-JM", name: "English (Jamaica)" },
            { code: "en-NZ", name: "English (New Zealand)" },
            { code: "en-PH", name: "English (Republic of the Philippines)" },
            { code: "en-TT", name: "English (Trinidad and Tobago)" },
            { code: "en-US", name: "English (United States)" },
            { code: "en-ZA", name: "English (South Africa)" },
            { code: "en-ZW", name: "English (Zimbabwe)" },
            { code: "eo", name: "Esperanto" },
            { code: "es", name: "Spanish" },
            { code: "es-AR", name: "Spanish (Argentina)" },
            { code: "es-BO", name: "Spanish (Bolivia)" },
            { code: "es-CL", name: "Spanish (Chile)" },
            { code: "es-CO", name: "Spanish (Colombia)" },
            { code: "es-CR", name: "Spanish (Costa Rica)" },
            { code: "es-DO", name: "Spanish (Dominican Republic)" },
            { code: "es-EC", name: "Spanish (Ecuador)" },
            { code: "es-ES", name: "Spanish (Spain)" },
            { code: "es-ES", name: "Spanish (Castilian)" },
            { code: "es-GT", name: "Spanish (Guatemala)" },
            { code: "es-HN", name: "Spanish (Honduras)" },
            { code: "es-MX", name: "Spanish (Mexico)" },
            { code: "es-NI", name: "Spanish (Nicaragua)" },
            { code: "es-PA", name: "Spanish (Panama)" },
            { code: "es-PE", name: "Spanish (Peru)" },
            { code: "es-PR", name: "Spanish (Puerto Rico)" },
            { code: "es-PY", name: "Spanish (Paraguay)" },
            { code: "es-SV", name: "Spanish (El Salvador)" },
            { code: "es-US", name: "Spanish (United States)" },
            { code: "es-UY", name: "Spanish (Uruguay)" },
            { code: "es-VE", name: "Spanish (Venezuela)" },
            { code: "et", name: "Estonian" },
            { code: "et-EE", name: "Estonian (Estonia)" },
            { code: "eu", name: "Basque" },
            { code: "eu-ES", name: "Basque (Spain)" },
            { code: "fa", name: "Farsi" },
            { code: "fa-IR", name: "Farsi (Iran)" },
            { code: "ff", name: "Fulah" },
            { code: "fi", name: "Finnish" },
            { code: "fi-FI", name: "Finnish (Finland)" },
            { code: "fj", name: "Fiji" },
            { code: "fo", name: "Faroese" },
            { code: "fo-FO", name: "Faroese (Faroe Islands)" },
            { code: "fr", name: "French" },
            { code: "fr-BE", name: "French (Belgium)" },
            { code: "fr-CA", name: "French (Canada)" },
            { code: "fr-CH", name: "French (Switzerland)" },
            { code: "fr-FR", name: "French (France)" },
            { code: "fr-LU", name: "French (Luxembourg)" },
            { code: "fr-MC", name: "French (Principality of Monaco)" },
            { code: "fy", name: "Frisian" },
            { code: "ga", name: "Irish" },
            { code: "gd", name: "Gaelic" },
            { code: "gl", name: "Galician" },
            { code: "gl-ES", name: "Galician (Spain)" },
            { code: "gn", name: "Guarani" },
            { code: "gu", name: "Gujarati" },
            { code: "gu-IN", name: "Gujarati (India)" },
            { code: "gv", name: "Manx" },
            { code: "ha", name: "Hausa" },
            { code: "he", name: "Hebrew" },
            { code: "he-IL", name: "Hebrew (Israel)" },
            { code: "hi", name: "Hindi" },
            { code: "hi-IN", name: "Hindi (India)" },
            { code: "ho", name: "Hiri Motu" },
            { code: "hr", name: "Croatian" },
            { code: "hr-BA", name: "Croatian (Bosnia and Herzegovina)" },
            { code: "hr-HR", name: "Croatian (Croatia)" },
            { code: "ht", name: "Haitian" },
            { code: "hu", name: "Hungarian" },
            { code: "hu-HU", name: "Hungarian (Hungary)" },
            { code: "hy", name: "Armenian" },
            { code: "hy-AM", name: "Armenian (Armenia)" },
            { code: "hz", name: "Herero" },
            { code: "ia", name: "Interlingua" },
            { code: "id", name: "Indonesian" },
            { code: "id-ID", name: "Indonesian (Indonesia)" },
            { code: "ie", name: "Interlingue" },
            { code: "ig", name: "Igbo" },
            { code: "ii", name: "Sichuan Yi" },
            { code: "ik", name: "Inupiak" },
            { code: "in", name: "Indonesian" },
            { code: "io", name: "Ido" },
            { code: "is", name: "Icelandic" },
            { code: "is-IS", name: "Icelandic (Iceland)" },
            { code: "it", name: "Italian" },
            { code: "it-CH", name: "Italian (Switzerland)" },
            { code: "it-IT", name: "Italian (Italy)" },
            { code: "iu", name: "Inuktitut" },
            { code: "iw", name: "Hebrew" },
            { code: "ja", name: "Japanese" },
            { code: "ja-JP", name: "Japanese (Japan)" },
            { code: "ji", name: "Yiddish" },
            { code: "jv", name: "Javanese" },
            { code: "jw", name: "Javanese" },
            { code: "ka", name: "Georgian" },
            { code: "ka-GE", name: "Georgian (Georgia)" },
            { code: "kg", name: "Kongo" },
            { code: "ki", name: "Kikuyu" },
            { code: "kj", name: "Kuanyama" },
            { code: "kk", name: "Kazakh" },
            { code: "kk-KZ", name: "Kazakh (Kazakhstan)" },
            { code: "kl", name: "Greenlandic" },
            { code: "km", name: "Cambodian" },
            { code: "kn", name: "Kannada" },
            { code: "kn-IN", name: "Kannada (India)" },
            { code: "ko", name: "Korean" },
            { code: "ko-KR", name: "Korean (Korea)" },
            { code: "kok", name: "Konkani" },
            { code: "kok-IN", name: "Konkani (India)" },
            { code: "kr", name: "Kanuri" },
            { code: "ks", name: "Kashmiri" },
            { code: "ku", name: "Kurdish" },
            { code: "kv", name: "Komi" },
            { code: "kw", name: "Cornish" },
            { code: "ky", name: "Kyrgyz" },
            { code: "ky-KG", name: "Kyrgyz (Kyrgyzstan)" },
            { code: "kz", name: "Kyrgyz" },
            { code: "la", name: "Latin" },
            { code: "lb", name: "Luxembourgish" },
            { code: "lg", name: "Ganda" },
            { code: "li", name: "Limburgan" },
            { code: "ln", name: "Lingala" },
            { code: "lo", name: "Laothian" },
            { code: "ls", name: "Slovenian" },
            { code: "lt", name: "Lithuanian" },
            { code: "lt-LT", name: "Lithuanian (Lithuania)" },
            { code: "lu", name: "Luba-Katanga" },
            { code: "lv", name: "Latvian" },
            { code: "lv-LV", name: "Latvian (Latvia)" },
            { code: "mg", name: "Malagasy" },
            { code: "mh", name: "Marshallese" },
            { code: "mi", name: "Maori" },
            { code: "mi-NZ", name: "Maori (New Zealand)" },
            { code: "mk", name: "FYRO Macedonian" },
            { code: "mk-MK", name: "FYRO Macedonian (Former Yugoslav Republic of Macedonia)" },
            { code: "ml", name: "Malayalam" },
            { code: "mn", name: "Mongolian" },
            { code: "mn-MN", name: "Mongolian (Mongolia)" },
            { code: "mo", name: "Moldavian" },
            { code: "mr", name: "Marathi" },
            { code: "mr-IN", name: "Marathi (India)" },
            { code: "ms", name: "Malay" },
            { code: "ms-BN", name: "Malay (Brunei Darussalam)" },
            { code: "ms-MY", name: "Malay (Malaysia)" },
            { code: "mt", name: "Maltese" },
            { code: "mt-MT", name: "Maltese (Malta)" },
            { code: "my", name: "Burmese" },
            { code: "na", name: "Nauru" },
            { code: "nb", name: "Norwegian (Bokmål)" },
            { code: "nb-NO", name: "Norwegian (Bokmål) (Norway)" },
            { code: "nd", name: "North Ndebele" },
            { code: "ne", name: "Nepali (India)" },
            { code: "ng", name: "Ndonga" },
            { code: "nl", name: "Dutch" },
            { code: "nl-BE", name: "Dutch (Belgium)" },
            { code: "nl-NL", name: "Dutch (Netherlands)" },
            { code: "nn", name: "Norwegian (Nynorsk)" },
            { code: "nn-NO", name: "Norwegian (Nynorsk) (Norway)" },
            { code: "no", name: "Norwegian" },
            { code: "nr", name: "South Ndebele" },
            { code: "ns", name: "Northern Sotho" },
            { code: "ns-ZA", name: "Northern Sotho (South Africa)" },
            { code: "nv", name: "Navajo" },
            { code: "ny", name: "Chichewa" },
            { code: "oc", name: "Occitan" },
            { code: "oj", name: "Ojibwa" },
            { code: "om", name: "(Afan)/Oromoor/Oriya" },
            { code: "or", name: "Oriya" },
            { code: "os", name: "Ossetian" },
            { code: "pa", name: "Punjabi" },
            { code: "pa-IN", name: "Punjabi (India)" },
            { code: "pi", name: "Pali" },
            { code: "pl", name: "Polish" },
            { code: "pl-PL", name: "Polish (Poland)" },
            { code: "ps", name: "Pashto" },
            { code: "ps-AR", name: "Pashto (Afghanistan)" },
            { code: "pt", name: "Portuguese" },
            { code: "pt-BR", name: "Portuguese (Brazil)" },
            { code: "pt-PT", name: "Portuguese (Portugal)" },
            { code: "qu", name: "Quechua" },
            { code: "qu-BO", name: "Quechua (Bolivia)" },
            { code: "qu-EC", name: "Quechua (Ecuador)" },
            { code: "qu-PE", name: "Quechua (Peru)" },
            { code: "rm", name: "Rhaeto-Romanic" },
            { code: "rn", name: "Kirundi" },
            { code: "ro", name: "Romanian" },
            { code: "ro-RO", name: "Romanian (Romania)" },
            { code: "ru", name: "Russian" },
            { code: "ru-RU", name: "Russian (Russia)" },
            { code: "rw", name: "Kinyarwanda" },
            { code: "sa", name: "Sanskrit" },
            { code: "sa-IN", name: "Sanskrit (India)" },
            { code: "sb", name: "Sorbian" },
            { code: "sc", name: "Sardinian" },
            { code: "sd", name: "Sindhi" },
            { code: "se", name: "Sami (Northern)" },
            { code: "se-FI", name: "Sami (Northern) (Finland)" },
            { code: "se-FI", name: "Sami (Skolt) (Finland)" },
            { code: "se-FI", name: "Sami (Inari) (Finland)" },
            { code: "se-NO", name: "Sami (Northern) (Norway)" },
            { code: "se-NO", name: "Sami (Lule) (Norway)" },
            { code: "se-NO", name: "Sami (Southern) (Norway)" },
            { code: "se-SE", name: "Sami (Northern) (Sweden)" },
            { code: "se-SE", name: "Sami (Lule) (Sweden)" },
            { code: "se-SE", name: "Sami (Southern) (Sweden)" },
            { code: "sg", name: "Sangro" },
            { code: "sh", name: "Serbo-Croatian" },
            { code: "si", name: "Singhalese" },
            { code: "sk", name: "Slovak" },
            { code: "sk-SK", name: "Slovak (Slovakia)" },
            { code: "sl", name: "Slovenian" },
            { code: "sl-SI", name: "Slovenian (Slovenia)" },
            { code: "sm", name: "Samoan" },
            { code: "sn", name: "Shona" },
            { code: "so", name: "Somali" },
            { code: "sq", name: "Albanian" },
            { code: "sq-AL", name: "Albanian (Albania)" },
            { code: "sr", name: "Serbian" },
            { code: "sr-BA", name: "Serbian (Latin) (Bosnia and Herzegovina)" },
            { code: "sr-BA", name: "Serbian (Cyrillic) (Bosnia and Herzegovina)" },
            { code: "sr-RS", name: "Serbian (Cyrillic) (Bosnia and Herzegovina)" },
            { code: "sr-SP", name: "Serbian (Latin & Cyrillic" },
            { code: "sr-SP", name: "Serbian (Cyrillic) (Serbia and Montenegro)" },
            { code: "ss", name: "Siswati" },
            { code: "st", name: "Sesotho" },
            { code: "su", name: "Sundanese" },
            { code: "sv", name: "Swedish" },
            { code: "sv-FI", name: "Swedish (Finland)" },
            { code: "sv-SE", name: "Swedish (Sweden)" },
            { code: "sw", name: "Swahili" },
            { code: "sw-KE", name: "Swahili (Kenya)" },
            { code: "sx", name: "Sutu" },
            { code: "syr", name: "Syriac" },
            { code: "syr-SY", name: "Syriac (Syria)" },
            { code: "ta", name: "Tamil" },
            { code: "ta-IN", name: "Tamil (India)" },
            { code: "te", name: "Telugu" },
            { code: "te-IN", name: "Telugu (India)" },
            { code: "tg", name: "Tajik" },
            { code: "th", name: "Thai" },
            { code: "th-TH", name: "Thai (Thailand)" },
            { code: "ti", name: "Tigrinya" },
            { code: "tk", name: "Turkmen" },
            { code: "tl", name: "Tagalog" },
            { code: "tl-PH", name: "Tagalog (Philippines)" },
            { code: "tn", name: "Tswana" },
            { code: "tn-ZA", name: "Tswana (South Africa)" },
            { code: "to", name: "Tonga" },
            { code: "tr", name: "Turkish" },
            { code: "tr-TR", name: "Turkish (Turkey)" },
            { code: "tt", name: "Tatar" },
            { code: "tt-RU", name: "Tatar (Russia)" },
            { code: "ts", name: "Tsonga" },
            { code: "tw", name: "Twi" },
            { code: "ty", name: "Tahitian" },
            { code: "ug", name: "Uighur" },
            { code: "uk", name: "Ukrainian" },
            { code: "uk-UA", name: "Ukrainian (Ukraine)" },
            { code: "ur", name: "Urdu" },
            { code: "ur-PK", name: "Urdu (Islamic Republic of Pakistan)" },
            { code: "us", name: "English" },
            { code: "uz", name: "Uzbek (Latin)" },
            { code: "uz-UZ", name: "Uzbek (Latin) (Uzbekistan)" },
            { code: "uz-UZ", name: "Uzbek (Cyrillic) (Uzbekistan)" },
            { code: "ve", name: "Venda" },
            { code: "vi", name: "Vietnamese" },
            { code: "vi-VN", name: "Vietnamese (Viet Nam)" },
            { code: "vo", name: "Volapuk" },
            { code: "wa", name: "Walloon" },
            { code: "wo", name: "Wolof" },
            { code: "xh", name: "Xhosa" },
            { code: "xh-ZA", name: "Xhosa (South Africa)" },
            { code: "yi", name: "Yiddish" },
            { code: "yo", name: "Yoruba" },
            { code: "za", name: "Zhuang" },
            { code: "zh", name: "Chinese" },
            { code: "zh-CN", name: "Chinese (Simplified, China)" },
            { code: "zh-HK", name: "Chinese (Hong Kong)" },
            { code: "zh-MO", name: "Chinese (Macau)" },
            { code: "zh-SG", name: "Chinese (Singapore)" },
            { code: "zh-TW", name: "Chinese (Traditional, China)" },
            { code: "zu", name: "Zulu" },
            { code: "zu-ZA", name: "Zulu (South Africa)" }
        ]; 
        
        // Use browser's native timezone database!
        const timeZones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [];

        const tabLang = shadow.querySelector('#tab-lang');
        const tabTime = shadow.querySelector('#tab-time');
        const globalSearch = shadow.querySelector('#global-mini-search');
        const globalList = shadow.querySelector('#global-mini-list');
        
        let currentGlobalTab = 'lang';
        let timeInterval = null;

        // TAB SWITCHING
        tabLang.addEventListener('click', () => {
            currentGlobalTab = 'lang';
            tabLang.style.color = 'var(--icon-hover-color)';
            tabLang.style.borderBottomColor = 'var(--icon-hover-color)';
            tabTime.style.color = 'var(--icon-base)';
            tabTime.style.borderBottomColor = 'transparent';
            globalSearch.placeholder = "Search language or code...";
            globalSearch.value = '';
            clearInterval(timeInterval);
            renderLanguages();
        });

        tabTime.addEventListener('click', () => {
            currentGlobalTab = 'time';
            tabTime.style.color = 'var(--icon-hover-color)';
            tabTime.style.borderBottomColor = 'var(--icon-hover-color)';
            tabLang.style.color = 'var(--icon-base)';
            tabLang.style.borderBottomColor = 'transparent';
            globalSearch.placeholder = "Search city or region...";
            globalSearch.value = '';
            
            renderTimeZones();
            // Start live ticking clock
            clearInterval(timeInterval);
            timeInterval = setInterval(() => {
                if(langWidget.classList.contains('show')) renderTimeZones(globalSearch.value);
            }, 1000);
        });

        // UNIFIED SEARCH
        globalSearch.addEventListener('input', (e) => {
            if (currentGlobalTab === 'lang') renderLanguages(e.target.value);
            else renderTimeZones(e.target.value);
        });

        function renderLanguages(filterText = '') {
            globalList.innerHTML = '';
            const lowerFilter = filterText.toLowerCase();
            const filtered = isoLanguages.filter(l => l.name.toLowerCase().includes(lowerFilter) || l.code.toLowerCase().includes(lowerFilter));

            if (filtered.length === 0) {
                globalList.innerHTML = '<div style="color: var(--icon-base); opacity: 0.7; font-style: italic; text-align: center; padding: 20px 0;">No languages found...</div>';
                return;
            }

            filtered.forEach(lang => {
                const div = document.createElement('div');
                div.className = 'lang-item';
                div.title = 'Click to copy code';
                div.innerHTML = `<span>${lang.name}</span><span class="lang-code">${lang.code}</span>`;
                
                div.addEventListener('click', () => {
                    navigator.clipboard.writeText(lang.code);
                    const originalBg = div.style.background;
                    div.style.background = '#10b981'; div.style.color = '#fff';
                    setTimeout(() => { div.style.background = originalBg; div.style.color = ''; }, 300);
                    if(window.showGlobalAlert) window.showGlobalAlert("Copied!", `Language code '${lang.code}' copied.`, "success");
                });
                globalList.appendChild(div);
            });
        }

        function renderTimeZones(filterText = '') {
            globalList.innerHTML = '';
            const lowerFilter = filterText.toLowerCase();
            const filtered = timeZones.filter(tz => tz.toLowerCase().includes(lowerFilter));

            if (filtered.length === 0) {
                globalList.innerHTML = '<div style="color: var(--icon-base); opacity: 0.7; font-style: italic; text-align: center; padding: 20px 0;">No time zones found...</div>';
                return;
            }

            const now = new Date();
            filtered.forEach(tz => {
                const div = document.createElement('div');
                div.className = 'lang-item';
                div.title = 'Click to copy timezone ID';
                
                const timeStr = now.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const dateStr = now.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
                const tzLabel = tz.replace(/_/g, ' ').split('/').pop(); // "America/New_York" -> "New York"

                div.innerHTML = `
                    <div style="display:flex; flex-direction:column;">
                        <span style="font-weight:bold; color: var(--icon-hover-color); font-size:14px;">${timeStr}</span>
                        <span style="font-size: 12px; opacity: 0.7;">${dateStr} &bull; ${tz.split('/')[0]}</span>
                    </div>
                    <span style="font-weight:600;">${tzLabel}</span>
                `;
                
                div.addEventListener('click', () => {
                    navigator.clipboard.writeText(tz);
                    const originalBg = div.style.background;
                    div.style.background = 'var(--mq-accent)'; div.style.color = 'var(--mq-on-accent)';
                    setTimeout(() => { div.style.background = originalBg; div.style.color = ''; }, 300);
                    if(window.showGlobalAlert) window.showGlobalAlert("Copied!", `Timezone '${tz}' copied.`, "success");
                });
                globalList.appendChild(div);
            });
        }

        // Initial render
        renderLanguages();

        // --- 🟢 FOCUS WIDGET LOGIC & DRAGGING ---
        shadow.querySelector('#focus-close').addEventListener('click', () => focusWidget.classList.remove('show'));

        const focusHeader = shadow.querySelector('#focus-header');
        let isDraggingFocus = false;
        let foStartX, foStartY, foStartLeft, foStartTop;

        focusHeader.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDraggingFocus = true;
            foStartX = e.clientX; foStartY = e.clientY;
            const rect = focusWidget.getBoundingClientRect();
            foStartLeft = rect.left; foStartTop = rect.top;

            const onMouseMoveFocus = (moveEvent) => {
                if (!isDraggingFocus) return;
                focusWidget.style.right = 'auto';
                focusWidget.style.bottom = 'auto';
                focusWidget.style.left = (foStartLeft + (moveEvent.clientX - foStartX)) + 'px';
                focusWidget.style.top = (foStartTop + (moveEvent.clientY - foStartY)) + 'px';
            };
            const onMouseUpFocus = () => {
                isDraggingFocus = false;
                document.removeEventListener('mousemove', onMouseMoveFocus);
                document.removeEventListener('mouseup', onMouseUpFocus);
            };
            document.addEventListener('mousemove', onMouseMoveFocus);
            document.addEventListener('mouseup', onMouseUpFocus);
        });

        // 🟢 THE POMODORO ENGINE
        const launcherBadge = shadow.querySelector('#launcher-badge');
        const fDisplay = shadow.querySelector('#focus-display');
        const fStatus = shadow.querySelector('#focus-status');
        const fStartBtn = shadow.querySelector('#focus-start-btn');
        const fResetBtn = shadow.querySelector('#focus-reset-btn');
        const modeBtns = shadow.querySelectorAll('.focus-mode-btn');

        // Shown from the shared timer in storage (scripts/focus_timer.js): every tab and the popup show the
        // same countdown from the wall clock, and background.js ends the session and notifies.
        let fState = null;
        let fMode = 'focus';
        let fInterval = null;
        let fChecked = false; // focusCheck already sent for this session's 00:00

        function fFormatTime(seconds) {
            const m = Math.floor(seconds / 60).toString().padStart(2, '0');
            const s = (seconds % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        }

        const fLeft = () => fState ? FocusTimer.secondsLeft(fState) : FocusTimer.length(fMode);

        function fUpdateUI() {
            const fIsRunning = !!(fState && fState.isRunning);
            const fTimeLeft = fLeft();
            fDisplay.innerText = fFormatTime(fTimeLeft);
            if (fIsRunning) {
                launcherBadge.innerText = fFormatTime(fTimeLeft);
                launcherBadge.style.display = 'block';
                launcherBadge.style.backgroundColor = fMode === 'focus' ? '#ef4444' : '#10b981';
                fStartBtn.innerText = 'Pause';
                fStartBtn.classList.replace('btn-primary', 'btn-warning');
                fStartBtn.style.color = '#000';
                fStartBtn.style.border = '1px solid #f59e0b';
                fStatus.innerText = fMode === 'focus' ? 'Focusing...' : 'Recharging...';
                if (fTimeLeft === 0 && !fChecked) {
                    fChecked = true; // end it now instead of waiting for the background alarm
                    chrome.runtime.sendMessage({ action: 'focusCheck' }).catch(() => {});
                }
            } else {
                launcherBadge.style.display = 'none';
                fStartBtn.innerText = 'Start';
                fStartBtn.classList.replace('btn-warning', 'btn-primary');
                fStartBtn.style.color = '';
                fStartBtn.style.border = '';
                fStatus.innerText = fMode === 'focus' ? 'Ready to focus' : 'Ready for a break';
            }

            modeBtns.forEach(b => {
                if (b.getAttribute('data-mode') === fMode) b.classList.add('active');
                else b.classList.remove('active');
            });
        }

        function fApply(next, old) {
            const ranOut = !next && !!old && old.isRunning && FocusTimer.secondsLeft(old) <= 1;
            fState = next || null;
            if (fState) fMode = fState.mode || 'focus';
            fChecked = false;
            clearInterval(fInterval);
            if (fState && fState.isRunning) fInterval = setInterval(fUpdateUI, 1000);
            fUpdateUI();
            // One chime, in the tab being looked at, not one per open tab.
            if (ranOut && document.visibilityState === 'visible') fChime();
        }

        function fChime() {
            // Play a gentle notification chime
            try {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = audioCtx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(800, audioCtx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.5);
                osc.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.5);
            } catch(e) {}

            if(window.showGlobalAlert) window.showGlobalAlert('Time is up!', fMode === 'focus' ? 'Focus session complete. Take a break!' : 'Break is over. Back to work!', 'success');
        }

        function fSetMode(mode) {
            fMode = mode;
            if (fState) FocusTimer.reset(); // the storage change re-renders every view
            else fUpdateUI();
        }

        modeBtns.forEach(btn => {
            btn.addEventListener('click', (e) => fSetMode(e.target.getAttribute('data-mode')));
        });

        fStartBtn.addEventListener('click', () => {
            const left = fLeft();
            if (fState && fState.isRunning) FocusTimer.pause(fMode, left);
            else FocusTimer.start(fMode, left > 0 ? left : FocusTimer.length(fMode));
        });

        fResetBtn.addEventListener('click', () => fSetMode(fMode));

        // A dock created mid-session starts from the stored state; later changes arrive via the sync listener.
        chrome.storage.local.get('focusState', (res) => fApply(res.focusState));

        // --- 🟢 CALCULATOR WIDGET LOGIC & DRAGGING ---
        shadow.querySelector('#calc-close').addEventListener('click', () => calcWidget.classList.remove('show'));

        const calcHeader = shadow.querySelector('#calc-header');
        let isDraggingCalc = false;
        let cStartX, cStartY, cStartLeft, cStartTop;

        calcHeader.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDraggingCalc = true;
            cStartX = e.clientX; cStartY = e.clientY;
            const rect = calcWidget.getBoundingClientRect();
            cStartLeft = rect.left; cStartTop = rect.top;

            const onMouseMoveCalc = (moveEvent) => {
                if (!isDraggingCalc) return;
                calcWidget.style.right = 'auto';
                calcWidget.style.bottom = 'auto';
                calcWidget.style.left = (cStartLeft + (moveEvent.clientX - cStartX)) + 'px';
                calcWidget.style.top = (cStartTop + (moveEvent.clientY - cStartY)) + 'px';
            };
            const onMouseUpCalc = () => {
                isDraggingCalc = false;
                document.removeEventListener('mousemove', onMouseMoveCalc);
                document.removeEventListener('mouseup', onMouseUpCalc);
            };
            document.addEventListener('mousemove', onMouseMoveCalc);
            document.addEventListener('mouseup', onMouseUpCalc);
        });

        // 🟢 THE OMNI-CALCULATOR ENGINE
        const calcModeSelect = shadow.querySelector('#calc-mode-select');
        const calcStdDisplay = shadow.querySelector('#calc-standard-display');
        const calcBody = shadow.querySelector('#calc-body');
        const calcInputVal = shadow.querySelector('#calc-display-val');
        const calcHistVal = shadow.querySelector('#calc-history-val');
        const calcMemVal = shadow.querySelector('#calc-memory-val');

        let cInput = '';
        let cExpr = '';
        let cLastOp = null;
        let cResetNext = false;
        let cMemory = 0;

        // Custom Safe Math Evaluator (Replaces math.js dependency)
        function safeMathEval(expr) {
            try {
                let str = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/\s+/g,'');
                let tokens = str.match(/\d+\.?\d*|[+\-*/^]/g);
                if (!tokens) return '0';
                
                // 1. Handle negative numbers correctly (e.g., "5 * -2")
                for (let i = 0; i < tokens.length; i++) {
                    if (tokens[i] === '-') {
                        if (i === 0 || ['+', '-', '*', '/', '^'].includes(tokens[i-1])) {
                            tokens.splice(i, 2, '-' + tokens[i+1]);
                        }
                    }
                }

                // 2. Execute operations following BEDMAS order
                const evaluatePass = (ops) => {
                    for (let i = 0; i < tokens.length; i++) {
                        if (ops.includes(tokens[i])) {
                            let a = parseFloat(tokens[i-1]);
                            let b = parseFloat(tokens[i+1]);
                            let res = 0;
                            if (tokens[i] === '^') res = Math.pow(a, b);
                            else if (tokens[i] === '*') res = a * b;
                            else if (tokens[i] === '/') res = a / b;
                            else if (tokens[i] === '+') res = a + b;
                            else if (tokens[i] === '-') res = a - b;
                            
                            tokens.splice(i-1, 3, res.toString());
                            i--; // Step back to re-evaluate at the new position
                        }
                    }
                };

                evaluatePass(['^']);
                evaluatePass(['*', '/']);
                evaluatePass(['+', '-']);

                let finalRes = parseFloat(tokens[0]);
                return isNaN(finalRes) || !isFinite(finalRes) ? 'Error' : Number(finalRes.toFixed(10)).toString();
            } catch(e) { 
                return 'Error'; 
            }
        }

        function cUpdateDisplay() {
            calcInputVal.value = cInput || '0';
            calcHistVal.innerText = cExpr || '';
            calcMemVal.innerText = `M: ${cMemory}`;
            calcMemVal.style.visibility = cMemory !== 0 ? 'visible' : 'hidden';
            calcInputVal.style.color = cInput.startsWith('Error') ? '#ef4444' : 'var(--icon-hover-color)';
        }

        function cHandleValue(val) {
            if (cResetNext) { cInput = ''; cExpr = ''; cResetNext = false; }
            if (val === '.' && cInput.includes('.')) return;
            if (val === '0' && cInput === '0') return;
            cInput = cInput === '0' && val !== '.' ? val : cInput + val;
            cUpdateDisplay();
        }

        function cHandleAction(action) {
            if (cInput.startsWith('Error')) cInput = '';

            const sym = {'add':'+', 'subtract':'-', 'multiply':'×', 'divide':'÷', 'power':'^'};
            
            // 🟢 FIXED: Safely treat an empty starting state as '0' so cos(0) works instantly
            let val = cInput === '' ? 0 : parseFloat(cInput); 
            
            switch(action) {
                case 'clear': cInput = ''; cExpr = ''; break;
                case 'backspace': cInput = cInput.slice(0, -1); if(!cInput) cInput = '0'; break;
                case 'add': case 'subtract': case 'multiply': case 'divide': case 'power':
                    const lastChar = cExpr.slice(-1);
                    if (['+','-','×','÷','^'].includes(lastChar) && !cInput) {
                        cExpr = cExpr.slice(0, -1) + sym[action];
                    } else if (cInput || cExpr === '') { 
                        cExpr = `${cExpr} ${cInput || '0'} ${sym[action]}`.trim();
                        cInput = '';
                    }
                    cLastOp = action;
                    cResetNext = false;
                    break;
                case 'equals':
                    if (cLastOp && (cInput || cInput === '0')) {
                        let finalExpr = `${cExpr} ${cInput || '0'}`;
                        cInput = safeMathEval(finalExpr);
                        cExpr = '';
                        cResetNext = true;
                    }
                    break;
                case 'memoryAdd': cMemory += val; cResetNext = true; break;
                case 'memorySubtract': cMemory -= val; cResetNext = true; break;
                case 'memoryRecall': if(cMemory!==0) { cInput = cMemory.toString(); cResetNext = true; } break;
                case 'memoryClear': cMemory = 0; break;
                
                // 🟢 FIXED: Scientific Functions now execute immediately and reset the next keystroke
                case 'sin': case 'cos': case 'tan':
                    cInput = Number(Math[action](val * Math.PI / 180).toFixed(10)).toString();
                    cResetNext = true;
                    break;
                case 'log': 
                    if (val <= 0) cInput = 'Error';
                    else cInput = Number(Math.log10(val).toFixed(10)).toString(); 
                    cResetNext = true;
                    break;
                case 'ln': 
                    if (val <= 0) cInput = 'Error';
                    else cInput = Number(Math.log(val).toFixed(10)).toString(); 
                    cResetNext = true;
                    break;
                case 'sqrt': 
                    if (val < 0) cInput = 'Error';
                    else cInput = Number(Math.sqrt(val).toFixed(10)).toString(); 
                    cResetNext = true;
                    break;
                case 'factorial':
                    let n = parseInt(val);
                    if (n < 0 || n > 170) cInput = 'Error';
                    else { 
                        let r = 1; 
                        for(let i=2; i<=n; i++) r*=i; 
                        cInput = r.toString(); 
                    }
                    cResetNext = true;
                    break;
            }
            cUpdateDisplay();
        }

        // 🟢 UI Generators
        function buildGrid(btns) {
            let html = '<div style="display:grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 8px;">';
            btns.forEach(b => {
                html += `<div class="calc-btn ${b.cls}" ${b.val ? `data-value="${b.val}"` : `data-action="${b.act}"`}>${b.lbl}</div>`;
            });
            return html + '</div>';
        }

        function loadCalcMode(mode) {
            cInput = ''; cExpr = ''; cLastOp = null; cResetNext = false; cUpdateDisplay();
            
            if (['basic', 'scientific'].includes(mode)) {
                calcStdDisplay.style.display = 'block';
                let btns = [];
                if (mode === 'scientific') {
                    btns.push(
                        {lbl:'sin', act:'sin', cls:'calc-btn-info'}, {lbl:'cos', act:'cos', cls:'calc-btn-info'}, {lbl:'tan', act:'tan', cls:'calc-btn-info'}, {lbl:'^', act:'power', cls:'calc-btn-primary'},
                        {lbl:'log', act:'log', cls:'calc-btn-info'}, {lbl:'ln', act:'ln', cls:'calc-btn-info'}, {lbl:'√', act:'sqrt', cls:'calc-btn-info'}, {lbl:'!', act:'factorial', cls:'calc-btn-info'}
                    );
                }
                btns.push(
                    {lbl:'M+', act:'memoryAdd', cls:'calc-btn-info'}, {lbl:'M-', act:'memorySubtract', cls:'calc-btn-info'}, {lbl:'MR', act:'memoryRecall', cls:'calc-btn-info'}, {lbl:'MC', act:'memoryClear', cls:'calc-btn-info'},
                    {lbl:'7', val:'7', cls:''}, {lbl:'8', val:'8', cls:''}, {lbl:'9', val:'9', cls:''}, {lbl:'C', act:'clear', cls:'calc-btn-danger'},
                    {lbl:'4', val:'4', cls:''}, {lbl:'5', val:'5', cls:''}, {lbl:'6', val:'6', cls:''}, {lbl:'÷', act:'divide', cls:'calc-btn-primary'},
                    {lbl:'1', val:'1', cls:''}, {lbl:'2', val:'2', cls:''}, {lbl:'3', val:'3', cls:''}, {lbl:'×', act:'multiply', cls:'calc-btn-primary'},
                    {lbl:'0', val:'0', cls:''}, {lbl:'.', val:'.', cls:''}, {lbl:'-', act:'subtract', cls:'calc-btn-primary'}, {lbl:'+', act:'add', cls:'calc-btn-primary'}
                );
                
                calcBody.innerHTML = buildGrid(btns) + `
                    <div style="display:flex; gap: 8px;">
                        <div class="calc-btn" data-action="backspace" style="flex:1;">⌫</div>
                        <div class="calc-btn calc-btn-success" data-action="equals" style="flex:1;">=</div>
                    </div>`;
                    
                calcBody.querySelectorAll('.calc-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        let t = e.currentTarget;
                        if(t.dataset.value) cHandleValue(t.dataset.value);
                        else cHandleAction(t.dataset.action);
                    });
                });

            } else {
                // Specialized Forms
                calcStdDisplay.style.display = 'none';
                
                if (mode === 'unit') {
                    calcBody.innerHTML = `
                        <label class="calc-label">Category</label>
                        <select id="uType" class="calc-input"><option value="length">Length</option><option value="weight">Weight</option><option value="temperature">Temperature</option></select>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <input type="number" id="uVal" class="calc-input" placeholder="0" style="flex:1;">
                            <select id="uFrom" class="calc-input" style="flex:1;"></select>
                            <span style="color:var(--icon-base);">to</span>
                            <select id="uTo" class="calc-input" style="flex:1;"></select>
                        </div>
                        <button id="uBtn" class="bs-btn btn-primary w-100" style="justify-content:center; padding:10px;">Convert</button>
                        <div id="uRes" style="margin-top:16px; text-align:center; font-size:18px; font-weight:bold; color:var(--icon-hover-color);"></div>
                    `;
                    
                    const uData = {
                        length: { 'Meter':1, 'Centimeter':0.01, 'Kilometer':1000, 'Inch':0.0254, 'Foot':0.3048, 'Mile':1609.34 },
                        weight: { 'Kilogram':1, 'Gram':0.001, 'Pound':0.453592, 'Ounce':0.0283495 },
                        temperature: { 'Celsius':'c', 'Fahrenheit':'f', 'Kelvin':'k' }
                    };
                    const popU = () => {
                        let d = uData[shadow.querySelector('#uType').value];
                        let h = ''; for(let k in d) h += `<option value="${d[k]}">${k}</option>`;
                        shadow.querySelector('#uFrom').innerHTML = h; shadow.querySelector('#uTo').innerHTML = h;
                    };
                    shadow.querySelector('#uType').addEventListener('change', popU); popU();
                    
                    shadow.querySelector('#uBtn').addEventListener('click', () => {
                        let v = parseFloat(shadow.querySelector('#uVal').value);
                        let t = shadow.querySelector('#uType').value;
                        let f = shadow.querySelector('#uFrom').value;
                        let to = shadow.querySelector('#uTo').value;
                        if(isNaN(v)) return;
                        
                        let res = 0;
                        if(t === 'temperature') {
                            let c = f==='c'?v : f==='f'?(v-32)*5/9 : v-273.15;
                            res = to==='c'?c : to==='f'?(c*9/5)+32 : c+273.15;
                        } else { res = (v * parseFloat(f)) / parseFloat(to); }
                        
                        shadow.querySelector('#uRes').innerText = `${res.toFixed(4)} ${shadow.querySelector('#uTo').options[shadow.querySelector('#uTo').selectedIndex].text}`;
                    });
                }
                
                else if (mode === 'percentage') {
                    calcBody.innerHTML = `
                        <label class="calc-label">Type</label>
                        <select id="pType" class="calc-input"><option value="1">What is X% of Y?</option><option value="2">X is what % of Y?</option><option value="3">% Change from X to Y</option></select>
                        <div style="display:flex; gap:8px;">
                            <input type="number" id="pX" class="calc-input" placeholder="X">
                            <input type="number" id="pY" class="calc-input" placeholder="Y">
                        </div>
                        <button id="pBtn" class="bs-btn btn-primary w-100" style="justify-content:center; padding:10px;">Calculate</button>
                        <div id="pRes" style="margin-top:16px; text-align:center; font-size:18px; font-weight:bold; color:var(--icon-hover-color);"></div>
                    `;
                    shadow.querySelector('#pBtn').addEventListener('click', () => {
                        let t = shadow.querySelector('#pType').value;
                        let x = parseFloat(shadow.querySelector('#pX').value); let y = parseFloat(shadow.querySelector('#pY').value);
                        if(isNaN(x)||isNaN(y)) return;
                        let res = t==='1' ? (x/100)*y : t==='2' ? (x/y)*100 : ((y-x)/x)*100;
                        shadow.querySelector('#pRes').innerText = t==='1' ? `${res}` : `${res.toFixed(2)}%`;
                    });
                }

                else if (mode === 'tip') {
                    calcBody.innerHTML = `
                        <label class="calc-label">Bill Amount ($)</label><input type="number" id="tBill" class="calc-input" placeholder="0.00">
                        <label class="calc-label">Tip (%)</label><input type="number" id="tTip" class="calc-input" value="15">
                        <label class="calc-label">Split (People)</label><input type="number" id="tSplit" class="calc-input" value="1">
                        <button id="tBtn" class="bs-btn btn-primary w-100" style="justify-content:center; padding:10px; margin-top:8px;">Calculate</button>
                        <div id="tRes" style="margin-top:16px; text-align:center; font-size:18px; font-weight:bold; color:var(--icon-hover-color);"></div>
                    `;
                    shadow.querySelector('#tBtn').addEventListener('click', () => {
                        let b = parseFloat(shadow.querySelector('#tBill').value);
                        let t = parseFloat(shadow.querySelector('#tTip').value);
                        let s = parseInt(shadow.querySelector('#tSplit').value);
                        if(isNaN(b)||isNaN(t)||isNaN(s)||s<1) return;
                        let tip = b * (t/100); let total = b + tip; let pp = total / s;
                        shadow.querySelector('#tRes').innerHTML = `Tip: $${tip.toFixed(2)} <br> Total: $${total.toFixed(2)} <br> <span style="font-size:14px; color:var(--icon-base);">Per Person: $${pp.toFixed(2)}</span>`;
                    });
                }

                else if (mode === 'date') {
                    calcBody.innerHTML = `
                        <label class="calc-label">Calculation Type</label>
                        <select id="dType" class="calc-input">
                            <option value="diff">Difference between dates</option>
                            <option value="add">Add/Subtract days</option>
                        </select>
                        <div id="dInputs"></div>
                        <button id="dBtn" class="bs-btn btn-primary w-100" style="justify-content:center; padding:10px; margin-top:8px;">Calculate</button>
                        <div id="dRes" style="margin-top:16px; text-align:center; font-size:16px; font-weight:bold; color:var(--icon-hover-color);"></div>
                    `;
                    const dType = shadow.querySelector('#dType');
                    const dInputs = shadow.querySelector('#dInputs');
                    const renderDInputs = () => {
                        if (dType.value === 'diff') {
                            dInputs.innerHTML = `
                                <label class="calc-label">Start Date</label><input type="date" id="dStart" class="calc-input">
                                <label class="calc-label">End Date</label><input type="date" id="dEnd" class="calc-input">
                            `;
                        } else {
                            dInputs.innerHTML = `
                                <label class="calc-label">Base Date</label><input type="date" id="dBase" class="calc-input">
                                <div style="display:flex; gap:8px;">
                                    <select id="dOp" class="calc-input" style="flex:1;"><option value="1">Add (+)</option><option value="-1">Subtract (-)</option></select>
                                    <input type="number" id="dDays" class="calc-input" placeholder="Days" style="flex:1;">
                                </div>
                            `;
                        }
                    };
                    dType.addEventListener('change', renderDInputs); renderDInputs();

                    shadow.querySelector('#dBtn').addEventListener('click', () => {
                        let res = '';
                        if (dType.value === 'diff') {
                            const s = new Date(shadow.querySelector('#dStart').value);
                            const e = new Date(shadow.querySelector('#dEnd').value);
                            if(isNaN(s)||isNaN(e)) return;
                            const diff = Math.abs(e - s) / (1000 * 60 * 60 * 24);
                            res = `${diff} days`;
                        } else {
                            const b = new Date(shadow.querySelector('#dBase').value);
                            const days = parseInt(shadow.querySelector('#dDays').value) || 0;
                            const op = parseInt(shadow.querySelector('#dOp').value);
                            if(isNaN(b)) return;
                            b.setDate(b.getDate() + (days * op));
                            res = b.toDateString();
                        }
                        shadow.querySelector('#dRes').innerText = res;
                    });
                }

                else if (mode === 'mortgage') {
                    calcBody.innerHTML = `
                        <label class="calc-label">Loan Amount ($)</label><input type="number" id="mPrincipal" class="calc-input" placeholder="0">
                        <label class="calc-label">Interest Rate (%)</label><input type="number" id="mRate" class="calc-input" placeholder="0">
                        <label class="calc-label">Loan Term (Years)</label><input type="number" id="mYears" class="calc-input" placeholder="0">
                        <button id="mBtn" class="bs-btn btn-primary w-100" style="justify-content:center; padding:10px; margin-top:8px;">Calculate</button>
                        <div id="mRes" style="margin-top:16px; text-align:center; font-size:16px; font-weight:bold; color:var(--icon-hover-color);"></div>
                    `;
                    shadow.querySelector('#mBtn').addEventListener('click', () => {
                        let p = parseFloat(shadow.querySelector('#mPrincipal').value);
                        let r = parseFloat(shadow.querySelector('#mRate').value);
                        let y = parseFloat(shadow.querySelector('#mYears').value);
                        if(isNaN(p)||isNaN(r)||isNaN(y)) return;
                        
                        let monthlyRate = (r / 100) / 12;
                        let numPayments = y * 12;
                        let monthly = (p * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);
                        if(isNaN(monthly) || !isFinite(monthly)) monthly = 0;
                        let total = monthly * numPayments;
                        let interest = total - p;
                        
                        shadow.querySelector('#mRes').innerHTML = `Monthly: $${monthly.toFixed(2)}<br><span style="font-size:12px; color:var(--icon-base);">Total Interest: $${interest.toFixed(2)}</span>`;
                    });
                }

                else if (mode === 'health') {
                    calcBody.innerHTML = `
                        <label class="calc-label">Type</label>
                        <select id="hType" class="calc-input"><option value="bmi">BMI Calculator</option><option value="bmr">BMR (Calories)</option></select>
                        <label class="calc-label">Weight (kg)</label><input type="number" id="hWeight" class="calc-input" placeholder="0">
                        <label class="calc-label">Height (cm)</label><input type="number" id="hHeight" class="calc-input" placeholder="0">
                        <div id="hExtra" style="display:none; gap:8px;">
                            <div style="flex:1;"><label class="calc-label">Age</label><input type="number" id="hAge" class="calc-input" placeholder="0"></div>
                            <div style="flex:1;"><label class="calc-label">Gender</label><select id="hGen" class="calc-input"><option value="m">Male</option><option value="f">Female</option></select></div>
                        </div>
                        <button id="hBtn" class="bs-btn btn-primary w-100" style="justify-content:center; padding:10px; margin-top:8px;">Calculate</button>
                        <div id="hRes" style="margin-top:16px; text-align:center; font-size:16px; font-weight:bold; color:var(--icon-hover-color);"></div>
                    `;
                    const hType = shadow.querySelector('#hType');
                    hType.addEventListener('change', () => {
                        shadow.querySelector('#hExtra').style.display = hType.value === 'bmr' ? 'flex' : 'none';
                    });
                    shadow.querySelector('#hBtn').addEventListener('click', () => {
                        let w = parseFloat(shadow.querySelector('#hWeight').value);
                        let h = parseFloat(shadow.querySelector('#hHeight').value);
                        if(isNaN(w)||isNaN(h)) return;
                        
                        if (hType.value === 'bmi') {
                            let bmi = w / Math.pow(h/100, 2);
                            let cat = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
                            shadow.querySelector('#hRes').innerHTML = `BMI: ${bmi.toFixed(1)}<br><span style="font-size:14px; color:var(--icon-base);">${cat}</span>`;
                        } else {
                            let a = parseInt(shadow.querySelector('#hAge').value);
                            let g = shadow.querySelector('#hGen').value;
                            if(isNaN(a)) return;
                            let bmr = g === 'm' ? (88.362 + (13.397*w) + (4.799*h) - (5.677*a)) : (447.593 + (9.247*w) + (3.098*h) - (4.330*a));
                            shadow.querySelector('#hRes').innerHTML = `BMR: ${bmr.toFixed(0)} kcal/day`;
                        }
                    });
                }
                
                else {
                    calcBody.innerHTML = `<div style="text-align:center; color:var(--icon-base); opacity:0.6; padding: 30px 0;"><i>Select Standard, Scientific, Unit, Percentage, or Tip tools for full functionality.</i></div>`;
                }
            }
        }

        calcModeSelect.addEventListener('change', (e) => loadCalcMode(e.target.value));
        loadCalcMode('basic'); // Initialize

        // 🟢 KEYBOARD BINDINGS
        document.addEventListener('keydown', function(e) {
            if (!calcWidget || !calcWidget.classList.contains('show')) return;
            const mode = calcModeSelect.value;
            if (!['basic', 'scientific'].includes(mode)) return;

            if (['Enter', 'Backspace', '/'].includes(e.key)) e.preventDefault();

            const key = e.key;
            const keyMapAction = { 'Enter':'equals', '=':'equals', 'Backspace':'backspace', 'Escape':'clear', '+':'add', '-':'subtract', '*':'multiply', '/':'divide', '^':'power', '!':'factorial' };

            let btnToFlash = null;

            if (/[0-9.]/.test(key)) {
                cHandleValue(key);
                btnToFlash = shadow.querySelector(`.calc-btn[data-value="${key}"]`);
            } else if (keyMapAction[key]) {
                cHandleAction(keyMapAction[key]);
                btnToFlash = shadow.querySelector(`.calc-btn[data-action="${keyMapAction[key]}"]`);
            } else if (mode === 'scientific') {
                const sciMap = {'l':'log', 's':'sin', 'c':'cos', 't':'tan'};
                if (sciMap[key]) {
                    cHandleAction(sciMap[key]);
                    btnToFlash = shadow.querySelector(`.calc-btn[data-action="${sciMap[key]}"]`);
                }
            }

            if (btnToFlash) {
                btnToFlash.classList.add('active');
                setTimeout(() => btnToFlash.classList.remove('active'), 100);
            }
        });

        // --- 🟢 WEATHER WIDGET LOGIC & DRAGGING ---
        shadow.querySelector('#wx-close').addEventListener('click', () => weatherWidget.classList.remove('show'));

        const wxHeader = shadow.querySelector('#wx-header');
        let isDraggingWx = false;
        let wStartX, wStartY, wStartLeft, wStartTop;

        wxHeader.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') return;
            isDraggingWx = true;
            wStartX = e.clientX; wStartY = e.clientY;
            const rect = weatherWidget.getBoundingClientRect();
            wStartLeft = rect.left; wStartTop = rect.top;

            const onMouseMoveWx = (moveEvent) => {
                if (!isDraggingWx) return;
                weatherWidget.style.right = 'auto';
                weatherWidget.style.bottom = 'auto';
                weatherWidget.style.left = (wStartLeft + (moveEvent.clientX - wStartX)) + 'px';
                weatherWidget.style.top = (wStartTop + (moveEvent.clientY - wStartY)) + 'px';
            };
            const onMouseUpWx = () => {
                isDraggingWx = false;
                document.removeEventListener('mousemove', onMouseMoveWx);
                document.removeEventListener('mouseup', onMouseUpWx);
            };
            document.addEventListener('mousemove', onMouseMoveWx);
            document.addEventListener('mouseup', onMouseUpWx);
        });

        // 🟢 WEATHER ENGINE
        const wxSearchInput = shadow.querySelector('#wx-search-input');
        const wxSearchResults = shadow.querySelector('#wx-search-results');
        const wxUnitToggle = shadow.querySelector('#wx-unit-toggle');
        const wxUnitLbl = shadow.querySelector('#wx-unit-lbl');
        const wxLoader = shadow.querySelector('#wx-loader');
        const wxContent = shadow.querySelector('#wx-content');
        const wxRadarContainer = shadow.querySelector('#wx-radar-container');
        let wxRadarFrame = null;

        let wxLat = null, wxLon = null, wxCity = "Unknown", wxIsF = false;

        // Load Initial State
        chrome.storage.local.get(['wxLocation', 'wxUnit'], (res) => {
            wxIsF = (res.wxUnit === 'F');
            wxUnitToggle.checked = wxIsF;
            wxUnitLbl.innerText = wxIsF ? '°F' : '°C';
            
            if (res.wxLocation) {
                wxLat = res.wxLocation.lat;
                wxLon = res.wxLocation.lon;
                wxCity = res.wxLocation.name;
                refreshWeatherIfStale();
            } else {
                wxLoader.innerHTML = `<svg width="48" height="48" fill="currentColor" viewBox="0 0 16 16" style="opacity: 0.5; margin-bottom: 12px; display: block; margin-left: auto; margin-right: auto;"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/></svg><span style="font-size: 12px; font-weight: bold;">Search for a city above to begin!</span>`;
            }
        });

        // Unit Toggle
        wxUnitToggle.addEventListener('change', (e) => {
            wxIsF = e.target.checked;
            wxUnitLbl.innerText = wxIsF ? '°F' : '°C';
            chrome.storage.local.set({ wxUnit: wxIsF ? 'F' : 'C' });
            if (wxLat) fetchWeatherData();
        });

        // Search City (Geocoding API)
        let wxSearchTimeout;
        wxSearchInput.addEventListener('input', (e) => {
            clearTimeout(wxSearchTimeout);
            const query = e.target.value.trim();
            if (query.length < 3) { wxSearchResults.style.display = 'none'; return; }
            
            wxSearchResults.innerHTML = '<div style="padding: 10px; color: var(--icon-base); font-size: 12px; text-align: center;">Searching...</div>';
            wxSearchResults.style.display = 'block';

            wxSearchTimeout = setTimeout(async () => {
                try {
                    const res = await apiFetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`);
                    const data = await res.json();
                    
                    wxSearchResults.innerHTML = '';
                    if (!data.results || data.results.length === 0) {
                        wxSearchResults.innerHTML = '<div style="padding: 10px; color: var(--mq-danger); font-size: 12px; text-align: center;">No cities found</div>';
                        return;
                    }

                    data.results.forEach(city => {
                        const locStr = [city.admin1, city.country].filter(Boolean).join(", ");
                        const item = document.createElement('div');
                        item.className = 'wx-sug-item';
                        item.innerHTML = `<strong>${escHtml(city.name)}</strong> <small style="opacity:0.7;">${escHtml(locStr)}</small>`;
                        item.addEventListener('click', () => {
                            wxLat = city.latitude; wxLon = city.longitude; wxCity = city.name;
                            chrome.storage.local.set({ wxLocation: { lat: wxLat, lon: wxLon, name: wxCity } });
                            wxSearchInput.value = '';
                            wxSearchResults.style.display = 'none';
                            fetchWeatherData();
                        });
                        wxSearchResults.appendChild(item);
                    });
                } catch(err) { wxSearchResults.style.display = 'none'; }
            }, 500);
        });

        // Helper: Weather Code Dictionary (Converted to bulletproof Emojis)
        function getWxMeta(code) {
            const map = {
                0:['Clear Sky','sun', 'linear-gradient(135deg, #3b82f6, #0ea5e9)'], 
                1:['Mainly Clear','cloud-sun', 'linear-gradient(135deg, #3b82f6, #0ea5e9)'], 
                2:['Partly Cloudy','clouds', 'linear-gradient(135deg, #64748b, #94a3b8)'],
                3:['Overcast','cloud', 'linear-gradient(135deg, #475569, #64748b)'], 
                45:['Foggy','cloud-fog2', 'linear-gradient(135deg, #94a3b8, #cbd5e1)'], 
                51:['Light Drizzle','cloud-drizzle', 'linear-gradient(135deg, #0284c7, #38bdf8)'], 
                61:['Rain','cloud-rain', 'linear-gradient(135deg, #2563eb, #3b82f6)'], 
                65:['Heavy Rain','cloud-rain-heavy', 'linear-gradient(135deg, #1d4ed8, #2563eb)'],
                71:['Snow','snow', 'linear-gradient(135deg, #0891b2, #06b6d4)'], 
                95:['Thunderstorm','cloud-lightning-rain', 'linear-gradient(135deg, #4c1d95, #1e1b4b)']
            };
            if(code>=51 && code<=55) return map[51]; if(code>=61 && code<=67) return map[61]; 
            if(code>=71 && code<=77) return map[71]; if(code>=80 && code<=82) return map[61];
            if(code>=95) return map[95]; return map[code] || ['Unknown','cloud', 'linear-gradient(135deg, #64748b, #94a3b8)'];
        }

        // Fetch Open-Meteo Data
        // The forecast is fetched when the widget is shown in a visible tab, at most every 10 minutes,
        // not on every page load in every tab.
        let wxFetchedAt = 0;
        function refreshWeatherIfStale() {
            if (!wxLat || !weatherWidget.classList.contains('show')) return;
            if (document.visibilityState !== 'visible') return; // the visibilitychange listener retries
            if (Date.now() - wxFetchedAt < 10 * 60 * 1000) return;
            fetchWeatherData();
        }
        document.addEventListener('visibilitychange', refreshWeatherIfStale);

        async function fetchWeatherData() {
            wxFetchedAt = Date.now();
            wxLoader.style.display = 'block';
            wxLoader.innerHTML = `<div class="spinner-border text-info mb-2" role="status" style="width: 2rem; height: 2rem;"></div><br><span style="font-size: 12px; font-weight: bold;">Syncing with satellites...</span>`;
            wxContent.style.display = 'none';
            
            const unitStr = wxIsF ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : "";
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${wxLat}&longitude=${wxLon}&current=temperature_2m,apparent_temperature,is_day,weather_code,relative_humidity_2m,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code,uv_index&daily=weather_code,temperature_2m_max,temperature_2m_min&air_quality=us_aqi${unitStr}&timezone=auto`;

            try {
                const res = await apiFetch(url);
                const data = await res.json();
                
                const cur = data.current;
                const meta = getWxMeta(cur.weather_code);
                const speedU = wxIsF ? "mph" : "km/h";

                // Update Current Card
                shadow.querySelector('#wx-card-bg').style.background = (cur.is_day === 0) ? 'linear-gradient(135deg, #0f172a, #1e293b)' : meta[2];
                shadow.querySelector('#wx-city-name').innerText = wxCity;
                shadow.querySelector('#wx-date').innerText = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
                shadow.querySelector('#wx-temp').innerText = Math.round(cur.temperature_2m) + "°";
                shadow.querySelector('#wx-feels').innerText = Math.round(cur.apparent_temperature) + "°";
                shadow.querySelector('#wx-cond').innerText = meta[0];
                
                const iconEl = shadow.querySelector('#wx-icon');
                iconEl.innerHTML = ico(meta[1]);

                // Update Grid
                shadow.querySelector('#wx-hum').innerText = cur.relative_humidity_2m + "%";
                shadow.querySelector('#wx-wind').innerText = Math.round(cur.wind_speed_10m) + " " + speedU;
                
                // 🟢 FIXED: Safely check if UV & AQI arrays exist before reading them!
                shadow.querySelector('#wx-uv').innerText = data.hourly?.uv_index?.[0] ?? '--';
                const aqiVal = data.current?.us_aqi ?? data.hourly?.us_aqi?.[0] ?? '--';
                shadow.querySelector('#wx-aqi').innerText = aqiVal;

                // Update Hourly
                const hScroll = shadow.querySelector('#wx-hourly-scroll');
                hScroll.innerHTML = '';
                const currentHour = new Date().getHours();
                for(let i = 0; i < 24; i++) {
                    const idx = i + currentHour;
                    // 🟢 FIXED: Safety escape if hourly data is shorter than expected
                    if (!data.hourly || !data.hourly.time || idx >= data.hourly.time.length) break;
                    
                    const hMeta = getWxMeta(data.hourly.weather_code[idx]);
                    const hDate = new Date(data.hourly.time[idx]);
                    const hLabel = hDate.getHours() === currentHour ? "Now" : hDate.getHours().toString().padStart(2, '0') + ":00";
                    
                    hScroll.innerHTML += `
                        <div class="wx-hourly-item">
                            <div style="font-size: 12px; font-weight: bold; margin-bottom: 4px;">${hLabel}</div>
                            <div style="font-size: 24px; margin-bottom: 2px; line-height: 1;">${ico(hMeta[1])}</div>
                            <div style="font-size: 14px; font-weight: 800;">${Math.round(data.hourly.temperature_2m[idx])}°</div>
                            <div style="font-size: 12px; color: var(--mq-accent); font-weight: bold;">${ico('droplet')} ${escHtml(data.hourly.precipitation_probability[idx])}%</div>
                        </div>
                    `;
                }

                // Update Daily
                const dList = shadow.querySelector('#wx-daily-list');
                dList.innerHTML = '';
                // 🟢 FIXED: Safety wrapper for daily data
                if (data.daily && data.daily.time) {
                    for(let i = 0; i < 7; i++) {
                        if (i >= data.daily.time.length) break;
                        const dMeta = getWxMeta(data.daily.weather_code[i]);
                        const dName = i === 0 ? "Today" : new Date(data.daily.time[i]).toLocaleDateString('en-US', { weekday: 'short' });
                        dList.innerHTML += `
                            <div class="wx-daily-item">
                                <div style="width: 50px;">${dName}</div>
                                <div style="color: var(--mq-accent); font-size: 12px;">${ico('droplet')} --%</div>
                                <div style="font-size: 20px; line-height: 1;">${ico(dMeta[1])}</div>
                                <div style="width: 60px; text-align: right;">${Math.round(data.daily.temperature_2m_max[i])}° <span style="opacity:0.5; font-size:12px;">${Math.round(data.daily.temperature_2m_min[i])}°</span></div>
                            </div>
                        `;
                    }
                }

                wxLoader.style.display = 'none';
                wxContent.style.display = 'block';

            } catch (err) {
                console.error("[The Marquis] Weather Engine Crash:", err);
                wxFetchedAt = 0; // retry on the next open
                wxLoader.innerHTML = `<div style="font-size: 32px; margin-bottom: 8px;">${ico('exclamation-triangle')}</div><span style="font-size: 12px; font-weight: bold; color: var(--mq-danger);">Atmospheric connection severed.</span>`;
            }
        }

        // Radar Logic (Windy Embed)
        shadow.querySelector('#wx-btn-radar').addEventListener('click', () => {
            if(!wxLat) return;
            const url = `https://embed.windy.com/embed2.html?lat=${wxLat}&lon=${wxLon}&zoom=6&level=surface&overlay=rain&menu=&message=&marker=true&type=map&location=coordinates&detail=&metricWind=default&metricTemp=default&radarRange=-1`;
            wxRadarFrame?.remove();
            wxRadarFrame = document.createElement('iframe');
            wxRadarFrame.id = 'wx-radar-frame';
            wxRadarFrame.title = 'Live weather radar';
            wxRadarFrame.referrerPolicy = 'no-referrer'; // the radar host does not need the visited site's address
            wxRadarFrame.style.cssText = 'width: 100%; flex-grow: 1; border: none; background: #222;';
            wxRadarFrame.src = url;
            wxRadarContainer.append(wxRadarFrame);
            wxRadarContainer.style.display = 'flex';
        });

        shadow.querySelector('#wx-close-radar').addEventListener('click', () => {
            wxRadarContainer.style.display = 'none';
            wxRadarFrame?.remove(); // Save memory
            wxRadarFrame = null;
        });
    }

    // END of create dock

    // dockEnabled is the single switch: the popup toggle writes it, every open page follows it.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.dockEnabled) return;
        const root = document.getElementById('marquis-floating-root');
        if (changes.dockEnabled.newValue === true) {
            // 🟢 FIXED: If it exists, just unhide it. If it doesn't, create it!
            if (!root) createDock();
            else root.style.display = 'block';
        } else if (root) {
            // 🟢 FIXED: Just hide the dock instead of deleting the whole DOM
            root.style.display = 'none';
        }
    });

    // 🟢 FIXED: This tells the dock to actually render when you load a page!
    chrome.storage.local.get(['dockEnabled'], (res) => {
        // ✅ FIX: Only create if explicitly set to true; undefined = never enabled
        if (res.dockEnabled === true) createDock();
    });

    // Auto-cleanup when the extension is reloaded, updated or removed while this page stays open.
    // Checked when the dock is touched or the tab becomes visible again, instead of polling every tab.
    function selfDestruct() {
        const ghostDock = document.getElementById('marquis-floating-root');
        if (ghostDock) ghostDock.remove();
        window.hasMarquisDockInjected = false;
        document.removeEventListener('visibilitychange', removeIfOrphaned);
    }

    function removeIfOrphaned(e) {
        let alive = false;
        try { alive = !!chrome.runtime?.id; } catch (err) { /* context invalidated */ }
        if (alive) return;
        if (e && e.type === 'pointerdown') { e.stopPropagation(); e.preventDefault(); }
        selfDestruct();
    }

    document.addEventListener('visibilitychange', removeIfOrphaned);

})();