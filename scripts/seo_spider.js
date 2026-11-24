// SEO Spider page (seo_spider.html). MarquisSeoCrawler (scripts/seo_crawler.js) crawls; this file runs it, shows
// live progress and the result. storage.local: seoLastCrawl (the last result, reviewed on reopen without crawling
// again), seoCrawlOptions (the form). ?url=<address>&start=1 (from the popup) fills the address and starts.
(() => {
    const $ = (id) => document.getElementById(id);
    const esc = MarquisHtml.esc;
    const { ISSUES } = MarquisSeoCrawler;
    const SEV = {
        critical: { label: 'Critical', cls: 'danger', icon: 'x-octagon-fill', rank: 0 },
        warning: { label: 'Warning', cls: 'warning', icon: 'exclamation-triangle-fill', rank: 1 },
        info: { label: 'Info', cls: 'info', icon: 'info-circle-fill', rank: 2 }
    };
    const PAGE_LIMIT = 500; // table rows drawn at once; filters reach the rest
    let result = null, controller = null, ticker = 0, startedAt = 0;
    const view = { severity: 'all', issueQ: '', pageStatus: 'all', pageQ: '', open: new Set() };

    const short = (url) => { try { const u = new URL(url); return result && u.host === new URL(result.site.startUrl).host ? (u.pathname + u.search) : u.href; } catch { return url; } };
    const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

    // ── Options ───────────────────────────────────────────────
    const OPTION_IDS = { maxPages: 'optMaxPages', maxDepth: 'optMaxDepth', scope: 'optScope', concurrency: 'optConcurrency', delayMs: 'optDelay',
        include: 'optInclude', exclude: 'optExclude', useSitemap: 'optSitemap', stripTracking: 'optTracking', ignoreQuery: 'optIgnoreQuery', checkResources: 'optResources' };
    const isBool = (k) => ['useSitemap', 'stripTracking', 'ignoreQuery', 'checkResources'].includes(k);
    function readOptions() {
        const o = {};
        for (const [k, id] of Object.entries(OPTION_IDS)) o[k] = isBool(k) ? $(id).checked : $(id).value;
        return o;
    }
    function writeOptions(o = {}) {
        for (const [k, id] of Object.entries(OPTION_IDS)) if (k in o) { if (isBool(k)) $(id).checked = !!o[k]; else $(id).value = o[k]; }
    }
    const patterns = (s) => String(s || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean);

    // ── Crawl ─────────────────────────────────────────────────
    async function start(e) {
        e?.preventDefault();
        if (controller) return;
        const raw = readOptions();
        chrome.storage.local.set({ seoCrawlOptions: raw });
        const config = {
            startUrl: $('startUrl').value.trim(),
            maxPages: Number(raw.maxPages) || 200, maxDepth: Math.max(0, Number(raw.maxDepth) || 0), scope: raw.scope,
            concurrency: Number(raw.concurrency) || 3, delayMs: Math.max(0, Number(raw.delayMs) || 0),
            include: patterns(raw.include), exclude: patterns(raw.exclude),
            useSitemap: raw.useSitemap, stripTracking: raw.stripTracking, ignoreQuery: raw.ignoreQuery, checkResources: raw.checkResources
        };
        if (!config.startUrl) return;
        controller = new AbortController();
        startedAt = Date.now();
        setRunning(true);
        let host = config.startUrl;
        try { host = new URL(/^https?:\/\//i.test(host) ? host : `https://${host}`).host; } catch {}
        setStatus('Crawling', 'primary', `Starting ${host}: reading robots.txt and the sitemap...`, 0);
        ticker = setInterval(() => { $('statusElapsed').textContent = clock(Date.now() - startedAt); }, 1000);
        try {
            const res = await MarquisSeoCrawler.crawl(config, {
                signal: controller.signal,
                onProgress: (p) => {
                    const total = Math.min(config.maxPages, Math.max(p.discovered, p.crawled));
                    const extra = [p.failed && `${p.failed} errors`, p.blocked && `${p.blocked} blocked`].filter(Boolean).join(' · ');
                    setStatus('Crawling', 'primary', `${host} · ${p.crawled} crawled · ${p.discovered} found · ${p.queued} waiting${extra ? ` · ${extra}` : ''}`,
                        total ? p.crawled / total * 100 : 0, p.current);
                }
            });
            result = res;
            const time = clock(res.endedAt - res.startedAt);
            if (res.state === 'stopped') setStatus('Stopped', 'warning', `Stopped after ${res.stats.pages} pages (${time}). The results below cover what was crawled.`, 100);
            else setStatus('Completed', 'success', `Crawled ${res.stats.pages} pages of ${host} in ${time}.`, 100);
            await chrome.storage.local.set({ seoLastCrawl: res }).catch(() => {});
            renderResult();
            if (document.visibilityState !== 'visible') {
                chrome.runtime.sendMessage({ action: 'notify', event: { source: 'seo', level: res.stats.critical ? 'error' : 'success', title: res.state === 'stopped' ? 'Crawl stopped' : 'Crawl finished',
                    message: `${host}: ${res.stats.pages} pages, ${res.stats.critical} critical and ${res.stats.warning} warning issues.` } }).catch(() => {});
            }
        } catch (err) {
            setStatus('Failed', 'danger', err.message || 'The crawl failed.', 0);
        } finally {
            clearInterval(ticker);
            controller = null;
            setRunning(false);
        }
    }

    function setRunning(on) {
        $('startBtn').classList.toggle('d-none', on);
        $('stopBtn').classList.toggle('d-none', !on);
        $('stopBtn').disabled = false;
        $('startUrl').disabled = on;
        document.querySelectorAll('#crawlOptions input, #crawlOptions select').forEach(el => { el.disabled = on; });
        $('exportMenuBtn').disabled = on || !result;
    }

    function setStatus(label, tone, text, pct, current = '') {
        $('crawlStatus').classList.remove('d-none');
        $('emptyState').classList.add('d-none');
        $('statusBadge').className = `badge rounded-pill bg-${tone}`;
        $('statusBadge').textContent = label;
        $('statusText').textContent = text;
        $('statusBar').style.width = `${Math.min(100, Math.round(pct))}%`;
        $('statusBar').parentElement.setAttribute('aria-valuenow', String(Math.round(pct)));
        $('statusBar').parentElement.classList.toggle('d-none', label !== 'Crawling');
        $('statusCurrent').textContent = current;
    }

    // ── Result ────────────────────────────────────────────────
    function renderResult() {
        if (!result) return;
        $('results').classList.remove('d-none');
        $('emptyState').classList.add('d-none');
        $('exportMenuBtn').disabled = !!controller;
        $('statusNotes').replaceChildren(...result.site.notes.map(n => Object.assign(document.createElement('li'), { textContent: n })));
        const s = result.stats;
        const tile = (value, label, tone = '') => `<div class="seo-tile"><div class="seo-tile-value ${tone ? `text-${tone}` : ''}">${value}</div><div class="seo-tile-label">${label}</div></div>`;
        $('summaryTiles').innerHTML = [
            tile(s.pages, 'Pages crawled'),
            tile(s.ok, 'OK (2xx)', 'success'),
            tile(s.redirected, 'Redirects'),
            tile(s.errors + s.failed, 'Errors and failures', s.errors + s.failed ? 'danger' : ''),
            tile(s.blocked, 'Blocked by robots.txt'),
            tile(`<span class="text-danger">${s.critical}</span> / <span class="text-warning">${s.warning}</span> / <span class="text-info">${s.info}</span>`, 'Critical / warning / info')
        ].join('');
        renderSeverityFilter();
        renderIssues();
        renderPages();
        renderSite();
    }

    function issueGroups() {
        const groups = new Map();
        for (const i of result.issues) groups.set(i.code, [...(groups.get(i.code) || []), i]);
        return [...groups].map(([code, items]) => ({ code, def: ISSUES[code], items }));
    }

    function renderSeverityFilter() {
        const counts = { all: result.issues.length, critical: result.stats.critical, warning: result.stats.warning, info: result.stats.info };
        $('severityFilter').innerHTML = ['all', 'critical', 'warning', 'info'].map(k => `
            <input type="radio" class="btn-check" name="sevFilter" id="sev_${k}" value="${k}" ${view.severity === k ? 'checked' : ''}>
            <label class="btn btn-outline-secondary" for="sev_${k}">${k === 'all' ? 'All' : SEV[k].label} <span class="opacity-75">${counts[k]}</span></label>`).join('');
    }

    function renderIssues() {
        const q = view.issueQ.toLowerCase();
        const rows = issueGroups()
            .filter(g => view.severity === 'all' || g.def.severity === view.severity)
            .map(g => {
                if (!q || `${g.def.title} ${g.def.category}`.toLowerCase().includes(q)) return g;
                return { ...g, items: g.items.filter(i => `${i.url} ${i.detail || ''}`.toLowerCase().includes(q)) };
            })
            .filter(g => g.items.length)
            .sort((a, b) => SEV[a.def.severity].rank - SEV[b.def.severity].rank || b.items.length - a.items.length);
        if (!rows.length) {
            $('issueList').innerHTML = `<div class="mq-home-empty">${result.issues.length ? 'No issue matches this filter.' : 'No issues found in the crawled pages.'}</div>`;
            return;
        }
        $('issueList').innerHTML = rows.map(g => {
            const sev = SEV[g.def.severity], open = view.open.has(g.code);
            const urls = g.items.slice(0, 100).map(i => `<li><button type="button" class="seo-url" data-url="${esc(i.url)}" title="${esc(i.url)}">${esc(short(i.url))}</button>${i.detail ? `<span class="seo-detail">${esc(i.detail)}</span>` : ''}</li>`).join('');
            return `<div class="seo-issue${open ? ' is-open' : ''}">
                <button type="button" class="seo-issue-head" data-code="${esc(g.code)}" aria-expanded="${open}">
                    <i class="bi bi-${sev.icon} text-${sev.cls}" aria-label="${sev.label}"></i>
                    <span class="seo-issue-title">${esc(g.def.title)}</span>
                    <span class="seo-issue-cat">${esc(g.def.category)}</span>
                    <span class="badge rounded-pill bg-secondary ms-auto">${g.items.length}</span>
                    <i class="bi bi-chevron-${open ? 'up' : 'down'} text-muted" aria-hidden="true"></i>
                </button>
                ${open ? `<div class="seo-issue-body">
                    <p class="mb-1"><span class="fw-bold">Why it matters:</span> ${esc(g.def.why)}</p>
                    <p class="mb-2"><span class="fw-bold">How to fix:</span> ${esc(g.def.fix)}</p>
                    <ul class="seo-urls">${urls}</ul>
                    ${g.items.length > 100 ? `<div class="small text-muted">and ${g.items.length - 100} more (see the Issues export).</div>` : ''}
                </div>` : ''}
            </div>`;
        }).join('');
    }

    const worst = (p) => p.issues.map(c => ISSUES[c].severity).sort((a, b) => SEV[a].rank - SEV[b].rank)[0];
    function statusOf(p) {
        if (p.blocked) return { text: 'Blocked', tone: 'secondary' };
        if (p.error) return { text: 'Failed', tone: 'danger' };
        if (p.status >= 400) return { text: String(p.status), tone: 'danger' };
        if (p.redirected) return { text: 'Redirect', tone: 'warning' };
        return { text: String(p.status), tone: 'success' };
    }
    function renderPages() {
        const q = view.pageQ.toLowerCase(), f = view.pageStatus;
        const rows = result.pages.filter(p => {
            if (f === 'ok' && !(p.status >= 200 && p.status < 300 && !p.redirected)) return false;
            if (f === 'redirect' && !p.redirected) return false;
            if (f === 'error' && !(p.error || p.status >= 400)) return false;
            if (f === 'blocked' && !p.blocked) return false;
            if (f === 'issues' && worst(p) !== 'critical') return false;
            return !q || `${p.url} ${p.title || ''}`.toLowerCase().includes(q);
        }).sort((a, b) => (a.depth - b.depth) || a.url.localeCompare(b.url));
        $('pageRows').innerHTML = rows.slice(0, PAGE_LIMIT).map(p => {
            const st = statusOf(p), w = worst(p);
            return `<tr data-url="${esc(p.url)}" tabindex="0">
                <td class="seo-cell-url" title="${esc(p.url)}">${esc(short(p.url))}</td>
                <td><span class="badge bg-${st.tone}-subtle text-${st.tone}-emphasis border border-${st.tone}-subtle">${esc(st.text)}</span></td>
                <td class="seo-cell-title" title="${esc(p.title || '')}">${esc(p.title || '')}</td>
                <td class="text-end">${p.depth ?? ''}</td>
                <td class="text-end">${p.ms != null ? `${p.ms} ms` : ''}</td>
                <td class="text-end">${p.issues.length ? `<span class="text-${SEV[w].cls}">${p.issues.length}</span>` : '0'}</td>
            </tr>`;
        }).join('') || `<tr><td colspan="6" class="text-center text-muted py-3">No page matches this filter.</td></tr>`;
        $('pageMore').textContent = rows.length > PAGE_LIMIT ? `Showing ${PAGE_LIMIT} of ${rows.length} pages. Narrow the filter, or export the full list.` : `${rows.length} page${rows.length === 1 ? '' : 's'}.`;
    }

    function renderSite() {
        const s = result.site, c = result.config;
        const robots = s.robots.status === 200 ? `Found (${esc(s.robots.url)})` : s.robots.error ? `Could not be fetched: ${esc(s.robots.error)}` : `Not found (HTTP ${s.robots.status ?? '-'}): everything may be crawled`;
        const sitemaps = s.sitemaps.length
            ? s.sitemaps.map(m => `<li><span class="font-monospace">${esc(m.url)}</span>: ${m.status === 200 && !m.error ? `${m.urls} URLs` : esc(m.error || `HTTP ${m.status}`)}</li>`).join('')
            : `<li>${c.useSitemap ? 'No sitemap found (robots.txt lists none and /sitemap.xml is missing).' : 'Not used for this crawl.'}</li>`;
        $('siteInfo').innerHTML = `
            <div class="seo-site-block"><h3 class="mq-overline mb-1">robots.txt</h3><div class="small">${robots}</div></div>
            <div class="seo-site-block"><h3 class="mq-overline mb-1">Sitemaps</h3><ul class="small mb-0 ps-3">${sitemaps}</ul></div>
            <div class="seo-site-block"><h3 class="mq-overline mb-1">This crawl</h3><div class="small">
                Started at <span class="font-monospace">${esc(s.startUrl)}</span> on ${esc(new Date(result.startedAt).toLocaleString())}, ${esc(clock(result.endedAt - result.startedAt))} long, ${result.state}.<br>
                Scope: ${c.scope === 'subdomains' ? 'host and subdomains' : 'this host'} · up to ${c.maxPages} pages, depth ${c.maxDepth} · ${c.concurrency} parallel, ${c.delayMs} ms delay
                ${c.include.length ? ` · only: ${esc(c.include.join(', '))}` : ''}${c.exclude.length ? ` · skipped: ${esc(c.exclude.join(', '))}` : ''}
                ${c.ignoreQuery ? ' · query strings ignored' : c.stripTracking ? ' · tracking parameters ignored' : ''}.<br>
                Raw HTML only: content built by JavaScript is not seen. Response times are measured by this crawler (server plus download), not Core Web Vitals.
            </div></div>`;
    }

    function openPage(url) {
        const p = result.pages.find(x => x.url === url) || result.pages.find(x => x.finalUrl === url);
        if (!p) return;
        const row = (k, v) => v === undefined || v === null || v === '' ? '' : `<tr><th scope="row">${k}</th><td>${v}</td></tr>`;
        const len = (t) => t ? `${esc(t)} <span class="text-muted">(${t.length})</span>` : '<span class="text-danger">Missing</span>';
        const issues = result.issues.filter(i => i.url === p.url)
            .sort((a, b) => SEV[ISSUES[a.code].severity].rank - SEV[ISSUES[b.code].severity].rank)
            .map(i => { const d = ISSUES[i.code], sv = SEV[d.severity]; return `<li><i class="bi bi-${sv.icon} text-${sv.cls} me-1" aria-label="${sv.label}"></i>${esc(d.title)}${i.detail ? ` <span class="text-muted">${esc(i.detail)}</span>` : ''}</li>`; }).join('');
        const st = statusOf(p);
        $('pageModalTitle').textContent = short(p.url);
        $('pageModalOpen').href = /^https?:/i.test(p.url) ? p.url : '#';
        $('pageModalBody').innerHTML = `
            <table class="table table-sm seo-detail-table mb-3"><tbody>
                ${row('URL', `<span class="font-monospace">${esc(p.url)}</span>`)}
                ${row('Status', `<span class="badge bg-${st.tone}-subtle text-${st.tone}-emphasis">${esc(st.text)}</span>${p.error ? ` ${esc(p.error)}` : ''}${p.blockedBy ? ` ${esc(p.blockedBy)}` : ''}`)}
                ${p.redirected ? row('Redirects to', `<span class="font-monospace">${esc(p.finalUrl)}</span>`) : ''}
                ${row('Found on', p.from ? (p.from === 'sitemap' ? 'sitemap.xml' : `<span class="font-monospace">${esc(p.from)}</span>`) : 'Start page')}
                ${row('Linked from', `${p.inlinks} internal link${p.inlinks === 1 ? '' : 's'}`)}
                ${row('Depth', p.depth)}
                ${p.ms != null ? row('Response', `${p.ms} ms${p.bytes ? ` · ${Math.round(p.bytes / 1024)} KB HTML` : ''} · ${esc(p.contentType || '')}`) : ''}
                ${p.html ? `
                ${row('Title', len(p.title))}
                ${row('Meta description', len(p.desc))}
                ${row('H1', p.h1.length ? p.h1.map(esc).join('<br>') : '<span class="text-danger">None</span>')}
                ${row('Canonical', p.canonicals.length ? p.canonicals.map(c => `<span class="font-monospace">${esc(c)}</span>`).join('<br>') : 'None')}
                ${row('Indexing', `${p.noindex ? `<span class="text-warning">noindex</span> (${esc(p.noindexSource)})` : 'indexable'}${p.nofollow ? ' · nofollow' : ''}`)}
                ${row('Language', p.lang ? esc(p.lang) : '<span class="text-warning">Not declared</span>')}
                ${row('Open Graph', `${p.og.title ? 'title' : '<span class="text-muted">no title</span>'} · ${p.og.image ? 'image' : '<span class="text-muted">no image</span>'}`)}
                ${row('Structured data', p.schema.length ? p.schema.map(s => s.error ? `<span class="text-warning">${esc(s.error)}</span>` : esc(s.types.join(', '))).join(' · ') : 'None')}
                ${row('Words', p.words)}
                ${row('Links', `${p.linksInternal} internal · ${p.linksExternal} to other sites`)}
                ${row('Images', `${p.images.length} · ${p.images.filter(i => i.alt === null).length} without alt · ${p.images.filter(i => i.alt === '').length} with empty alt`)}` : ''}
            </tbody></table>
            <h3 class="mq-overline mb-1">Issues</h3>
            ${issues ? `<ul class="list-unstyled small mb-0">${issues}</ul>` : '<div class="small text-muted">None.</div>'}`;
        bootstrap.Modal.getOrCreateInstance($('pageModal')).show();
    }

    // ── Exports ───────────────────────────────────────────────
    function download(name, text, type) {
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const fileBase = () => `seo-${new URL(result.site.startUrl).hostname}-${new Date(result.startedAt).toISOString().slice(0, 10)}`;
    function exportPages() {
        const head = ['url', 'status', 'final_url', 'redirected', 'depth', 'response_ms', 'html_kb', 'title', 'title_length', 'description_length', 'h1_count', 'canonical', 'noindex', 'words', 'inlinks', 'issues', 'error'];
        const rows = result.pages.map(p => [p.url, p.blocked ? 'blocked' : p.error ? 'failed' : p.status, p.finalUrl || '', p.redirected ? 'yes' : '', p.depth, p.ms ?? '', p.bytes ? Math.round(p.bytes / 1024) : '',
            p.title || '', p.title ? p.title.length : '', p.desc ? p.desc.length : '', p.h1 ? p.h1.length : '', (p.canonicals || []).join(' | '), p.noindex ? 'yes' : '', p.words ?? '', p.inlinks,
            p.issues.join(' '), p.error || p.blockedBy || ''].map(q).join(','));
        download(`${fileBase()}-pages.csv`, [head.join(','), ...rows].join('\r\n') + '\r\n', 'text/csv');
    }
    function exportIssues() {
        const rows = result.issues.map(i => { const d = ISSUES[i.code]; return [d.severity, d.category, d.title, i.url, i.detail || '', d.fix].map(q).join(','); });
        download(`${fileBase()}-issues.csv`, ['severity,category,issue,url,detail,how_to_fix', ...rows].join('\r\n') + '\r\n', 'text/csv');
    }
    const exportJson = () => download(`${fileBase()}.json`, JSON.stringify(result, null, 2), 'application/json');

    // ── Wiring ────────────────────────────────────────────────
    $('crawlForm').addEventListener('submit', start);
    $('stopBtn').addEventListener('click', () => {
        if (!controller) return;
        controller.abort();
        $('stopBtn').disabled = true;
        setStatus('Crawling', 'warning', 'Stopping: finishing the requests already sent...', 100);
    });
    $('closePageBtn').addEventListener('click', () => window.close());
    $('exportPagesCsv').addEventListener('click', exportPages);
    $('exportIssuesCsv').addEventListener('click', exportIssues);
    $('exportJson').addEventListener('click', exportJson);
    $('severityFilter').addEventListener('change', (e) => { view.severity = e.target.value; renderIssues(); });
    $('issueSearch').addEventListener('input', (e) => { view.issueQ = e.target.value.trim(); renderIssues(); });
    $('pageStatus').addEventListener('change', (e) => { view.pageStatus = e.target.value; renderPages(); });
    $('pageSearch').addEventListener('input', (e) => { view.pageQ = e.target.value.trim(); renderPages(); });
    $('issueList').addEventListener('click', (e) => {
        const head = e.target.closest('.seo-issue-head');
        if (head) { const c = head.dataset.code; view.open.has(c) ? view.open.delete(c) : view.open.add(c); renderIssues(); return; }
        const link = e.target.closest('.seo-url');
        if (link) openPage(link.dataset.url);
    });
    $('pageRows').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-url]'); if (tr) openPage(tr.dataset.url); });
    $('pageRows').addEventListener('keydown', (e) => { const tr = e.target.closest('tr[data-url]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPage(tr.dataset.url); } });
    window.addEventListener('beforeunload', (e) => { if (controller) e.preventDefault(); });

    // ── Start ─────────────────────────────────────────────────
    const params = new URLSearchParams(location.search);
    chrome.storage.local.get(['seoCrawlOptions', 'seoLastCrawl'], (res) => {
        writeOptions(res.seoCrawlOptions);
        if (res.seoLastCrawl?.version === 1) {
            result = res.seoLastCrawl;
            $('startUrl').value = result.site.startUrl;
            const label = result.state === 'stopped' ? 'Stopped' : 'Completed';
            setStatus(label, label === 'Stopped' ? 'warning' : 'success', `Last crawl: ${result.stats.pages} pages of ${new URL(result.site.startUrl).host}, ${new Date(result.endedAt).toLocaleString()}.`, 100);
            renderResult();
        }
        if (params.get('url')) $('startUrl').value = params.get('url');
        if (params.get('start') === '1' && params.get('url')) start();
        else $('startUrl').focus();
    });
})();
