document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('commandCenterToggle');
    const icon = document.getElementById('commandCenterIcon');
    const dot = document.getElementById('commandCenterStatusDot');
    const lockIcon = document.getElementById('commandCenterLock');

    // 🟢 1. LICENSE VERIFICATION ENGINE (GUMROAD API)
    // forceRecheck: skip the cached 'valid' status and ask Gumroad again (offline still falls back to the cache).
    async function isLicenseValid(callback, forceRecheck = false) {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.get(['marquis_license', 'license_status'], async (res) => {
                const key = res.marquis_license ? res.marquis_license.trim() : '';

                // A. Basic format check (Gumroad keys are long)
                if (key.length < 20) {
                    setValidationUI(false);
                    return callback(false);
                }

                // B. Cache Check: Don't spam Gumroad's servers!
                if (res.license_status === 'valid' && !forceRecheck) {
                    setValidationUI(true);
                    return callback(true);
                }

                // C. Ping Gumroad to verify the key
                setValidationUI('loading'); // Show "Verifying..." in the UI
                try {
                    const response = await fetch('https://api.gumroad.com/v2/licenses/verify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            product_permalink: 'psqsv', 
                            license_key: key
                        })
                    });

                    const data = await response.json();

                    // D. Interpret Gumroad's response
                    if (data.success && !data.refunded && !data.disputed) {
                        chrome.storage.sync.set({ license_status: 'valid' });
                        setValidationUI(true);
                        callback(true);
                    } else {
                        chrome.storage.sync.remove('license_status');
                        setValidationUI(false);
                        callback(false);
                    }
                } catch (e) {
                    console.error("[The Marquis] License API Check Failed:", e);
                    const isCachedValid = res.license_status === 'valid';
                    setValidationUI(isCachedValid);
                    callback(isCachedValid);
                }
            });
        } else {
            callback(false);
        }
    }

    // 🟢 NEW: Visual UI Feedback for the Settings Hub
    function setValidationUI(isValid) {
        const syncStatusText = document.querySelector('#setAccountTab .lh-1 small');
        const syncStatusDot = document.querySelector('#setAccountTab .spinner-grow');

        if (lockIcon) {
            if (isValid === true) lockIcon.classList.add('d-none');
            else lockIcon.classList.remove('d-none');
        }

        // Update the Cloud Status box in the Settings modal
        if (syncStatusText && syncStatusDot) {
            if (isValid === 'loading') {
                syncStatusText.innerText = "VERIFYING KEY...";
                syncStatusText.className = "text-warning fw-bolder text-uppercase";
                syncStatusDot.className = "spinner-grow text-warning opacity-75";
            } else if (isValid === true) {
                syncStatusText.innerText = "PRO LICENSE ACTIVE";
                syncStatusText.className = "text-success fw-bolder text-uppercase";
                syncStatusDot.className = "spinner-grow text-success opacity-75";
                syncStatusDot.style.animationDuration = '3s';
            } else {
                syncStatusText.innerText = "UNLICENSED";
                syncStatusText.className = "text-danger fw-bolder text-uppercase";
                syncStatusDot.className = "spinner-grow text-danger opacity-75";
                syncStatusDot.style.animationDuration = '1s';
            }
        }
    }

    function updateNavbarIcon(enabled) {
        if (!icon || !toggleBtn || !dot) return;

        if (enabled) {
            icon.classList.replace('text-secondary', 'text-primary');
            icon.classList.add('animate__animated', 'animate__pulse', 'animate__infinite');
            dot.classList.remove('d-none');
            toggleBtn.title = "Marquis Command Center: Active";
        } else {
            icon.classList.replace('text-primary', 'text-secondary');
            icon.classList.remove('animate__animated', 'animate__pulse', 'animate__infinite');
            dot.classList.add('d-none');
            toggleBtn.title = "Marquis Command Center: Off";
        }
    }

    // 2. INITIALIZATION
    isLicenseValid((valid) => {
        if (valid) {
            chrome.storage.local.get(['dockEnabled'], (res) => {
                updateNavbarIcon(!!res.dockEnabled);
            });
        } else {
            chrome.storage.local.set({ dockEnabled: false });
            updateNavbarIcon(false);
        }
    });

    // 3. LIVE SYNC (Instantly unlocks the UI when they enter their key!)
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.marquis_license) {
            // 🟢 FIXED: Clear the cache so Gumroad is forced to check the new key!
            chrome.storage.sync.remove('license_status', () => {
                isLicenseValid(() => {});
            });
        }
        if (area === 'sync' && changes.marquis_theme) {
             chrome.storage.local.get(['dockEnabled'], (res) => {
                 if (res.dockEnabled && icon) {
                     icon.classList.remove('text-primary');
                     void icon.offsetWidth; 
                     icon.classList.add('text-primary');
                 }
             });
        }
    });

    // 4. CLICK TOGGLE LOGIC
    // ✅ FIX: Debounce guard — prevents rapid double-clicks from firing two concurrent toggles
    let isToggling = false;

    toggleBtn?.addEventListener('click', () => {
        if (isToggling) return;

        isLicenseValid((valid) => {
            if (!valid) {
                // UNLICENSED: Show Gumroad Modal
                if (typeof bootstrap !== 'undefined') {
                    const licModalEl = document.getElementById('licenseModal');
                    if (licModalEl) new bootstrap.Modal(licModalEl).show();
                }
                return;
            }

            // LICENSED: Proceed with toggle
            isToggling = true;

            chrome.storage.local.get(['dockEnabled'], async (res) => {
                const newState = !res.dockEnabled;

                // ✅ FIX: When disabling the dock, atomically clear activeMarquisWidget too.
                // Without this, a stale widget ID stays in storage and reopens the widget
                // the next time the dock is re-enabled on any tab — including brand-new ones.
                const storageUpdate = newState
                    ? { dockEnabled: true }
                    : { dockEnabled: false, activeMarquisWidget: null };

                // Open tabs react to dockEnabled themselves (dock_loader.js shows it, inject_dock.js hides it),
                // and the background worker adds the loader to tabs that lack it.
                chrome.storage.local.set(storageUpdate, () => {
                    updateNavbarIcon(newState);
                    isToggling = false;
                });
            });
        });
    });

    // 4b. FORCE SYNC (Settings > Account)
    // Chrome Sync uploads chrome.storage.sync on its own schedule; no API can force the upload.
    // This writes the current synced settings (theme, weather unit, license), reports real
    // errors (e.g. sync write quota), and re-verifies the license with Gumroad.
    const forceSyncBtn = document.getElementById('btnForceSync');

    // Status line under the license box: when this device last saved to Chrome Sync, and quota use.
    // (No extension API reports whether Chrome Sync itself is on, so the line does not claim it.)
    const SYNC_QUOTA = Number(chrome.storage.sync.QUOTA_BYTES) || 102400;
    async function renderSyncStatus() {
        const line = document.getElementById('syncStatusLine');
        if (!line) return;
        try {
            const [{ syncSavedAt }, used] = await Promise.all([
                chrome.storage.local.get('syncSavedAt'),
                chrome.storage.sync.getBytesInUse(null),
            ]);
            const quota = `${(used / 1024).toFixed(1)} of ${Math.round(SYNC_QUOTA / 1024)} KB used`;
            line.textContent = syncSavedAt
                ? `Last saved to Chrome Sync from this device: ${new Date(syncSavedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${quota}`
                : `Not saved to Chrome Sync from this device yet · ${quota}`;
        } catch (e) {
            line.textContent = `Chrome Sync storage unavailable: ${e.message}`;
        }
    }
    // Theme, weather unit and license writes made here (or arriving from another device while open).
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        chrome.storage.local.set({ syncSavedAt: Date.now() }).then(renderSyncStatus);
    });
    renderSyncStatus();

    forceSyncBtn?.addEventListener('click', async () => {
        const idleHtml = forceSyncBtn.innerHTML;
        forceSyncBtn.disabled = true;
        forceSyncBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span> Syncing…';

        let writeError = null;
        const key = document.getElementById('syncLicenseInput')?.value.trim();
        try {
            const settings = {
                marquis_theme: document.documentElement.getAttribute('data-marquis-theme') || 'default',
                wxUnit: document.getElementById('unitF')?.checked ? 'F' : 'C'
            };
            if (key) settings.marquis_license = key;
            await chrome.storage.sync.set(settings);
            // weather sections read the local copy; syncSavedAt feeds the status line (an unchanged value fires no onChanged)
            await chrome.storage.local.set({ wxUnit: settings.wxUnit, syncSavedAt: Date.now() });
            renderSyncStatus();
        } catch (e) {
            writeError = e;
        }

        isLicenseValid((valid) => {
            forceSyncBtn.disabled = false;
            forceSyncBtn.innerHTML = idleHtml;
            if (!window.showGlobalAlert) return;
            if (writeError) {
                window.showGlobalAlert('Sync Failed', `Chrome refused the write: ${writeError.message}`, 'error');
            } else {
                window.showGlobalAlert('Saved',
                    `Theme, weather unit${key ? ', and license key' : ''} saved to Chrome Sync; Chrome uploads them on its own schedule. License ${valid ? 'verified' : 'not active'}.`,
                    valid ? 'success' : 'warning');
            }
        }, true);
    });

    // 5. Smooth Modal Transition
    const btnHaveKey = document.getElementById('btnHaveKey');
    const licenseModalEl = document.getElementById('licenseModal');
    
    if (btnHaveKey && licenseModalEl && typeof bootstrap !== 'undefined') {
        btnHaveKey.addEventListener('click', () => {
            licenseModalEl.addEventListener('hidden.bs.modal', function openSettings() {
                licenseModalEl.removeEventListener('hidden.bs.modal', openSettings);
                
                const settingsModalEl = document.getElementById('settingsModal');
                if (!settingsModalEl) return; // ✅ FIX
                const settingsModal = new bootstrap.Modal(settingsModalEl);
                settingsModal.show();

                const accountTabBtn = document.querySelector('button[data-bs-target="#setAccountTab"]');
                if (accountTabBtn) {
                    const tab = new bootstrap.Tab(accountTabBtn);
                    tab.show();
                    
                    setTimeout(() => {
                        const input = document.getElementById('syncLicenseInput');
                        if(input) input.focus();
                    }, 500);
                }
            });
        });
    }
});