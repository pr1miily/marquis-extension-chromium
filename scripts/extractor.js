function initExtractor() {
    // UI References
    const dropZone = document.getElementById('extractorDropZone');
    const fileInput = document.getElementById('extractorFileInput');
    const statusBox = document.getElementById('extractorStatus');
    const statusText = document.getElementById('extractorStatusText');
    const percentText = document.getElementById('extractorPercent');
    const progressBar = document.getElementById('extractorProgressBar');
    const resultBox = document.getElementById('extractorResult');
    const outputArea = document.getElementById('extractorOutput');
    
    // 🟢 NEW: Clear Button & Modal setup
    const clearBtn = document.getElementById('extractorClearBtn');
    let errorModal;
    if (typeof bootstrap !== 'undefined') {
        const modalEl = document.getElementById('extractorErrorModal');
        if (modalEl) errorModal = new bootstrap.Modal(modalEl);
    }

    if (!dropZone) return;

    // ==========================================
    // 1. DRAG & DROP LISTENERS
    // ==========================================
    dropZone.addEventListener('click', () => fileInput.click());
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('bg-primary', 'bg-opacity-10', 'border-primary');
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.classList.remove('bg-primary', 'bg-opacity-10', 'border-primary');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('bg-primary', 'bg-opacity-10', 'border-primary');
        
        // 🟢 NEW: Trigger Modal instead of alert
        if (e.dataTransfer.files && e.dataTransfer.files.length > 1) {
            if (errorModal) errorModal.show();
            return; 
        }
        
        if (e.dataTransfer.files && e.dataTransfer.files.length === 1) {
            processFile(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            processFile(e.target.files[0]);
        }
    });

    // 🟢 NEW: Clear Button Logic
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            outputArea.value = "";
            resultBox.classList.add('d-none');
            fileInput.value = ""; // Reset hidden file input
            updateProgress(0, "Ready");
        });
    }

    // ==========================================
    // 2. ROUTING LOGIC
    // ==========================================
    function processFile(file) {
        // Reset UI
        resultBox.classList.add('d-none');
        statusBox.classList.remove('d-none');
        outputArea.value = "";
		fileInput.value = "";
        updateProgress(5, `Analyzing ${file.name}...`);

        const ext = file.name.split('.').pop().toLowerCase();
        const textExtensions = ['txt', 'js', 'json', 'csv', 'html', 'css', 'md', 'xml'];
        
        if (textExtensions.includes(ext)) {
            extractPlainText(file);
        } 
        else if (['png', 'jpg', 'jpeg', 'pdf'].includes(ext)) {
            extractViaAPI(file);
        } 
        else {
            updateProgress(100, "I must decline; this file format is unsupported.");
            setTimeout(() => statusBox.classList.add('d-none'), 3000);
        }
    }

    // ==========================================
    // 3. FAST NATIVE EXTRACTION (Text/Code)
    // ==========================================
    function extractPlainText(file) {
        updateProgress(50, "Reading text file...");
        const reader = new FileReader();
        
        reader.onload = (e) => {
            showResult(e.target.result);
            updateProgress(100, "Done!");
        };
        
        reader.onerror = () => {
            updateProgress(100, "A tragic error occurred reading the file.");
            showResult("I regret to inform you that I failed to read the text file.");
        };
        
        reader.readAsText(file);
    }

	// ==========================================
    // 4. API EXTRACTION (Images/PDFs)
    // ==========================================
	// ==========================================
    // 4. API EXTRACTION (Images/PDFs)
    // ==========================================
    async function extractViaAPI(file) {
        updateProgress(30, "Preparing document...");

        try {
            const engineSelect = document.getElementById('extractorEngineSelect');
            let selectedEngine = engineSelect ? engineSelect.value : 'auto';
            let useTableMode = "false";
            const ext = file.name.split('.').pop().toLowerCase();

            // Smart Routing based on file type
            if (selectedEngine === 'auto') {
                if (ext === 'pdf') {
                    // Engine 1 is vastly more stable for PDFs
                    selectedEngine = "1"; 
                    useTableMode = "true";
                } else {
                    selectedEngine = "1"; 
                    useTableMode = "false"; 
                }
            } else if (selectedEngine === "2") {
                useTableMode = "true";
            }

            updateProgress(60, "Uploading & Extracting (this may take a moment)...");

            const formData = new FormData();
            
            // 🟢 FIXED: Send the raw file directly! No more Base64 conversion.
            formData.append("file", file); 
            formData.append("filetype", ext); // Explicitly tell the API it is a PDF or Image
            
            formData.append("language", "eng");
            formData.append("isOverlayRequired", "false");
            formData.append("scale", "true"); 
            
            // Apply the dynamically selected logic
            formData.append("isTable", useTableMode); 
            formData.append("OCREngine", selectedEngine);  
            formData.append("apikey", "K89909389288957"); // Shared built-in OCR.space key: public by design (ships in every install); all users share its quota

            const response = await fetch("https://api.ocr.space/parse/image", {
                method: "POST",
                body: formData
            });

            const data = await response.json();
            
            if (data.IsErroredOnProcessing) {
                throw new Error(data.ErrorMessage[0]);
            }

            let fullText = "";
            if (data.ParsedResults && data.ParsedResults.length > 0) {
                data.ParsedResults.forEach(page => {
                    fullText += page.ParsedText + "\n\n";
                });
                showResult(fullText);
                updateProgress(100, `Done! (Used Engine ${selectedEngine})`); 
            } else {
                throw new Error("I assure you, no text could be found within this document.");
            }

        } catch (error) {
            console.error("OCR Error:", error);
            showResult(`Extraction Thwarted: ${error.message}\n\nPray, ensure the file is clear and within the acceptable size limits.`);
            updateProgress(100, "An unfortunate error occurred during extraction.");
        }
    }

    // ==========================================
    // 5. UI HELPERS
    // ==========================================
    function updateProgress(percent, text) {
        progressBar.style.width = `${percent}%`;
        percentText.innerText = `${percent}%`;
        statusText.innerText = text;
    }

    function showResult(text) {
        statusBox.classList.add('d-none');
        resultBox.classList.remove('d-none');
        outputArea.value = text.trim();
        
        // Auto-resize textarea to fit content (up to 15 rows)
        outputArea.rows = Math.min(15, Math.max(5, text.split('\n').length));
    }

	// ==========================================
    // 6. MULTI-FORMAT EXPORT
    // ==========================================
    const dlButtons = document.querySelectorAll('.extractor-dl-btn');
    
    dlButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const format = e.currentTarget.getAttribute('data-format');
            const text = outputArea.value;
            if (!text) return;
            
            let content = '';
            let mimeType = '';
            let ext = '';
            
            if (format === 'txt') {
                content = text;
                mimeType = 'text/plain;charset=utf-8';
                ext = '.txt';
            } 
            else if (format === 'doc') {
                // Wrap in HTML <pre> tag so Word respects the tabular spaces and line breaks
                content = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"></head><body><pre style="font-family: monospace; font-size: 10pt;">${MarquisHtml.esc(text)}</pre></body></html>`;
                mimeType = 'application/msword;charset=utf-8';
                ext = '.doc';
            } 
            else if (format === 'csv') {
                // Convert tab-separated text (from OCR isTable) into clean CSV columns
                const lines = text.split('\n');
                const csvLines = lines.map(line => {
                    return line.split('\t')
                        .map(cell => `"${cell.replace(/"/g, '""')}"`) // Wrap in quotes to protect commas
                        .join(',');
                });
                content = "\uFEFF" + csvLines.join('\n'); // \uFEFF forces Excel to read as UTF-8
                mimeType = 'text/csv;charset=utf-8';
                ext = '.csv';
            }
            
            // Trigger Download
            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            
            a.href = url;
            a.download = `Extracted_Data_${new Date().toISOString().split('T')[0]}${ext}`;
            document.body.appendChild(a);
            a.click();
            
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    });
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'extractSection') initExtractor();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('extractorDropZone')) initExtractor();
});