// Screen colour picker for browsers without the EyeDropper API (Firefox), with the same shape:
//   const { sRGBHex } = await new (window.EyeDropper || MarquisEyeDropper)().open();   // '#rrggbb'
//   Esc or right-click rejects with an AbortError, like EyeDropper.
// Runs in a content script (the dock, or injected by the popup's Design tools). The background worker takes a
// screenshot of the visible tab ({ action: 'captureVisibleForPicker' }); the user clicks a pixel of it, shown
// over the page at its real position, so the pick matches what was on screen.
globalThis.MarquisEyeDropper ??= class MarquisEyeDropper {
    async open() {
        const { dataUrl, error } = (await chrome.runtime.sendMessage({ action: 'captureVisibleForPicker' })) || {};
        if (!dataUrl) throw new DOMException(error || 'This page could not be captured.', 'NotAllowedError');
        const img = new Image();
        img.src = dataUrl;
        await img.decode();

        const scale = window.devicePixelRatio || 1; // tabs.captureVisibleTab captures at device pixels
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        canvas.style.cssText = `position:absolute;left:0;top:0;width:${img.naturalWidth / scale}px;height:${img.naturalHeight / scale}px`;

        const host = document.createElement('div');
        host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;cursor:crosshair;overflow:hidden';
        const root = host.attachShadow({ mode: 'closed' });
        const chip = document.createElement('div');
        chip.style.cssText = 'position:fixed;pointer-events:none;display:flex;align-items:center;gap:6px;padding:4px 8px;'
            + 'border-radius:6px;background:#18181b;color:#fafafa;font:600 12px/1.2 ui-monospace,Consolas,monospace;'
            + 'box-shadow:0 2px 8px rgba(0,0,0,.45)';
        const swatch = document.createElement('span');
        swatch.style.cssText = 'width:14px;height:14px;border-radius:3px;border:1px solid rgba(255,255,255,.6)';
        const label = document.createElement('span');
        label.textContent = 'Click to pick · Esc to cancel';
        chip.append(swatch, label);
        chip.style.left = '12px';
        chip.style.top = '12px';
        root.append(canvas, chip);
        document.documentElement.append(host);

        const hexAt = (e) => {
            const x = Math.min(canvas.width - 1, Math.max(0, Math.floor(e.clientX * scale)));
            const y = Math.min(canvas.height - 1, Math.max(0, Math.floor(e.clientY * scale)));
            const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
            return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
        };

        return new Promise((resolve, reject) => {
            const finish = (settle, value) => {
                removeEventListener('keydown', onKey, true);
                host.remove();
                settle(value);
            };
            const cancel = () => finish(reject, new DOMException('The user canceled the selection.', 'AbortError'));
            const onKey = (e) => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                e.stopPropagation();
                cancel();
            };
            addEventListener('keydown', onKey, true);
            host.addEventListener('mousemove', (e) => {
                const hex = hexAt(e);
                swatch.style.background = hex;
                label.textContent = hex;
                // Keep the chip beside the cursor and inside the viewport.
                chip.style.left = `${Math.min(e.clientX + 16, window.innerWidth - chip.offsetWidth - 8)}px`;
                chip.style.top = `${Math.min(e.clientY + 16, window.innerHeight - chip.offsetHeight - 8)}px`;
            });
            host.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                finish(resolve, { sRGBHex: hexAt(e) });
            });
            host.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                cancel();
            });
        });
    }
};
