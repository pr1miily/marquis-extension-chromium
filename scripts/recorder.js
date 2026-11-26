// ============================================================
// MARQUIS — recorder.js: the screen / camera recorder.
// Runs in its own extension window, so camera and mic prompts belong to Marquis (not the recorded site),
// nothing with a media stream is injected into web pages, and navigating a tab can't end a recording.
//
// State machine (TRANSITIONS below is the single source of truth):
//   IDLE -> SOURCE_SELECTION -> READY (countdown) -> STARTING -> RECORDING <-> PAUSED -> STOPPING -> PROCESSING -> COMPLETED
//   live states -> FAILED; READY / RECORDING / PAUSED -> ABORTED (discard). cleanup() runs on every exit path.
// MediaRecorder writes a 1 s slice to IndexedDB (RecordingStore chunks) as it goes, so RAM stays flat and a
// closed window or crash leaves a session that is offered for recovery on the next open.
// ============================================================

const $ = (id) => document.getElementById(id);

// COMPLETED also means "viewing a saved recording", so it is reachable from the resting states.
const TRANSITIONS = {
    IDLE: ['SOURCE_SELECTION', 'COMPLETED'],
    SOURCE_SELECTION: ['READY', 'IDLE', 'FAILED'],
    READY: ['STARTING', 'ABORTED', 'FAILED'],
    STARTING: ['RECORDING', 'FAILED'],
    RECORDING: ['PAUSED', 'STOPPING', 'ABORTED', 'FAILED'],
    PAUSED: ['RECORDING', 'STOPPING', 'ABORTED', 'FAILED'],
    STOPPING: ['PROCESSING', 'FAILED'],
    PROCESSING: ['COMPLETED', 'FAILED'],
    COMPLETED: ['IDLE', 'SOURCE_SELECTION'],
    FAILED: ['IDLE', 'SOURCE_SELECTION', 'COMPLETED'],
    ABORTED: ['IDLE', 'SOURCE_SELECTION', 'COMPLETED']
};
const LIVE = ['READY', 'STARTING', 'RECORDING', 'PAUSED', 'STOPPING', 'PROCESSING'];
const STATE_LABEL = {
    IDLE: 'Ready', SOURCE_SELECTION: 'Choosing source', READY: 'Get ready', STARTING: 'Starting',
    RECORDING: 'Recording', PAUSED: 'Paused', STOPPING: 'Saving', PROCESSING: 'Saving',
    COMPLETED: 'Saved', FAILED: 'Failed', ABORTED: 'Discarded'
};
const STATE_BADGE_CLASS = { RECORDING: 'text-bg-danger', PAUSED: 'text-bg-warning', COMPLETED: 'text-bg-success', FAILED: 'text-bg-danger' };
const QUALITY = { standard: { fps: 30, bps: 5_000_000 }, high: { fps: 60, bps: 10_000_000 } };
const FORMATS = [
    { id: 'webm', label: 'WebM', mime: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'] },
    { id: 'mp4', label: 'MP4', mime: ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'] }
];
const DEFAULT_SETTINGS = { source: 'screen', mic: true, cam: false, draw: false, countdown: true, quality: 'standard', format: 'webm' };

const params = new URLSearchParams(location.search);
const targetTabId = Number(params.get('tab')) || null;

let state = 'IDLE';
let session = null; // the live recording; see start()
let settings = { ...DEFAULT_SETTINGS };
let resultUrl = null;

// ── State ─────────────────────────────────────────────────────
function transition(to) {
    if (!TRANSITIONS[state].includes(to)) {
        console.warn(`[Recorder] ignored ${state} -> ${to}`);
        return false;
    }
    state = to;
    render();
    return true;
}

function render() {
    const live = LIVE.includes(state);
    $('setupPanel').classList.toggle('d-none', live || state === 'COMPLETED');
    $('livePanel').classList.toggle('d-none', !live);
    $('resultPanel').classList.toggle('d-none', state !== 'COMPLETED');
    $('startBtn').disabled = state === 'SOURCE_SELECTION';

    const badge = $('stateBadge');
    badge.textContent = STATE_LABEL[state];
    badge.className = `badge rounded-pill ${STATE_BADGE_CLASS[state] || 'text-bg-secondary'}`;

    const canControl = state === 'RECORDING' || state === 'PAUSED';
    $('pauseBtn').disabled = !canControl;
    $('stopBtn').disabled = !canControl;
    $('discardBtn').disabled = !['READY', 'RECORDING', 'PAUSED'].includes(state);
    $('pauseBtn').querySelector('span').textContent = state === 'PAUSED' ? 'Resume' : 'Pause';
    $('pauseBtn').querySelector('i').className = `bi ${state === 'PAUSED' ? 'bi-play-fill' : 'bi-pause-fill'} me-1`;
    $('liveStatus').textContent = {
        READY: 'Recording starts after the countdown.', STARTING: 'Starting…',
        RECORDING: 'Recording. Use Stop & save when you are done.', PAUSED: 'Paused. Nothing is being recorded.',
        STOPPING: 'Finishing the file…', PROCESSING: 'Saving the recording…'
    }[state] || '';

    // Toolbar badge so the state is visible from any tab (the countdown sets its own digits).
    chrome.action.setBadgeBackgroundColor({ color: state === 'PAUSED' ? '#f59e0b' : '#ef4444' });
    if (state !== 'READY') chrome.action.setBadgeText({ text: { RECORDING: 'REC', PAUSED: 'II' }[state] || '' });
    renderTimer();
}

function elapsedMs() {
    if (!session) return 0;
    return session.elapsedBefore + (state === 'RECORDING' ? performance.now() - session.segmentStart : 0);
}

const formatDuration = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const formatSize = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

function renderTimer() {
    const t = formatDuration(elapsedMs());
    $('timer').textContent = t;
    document.title = state === 'RECORDING' ? `● ${t} · Marquis Recorder` : state === 'PAUSED' ? `II ${t} · Marquis Recorder` : 'Marquis Recorder';
}

function showError(msg) {
    $('errorBox').textContent = msg;
    $('errorBox').classList.toggle('d-none', !msg);
}

// ── Recording lifecycle ───────────────────────────────────────
// Without an audio track the type must not name an audio codec: Firefox's MediaRecorder then records nothing
// and never fires stop ('vp9,opus' -> 'vp9', 'avc1,mp4a.40.2' -> 'avc1').
const pickMime = (formatId, withAudio = true) => FORMATS.find(f => f.id === formatId)?.mime
    .map(m => withAudio ? m : m.replace(/,(opus|mp4a[.\d]*)/, ''))
    .find(m => MediaRecorder.isTypeSupported(m));

// Readable message for a getUserMedia / getDisplayMedia / MediaRecorder failure at `step`.
function describeError(err, step) {
    const what = { mic: 'microphone', camera: 'camera' }[step];
    if (what && err.name === 'NotAllowedError') return `Marquis isn't allowed to use your ${what}. Allow it from the icon in this window's address bar or in Chrome's site settings, or turn ${what === 'camera' ? 'the camera' : 'Microphone'} off.`;
    if (what && err.name === 'NotFoundError') return `No ${what} was found. Connect one or turn it off.`;
    if (what && err.name === 'NotReadableError') return `Your ${what} is in use by another app.`;
    return err.message || String(err);
}

async function start() {
    if (!transition('SOURCE_SELECTION')) return;
    showError('');
    session = { id: `rec-${Date.now()}`, streams: [], seq: 0, pending: new Set(), source: settings.source, elapsedBefore: 0, segmentStart: 0 };
    const s = session;
    const keep = (stream) => { s.streams.push(stream); return stream; };
    let step = 'mic';
    try {
        // Mic and camera first, so a denied permission fails before the share picker is shown.
        const mic = settings.mic ? keep(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })) : null;
        step = 'camera';
        const wantCam = settings.source === 'camera' || settings.cam;
        const cam = wantCam ? keep(await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } })) : null;
        step = 'screen';
        const q = QUALITY[settings.quality] || QUALITY.standard;
        const display = settings.source === 'screen' ? keep(await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: q.fps }, width: { max: 1920 }, height: { max: 1080 } },
            audio: true,
            selfBrowserSurface: 'exclude',
            systemAudio: 'include',
            surfaceSwitching: 'include'
        })) : null;
        if (s !== session) return; // discarded while a prompt was open
        step = 'recorder';

        s.videoTrack = (display || cam).getVideoTracks()[0];
        s.videoTrack.addEventListener('ended', onSourceEnded); // Chrome's "Stop sharing" bar, or a camera unplugged

        // One audio track: tab/system audio and mic are mixed only when both exist.
        const audioSources = [display, mic].filter(st => st && st.getAudioTracks().length);
        let audioTrack = null;
        if (audioSources.length === 1) {
            audioTrack = audioSources[0].getAudioTracks()[0];
        } else if (audioSources.length > 1) {
            s.audioCtx = new AudioContext();
            const dest = s.audioCtx.createMediaStreamDestination();
            audioSources.forEach(st => s.audioCtx.createMediaStreamSource(st).connect(dest));
            audioTrack = dest.stream.getAudioTracks()[0];
        }
        s.output = new MediaStream([s.videoTrack, ...(audioTrack ? [audioTrack] : [])]);
        s.mimeType = pickMime(settings.format, !!audioTrack) || pickMime('webm', !!audioTrack);
        if (!s.mimeType) throw new Error('This browser cannot record video.');
        s.quality = q;

        if (cam && settings.source === 'screen') {
            $('camPreview').srcObject = cam;
            $('camWrap').classList.remove('d-none');
        }
        if (settings.draw && settings.source === 'screen' && targetTabId) await injectDrawing(s);

        if (!transition('READY')) return;
        await countdown(s, settings.countdown ? 3 : 0);
        if (s === session && state === 'READY') beginRecording(s);
    } catch (err) {
        if (s !== session) return;
        if (step === 'screen' && err.name === 'NotAllowedError') { // share picker cancelled
            cleanup();
            transition('IDLE');
            return;
        }
        fail(describeError(err, step));
    }
}

function countdown(s, seconds) {
    return new Promise((resolve) => {
        if (!seconds) return resolve();
        const el = $('countdown');
        let left = seconds;
        const show = () => {
            el.textContent = left;
            chrome.action.setBadgeText({ text: String(left) });
        };
        el.classList.remove('d-none');
        show();
        s.endCountdown = () => { clearInterval(s.countdownTimer); el.classList.add('d-none'); resolve(); };
        s.countdownTimer = setInterval(() => {
            left--;
            if (left <= 0 || state !== 'READY') s.endCountdown();
            else show();
        }, 1000);
    });
}

function beginRecording(s) {
    transition('STARTING');
    try {
        s.recorder = new MediaRecorder(s.output, { mimeType: s.mimeType, videoBitsPerSecond: s.quality.bps, audioBitsPerSecond: 128000 });
    } catch (err) {
        fail(describeError(err, 'recorder'));
        return;
    }
    s.recorder.ondataavailable = (e) => {
        if (!e.data.size || s.discarded) return;
        const p = RecordingStore.putChunk({ session: s.id, seq: s.seq++, blob: e.data, mimeType: s.mimeType, startedAt: s.startedAt, source: s.source })
            .catch((err) => { s.chunkError = err; });
        s.pending.add(p);
        p.finally(() => s.pending.delete(p));
    };
    s.recorder.onstop = () => finalize(s);
    s.recorder.onerror = (e) => { if (s === session) fail(describeError(e.error || new Error('Recording failed.'), 'recorder')); };
    s.startedAt = Date.now();
    s.segmentStart = performance.now();
    s.recorder.start(1000);
    s.tickTimer = setInterval(renderTimer, 250);
    transition('RECORDING');
}

function togglePause() {
    const s = session;
    if (state === 'RECORDING') {
        s.recorder.pause();
        s.elapsedBefore += performance.now() - s.segmentStart;
        transition('PAUSED');
    } else if (state === 'PAUSED') {
        s.recorder.resume();
        s.segmentStart = performance.now();
        transition('RECORDING');
    }
}

function stop() {
    const s = session;
    if (state === 'RECORDING') s.elapsedBefore += performance.now() - s.segmentStart;
    if (!transition('STOPPING')) return;
    s.recorder.stop(); // final dataavailable, then onstop -> finalize
}

async function finalize(s) {
    if (s !== session || state !== 'STOPPING') return; // discard / failure also stop the recorder; only a real stop saves
    transition('PROCESSING');
    releaseMedia(s); // camera light and share bar off right away
    try {
        await Promise.all([...s.pending]);
        if (s.chunkError) throw s.chunkError;
        const id = await saveSession(s.id, { durationMs: Math.round(s.elapsedBefore), source: s.source });
        cleanup();
        const saved = await RecordingStore.get(id);
        await showResult(saved);
        transition('COMPLETED');
        renderHistory();
        notifyIfAway({ id: `recording_${id}`, level: 'success', title: 'Recording saved',
            message: `${formatDuration(saved?.durationMs || 0)} · ${formatSize(saved?.size || 0)}. Open the recorder to download it.` });
    } catch (err) {
        fail(`The recording could not be saved: ${err.message || err}. Its parts are kept; reopen the recorder to recover it.`);
    }
}

async function discard() {
    const s = session;
    if (!s || !transition('ABORTED')) return;
    s.discarded = true;
    if (s.recorder && s.recorder.state !== 'inactive') s.recorder.stop();
    cleanup();
    await Promise.all([...s.pending]);
    await RecordingStore.dropChunks(s.id);
}

function onSourceEnded() {
    if (state === 'RECORDING' || state === 'PAUSED') stop();
    else if (state === 'READY') discard();
}

// Marquis notification (background.js notify) when the user is not looking at this window, e.g. sharing ended
// from Chrome's "Stop sharing" bar while they work in another tab. In front, the window shows it already.
function notifyIfAway(event) {
    if (document.hasFocus()) return;
    chrome.runtime.sendMessage({ action: 'notify', event: { source: 'capture', ...event } }).catch(() => {});
}

function fail(message) {
    notifyIfAway({ level: 'error', title: 'Recording stopped', message });
    const s = session;
    if (s?.recorder && s.recorder.state !== 'inactive') {
        try { s.recorder.stop(); } catch { /* already stopping */ }
    }
    cleanup();
    transition('FAILED');
    showError(message);
    checkRecovery(); // anything already written can be recovered
}

function releaseMedia(s) {
    s.streams.forEach(st => st.getTracks().forEach(t => t.stop()));
    s.audioCtx?.close().catch(() => {});
    s.audioCtx = null;
}

// Every exit path: tracks, audio graph, timers, listeners, PiP, page overlay.
function cleanup() {
    const s = session;
    if (!s) return;
    session = null;
    clearInterval(s.tickTimer);
    s.endCountdown?.();
    s.videoTrack?.removeEventListener('ended', onSourceEnded);
    releaseMedia(s);
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    $('camPreview').srcObject = null;
    $('camWrap').classList.add('d-none');
    if (s.drawTabId) removeDrawing(s.drawTabId);
}

// Joins a session's chunks into one recording and deletes the chunks.
async function saveSession(sessionId, meta) {
    const chunks = await RecordingStore.chunks(sessionId);
    if (!chunks.length) throw new Error('nothing was recorded');
    const mimeType = chunks[0].mimeType;
    const blob = new Blob(chunks.map(c => c.blob), { type: mimeType.split(';')[0] });
    const id = await RecordingStore.add({
        createdAt: chunks[0].startedAt || Date.now(),
        source: meta.source || chunks[0].source || 'screen',
        durationMs: meta.durationMs ?? chunks.length * 1000,
        mimeType, size: blob.size, blob,
        ...(meta.recovered ? { recovered: true } : {})
    });
    await RecordingStore.dropChunks(sessionId);
    return id;
}

// ── Drawing overlay on the target tab (canvas only; no media) ──
async function injectDrawing(s) {
    try {
        await chrome.scripting.executeScript({ target: { tabId: targetTabId }, func: drawingOverlay });
        s.drawTabId = targetTabId;
    } catch {
        $('liveStatus').textContent = 'Drawing tools are not available on that page.';
    }
}

function removeDrawing(tabId) {
    chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            const host = document.getElementById('marquis-rec-draw');
            host?._marquisAbort?.();
            host?.remove();
        }
    }).catch(() => {}); // tab closed or navigated: nothing left to remove
}

// Injected into the page: a pen toolbar + full-viewport canvas in a closed shadow root.
function drawingOverlay() {
    if (document.getElementById('marquis-rec-draw')) return;
    const host = document.createElement('div');
    host.id = 'marquis-rec-draw';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
        canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 2147483646; pointer-events: none; cursor: crosshair; }
        .bar { position: fixed; left: 24px; bottom: 24px; z-index: 2147483647; display: flex; gap: 8px; align-items: center; padding: 6px 10px;
               border-radius: 999px; background: rgba(15, 23, 42, .92); color: #f8fafc; font: 600 13px system-ui, sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.35); }
        button { font: inherit; color: inherit; background: transparent; border: 1px solid rgba(255,255,255,.3); border-radius: 999px; padding: 4px 12px; cursor: pointer; }
        button[aria-pressed="true"] { background: #ef4444; border-color: #ef4444; }
        input { width: 28px; height: 28px; border: 0; padding: 0; background: transparent; cursor: pointer; }
    </style>
    <canvas></canvas>
    <div class="bar" role="toolbar" aria-label="Marquis drawing">
        <button type="button" data-a="draw" aria-pressed="false">Draw</button>
        <input type="color" value="#ff007a" aria-label="Pen color">
        <button type="button" data-a="clear">Clear</button>
    </div>`;
    const canvas = root.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const drawBtn = root.querySelector('[data-a="draw"]');
    const color = root.querySelector('input');
    const ac = new AbortController();
    host._marquisAbort = () => ac.abort();

    const fit = () => {
        canvas.width = innerWidth * devicePixelRatio;
        canvas.height = innerHeight * devicePixelRatio;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };
    let drawing = false, down = false;
    const setDrawing = (on) => {
        drawing = on;
        canvas.style.pointerEvents = on ? 'auto' : 'none';
        drawBtn.setAttribute('aria-pressed', String(on));
    };
    drawBtn.addEventListener('click', () => setDrawing(!drawing));
    color.addEventListener('input', () => setDrawing(true));
    root.querySelector('[data-a="clear"]').addEventListener('click', () => ctx.clearRect(0, 0, innerWidth, innerHeight));
    canvas.addEventListener('pointerdown', (e) => {
        down = true;
        Object.assign(ctx, { strokeStyle: color.value, lineWidth: 5, lineCap: 'round', lineJoin: 'round' });
        ctx.beginPath();
        ctx.moveTo(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointermove', (e) => { if (down) { ctx.lineTo(e.clientX, e.clientY); ctx.stroke(); } });
    ['pointerup', 'pointerleave'].forEach(t => canvas.addEventListener(t, () => { down = false; }));
    addEventListener('resize', fit, { signal: ac.signal });
    fit();
    document.documentElement.appendChild(host);
}

// ── Result + history ──────────────────────────────────────────
function fileName(rec) {
    const d = new Date(rec.createdAt);
    const p = (n) => String(n).padStart(2, '0');
    const ext = rec.mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    return `Marquis_Recording_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.${ext}`;
}

function download(rec) {
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName(rec);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const describe = (rec) => `${rec.source === 'camera' ? 'Camera' : 'Screen'} · ${formatDuration(rec.durationMs)} · ${formatSize(rec.size)} · ${new Date(rec.createdAt).toLocaleString()}${rec.recovered ? ' · recovered' : ''}`;

function showResult(rec) {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(rec.blob);
    $('resultVideo').src = resultUrl;
    $('resultMeta').textContent = describe(rec);
    $('downloadBtn').onclick = () => download(rec);
}

// Shows a saved recording without going through a live session.
function viewSaved(rec) {
    if (LIVE.includes(state)) return;
    showResult(rec);
    if (state === 'COMPLETED') render();
    else transition('COMPLETED');
}

async function renderHistory() {
    const recs = await RecordingStore.list();
    $('historyList').replaceChildren(...recs.map((rec) => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex align-items-center gap-2 px-3';
        const text = document.createElement('div');
        text.className = 'flex-grow-1';
        text.style.minWidth = '0';
        text.style.fontSize = 'var(--mq-fs-sm)';
        text.textContent = describe(rec);
        const btn = (icon, label, onClick) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn btn-sm btn-outline-secondary flex-shrink-0';
            b.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`;
            b.title = label;
            b.setAttribute('aria-label', label);
            b.addEventListener('click', onClick);
            return b;
        };
        const play = btn('bi-play-fill', 'Play', () => viewSaved(rec));
        const dl = btn('bi-download', 'Download', () => download(rec));
        // Two-step delete: the first click arms it for 3 s.
        const del = btn('bi-trash', 'Delete recording', async () => {
            if (!del.dataset.armed) {
                del.dataset.armed = '1';
                del.classList.replace('btn-outline-secondary', 'btn-danger');
                del.textContent = 'Delete?';
                setTimeout(() => { if (del.isConnected) renderHistory(); }, 3000);
                return;
            }
            await RecordingStore.remove(rec.id);
            renderHistory();
        });
        li.append(text, play, dl, del);
        return li;
    }));
    $('historyEmpty').classList.toggle('d-none', recs.length > 0);
}

// Chunks left from an interrupted session (window closed, crash, failed save).
async function checkRecovery() {
    const [orphan] = (await RecordingStore.interruptedSessions()).filter(o => o.session !== session?.id);
    $('recoverBanner').classList.toggle('d-none', !orphan);
    if (!orphan) return;
    $('recoverText').textContent = `${orphan.source === 'camera' ? 'Camera' : 'Screen'} recording from ${new Date(orphan.startedAt || Date.now()).toLocaleString()}, about ${formatDuration(orphan.count * 1000)} long.`;
    $('recoverBtn').onclick = async () => {
        try {
            const id = await saveSession(orphan.session, { recovered: true });
            viewSaved(await RecordingStore.get(id));
            renderHistory();
        } catch (err) {
            showError(`Recovery failed: ${err.message || err}`);
        }
        checkRecovery();
    };
    $('recoverDiscardBtn').onclick = async () => {
        await RecordingStore.dropChunks(orphan.session);
        checkRecovery();
    };
}

// ── Settings ──────────────────────────────────────────────────
function readControls() {
    settings = {
        source: $('srcCamera').checked ? 'camera' : 'screen',
        mic: $('optMic').checked,
        cam: $('optCam').checked,
        draw: $('optDraw').checked,
        countdown: $('optCountdown').checked,
        quality: $('optQuality').value,
        format: $('optFormat').value
    };
    chrome.storage.local.set({ recorderSettings: settings });
    applyControlState();
}

function applyControlState() {
    const camera = settings.source === 'camera';
    document.querySelectorAll('[data-screen-only] input').forEach(i => { i.disabled = camera; });
    if (!targetTabId) $('optDraw').disabled = true;
    $('setupHint').textContent = camera ? 'Chrome will ask for your camera.' : 'Chrome will ask what to share. Recording keeps going while you use other tabs.';
}

async function loadSettings() {
    const { recorderSettings } = await chrome.storage.local.get('recorderSettings');
    settings = { ...DEFAULT_SETTINGS, ...(recorderSettings || {}) };
    // Quick options passed by the popup or dock apply to this window.
    for (const k of ['mic', 'cam', 'draw']) if (params.has(k)) settings[k] = params.get(k) === '1';
    if (['screen', 'camera'].includes(params.get('mode'))) settings.source = params.get('mode');

    const supported = FORMATS.filter(f => pickMime(f.id));
    $('optFormat').replaceChildren(...supported.map(f => new Option(f.label, f.id)));
    if (!supported.some(f => f.id === settings.format)) settings.format = supported[0]?.id || 'webm';

    $(settings.source === 'camera' ? 'srcCamera' : 'srcScreen').checked = true;
    $('optMic').checked = settings.mic;
    $('optCam').checked = settings.cam;
    $('optDraw').checked = settings.draw && !!targetTabId;
    $('optCountdown').checked = settings.countdown;
    $('optQuality').value = settings.quality;
    $('optFormat').value = settings.format;
    applyControlState();
}

// ── Boot ──────────────────────────────────────────────────────
(async () => {
    $('startBtn').addEventListener('click', start);
    $('pauseBtn').addEventListener('click', togglePause);
    $('stopBtn').addEventListener('click', stop);
    $('discardBtn').addEventListener('click', discard);
    $('newBtn').addEventListener('click', () => { $('resultVideo').pause(); transition('IDLE'); });
    $('camPipBtn').addEventListener('click', async () => {
        try {
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
            else await $('camPreview').requestPictureInPicture();
        } catch (err) {
            $('liveStatus').textContent = `Camera pop-out failed: ${err.message}`;
        }
    });
    // Firefox before 153 has no Picture-in-Picture API: the button stays, off, and its label says why.
    if (!('requestPictureInPicture' in HTMLVideoElement.prototype)) {
        $('camPipBtn').disabled = true;
        $('camPipBtn').lastChild.textContent = 'Pop out camera (not supported in this browser)';
    }
    document.querySelectorAll('#setupPanel input, #setupPanel select').forEach(el => el.addEventListener('change', readControls));
    window.addEventListener('beforeunload', (e) => {
        if (LIVE.includes(state)) { e.preventDefault(); e.returnValue = ''; } // parts saved so far stay recoverable
    });

    try {
        await loadSettings();
        render();
        await Promise.all([renderHistory(), checkRecovery()]);
    } catch (err) {
        showError(`The recorder could not load its data: ${err.message || err}`);
    }
})();
