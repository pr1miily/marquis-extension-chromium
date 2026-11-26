document.addEventListener("DOMContentLoaded", async function () {
    console.log("✅ Script loaded and running.");

    // Every <select> and Bootstrap dropdown in the popup (and any a section adds later) opens a themed
    // floating panel instead of the browser's native list; the <select> elements stay as the data source.
    MarquisFloat.enhanceAll(document);

    // ==========================================
    // 🎨 THEME ENGINE (Google Sync + Dock Sync)
    // ==========================================
    const themeBtns = document.querySelectorAll('.app-theme-btn');

    function applyTheme(theme) {
        const isLight = (theme === 'light');
        document.documentElement.setAttribute('data-bs-theme', isLight ? 'light' : 'dark');
        document.documentElement.setAttribute('data-marquis-theme', theme);
        
        themeBtns.forEach(btn => {
            const selected = btn.getAttribute('data-theme') === theme;
            btn.setAttribute('aria-pressed', String(selected));
            if (selected) {
                btn.classList.add('border-primary', 'border-2');
                btn.classList.remove('border-secondary-subtle');
            } else {
                btn.classList.remove('border-primary', 'border-2');
                btn.classList.add('border-secondary-subtle');
            }
        });

        const alphaContainer = document.getElementById('alpha-slider-container');
        if (alphaContainer) {
            alphaContainer.style.display = (theme === 'custom-alpha') ? 'flex' : 'none';
        }
        // The dock follows sync.marquis_theme directly; local.dockTheme is no longer written (see background.js).
    }

    // Listen for theme clicks in the Settings Modal
    themeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const newTheme = e.currentTarget.getAttribute('data-theme');
            applyTheme(newTheme);
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
                chrome.storage.sync.set({ marquis_theme: newTheme });
            }
        });
    });
    // ==========================================
    // END THEME ENGINE
    // ==========================================


    // ==========================================
    // ⚡ BATCHED STARTUP STORAGE READ
    // All startup data fetched in a single round-trip pair instead of
    // 4+ sequential chrome.storage calls that each block the UI thread.
    // ==========================================
    const [syncData, localData, sessionData] = await Promise.all([
        chrome.storage.sync.get(['marquis_theme', 'marquis_license', 'wxUnit']),
        chrome.storage.local.get(['userProfilePic', 'themeAlpha', 'navMode', 'navMenuHidden', 'toolHistory']),
        chrome.storage.session.get('marquisOpenSection') // set by dock "open in hub" buttons (background.js)
    ]);

    // Apply theme immediately from the batched result
    applyTheme(syncData.marquis_theme || 'default');


    // ==========================================
    // ⚡ LAZY-LOAD SECTION ROUTER
    // Sections live in <template> tags in the HTML — zero DOM cost at startup.
    // A section is only cloned into the live DOM the first time it is selected.
    // ==========================================
    const menuSelector = document.getElementById("menuSelector");

    // Dropdown option values that differ from their rendered section IDs
    const SECTION_ID_MAP = {
        'worldTime': 'worldTimeSection'
    };

    // Sections that are already plain <div>s in the DOM (not templates)
    const PRE_RENDERED_IDS = new Set(['homeSection', 'suggestionsSection']);

    // Cache: sectionId → live wrapper element
    const renderedSections = {};

    // Pre-populate cache for pre-rendered sections
    PRE_RENDERED_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) renderedSections[id] = el;
    });

    function getSectionId(menuValue) {
        return SECTION_ID_MAP[menuValue] || menuValue;
    }

    // Scripts each section needs, loaded in order on its first open (vendor libraries first).
    // Sections not listed need no extra script: favorites, world time and suggestions are
    // always loaded (Marquis.html), and the speed test is handled in this file.
    const SECTION_SCRIPTS = {
        kanbanSection:          ['scripts/sortable.min.js', 'scripts/kanban_store.js', 'scripts/kanban.js'],
        workspaceSection:       ['scripts/workspace.js'],
        focusSection:           ['scripts/focus_timer.js', 'scripts/focus.js'],
        stickyNotesSection:     ['scripts/sticky_notes.js'],
        diffCheckerSection:     ['scripts/diffchecker.min.js', 'scripts/diffchecker.js'],
        weatherSection:         ['scripts/weather.js'],
        languageCodeSection:    ['scripts/language_code.js'],
        dictionarySection:      ['scripts/dictionary.js'],
        fpSection:              ['scripts/fsPopup.js'],
        meetAttendanceSection:  ['scripts/meet_attendance.js'],
        qadevSection:           ['scripts/qadev.js'],
        cssInspectorSection:    ['scripts/css_inspector.js'],
        seoSection:             ['scripts/seo_crawler.js', 'scripts/seo.js'],
        buoSection:             ['scripts/url_list.js', 'scripts/bulk-url.js'],
        toolkitSection:         ['scripts/math.min.js', 'scripts/calculator.js', 'scripts/toolkitSection.js'],
        extractSection:         ['scripts/extractor.js'],
        highlighterSection:     ['scripts/highlighter.js'],
        designSection:          ['scripts/design_tools.js'],
        webPaintSection:        ['scripts/web_paint.js'],
        imageCompressorSection: ['scripts/img_compressor.js']
    };

    // src -> load promise. Classic scripts must run once: a second run would redeclare
    // their top-level const/let and throw.
    const scriptLoads = new Map();
    // Scripts the page already loads with a tag (kanban_store.js, for the Notifications panel) count as loaded.
    document.querySelectorAll('script[src]').forEach(s => scriptLoads.set(s.getAttribute('src'), Promise.resolve()));

    function loadScript(src) {
        if (!scriptLoads.has(src)) {
            scriptLoads.set(src, new Promise((resolve, reject) => {
                const el = document.createElement('script');
                el.src = src;
                el.onload = resolve;
                el.onerror = () => reject(new Error(`Could not load ${src}`));
                document.head.appendChild(el);
            }));
        }
        return scriptLoads.get(src);
    }

    async function loadSectionScripts(sectionId) {
        const startMark = `marquis:section:${sectionId}:start`;
        performance.mark(startMark);
        for (const src of SECTION_SCRIPTS[sectionId] || []) await loadScript(src);
        performance.measure(`marquis:section:${sectionId}`, startMark);
    }

    /**
     * Returns the live section <div>, creating it from its <template> if this
     * is the first time the section has been requested.
     */
    function getOrRenderSection(sectionId) {
        // Already in cache — fast path
        if (renderedSections[sectionId]) return renderedSections[sectionId];

        const tmpl = document.getElementById(`tmpl_${sectionId}`);
        if (!tmpl) {
            console.warn(`⚠️ No template found for: ${sectionId}`);
            return null;
        }

        // Stamp template into a new wrapper div
        const wrapper = document.createElement('div');
        wrapper.id = sectionId;
        wrapper.className = 'd-none';
        wrapper.appendChild(tmpl.content.cloneNode(true));

        // Insert into the same container the templates live in
        tmpl.parentElement.appendChild(wrapper);
        renderedSections[sectionId] = wrapper;

        // Signal section scripts that their DOM is now live, once their code has loaded.
        // Section scripts should listen:
        //   document.addEventListener('marquis:sectionReady', e => {
        //       if (e.detail.sectionId === 'mySectionId') init();
        //   });
        // init therefore runs AFTER the menu 'change' event that opened the section.
        loadSectionScripts(sectionId).then(() => {
            document.dispatchEvent(new CustomEvent('marquis:sectionReady', {
                detail: { sectionId }
            }));
            console.log(`✅ Lazily rendered: ${sectionId}`);
        }).catch((err) => {
            console.error('[Marquis] Section failed to load:', err);
            if (window.showGlobalAlert) {
                window.showGlobalAlert('Section Failed to Load', `${err.message}. Close and reopen Marquis to retry.`, 'error');
            }
        });

        return wrapper;
    }

    function toggleMenu() {
        const menuValue = menuSelector.value;

        // Blur the dropdown immediately to prevent the OS-level glitch
        // where the native dropdown stays open during a DOM height change.
        if (document.activeElement === menuSelector) menuSelector.blur();

        // Hide all currently rendered sections
        Object.values(renderedSections).forEach(el => {
            el.classList.remove('animate__animated', 'animate__fadeIn');
            el.classList.add('d-none');
        });

        if (!menuValue) return;

        const sectionId = getSectionId(menuValue);
        const section = getOrRenderSection(sectionId);

        if (section) {
            section.classList.remove('d-none');
            section.classList.add('animate__animated', 'animate__fadeIn');
            if (sectionId === HOME) renderHome(true);
            else recordToolOpen(menuValue);
            if (sectionId === FAVS) renderFavoritesSection();
        }
    }


    // ==========================================
    // 🧭 TOOL REGISTRY · HOME · NAVIGATION MODE
    // The options of #menuSelector are the one tool registry: the inline picker shows them, Home and
    // the tools window (#navModal) are built from them, and every launch goes through the select's
    // change event (toggleMenu). Favorites stay owned by favorites.js (window.marquisFavorites).
    // ==========================================
    const HOME = 'homeSection';
    const { esc } = MarquisHtml;

    // Launchable options in picker order: each <optgroup> is a category, loose options form unlabeled groups.
    function toolGroups() {
        const groups = [];
        for (const el of menuSelector.children) {
            const isGroup = el.tagName === 'OPTGROUP';
            const options = (isGroup ? [...el.children] : [el]).filter(o => o.value && !o.hidden && !o.disabled);
            if (!options.length) continue;
            if (!isGroup && groups.length && !groups.at(-1).label) groups.at(-1).options.push(...options);
            else groups.push({ label: isGroup ? el.label : '', options });
        }
        return groups;
    }
    const toolOptions = () => toolGroups().flatMap(g => g.options);
    // Favorites are stored as section ids (worldTimeSection), the registry uses option values (worldTime).
    const favoriteOptions = () => {
        const all = toolOptions();
        return (window.marquisFavorites?.() || []).map(id => all.find(o => getSectionId(o.value) === id)).filter(Boolean);
    };

    function launchTool(value) {
        menuSelector.value = value;
        menuSelector.dispatchEvent(new Event('change'));
    }

    // --- Usage history: local.toolHistory = { [option value]: { n: times opened, t: last opened (ms) } } ---
    let toolHistory = localData.toolHistory || {};
    function recordToolOpen(value) {
        const prev = toolHistory[value] || { n: 0, t: 0 };
        toolHistory = { ...toolHistory, [value]: { n: prev.n + 1, t: Date.now() } };
        chrome.storage.local.set({ toolHistory });
    }

    // --- How a tool looks: its option's data-icon / data-color (the inline picker draws the same tile) ---
    const iconHtml = (o, size) => {
        const { icon = 'bi bi-app', color } = o.dataset;
        const style = [color && `--tool: ${color}`, size && `--size: ${size}px`].filter(Boolean).join('; ');
        return `<span class="mq-tool-icon"${style ? ` style="${esc(style)}"` : ''} aria-hidden="true"><i class="${esc(icon)}"></i></span>`;
    };
    const PIN_HINT = `Click the <i class="bi bi-star" role="img" aria-label="star"></i> in any tool's header to pin it here.`;
    // Search shared by Home and the tools window: matches the tool name or its category.
    const filterGroups = (q) => toolGroups()
        .map(g => ({ ...g, options: q ? g.options.filter(o => `${o.text} ${g.label}`.toLowerCase().includes(q)) : g.options }))
        .filter(g => g.options.length);

    // --- Home ---
    const homeEl = document.getElementById(HOME);
    const homeSearch = document.getElementById('homeSearch');
    const homeDashboard = document.getElementById('homeDashboard');
    const homeResults = document.getElementById('homeResults');
    const QUICK_DEFAULTS = ['stickyNotesSection', 'kanbanSection', 'fpSection', 'buoSection']; // "Suggested" until there is history
    const ago = (t) => {
        const m = Math.round((Date.now() - t) / 60000);
        return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
    };
    const tile = (o) => {
        const { color } = o.dataset;
        return `<div class="col"><button type="button" class="mq-tool-tile" data-value="${esc(o.value)}"${color ? ` style="--tool: ${esc(color)}"` : ''}>
            ${iconHtml(o, 34)}<span class="mq-tool-name">${esc(o.text)}</span></button></div>`;
    };
    const row = (o, meta = '') => `<button type="button" class="mq-tool-row" data-value="${esc(o.value)}">${iconHtml(o, 28)}
        <span class="mq-tool-name">${esc(o.text)}</span>${meta ? `<span class="mq-home-meta">${esc(meta)}</span>` : ''}</button>`;
    const catCard = (name, options, filter) => `<div class="col"><button type="button" class="mq-cat-card" data-nav-filter="${esc(filter)}">
        <span class="mq-cat-icons">${options.slice(0, 4).map(o => iconHtml(o)).join('')}</span>
        <span><span class="d-block mq-cat-name">${esc(name)}</span><span class="d-block mq-home-meta">${options.length} tools</span></span></button></div>`;

    function renderHome(resetSearch = false) {
        if (resetSearch) homeSearch.value = '';
        const q = homeSearch.value.trim().toLowerCase();
        homeDashboard.classList.toggle('d-none', !!q);
        homeResults.classList.toggle('d-none', !q);
        if (q) {
            const hits = filterGroups(q).flatMap(g => g.options).filter(o => o.value !== HOME);
            homeResults.innerHTML = hits.length
                ? `<div class="mq-home-title"><i class="bi bi-search" aria-hidden="true"></i> Results <span class="mq-home-meta">${hits.length} found · Enter opens the first</span></div>
                   <div class="row row-cols-2 g-1">${hits.map(o => `<div class="col">${row(o)}</div>`).join('')}</div>`
                : `<div class="mq-home-empty"><i class="bi bi-search" aria-hidden="true"></i> No tools match “${esc(homeSearch.value.trim())}”</div>`;
            return;
        }

        const byValue = new Map(toolOptions().filter(o => o.value !== HOME).map(o => [o.value, o]));
        const used = Object.entries(toolHistory).filter(([v]) => byValue.has(v));
        const recent = [...used].sort((a, b) => b[1].t - a[1].t).slice(0, 4);
        const isRecent = (v) => recent.some(([r]) => r === v);
        const frequent = [...used].sort((a, b) => b[1].n - a[1].n).filter(([v]) => !isRecent(v)).slice(0, 4);
        const suggested = QUICK_DEFAULTS.filter(v => byValue.has(v) && !isRecent(v) && !frequent.some(([f]) => f === v));
        const favs = favoriteOptions();

        document.getElementById('homeFavCount').textContent = favs.length ? `${favs.length} pinned` : '';
        document.getElementById('homeFavorites').innerHTML = favs.length ? favs.map(tile).join('')
            : `<div class="col-12"><div class="mq-home-empty">${PIN_HINT}</div></div>`;
        document.getElementById('homeRecent').innerHTML = recent.length
            ? recent.map(([v, h]) => row(byValue.get(v), ago(h.t))).join('')
            : '<div class="mq-home-empty h-100 flex-column text-center"><i class="bi bi-clock-history fs-5" aria-hidden="true"></i>Tools you open will show up here.</div>';
        document.getElementById('homeQuickTitle').textContent = frequent.length ? 'Most used' : 'Suggested';
        document.getElementById('homeQuick').innerHTML = [...frequent.map(([v, h]) => row(byValue.get(v), `${h.n}×`)), ...suggested.map(v => row(byValue.get(v)))]
            .slice(0, 4).join('');

        document.getElementById('homeCategories').innerHTML = toolGroups().filter(g => g.label)
            .map(g => catCard(g.label, g.options, g.label))
            .concat(catCard('All tools', [...byValue.values()], ''))
            .join('');
    }

    homeEl.addEventListener('click', (e) => {
        const tool = e.target.closest('[data-value]');
        if (tool) return launchTool(tool.dataset.value);
        const browse = e.target.closest('[data-nav-filter]');
        if (browse) openToolsWindow(browse.dataset.navFilter);
    });
    homeSearch.addEventListener('input', () => renderHome());
    homeSearch.addEventListener('keydown', (e) => {
        const first = homeResults.querySelector('[data-value]');
        if (e.key === 'Enter' && homeSearch.value.trim() && first) { e.preventDefault(); launchTool(first.dataset.value); }
        else if (e.key === 'Escape' && homeSearch.value) { e.preventDefault(); renderHome(true); }
    });
    // favorites.js loads and changes favorites; Home redraws when they change while it is shown.
    document.addEventListener('marquis:favoritesChanged', () => {
        if (!homeEl.classList.contains('d-none')) renderHome();
        if (document.getElementById(FAVS)) renderFavoritesSection();
    });

    // --- My Favorites: the pinned tools as launch tiles (same tiles as Home). It used to clone whole
    // sections, which left dead controls and duplicate ids that section scripts then bound to. ---
    const FAVS = 'favoritesSection';
    function renderFavoritesSection() {
        const favs = favoriteOptions();
        document.getElementById('favoritesContainer').innerHTML = favs.map(tile).join('');
        document.getElementById('noFavoritesMessage').classList.toggle('d-none', favs.length > 0);
    }
    document.addEventListener('click', (e) => {
        const tool = e.target.closest(`#${FAVS} [data-value]`);
        if (tool) launchTool(tool.dataset.value);
    });
    document.getElementById('homeBrandLink')?.addEventListener('click', (e) => { e.preventDefault(); launchTool(HOME); });

    // --- Tools window (modal navigation; Home's Browse tiles open it in either mode) ---
    const navModalEl = document.getElementById('navModal');
    const navModalList = document.getElementById('navModalList');
    const navModalSearch = document.getElementById('navModalSearch');
    let navFilterOnOpen = '';

    function openToolsWindow(filter = '') {
        navFilterOnOpen = filter;
        bootstrap.Modal.getOrCreateInstance(navModalEl).show();
    }

    function renderNavModal() {
        const q = navModalSearch.value.trim().toLowerCase();
        const groups = filterGroups(q);
        if (!q) groups.unshift({ label: 'Favorites', options: favoriteOptions(), empty: PIN_HINT });

        const item = (o) => {
            const current = o.value === menuSelector.value;
            return `<button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-2${current ? ' active' : ''}" data-value="${esc(o.value)}"${current ? ' aria-current="true"' : ''}>
                ${iconHtml(o, 26)}<span>${esc(o.text)}</span></button>`;
        };
        navModalList.innerHTML = groups.length ? groups.map(g => `
            ${g.label ? `<h6 class="mq-overline px-1 mb-1">${esc(g.label)}</h6>` : ''}
            ${g.options.length ? `<div class="list-group mb-2">${g.options.map(item).join('')}</div>` : `<p class="small text-muted px-1 mb-2">${g.empty}</p>`}`).join('')
            : '<p class="text-center text-muted fst-italic py-3 mb-0">No tools match your search.</p>';
    }

    function launchFromToolsWindow(value) {
        bootstrap.Modal.getOrCreateInstance(navModalEl).hide();
        launchTool(value);
    }

    navModalEl.addEventListener('show.bs.modal', () => {
        navModalSearch.value = navFilterOnOpen;
        navFilterOnOpen = '';
        renderNavModal();
    });
    navModalEl.addEventListener('shown.bs.modal', () => navModalSearch.focus());
    navModalSearch.addEventListener('input', renderNavModal);
    navModalSearch.addEventListener('keydown', (e) => {
        const first = navModalList.querySelector('[data-value]');
        if (e.key === 'Enter' && first) { e.preventDefault(); launchFromToolsWindow(first.dataset.value); }
    });
    navModalList.addEventListener('click', (e) => {
        const item = e.target.closest('[data-value]');
        if (item) launchFromToolsWindow(item.dataset.value);
    });

    // --- Navigation mode: local.navMode 'inline' (default, also for existing installs) | 'modal' ---
    // Inline: the picker card shows, and the header button shows/hides it. Modal: the card stays hidden
    // and the header button opens the tools window. Settings stays in the header in both modes.
    const menuContainer = document.getElementById('menuContainer');
    const navInlineToggle = document.getElementById('navInlineToggle');
    const navModalBtn = document.getElementById('navModalBtn');
    const navModeRadios = document.querySelectorAll('input[name="navMode"]');

    function setMenuShown(shown) {
        menuContainer.classList.toggle('d-none', !shown);
        navInlineToggle.setAttribute('aria-expanded', String(shown));
        navInlineToggle.title = shown ? 'Hide tool menu' : 'Show tool menu';
        const icon = navInlineToggle.querySelector('i');
        icon.classList.toggle('text-primary', shown);
        icon.classList.toggle('text-secondary', !shown);
    }

    // Inline mode: whether the header button last hid the picker (local.navMenuHidden), kept across opens.
    let menuHidden = localData.navMenuHidden === true;

    function applyNavMode(mode) {
        const modal = mode === 'modal';
        navInlineToggle.classList.toggle('d-none', modal);
        navModalBtn.classList.toggle('d-none', !modal);
        setMenuShown(!modal && !menuHidden);
        navModeRadios.forEach(r => { r.checked = r.value === (modal ? 'modal' : 'inline'); });
    }

    applyNavMode(localData.navMode);
    navInlineToggle.addEventListener('click', () => {
        menuHidden = !menuContainer.classList.contains('d-none');
        setMenuShown(!menuHidden);
        chrome.storage.local.set({ navMenuHidden: menuHidden });
    });
    navModeRadios.forEach(r => r.addEventListener('change', () => {
        if (!r.checked) return;
        menuHidden = false; // choosing a mode in Settings always shows its navigation
        applyNavMode(r.value);
        chrome.storage.local.set({ navMode: r.value, navMenuHidden: false });
    }));
    // Another Marquis window (or a factory reset) changed it.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.navMode) applyNavMode(changes.navMode.newValue);
    });

    // Boot and attach
    console.log("🚀 Initializing script...");
    const requestedSection = sessionData.marquisOpenSection;
    if (requestedSection && menuSelector.querySelector(`option[value="${CSS.escape(requestedSection)}"]`)) {
        menuSelector.value = requestedSection;
        chrome.storage.session.remove('marquisOpenSection');
    }
    toggleMenu();
    menuSelector.addEventListener("change", toggleMenu);

    // Perf baseline: time from popup navigation start to an interactive shell.
    // Read in the popup's DevTools: performance.getEntriesByType('mark') / ('measure').
    performance.mark('marquis:popup-ready');
    console.debug(`[Marquis perf] popup ready at ${Math.round(performance.now())} ms`);

    // Ko-fi is a third-party page: load it when the support modal opens, not on every popup open.
    document.getElementById('kofiModal')?.addEventListener('show.bs.modal', (e) => {
        const frame = e.currentTarget.querySelector('iframe[data-src]');
        if (frame && !frame.getAttribute('src')) frame.src = frame.dataset.src;
    });


    // ==========================================
    // USER PROFILE & AVATAR BINDING
    // ==========================================
    const profilePicMain = document.getElementById('userProfilePic');
    const profilePicModal = document.getElementById('modalUserProfilePic');
    const profileInputModal = document.getElementById('modalProfilePicInput');
    const profileWrapperModal = document.getElementById('modalProfilePicWrapper');

    // Apply profile pic from the batched startup read — no extra storage call
    if (localData.userProfilePic) {
        if (profilePicMain) profilePicMain.src = localData.userProfilePic;
        if (profilePicModal) profilePicModal.src = localData.userProfilePic;
    }

    // Live sync: update immediately if the picture changes in another context
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.userProfilePic) {
            const newPic = changes.userProfilePic.newValue;
            if (newPic) {
                if (profilePicMain) profilePicMain.src = newPic;
                if (profilePicModal) profilePicModal.src = newPic;
            }
        }
    });

    if (profileWrapperModal) {
        profileWrapperModal.addEventListener('click', () => profileInputModal.click());
    }

    if (profileInputModal) {
        profileInputModal.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const maxSize = 120;
                    canvas.width = maxSize;
                    canvas.height = maxSize;

                    let sWidth, sHeight, sx, sy;
                    if (img.width > img.height) {
                        sHeight = img.height; sWidth = img.height;
                        sx = (img.width - img.height) / 2; sy = 0;
                    } else {
                        sWidth = img.width; sHeight = img.width;
                        sx = 0; sy = (img.height - img.width) / 2;
                    }

                    ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, maxSize, maxSize);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                    chrome.storage.local.set({ userProfilePic: dataUrl });
                    if (window.showGlobalAlert) window.showGlobalAlert("Looking Sharp!", "Profile picture updated.", "success");
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }


    // ==========================================
    // ⚙️ SETTINGS HUB & GOOGLE SYNC BINDING
    // ==========================================
    const licenseInput = document.getElementById('syncLicenseInput');
    const unitC = document.getElementById('unitC');
    const unitF = document.getElementById('unitF');
    const btnFactoryReset = document.getElementById('btnFactoryReset');

    // Eye button: show / hide the license code while typing it. Hidden again whenever Settings closes.
    const licenseReveal = document.getElementById('syncLicenseReveal');
    const showLicense = (show) => {
        licenseInput.type = show ? 'text' : 'password';
        licenseReveal.setAttribute('aria-pressed', String(show));
        licenseReveal.title = show ? 'Hide license code' : 'Show license code';
        licenseReveal.setAttribute('aria-label', licenseReveal.title);
        licenseReveal.querySelector('i').className = show ? 'bi bi-eye-slash' : 'bi bi-eye';
    };
    licenseReveal?.addEventListener('click', () => showLicense(licenseInput.type === 'password'));
    document.getElementById('settingsModal')?.addEventListener('hidden.bs.modal', () => licenseReveal && showLicense(false));

    // Apply settings from the batched startup read — no extra storage call
    if (syncData.marquis_license && licenseInput) licenseInput.value = syncData.marquis_license;
    if (syncData.wxUnit === 'F' && unitF) {
        unitF.checked = true;
    } else if (unitC) {
        unitC.checked = true;
    }

    if (licenseInput) {
        licenseInput.addEventListener('change', (e) => {
            if (chrome.storage && chrome.storage.sync) {
                chrome.storage.sync.set({ marquis_license: e.target.value.trim() });
                if (window.showGlobalAlert) window.showGlobalAlert("License Synced", "Key securely saved to Google Account.", "success");
            }
        });
    }

    const updateUnitSetting = (e) => {
        if (e.target.checked && chrome.storage) {
            const unit = e.target.value;
            if (chrome.storage.sync) chrome.storage.sync.set({ wxUnit: unit });
            chrome.storage.local.set({ wxUnit: unit });
            if (window.showGlobalAlert) window.showGlobalAlert("Unit Synced", `Weather preference set to °${unit}`, "success");
        }
    };
    if (unitC) unitC.addEventListener('change', updateUnitSetting);
    if (unitF) unitF.addEventListener('change', updateUnitSetting);

    // Force Sync lives in scripts/command_center.js (it re-runs the license check).

    // 🟢 GHOST THEME SLIDER — apply from batched read
    const alphaSlider = document.getElementById('alpha-slider');
    const alphaDisplay = document.getElementById('alpha-val-display');

    if (localData.themeAlpha && alphaSlider && alphaDisplay) {
        alphaSlider.value = localData.themeAlpha;
        alphaDisplay.innerText = parseFloat(localData.themeAlpha).toFixed(2);
    }

    if (alphaSlider) {
        alphaSlider.addEventListener('input', (e) => {
            if (alphaDisplay) alphaDisplay.innerText = parseFloat(e.target.value).toFixed(2);
        });
        alphaSlider.addEventListener('change', (e) => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ themeAlpha: e.target.value });
            }
        });
    }

    if (btnFactoryReset) {
        // Two-step, like the other destructive actions: the first click arms the button for 5 s.
        // Erases local + sync storage and the screenshot/recording database, but keeps the license key:
        // a reset clears data and settings, not the purchase.
        let armed = null;
        const label = btnFactoryReset.innerHTML;
        btnFactoryReset.addEventListener('click', async () => {
            if (!armed) {
                btnFactoryReset.textContent = 'Click again to erase ALL Marquis data (cannot be undone)';
                armed = setTimeout(() => { armed = null; btnFactoryReset.innerHTML = label; }, 5000);
                return;
            }
            clearTimeout(armed);
            const keep = chrome.storage.sync ? await chrome.storage.sync.get(['marquis_license', 'license_status']) : {};
            await chrome.storage.local.clear();
            if (chrome.storage.sync) {
                await chrome.storage.sync.clear();
                await chrome.storage.sync.set(keep);
            }
            indexedDB.deleteDatabase('marquis-captures'); // screenshots and recordings
            window.showGlobalAlert?.('Reset complete', 'All Marquis data was erased. Your license key was kept. Restarting...', 'success');
            setTimeout(() => window.location.reload(), 1200);
        });
    }


    // ==========================================
    // ☕ KEEP AWAKE MODAL LOGIC (SECURE & DYNAMIC)
    // ==========================================
    const _kaModalEl = document.getElementById('keepAwakeModal');
    const kaModal = _kaModalEl ? new bootstrap.Modal(_kaModalEl) : null;
    const kaIconContainer = document.getElementById('keepAwakeContainer');

    const kaRadios = document.querySelectorAll('input[name="kaMode"]');
    const kaMinutesInput = document.getElementById('kaMinutes');
    const kaActionReset = document.getElementById('kaActionReset');
    const kaActionClose = document.getElementById('kaActionCloseTab');
    const kaTimerBtn = document.getElementById('kaToggleTimerBtn');
    const kaTimerStatus = document.getElementById('kaTimerStatus');
    let kaInterval;

    // Firefox has no power API: the two awake states stay listed but off, with the reason shown under them.
    if (!chrome.power) {
        kaRadios.forEach(r => { r.disabled = r.value !== 'default'; });
        document.getElementById('kaPowerUnsupported')?.classList.remove('d-none');
    }

    function checkKeepAwakeVisibility() {
        if (kaIconContainer) kaIconContainer.classList.remove('d-none');
        syncKaUI();
    }
    checkKeepAwakeVisibility();

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.attUser || changes.attStatus)) {
            checkKeepAwakeVisibility();
        }
    });

    if (kaIconContainer && kaModal) {
        kaIconContainer.addEventListener('click', () => {
            syncKaUI();
            kaModal.show();
        });
    }

    kaRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            chrome.runtime.sendMessage({ action: 'setPowerMode', mode: e.target.value });
            updateIconState(e.target.value);
        });
    });

    if (kaTimerBtn) {
        kaTimerBtn.addEventListener('click', () => {
            const isRunning = kaTimerBtn.classList.contains('btn-danger');
            if (isRunning) {
                chrome.runtime.sendMessage({ action: 'stopPowerTimer' }, syncKaUI);
            } else {
                const mins = parseInt(kaMinutesInput ? kaMinutesInput.value : 0);
                if (!mins || mins <= 0) return;
                const actions = {
                    resetMode: kaActionReset ? kaActionReset.checked : false,
                    closeTab: kaActionClose ? kaActionClose.checked : false
                };
                chrome.runtime.sendMessage({ action: 'startPowerTimer', minutes: mins, actions }, syncKaUI);
            }
        });
    }

    function syncKaUI() {
        chrome.storage.local.get(['kaCurrentMode', 'kaTimer'], (res) => {
            const mode = res.kaCurrentMode || 'default';
            const targetRadio = document.getElementById(`kaMode${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
            if (targetRadio) targetRadio.checked = true;
            updateIconState(mode);

            if (res.kaTimer && res.kaTimer.endTime > Date.now()) {
                startCountdown(res.kaTimer.endTime);
                if (kaTimerBtn) { kaTimerBtn.textContent = 'Stop'; kaTimerBtn.classList.replace('btn-outline-primary', 'btn-danger'); }
                if (kaMinutesInput) kaMinutesInput.disabled = true;
                if (kaTimerStatus) kaTimerStatus.classList.remove('d-none');
            } else {
                clearInterval(kaInterval);
                if (kaTimerBtn) { kaTimerBtn.textContent = 'Start Timer'; kaTimerBtn.classList.replace('btn-danger', 'btn-outline-primary'); }
                if (kaMinutesInput) kaMinutesInput.disabled = false;
                if (kaTimerStatus) kaTimerStatus.classList.add('d-none');
            }
        });
    }

    function updateIconState(mode) {
        const icon = document.getElementById('keepAwakeIcon');
        if (!icon) return;
        if (mode === 'display') {
            icon.className = "bi bi-lightning-charge text-warning transition-icon";
            icon.parentElement.title = "Screen On (Keep Awake)";
        } else if (mode === 'system') {
            icon.className = "bi bi-cpu-fill text-success transition-icon";
            icon.parentElement.title = "System Running (Keep Awake)";
        } else {
            icon.className = "bi bi-cup-hot text-secondary transition-icon";
            icon.parentElement.title = "Default Power Settings";
        }
    }

    function startCountdown(endTime) {
        clearInterval(kaInterval);
        const update = () => {
            const diff = endTime - Date.now();
            if (diff <= 0) { syncKaUI(); return; }
            const date = new Date(diff);
            kaTimerStatus.textContent = date.toISOString().substr(11, 8);
        };
        update();
        kaInterval = setInterval(update, 1000);
    }


    // ==========================================
    // 📶 LIVE NETWORK HEALTH MONITOR
    // ==========================================
    let pingInterval;

    async function checkNetworkHealth() {
        const icon = document.getElementById('networkIcon');
        const pingText = document.getElementById('networkPing');
        const container = document.getElementById('networkMonitorContainer');
        if (!icon || !pingText || !container) return;

        if (!navigator.onLine) {
            updateNetworkUI(0, 'offline', icon, pingText, container);
            return;
        }

        const startTime = performance.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        try {
            await fetch('https://1.1.1.1/cdn-cgi/trace', {
                mode: 'no-cors', cache: 'no-store', signal: controller.signal
            });
            clearTimeout(timeoutId);
            const ping = Math.round(performance.now() - startTime);
            updateNetworkUI(ping, 'online', icon, pingText, container);
        } catch (error) {
            clearTimeout(timeoutId);
            updateNetworkUI(0, 'error', icon, pingText, container);
        }
    }

    function updateNetworkUI(ping, status, icon, pingText, container) {
        if (status === 'offline' || status === 'error') {
            icon.className = "bi bi-wifi-off text-danger transition-icon fs-6";
            pingText.innerText = "OFFLINE";
            pingText.className = "ms-1 fw-bold font-monospace text-danger";
            container.title = "No Internet Connection";
            return;
        }

        pingText.innerText = `${ping}ms`;
        if (ping < 100) {
            icon.className = "bi bi-wifi text-success transition-icon fs-6";
            pingText.className = "ms-1 fw-bold font-monospace text-success";
            container.title = "Excellent Connection";
        } else if (ping < 250) {
            icon.className = "bi bi-wifi-2 text-warning transition-icon fs-6";
            pingText.className = "ms-1 fw-bold font-monospace text-warning";
            container.title = "Fair Connection";
        } else {
            icon.className = "bi bi-wifi-1 text-danger transition-icon fs-6";
            pingText.className = "ms-1 fw-bold font-monospace text-danger";
            container.title = "Poor Connection";
        }
    }

    const mainNetworkContainer = document.getElementById('networkMonitorContainer');
    if (mainNetworkContainer) {
        checkNetworkHealth();
        pingInterval = setInterval(checkNetworkHealth, 5000);

        mainNetworkContainer.addEventListener('click', () => {
            const menuSel = document.getElementById("menuSelector");
            if (menuSel) {
                menuSel.value = "speedTestSection";
                menuSel.dispatchEvent(new Event('change'));
            }
        });
    }


    // ==========================================
    // 🚀 SPEED TEST LAUNCHER
    // Uses event delegation — the buttons live inside a <template> and
    // don't exist in the DOM at startup. querySelectorAll would return [].
    // ==========================================
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.speedtest-launch-btn');
        if (!btn) return;

        const targetUrl = btn.getAttribute('data-url');
        const currentWindow = await chrome.windows.getCurrent();
        const popupWidth = 900;
        const popupHeight = 700;
        const left = Math.round((currentWindow.width - popupWidth) / 2) + currentWindow.left;
        const top = Math.round((currentWindow.height - popupHeight) / 2) + currentWindow.top;

        chrome.windows.create({ url: targetUrl, type: "popup", width: popupWidth, height: popupHeight, left, top });
    });


    // ==========================================
    // 🟢 MODERN GLOBAL ALERT SYSTEM
    // ==========================================
    window.showGlobalAlert = function(title, message, type = 'info') {
        const toastEl = document.getElementById('globalToast');
        if (!toastEl || typeof bootstrap === 'undefined') return;

        const toastTitle = document.getElementById('globalToastTitle');
        const toastMsg = document.getElementById('globalToastMsg');
        const toastIcon = document.getElementById('globalToastIcon');
        const iconContainer = document.getElementById('globalToastIconContainer');
        const progressBar = document.getElementById('globalToastProgressBar');

        if (!toastTitle || !toastMsg || !toastIcon || !iconContainer) return;
        toastTitle.innerText = title;
        toastMsg.innerText = message;

        iconContainer.className = 'd-flex align-items-center justify-content-center rounded-circle flex-shrink-0 me-3 mt-1 ';
        toastIcon.className = 'bi fs-5 ';
        progressBar.className = 'progress-bar ';

        if (type === 'success') {
            iconContainer.classList.add('bg-success', 'bg-opacity-10', 'text-success');
            toastIcon.classList.add('bi-check-circle-fill');
            progressBar.classList.add('bg-success');
        } else if (type === 'error' || type === 'danger') {
            iconContainer.classList.add('bg-danger', 'bg-opacity-10', 'text-danger');
            toastIcon.classList.add('bi-exclamation-triangle-fill');
            progressBar.classList.add('bg-danger');
        } else if (type === 'warning') {
            iconContainer.classList.add('bg-warning', 'bg-opacity-10', 'text-warning-emphasis');
            toastIcon.classList.add('bi-exclamation-circle-fill');
            progressBar.classList.add('bg-warning');
        } else {
            iconContainer.classList.add('bg-primary', 'bg-opacity-10', 'text-primary');
            toastIcon.classList.add('bi-info-circle-fill');
            progressBar.classList.add('bg-primary');
        }

        const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
        toast.show();

        if (progressBar) {
            progressBar.style.transition = 'none';
            progressBar.style.width = '100%';
            setTimeout(() => {
                progressBar.style.transition = 'width 4s linear';
                progressBar.style.width = '0%';
            }, 50);
        }
    };


    // ==========================================
    // 🟢 SMOOTH MODAL TRANSITIONS
    // ==========================================
    const btnOpenLoc = document.getElementById('btnOpenLocationFromSettings');
    const settingsModalEl = document.getElementById('settingsModal');

    if (btnOpenLoc && settingsModalEl && typeof bootstrap !== 'undefined') {
        btnOpenLoc.addEventListener('click', () => {
            settingsModalEl.addEventListener('hidden.bs.modal', function openLoc() {
                settingsModalEl.removeEventListener('hidden.bs.modal', openLoc);
                const locModal = new bootstrap.Modal(document.getElementById('locationModal'));
                locModal.show();
            });
        });
    }
});