function initToolkit() {

    // ==========================================
    // 🟢 SAFE STORAGE ENGINE (Prevents Crashes)
    // ==========================================
    const safeStorage = {
        get: (key, callback) => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get([key], res => callback(res[key]));
            } else {
                try { callback(JSON.parse(localStorage.getItem(key))); } 
                catch (e) { callback(null); }
            }
        },
        set: (key, value, callback) => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ [key]: value }, callback);
            } else {
                localStorage.setItem(key, JSON.stringify(value));
                if (callback) callback();
            }
        }
    };

    // ==========================================
    // 1. TOOLKIT NAVIGATION
    // ==========================================
    const toolkitSelector = document.getElementById('toolkitSelector');
    if (toolkitSelector) {
        toolkitSelector.addEventListener('change', function() {
            const targetId = this.value + '-tab';
            const tabTrigger = document.getElementById(targetId);
            if (tabTrigger) {
                const tabInstance = new bootstrap.Tab(tabTrigger);
                tabInstance.show();
            }
        });

        document.querySelectorAll('#toolkitTabs button[data-bs-toggle="tab"]').forEach(tab => {
            tab.addEventListener('shown.bs.tab', (event) => {
                const id = event.target.id.replace('-tab', '');
                if (toolkitSelector.value !== id) toolkitSelector.value = id;
            });
        });
    }

    // ==========================================
    // 2. WORD COUNTER
    // ==========================================
    const textInput = document.getElementById('textInput');
    if (textInput) {
        textInput.addEventListener('input', () => {
            const text = textInput.value;
            document.getElementById('charCount').textContent = text.length.toLocaleString();
            document.getElementById('wordCount').textContent = (text.trim().match(/\S+/g) || []).length.toLocaleString();
            document.getElementById('sentenceCount').textContent = (text.match(/[.!?]+/g) || []).length.toLocaleString();
        });
    }

    // ==========================================
    // 3. CASE CONVERTER
    // ==========================================
    const caseText = document.getElementById("convertText");
    const caseButtons = document.querySelectorAll("#caseButtons button");

    if (caseText && caseButtons.length > 0) {
        caseButtons.forEach(button => {
            button.addEventListener("click", () => {
                const type = button.dataset.case;
                const text = caseText.value;
                let result = text;

                switch (type) {
                    case "sentence": result = text.toLowerCase().replace(/(^\s*\w|[.!?]\s*\w)/g, c => c.toUpperCase()); break;
                    case "lower": result = text.toLowerCase(); break;
                    case "upper": result = text.toUpperCase(); break;
                    case "capitalized": result = text.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); break;
                    case "alternating": result = [...text].map((char, i) => i % 2 ? char.toLowerCase() : char.toUpperCase()).join(''); break;
                    case "title": result = text.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); break;
                    case "inverse": result = [...text].map(char => char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase()).join(''); break;
                }
                caseText.value = result;
            });
        });
    }

    // ==========================================
    // 4. CLIPBOARD MANAGER
    // ==========================================
    const clipboardText = document.getElementById("clipboardText");
    const clipboardImgContainer = document.getElementById("clipboardImageContainer");
    const clipboardImgPreview = document.getElementById("clipboardImagePreview");

    document.getElementById("copyClipboard")?.addEventListener("click", () => {
        if(!clipboardText) return;
        navigator.clipboard.writeText(clipboardText.value).then(() => {
            if (window.showGlobalAlert) window.showGlobalAlert("Copied", "Text copied to clipboard.", "success");
        });
    });

    document.getElementById("pasteClipboard")?.addEventListener("click", async () => {
        try {
            const items = await navigator.clipboard.read();
            let found = false;
            for (const item of items) {
                if (item.types.some(type => type.startsWith("image/"))) {
                    const blob = await item.getType(item.types.find(t => t.startsWith("image/")));
                    clipboardImgPreview.src = URL.createObjectURL(blob);
                    clipboardImgContainer.classList.remove("d-none");
                    clipboardImgContainer.style.display = "flex";
                    found = true;
                } else if (item.types.includes("text/plain")) {
                    const blob = await item.getType("text/plain");
                    clipboardText.value = await blob.text();
                    clipboardImgContainer.classList.add("d-none");
                    found = true;
                }
            }
            if (!found && window.showGlobalAlert) window.showGlobalAlert("Barren Clipboard", "Found nothing of consequence.", "warning");
        } catch (err) {
            navigator.clipboard.readText().then(t => clipboardText.value = t).catch(() => {
                if (window.showGlobalAlert) window.showGlobalAlert("Access Denied", "My apologies, but the browser has strictly forbidden me from viewing your clipboard.", "error");
            });
        }
    });

    document.getElementById("clearClipboard")?.addEventListener("click", () => {
        if(clipboardText) clipboardText.value = "";
        if(clipboardImgPreview) clipboardImgPreview.src = "";
        if(clipboardImgContainer) clipboardImgContainer.classList.add("d-none");
    });

    if (clipboardText) {
        clipboardText.addEventListener("dragover", (e) => e.preventDefault());
        clipboardText.addEventListener("drop", (e) => {
            e.preventDefault();
            const items = e.dataTransfer.items;
            for (let item of items) {
                if (item.kind === "file" && item.type.startsWith("image/")) {
                    clipboardImgPreview.src = URL.createObjectURL(item.getAsFile());
                    clipboardImgContainer.classList.remove("d-none");
                    clipboardImgContainer.style.display = "flex";
                } else if (item.kind === "string") {
                    item.getAsString((str) => clipboardText.value = str);
                }
            }
        });
    }

    // ==========================================
    // 5. TEXT FORMATTING
    // ==========================================
    const formatInput = document.getElementById("formatText");
    const formatOutput = document.getElementById("textPreviewOutput");
    const formatOpts = document.getElementById("formattingOptions");
    const copyFormattedBtn = document.getElementById("copyFormattedBtn");
    
    const optRemoveSpecific = document.getElementById("optRemoveSpecific");
    const specificCharInput = document.getElementById("specificCharacters");

    if (optRemoveSpecific && specificCharInput) {
        optRemoveSpecific.addEventListener('change', () => {
            if (optRemoveSpecific.checked) {
                specificCharInput.classList.remove('d-none');
                specificCharInput.focus();
            } else {
                specificCharInput.classList.add('d-none');
            }
            runFormatting();
        });
        specificCharInput.addEventListener('input', runFormatting);
    }

    function runFormatting() {
        if(!formatInput || !formatOutput) return;
        let text = formatInput.value;

        if (optRemoveSpecific && optRemoveSpecific.checked) {
            const chars = specificCharInput?.value || "";
            if (chars) text = text.replace(new RegExp(`[${chars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`, 'g'), '');
        }
        if (document.getElementById("optStripEmptyLinesAndBreaks")?.checked) text = text.replace(/^\s*[\r\n]/gm, "");
        if (document.getElementById("optTrimAll")?.checked) text = text.split('\n').map(l => l.trim()).join('\n');
        if (document.getElementById("optStripTabs")?.checked) text = text.replace(/\t/g, '');
        if (document.getElementById("optWhitespace")?.checked) text = text.replace(/[ \t]+/g, ' ');
        if (document.getElementById("optStripHTML")?.checked) text = text.replace(/<[^>]*>/g, '');
        if (document.getElementById("optRemoveHTMLCodes")?.checked) {
            const temp = document.createElement("textarea");
            temp.innerHTML = text;
            text = temp.value;
        }
        if (document.getElementById("optNonAlpha")?.checked) text = text.replace(/[^a-zA-Z0-9\s]/g, "");
        if (document.getElementById("optPunctuation")?.checked) text = text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
        if (document.getElementById("optEmojis")?.checked) text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "");

        const statsEl = document.getElementById("textStats");
        if(statsEl) statsEl.textContent = `${text.length} chars | ${text.split('\n').length} lines`;
        formatOutput.value = text;
    }

    if(formatInput) formatInput.addEventListener("input", runFormatting);
    if(formatOpts) formatOpts.addEventListener("change", runFormatting);
    
    if(copyFormattedBtn) {
        copyFormattedBtn.addEventListener("click", () => {
            if(formatOutput) {
                navigator.clipboard.writeText(formatOutput.value).then(() => {
                    copyFormattedBtn.innerHTML = '<i class="bi bi-check2"></i> Copied!';
                    copyFormattedBtn.classList.replace('btn-primary', 'btn-success');
                    setTimeout(() => {
                        copyFormattedBtn.innerHTML = '<i class="bi bi-clipboard-check me-1"></i> Copy Result';
                        copyFormattedBtn.classList.replace('btn-success', 'btn-primary');
                    }, 1500);
                });
            }
        });
    }

    // ==========================================
    // 6. SNIPPET MANAGER
    // ==========================================
    const els = {
        search: document.getElementById('snipSearch'),
        addBtn: document.getElementById('snipAddBtn'),
        list: document.getElementById('snipList'),
        idInput: document.getElementById('snipId'),
        titleInput: document.getElementById('snipTitle'),
        contentInput: document.getElementById('snipContent'),
        saveBtn: document.getElementById('snipSaveBtn')
    };

    let snippets = [];
    let snipModalInstance = null;

    // Lazy load the modal to prevent initialization crashes
    function getModal() {
        if (!snipModalInstance && typeof bootstrap !== 'undefined') {
            const modalEl = document.getElementById('snipModal');
            if (modalEl) snipModalInstance = new bootstrap.Modal(modalEl);
        }
        return snipModalInstance;
    }

    // 🟢 Load Safely (Validates array structure)
    safeStorage.get('mySnippets', (res) => {
        snippets = Array.isArray(res) ? res : [];
        renderSnippets();
    });

    if(els.addBtn) els.addBtn.addEventListener('click', () => openModal());
    if(els.saveBtn) els.saveBtn.addEventListener('click', saveSnippet);
    if(els.search) els.search.addEventListener('input', (e) => renderSnippets(e.target.value));

    function openModal(snippet = null) {
        if (snippet) {
            if (els.idInput) els.idInput.value = snippet.id || '';
            if (els.titleInput) els.titleInput.value = snippet.title || '';
            if (els.contentInput) els.contentInput.value = snippet.content || '';
        } else {
            if (els.idInput) els.idInput.value = '';
            if (els.titleInput) els.titleInput.value = '';
            if (els.contentInput) els.contentInput.value = '';
        }
        const modal = getModal();
        if(modal) modal.show();
    }

    function saveSnippet() {
        const title = els.titleInput ? els.titleInput.value.trim() : '';
        const content = els.contentInput ? els.contentInput.value : ''; 
        const id = els.idInput ? els.idInput.value : '';

        if (!title) {
            if (window.showGlobalAlert) window.showGlobalAlert("Missing Title", "I simply cannot file a snippet without a proper title. Pray, provide one.", "warning");
            return;
        }

        if (id) {
            const index = snippets.findIndex(s => s.id && s.id.toString() === id);
            if (index !== -1) snippets[index] = { ...snippets[index], title, content, updatedAt: Date.now() };
        } else {
            snippets.unshift({ id: Date.now(), title, content, createdAt: Date.now() });
        }

        safeStorage.set('mySnippets', snippets, () => {
            const modal = getModal();
            if(modal) modal.hide();
            // 🟢 Safely check if the search element exists before reading its value
            renderSnippets(els.search ? els.search.value : '');
        });
    }

    function deleteSnippet(id) {
        snippets = snippets.filter(s => s.id !== id);
        safeStorage.set('mySnippets', snippets, () => {
            // 🟢 Safely check if the search element exists before reading its value
            renderSnippets(els.search ? els.search.value : '');
            if (window.showGlobalAlert) window.showGlobalAlert("Expunged", "The snippet has been permanently erased from my archives.", "success");
        });
    }

    function copySnippet(text, btnElement) {
        if (!navigator.clipboard) {
            if (window.showGlobalAlert) window.showGlobalAlert("Error", "Clipboard access denied by the browser.", "error");
            return;
        }
        
        // 🟢 Safely catch promise rejections if copying fails
        navigator.clipboard.writeText(text || '').then(() => {
            btnElement.innerHTML = '<i class="bi bi-check-lg"></i> Copied';
            btnElement.classList.replace('btn-outline-primary', 'btn-success');
            setTimeout(() => {
                btnElement.innerHTML = '<i class="bi bi-clipboard me-1"></i> Copy';
                btnElement.classList.replace('btn-success', 'btn-outline-primary');
            }, 1500);
        }).catch(err => {
            console.warn("Failed to copy snippet: ", err);
            if (window.showGlobalAlert) window.showGlobalAlert("Error", "Failed to copy snippet to clipboard.", "error");
        });
    }

    function renderSnippets(searchTerm = '') {
        if (!els.list) return;
        els.list.innerHTML = '';

        const term = (searchTerm || '').toLowerCase();
        
        // 🟢 Safely handle snippets missing title/content properties
        const filtered = snippets.filter(s => 
            (s.title || '').toLowerCase().includes(term) || 
            (s.content || '').toLowerCase().includes(term)
        );

        if (filtered.length === 0) {
            els.list.innerHTML = `<div class="col-12 text-center text-muted py-3 small">${snippets.length === 0 ? 'No snippets yet.' : 'No matches found.'}</div>`;
            return;
        }

        filtered.forEach(snip => {
            const col = document.createElement('div');
            col.className = 'col-md-6 col-lg-4';
            
            // 🟢 Safely handle empty contents before checking length
            const safeContent = snip.content || '';
            const preview = safeContent.length > 60 ? safeContent.substring(0, 60) + '...' : safeContent;

            col.innerHTML = `
                <div class="card h-100 shadow-sm border-secondary-subtle bg-body-tertiary snippet-card">
                    <div class="card-body d-flex flex-column">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h6 class="fw-bold text-truncate mb-0 text-primary w-75" title="${escapeHtml(snip.title)}">${escapeHtml(snip.title)}</h6>
                            <div class="dropdown">
                                <button class="btn btn-sm btn-link text-secondary p-0" data-bs-toggle="dropdown"><i class="bi bi-three-dots-vertical"></i></button>
                                <ul class="dropdown-menu dropdown-menu-end shadow-sm small">
                                    <li><button class="dropdown-item btn-edit" data-id="${snip.id}"><i class="bi bi-pencil me-2"></i>Edit</button></li>
                                    <li><button class="dropdown-item text-danger btn-delete" data-id="${snip.id}"><i class="bi bi-trash me-2"></i>Delete</button></li>
                                </ul>
                            </div>
                        </div>
                        <div class="p-2 bg-body border rounded flex-grow-1 mb-2 position-relative" style="min-height: 60px;">
                            <code class="text-body-secondary small text-break" style="white-space: pre-wrap;">${escapeHtml(preview)}</code>
                        </div>
                        <button class="btn btn-sm btn-outline-primary w-100 fw-bold btn-copy"><i class="bi bi-clipboard me-1"></i> Copy</button>
                    </div>
                </div>`;

            const copyBtn = col.querySelector('.btn-copy');
            if(copyBtn) copyBtn.addEventListener('click', () => copySnippet(snip.content, copyBtn));
            
            const editBtn = col.querySelector('.btn-edit');
            if(editBtn) editBtn.addEventListener('click', () => openModal(snip));
            
            const delBtn = col.querySelector('.btn-delete');
            let confirmState = false;
            
            if(delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!confirmState) {
                        confirmState = true;
                        delBtn.innerHTML = '<i class="bi bi-exclamation-triangle me-2"></i>Confirm?';
                        setTimeout(() => { confirmState = false; delBtn.innerHTML = '<i class="bi bi-trash me-2"></i>Delete'; }, 3000);
                        return;
                    }
                    deleteSnippet(snip.id);
                });
            }

            els.list.appendChild(col);
        });
    }

    function escapeHtml(text) {
        // Shared helper (scripts/safe_html.js): casts numbers, returns '' for null/undefined.
        return MarquisHtml.esc(text);
    }

    // ==========================================
    // 7. PASSWORD GENERATOR
    // ==========================================
    const pgResult = document.getElementById('pgResult');
    const pgLength = document.getElementById('pgLength');
    const pgLengthVal = document.getElementById('pgLengthVal');
    const pgGenerateBtn = document.getElementById('pgGenerateBtn');
    const pgCopy = document.getElementById('pgCopy');
    
    const pgUpper = document.getElementById('pgUpper');
    const pgLower = document.getElementById('pgLower');
    const pgNumbers = document.getElementById('pgNumbers');
    const pgSymbols = document.getElementById('pgSymbols');
    const pgStrengthBar = document.getElementById('pgStrengthBar');

    const charsUpper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const charsLower = 'abcdefghijklmnopqrstuvwxyz';
    const charsNum = '0123456789';
    const charsSym = '!@#$%^&*()_+~`|}{[]:;?><,./-=';

    if(pgGenerateBtn) {
        pgGenerateBtn.addEventListener('click', generatePassword);
        pgLength.addEventListener('input', (e) => {
            pgLengthVal.innerText = e.target.value;
            generatePassword();
        });
        
        [pgUpper, pgLower, pgNumbers, pgSymbols].forEach(el => {
            el.addEventListener('change', () => {
                if (!pgUpper.checked && !pgLower.checked && !pgNumbers.checked && !pgSymbols.checked) el.checked = true;
                generatePassword();
            });
        });

        pgCopy.addEventListener('click', () => copyToClipboard(pgResult.value, pgCopy));
        generatePassword(); 
    }

    function generatePassword() {
        let charset = "";
        if (pgUpper.checked) charset += charsUpper;
        if (pgLower.checked) charset += charsLower;
        if (pgNumbers.checked) charset += charsNum;
        if (pgSymbols.checked) charset += charsSym;

        const length = parseInt(pgLength.value);
        let password = "";
        
        const required = [];
        if (pgUpper.checked) required.push(charsUpper[Math.floor(Math.random() * charsUpper.length)]);
        if (pgLower.checked) required.push(charsLower[Math.floor(Math.random() * charsLower.length)]);
        if (pgNumbers.checked) required.push(charsNum[Math.floor(Math.random() * charsNum.length)]);
        if (pgSymbols.checked) required.push(charsSym[Math.floor(Math.random() * charsSym.length)]);

        for (let i = 0; i < length - required.length; i++) {
            password += charset.charAt(Math.floor(Math.random() * charset.length));
        }

        password += required.join('');
        password = password.split('').sort(() => 0.5 - Math.random()).join('');

        pgResult.value = password;
        calculateStrength(password);
    }

    function calculateStrength(pw) {
        let score = 0;
        if (pw.length >= 8) score += 1;
        if (pw.length >= 12) score += 1;
        if (/[A-Z]/.test(pw)) score += 1;
        if (/[0-9]/.test(pw)) score += 1;
        if (/[^A-Za-z0-9]/.test(pw)) score += 1;

        let width = '20%', color = 'bg-danger';
        if (score > 1) { width = '40%'; color = 'bg-warning'; }
        if (score > 3) { width = '70%'; color = 'bg-info'; }
        if (score > 4) { width = '100%'; color = 'bg-success'; }

        pgStrengthBar.style.width = width;
        pgStrengthBar.className = `progress-bar ${color}`;
    }

    // ==========================================
    // 8. DUMMY DATA GENERATOR
    // ==========================================
    const ddResult = document.getElementById('ddResult');
    const ddType = document.getElementById('ddType');
    const ddCount = document.getElementById('ddCount');
    const ddGenerateBtn = document.getElementById('ddGenerateBtn');
    const ddCopy = document.getElementById('ddCopy');

    const firstNames = ["James", "Mary", "John", "Jane", "Patricia", "Hannah", "Mark", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica"];
    const lastNames = ["Smith", "Johnson", "Doe", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas"];
    const domains = ["gmail.com", "yahoo.com", "outlook.com", "example.com", "test.org"];
    const streets = ["Main St", "Maple Ave", "Oak Dr", "Cedar Ln", "Park Rd", "Sunset Blvd", "Washington St"];
    const cities = ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio"];

    if (ddGenerateBtn) {
        ddGenerateBtn.addEventListener('click', generateDummyData);
        ddCopy.addEventListener('click', () => copyToClipboard(ddResult.value, ddCopy));
    }

    function generateDummyData() {
        const type = ddType.value;
        const count = Math.min(Math.max(parseInt(ddCount.value) || 1, 1), 50); 
        let results = [];

        for(let i=0; i<count; i++) {
            results.push(getSingleData(type));
        }

        ddResult.value = results.join('\n');
    }

    function getSingleData(type) {
        const fn = firstNames[Math.floor(Math.random() * firstNames.length)];
        const ln = lastNames[Math.floor(Math.random() * lastNames.length)];

        switch(type) {
            case "name": return `${fn} ${ln}`;
            case "email": return `${fn.toLowerCase()}.${ln.toLowerCase()}@${domains[Math.floor(Math.random() * domains.length)]}`;
            case "phone": return `+1 (${Math.floor(Math.random() * 900) + 100}) ${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`;
            case "uuid": 
                // Fallback for crypto.randomUUID on non-secure contexts
                return (typeof crypto.randomUUID === "function") ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                    const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            case "address": 
                return `${Math.floor(Math.random() * 9999) + 1} ${streets[Math.floor(Math.random() * streets.length)]}, ${cities[Math.floor(Math.random() * cities.length)]}`;
            case "date": 
                return new Date(Date.now() + Math.random() * 10000000000).toISOString().split('T')[0];
            case "lorem": return "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
            default: return "";
        }
    }

    function copyToClipboard(text, btnElement) {
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            btnElement.innerHTML = '<i class="bi bi-check-lg text-success"></i>';
            setTimeout(() => btnElement.innerHTML = '<i class="bi bi-clipboard"></i>', 1500);
        });
    }
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'toolkitSection') initToolkit();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('toolkitSelector')) initToolkit();
});