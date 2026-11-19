function initQaDev() {
    
    // 🟢 SECURITY GATEKEEPER
    const isRestrictedUrl = (url) => {
        if (!url) return true;
        const prefixes = ['chrome://', 'edge://', 'about:', 'chrome-extension://'];
        const domains = ['chrome.google.com/webstore', 'chromewebstore.google.com'];
        return prefixes.some(p => url.startsWith(p)) || domains.some(d => url.includes(d));
    };

	// --- CORE LOGIC: OPEN DEVICE SIMULATOR ---
    function openResizedWindow(w, h, urlOverride = null, deviceType = 'phone', notchType = 'notch-dynamic', osType = 'ios') {
        const urlInput = document.getElementById('resizerTargetUrl'); // ✅ FIX
        const customUrl = urlOverride || (urlInput ? urlInput.value.trim() : '');

        // 1. Launch the built-in simulator instead of a native OS window
        function launch(targetUrl) {
            if (isRestrictedUrl(targetUrl)) {
                window.showGlobalAlert("Domain Secured", "I am strictly forbidden from running the emulator upon Chrome system pages.", "error");
                return;
            }

            let finalUrl = targetUrl;
            if (finalUrl && !finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
                finalUrl = 'https://' + finalUrl;
            }
            
            const simUrl = chrome.runtime.getURL(`simulator.html?url=${encodeURIComponent(finalUrl)}&w=${w}&h=${h}&type=${deviceType}&notch=${notchType}&os=${osType}`);
            chrome.tabs.create({ url: simUrl, active: true });
        }

        // 2. Fetch URL from input or current active tab
        if (customUrl) {
            launch(customUrl);
        } else {
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                if (tabs && tabs[0]) launch(tabs[0].url);
            });
        }
    }

    // --- TAB 1: DEVICE MATRIX & RESPONSIVE ---

	document.querySelectorAll('.resizer-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const w = this.getAttribute('data-w');
            const h = this.getAttribute('data-h');
            const type = this.getAttribute('data-type') || 'phone';
            const notch = this.getAttribute('data-notch') || 'notch-dynamic'; 
            const os = this.getAttribute('data-os') || 'ios'; 
            
            if(document.getElementById('resizerCustomW')) document.getElementById('resizerCustomW').value = w;
            if(document.getElementById('resizerCustomH')) document.getElementById('resizerCustomH').value = h;
            
            openResizedWindow(w, h, null, type, notch, os); 
        });
    });

	const customBtn = document.getElementById('resizerCustomBtn');
    if (customBtn) {
        customBtn.addEventListener('click', function() {
            const w = document.getElementById('resizerCustomW').value || 1024;
            const h = document.getElementById('resizerCustomH').value || 768;
            openResizedWindow(w, h, null, w > 900 ? 'desktop' : 'tablet'); 
        });
    }

    const rotateBtn = document.getElementById('resizerRotateBtn');
    if (rotateBtn) {
        rotateBtn.addEventListener('click', function() {
            const wInput = document.getElementById('resizerCustomW');
            const hInput = document.getElementById('resizerCustomH');
            if (!wInput || !hInput) return; // ✅ FIX
            const tempW = wInput.value;
            wInput.value = hInput.value;
            hInput.value = tempW;
            
            const originalContent = this.innerHTML;
            this.innerHTML = '<i class="bi bi-check2"></i> Swapped!';
            setTimeout(() => { this.innerHTML = originalContent; }, 1000);
        });
    }

    const clearUrlBtn = document.getElementById('resizerClearUrlBtn');
    if (clearUrlBtn) {
        clearUrlBtn.addEventListener('click', function() {
            document.getElementById('resizerTargetUrl').value = '';
        });
    }

    // Matrix Parallel Execution
	const qaLaunchMatrixBtn = document.getElementById('qaLaunchMatrixBtn');
    if (qaLaunchMatrixBtn) {
        qaLaunchMatrixBtn.addEventListener('click', function() {
            const matrixSizes = [
                {w: 390, h: 844, type: 'phone'}, 
                {w: 820, h: 1180, type: 'tablet'}, 
                {w: 1440, h: 900, type: 'desktop'}  
            ];
            
            const originalContent = this.innerHTML;
            this.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Running...';
            this.disabled = true;
            
            let delay = 0;
            matrixSizes.forEach(size => {
                setTimeout(() => {
                    openResizedWindow(size.w, size.h, null, size.type); 
                }, delay);
                delay += 500; 
            });
            
            setTimeout(() => {
                this.innerHTML = originalContent;
                this.disabled = false;
            }, delay + 500);
        });
    }
	
    // --- TAB 2: TEST SUITES (LOCAL SCENARIOS) ---
        
    const qaScenariosList = document.getElementById('qaScenariosList');
        
    function loadScenarios() {
        // 🟢 UPDATED: Load from chrome.storage.local safely
        chrome.storage.local.get(['marq_test_scenarios'], (res) => {
            const scenarios = res.marq_test_scenarios || [];
            if (scenarios.length === 0) {
                qaScenariosList.innerHTML = '<li class="list-group-item text-center text-muted fst-italic">No scenarios saved yet.</li>';
                return;
            }
            
            qaScenariosList.innerHTML = '';
            scenarios.forEach((s, index) => {
                const li = document.createElement('li');
                li.className = 'list-group-item d-flex justify-content-between align-items-center bg-body';
                li.innerHTML = `
                    <div class="text-truncate me-2">
                        <span class="fw-bold d-block text-body">${MarquisHtml.esc(s.name)}</span>
                        <small class="text-muted" style="font-size: var(--mq-fs-xs);">${MarquisHtml.esc(s.url || 'Active Tab')} (${MarquisHtml.esc(s.w)}x${MarquisHtml.esc(s.h)})</small>
                    </div>
                    <div class="btn-group flex-shrink-0">
                        <button type="button" class="btn btn-sm btn-outline-primary run-scenario-btn" data-index="${index}" aria-label="Run scenario ${MarquisHtml.esc(s.name)}" title="Run"><i class="bi bi-play-fill" aria-hidden="true"></i></button>
                        <button type="button" class="btn btn-sm btn-outline-danger del-scenario-btn" data-index="${index}" aria-label="Delete scenario ${MarquisHtml.esc(s.name)}" title="Delete"><i class="bi bi-trash" aria-hidden="true"></i></button>
                    </div>
                `;
                qaScenariosList.appendChild(li);
            });

            document.querySelectorAll('.run-scenario-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const s = scenarios[this.getAttribute('data-index')];
                    openResizedWindow(s.w, s.h, s.url);
                });
            });

            document.querySelectorAll('.del-scenario-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const indexToRemove = this.getAttribute('data-index');
                    scenarios.splice(indexToRemove, 1);
                    // 🟢 UPDATED: Save back to chrome.storage
                    chrome.storage.local.set({ marq_test_scenarios: scenarios }, () => {
                        loadScenarios();
                    });
                });
            });
        });
    }

    const qaSaveScenarioBtn = document.getElementById('qaSaveScenarioBtn');
    if(qaSaveScenarioBtn) {
        qaSaveScenarioBtn.addEventListener('click', () => {
            const name = document.getElementById('qaScenarioName').value.trim();
            const url = document.getElementById('resizerTargetUrl').value.trim();
            const deviceRaw = document.getElementById('qaScenarioDevice').value;
            
            if(!name) { window.showGlobalAlert("Name Required", "Pray, bestow a proper name upon this scenario before saving.", "warning"); return; }
            
            const [w, h] = deviceRaw.split(',');
            
            // 🟢 UPDATED: Fetch, push, and save
            chrome.storage.local.get(['marq_test_scenarios'], (res) => {
                const scenarios = res.marq_test_scenarios || [];
                scenarios.push({ name, url, w, h });
                
                chrome.storage.local.set({ marq_test_scenarios: scenarios }, () => {
                    document.getElementById('qaScenarioName').value = '';
                    loadScenarios();
                    window.showGlobalAlert("Saved", "Test scenario saved successfully.", "success");
                });
            });
        });
    }

    const qaRunSuiteBtn = document.getElementById('qaRunSuiteBtn');
    if(qaRunSuiteBtn) {
        qaRunSuiteBtn.addEventListener('click', () => {
            // 🟢 UPDATED: Fetch, then run loop
            chrome.storage.local.get(['marq_test_scenarios'], (res) => {
                const scenarios = res.marq_test_scenarios || [];
                if(scenarios.length === 0) return;
                
                let delay = 0;
                scenarios.forEach(s => {
                    setTimeout(() => { openResizedWindow(s.w, s.h, s.url); }, delay);
                    delay += 500;
                });
            });
        });
    }

    if(qaScenariosList) loadScenarios();

    // --- TAB 3: VISUAL UI TESTING ---

    // 1. Ghost Overlay (Pixel Perfect)
    const qaOverlayUpload = document.getElementById('qaOverlayUpload');
    const qaOverlayControls = document.getElementById('qaOverlayControls');
    const qaOverlayOpacity = document.getElementById('qaOverlayOpacity');
    const qaOverlayOpVal = document.getElementById('qaOverlayOpVal');
    const qaInjectOverlayBtn = document.getElementById('qaInjectOverlayBtn');
    
    let overlayDataUrl = null;

    if (qaOverlayUpload) {
        qaOverlayUpload.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(event) {
                    overlayDataUrl = event.target.result;
                    qaOverlayControls.classList.remove('d-none');
                };
                reader.readAsDataURL(file);
            }
        });

        qaOverlayOpacity?.addEventListener('input', function() {
            if (qaOverlayOpVal) qaOverlayOpVal.innerText = this.value + '%';
        });

        qaInjectOverlayBtn.addEventListener('click', function() {
            if (!overlayDataUrl) return;
            const opacity = qaOverlayOpacity.value / 100;
            
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                if (isRestrictedUrl(tabs[0].url)) {
                    window.showGlobalAlert("Domain Secured", "These restricted pages reject my overlays. I can do nothing here.", "error");
                    return;
                }

                chrome.scripting.executeScript({
                    target: {tabId: tabs[0].id},
                    func: injectGhostImage,
                    args: [overlayDataUrl, opacity]
                });
                window.showGlobalAlert("Overlay Injected", "Check your active tab.", "success");
            });
        });

        document.getElementById('qaClearOverlayBtn').addEventListener('click', function() {
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                if (isRestrictedUrl(tabs[0].url)) return;

                chrome.scripting.executeScript({
                    target: {tabId: tabs[0].id},
                    func: () => {
                        const existing = document.getElementById('marq-ghost-overlay');
                        if (existing) existing.remove();
                    }
                });
            });
            qaOverlayUpload.value = '';
            overlayDataUrl = null;
            qaOverlayControls.classList.add('d-none');
        });
    }

    function injectGhostImage(dataUrl, opacity) {
        let overlay = document.getElementById('marq-ghost-overlay');
        if (!overlay) {
            overlay = document.createElement('img');
            overlay.id = 'marq-ghost-overlay';
            overlay.style.position = 'absolute';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100%';
            overlay.style.zIndex = '999999';
            overlay.style.pointerEvents = 'none'; 
            document.body.appendChild(overlay);
        }
        overlay.src = dataUrl;
        overlay.style.opacity = opacity;
    }

	// 2. Visual Diff Analyzer & Baseline Management (Merged)
    const qaBaselineSelect = document.getElementById('qaBaselineSelect');
    const qaManageBaselinesBtn = document.getElementById('qaManageBaselinesBtn');
    const qaSaveNewBaselineBtn = document.getElementById('qaSaveNewBaselineBtn');
    const qaBaselineUpload = document.getElementById('qaBaselineUpload');
    
    const qaBaselinePreview = document.getElementById('qaBaselinePreview');
    const qaBaselineEmptyText = document.getElementById('qaBaselineEmptyText');
    const qaCaptureCurrentBtn = document.getElementById('qaCaptureCurrentBtn');
    const qaCurrentPreview = document.getElementById('qaCurrentPreview');
    
    const qaRunDiffBtn = document.getElementById('qaRunDiffBtn');
    const qaDiffResultContainer = document.getElementById('qaDiffResultContainer');
    const qaDiffCanvas = document.getElementById('qaDiffCanvas');
    const qaDiffScore = document.getElementById('qaDiffScore');

    let baselineImg = new Image();
    let currentImg = new Image();
    let baselineLoaded = false;
    let currentLoaded = false;
    let savedBaselines = [];

    // --- BASELINE STORAGE LOGIC ---
    function loadBaselines() {
        chrome.storage.local.get(['marq_qa_baselines'], (res) => {
            savedBaselines = res.marq_qa_baselines || [];
            
            // Rebuild Dropdown
            qaBaselineSelect.innerHTML = '<option value="">-- Choose a saved Baseline --</option>';
            savedBaselines.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b.id;
                opt.innerText = `${b.name} (${new Date(b.timestamp).toLocaleDateString()})`;
                qaBaselineSelect.appendChild(opt);
            });
        });
    }

    async function saveBaselinesToStorage() {
        try {
            await chrome.storage.local.set({ marq_qa_baselines: savedBaselines });
            loadBaselines();
        } catch (e) {
            window.showGlobalAlert("Archives Overflowing", "My storage constraints have been breached. I beseech you to delete older baselines first.", "error");
        }
    }

    // Initialize Baselines on load
    if (qaBaselineSelect) loadBaselines();

    // --- BASELINE ACTIONS ---

	// --- MODAL INITIALIZATION & STATE ---
    let qaNameModal, qaUploadModal, qaDeleteModal;
    if (typeof bootstrap !== 'undefined') {
        // ✅ FIX: Guard each element — new bootstrap.Modal(null) throws
        const _nameModalEl   = document.getElementById('qaNameBaselineModal');
        const _uploadModalEl = document.getElementById('qaUploadActionModal');
        const _deleteModalEl = document.getElementById('qaConfirmDeleteModal');
        if (_nameModalEl)   qaNameModal   = new bootstrap.Modal(_nameModalEl);
        if (_uploadModalEl) qaUploadModal = new bootstrap.Modal(_uploadModalEl);
        if (_deleteModalEl) qaDeleteModal = new bootstrap.Modal(_deleteModalEl);
    }

    let pendingUploadDataUrl = null;
    let pendingDeleteType = null;
    let pendingDeleteId = null;

    // --- BASELINE ACTIONS ---

    // 1. Select existing Baseline from Dropdown
    if (qaBaselineSelect) {
        qaBaselineSelect.addEventListener('change', function() {
            const selectedId = this.value;
            if (!selectedId) {
                qaBaselinePreview.classList.add('d-none');
                qaBaselineEmptyText.classList.remove('d-none');
                baselineLoaded = false;
                qaRunDiffBtn.disabled = true;
                return;
            }

            const target = savedBaselines.find(b => b.id === selectedId);
            if (target) {
                baselineImg.src = target.dataUrl;
                qaBaselinePreview.src = target.dataUrl;
                qaBaselinePreview.classList.remove('d-none');
                qaBaselineEmptyText.classList.add('d-none');
                baselineLoaded = true;
                checkDiffReady();
            }
        });
    }

    // 2. Capture & Save NEW Baseline (Modal Flow)
    if (qaSaveNewBaselineBtn) {
        qaSaveNewBaselineBtn.addEventListener('click', async function() {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (isRestrictedUrl(tab.url)) {
                window.showGlobalAlert("Domain Secured", "My vision cannot pierce the veil of system pages. Capture is impossible.", "error");
                return;
            }

            document.getElementById('qaNewBaselineName').value = '';
            if (qaNameModal) qaNameModal.show();
        });
    }

    // Capture execution after Name is provided
    document.getElementById('qaConfirmSaveBaselineBtn')?.addEventListener('click', function() {
        let bName = document.getElementById('qaNewBaselineName').value.trim();
        if (!bName) {
            window.showGlobalAlert("Name Required", "I cannot file this without a proper name. Do provide one.", "warning");
            return;
        }

        if (qaNameModal) qaNameModal.hide();
        
        const btn = document.getElementById('qaSaveNewBaselineBtn');
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        
        chrome.tabs.captureVisibleTab(null, { format: "png" }, function (dataUrl) {
            btn.innerHTML = originalHtml;
            
            const newBaseline = {
                id: 'base_' + Date.now(),
                name: bName,
                dataUrl: dataUrl,
                timestamp: Date.now()
            };
            
            savedBaselines.push(newBaseline);
            saveBaselinesToStorage().then(() => {
                qaBaselineSelect.value = newBaseline.id;
                qaBaselineSelect.dispatchEvent(new Event('change')); // Trigger preview update
                window.showGlobalAlert("Baseline Saved", `"${newBaseline.name}" added to library.`, "success");
            });
        });
    });

    // 3. Upload Local File as Baseline (Modal Flow)
    if (qaBaselineUpload) {
        qaBaselineUpload.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(event) {
                pendingUploadDataUrl = event.target.result;
                document.getElementById('qaUploadBaselineName').value = file.name.split('.')[0];
                if (qaUploadModal) qaUploadModal.show();
            };
            reader.readAsDataURL(file);
            this.value = ''; // Reset input
        });
    }

    // Action: Save uploaded permanently
    document.getElementById('qaSaveUploadedBaselineBtn')?.addEventListener('click', function() {
        let bName = document.getElementById('qaUploadBaselineName').value.trim();
        if (!bName) {
            window.showGlobalAlert("Name Required", "I must insist you provide a name for this record.", "warning");
            return;
        }
        
        if (qaUploadModal) qaUploadModal.hide();

        const newBaseline = {
            id: 'base_' + Date.now(),
            name: bName,
            dataUrl: pendingUploadDataUrl,
            timestamp: Date.now()
        };
        savedBaselines.push(newBaseline);
        saveBaselinesToStorage().then(() => {
            qaBaselineSelect.value = newBaseline.id;
            qaBaselineSelect.dispatchEvent(new Event('change'));
            window.showGlobalAlert("Baseline Saved", `"${newBaseline.name}" added to library.`, "success");
        });
    });

    // Action: Use uploaded temporarily
    document.getElementById('qaUseTemporaryBtn')?.addEventListener('click', function() {
        if (qaUploadModal) qaUploadModal.hide();
        
        qaBaselineSelect.value = "";
        baselineImg.src = pendingUploadDataUrl;
        qaBaselinePreview.src = pendingUploadDataUrl;
        qaBaselinePreview.classList.remove('d-none');
        qaBaselineEmptyText.classList.add('d-none');
        baselineLoaded = true;
        checkDiffReady();
    });

    // 4. Manage / Delete Baselines (Modal Flow)
    if (qaManageBaselinesBtn) {
        qaManageBaselinesBtn.addEventListener('click', function() {
            const selectedId = qaBaselineSelect.value;
            
            if (selectedId) {
                pendingDeleteType = 'single';
                pendingDeleteId = selectedId;
                document.getElementById('qaDeleteModalTitle').innerText = "Delete Baseline?";
                document.getElementById('qaDeleteModalMsg').innerText = "This will remove the selected baseline from your library.";
                if (qaDeleteModal) qaDeleteModal.show();
            } else {
                if (savedBaselines.length === 0) {
                    window.showGlobalAlert("Barren Archives", "You ask me to delete from an already empty library. Most amusing.", "info");
                    return;
                }
                pendingDeleteType = 'all';
                document.getElementById('qaDeleteModalTitle').innerText = "Clear ALL Baselines?";
                document.getElementById('qaDeleteModalMsg').innerText = "This will permanently delete all saved baselines. This action cannot be undone.";
                if (qaDeleteModal) qaDeleteModal.show();
            }
        });
    }

    // Confirm Delete execution
    document.getElementById('qaConfirmDeleteBtn')?.addEventListener('click', function() {
        if (qaDeleteModal) qaDeleteModal.hide();

        if (pendingDeleteType === 'single') {
            savedBaselines = savedBaselines.filter(b => b.id !== pendingDeleteId);
            saveBaselinesToStorage();
            qaBaselineSelect.value = "";
            qaBaselineSelect.dispatchEvent(new Event('change'));
            window.showGlobalAlert("Deleted", "Baseline removed from library.", "info");
        } else if (pendingDeleteType === 'all') {
            savedBaselines = [];
            saveBaselinesToStorage();
            qaBaselinePreview.classList.add('d-none');
            qaBaselineEmptyText.classList.remove('d-none');
            window.showGlobalAlert("Cleared", "All baselines have been deleted.", "info");
        }
    });

    // --- CURRENT STATE & DIFF EXECUTION ---

    function checkDiffReady() {
        if (!qaRunDiffBtn) return; // ✅ FIX
        qaRunDiffBtn.disabled = !(baselineLoaded && currentLoaded);
    }

    if (qaCaptureCurrentBtn) {
        qaCaptureCurrentBtn.addEventListener('click', async function() {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (isRestrictedUrl(tab.url)) {
                window.showGlobalAlert("Domain Secured", "My vision cannot pierce the veil of system pages. Capture is impossible.", "error");
                return;
            }

            const originalHtml = this.innerHTML;
            this.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

            chrome.tabs.captureVisibleTab(null, { format: "png" }, function (dataUrl) {
                qaCaptureCurrentBtn.innerHTML = originalHtml;
                currentImg.src = dataUrl;
                qaCurrentPreview.src = dataUrl;
                qaCurrentPreview.classList.remove('d-none');
                const _captureHint = qaCurrentPreview.parentElement?.querySelector('button');
                if (_captureHint) _captureHint.classList.add('opacity-50');
                currentLoaded = true;
                checkDiffReady();
            });
        });
    }

    if (qaRunDiffBtn) {
        qaRunDiffBtn.addEventListener('click', function() {
            if (!baselineLoaded || !currentLoaded) return;
            
            qaDiffResultContainer.classList.remove('d-none');
            qaDiffResultContainer.classList.remove('animate__fadeIn');
            void qaDiffResultContainer.offsetWidth; // Trigger reflow
            qaDiffResultContainer.classList.add('animate__fadeIn');

            const ctx = qaDiffCanvas.getContext('2d', { willReadFrequently: true });
            
            const width = baselineImg.width;
            const height = baselineImg.height;
            qaDiffCanvas.width = width;
            qaDiffCanvas.height = height;

            ctx.drawImage(baselineImg, 0, 0, width, height);
            const baseData = ctx.getImageData(0, 0, width, height);
            
            ctx.clearRect(0, 0, width, height);
            // Draw current image starting from top left to avoid stretching false-positives
            ctx.drawImage(currentImg, 0, 0); 
            const curData = ctx.getImageData(0, 0, width, height);

            const diffData = ctx.createImageData(width, height);
            let diffPixels = 0;
            
            for (let i = 0; i < baseData.data.length; i += 4) {
                const rDiff = Math.abs(baseData.data[i] - curData.data[i]);
                const gDiff = Math.abs(baseData.data[i+1] - curData.data[i+1]);
                const bDiff = Math.abs(baseData.data[i+2] - curData.data[i+2]);
                
                // Tolerance threshold (10 out of 255) to ignore microscopic rendering artifacts
                if (rDiff > 10 || gDiff > 10 || bDiff > 10) {
                    diffPixels++;
                    diffData.data[i] = 255;     // R
                    diffData.data[i+1] = 0;     // G
                    diffData.data[i+2] = 255;   // B (Neon Pink)
                    diffData.data[i+3] = 255;   // Alpha
                } else {
                    // Turn matching pixels into faded grayscale
                    const gray = (baseData.data[i] * 0.3) + (baseData.data[i+1] * 0.59) + (baseData.data[i+2] * 0.11);
                    diffData.data[i] = gray;
                    diffData.data[i+1] = gray;
                    diffData.data[i+2] = gray;
                    diffData.data[i+3] = 100; // 40% opacity
                }
            }

            ctx.putImageData(diffData, 0, 0);
            
            const totalPixels = width * height;
            const percentDiff = ((diffPixels / totalPixels) * 100).toFixed(2);
            qaDiffScore.innerText = `${percentDiff}% Shift / Diff`;
            
            if(percentDiff > 0) {
                qaDiffScore.classList.replace('bg-success', 'bg-danger');
            } else {
                qaDiffScore.classList.replace('bg-danger', 'bg-success');
                qaDiffScore.innerText = "Pixel Perfect Match!";
            }
        });
    }

    if (document.getElementById('qaDownloadDiffBtn')) {
        document.getElementById('qaDownloadDiffBtn').addEventListener('click', function() {
            const link = document.createElement('a');
            link.download = `Visual_Diff_${Date.now()}.png`;
            link.href = qaDiffCanvas.toDataURL();
            link.click();
            window.showGlobalAlert("Downloaded", "Visual Diff Report saved.", "success");
        });
    }

    // 4. Layout Alignment Grid
    const qaGridToggle = document.getElementById('qaGridToggle');
    if (qaGridToggle) {
        qaGridToggle.addEventListener('change', function() {
            const show = this.checked;
            const cols = document.getElementById('qaGridCols').value || 12;
            const gutter = document.getElementById('qaGridGutter').value || 24;
            const width = document.getElementById('qaGridWidth').value || 1140;
            const color = document.getElementById('qaGridColor').value || '#ff0000';

            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                if (!tabs || !tabs[0]) return; // ✅ FIX
                if (isRestrictedUrl(tabs[0].url)) {
                    qaGridToggle.checked = false;
                    window.showGlobalAlert("Domain Secured", "My layout grids are deflected by the security of system pages.", "error");
                    return;
                }
                chrome.scripting.executeScript({
                    target: {tabId: tabs[0].id},
                    func: injectLayoutGrid,
                    args: [show, cols, gutter, width, color]
                });
            });
        });
    }

    function injectLayoutGrid(show, cols, gutter, width, color) {
        let grid = document.getElementById('marq-layout-grid');
        if (!show) {
            if (grid) grid.remove();
            return;
        }
        if (!grid) {
            grid = document.createElement('div');
            grid.id = 'marq-layout-grid';
            grid.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 999998; pointer-events: none; display: flex; justify-content: center;`;
            document.body.appendChild(grid);
        }

        // Convert hex to rgba
        let r = parseInt(color.slice(1, 3), 16);
        let g = parseInt(color.slice(3, 5), 16);
        let b = parseInt(color.slice(5, 7), 16);
        let rgba = `rgba(${r}, ${g}, ${b}, 0.15)`;

        let innerHtml = `<div style="display: flex; width: 100%; max-width: ${width}px; height: 100%; gap: ${gutter}px; padding: 0 ${gutter/2}px;">`;
        for (let i=0; i<cols; i++) {
            innerHtml += `<div style="flex: 1; height: 100%; background-color: ${rgba};"></div>`;
        }
        innerHtml += `</div>`;
        grid.innerHTML = innerHtml;
    }

    // 5. Vision & Accessibility Simulator
    document.querySelectorAll('.qa-vision-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            
            // UI Update for active button
            document.querySelectorAll('.qa-vision-btn').forEach(b => {
                b.classList.replace('btn-primary', 'btn-outline-secondary');
                b.querySelector('.bi-check2').classList.add('d-none');
            });
            this.classList.replace('btn-outline-secondary', 'btn-primary');
            this.querySelector('.bi-check2').classList.remove('d-none');

            const filterType = this.getAttribute('data-filter');
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                if (isRestrictedUrl(tabs[0].url)) {
                    window.showGlobalAlert("Domain Secured", "These system pages refuse my visual filters entirely.", "error");
                    return;
                }
                chrome.scripting.executeScript({
                    target: {tabId: tabs[0].id},
                    func: applyVisionFilter,
                    args: [filterType]
                });
            });
        });
    });

    function applyVisionFilter(type) {
        let svg = document.getElementById('marq-vision-filters');
        if (!svg) {
            svg = document.createElement('div');
            svg.id = 'marq-vision-filters';
            svg.style.display = 'none';
            svg.innerHTML = `
                <svg>
                    <defs>
                        <filter id="marq-protanopia">
                            <feColorMatrix type="matrix" values="0.567, 0.433, 0, 0, 0  0.558, 0.442, 0, 0, 0  0, 0.242, 0.758, 0, 0  0, 0, 0, 1, 0"/>
                        </filter>
                        <filter id="marq-deuteranopia">
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
            document.documentElement.style.filter = `url(#marq-${type})`;
        } else {
            document.documentElement.style.filter = type;
        }
    }

    // =========================================================================
    // 🟢 TAB 4: ENTERPRISE E2E & CHAOS ENGINE
    // =========================================================================

    const isRestricted = (url) => url.startsWith('chrome://') || url.startsWith('edge://') || url.includes('chrome.google.com');

    // --- 1. E2E TEST SCRIPT GENERATOR ---
    let isE2ERecording = false;
    let e2eActions = [];
    
    const btnStartE2E = document.getElementById('qaStartE2EBtn');
    const btnStopE2E = document.getElementById('qaStopE2EBtn');
    const e2eOutput = document.getElementById('qaE2EOutput');
    const e2eFramework = document.getElementById('qaE2EFramework');

    function updateE2ECode() {
        if (!e2eOutput) return;
        const fw = e2eFramework.value;
        let code = '';
        // Selectors and values come from the recorded site. They are written as JSON string literals so a
        // crafted id like  x');require('child_process')...//  stays a string in the generated test.
        const lit = (v) => JSON.stringify(String(v ?? ''));

        if (fw === 'playwright') {
            code = `import { test, expect } from '@playwright/test';\n\ntest('Recorded Scenario', async ({ page }) => {\n`;
            e2eActions.forEach(a => {
                if (a.type === 'goto') code += `  await page.goto(${lit(a.val)});\n`;
                if (a.type === 'click') code += `  await page.locator(${lit(a.sel)}).click();\n`;
                if (a.type === 'type') code += `  await page.locator(${lit(a.sel)}).fill(${lit(a.val)});\n`;
            });
            code += `});`;
            document.getElementById('qaE2ELangLabel').innerText = 'playwright.spec.ts';
        } else {
            code = `describe('Recorded Scenario', () => {\n  it('should execute flow', () => {\n`;
            e2eActions.forEach(a => {
                if (a.type === 'goto') code += `    cy.visit(${lit(a.val)});\n`;
                if (a.type === 'click') code += `    cy.get(${lit(a.sel)}).click();\n`;
                if (a.type === 'type') code += `    cy.get(${lit(a.sel)}).type(${lit(a.val)});\n`;
            });
            code += `  });\n});`;
            document.getElementById('qaE2ELangLabel').innerText = 'cypress.spec.js';
        }
        e2eOutput.value = code;
    }

    if (e2eFramework) e2eFramework.addEventListener('change', updateE2ECode);

    if (btnStartE2E) {
        btnStartE2E.addEventListener('click', () => {
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                if (isRestricted(tabs[0].url)) { window.showGlobalAlert("Blocked", "Cannot record on system pages.", "error"); return; }
                
                isE2ERecording = true;
                e2eActions = [{ type: 'goto', val: tabs[0].url }];
                updateE2ECode();
                
                btnStartE2E.disabled = true;
                btnStopE2E.disabled = false;
                btnStartE2E.innerHTML = '<span class="spinner-grow spinner-grow-sm"></span> Recording...';

                // Inject event listeners into the active tab
                chrome.scripting.executeScript({
                    target: {tabId: tabs[0].id},
                    func: injectE2EListeners
                });
            });
        });
    }

    if (btnStopE2E) {
        btnStopE2E.addEventListener('click', () => {
            isE2ERecording = false;
            btnStartE2E.disabled = false;
            btnStopE2E.disabled = true;
            btnStartE2E.innerHTML = '<i class="bi bi-record-circle me-1"></i> Start Recording';

            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                chrome.scripting.executeScript({
                    target: {tabId: tabs[0].id},
                    func: removeE2EListeners
                });
            });
        });
    }

    document.getElementById('qaCopyE2EBtn')?.addEventListener('click', () => {
        if (e2eOutput.value) {
            navigator.clipboard.writeText(e2eOutput.value);
            window.showGlobalAlert("Copied", "Test script copied to clipboard.", "success");
        }
    });

    // Listen for messages FROM the injected script
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'e2e_action_recorded' && isE2ERecording) {
            e2eActions.push(msg.data);
            updateE2ECode();
        }
        if (msg.action === 'chaos_error_caught') {
            const countEl = document.getElementById('qaChaosErrorCount');
            if (countEl) countEl.innerText = parseInt(countEl.innerText) + 1;
        }
    });

    // Scripts to inject
    function injectE2EListeners() {
        if (window._mqE2EActive) return;
        window._mqE2EActive = true;

        const getSelector = (el) => {
            if (el.id) return `#${el.id}`;
            if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
            let path = el.tagName.toLowerCase();
            if (el.className && typeof el.className === 'string') {
                const cls = el.className.trim().split(/\s+/)[0];
                if (cls) path += `.${cls}`;
            }
            return path;
        };

        window._mqE2EClick = (e) => {
            const el = e.target.closest('button, a, input[type="submit"], [role="button"]') || e.target;
            chrome.runtime.sendMessage({ action: 'e2e_action_recorded', data: { type: 'click', sel: getSelector(el) } });
        };
        
        window._mqE2EChange = (e) => {
            chrome.runtime.sendMessage({ action: 'e2e_action_recorded', data: { type: 'type', sel: getSelector(e.target), val: e.target.value } });
        };

        document.addEventListener('click', window._mqE2EClick, true);
        document.addEventListener('change', window._mqE2EChange, true);
    }

    function removeE2EListeners() {
        if (!window._mqE2EActive) return;
        document.removeEventListener('click', window._mqE2EClick, true);
        document.removeEventListener('change', window._mqE2EChange, true);
        window._mqE2EActive = false;
    }


    // --- 2. CHAOS MONKEY (FUZZ TESTER) ---
    let isChaosActive = false;
    const btnChaos = document.getElementById('qaUnleashChaosBtn');
    const chaosSlider = document.getElementById('qaChaosIntensity');

    chaosSlider?.addEventListener('input', (e) => {
        document.getElementById('qaChaosIntensityVal').innerText = `${e.target.value} Actions/sec`;
    });

    btnChaos?.addEventListener('click', () => {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (isRestricted(tabs[0].url)) return;

            if (!isChaosActive) {
                isChaosActive = true;
                btnChaos.innerHTML = '<i class="bi bi-stop-circle-fill"></i> Stop Chaos';
                btnChaos.classList.replace('btn-warning', 'btn-danger');
                document.getElementById('qaChaosStats').classList.remove('d-none');
                document.getElementById('qaChaosErrorCount').innerText = '0';
                
                const speed = 1000 / parseInt(chaosSlider.value); // Convert actions/sec to ms delay
                
                chrome.scripting.executeScript({
                    target: {tabId: tabs[0].id},
                    func: startChaosMonkey,
                    args: [speed]
                });
            } else {
                isChaosActive = false;
                btnChaos.innerHTML = '<i class="bi bi-bug-fill"></i> Unleash Chaos';
                btnChaos.classList.replace('btn-danger', 'btn-warning');
                
                chrome.scripting.executeScript({
                    target: {tabId: tabs[0].id},
                    func: stopChaosMonkey
                });
            }
        });
    });

    function startChaosMonkey(delay) {
        if (window._mqChaosInterval) return;
        
        // Trap unhandled JS errors and send them back to the extension
        window._mqChaosErrorHandler = (msg, url, lineNo, columnNo, error) => {
            chrome.runtime.sendMessage({ action: 'chaos_error_caught' });
            return false;
        };
        window.addEventListener('error', window._mqChaosErrorHandler);

        window._mqChaosInterval = setInterval(() => {
            const interactives = document.querySelectorAll('button, a, input, select, [tabindex]');
            if (interactives.length > 0) {
                const randomEl = interactives[Math.floor(Math.random() * interactives.length)];
                try {
                    const action = Math.random();
                    if (action < 0.6) randomEl.click();
                    else if (action < 0.8) randomEl.focus();
                    else {
                        randomEl.value = Math.random().toString(36).substring(7);
                        randomEl.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                } catch (e) {}
            }
            window.scrollTo({
                top: Math.random() * document.body.scrollHeight,
                left: Math.random() * document.body.scrollWidth,
                behavior: 'instant'
            });
        }, delay);
    }

    function stopChaosMonkey() {
        clearInterval(window._mqChaosInterval);
        window._mqChaosInterval = null;
        window.removeEventListener('error', window._mqChaosErrorHandler);
    }


    // --- 3. STATE WIPER ---
    document.getElementById('qaNukeStateBtn')?.addEventListener('click', () => {
        const wipeLocal = document.getElementById('wipeLocal').checked;
        const wipeSession = document.getElementById('wipeSession').checked;
        const wipeCookies = document.getElementById('wipeCookies').checked;

        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (isRestricted(tabs[0].url)) return;

            chrome.scripting.executeScript({
                target: {tabId: tabs[0].id},
                func: executeStateWipe,
                args: [wipeLocal, wipeSession, wipeCookies]
            });
            window.showGlobalAlert("Nuked", "State erased. Reload the page to see effects.", "success");
        });
    });

    function executeStateWipe(l, s, c) {
        if (l) localStorage.clear();
        if (s) sessionStorage.clear();
        if (c) {
            document.cookie.split(";").forEach(function(c) { 
                document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
            });
        }
    }
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'qadevSection') initQaDev();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('resizerTargetUrl')) initQaDev();
});