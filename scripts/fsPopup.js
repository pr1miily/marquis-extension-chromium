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

            const BLOCKED = ['chrome://', 'chrome-extension://', 'moz-extension://', 'edge://', 'about:', 'data:'];
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
        if (type === 'full') fullStatus.start();
        try {
            const res = await pending;
            if (type === 'full') fullStatus.end(res);
            else if (res && !res.ok) showError(res.error);
        } catch {
            // The popup lost its channel (e.g. it closed when preview.html opened): nothing to report.
        } finally {
            captureInProgress = false;
            setSpinner(btnId, false);
        }
    }

    /* Full-page progress in #fpStatusContainer: background.js broadcasts { action: 'captureProgress', state,
     * text, done, total }; Cancel (also Esc / Cancel on the page itself) sends { action: 'captureCancel' }. */
    const fullStatus = (() => {
        let box = null, listening = false;
        const onProgress = (msg) => {
            if (msg?.action !== 'captureProgress' || !box) return;
            box.querySelector('.fp-text').textContent = msg.text;
            const pct = msg.total ? Math.round(msg.done / msg.total * 100) : (/STITCHING|EXPORTING|COMPLETED/.test(msg.state) ? 100 : 0);
            box.querySelector('.progress-bar').style.width = pct + '%';
            box.querySelector('.progress').setAttribute('aria-valuenow', String(pct));
        };
        return {
            start() {
                const host = document.getElementById('fpStatusContainer');
                if (!host) return;
                if (!listening) { chrome.runtime.onMessage.addListener(onProgress); listening = true; }
                host.innerHTML = `<div class="d-flex align-items-center gap-2 p-2 border rounded-3 bg-body" role="status">
                    <div class="flex-grow-1" style="min-width: 0;">
                        <div class="small fw-bold text-truncate fp-text">Starting full-page capture...</div>
                        <div class="progress mt-1" style="height: 6px;" role="progressbar" aria-label="Full-page capture progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                            <div class="progress-bar" style="width: 0%;"></div>
                        </div>
                    </div>
                    <button type="button" class="btn btn-sm btn-outline-secondary fp-cancel">Cancel</button>
                </div>`;
                box = host.firstElementChild;
                box.querySelector('.fp-cancel').addEventListener('click', (e) => {
                    e.currentTarget.disabled = true;
                    chrome.runtime.sendMessage({ action: 'captureCancel' }).catch(() => {});
                });
            },
            end(res) {
                const host = document.getElementById('fpStatusContainer');
                box = null;
                if (!host) return;
                host.textContent = '';
                if (res && !res.ok && res.state !== 'CANCELLED') { showError(res.error); return; }
                const lines = res && !res.ok ? [res.error] : (res?.notes || []);
                if (!lines.length) return;
                const note = document.createElement('div');
                note.className = 'small text-muted p-2 border rounded-3 bg-body';
                lines.forEach((t) => { const p = document.createElement('div'); p.textContent = t; note.appendChild(p); });
                host.appendChild(note);
            },
        };
    })();

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