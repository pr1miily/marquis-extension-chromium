function initCssInspector() {
    
    // 🟢 SECURITY GATEKEEPER
    const isRestrictedUrl = (url) => {
        if (!url) return true;
        const prefixes = ['chrome://', 'edge://', 'about:', 'chrome-extension://'];
        const domains = ['chrome.google.com/webstore', 'chromewebstore.google.com'];
        return prefixes.some(p => url.startsWith(p)) || domains.some(d => url.includes(d));
    };

    // --- 1. LIVE CSS INSPECTOR (INJECTED INTO PAGE) ---
	const btnToggleCssInspector = document.getElementById('btnToggleCssInspector');
    const cssInspectorBtnText = document.getElementById('cssInspectorBtnText');
    const cssInspectorSubText = document.getElementById('cssInspectorSubText');
    const cssInspectorIcon = document.getElementById('cssInspectorIcon');
    let isInspectorActive = false;

    if (btnToggleCssInspector) {
        btnToggleCssInspector.addEventListener('click', async function() {
            // 🟢 PRE-FLIGHT SECURITY CHECK
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (isRestrictedUrl(tab.url)) {
                window.showGlobalAlert("Domain Secured", "The Marquis cannot inspect Chrome system pages. Their defenses are quite absolute.", "error");
                return;
            }

            isInspectorActive = !isInspectorActive;
            
            // Apply bounce effect
            btnToggleCssInspector.style.transform = 'scale(0.97)';
            setTimeout(() => { btnToggleCssInspector.style.transform = 'scale(1)'; }, 150);
            
            if (isInspectorActive) {
                // STOP MODE (Red/Orange Gradient)
                btnToggleCssInspector.style.background = 'linear-gradient(135deg, #ef4444, #f97316)';
                cssInspectorBtnText.innerText = "Stop Inspector";
                cssInspectorSubText.innerText = "Click to turn off hover mode";
                cssInspectorIcon.className = "bi bi-stop-circle-fill fs-5 text-white";
                window.showGlobalAlert("Inspector Awakened", "I am watching. Pray, hover over the elements you wish to unveil.", "info");
            } else {
                // START MODE (Purple/Pink Gradient)
                btnToggleCssInspector.style.background = 'linear-gradient(135deg, #6366f1, #a855f7)';
                cssInspectorBtnText.innerText = "Start Live Inspector";
                cssInspectorSubText.innerText = "Hover to extract element styles";
                cssInspectorIcon.className = "bi bi-magic fs-5 text-white";
            }

            chrome.scripting.executeScript({
                target: {tabId: tab.id},
                func: togglePageInspector,
                args: [isInspectorActive]
            });
        });
    }

    // This function runs INSIDE the target webpage
    function togglePageInspector(turnOn) {
        if (!turnOn) {
            document.removeEventListener('mouseover', window.__odh_inspectHover, true);
            document.removeEventListener('mouseout', window.__odh_inspectOut, true);
            document.removeEventListener('click', window.__odh_inspectClick, true);
            if (window.__odh_inspectTooltip) window.__odh_inspectTooltip.remove();
            if (window.__odh_hoveredEl) window.__odh_hoveredEl.style.outline = window.__odh_origOutline;
            return;
        }

        const t = document.createElement('div');
        t.id = 'odh-css-tooltip';
        t.style.cssText = `
            position: fixed; z-index: 9999999; background: #212529; color: #f8f9fa;
            font-family: monospace; font-size: 12px; padding: 12px; border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4); pointer-events: none;
            max-width: 280px; display: none; border: 1px solid #495057;
        `;
        document.body.appendChild(t);
        window.__odh_inspectTooltip = t;

        function rgb2hex(rgb) {
            let res = rgb.match(/\d+/g);
            if (!res || res.length < 3) return rgb;
            return "#" + res.slice(0,3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
        }

        window.__odh_inspectHover = function(e) {
            e.preventDefault(); e.stopPropagation();
            const el = e.target;
            if (el.id === 'odh-css-tooltip') return;

            window.__odh_origOutline = el.style.outline;
            el.style.outline = '2px dashed #0d6efd';
            window.__odh_hoveredEl = el;

            const comp = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            
            const fontStack = comp.fontFamily.split(',')[0].replace(/['"]/g, '');
            const hexColor = rgb2hex(comp.color);
            const hexBg = rgb2hex(comp.backgroundColor);

            t.innerHTML = `
                <div style="font-weight:bold; color:#0d6efd; margin-bottom:8px; font-size:14px; border-bottom: 1px solid #495057; padding-bottom:4px;">
                    ${el.tagName.toLowerCase()}${el.className ? '.' + el.className.split(' ').join('.') : ''}
                </div>
                <div style="display:grid; grid-template-columns: 60px 1fr; gap: 4px; line-height: 1.4;">
                    <span style="color:#adb5bd;">Size</span> <span style="font-weight:bold;">${rect.width.toFixed(1)} x ${rect.height.toFixed(1)}</span>
                    <span style="color:#adb5bd;">Font</span> <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${fontStack}">${fontStack}</span>
                    <span style="color:#adb5bd;">Text</span> <span>${comp.fontSize} / ${comp.fontWeight}</span>
                    <span style="color:#adb5bd;">Color</span> <div style="display:flex;align-items:center;"><div style="width:12px;height:12px;background:${comp.color};border:1px solid #666;margin-right:6px;border-radius:2px;"></div> ${hexColor}</div>
                    <span style="color:#adb5bd;">Bg</span> <div style="display:flex;align-items:center;"><div style="width:12px;height:12px;background:${comp.backgroundColor};border:1px solid #666;margin-right:6px;border-radius:2px;"></div> ${hexBg}</div>
                </div>
                <div style="margin-top:8px; font-size:10px; color:#ffc107; text-align:center; opacity: 0.8;">Click element to copy CSS to clipboard</div>
            `;
            t.style.display = 'block';

            let top = e.clientY + 15; let left = e.clientX + 15;
            if (top + t.offsetHeight > window.innerHeight) top = window.innerHeight - t.offsetHeight - 10;
            if (left + t.offsetWidth > window.innerWidth) left = window.innerWidth - t.offsetWidth - 10;
            t.style.top = top + 'px'; t.style.left = left + 'px';
        };

        window.__odh_inspectOut = function(e) {
            if (window.__odh_hoveredEl) window.__odh_hoveredEl.style.outline = window.__odh_origOutline;
            t.style.display = 'none';
        };

        window.__odh_inspectClick = function(e) {
            e.preventDefault(); e.stopPropagation();
            if(!window.__odh_hoveredEl) return;
            const comp = window.getComputedStyle(window.__odh_hoveredEl);
            let cssText = `font-family: ${comp.fontFamily};\nfont-size: ${comp.fontSize};\nfont-weight: ${comp.fontWeight};\ncolor: ${rgb2hex(comp.color)};\nbackground-color: ${rgb2hex(comp.backgroundColor)};\n`;
            navigator.clipboard.writeText(cssText);
            
            const originalBg = t.style.background;
            t.style.background = '#198754'; // Flash green
            setTimeout(() => { t.style.background = originalBg; }, 300);
        };

        document.addEventListener('mouseover', window.__odh_inspectHover, true);
        document.addEventListener('mouseout', window.__odh_inspectOut, true);
        document.addEventListener('click', window.__odh_inspectClick, true);
    }


    // --- 2. EXTRACT PAGE COLORS ---
    const btnExtractColors = document.getElementById('btnExtractColors');
    const cssColorPalette = document.getElementById('cssColorPalette');

    if (btnExtractColors) {
        btnExtractColors.addEventListener('click', async function() {
            // 🟢 PRE-FLIGHT SECURITY CHECK
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (isRestrictedUrl(tab.url)) {
                window.showGlobalAlert("Domain Secured", "I am forbidden from extracting colors from these restricted system pages.", "error");
                return;
            }

            const originalContent = this.innerHTML;
            this.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
            
            chrome.scripting.executeScript({
                target: {tabId: tab.id},
                func: extractColorsFromPage
            }, (results) => {
                btnExtractColors.innerHTML = originalContent;
                if (results && results[0] && results[0].result) {
                    const colors = results[0].result;
                    cssColorPalette.innerHTML = '';
                    
                    if(colors.length === 0) {
                        cssColorPalette.innerHTML = '<div class="text-muted small w-100 text-center">No colors found.</div>';
                        window.showGlobalAlert("Barren Canvas", "Alas, I found no colors of note upon this page.", "info");
                        return;
                    }

                    window.showGlobalAlert("Colors Harvested", `I have procured ${colors.length} unique hues for your perusal.`, "success");

                    colors.forEach(hex => {
                        const block = document.createElement('div');
                        block.className = 'd-flex flex-column align-items-center group-hover';
                        block.style.cursor = 'pointer';
                        block.title = "Click to copy";
                        block.innerHTML = `
                            <div class="rounded-circle border shadow-sm mb-1" style="width: 40px; height: 40px; background-color: ${hex};"></div>
                            <span class="font-monospace text-muted" style="font-size: var(--mq-fs-xs);">${hex.toUpperCase()}</span>
                        `;
                        block.addEventListener('click', () => {
                            navigator.clipboard.writeText(hex);
                            block.querySelector('span').innerText = "COPIED!";
                            block.querySelector('span').classList.replace('text-muted', 'text-success');
                            setTimeout(() => {
                                block.querySelector('span').innerText = hex.toUpperCase();
                                block.querySelector('span').classList.replace('text-success', 'text-muted');
                            }, 1000);
                        });
                        cssColorPalette.appendChild(block);
                    });
                }
            });
        });
    }

    // Function injected to scrape colors
    function extractColorsFromPage() {
        const els = document.querySelectorAll('*');
        const colors = new Set();
        els.forEach(el => {
            const comp = window.getComputedStyle(el);
            if (comp.color && comp.color !== 'rgba(0, 0, 0, 0)' && comp.color !== 'transparent') colors.add(comp.color);
            if (comp.backgroundColor && comp.backgroundColor !== 'rgba(0, 0, 0, 0)' && comp.backgroundColor !== 'transparent') colors.add(comp.backgroundColor);
        });
        
        function r2h(rgb) {
            let res = rgb.match(/\d+/g);
            if (!res || res.length < 3) return rgb;
            return "#" + res.slice(0,3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
        }
        
        return Array.from(colors).map(c => r2h(c)).filter(c => c.startsWith('#'));
    }


    // --- 3. EXTRACT ASSETS (IMAGES & BACKGROUNDS) ---
    const btnExtractAssets = document.getElementById('btnExtractAssets');
    const cssAssetsGallery = document.getElementById('cssAssetsGallery');

    if (btnExtractAssets) {
        btnExtractAssets.addEventListener('click', async function() {
            // 🟢 PRE-FLIGHT SECURITY CHECK
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (isRestrictedUrl(tab.url)) {
                window.showGlobalAlert("Domain Secured", "System pages guard their assets jealously. I cannot extract them.", "error");
                return;
            }

            const originalContent = this.innerHTML;
            this.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
            
            chrome.scripting.executeScript({
                target: {tabId: tab.id},
                func: extractAssetsFromPage
            }, (results) => {
                btnExtractAssets.innerHTML = originalContent;
                if (results && results[0] && results[0].result) {
                    const assets = results[0].result;
                    cssAssetsGallery.innerHTML = '';
                    
                    if(assets.length === 0) {
                        cssAssetsGallery.innerHTML = '<div class="text-muted small w-100 text-center col-12">No assets found.</div>';
                        window.showGlobalAlert("Barren Canvas", "I scoured the page, yet found no image assets to present to you.", "info");
                        return;
                    }

                    window.showGlobalAlert("Assets Procured", `Splendid! I have extracted ${assets.length} image assets for your collection.`, "success");

                    assets.forEach(url => {
                        // URLs come from the scanned page: only http(s), and set via DOM properties
                        // (never interpolated into innerHTML) so a crafted URL can't inject markup.
                        if (!/^https?:\/\//i.test(url)) return;
                        const col = document.createElement('div');
                        col.className = 'col-4';
                        col.innerHTML = `
                            <div class="card border border-secondary-subtle bg-body-tertiary h-100 position-relative group-hover">
                                <div class="p-2 d-flex align-items-center justify-content-center bg-checker" style="height: 80px;">
                                    <img class="img-fluid" alt="" style="max-height: 100%; object-fit: contain;">
                                </div>
                                <div class="card-footer p-1 text-center bg-body border-top">
                                    <a target="_blank" rel="noopener noreferrer" class="btn btn-link text-decoration-none text-primary p-0" style="font-size: var(--mq-fs-xs);" title="Open in new tab">
                                        <i class="bi bi-box-arrow-up-right"></i> Open
                                    </a>
                                </div>
                            </div>
                        `;
                        col.querySelector('img').src = url;
                        col.querySelector('a').href = url;
                        cssAssetsGallery.appendChild(col);
                    });
                }
            });
        });
    }

    // Function injected to scrape image assets
    function extractAssetsFromPage() {
        const assets = new Set();
        // 1. Get standard img tags
        document.querySelectorAll('img').forEach(img => {
            if(img.src && !img.src.startsWith('data:')) assets.add(img.src);
        });
        // 2. Get CSS background-images
        document.querySelectorAll('*').forEach(el => {
            const bg = window.getComputedStyle(el).backgroundImage;
            if(bg && bg !== 'none' && bg.includes('url(')) {
                let url = bg.slice(4, -1).replace(/["']/g, "");
                if(!url.startsWith('data:')) assets.add(url);
            }
        });
        return Array.from(assets);
    }

	// --- 4. X-RAY LAYOUT OUTLINES (PESTICIDE CLONE) ---
    const toggleCssLayouts = document.getElementById('toggleCssLayouts');
    
    if (toggleCssLayouts) {
        toggleCssLayouts.addEventListener('change', async function() {
            const isChecked = this.checked;
            
            // 🟢 PRE-FLIGHT SECURITY CHECK
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (isRestrictedUrl(tab.url)) {
                this.checked = !isChecked; // Revert the toggle switch back
                window.showGlobalAlert("Domain Secured", "My X-Ray vision cannot pierce the veil of Chrome's system pages.", "error");
                return;
            }

            chrome.scripting.executeScript({
                target: {tabId: tab.id},
                func: applyLayoutXray,
                args: [isChecked]
            });
        });
    }

    // Function injected into the active webpage
    function applyLayoutXray(turnOn) {
        const styleId = 'odh-xray-styles';
        let styleEl = document.getElementById(styleId);
        
        if (turnOn) {
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = styleId;
                // Applies specific colored outlines based on the element type
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
            // Remove the styles if toggled off
            if (styleEl) styleEl.remove();
        }
    }
	
	// --- 5. CSS CONSISTENCY AUDIT ---
    const btnRunCssAudit = document.getElementById('btnRunCssAudit');
    const btnClearCssAudit = document.getElementById('btnClearCssAudit');
    const cssAuditResults = document.getElementById('cssAuditResults');

    if (btnRunCssAudit) {
        btnRunCssAudit.addEventListener('click', async function() {
            // 🟢 PRE-FLIGHT SECURITY CHECK
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (isRestrictedUrl(tab.url)) {
                window.showGlobalAlert("Domain Secured", "An audit of this system page is, unfortunately, beyond my permitted jurisdiction.", "error");
                return;
            }

            const originalContent = this.innerHTML;
            this.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Scanning...';
            this.disabled = true;

            chrome.scripting.executeScript({
                target: {tabId: tab.id},
                func: runConsistencyAudit
            }, (results) => {
                btnRunCssAudit.innerHTML = originalContent;
                btnRunCssAudit.disabled = false;
                
                if (results && results[0] && results[0].result) {
                    renderAuditResults(results[0].result);
                    btnClearCssAudit.classList.remove('d-none');
                    window.showGlobalAlert("Audit Concluded", "My meticulous inspection of the page's CSS consistency is now complete.", "success");
                }
            });
        });
    }

    // Listener for the "Clear Highlights" button
    if (btnClearCssAudit) {
        btnClearCssAudit.addEventListener('click', async function() {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (isRestrictedUrl(tab.url)) return;

            chrome.scripting.executeScript({
                target: {tabId: tab.id},
                func: clearAuditHighlights
            });
        });
    }

    // Listener for clicks on the generated "Locate" buttons
    if (cssAuditResults) {
        cssAuditResults.addEventListener('click', async function(e) {
            const locateBtn = e.target.closest('.locate-audit-btn');
            if (!locateBtn) return;
            
            // 🟢 PRE-FLIGHT SECURITY CHECK
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (isRestrictedUrl(tab.url)) {
                window.showGlobalAlert("Domain Secured", "I must refrain from interacting with elements on such restricted grounds.", "error");
                return;
            }

            const tag = locateBtn.getAttribute('data-tag');
            const signature = locateBtn.getAttribute('data-signature');

            // Send script to highlight elements on the page
            chrome.scripting.executeScript({
                target: {tabId: tab.id},
                func: highlightAuditElements,
                args: [tag, signature]
            });
        });
    }

    // --- INJECTED FUNCTIONS ---

	function runConsistencyAudit() {
        // Expanded list optimized for Typography & Consistency
        const tagsToAudit = [
            'H1','H2','H3','H4','H5','H6','P','BLOCKQUOTE','LI',
            'A','BUTTON',
            'INPUT','TEXTAREA','SELECT','LABEL',
            'TH','TD'
        ];
        const auditData = {};

        function r2h(rgb) {
            let res = rgb.match(/\d+/g);
            if (!res || res.length < 3) return rgb;
            return "#" + res.slice(0,3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
        }

        tagsToAudit.forEach(tag => {
            const elements = document.querySelectorAll(tag);
            if (elements.length === 0) return;

            auditData[tag] = { total: elements.length, variations: {} };

            elements.forEach(el => {
                if(el.offsetParent === null) return; // Ignore hidden elements

                const comp = window.getComputedStyle(el);
                const signature = `${comp.fontSize} | ${comp.fontWeight} | ${r2h(comp.color)} | ${comp.fontFamily.split(',')[0].replace(/['"]/g, '')}`;
                
                if (!auditData[tag].variations[signature]) {
                    auditData[tag].variations[signature] = 0;
                }
                auditData[tag].variations[signature]++;
            });
            
            // Clean up tags that ended up having 0 visible elements
            if(Object.keys(auditData[tag].variations).length === 0) {
                delete auditData[tag];
            }
        });

        return auditData;
    }

    function highlightAuditElements(tag, signatureToMatch) {
        // 1. Inject styling for the highlight effect
        if (!document.getElementById('odh-audit-styles')) {
            const style = document.createElement('style');
            style.id = 'odh-audit-styles';
            style.textContent = `
                .odh-audit-highlight {
                    outline: 4px solid #e83e8c !important;
                    outline-offset: 4px !important;
                    box-shadow: 0 0 15px rgba(232, 62, 140, 0.8) !important;
                    transition: all 0.3s ease-in-out !important;
                    position: relative !important;
                    z-index: 999999 !important;
                }
            `;
            document.head.appendChild(style);
        }

        // 2. Clear any old highlights
        document.querySelectorAll('.odh-audit-highlight').forEach(el => el.classList.remove('odh-audit-highlight'));

        function r2h(rgb) {
            let res = rgb.match(/\d+/g);
            if (!res || res.length < 3) return rgb;
            return "#" + res.slice(0,3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
        }

        // 3. Find elements matching the signature and highlight them
        let firstMatch = null;
        document.querySelectorAll(tag).forEach(el => {
            if(el.offsetParent === null) return; 
            const comp = window.getComputedStyle(el);
            const signature = `${comp.fontSize} | ${comp.fontWeight} | ${r2h(comp.color)} | ${comp.fontFamily.split(',')[0].replace(/['"]/g, '')}`;
            
            if (signature === signatureToMatch) {
                el.classList.add('odh-audit-highlight');
                if (!firstMatch) firstMatch = el;
            }
        });

        // 4. Smooth scroll the first offending element into view
        if (firstMatch) {
            firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function clearAuditHighlights() {
        document.querySelectorAll('.odh-audit-highlight').forEach(el => el.classList.remove('odh-audit-highlight'));
        const styleEl = document.getElementById('odh-audit-styles');
        if (styleEl) styleEl.remove();
    }

    // Function to render the results inside the extension
    function renderAuditResults(data) {
        cssAuditResults.innerHTML = '';
        
        if (Object.keys(data).length === 0) {
            cssAuditResults.innerHTML = '<div class="text-center text-muted small py-3">No auditable elements found.</div>';
            return;
        }

        let html = '';
        let index = 0;

        for (const [tag, info] of Object.entries(data)) {
            const varCount = Object.keys(info.variations).length;
            const badgeClass = varCount > 1 ? 'bg-danger' : 'bg-success';
            const badgeText = varCount > 1 ? `${varCount} Variations` : `Consistent`;

            html += `
                <div class="accordion-item border border-secondary-subtle bg-body mb-1 rounded">
                    <h2 class="accordion-header">
                        <button class="accordion-button collapsed py-2 px-3 shadow-none bg-body-tertiary" type="button" data-bs-toggle="collapse" data-bs-target="#audit-${index}">
                            <div class="d-flex justify-content-between align-items-center w-100 pe-3">
                                <span class="fw-bold small text-body">${MarquisHtml.esc(tag)} <span class="text-muted fw-normal ms-1">(${info.total} items)</span></span>
                                <span class="badge ${badgeClass}" style="font-size:var(--mq-fs-xs);">${badgeText}</span>
                            </div>
                        </button>
                    </h2>
                    <div id="audit-${index}" class="accordion-collapse collapse">
                        <div class="accordion-body p-0">
                            <ul class="list-group list-group-flush small">
            `;

            const sortedVariations = Object.entries(info.variations).sort((a, b) => b[1] - a[1]);

            sortedVariations.forEach(([signature, count], i) => {
                const parts = signature.split(' | ');
                const isDominant = i === 0 && count > 1; 
                
                html += `
                    <li class="list-group-item bg-body d-flex justify-content-between align-items-center p-2 border-bottom border-secondary-subtle">
                        <div style="line-height: 1.2;">
                            <div class="d-flex align-items-center gap-2 mb-1">
                                <div style="width:10px; height:10px; border-radius:50%; background-color:${MarquisHtml.esc(parts[2])}; border: 1px solid #666;"></div>
                                <span class="fw-bold" style="font-size:var(--mq-fs-xs);">${MarquisHtml.esc(parts[0])} - ${MarquisHtml.esc(parts[1])}</span>
                            </div>
                            <small class="text-muted d-block font-monospace text-truncate" style="font-size:var(--mq-fs-xs); max-width: 140px;" title="${MarquisHtml.esc(parts[3])}">${MarquisHtml.esc(parts[3])}</small>
                        </div>
                        <div class="text-end d-flex flex-column align-items-end">
                            <div class="d-flex align-items-center gap-2">
                                <span class="badge bg-secondary rounded-pill px-2 py-1">${count}</span>
                                <button class="btn btn-sm btn-outline-primary py-0 px-2 locate-audit-btn" style="font-size: var(--mq-fs-xs);" data-tag="${MarquisHtml.esc(tag)}" data-signature="${MarquisHtml.esc(signature)}" title="Highlight on page">
                                    <i class="bi bi-crosshair"></i> Locate
                                </button>
                            </div>
                            ${isDominant ? '<small class="d-block text-success mt-1" style="font-size:var(--mq-fs-xs); font-weight:bold;">Primary</small>' : '<small class="d-block text-danger mt-1" style="font-size:var(--mq-fs-xs); font-weight:bold;">Anomaly</small>'}
                        </div>
                    </li>
                `;
            });

            html += `
                            </ul>
                        </div>
                    </div>
                </div>
            `;
            index++;
        }

        cssAuditResults.innerHTML = html;
    }
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'cssInspectorSection') initCssInspector();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('btnToggleCssInspector')) initCssInspector();
});