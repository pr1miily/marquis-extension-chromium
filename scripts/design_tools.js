function initDesignTools() {
    // --- REFS ---
    const btnEyeDropper = document.getElementById('btnEyeDropper');
    const colorPreview = document.getElementById('colorPreviewBox');
    const hexDisplay = document.getElementById('colorHexDisplay');
    const rgbDisplay = document.getElementById('colorRgbDisplay');
    const btnCopy = document.getElementById('btnCopyColor');
    
    // History Refs
    const historyContainer = document.getElementById('colorHistoryContainer');
    const btnClearHistory = document.getElementById('btnClearHistory');
    
    // Contrast Refs
    const contrastFg = document.getElementById('contrastFg');
    const contrastBg = document.getElementById('contrastBg');
    const ratioDisplay = document.getElementById('contrastRatio');
    const ratingDisplay = document.getElementById('contrastRating');

    // Modal Ref
    let designModalInstance;
    const designModalEl = document.getElementById('designClearConfirmModal');
    if (designModalEl && typeof bootstrap !== 'undefined') {
        designModalInstance = new bootstrap.Modal(designModalEl);
    }

    // State
    let colorHistory = [];

    // --- INITIALIZE ---
    chrome.storage.local.get(['designColorHistory'], (res) => {
        colorHistory = res.designColorHistory || [];
        renderHistory();
    });
    
    checkContrast();

    // --- EVENTS ---
    if (btnEyeDropper) {
        btnEyeDropper.addEventListener('click', async () => {
            if (!window.EyeDropper) {
                if (window.showGlobalAlert) window.showGlobalAlert('Feature Unavailable', 'Alas, your browser lacks the refinement to support the EyeDropper API.', 'error');
                return;
            }

            try {
                const eyeDropper = new EyeDropper();
                const result = await eyeDropper.open();
                updateActiveColor(result.sRGBHex);
                addToHistory(result.sRGBHex);
            } catch (e) {
                console.log("User canceled selection");
            }
        });
    }

    if (btnCopy) {
        btnCopy.addEventListener('click', () => {
            navigator.clipboard.writeText(hexDisplay.innerText);
            const originalText = '<i class="bi bi-clipboard me-1"></i> Copy HEX';
            
            btnCopy.innerHTML = '<i class="bi bi-check-lg me-1"></i> Copied!';
            btnCopy.classList.remove('btn-outline-secondary');
            btnCopy.classList.add('btn-success', 'text-white');
            
            setTimeout(() => {
                btnCopy.innerHTML = originalText;
                btnCopy.classList.remove('btn-success', 'text-white');
                btnCopy.classList.add('btn-outline-secondary');
            }, 1500);
        });
    }

    // 🟢 Trigger the Bootstrap Modal instead of confirm()
    if (btnClearHistory) {
        btnClearHistory.addEventListener('click', () => {
            if (colorHistory.length === 0) {
                if (window.showGlobalAlert) window.showGlobalAlert('Unnecessary Request', 'The history is already quite empty, I assure you.', 'warning');
                return;
            }
            designModalInstance?.show();
        });
    }

    // 🟢 Handle the Confirm button inside the Modal
    document.getElementById('btnConfirmDesignClear')?.addEventListener('click', () => {
        colorHistory = [];
        chrome.storage.local.remove('designColorHistory');
        renderHistory();
        designModalInstance?.hide();
        if (window.showGlobalAlert) window.showGlobalAlert('Cleared', 'Color history removed.', 'success');
    });

    if(contrastFg && contrastBg) {
        contrastFg.addEventListener('input', checkContrast);
        contrastBg.addEventListener('input', checkContrast);
    }

    // --- FUNCTIONS ---

    function updateActiveColor(hex) {
        colorPreview.style.backgroundColor = hex;
        hexDisplay.innerText = hex.toUpperCase();
        
        // Convert to RGB
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        rgbDisplay.innerText = `rgb(${r}, ${g}, ${b})`;
    }

    function addToHistory(hex) {
        // Prevent duplicates at the top
        colorHistory = colorHistory.filter(c => c !== hex);
        colorHistory.unshift(hex);
        if (colorHistory.length > 12) colorHistory.pop(); // Max 12 items
        
        chrome.storage.local.set({ designColorHistory: colorHistory });
        renderHistory();
    }

    function renderHistory() {
        if (!historyContainer) return; // ✅ FIX
        historyContainer.innerHTML = '';
        
        if (colorHistory.length === 0) {
            historyContainer.innerHTML = '<span class="text-muted small fst-italic">No colors picked yet...</span>';
            return;
        }
        
        colorHistory.forEach(hex => {
            const btn = document.createElement('div');
            btn.className = 'rounded border shadow-sm position-relative';
            btn.style.width = '36px';
            btn.style.height = '36px';
            btn.style.backgroundColor = hex;
            btn.style.cursor = 'pointer';
            btn.title = hex;
            
            // Hover effect handled via title, click sets active
            btn.onclick = () => updateActiveColor(hex);
            
            historyContainer.appendChild(btn);
        });
    }

    // --- CONTRAST LOGIC (Luminance) ---
    function checkContrast() {
        const hex1 = contrastFg.value;
        const hex2 = contrastBg.value;
        const lum1 = getLuminance(hex1);
        const lum2 = getLuminance(hex2);
        const ratio = (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);
        
        const ratioFixed = ratio.toFixed(2);
        ratioDisplay.innerText = `${ratioFixed}:1`;

        if (ratio >= 7) {
            ratingDisplay.className = 'badge bg-success rounded-pill px-4 py-2';
            ratingDisplay.innerText = 'AAA (Perfect)';
        } else if (ratio >= 4.5) {
            ratingDisplay.className = 'badge bg-success bg-opacity-75 rounded-pill px-4 py-2';
            ratingDisplay.innerText = 'AA (Good)';
        } else if (ratio >= 3) {
            ratingDisplay.className = 'badge bg-warning text-dark rounded-pill px-4 py-2';
            ratingDisplay.innerText = 'AA Large (Okay)';
        } else {
            ratingDisplay.className = 'badge bg-danger rounded-pill px-4 py-2';
            ratingDisplay.innerText = 'Fail';
        }
    }

    function getLuminance(hex) {
        const rgb = parseInt(hex.slice(1), 16);
        const r = (rgb >> 16) & 0xff;
        const g = (rgb >>  8) & 0xff;
        const b = (rgb >>  0) & 0xff;
        const a = [r, g, b].map(v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
    }
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'designSection') initDesignTools();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('btnEyeDropper')) initDesignTools();
});