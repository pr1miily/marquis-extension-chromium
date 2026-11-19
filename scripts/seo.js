// ---------------------------
// ULTIMATE SEO SPIDER
// ---------------------------

function initSeo() {
    const ids = ['extractSeoBtn', 'clearSeoBtn', 'generateSeoReportBtn'];
    ids.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', handleSeoAction);
    });

    // --- CSP FIX: Handle Image Errors via JS instead of Inline HTML ---
    const googleIcon = document.getElementById('seoGoogleIcon');
    if (googleIcon) {
        googleIcon.addEventListener('error', function() {
            this.style.display = 'none';
        });
    }

    // Alt Text Overlay Buttons
    const showAltBtn = document.getElementById('toggleAltOverlayBtn');
    if (showAltBtn) showAltBtn.addEventListener('click', () => toggleAltOverlay(true));

    const hideAltBtn = document.getElementById('clearAltOverlayBtn');
    if (hideAltBtn) hideAltBtn.addEventListener('click', () => toggleAltOverlay(false));

    // Image Filter Click Handlers
    document.querySelectorAll('#seoImageFilterControls > div > div').forEach(card => {
        card.addEventListener('click', function() {
            // Reset Styles
            document.querySelectorAll('#seoImageFilterControls > div > div').forEach(c => {
                c.className = 'p-1 border rounded bg-body-tertiary';
            });
            // Set Active Style
            this.className = 'p-1 border rounded bg-primary bg-opacity-10 border-primary';
            
            // Render
            const filter = this.getAttribute('data-filter');
            renderSeoImages(filter);
        });
    });
};

let lastSeoData = null;

function handleSeoAction(e) {
    const id = e.currentTarget.id;
    if (id === 'extractSeoBtn') runSeoSpider();
    if (id === 'clearSeoBtn') clearSeoData();
    if (id === 'generateSeoReportBtn') generateReport();
}

async function runSeoSpider() {
    const btn = document.getElementById("extractSeoBtn");
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> CRAWLING...';
    btn.disabled = true;

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || tab.url.startsWith('chrome://')) {
            throw new Error("Cannot crawl Chrome system pages or Web Store.");
        }

        const [result] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractPageDetails,
            world: 'MAIN'
        });

        if (result && result.result) {
            lastSeoData = result.result;
            populateSeoUI(lastSeoData);
            window.showGlobalAlert("Crawl Complete", "SEO data extracted successfully.", "success");
        }
    } catch (err) {
        window.showGlobalAlert("Crawl Failed", err.message, "error");
    } finally {
        btn.innerHTML = originalContent;
        btn.disabled = false;
    }
}

// --- INJECTED CRAWLER (DOM ACCESS) ---
function extractPageDetails() {
    const getMeta = (n) => document.querySelector(`meta[name="${n}"]`)?.content || null;
    const getProp = (p) => document.querySelector(`meta[property="${p}"]`)?.content || null;
    
    // 1. Text Metrics
    const bodyText = document.body.innerText;
    const wordCount = bodyText.trim().split(/\s+/).length;
    const htmlSize = document.documentElement.outerHTML.length;
    const textSize = bodyText.length;
    const textRatio = ((textSize / htmlSize) * 100).toFixed(1);

    // 2. Schema JSON-LD
    const schemas = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        try { schemas.push(JSON.parse(s.innerText)); } catch(e) {}
    });

    // 3. Links Analysis
    const links = { internal: [], external: [], total: 0 };
    const host = window.location.hostname;
    const seenLinks = new Set();
    
    document.querySelectorAll('a[href]').forEach(a => {
        if(a.href.startsWith('http')) {
            links.total++;
            if(!seenLinks.has(a.href)) {
                seenLinks.add(a.href);
                if(a.href.includes(host)) links.internal.push(a.href);
                else links.external.push(a.href);
            }
        }
    });

    // 4. Headings
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
        tag: h.tagName,
        text: h.innerText.trim().substring(0, 100)
    }));

    // 5. Images
    const images = Array.from(document.images).map(img => ({
        src: img.src,
        alt: img.alt || "",
        hasAlt: !!(img.alt && img.alt.trim().length > 0),
        width: img.naturalWidth || 0,
        height: img.naturalHeight || 0
    })).filter(i => i.width > 10 && i.height > 10 && !i.src.startsWith('data:'));

    return {
        url: window.location.href,
        domain: host,
        title: document.title,
        desc: getMeta('description'),
        robots: getMeta('robots') || 'index, follow',
        canonical: document.querySelector('link[rel="canonical"]')?.href || 'Missing',
        lang: document.documentElement.lang || 'en',
        ogTitle: getProp('og:title'),
        ogDesc: getProp('og:description'),
        ogImage: getProp('og:image'),
        ogSiteName: getProp('og:site_name'),
        wordCount,
        textRatio,
        schemas,
        links,
        headings,
        images,
        time: new Date().toLocaleString()
    };
}

// --- VISUAL OVERLAY FUNCTION ---
function toggleAltOverlay(show) {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if(!tabs[0]) return;
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: (shouldShow) => {
                document.querySelectorAll('.omnidesk-alt-overlay').forEach(el => el.remove());
                
                if (!shouldShow) return;

                document.querySelectorAll('img').forEach(img => {
                    if(img.width < 20 || img.height < 20) return;
                    
                    const hasAlt = img.alt && img.alt.trim().length > 0;
                    const color = hasAlt ? '#198754' : '#dc3545';
                    const text = hasAlt ? `ALT: ${img.alt}` : 'MISSING ALT';
                    
                    const rect = img.getBoundingClientRect();
                    if(rect.width === 0) return;

                    const badge = document.createElement('div');
                    badge.className = 'omnidesk-alt-overlay';
                    badge.textContent = text;
                    badge.style.cssText = `
                        position: absolute;
                        left: ${rect.left + window.scrollX}px;
                        top: ${rect.top + window.scrollY}px;
                        background-color: ${color};
                        color: white;
                        padding: 2px 6px;
                        font-size: 10px;
                        font-weight: bold;
                        border-radius: 4px;
                        z-index: 99999;
                        pointer-events: none;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                        max-width: ${rect.width}px;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    `;
                    document.body.appendChild(badge);
                    img.style.outline = `3px solid ${color}`;
                });
            },
            args: [show]
        });
    });
}

// --- UI POPULATION ---
function populateSeoUI(data) {
    const setText = (id, txt) => { 
        const el = document.getElementById(id); 
        if(el) el.innerText = txt || '-'; 
    };

    // 1. Score & Metrics
    document.getElementById('seoScoreCard').classList.remove('d-none');
    document.getElementById('seoScoreCard').className = "row g-3 mb-4 align-items-center bg-body p-3 rounded border border-secondary-subtle mx-0 shadow-sm animate__animated animate__fadeIn";
    
    setText('seoWordCountBadge', data.wordCount.toLocaleString());
    setText('seoTextRatio', `${data.textRatio}%`);

    let score = 100;
    if(!data.title) score -= 20;
    if(!data.desc) score -= 20;
    if(!data.headings.some(h => h.tag === 'H1')) score -= 10;
    if(data.images.some(i => !i.hasAlt)) score -= 10;
    if(data.wordCount < 300) score -= 10;
    setText('seoScoreValueDisplay', Math.max(0, score));

    // 2. Overview
    setText('seoGoogleTitle', data.title || "Missing Title");
    setText('seoGoogleDesc', data.desc || "Missing Meta Description");
    setText('seoGoogleUrl', data.url);
    setText('seoGoogleSiteName', data.ogSiteName || data.domain);
    setText('seoCanonical', data.canonical);
    setText('seoRobots', data.robots);
    
    const googleIcon = document.getElementById('seoGoogleIcon');
    if(googleIcon) {
        googleIcon.style.display = 'block'; // Reset display
        googleIcon.src = `https://www.google.com/s2/favicons?domain=${data.domain}&sz=64`;
    }

    // Social
    setText('seoSocialTitle', data.ogTitle || data.title);
    setText('seoSocialDesc', data.ogDesc || data.desc);
    setText('seoSocialDomain', data.domain.toUpperCase());
    
    const socialImg = document.getElementById('seoSocialImage');
    const socialPlaceholder = document.getElementById('seoSocialImagePlaceholder');
    if(data.ogImage) {
        socialImg.src = data.ogImage;
        socialImg.classList.remove('d-none');
        socialPlaceholder.classList.add('d-none');
    } else {
        socialImg.classList.add('d-none');
        socialPlaceholder.classList.remove('d-none');
    }

    // 3. Headings
    const h1Count = data.headings.filter(h => h.tag === 'H1').length;
    setText('seoH1Count', `H1: ${h1Count}`);
    
    const hList = document.getElementById('seoHeadersList');
    if(hList) {
        hList.innerHTML = data.headings.length ? data.headings.map(h => {
            const level = parseInt(h.tag.replace('H',''));
            return `<div style="padding-left:${(level-1)*10}px" class="mb-1 text-truncate">
                <span class="badge bg-secondary bg-opacity-25 text-body border me-1" style="width:25px; font-size:var(--mq-fs-xs);">${MarquisHtml.esc(h.tag)}</span> ${MarquisHtml.esc(h.text)}
            </div>`;
        }).join('') : '<div class="text-muted small text-center">No headings found</div>';
    }

    // 4. Links
    setText('seoLinkTotal', data.links.total);
    setText('seoLinkInt', data.links.internal.length);
    setText('seoLinkExt', data.links.external.length);
    
    const linkList = document.getElementById('seoLinksList');
    if(linkList) {
        linkList.innerHTML = data.links.external.slice(0, 50).map(l => 
            `<a href="${MarquisHtml.esc(/^https?:\/\//i.test(l) ? l : '#')}" target="_blank" class="list-group-item list-group-item-action px-0 py-1 border-0 text-truncate text-decoration-none" title="Open Link">
                <i class="bi bi-box-arrow-up-right me-2 text-secondary" style="font-size:var(--mq-fs-xs);"></i>${MarquisHtml.esc(l)}
            </a>`
        ).join('');
        
        // Add click listener for internal extension handling if needed
        linkList.querySelectorAll('a').forEach(a => {
            a.addEventListener('click', (e) => {
                e.preventDefault();
                chrome.tabs.create({ url: a.href, active: false });
            });
        });
    }

    // 5. Schema
    const schemaList = document.getElementById('seoSchemaList');
    if(schemaList) {
        if(data.schemas.length > 0) {
            schemaList.innerHTML = data.schemas.map(s => {
                const type = s['@type'] || 'Unknown Type';
                return `<div class="p-2 border rounded bg-body-tertiary mb-1">
                    <div class="fw-bold text-success small"><i class="bi bi-check-circle me-1"></i> ${MarquisHtml.esc(Array.isArray(type) ? type.join(', ') : type)}</div>
                    <div class="small font-monospace text-muted mt-1 text-truncate">${MarquisHtml.esc(JSON.stringify(s))}</div>
                </div>`;
            }).join('');
        } else {
            schemaList.innerHTML = '<div class="text-muted small text-center p-2">No Schema JSON-LD found.</div>';
        }
    }

    // 6. Images
    const totalImg = data.images.length;
    const badImg = data.images.filter(i => !i.hasAlt).length;
    const goodImg = totalImg - badImg;

    setText('seoImgTotal', totalImg);
    setText('seoImgGood', goodImg);
    setText('seoImgBad', badImg);
    
    renderSeoImages('all');
}

function renderSeoImages(filter) {
    if (!lastSeoData) return;
    
    const list = document.getElementById('seoImagesList');
    let images = lastSeoData.images;

    if (filter === 'good') images = images.filter(i => i.hasAlt);
    if (filter === 'bad') images = images.filter(i => !i.hasAlt);

    if (images.length === 0) {
        list.innerHTML = `<div class="text-center text-muted small py-2">No ${filter} images found.</div>`;
        return;
    }

    list.innerHTML = images.map(img => {
        const badge = img.hasAlt 
            ? `<span class="badge bg-success bg-opacity-10 text-success">OK</span>` 
            : `<span class="badge bg-danger bg-opacity-10 text-danger">MISSING ALT</span>`;
        
        return `
        <div class="d-flex align-items-start gap-2 mb-2 p-2 border rounded bg-body-tertiary">
            <div class="flex-shrink-0 pt-1">
                <img src="${MarquisHtml.esc(img.src)}" alt="" style="width:40px; height:40px; object-fit:cover" class="rounded bg-secondary border">
            </div>
            <div class="flex-grow-1" style="min-width: 0;">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <div class="small fw-bold text-body text-truncate">${img.alt ? MarquisHtml.esc(img.alt) : '<em class="text-muted">No Alt Text</em>'}</div>
                    ${badge}
                </div>
                <div class="small text-muted text-truncate" style="font-size: var(--mq-fs-xs); opacity: 0.8;">
                    <i class="bi bi-link-45deg"></i> ${MarquisHtml.esc(img.src)}
                </div>
            </div>
        </div>`;
    }).join('');
}

function clearSeoData() {
    document.getElementById('seoScoreCard').classList.add('d-none');
    
    // Clear text
    ['seoGoogleTitle','seoGoogleDesc','seoGoogleUrl','seoGoogleSiteName','seoCanonical','seoRobots',
     'seoSocialTitle','seoSocialDesc','seoSocialDomain','seoHeadersList','seoImagesList','seoLinksList','seoSchemaList']
     .forEach(id => {
         const el = document.getElementById(id);
         if(el) el.innerHTML = '';
     });

    // Reset counts
    ['seoScoreValueDisplay','seoWordCountBadge','seoTextRatio','seoH1Count',
     'seoImgTotal','seoImgGood','seoImgBad','seoLinkTotal','seoLinkInt','seoLinkExt']
     .forEach(id => {
         const el = document.getElementById(id);
         if(el) el.innerText = '0';
     });

    lastSeoData = null;
    window.showGlobalAlert("Cleared", "SEO data has been cleared.", "info");
}

// --- REPORT GENERATOR ---
function generateReport() {
    if (!lastSeoData) { 
        window.showGlobalAlert("No Data", "Please run the crawl first before generating a report.", "warning");
        return; 
    }
    
    const d = lastSeoData;
    const now = new Date().toLocaleString();
    // Everything in d comes from the audited page; the report is opened as an extension-origin page.
    const esc = MarquisHtml.esc;
    
    const appIcon = chrome.runtime.getURL("img/46087a1c-4b4d-4a36-a268-1b57cb06908c.png");
    
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SEO Audit: ${esc(d.domain)}</title>
        <link rel="icon" type="image/png" href="${appIcon}">
        <link href="${chrome.runtime.getURL('styles/bootstrap.min.css')}" rel="stylesheet">
        <link rel="stylesheet" href="${chrome.runtime.getURL('styles/bootstrap-icons.css')}">
        <style>
            body { background: #f4f6f8; font-family: 'Segoe UI', sans-serif; padding-top: 40px; padding-bottom: 50px; }
            .header { background: #2c3e50; color: white; padding: 2rem 0; border-bottom: 5px solid #3498db; }
            .card { border: none; box-shadow: 0 2px 5px rgba(0,0,0,0.05); margin-bottom: 1.5rem; }
            .card-header { background: white; font-weight: bold; border-bottom: 1px solid #eee; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 1px; color: #7f8c8d; }
            .metric { font-size: 2rem; font-weight: bold; color: #2c3e50; }
            .metric-label { font-size: 0.8rem; text-transform: uppercase; color: #95a5a6; }
            table { font-size: 0.9rem; }
            .container { max-width: 1200px; }
        </style>
    </head>
    <body>
        <div class="header mb-3">
            <div class="container">
                <div class="d-flex align-items-center mb-2">
                    <img src="${appIcon}" width="48" height="48" class="me-3 rounded bg-white p-1">
                    <h1 class="h3 mb-0">SEO Report</h1>
                </div>
                <div class="opacity-75 small">Generated: ${now} | URL: ${esc(d.url)}</div>
            </div>
        </div>

        <div class="container">
            <div class="row g-2 mb-3 text-center">
                <div class="col-md-3"><div class="card p-3 h-100"><div class="metric text-primary">${d.wordCount}</div><div class="metric-label">Word Count</div></div></div>
                <div class="col-md-3"><div class="card p-3 h-100"><div class="metric text-info">${d.textRatio}%</div><div class="metric-label">Text Ratio</div></div></div>
                <div class="col-md-3"><div class="card p-3 h-100"><div class="metric text-success">${d.links.internal.length}</div><div class="metric-label">Int. Links</div></div></div>
                <div class="col-md-3"><div class="card p-3 h-100"><div class="metric text-danger">${d.images.filter(i=>!i.hasAlt).length}</div><div class="metric-label">Missing Alt</div></div></div>
            </div>

            <div class="row g-2">
                <div class="col-md-6">
                    <div class="card h-100">
                        <div class="card-header">Metadata & Config</div>
                        <div class="card-body">
                            <table class="table table-borderless align-middle">
                                <tr><td class="fw-bold text-secondary" width="120">Title</td><td>${d.title ? esc(d.title) : '<span class="badge bg-danger">Missing</span>'}</td></tr>
                                <tr><td class="fw-bold text-secondary">Desc</td><td>${d.desc ? esc(d.desc) : '<span class="badge bg-danger">Missing</span>'}</td></tr>
                                <tr><td class="fw-bold text-secondary">Canonical</td><td class="font-monospace small text-break">${esc(d.canonical)}</td></tr>
                                <tr><td class="fw-bold text-secondary">Robots</td><td><span class="badge bg-light text-dark border">${esc(d.robots)}</span></td></tr>
                            </table>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="card h-100">
                        <div class="card-header">Headings Structure</div>
                        <div class="card-body overflow-auto" style="max-height:300px">
                            ${d.headings.map(h=>{
                                const l = parseInt(h.tag.replace('H',''));
                                return `<div style="padding-left:${(l-1)*15}px" class="mb-1 small"><span class="badge bg-secondary opacity-50 me-2">${esc(h.tag)}</span>${esc(h.text)}</div>`
                            }).join('')}
                        </div>
                    </div>
                </div>
            </div>

            <div class="card mt-3">
                <div class="card-header">Images Analysis (Missing Alt Text)</div>
                <div class="card-body p-0">
                    <table class="table table-striped mb-0">
                        <thead><tr class="table-light"><th>Preview</th><th>Alt Text</th><th>Source</th></tr></thead>
                        <tbody>
                            ${d.images.filter(i=>!i.hasAlt).map(i=>`
                                <tr>
                                    <td width="60"><img src="${esc(i.src)}" alt="" width="40" height="40" style="object-fit:cover" class="rounded border"></td>
                                    <td><span class="badge bg-danger bg-opacity-10 text-danger">MISSING</span></td>
                                    <td class="small text-muted text-break">${esc(i.src)}</td>
                                </tr>
                            `).join('')}
                            ${d.images.filter(i=>!i.hasAlt).length === 0 ? '<tr><td colspan="3" class="text-center py-2 text-success">All images have alt text.</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </body>
    </html>`;

    // Explicitly set UTF-8 for the Blob
    const blob = new Blob([html], {type: 'text/html;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    chrome.tabs.create({ url: url });
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'seoSection') initSeo();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('seoGoogleIcon')) initSeo();
});