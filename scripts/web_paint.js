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

                // Inject the painting engine
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: injectWebPaintEngine
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
function injectWebPaintEngine() {
    if (document.getElementById('odh-web-paint-root')) return;

    const root = document.createElement('div');
    root.id = 'odh-web-paint-root';
    root.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; pointer-events: none; font-family: system-ui, sans-serif;';
    document.body.appendChild(root);

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
    toolbar.style.cssText = 'position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: #1e293b; padding: 10px 20px; border-radius: 50px; display: flex; gap: 15px; align-items: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); pointer-events: auto; border: 1px solid #334155; transition: all 0.2s;';
    root.appendChild(toolbar);

    const createBtn = (icon, title, onClick) => {
        const btn = document.createElement('button');
        btn.innerHTML = icon;
        btn.title = title;
        btn.style.cssText = 'background: transparent; border: none; font-size: 20px; cursor: pointer; padding: 5px; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; transition: 0.2s; color: white;';
        btn.onmouseover = () => btn.style.background = '#334155';
        btn.onmouseout = () => btn.style.background = btn.dataset.active === 'true' ? '#3b82f6' : 'transparent';
        btn.onclick = () => onClick(btn);
        return btn;
    };

    let buttons = [];

    const pointerBtn = createBtn('🖱️', 'Pointer (Scroll/Click)', (btn) => {
        currentTool = 'pointer';
        canvas.style.pointerEvents = 'none'; 
        updateActiveState(btn);
    });
    toolbar.appendChild(pointerBtn);

    const brushBtn = createBtn('🖌️', 'Brush', (btn) => {
        currentTool = 'brush';
        canvas.style.pointerEvents = 'auto'; 
        canvas.style.cursor = 'crosshair';
        updateActiveState(btn);
    });
    brushBtn.dataset.active = 'true';
    brushBtn.style.background = '#3b82f6';
    toolbar.appendChild(brushBtn);

    const eraserBtn = createBtn('🧽', 'Eraser', (btn) => {
        currentTool = 'eraser';
        canvas.style.pointerEvents = 'auto';
        canvas.style.cursor = 'cell';
        updateActiveState(btn);
    });
    toolbar.appendChild(eraserBtn);

    buttons = [pointerBtn, brushBtn, eraserBtn];

    function updateActiveState(activeBtn) {
        buttons.forEach(b => {
            b.dataset.active = 'false';
            b.style.background = 'transparent';
        });
        activeBtn.dataset.active = 'true';
        activeBtn.style.background = '#3b82f6';
    }

    const divider = document.createElement('div');
    divider.style.cssText = 'width: 2px; height: 25px; background: #475569; border-radius: 2px;';
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
    sizeSlider.style.cssText = 'width: 80px; accent-color: #3b82f6; cursor: pointer;';
    sizeSlider.oninput = (e) => brushSize = e.target.value;
    toolbar.appendChild(sizeSlider);

    const clearBtn = createBtn('🗑️', 'Clear All', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
    toolbar.appendChild(clearBtn);

    const quitBtn = createBtn('❌', 'Exit Web Paint', () => {
        root.remove();
    });
    quitBtn.style.marginLeft = '10px';
    quitBtn.style.background = '#ef4444';
    quitBtn.onmouseover = () => quitBtn.style.background = '#dc2626';
    quitBtn.onmouseout = () => quitBtn.style.background = '#ef4444';
    toolbar.appendChild(quitBtn);
}