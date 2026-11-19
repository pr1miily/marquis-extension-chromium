function initScraper() {
    
    let currentScrapedData = [];

    const isRestrictedUrl = (url) => {
        if (!url) return true;
        const prefixes = ['chrome://', 'edge://', 'about:', 'chrome-extension://'];
        const domains = ['chrome.google.com/webstore', 'chromewebstore.google.com'];
        return prefixes.some(p => url.startsWith(p)) || domains.some(d => url.includes(d));
    };

    // --- 1. SMART HEURISTICS ENGINE ---
    document.querySelectorAll('.scraper-smart-btn').forEach(btn => {
        btn.addEventListener('click', async function() {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (isRestrictedUrl(tab.url)) {
                window.showGlobalAlert("Domain Secured", "The Marquis cannot extract data from Chrome system pages. Their defenses are quite absolute.", "error");
                return;
            }

            const mode = this.getAttribute('data-smart');
            const doPaginate = document.getElementById('scraperPaginateToggle').checked;
            
            // Visual loading state
            const originalHtml = this.innerHTML;
            this.innerHTML = '<div class="spinner-border spinner-border-sm text-primary mb-2"></div><span class="fw-bold small text-body">Scraping...</span>';
            
            runSmartScraper(tab.id, mode, doPaginate, this, originalHtml);
        });
    });

    function runSmartScraper(tabId, mode, doPaginate, btnElement, originalHtml) {
        chrome.scripting.executeScript({
            target: {tabId: tabId},
            func: async (scrapeMode, paginateEnabled) => {
                
                const MAX_PAGES = paginateEnabled ? 5 : 1;
                let allData = [];
                let pagesScraped = 0;
                
                // Helper: Safely get text from live DOM or detached DOM Parser
                const getText = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');

                // Helper: Hunts for the "Next Page" button
                function getNextUrl(doc) {
                    const nextBtn = Array.from(doc.querySelectorAll('a')).find(a => {
                        const text = getText(a).toLowerCase();
                        const rel = (a.getAttribute('rel') || '').toLowerCase();
                        const aria = (a.getAttribute('aria-label') || '').toLowerCase();
                        const cls = (a.className || '').toLowerCase();
                        return (
                            text === 'next' || text === 'next page' || text.includes('next »') || 
                            text === '>' || text === '»' || text === '→' || 
                            rel.includes('next') || aria.includes('next') || cls.includes('next') || cls.includes('pagination')
                        ) && a.href && !a.href.startsWith('javascript');
                    });
                    return nextBtn ? nextBtn.href : null;
                }

                // Core Extraction Heuristics
                function extractFromDoc(doc, pageNum) {
                    let data = [];
                    
                    if (scrapeMode === 'tables') {
                        const tables = doc.querySelectorAll('table');
                        tables.forEach((table, tIdx) => {
                            const headers = Array.from(table.querySelectorAll('th')).map(th => getText(th));
                            const rows = Array.from(table.querySelectorAll('tr'));
                            rows.forEach(row => {
                                const cells = Array.from(row.querySelectorAll('td')).map(td => getText(td));
                                if (cells.length > 0) {
                                    let obj = paginateEnabled ? { "Page #": pageNum, "Table ID": `Table ${tIdx + 1}` } : { "Table ID": `Table ${tIdx + 1}` };
                                    cells.forEach((cell, i) => { obj[headers[i] || `Column ${i+1}`] = cell; });
                                    data.push(obj);
                                }
                            });
                        });
                    } 
                    else if (scrapeMode === 'products') {
                        const cards = doc.querySelectorAll('article, [class*="product" i], [class*="item" i], [class*="card" i]');
                        const seen = new Set();
                        cards.forEach(card => {
                            if(seen.has(card)) return;
                            const titleEl = card.querySelector('h1, h2, h3, h4, [class*="title" i], [class*="name" i]');
                            const imgEl = card.querySelector('img');
                            const linkEl = card.querySelector('a');

                            // 🟢 UPGRADED: Smart Price Extraction
                            let priceText = "N/A";
                            const priceEl = card.querySelector('[class*="price" i], [data-price]');
                            
                            // 1. Try semantic class first (fastest)
                            if (priceEl && /\d/.test(getText(priceEl))) {
                                priceText = getText(priceEl);
                            } else {
                                // 2. Currency Regex Fallback: Hunts for symbols ($ € £ ¥ ₱ ₹ ₽) or codes (USD, PHP, etc) + numbers
                                const cardText = getText(card);
                                const priceMatch = cardText.match(/(?:[\$€£¥₱₹₽]|(?:USD|EUR|GBP|PHP)\s?)\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?/i);
                                if (priceMatch) priceText = priceMatch[0];
                            }

                            if (titleEl && (priceText !== "N/A" || imgEl)) {
                                let obj = {
                                    "Product Name": getText(titleEl),
                                    "Price": priceText,
                                    "Image URL": imgEl ? (imgEl.src || imgEl.getAttribute('data-src')) : "N/A",
                                    "Product Link": linkEl ? linkEl.href : "N/A"
                                };
                                if (paginateEnabled) obj["Page #"] = pageNum;
                                data.push(obj);
                                seen.add(card);
                            }
                        });
                    }
                    else if (scrapeMode === 'articles') {
                        const posts = doc.querySelectorAll('article, [class*="post" i], [class*="article" i]');
                        posts.forEach(post => {
                            const title = post.querySelector('h1, h2, h3');
                            const link = post.querySelector('a');
                            const excerpt = post.querySelector('p');
                            const date = post.querySelector('time, [class*="date" i]');
                            if (title && excerpt) {
                                let obj = {
                                    "Headline": getText(title),
                                    "Excerpt": getText(excerpt).substring(0, 150) + '...',
                                    "Date/Time": date ? getText(date) : "N/A",
                                    "Read Link": link ? link.href : "N/A"
                                };
                                if (paginateEnabled) obj["Page #"] = pageNum;
                                data.push(obj);
                            }
                        });
                    }
                    else if (scrapeMode === 'media') {
                        const mediaEls = doc.querySelectorAll('img, video, audio');
                        mediaEls.forEach(el => {
                            const src = el.src || el.currentSrc || el.getAttribute('data-src');
                            // Exclude tiny tracker images and icons
                            if (src && !src.startsWith('data:') && (el.tagName !== 'IMG' || (el.width > 20 || el.naturalWidth > 20 || !el.width))) {
                                const link = el.closest('a');
                                let obj = {
                                    "Media Type": el.tagName.toLowerCase(),
                                    "Source URL": src,
                                    "Wrapper Link": link ? link.href : "None",
                                    "Alt / Title": el.alt || el.title || "Missing"
                                };
                                if (paginateEnabled) obj["Page #"] = pageNum;
                                data.push(obj);
                            }
                        });
                    }
                    else if (scrapeMode === 'contacts') {
                        const text = doc.body.textContent || "";
                        const emails = text.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g) || [];
                        const phones = text.match(/(?:(?:\+?1\s*(?:[.-]\s*)?)?(?:\(\s*([2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9])\s*\)|([2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9]))\s*(?:[.-]\s*)?)?([2-9]1[02-9]|[2-9][02-9]1|[2-9][02-9]{2})\s*(?:[.-]\s*)?([0-9]{4})(?:\s*(?:#|x\.?|ext\.?|extension)\s*(\d+))?/g) || [];
                        
                        [...new Set(emails)].forEach(e => {
                            let obj = { "Contact Type": "Email", "Value": e };
                            if(paginateEnabled) obj["Page #"] = pageNum;
                            data.push(obj);
                        });
                        [...new Set(phones)].forEach(p => { 
                            if(p.length > 7) {
                                let obj = { "Contact Type": "Phone", "Value": p.trim() };
                                if(paginateEnabled) obj["Page #"] = pageNum;
                                data.push(obj);
                            }
                        });
                    }
                    else if (scrapeMode === 'links') {
                        const links = doc.querySelectorAll('a[href]');
                        links.forEach(a => {
                            if (a.href && !a.href.startsWith('javascript:')) {
                                let obj = {
                                    "Anchor Text": getText(a) || "[Image/Icon Link]",
                                    "Destination URL": a.href,
                                    "Target": a.target || "_self"
                                };
                                if(paginateEnabled) obj["Page #"] = pageNum;
                                data.push(obj);
                            }
                        });
                    }
                    return data;
                }

                // --- Background Pagination Execution ---
                let currentDoc = document;
                let nextUrl = null;

                while (pagesScraped < MAX_PAGES) {
                    pagesScraped++;
                    const pageData = extractFromDoc(currentDoc, pagesScraped);
                    allData.push(...pageData);
                    
                    if (paginateEnabled && pageData.length > 0) {
                        nextUrl = getNextUrl(currentDoc);
                        if (!nextUrl) break; 
                        
                        try {
                            // Silently fetch the next page in the background
                            const res = await fetch(nextUrl);
                            const html = await res.text();
                            // Parse it into a detached DOM
                            currentDoc = new DOMParser().parseFromString(html, 'text/html');
                            // Fix relative URLs by injecting a base tag
                            const base = currentDoc.createElement('base');
                            base.href = nextUrl;
                            currentDoc.head.appendChild(base);
                        } catch(e) {
                            break;
                        }
                    } else {
                        break;
                    }
                }
                return { data: allData, pages: pagesScraped };
            },
            args: [mode, doPaginate]
        }, (results) => {
            btnElement.innerHTML = originalHtml; // Restore button UI

            if (results && results[0]) {
                const payload = results[0].result;
                if (!payload || !payload.data || payload.data.length === 0) {
                    window.showGlobalAlert("No Data Found", `The Marquis could not identify any ${mode} structures on this page.`, "warning");
                } else {
                    const pageMsg = payload.pages > 1 ? ` across ${payload.pages} pages` : '';
                    window.showGlobalAlert("Success", `Extracted ${payload.data.length} intelligent records${pageMsg}.`, "success");
                    displayTableResults(payload.data);
                }
            }
        });
    }

    // --- 2. ADVANCED SETUP LOGIC ---
    const fieldsContainer = document.getElementById('advFieldsContainer');
    document.getElementById('addScraperFieldBtn').addEventListener('click', () => {
        const row = document.createElement('div');
        row.className = 'input-group input-group-sm adv-field-row mb-2 animate__animated animate__fadeIn';
        row.innerHTML = `
            <input type="text" class="form-control field-name bg-body fw-bold" placeholder="Col Name">
            <input type="text" class="form-control field-selector font-monospace bg-body" placeholder="Selector">
            <select class="form-select field-attr bg-body" style="max-width: 90px;">
                <option value="text">Text</option>
                <option value="href">Href</option>
                <option value="src">Src</option>
                <option value="html">HTML</option>
            </select>
            <button class="btn btn-danger remove-field-btn"><i class="bi bi-x-lg"></i></button>
        `;
        fieldsContainer.appendChild(row);
    });

    if (fieldsContainer) {
        fieldsContainer.addEventListener('click', function(e) {
            const removeBtn = e.target.closest('.remove-field-btn');
            if (removeBtn) removeBtn.closest('.adv-field-row').remove();
        });
    }

    document.getElementById('advScrapeRunBtn').addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (isRestrictedUrl(tab.url)) return window.showGlobalAlert("Security Restriction", "Chrome restricts data extraction here.", "error");

        const parentSelector = document.getElementById('advParentSelector').value.trim();
        if (!parentSelector) return window.showGlobalAlert("Missing Selector", "Please enter a Container Selector.", "warning");

        const config = [];
        document.querySelectorAll('.adv-field-row').forEach(row => {
            const name = row.querySelector('.field-name').value.trim() || 'Column';
            const sel = row.querySelector('.field-selector').value.trim();
            const attr = row.querySelector('.field-attr').value;
            if (sel) config.push({ name, selector: sel, attr });
        });

        if (config.length === 0) return window.showGlobalAlert("Configuration Error", "Define at least one child selector.", "warning");

        const btn = document.getElementById('advScrapeRunBtn');
        const originalBtnText = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Extracting...';
        const doPaginate = document.getElementById('scraperPaginateToggle').checked;

        chrome.scripting.executeScript({
            target: {tabId: tab.id},
            func: async (pSel, cfg, paginateEnabled) => {
                const MAX_PAGES = paginateEnabled ? 5 : 1;
                let allData = [];
                let pagesScraped = 0;
                
                const getText = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');

                function getNextUrl(doc) {
                    const nextBtn = Array.from(doc.querySelectorAll('a')).find(a => {
                        const text = getText(a).toLowerCase();
                        const rel = (a.getAttribute('rel') || '').toLowerCase();
                        const aria = (a.getAttribute('aria-label') || '').toLowerCase();
                        const cls = (a.className || '').toLowerCase();
                        return (
                            text === 'next' || text === 'next page' || text.includes('next »') || 
                            text === '>' || text === '»' || text === '→' || 
                            rel.includes('next') || aria.includes('next') || cls.includes('next') || cls.includes('pagination')
                        ) && a.href && !a.href.startsWith('javascript');
                    });
                    return nextBtn ? nextBtn.href : null;
                }

                function extractAdvanced(doc, pageNum) {
                    const parents = doc.querySelectorAll(pSel);
                    const res = [];
                    parents.forEach(parent => {
                        const rowData = {};
                        let hasData = false;
                        
                        if (paginateEnabled) rowData["Page #"] = pageNum;

                        cfg.forEach(field => {
                            const child = parent.querySelector(field.selector);
                            let val = '';
                            if (child) {
                                if (field.attr === 'text') val = getText(child);
                                else if (field.attr === 'href') val = child.href;
                                else if (field.attr === 'src') val = child.src || child.getAttribute('data-src');
                                else if (field.attr === 'html') val = child.innerHTML.trim();
                                hasData = true;
                            }
                            rowData[field.name] = val;
                        });
                        if (hasData) res.push(rowData);
                    });
                    return res;
                }

                let currentDoc = document;
                let nextUrl = null;

                while (pagesScraped < MAX_PAGES) {
                    pagesScraped++;
                    const pageData = extractAdvanced(currentDoc, pagesScraped);
                    allData.push(...pageData);
                    
                    if (paginateEnabled && pageData.length > 0) {
                        nextUrl = getNextUrl(currentDoc);
                        if (!nextUrl) break; 
                        
                        try {
                            const res = await fetch(nextUrl);
                            const html = await res.text();
                            currentDoc = new DOMParser().parseFromString(html, 'text/html');
                            const base = currentDoc.createElement('base');
                            base.href = nextUrl;
                            currentDoc.head.appendChild(base);
                        } catch(e) {
                            break;
                        }
                    } else {
                        break;
                    }
                }
                return { data: allData, pages: pagesScraped };
            },
            args: [parentSelector, config, doPaginate]
        }, (results) => {
            btn.innerHTML = originalBtnText;
            if (results && results[0]) {
                const payload = results[0].result;
                if (!payload || !payload.data || payload.data.length === 0) {
                    window.showGlobalAlert("No Results", "No data found matching your selectors.", "info");
                } else {
                    const pageMsg = payload.pages > 1 ? ` across ${payload.pages} pages` : '';
                    window.showGlobalAlert("Success", `Extracted ${payload.data.length} rows${pageMsg}.`, "success");
                    displayTableResults(payload.data);
                }
            }
        });
    });

    // --- 3. DATA RENDERING & EXPORT ---
    function displayTableResults(data) {
        const resultsArea = document.getElementById('scraperResultsArea');
        const tableHeader = document.getElementById('scraperTableHeader');
        const tableBody = document.getElementById('scraperTableBody');
        const countBadge = document.getElementById('scraperCount');
        const tableEl = document.getElementById('scraperPreviewTable');
        
        resultsArea.classList.remove('d-none');
        tableHeader.innerHTML = ''; tableBody.innerHTML = '';
        if (tableEl) tableEl.classList.add('text-nowrap'); // 🟢 FIXED: Prevents Bootstrap from squishing columns
        currentScrapedData = data; 

        if (!data || data.length === 0) {
            countBadge.textContent = "0 Rows Found";
            countBadge.className = "badge bg-secondary fs-6 shadow-sm";
            return;
        }

        countBadge.textContent = `${data.length} Rows Found`;
        countBadge.className = "badge bg-success fs-6 shadow-sm";

        const headers = Object.keys(data[0]);
        headers.forEach(h => {
            const th = document.createElement('th');
            th.textContent = h;
            tableHeader.appendChild(th);
        });

        data.slice(0, 50).forEach(row => {
            const tr = document.createElement('tr');
            headers.forEach(h => {
                const td = document.createElement('td');
                const text = row[h] || '';
                td.textContent = text.length > 50 ? text.substring(0, 50) + '...' : text;
                td.title = text; 
                tr.appendChild(td);
            });
            tableBody.appendChild(tr);
        });
    }

    function getCsvText() {
        if (!currentScrapedData || currentScrapedData.length === 0) return null;
        const headers = Object.keys(currentScrapedData[0]);
        const csvRows = [headers.join(',')];
        for (const row of currentScrapedData) {
            const values = headers.map(h => `"${('' + (row[h] || '')).replace(/"/g, '""')}"`);
            csvRows.push(values.join(','));
        }
        return csvRows.join('\n');
    }

    document.getElementById('scraperCopyCsvBtn')?.addEventListener('click', function() {
        const csvText = getCsvText();
        if (!csvText) return;
        navigator.clipboard.writeText(csvText).then(() => {
            window.showGlobalAlert("Copied", "CSV data copied to clipboard.", "success");
        });
    });

    document.getElementById('scraperDownloadCsvBtn')?.addEventListener('click', function() {
        const csvText = getCsvText();
        if (!csvText) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csvText], { type: 'text/csv' }));
        a.download = `Marquis_Scrape_${Date.now()}.csv`;
        a.click();
    });
    
    document.getElementById('scraperClearBtn')?.addEventListener('click', () => {
        document.getElementById('scraperResultsArea').classList.add('d-none');
        currentScrapedData = [];
    });
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'scraperSection') initScraper();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('scraperPaginateToggle')) initScraper();
});