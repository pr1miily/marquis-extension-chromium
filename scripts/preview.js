// ============================================================
// MARQUIS — preview.js: capture viewer, annotation editor and history.
// Captures come from CaptureStore (IndexedDB), saved by background.js.
// Edits are a list of ops in base-image pixels; the canvas is the crop of base + ops.
// ============================================================

const $ = (id) => document.getElementById(id);
const canvas = $('editorCanvas');
const ctx = canvas.getContext('2d');
const stage = $('stage');
const draft = $('draftLayer');
const SVG = 'http://www.w3.org/2000/svg';

const state = { record: null, base: null, ops: [], tool: 'rect', color: '#ef4444' };
const TYPE_LABEL = { visible: 'Visible area', full: 'Full page', region: 'Region' };
let historyUrls = [];
let drag = null;

function showError(msg) {
    $('errorModalMsg').textContent = msg;
    bootstrap.Modal.getOrCreateInstance($('errorModal')).show();
    console.error('[MARQUIS Preview]', msg);
}

let statusTimer;
function showStatus(msg) {
    $('statusMsg').textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { $('statusMsg').textContent = ''; }, 3000);
}

// ── Geometry ──────────────────────────────────────────────────
function currentCrop() {
    for (let i = state.ops.length - 1; i >= 0; i--) if (state.ops[i].tool === 'crop') return state.ops[i];
    return { x: 0, y: 0, w: state.base.width, h: state.base.height };
}

// Screen point -> base-image pixels, clamped to the visible crop.
function toImage(e) {
    const r = canvas.getBoundingClientRect();
    const c = currentCrop();
    const k = canvas.width / r.width;
    return {
        x: c.x + Math.min(Math.max((e.clientX - r.left) * k, 0), c.w),
        y: c.y + Math.min(Math.max((e.clientY - r.top) * k, 0), c.h)
    };
}

const screenToImage = () => canvas.width / canvas.getBoundingClientRect().width; // image px per CSS px
const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });

// ── Rendering ─────────────────────────────────────────────────
function drawOp(op) {
    const c = currentCrop();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, -c.x, -c.y);
    ctx.strokeStyle = ctx.fillStyle = op.color;
    ctx.lineWidth = op.width;
    ctx.lineCap = ctx.lineJoin = 'round';
    if (op.tool === 'rect') {
        ctx.strokeRect(op.x, op.y, op.w, op.h);
    } else if (op.tool === 'arrow') {
        const ang = Math.atan2(op.y2 - op.y1, op.x2 - op.x1), head = op.width * 4;
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(op.x2, op.y2);
        ctx.lineTo(op.x2 - head * Math.cos(ang - 0.45), op.y2 - head * Math.sin(ang - 0.45));
        ctx.lineTo(op.x2 - head * Math.cos(ang + 0.45), op.y2 - head * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
    } else if (op.tool === 'pen') {
        ctx.beginPath();
        op.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
    } else if (op.tool === 'text') {
        ctx.font = `700 ${op.size}px system-ui, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(op.text, op.x, op.y);
    } else if (op.tool === 'blur') {
        // Coarse pixelation (blocks >= 16 image px) so small text cannot be read back.
        const block = Math.max(16, Math.round(Math.min(op.w, op.h) / 4));
        const tw = Math.max(1, Math.round(op.w / block)), th = Math.max(1, Math.round(op.h / block));
        const tmp = new OffscreenCanvas(tw, th);
        tmp.getContext('2d').drawImage(canvas, op.x - c.x, op.y - c.y, op.w, op.h, 0, 0, tw, th); // source rect ignores the transform
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, tw, th, op.x, op.y, op.w, op.h);
    }
    ctx.restore();
}

function render() {
    const c = currentCrop();
    canvas.width = c.w;
    canvas.height = c.h;
    ctx.drawImage(state.base, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
    state.ops.forEach(op => { if (op.tool !== 'crop') drawOp(op); });
    fitCanvas();
    draft.setAttribute('viewBox', `${c.x} ${c.y} ${c.w} ${c.h}`);
}

// Display size only: device pixels shown at 1:1 CSS px, never wider than the stage.
function fitCanvas() {
    canvas.style.width = Math.min(canvas.width / devicePixelRatio, $('stageScroll').clientWidth - 32) + 'px';
}

function commit(op) {
    state.ops.push(op);
    if (op.tool === 'crop') render();
    else drawOp(op);
}

function undo() {
    if (!state.ops.length) return;
    state.ops.pop();
    render();
}

// ── Pointer tools (in-progress shapes are drawn as SVG in image coordinates) ──
function drawDraft(d, p) {
    const k = screenToImage();
    const r = rectOf(d.start, p);
    draft.replaceChildren();
    let el;
    if (d.tool === 'arrow') {
        el = document.createElementNS(SVG, 'line');
        Object.entries({ x1: d.start.x, y1: d.start.y, x2: p.x, y2: p.y }).forEach(([a, v]) => el.setAttribute(a, v));
    } else if (d.tool === 'pen') {
        el = document.createElementNS(SVG, 'polyline');
        el.setAttribute('points', d.points.map(q => `${q.x},${q.y}`).join(' '));
        el.setAttribute('fill', 'none');
    } else {
        el = document.createElementNS(SVG, 'rect');
        Object.entries(r).forEach(([a, v]) => el.setAttribute(a === 'w' ? 'width' : a === 'h' ? 'height' : a, v));
        el.setAttribute('fill', d.tool === 'blur' ? 'rgba(148,163,184,.35)' : 'none');
        if (d.tool === 'crop') el.setAttribute('stroke-dasharray', `${6 * k} ${4 * k}`);
    }
    el.setAttribute('stroke', d.tool === 'crop' || d.tool === 'blur' ? '#f8fafc' : state.color);
    el.setAttribute('stroke-width', (d.tool === 'crop' || d.tool === 'blur' ? 1.5 : 3) * k);
    el.setAttribute('stroke-linecap', 'round');
    draft.appendChild(el);
}

function finishDrag(d, p) {
    const width = Math.max(2, 3 * screenToImage());
    const r = rectOf(d.start, p);
    if (d.tool === 'pen') return d.points.length > 1 ? { tool: 'pen', points: d.points, color: state.color, width } : null;
    if (d.tool === 'arrow') return Math.hypot(p.x - d.start.x, p.y - d.start.y) > 4 ? { tool: 'arrow', x1: d.start.x, y1: d.start.y, x2: p.x, y2: p.y, color: state.color, width } : null;
    if (r.w < 4 || r.h < 4) return null;
    const rounded = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
    if (d.tool === 'crop') return { tool: 'crop', ...rounded };
    if (d.tool === 'blur') return { tool: 'blur', ...rounded };
    return { tool: 'rect', ...r, color: state.color, width };
}

stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !state.base || e.target.id === 'textEntry') return;
    const p = toImage(e);
    if (state.tool === 'text') { openTextEntry(e, p); return; }
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    drag = { tool: state.tool, start: p, points: [p] };
});
stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toImage(e);
    if (drag.tool === 'pen') drag.points.push(p);
    drawDraft(drag, p);
});
stage.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const op = finishDrag(drag, toImage(e));
    drag = null;
    draft.replaceChildren();
    if (op) commit(op);
});
stage.addEventListener('pointercancel', () => { drag = null; draft.replaceChildren(); });

function openTextEntry(e, p) {
    $('textEntry')?.remove();
    const input = document.createElement('input');
    input.id = 'textEntry';
    input.className = 'form-control form-control-sm';
    input.placeholder = 'Type, then Enter';
    input.setAttribute('aria-label', 'Annotation text');
    const sr = stage.getBoundingClientRect();
    input.style.left = (e.clientX - sr.left) + 'px';
    input.style.top = (e.clientY - sr.top) + 'px';
    input.style.color = state.color;
    stage.appendChild(input);
    let closed = false;
    const close = (keep) => {
        if (closed) return;
        closed = true;
        const text = input.value.trim();
        input.remove();
        if (keep && text) commit({ tool: 'text', x: p.x, y: p.y, text, color: state.color, size: Math.round(20 * screenToImage()) });
    };
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') close(true);
        if (ev.key === 'Escape') close(false);
        ev.stopPropagation();
    });
    input.addEventListener('blur', () => close(true));
    setTimeout(() => input.focus(), 0);
}

function setTool(tool) {
    stage.classList.remove(`tool-${state.tool}`);
    state.tool = tool;
    stage.classList.add(`tool-${tool}`);
    document.querySelectorAll('[data-tool]').forEach(b => {
        const on = b.dataset.tool === tool;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    });
}

// ── Export ────────────────────────────────────────────────────
const canvasBlob = (type, quality) => new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('The image is too large to export.'))), type, quality));

function fileStem() {
    const d = new Date(state.record.createdAt);
    const pad = (n) => String(n).padStart(2, '0');
    const part = state.record.parts > 1 ? `_part${pad(state.record.part)}of${pad(state.record.parts)}` : ''; // split full-page captures
    return `Marquis_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}${part}`;
}

function saveBlob(blob, ext) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileStem()}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Runs an export action with the button disabled; any failure lands in the error modal.
function action(btnId, fn) {
    $(btnId).addEventListener('click', async () => {
        if (!state.base) return;
        const btn = $(btnId);
        btn.disabled = true;
        try { await fn(); } catch (err) { showError(err.message || String(err)); } finally { btn.disabled = false; }
    });
}

action('copyBtn', async () => {
    const blob = await canvasBlob('image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showStatus('Copied to clipboard.');
});
action('downloadPngBtn', async () => { saveBlob(await canvasBlob('image/png'), 'png'); showStatus('PNG saved.'); });
action('downloadJpgBtn', async () => { saveBlob(await canvasBlob('image/jpeg', 0.92), 'jpg'); showStatus('JPG saved.'); });
action('downloadPdfBtn', async () => {
    if (!window.jspdf) {
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'scripts/jspdf.umd.min.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('The PDF library failed to load.'));
            document.head.appendChild(s);
        });
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'pt', 'a4');
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
    const imgH = canvas.height / (canvas.width / pdfW);
    const src = canvas.toDataURL('image/jpeg', 0.85);
    // One tall image, shifted up one page height per page.
    for (let top = 0; top < imgH; top += pdfH) {
        if (top) pdf.addPage();
        pdf.addImage(src, 'JPEG', 0, -top, pdfW, imgH);
    }
    pdf.save(`${fileStem()}.pdf`);
    showStatus('PDF saved.');
});

// ── Capture + history ─────────────────────────────────────────
function describe(r) {
    let host = '';
    try { host = new URL(r.url).hostname; } catch { /* keep empty */ }
    return `${TYPE_LABEL[r.type] || 'Capture'} · ${r.width} × ${r.height} · ${new Date(r.createdAt).toLocaleString()}${host ? ' · ' + host : ''}`;
}

async function openCapture(record) {
    state.record = record;
    state.ops = [];
    state.base?.close();
    state.base = record ? await createImageBitmap(record.blob) : null;
    $('emptyState').classList.toggle('d-none', !!record);
    stage.classList.toggle('d-none', !record);
    document.querySelectorAll('#copyBtn, #downloadPngBtn, #downloadJpgBtn, #downloadPdfBtn, #undoBtn').forEach(b => { b.disabled = !record; });
    $('captureMeta').textContent = record ? describe(record) : 'No capture selected.';
    if (record) {
        render();
        history.replaceState(null, '', `?id=${record.id}`);
    }
    document.querySelectorAll('.history-item').forEach(li => li.classList.toggle('active', Number(li.dataset.id) === record?.id));
}

async function renderHistory() {
    historyUrls.forEach(u => URL.revokeObjectURL(u));
    historyUrls = [];
    const records = await CaptureStore.list();
    const items = records.map((r) => {
        const li = document.createElement('li');
        li.className = 'list-group-item history-item d-flex align-items-center gap-2 px-2';
        li.dataset.id = r.id;
        li.classList.toggle('active', r.id === state.record?.id);

        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'btn btn-link text-start text-decoration-none text-body p-0 d-flex align-items-center gap-2 flex-grow-1 min-w-0';
        const img = document.createElement('img');
        img.alt = '';
        img.className = 'rounded border border-secondary-subtle flex-shrink-0';
        const url = URL.createObjectURL(r.thumb || r.blob);
        historyUrls.push(url);
        img.src = url;
        const text = document.createElement('span');
        text.className = 'd-flex flex-column min-w-0';
        const t1 = document.createElement('span');
        t1.className = 'fw-bold text-truncate';
        t1.style.fontSize = 'var(--mq-fs-sm)';
        t1.textContent = r.title || TYPE_LABEL[r.type] || 'Capture';
        const t2 = document.createElement('span');
        t2.className = 'text-secondary text-truncate';
        t2.style.fontSize = 'var(--mq-fs-xs)';
        t2.textContent = `${TYPE_LABEL[r.type] || 'Capture'} · ${new Date(r.createdAt).toLocaleString()}`;
        text.append(t1, t2);
        open.append(img, text);
        open.addEventListener('click', () => openCapture(r).catch(err => showError(err.message)));

        // Two-step delete: the first click arms the button for 3 s.
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn-sm btn-outline-secondary flex-shrink-0';
        del.innerHTML = '<i class="bi bi-trash" aria-hidden="true"></i>';
        del.title = 'Delete capture';
        del.setAttribute('aria-label', 'Delete capture');
        let armed = null;
        del.addEventListener('click', async () => {
            if (!armed) {
                del.classList.replace('btn-outline-secondary', 'btn-danger');
                del.textContent = 'Delete?';
                armed = setTimeout(() => { armed = null; del.classList.replace('btn-danger', 'btn-outline-secondary'); del.innerHTML = '<i class="bi bi-trash" aria-hidden="true"></i>'; }, 3000);
                return;
            }
            clearTimeout(armed);
            await CaptureStore.remove(r.id);
            if (state.record?.id === r.id) await openCapture(await CaptureStore.latest());
            await renderHistory();
            showStatus('Capture deleted.');
        });

        li.append(open, del);
        return li;
    });
    $('historyList').replaceChildren(...items);
    $('historyEmpty').classList.toggle('d-none', records.length > 0);
}

// ── Boot ──────────────────────────────────────────────────────
(async () => {
    $('closePreviewBtn').addEventListener('click', () => window.close());
    document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
    $('toolColor').addEventListener('input', (e) => { state.color = e.target.value; });
    $('undoBtn').addEventListener('click', undo);
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.target.closest('input, textarea')) {
            e.preventDefault();
            undo();
        }
    });
    window.addEventListener('resize', () => { if (state.base) fitCanvas(); });
    setTool('rect');

    try {
        const id = Number(new URLSearchParams(location.search).get('id'));
        let record = id ? await CaptureStore.get(id) : undefined;
        if (id && !record) showStatus('That capture was deleted; showing the latest.');
        record = record || await CaptureStore.latest();
        await openCapture(record || null);
        await renderHistory();
    } catch (err) {
        showError('Could not load captures: ' + (err.message || err));
    }
})();
