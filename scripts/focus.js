function initFocus() {

    const display = document.getElementById('focusTimerDisplay');
    const statusText = document.getElementById('focusStatusText');
    const character = document.getElementById('focusCharacter');
    const startBtn = document.getElementById('btnFocusStart');

    // ✅ FIX: Guard the entire module — if the focus section isn't in this popup view, exit cleanly
    if (!display || !startBtn) return;

    // The timer lives in storage (scripts/focus_timer.js). This view shows it and writes start / pause /
    // reset; background.js ends the session, notifies and blocks sites, also while the popup is closed.
    let state = null;      // focusState, mirrored from storage
    let mode = 'focus';
    let finished = false;  // the last session ran out (rather than being reset)
    let ticker = null;
    let checked = false;   // focusCheck already sent for this session's 00:00

    let blockedSites = FocusTimer.DEFAULT_SITES.slice();

    // [status text, Bootstrap icon for the character above it]
    const IDLE_LOOK = {
        focus: ["Ready to Focus?", "bi-emoji-smile"],
        short: ["Short Break", "bi-cup-hot"],
        long: ["Long Break", "bi-stars"]
    };
    const setFace = (icon) => { character.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`; };

    // --- INITIALIZATION ---
    chrome.storage.local.get(['focusState', 'focusBlockedSites'], (res) => {
        if (res.focusBlockedSites) blockedSites = res.focusBlockedSites;
        renderBlockList();
        applyState(res.focusState || null);
    });

    // The dock and the background worker change the same state while the popup is open.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.focusState) {
            const old = changes.focusState.oldValue;
            finished = !changes.focusState.newValue && !!old && old.isRunning && FocusTimer.secondsLeft(old) <= 1;
            applyState(changes.focusState.newValue || null);
        }
        if (changes.focusBlockedSites) {
            blockedSites = changes.focusBlockedSites.newValue || FocusTimer.DEFAULT_SITES.slice();
            renderBlockList();
        }
    });

    function applyState(next) {
        state = next;
        if (state) { mode = state.mode || 'focus'; finished = false; }
        checked = false;
        clearInterval(ticker);
        if (state && state.isRunning) ticker = setInterval(render, 1000);
        render();
    }

    // --- TIMER DISPLAY ---
    function render() {
        const running = !!(state && state.isRunning);
        const left = state ? FocusTimer.secondsLeft(state) : FocusTimer.length(mode);
        display.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
        display.classList.toggle('text-body', mode === 'focus');    // ✅ FIX: Theme-adaptive
        display.classList.toggle('text-success', mode !== 'focus');

        if (running) {
            startBtn.textContent = "PAUSE";
            startBtn.className = 'btn btn-warning px-4 fw-bold rounded-pill shadow border-0'; // Warning color for pause
            setFace(mode === 'focus' ? "bi-laptop" : "bi-wind");
            statusText.textContent = mode === 'focus' ? "Focusing..." : "Recharging...";
            if (left === 0 && !checked) {
                checked = true; // end it now instead of waiting for the background alarm
                chrome.runtime.sendMessage({ action: 'focusCheck' }).catch(() => {});
            }
            return;
        }

        startBtn.textContent = "START FOCUS";
        startBtn.className = 'btn glass-primary px-4 fw-bold rounded-pill shadow border-0'; // Reset to glass blue
        const [text, face] = finished ? ["Finished!", "bi-trophy"] : state ? ["Paused", "bi-pause-circle"] : (IDLE_LOOK[mode] || IDLE_LOOK.focus);
        statusText.textContent = text;
        setFace(face);
    }

    function setMode(next) {
        mode = next;
        finished = false;
        if (state) FocusTimer.reset(); // the storage change re-renders
        else render();
    }

    // --- BUTTON LISTENERS ---
    startBtn.addEventListener('click', () => {
        const left = state ? FocusTimer.secondsLeft(state) : FocusTimer.length(mode);
        if (state && state.isRunning) FocusTimer.pause(mode, left);
        else FocusTimer.start(mode, left > 0 ? left : FocusTimer.length(mode));
    });
    document.getElementById('btnFocusReset')?.addEventListener('click', () => setMode(mode));
    document.getElementById('btnFocusShort')?.addEventListener('click', () => setMode('short'));
    document.getElementById('btnFocusLong')?.addEventListener('click', () => setMode('long'));
    document.getElementById('btnAddBlockSite')?.addEventListener('click', () => {
        const input = document.getElementById('newBlockSite');
        const val = input.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
        // Same rule the blocker uses: an entry it cannot turn into a host match is refused here.
        if (!FocusTimer.siteRegex(val)) {
            input.classList.add('is-invalid');
            return;
        }
        input.classList.remove('is-invalid');
        if (!blockedSites.includes(val)) {
            blockedSites.push(val);
            saveBlockList();
        }
        input.value = "";
    });

    // --- BLOCKER LIST ---
    function renderBlockList() {
        const list = document.getElementById('blockedSiteList');
        list.innerHTML = "";
        blockedSites.forEach(site => {
            const li = document.createElement('li');
            // 🟢 UPDATED: Use 'glass' class and remove default 'list-group-item' background
            li.className = "list-group-item d-flex justify-content-between align-items-center border-secondary-subtle mb-1 rounded text-body bg-body-tertiary";

            li.innerHTML = `
                <span class="text-truncate"></span>
                <button type="button" class="btn btn-sm text-danger p-0 border-0 ms-2" title="Remove">
                    <i class="bi bi-x-lg" aria-hidden="true"></i>
                </button>
            `;
            li.querySelector('span').textContent = site;
            const removeBtn = li.querySelector('button');
            removeBtn.setAttribute('aria-label', `Remove ${site} from the block list`);
            removeBtn.addEventListener('click', () => {
                blockedSites = blockedSites.filter(s => s !== site);
                saveBlockList();
            });
            list.appendChild(li);
        });
    }

    function saveBlockList() {
        chrome.storage.local.set({ focusBlockedSites: blockedSites });
        renderBlockList();
    }
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'focusSection') initFocus();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('focusTimerDisplay')) initFocus();
});
