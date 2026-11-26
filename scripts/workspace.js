function initWorkspace() {
    
    // --- CONFIG ---
    const STORAGE_KEY = 'odh_workspaces';

    // Tab titles, URLs and favicons come from the visited sites, and names from the user: every value is
    // escaped before it reaches markup (scripts/safe_html.js). Links open only http(s); icons load only
    // http(s) or data:image.
    const { esc } = MarquisHtml;
    const safeHref = (url) => /^https?:\/\//i.test(url || '') ? url : '#';

    // --- UI REFS ---
    const nameInput = document.getElementById('newWsName');
    const createBtn = document.getElementById('btnCreateWs');
    const listContainer = document.getElementById('workspaceList');
    const activeTabsContainer = document.getElementById('activeTabsList');
    const refreshActiveBtn = document.getElementById('refreshActiveTabsBtn');
    const menuSelector = document.getElementById('menuSelector');

    // Modal Refs
    let renameModal, confirmModal;
    const renameInput = document.getElementById('wsRenameInput');
    const renameIdField = document.getElementById('wsRenameId');
    const confirmMsg = document.getElementById('wsConfirmMsg');
    const confirmActionBtn = document.getElementById('wsConfirmActionBtn');
    
    // Initialize Modals safely
    if (typeof bootstrap !== 'undefined') {
        const rnEl = document.getElementById('wsRenameModal');
        if(rnEl) renameModal = new bootstrap.Modal(rnEl);
        
        const cmEl = document.getElementById('wsConfirmModal');
        if(cmEl) confirmModal = new bootstrap.Modal(cmEl);
    }

    // --- INIT ---
    const closeStudioBtn = document.getElementById('closeStudioBtn');
    if (closeStudioBtn) {
        closeStudioBtn.addEventListener('click', () => window.close());
    }

    if (menuSelector) {
        // Popup Mode: Wait for the user to open the section
        menuSelector.addEventListener('change', () => {
            if (menuSelector.value === 'workspaceSection') {
                refreshAll();
            }
        });
        // First open: init runs after the 'change' that opened this section, so that listener missed it.
        if (menuSelector.value === 'workspaceSection') refreshAll();
    } else {
        // Fullscreen Mode: No menu exists, load immediately!
        refreshAll();
    }

    if (createBtn) createBtn.addEventListener('click', createWorkspace);
    if (nameInput) {
        nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') createWorkspace();
        });
    }
    if (refreshActiveBtn) refreshActiveBtn.addEventListener('click', () => refreshAll());

    // Rename Confirm Handler
    const confirmRenameBtn = document.getElementById('wsConfirmRenameBtn');
    if(confirmRenameBtn) {
        confirmRenameBtn.addEventListener('click', () => {
            const id = renameIdField.value;
            const newName = renameInput.value.trim();
            if(id && newName) {
                performRename(id, newName);
                if(renameModal) renameModal.hide();
            }
        });
    }

    function refreshAll() {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
            const workspaces = result[STORAGE_KEY] || [];
            renderWorkspaces(workspaces);
            renderActiveTabs(workspaces);
        });
    }

    // --- HELPER: FALLBACK ICON ---
    const DEFAULT_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0iIzZjNzU3ZCIgY2xhc3M9ImJpIGJpLWdsb2JlIj48cGF0aCBkPSJNMCA4YThCA4IDAgMSAxIDE2IDBBOCA4IDAgMCAxIDAgOHptNy41LTYuOTIzYy0uNzcuMTEzLTEuNDYuMzI1LTIuMTAyLjU5N3oiLz48L3N2Zz4=';

    function handleImgError(img) {
        img.onerror = null;
        img.src = DEFAULT_ICON;
    }

    const safeIcon = (url) => /^(https?:\/\/|data:image\/)/i.test(url || '') ? url : DEFAULT_ICON;

    // 🟢 NEW: Global URL Blocker
    // Prevents saving internal browser pages, local files, and extension pages
    function isAllowedUrl(url) {
        if (!url) return false;
        const restrictedPrefixes = [
            'chrome://', 
            'chrome-extension://', 'moz-extension://', 
            'edge://', 
            'about:', 
            'file://'
        ];
        return !restrictedPrefixes.some(prefix => url.startsWith(prefix));
    }

    function showWsAlert(title, msg, type = 'info') {
        const toastEl = document.getElementById('globalToast');
        
        // If we are in Fullscreen mode and the Toast HTML exists:
        if (toastEl && typeof bootstrap !== 'undefined') {
            const titleEl = document.getElementById('globalToastTitle');
            const msgEl = document.getElementById('globalToastMsg');
            const iconContainer = document.getElementById('globalToastIconContainer');
            const icon = document.getElementById('globalToastIcon');

            titleEl.innerText = title;
            msgEl.innerText = msg;

            // Reset classes
            iconContainer.className = 'd-flex align-items-center justify-content-center rounded-circle flex-shrink-0 me-3 mt-1';
            icon.className = 'bi fs-5';

            if (type === 'success') {
                iconContainer.classList.add('bg-success', 'bg-opacity-10', 'text-success');
                icon.classList.add('bi-check-circle-fill');
            } else if (type === 'error') {
                iconContainer.classList.add('bg-danger', 'bg-opacity-10', 'text-danger');
                icon.classList.add('bi-x-circle-fill');
            } else {
                iconContainer.classList.add('bg-primary', 'bg-opacity-10', 'text-primary');
                icon.classList.add('bi-info-circle-fill');
            }

            const toast = new bootstrap.Toast(toastEl);
            toast.show();
        } 
        // Fallback for the main Popup
        else if (typeof window.showGlobalAlert === 'function') {
            window.showGlobalAlert(title, msg, type);
        } 
        // Absolute failsafe
        else {
            console.warn(`[Workspace Alert Fallback] ${title}: ${msg}`);
        }
    }

    // --- 1. ACTIVE TABS MANAGER ---
    async function renderActiveTabs(workspaces = []) {
        if (!activeTabsContainer) return;
        
        if (!workspaces.length) {
            const res = await chrome.storage.local.get([STORAGE_KEY]);
            workspaces = res[STORAGE_KEY] || [];
        }

        // 🟢 FIX: Get ALL tabs across normal windows.
        const tabs = await chrome.tabs.query({ windowType: 'normal' });
        
        // 🟢 FIX: Apply the URL Blocker here
        const validTabs = tabs.filter(t => isAllowedUrl(t.url));

        activeTabsContainer.innerHTML = '';

        if (validTabs.length === 0) {
            activeTabsContainer.innerHTML = '<div class="text-center text-muted py-3 fst-italic small">No valid external tabs found.</div>';
            return;
        }

        const wsOptions = workspaces.map(ws => `<option value="${esc(ws.id)}">${esc(ws.name)}</option>`).join('');
        const hasWorkspaces = workspaces.length > 0;

        validTabs.forEach(t => {
            const assignedWs = workspaces.find(ws => ws.tabs.some(savedTab => savedTab.url === t.url));
            
            const div = document.createElement('div');
            div.className = 'list-group-item d-flex align-items-center gap-2 py-3 bg-transparent border-bottom border-secondary-subtle';
            
            let rightSideContent = '';
            
            if (assignedWs) {
                rightSideContent = `
                    <span class="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 rounded-pill px-2 py-1" style="font-size: var(--mq-fs-xs);">
                        <i class="bi bi-collection me-1" aria-hidden="true"></i> ${esc(assignedWs.name)}
                    </span>
                `;
            } else if (hasWorkspaces) {
                rightSideContent = `
                    <select class="form-select form-select-sm py-1 px-2 assign-ws-select bg-body-tertiary border-secondary-subtle fw-bold text-secondary shadow-sm rounded-pill"
                            aria-label="Add this tab to a workspace"
                            style="width: 130px; font-size: var(--mq-fs-xs); cursor:pointer;">
                        <option value="" selected>+ Add to group...</option>
                        ${wsOptions}
                    </select>
                `;
            } else {
                // 🟢 FIXED: Removed bg-dark, added theme-adaptive bg-body-secondary and border
                rightSideContent = `<small class="text-secondary fst-italic bg-body-secondary border border-secondary-subtle rounded px-2 py-1" style="font-size:var(--mq-fs-xs)">No groups available</small>`;
            }

            div.innerHTML = `
                <img src="${esc(safeIcon(t.favIconUrl))}" width="18" height="18" alt="" class="tab-favicon rounded shadow-sm">
                <span class="text-truncate text-body fw-bold flex-grow-1 ms-2" title="${esc(t.title)}">${esc(t.title)}</span>
                ${rightSideContent}
            `;

            const img = div.querySelector('.tab-favicon');
            if(img) {
                img.addEventListener('error', () => handleImgError(img));
            }

            const select = div.querySelector('.assign-ws-select');
            if (select) {
                select.addEventListener('change', (e) => {
                    if (e.target.value) {
                        const tabData = { url: t.url, title: t.title, favIconUrl: t.favIconUrl || '' };
                        addTabToWorkspace(e.target.value, tabData);
                        
                        e.target.classList.add('bg-success', 'text-white');
                        setTimeout(() => refreshAll(), 300);
                    }
                });
            }

            activeTabsContainer.appendChild(div);
        });
    }

    // --- 2. WORKSPACE RENDERER (COLLAPSIBLE CARD STYLE) ---

    function renderWorkspaces(workspaces) {
        listContainer.innerHTML = '';

        if (workspaces.length === 0) {
            listContainer.innerHTML = `
                <div class="text-center text-muted py-3 small fst-italic">
                    No workspaces saved yet. <br>Create one to save your current unpinned tabs.
                </div>`;
            return;
        }

        workspaces.forEach((ws) => {
            const tabCount = ws.tabs.length;
            const collapseId = `collapseWs-${String(ws.id).replace(/[^\w-]/g, '')}`;
            
            // Tab Links HTML
            const linksHtml = ws.tabs.map((t, idx) => `
                <div class="list-group-item d-flex align-items-center gap-2 py-2 px-3 border-0 border-bottom border-secondary-subtle bg-transparent">
                    <img src="${esc(safeIcon(t.favIconUrl))}" width="14" height="14" alt="" class="flex-shrink-0 tab-icon-${idx}">
                    <a href="${esc(safeHref(t.url))}" target="_blank" rel="noopener" class="text-truncate text-decoration-none text-body small flex-grow-1" title="${esc(t.title)}">${esc(t.title)}</a>
                    <button type="button" class="btn btn-link text-danger p-0 delete-tab-btn opacity-50 hover-opacity-100" data-tab-idx="${idx}" title="Remove Link" aria-label="Remove ${esc(t.title)} from the workspace">
                        <i class="bi bi-x-lg" aria-hidden="true"></i>
                    </button>
                </div>
            `).join('');

            const card = document.createElement('div');
            card.className = 'card workspace-card border border-secondary-subtle shadow-sm mb-2';
            
            card.innerHTML = `
                <div class="card-header bg-body border-0 p-0">
                    <div class="d-flex align-items-center w-100 p-2">
                        
                        <button class="btn btn-link text-decoration-none text-body p-0 d-flex align-items-center flex-grow-1 text-start" 
                                type="button" 
                                data-bs-toggle="collapse" 
                                data-bs-target="#${collapseId}" 
                                aria-expanded="false" 
                                aria-controls="${collapseId}">
                            
                            <i class="bi bi-chevron-down me-2 small text-muted transition-icon"></i>
                            <span class="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 rounded-pill me-2">${tabCount}</span>
                            <span class="fw-bold text-truncate text-body" style="max-width: 170px;">${esc(ws.name)}</span>
                        </button>

                        <div class="d-flex align-items-center gap-1">
                            <button class="btn btn-sm btn-outline-primary fw-bold px-3 switch-ws-btn rounded-pill" title="Switch Context">
                                <i class="bi bi-arrow-repeat me-1"></i> Switch
                            </button>
                            
                            <div class="position-relative manual-dropdown">
                                <button class="btn btn-sm btn-link text-secondary p-0 ms-1 manual-dropdown-toggle bg-body rounded-circle" type="button" aria-label="Workspace actions" title="Workspace actions">
                                    <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
                                </button>
                                <ul class="dropdown-menu dropdown-menu-end manual-dropdown-menu">
                                    <li><button class="dropdown-item small add-current-btn"><i class="bi bi-plus-square me-2"></i>Add Active Tab</button></li>
                                    <li><button class="dropdown-item small rename-ws-btn"><i class="bi bi-pencil me-2"></i>Rename</button></li>
                                    <li><button class="dropdown-item small update-all-btn"><i class="bi bi-arrow-clockwise me-2"></i>Overwrite with Current Tabs</button></li>
                                    <li><hr class="dropdown-divider"></li>
                                    <li><button class="dropdown-item small text-danger delete-ws-btn"><i class="bi bi-trash me-2"></i>Delete Workspace</button></li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>

				<div id="${collapseId}" class="collapse">
					<div class="card-body p-0 bg-body-tertiary border-top border-secondary-subtle rounded-bottom">
						<div class="list-group list-group-flush rounded-bottom">
							${linksHtml || '<div class="p-2 text-center text-muted small fst-italic">No tabs in group</div>'}
						</div>
					</div>
				</div>
            `;

            // --- LISTENERS ---

            // Icon Rotation Logic
            const collapseElement = card.querySelector('.collapse');
            const icon = card.querySelector('.bi-chevron-down');
            
            collapseElement.addEventListener('show.bs.collapse', () => {
                icon.style.transform = 'rotate(180deg)';
            });
            collapseElement.addEventListener('hide.bs.collapse', () => {
                icon.style.transform = 'rotate(0deg)';
            });

            // Images Error Handling
            card.querySelectorAll('img').forEach(img => {
                img.addEventListener('error', () => handleImgError(img));
            });

            // 2. Actions menu: a MarquisFloat panel (floats above every card, keyboard support, closes itself).
            MarquisFloat.menu(card.querySelector('.manual-dropdown-toggle'), card.querySelector('.manual-dropdown-menu'), { placement: 'bottom-end' });

            // 3. Actions
            const closeThisMenu = () => MarquisFloat.close();

            card.querySelector('.rename-ws-btn').addEventListener('click', () => {
                closeThisMenu();
                showRenameModal(ws);
            });

            card.querySelector('.switch-ws-btn').addEventListener('click', () => switchWorkspace(ws));
            
            card.querySelector('.add-current-btn').addEventListener('click', () => {
                closeThisMenu();
                addCurrentTabToWorkspace(ws.id);
            });
            
            card.querySelector('.update-all-btn').addEventListener('click', () => {
                closeThisMenu();
                showConfirmModal(`Overwrite "${ws.name}" with currently open tabs?`, () => updateWorkspace(ws.id));
            });

            card.querySelector('.delete-ws-btn').addEventListener('click', () => {
                closeThisMenu();
                showConfirmModal(`Delete workspace "${ws.name}"?`, () => deleteWorkspace(ws.id));
            });

            card.querySelectorAll('.delete-tab-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(e.currentTarget.getAttribute('data-tab-idx'));
                    removeTabFromWorkspace(ws.id, idx);
                });
            });

            listContainer.appendChild(card);
        });
    }

    // --- 3. ACTIONS & CRUD ---

    async function createWorkspace() {
        const name = nameInput.value.trim();
        if (!name) return;

        const allTabs = await chrome.tabs.query({ currentWindow: true, pinned: false });
        
        // 🟢 Apply the URL Blocker here
        const validTabs = allTabs.filter(t => isAllowedUrl(t.url));

        if (validTabs.length === 0) {
            showWsAlert('Barren Workspace', 'There are no valid external tabs here to save. Internal system pages are strictly off-limits.', 'error');
            return;
        }

        const workspaceData = {
            id: Date.now().toString(),
            name: name,
            tabs: validTabs.map(t => ({ 
                url: t.url, 
                title: t.title, 
                favIconUrl: t.favIconUrl || '' 
            })),
            lastUpdated: new Date().toISOString()
        };

        modifyWorkspace(null, (workspaces) => {
            workspaces.unshift(workspaceData);
            return workspaces;
        }, () => {
            nameInput.value = '';
            showWsAlert('Saved', `Workspace "${name}" created successfully.`, 'success');
        });
    }

	// The switch runs in background.js ('switchWorkspace'): opening the first tab closes the popup, which
	// used to stop this function before the other tabs were opened, grouped and the old ones closed.
	async function switchWorkspace(workspace) {
        const { id: windowId } = await chrome.windows.getCurrent();
        const res = await chrome.runtime.sendMessage({ action: 'switchWorkspace', id: workspace.id, windowId }).catch(err => ({ ok: false, error: err.message }));
        // Usually not reached from the popup (it has closed); the full-screen page shows failures.
        if (res && res.ok === false) showWsAlert('Switch Failed', res.error || 'The workspace could not be opened.', 'error');
    }

    async function addCurrentTabToWorkspace(wsId) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // 🟢 Apply the URL Blocker here
        if (!tab || !isAllowedUrl(tab.url)) {
            showWsAlert('Domain Secured', 'I must refuse; internal browser pages and settings are forbidden from entering your workspaces.', 'error');
            return;
        }

        const newTab = { 
            url: tab.url, 
            title: tab.title, 
            favIconUrl: tab.favIconUrl || '' 
        };
        addTabToWorkspace(wsId, newTab);
        showWsAlert('Tab Added', 'Active tab added to workspace.', 'success');
    }

    function addTabToWorkspace(wsId, tabData) {
        modifyWorkspace(wsId, (ws) => {
            if (!ws.tabs.some(t => t.url === tabData.url)) {
                ws.tabs.push(tabData);
            }
        });
    }

    function removeTabFromWorkspace(wsId, tabIndex) {
        modifyWorkspace(wsId, (ws) => {
            ws.tabs.splice(tabIndex, 1);
        });
    }

    // --- MODAL HELPERS ---

    function showRenameModal(ws) {
        if(!renameModal) return;
        renameIdField.value = ws.id;
        renameInput.value = ws.name;
        renameModal.show();
        setTimeout(() => renameInput.focus(), 500);
    }

    function performRename(id, newName) {
        modifyWorkspace(id, (ws) => {
            ws.name = newName;
        });
    }

    function showConfirmModal(msg, actionCallback) {
        if(!confirmModal) {
            console.error("Workspace Confirm Modal missing from DOM.");
            return;
        }
        
        confirmMsg.innerText = msg;
        const newBtn = confirmActionBtn.cloneNode(true);
        confirmActionBtn.parentNode.replaceChild(newBtn, confirmActionBtn);
        
        newBtn.addEventListener('click', () => {
            actionCallback();
            confirmModal.hide();
        });
        
        confirmModal.show();
    }

    // --- DB HELPERS ---

    async function updateWorkspace(id) {
        const allTabs = await chrome.tabs.query({ currentWindow: true, pinned: false });
        
        // 🟢 Apply the URL Blocker here
        const validTabs = allTabs.filter(t => isAllowedUrl(t.url));

        if (validTabs.length === 0) {
            showWsAlert('Update Thwarted', 'There are no valid external tabs available to perform this overwrite.', 'error');
            return;
        }

        const newTabsData = validTabs.map(t => ({ 
            url: t.url, 
            title: t.title, 
            favIconUrl: t.favIconUrl || '' 
        }));
        
        modifyWorkspace(id, (ws) => {
            ws.tabs = newTabsData;
            ws.lastUpdated = new Date().toISOString();
        });
        
        showWsAlert('Updated', 'Workspace overwritten with current tabs.', 'success');
    }

    function deleteWorkspace(id) {
        modifyWorkspace(null, (workspaces) => {
            return workspaces.filter(w => w.id !== id);
        });
    }

    function modifyWorkspace(wsId, callback, postAction) {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
            let workspaces = result[STORAGE_KEY] || [];
            
            if (wsId) {
                const index = workspaces.findIndex(w => w.id === wsId);
                if (index !== -1) {
                    callback(workspaces[index]);
                }
            } else {
                workspaces = callback(workspaces);
            }

            chrome.storage.local.set({ [STORAGE_KEY]: workspaces }, () => {
                refreshAll();
                if (postAction) postAction();
            });
        });
    }
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'workspaceSection') initWorkspace();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('newWsName')) initWorkspace();
});