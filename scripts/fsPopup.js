/**
 * fsPopup.js — Marquis Screen Capture & Video Recorder
 */

(function () {
    'use strict';

    /* ─────────────────────────────────────────
     * BOOT
     * ───────────────────────────────────────── */
    document.addEventListener('marquis:sectionReady', (e) => {
        if (e.detail.sectionId === 'fpSection') {
            init();
        }
    });

    function init() {
        loadTabs();

        // Bind Screenshot Buttons
        bindBtn('btnCaptureVisible', () => runCapture('visible'));
        bindBtn('btnCaptureFull',    () => runCapture('full'));
        bindBtn('btnCaptureRegion',  () => runCapture('region'));
        bindBtn('btnCaptureHistory', () => chrome.tabs.create({ url: chrome.runtime.getURL('preview.html') }));
        bindBtn('refreshTabsBtn',    loadTabs);

        // Bind Video Recording Button
        bindBtn('btnStartScreenity', startRecording);
    }

    function bindBtn(id, handler) {
        const btn = document.getElementById(id);
        if (!btn || btn.dataset.fsbound) return;
        btn.dataset.fsbound = '1';
        btn.addEventListener('click', handler);
    }

    /* ─────────────────────────────────────────
     * TAB LOADER
     * ───────────────────────────────────────── */
    async function loadTabs() {
        const selector = document.getElementById('tabSelector');
        if (!selector) return;

        try {
            const tabs = await chrome.tabs.query({});
            selector.innerHTML = '';

            const BLOCKED = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'data:'];
            tabs.forEach(tab => {
                if (!tab.url || BLOCKED.some(p => tab.url.startsWith(p))) return;
                const opt       = document.createElement('option');
                opt.value       = tab.id;
                opt.textContent = (tab.title || tab.url).slice(0, 70);
                selector.appendChild(opt);
            });

            const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (active && selector.querySelector(`option[value="${active.id}"]`)) {
                selector.value = active.id;
            }
        } catch (err) {
            console.warn('[Marquis fsPopup] loadTabs error:', err);
        }
    }

    function getSelectedTabId() {
        const sel = document.getElementById('tabSelector');
        return sel && sel.value ? parseInt(sel.value, 10) : null;
    }

    /* ─────────────────────────────────────────
     * IMAGE CAPTURE ENGINE
     * ───────────────────────────────────────── */
    let captureInProgress = false;

    const CAPTURE_BUTTONS = { visible: 'btnCaptureVisible', full: 'btnCaptureFull', region: 'btnCaptureRegion' };

    // background.js answers { ok, id } | { ok: false, error } once the capture is saved and preview.html is open.
    async function runCapture(type) {
        if (captureInProgress) return;

        const tabId = getSelectedTabId();
        if (!tabId) { showError('No tab selected. Please choose a tab first.'); return; }

        captureInProgress = true;
        const btnId = CAPTURE_BUTTONS[type];
        setSpinner(btnId, true);

        const pending = chrome.runtime.sendMessage({ action: 'capture', type, tabId });
        if (type === 'region') {
            // The user drags on the page itself; the popup would sit on top of it.
            setTimeout(() => window.close(), 150);
            return;
        }
        try {
            const res = await pending;
            if (res && !res.ok) showError(res.error);
        } catch {
            // The popup lost its channel (e.g. it closed when preview.html opened): nothing to report.
        } finally {
            captureInProgress = false;
            setSpinner(btnId, false);
        }
    }

    function setSpinner(btnId, show) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.disabled = show;
        const overlay = btn.querySelector('.spinner-overlay');
        if (overlay) overlay.classList.toggle('d-none', !show);
    }

    /* ─────────────────────────────────────────
     * VIDEO RECORDING: opens Marquis' recorder window (recorder.html), which owns the
     * streams and the recording state machine. Nothing is injected into the website.
     * ───────────────────────────────────────── */
    async function startRecording() {
        const options = {
            mic:  document.getElementById('recMicToggle')?.checked || false,
            cam:  document.getElementById('recCamToggle')?.checked || false,
            draw: document.getElementById('recDrawToggle')?.checked || false,
            mode: 'screen'
        };
        try {
            const res = await chrome.runtime.sendMessage({ action: 'openRecorder', tabId: getSelectedTabId(), options });
            if (res && !res.ok) { showError(res.error); return; }
            window.close();
        } catch (err) {
            showError('Could not open the recorder: ' + (err.message || err));
        }
    }

    function showError(msg) {
        // The popup always defines showGlobalAlert (script.js); no blocking native alert() as a fallback.
        if (window.showGlobalAlert) showGlobalAlert('Capture Error', msg, 'error');
        else console.error('[Marquis] Capture error:', msg);
    }

})();