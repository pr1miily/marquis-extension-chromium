function initWebPaint() {
    const launchBtn = document.getElementById('launchWebPaintBtn');

    if (launchBtn) {
        launchBtn.addEventListener('click', async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                
				// Security check
                if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.includes('chrome.google.com/webstore')) {
                    window.showGlobalAlert("Domain Secured", "I am strictly forbidden from splashing paint upon Chrome system pages or the Web Store.", "error");
                    return;
                }

                // Inject the painting engine with the popup's current theme tokens (resolved values), so its
                // toolbar follows the active theme without a palette of its own.
                const css = getComputedStyle(document.documentElement);
                const theme = {};
                ['--mq-surface', '--mq-text', '--mq-accent', '--mq-on-accent', '--mq-border-subtle']
                    .forEach((k) => { const v = css.getPropertyValue(k).trim(); if (v) theme[k] = v; });
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: injectWebPaintEngine,
                    args: [theme]
                });

                window.close(); 
			} catch (err) {
                console.error("Web Paint Error:", err);
                window.showGlobalAlert("Canvas Unavailable", "I could not ready my brushes for this page. A quick refresh of the tab might remedy this.", "error");
            }
        });
    }
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'webPaintSection') initWebPaint();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('launchWebPaintBtn')) initWebPaint();
});

// ==========================================
// 🎨 INJECTED PAINT ENGINE (Runs inside the webpage)
// ==========================================
// theme: the popup's resolved --mq-* tokens; every colour below falls back to the default theme's.
function injectWebPaintEngine(theme = {}) {
    if (document.getElementById('odh-web-paint-root')) return;

    const root = document.createElement('div');
    root.id = 'odh-web-paint-root';
    root.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; pointer-events: none; font-family: system-ui, sans-serif;';
    Object.entries(theme).forEach(([k, v]) => root.style.setProperty(k, v));
    document.body.appendChild(root);

    // Bootstrap Icons glyphs from the font the background serves as bytes (as the dock does), so nothing loads a
    // chrome-extension:// URL from the page. Without it the buttons keep their titles and labels.
    chrome.runtime.sendMessage({ action: 'dockAssets' }).then((res) => {
        if (!res || !res.ok) return;
        const face = new FontFace('marquis-bi', Uint8Array.from(atob(res.font), (c) => c.charCodeAt(0)));
        return face.load().then((f) => document.fonts.add(f));
    }).catch(() => {});
    const icon = (cp) => `<i aria-hidden="true" style="font-family: marquis-bi; font-style: normal; font-weight: normal; line-height: 1;">&#x${cp};</i>`;

    const canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.cssText = 'position: absolute; top: 0; left: 0; pointer-events: auto; cursor: crosshair;';
    root.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    let isDrawing = false;
    let currentTool = 'brush'; 
    let color = '#ef4444'; 
    let brushSize = 5;

    const startDrawing = (e) => {
        if (currentTool === 'pointer') return;
        isDrawing = true;
        ctx.beginPath();
        ctx.moveTo(e.clientX, e.clientY);
    };

    const draw = (e) => {
        if (!isDrawing || currentTool === 'pointer') return;
        ctx.lineTo(e.clientX, e.clientY);
        
        if (currentTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = brushSize * 2; 
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = color;
            ctx.lineWidth = brushSize;
        }
        
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
    };

    const stopDrawing = () => {
        if (isDrawing) {
            isDrawing = false;
            ctx.closePath();
        }
    };

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    window.addEventListener('resize', () => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        tempCanvas.getContext('2d').drawImage(canvas, 0, 0);
        
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        ctx.drawImage(tempCanvas, 0, 0);
    });

    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: var(--mq-surface, #1e293b); color: var(--mq-text, #f8fafc); padding: 10px 20px; border-radius: 50px; display: flex; gap: 15px; align-items: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); pointer-events: auto; border: 1px solid var(--mq-border-subtle, #334155);';
    root.appendChild(toolbar);

    // Idle: transparent; hover: a tint of the text colour; active tool: accent fill with its own text colour.
    const paint = (btn, hover) => {
        const active = btn.dataset.active === 'true';
        btn.style.background = active ? 'var(--mq-accent, #3b82f6)' : hover ? 'color-mix(in srgb, currentColor 16%, transparent)' : 'transparent';
        btn.style.color = active ? 'var(--mq-on-accent, #0f172a)' : 'inherit';
    };
    const createBtn = (cp, title, onClick) => {
        const btn = document.createElement('button');
        btn.innerHTML = icon(cp);
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.style.cssText = 'background: transparent; border: none; font-size: 20px; cursor: pointer; padding: 5px; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s, color 0.2s; color: inherit;';
        btn.onmouseover = () => paint(btn, true);
        btn.onmouseout = () => paint(btn, false);
        btn.onclick = () => onClick(btn);
        return btn;
    };

    let buttons = [];

    const pointerBtn = createBtn('f2e1', 'Pointer (Scroll/Click)', (btn) => {
        currentTool = 'pointer';
        canvas.style.pointerEvents = 'none'; 
        updateActiveState(btn);
    });
    toolbar.appendChild(pointerBtn);

    const brushBtn = createBtn('f1d7', 'Brush', (btn) => {
        currentTool = 'brush';
        canvas.style.pointerEvents = 'auto';
        canvas.style.cursor = 'crosshair';
        updateActiveState(btn);
    });
    brushBtn.dataset.active = 'true';
    paint(brushBtn, false);
    toolbar.appendChild(brushBtn);

    const eraserBtn = createBtn('f330', 'Eraser', (btn) => {
        currentTool = 'eraser';
        canvas.style.pointerEvents = 'auto';
        canvas.style.cursor = 'cell';
        updateActiveState(btn);
    });
    toolbar.appendChild(eraserBtn);

    buttons = [pointerBtn, brushBtn, eraserBtn];

    function updateActiveState(activeBtn) {
        buttons.forEach(b => { b.dataset.active = 'false'; paint(b, false); });
        activeBtn.dataset.active = 'true';
        paint(activeBtn, false);
    }

    const divider = document.createElement('div');
    divider.style.cssText = 'width: 2px; height: 25px; background: var(--mq-border-subtle, #475569); border-radius: 2px;';
    toolbar.appendChild(divider);

    const colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.value = color;
    colorPicker.title = "Choose Color";
    colorPicker.style.cssText = 'width: 35px; height: 35px; border: none; border-radius: 50%; cursor: pointer; padding: 0; background: transparent; overflow: hidden; outline: none;';
    colorPicker.oninput = (e) => {
        color = e.target.value;
        brushBtn.click(); 
    };
    toolbar.appendChild(colorPicker);

    const sizeSlider = document.createElement('input');
    sizeSlider.type = 'range';
    sizeSlider.min = '1';
    sizeSlider.max = '30';
    sizeSlider.value = brushSize;
    sizeSlider.title = "Brush Size";
    sizeSlider.style.cssText = 'width: 80px; accent-color: var(--mq-accent, #3b82f6); cursor: pointer;';
    sizeSlider.oninput = (e) => brushSize = e.target.value;
    toolbar.appendChild(sizeSlider);

    const clearBtn = createBtn('f78b', 'Clear All', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
    toolbar.appendChild(clearBtn);

    // Exit keeps its semantic red fill (a destructive action) in every theme.
    const quitBtn = createBtn('f659', 'Exit Web Paint', () => {
        root.remove();
    });
    quitBtn.style.marginLeft = '10px';
    quitBtn.style.color = '#ffffff';
    quitBtn.style.background = '#ef4444';
    quitBtn.onmouseover = () => quitBtn.style.background = '#dc2626';
    quitBtn.onmouseout = () => quitBtn.style.background = '#ef4444';
    toolbar.appendChild(quitBtn);
}