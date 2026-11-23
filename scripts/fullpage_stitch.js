// MARQUIS — fullpage_stitch.js: tile planning and stitching for full-page capture. Loaded by background.js
// (importScripts) and by tests/fullpage_stitch.selftest.html. No DOM: OffscreenCanvas + ImageBitmap only.
const FullPageStitch = (() => {
    // Each tile overlaps the previous one by a few CSS px, so rounding at fractional pixel ratios (125 %,
    // 150 % zoom) can never leave a 1 px gap; the last tile sits flush with the end instead of overshooting.
    const SEAM = 8;
    function axis(full, view) {
        full = Math.ceil(full); view = Math.floor(view);
        if (full <= view) return [0];
        const out = [];
        for (let p = 0; p < full - view; p += Math.max(1, view - SEAM)) out.push(p);
        out.push(full - view);
        return out;
    }
    // Row-major tile origins (CSS px) covering a scrolled area of fullW x fullH seen through viewW x viewH.
    function plan({ fullW, fullH, viewW, viewH }) {
        const xs = axis(fullW, viewW), ys = axis(fullH, viewH);
        return ys.flatMap((y) => xs.map((x) => ({ x, y })));
    }

    // Writes tiles into a grid of segment canvases (each within the canvas limits) and encodes a segment as
    // soon as no later tile can reach it, so memory holds one row of segments, not the whole page.
    // Tiles must arrive in row-major order. Coordinates passed to add() are device px of the final image.
    class Stitcher {
        constructor({ width, height, bg = '#ffffff', maxDim = 16384, maxArea = 32e6 }) {
            this.W = width; this.H = height; this.bg = bg;
            this.segW = Math.min(width, maxDim);
            this.cols = Math.ceil(width / this.segW);
            this.segH = Math.max(1, Math.min(maxDim, Math.floor(maxArea / this.segW)));
            this.row = -1; this.cells = []; this.carry = []; this.parts = [];
        }
        get rows() { return Math.ceil(this.H / this.segH); }
        // The page grew during capture: later rows follow automatically; an open (last) row is enlarged in place.
        setHeight(h) {
            if (h <= this.H) return;
            this.H = h;
            const want = Math.min(this.segH, this.H - this.row * this.segH);
            this.cells = this.cells.map((cell) => (cell.h >= want ? cell : this._cell(cell.x, cell.y, cell.w, want, cell.canvas)));
        }
        _cell(x, y, w, h, copyFrom) {
            const canvas = new OffscreenCanvas(w, h);
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.fillStyle = this.bg; ctx.fillRect(0, 0, w, h);
            ctx.imageSmoothingEnabled = false;                          // 1:1 copies: seams stay pixel-exact
            if (copyFrom) ctx.drawImage(copyFrom, 0, 0);
            return { canvas, ctx, x, y, w, h };
        }
        async _openRow(r) {
            this.row = r;
            const top = r * this.segH, h = Math.min(this.segH, this.H - top);
            this.cells = Array.from({ length: this.cols }, (_, c) => this._cell(c * this.segW, top, Math.min(this.segW, this.W - c * this.segW), h));
            const keep = [];
            for (const t of this.carry) {                               // tiles that straddle into this row
                this._draw(t);
                if (t.dy + t.sh > top + h) keep.push(t); else t.bmp.close?.();
            }
            this.carry = keep;
        }
        _draw(t) {
            for (const cell of this.cells) {
                const x0 = Math.max(t.dx, cell.x), y0 = Math.max(t.dy, cell.y);
                const x1 = Math.min(t.dx + t.sw, cell.x + cell.w), y1 = Math.min(t.dy + t.sh, cell.y + cell.h);
                if (x1 <= x0 || y1 <= y0) continue;
                cell.ctx.drawImage(t.bmp, t.sx + (x0 - t.dx), t.sy + (y0 - t.dy), x1 - x0, y1 - y0, x0 - cell.x, y0 - cell.y, x1 - x0, y1 - y0);
            }
        }
        async _closeRow() {
            for (const cell of this.cells) {
                this.parts.push({ blob: await cell.canvas.convertToBlob({ type: 'image/png' }), width: cell.w, height: cell.h, col: cell.x / this.segW, row: this.row });
            }
            this.cells = [];
        }
        // tile: { bmp, sx, sy, sw, sh, dx, dy } (source crop and destination, device px). Takes ownership of bmp.
        async add(t) {
            t.sw = Math.min(t.sw, this.W - t.dx); t.sh = Math.min(t.sh, this.H - t.dy);
            if (t.sw <= 0 || t.sh <= 0) { t.bmp.close?.(); return; }
            if (this.row < 0) await this._openRow(0);
            while (t.dy >= (this.row + 1) * this.segH) { await this._closeRow(); await this._openRow(this.row + 1); }
            this._draw(t);
            if (t.dy + t.sh > (this.row + 1) * this.segH) this.carry.push(t); else t.bmp.close?.();
        }
        async finish() {
            if (this.row < 0) await this._openRow(0);
            for (;;) {
                await this._closeRow();
                if ((this.row + 1) * this.segH >= this.H) break;
                await this._openRow(this.row + 1);
            }
            this.carry.forEach((t) => t.bmp.close?.()); this.carry = [];
            return this.parts;
        }
    }
    return { SEAM, axis, plan, Stitcher };
})();
