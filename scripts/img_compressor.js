function initImgCompressor() {
    // ==========================================
    // 🗜️ LOCAL IMAGE COMPRESSOR & RESIZER
    // ==========================================
    const compDropZone = document.getElementById('compressorDropZone');
    const compInput = document.getElementById('compressorInput');
    const compQuality = document.getElementById('compressQuality');
    const compQualityLabel = document.getElementById('compressQualityLabel');
    const compWidth = document.getElementById('compressWidth');
    const compHeight = document.getElementById('compressHeight');
    const btnDownloadComp = document.getElementById('btnDownloadCompressed');
    
    let originalFile = null;
    let compressedBlobUrl = null;
    let imgAspectRatio = 1; // Used to keep image from stretching

    // Helper: Format Bytes into readable sizes
    function formatBytes(bytes, decimals = 2) {
        if (!+bytes) return '0 Bytes';
        const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    }

    // --- FILE SELECTION & DRAG-AND-DROP ---
    
    compDropZone?.addEventListener('click', () => compInput.click());

    compInput?.addEventListener('change', (e) => {
        if (e.target.files.length > 0) processOriginalFile(e.target.files[0]);
    });

    compDropZone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        compDropZone.classList.add('bg-primary', 'bg-opacity-10', 'border-primary');
    });

    compDropZone?.addEventListener('dragleave', (e) => {
        e.preventDefault();
        compDropZone.classList.remove('bg-primary', 'bg-opacity-10', 'border-primary');
    });

    compDropZone?.addEventListener('drop', (e) => {
        e.preventDefault();
        compDropZone.classList.remove('bg-primary', 'bg-opacity-10', 'border-primary');
        if (e.dataTransfer.files.length > 0) processOriginalFile(e.dataTransfer.files[0]);
    });

    // --- INPUT LISTENERS ---

    // Quality Slider
    compQuality?.addEventListener('input', (e) => {
        compQualityLabel.innerText = `${Math.round(e.target.value * 100)}%`;
        if (originalFile) compressImage(); 
    });

    // Width Change (Auto-calculates Height)
    compWidth?.addEventListener('change', (e) => {
        if (originalFile && e.target.value) {
            compHeight.value = Math.round(e.target.value / imgAspectRatio);
            compressImage();
        }
    });

    // Height Change (Auto-calculates Width)
    compHeight?.addEventListener('change', (e) => {
        if (originalFile && e.target.value) {
            compWidth.value = Math.round(e.target.value * imgAspectRatio);
            compressImage();
        }
    });

    // --- LOGIC ---

    function processOriginalFile(file) {
        if (!file.type.startsWith('image/')) {
            if (typeof window.showGlobalAlert === 'function') {
                window.showGlobalAlert("Unrecognized Format", "I must insist you upload a proper image file (JPG, PNG, or WebP).", "error");
            }
            return;
        }
        
        originalFile = file;
        document.getElementById('compressorFileName').innerText = file.name;
        document.getElementById('origSizeDisplay').innerText = formatBytes(file.size);
        
        // Read the image once to get original dimensions before compressing
        const reader = new FileReader();
        reader.readAsDataURL(originalFile);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                // Save aspect ratio and populate UI inputs
                imgAspectRatio = img.width / img.height;
                if(compWidth) compWidth.value = img.width;
                if(compHeight) compHeight.value = img.height;
                
                compressImage(); // Trigger first compression
            };
        };
    }

    function compressImage() {
        const reader = new FileReader();
        reader.readAsDataURL(originalFile);
        
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                
                // Get custom target dimensions from UI (fallback to original if empty)
                const targetW = parseInt(compWidth.value) || img.width;
                const targetH = parseInt(compHeight.value) || img.height;

                canvas.width = targetW;
                canvas.height = targetH;
                
                // Draw the resized image
                ctx.drawImage(img, 0, 0, targetW, targetH);

                const outFormat = originalFile.type === 'image/png' ? 'image/jpeg' : originalFile.type;
                const quality = parseFloat(compQuality.value);

                canvas.toBlob((blob) => {
                    document.getElementById('newSizeDisplay').innerText = formatBytes(blob.size);
                    
                    const savedBytes = originalFile.size - blob.size;
                    const savedPercent = Math.round((savedBytes / originalFile.size) * 100);
                    
                    const savingsEl = document.getElementById('compressionSavings');
                    if (savedPercent > 0) {
                        savingsEl.classList.remove('d-none');
                        document.getElementById('savingsPercent').innerText = savedPercent;
                    } else {
                        savingsEl.classList.add('d-none');
                    }

                    if (compressedBlobUrl) URL.revokeObjectURL(compressedBlobUrl);
                    compressedBlobUrl = URL.createObjectURL(blob);
                    
                    document.getElementById('compressedImagePreview').src = compressedBlobUrl;
                    document.getElementById('compressorPreviewBox').classList.remove('d-none');
                    
                    btnDownloadComp.disabled = false;
                }, outFormat, quality);
            };
        };
    }

    // --- DOWNLOAD LOGIC ---
    btnDownloadComp?.addEventListener('click', () => {
        if (!compressedBlobUrl || !originalFile) return;
        
        const link = document.createElement('a');
        // Add dimensions to filename to avoid overwriting
        const dimLabel = `${compWidth.value}x${compHeight.value}`;
        const ext = originalFile.type === 'image/png' ? '.jpg' : `.${originalFile.name.split('.').pop()}`;
        link.download = `compressed_${dimLabel}_${originalFile.name.split('.')[0]}${ext}`;
        link.href = compressedBlobUrl;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        if (typeof window.showGlobalAlert === 'function') {
            window.showGlobalAlert("Success", "Image compressed and downloaded!", "success");
        }
    });
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'imageCompressorSection') initImgCompressor();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('compressorDropZone')) initImgCompressor();
});