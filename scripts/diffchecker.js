function initDiffChecker() {
    // Check if library loaded
    if (typeof diff_match_patch === 'undefined') {
        console.error("diff_match_patch library not loaded.");
        return;
    }

    const dmp = new diff_match_patch();
    const DIFF_DELETE = -1;
    const DIFF_INSERT = 1;
    const DIFF_EQUAL = 0;

    // UI Refs
    const text1 = document.getElementById('diffText1');
    const text2 = document.getElementById('diffText2');
    const view1 = document.getElementById('originalResult');
    const view2 = document.getElementById('changedResult');
    
    const file1 = document.getElementById('fileInput1');
    const file2 = document.getElementById('fileInput2');
    
    const compareBtn = document.getElementById('compareBtn');
    const editBtn = document.getElementById('editDiffBtn');
    const clearBtn = document.getElementById('clearDiffBtn');
    const expandBtn = document.getElementById('expandBtn');
    const historyBtn = document.getElementById('historyDiffBtn'); // 🟢 NEW
    const charLevelCheck = document.getElementById('charLevelDiff');
    
    // Stats Refs
    const statsBadge = document.getElementById('diffStats');
    const badgeOrig = document.getElementById('originalBadge');
    const badgeMod = document.getElementById('modifiedBadge');

    // Modal Refs
    let diffHistoryModalInstance;
    const diffHistoryModalEl = document.getElementById('diffHistoryModal');
    if (diffHistoryModalEl && typeof bootstrap !== 'undefined') {
        diffHistoryModalInstance = new bootstrap.Modal(diffHistoryModalEl);
    }

    // 1. File Handling
    const handleFile = (input, textarea) => {
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                textarea.value = ev.target.result;
                toggleMode('edit');
            };
            reader.readAsText(file);
        });
    };
    handleFile(file1, text1);
    handleFile(file2, text2);

    // ✅ FIX: Guard the entire diffchecker module if elements aren't present
    if (!compareBtn || !text1 || !text2) return;

    // 2. Compare Logic
    compareBtn.addEventListener('click', () => {
        const t1 = text1.value;
        const t2 = text2.value;

        // 🟢 FIXED: Removed native alert()
        if (!t1 && !t2) {
            if (window.showGlobalAlert) window.showGlobalAlert("Input Required", "I must insist you provide text before I can formulate a comparison.", "warning");
            return;
        }

        saveToHistory(t1, t2); // 泙 NEW: Save before comparing

        const diffs = dmp.diff_main(t1, t2);
        
        if (!charLevelCheck.checked) {
            dmp.diff_cleanupSemantic(diffs);
        }

        renderDiff(diffs);
        toggleMode('view');
    });

    // 3. Render Function
    function renderDiff(diffs) {
        view1.innerHTML = '';
        view2.innerHTML = '';
        
        let adds = 0;
        let dels = 0;

        const frag1 = document.createDocumentFragment();
        const frag2 = document.createDocumentFragment();

        diffs.forEach(([op, text]) => {
            const span1 = document.createElement('span');
            const span2 = document.createElement('span');
            
            span1.textContent = text;
            span2.textContent = text;

            if (op === DIFF_EQUAL) {
                frag1.appendChild(span1);
                frag2.appendChild(span2);
            } 
            else if (op === DIFF_DELETE) {
                span1.className = 'diff-removed';
                frag1.appendChild(span1);
                dels++;
            } 
            else if (op === DIFF_INSERT) {
                span2.className = 'diff-added';
                frag2.appendChild(span2);
                adds++;
            }
        });

        view1.appendChild(frag1);
        view2.appendChild(frag2);

        if(adds === 0 && dels === 0) {
            statsBadge.className = "badge bg-success";
            statsBadge.textContent = "Identical";
        } else {
            statsBadge.className = "badge bg-warning text-dark";
            statsBadge.textContent = `${adds + dels} Changes`;
        }
        statsBadge.classList.remove('d-none');

        badgeOrig.textContent = `-${dels}`;
        badgeMod.textContent = `+${adds}`;
        badgeOrig.classList.remove('d-none');
        badgeMod.classList.remove('d-none');
    }

    // 4. Toggle Views
    function toggleMode(mode) {
        if (mode === 'view') {
            text1.classList.add('d-none');
            text2.classList.add('d-none');
            view1.classList.remove('d-none');
            view2.classList.remove('d-none');
            compareBtn.classList.add('d-none');
            editBtn.classList.remove('d-none');
        } else {
            text1.classList.remove('d-none');
            text2.classList.remove('d-none');
            view1.classList.add('d-none');
            view2.classList.add('d-none');
            compareBtn.classList.remove('d-none');
            editBtn.classList.add('d-none');
            
            statsBadge.classList.add('d-none');
            badgeOrig.classList.add('d-none');
            badgeMod.classList.add('d-none');
        }
    }

    editBtn.addEventListener('click', () => toggleMode('edit'));

    clearBtn.addEventListener('click', () => {
        text1.value = "";
        text2.value = "";
        view1.innerHTML = "";
        view2.innerHTML = "";
        toggleMode('edit');
    });

    // 5. Sync Scrolling
    const syncScroll = (source, target) => {
        target.scrollTop = source.scrollTop;
        target.scrollLeft = source.scrollLeft;
    };
    view1.addEventListener('scroll', () => syncScroll(view1, view2));
    view2.addEventListener('scroll', () => syncScroll(view2, view1));

    // 6. Expand Window Logic
    expandBtn.addEventListener('click', () => {
        saveToHistory(text1.value, text2.value); // 🟢 NEW: Save before popping out

        chrome.storage.local.set({ 
            diffOriginal: text1.value, 
            diffModified: text2.value 
        }, () => {
            const isDark = document.body.getAttribute('data-bs-theme') === 'dark';
            const themeParam = isDark ? '?theme=dark' : '?theme=light';
            window.open('diffWindow.html' + themeParam, '_blank');
        });
    });

    // --- 🟢 NEW: HISTORY LOGIC ---

    function saveToHistory(t1, t2) {
        if (!t1 && !t2) return;
        chrome.storage.local.get(['diffHistory'], (res) => {
            let history = res.diffHistory || [];
            
            // Don't save if it's the exact same as the last saved item
            if (history.length > 0 && history[0].t1 === t1 && history[0].t2 === t2) return;

            history.unshift({
                id: Date.now(),
                timestamp: new Date().toLocaleString(),
                t1: t1,
                t2: t2
            });

            if (history.length > 15) history.pop(); // Max 15 items to save RAM
            chrome.storage.local.set({ diffHistory: history });
        });
    }

    function renderDiffHistory() {
        const list = document.getElementById('diffHistoryList');
        list.innerHTML = '';
        
        chrome.storage.local.get(['diffHistory'], (res) => {
            const history = res.diffHistory || [];
            
            if (history.length === 0) {
                list.innerHTML = '<div class="text-center text-muted py-3 small fst-italic"><i class="bi bi-clock-history fs-2 d-block mb-2 opacity-50"></i>No comparison history found.</div>';
                return;
            }

            history.forEach(item => {
                // Safely truncate strings for the UI preview
                const origPreview = item.t1.substring(0, 100).replace(/\n/g, ' ') + (item.t1.length > 100 ? '...' : '');
                const modPreview = item.t2.substring(0, 100).replace(/\n/g, ' ') + (item.t2.length > 100 ? '...' : '');

                const card = document.createElement('div');
                card.className = 'bg-body p-3 rounded-4 border border-secondary-subtle shadow-sm mb-2';
                card.innerHTML = `
                    <div class="d-flex justify-content-between align-items-center mb-2 pb-2 border-bottom border-secondary-subtle">
                        <span class="small fw-bold text-secondary"><i class="bi bi-clock me-1"></i> ${item.timestamp}</span>
                        <button class="btn btn-sm btn-primary fw-bold rounded-pill shadow-sm px-3 restore-diff-btn" data-id="${item.id}">Restore Texts</button>
                    </div>
                    <div class="row g-2 small">
                        <div class="col-6 border-end border-secondary-subtle">
                            <span class="d-block fw-bold text-danger mb-1" style="font-size: var(--mq-fs-xs);">ORIGINAL</span>
                            <span class="text-muted font-monospace" style="font-size: var(--mq-fs-xs); word-break: break-all;">${origPreview ? MarquisHtml.esc(origPreview) : '<em class="opacity-50">Empty</em>'}</span>
                        </div>
                        <div class="col-6">
                            <span class="d-block fw-bold text-success mb-1" style="font-size: var(--mq-fs-xs);">MODIFIED</span>
                            <span class="text-muted font-monospace" style="font-size: var(--mq-fs-xs); word-break: break-all;">${modPreview ? MarquisHtml.esc(modPreview) : '<em class="opacity-50">Empty</em>'}</span>
                        </div>
                    </div>
                `;
                list.appendChild(card);
            });

            // Bind Restore Buttons
            document.querySelectorAll('.restore-diff-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = parseInt(e.target.getAttribute('data-id'));
                    const selected = history.find(h => h.id === id);
                    if (selected) {
                        text1.value = selected.t1;
                        text2.value = selected.t2;
                        toggleMode('edit'); // Drop them into edit mode so they can see the restored text
                        diffHistoryModalInstance?.hide();
                    }
                });
            });
        });
    }

    if (historyBtn) {
        historyBtn.addEventListener('click', () => {
            renderDiffHistory();
            diffHistoryModalInstance?.show();
        });
    }

    const clearHistoryBtn = document.getElementById('clearDiffHistoryBtn');
    if (clearHistoryBtn) {
        let confirmState = false;
        clearHistoryBtn.addEventListener('click', () => {
            // 🟢 FIXED: Replaced native confirm() with a 2-step button click
            if (!confirmState) {
                confirmState = true;
                const originalText = clearHistoryBtn.innerHTML;
                clearHistoryBtn.innerHTML = "Click again to confirm";
                clearHistoryBtn.classList.replace('btn-outline-danger', 'btn-danger');
                setTimeout(() => {
                    confirmState = false;
                    clearHistoryBtn.innerHTML = originalText;
                    clearHistoryBtn.classList.replace('btn-danger', 'btn-outline-danger');
                }, 3000);
                return;
            }
            
            chrome.storage.local.set({ diffHistory: [] }, () => {
                renderDiffHistory();
                confirmState = false;
                clearHistoryBtn.innerHTML = "Clear History";
                clearHistoryBtn.classList.replace('btn-danger', 'btn-outline-danger');
                if (window.showGlobalAlert) window.showGlobalAlert("History Cleared", "Comparison history removed.", "success");
            });
        });
    }
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
// Called by script.js after the <template> is stamped into the live DOM.
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'diffCheckerSection') initDiffChecker();
});

// Fallback for standalone pages where elements already exist at DOMContentLoaded.
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('compareBtn')) initDiffChecker();
});