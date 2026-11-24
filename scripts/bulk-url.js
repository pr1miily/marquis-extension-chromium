// Bulk URL Manager: the popup section (Marquis.html, tmpl_buoSection) and bulk_url_tools.html, same ids.
// The list is plain text, one URL per line. MarquisUrlList (scripts/url_list.js) checks it as you type and
// background.js (bulk_open_urls) opens it one URL after another, publishing progress in storage.session bulkJob.
// storage.local: cleanerSettings { v: 2, mode, scope, delay, max, skipDuplicates, saveList } (the older
// { newTab, newWindow, groupByHost, maxTotal, xNumTotal, delayBetweenPages, delayValue, saveList } is read and
// rewritten), URLs (the list while Remember list is on), bulkRecent [{ at, count, text }] (last 5 opened lists).
function initBulkUrl() {
    const $ = (id) => document.getElementById(id);
    const list = $('urls');
    if (!list || list.dataset.buoBound) return;
    list.dataset.buoBound = '1';

    const L = MarquisUrlList;
    const DEFAULTS = { v: 2, mode: 'tabs', scope: 'all', delay: 0, max: 0, skipDuplicates: true, saveList: false };
    const MODES = ['tabs', 'groupPerHost', 'window', 'windowPerHost', 'windowPerUrl'];
    let settings = { ...DEFAULTS };
    let analysis = L.analyse('');
    let running = false;

    const migrate = (s) => {
        if (!s) return { ...DEFAULTS };
        if (s.v === 2) return { ...DEFAULTS, ...s, mode: MODES.includes(s.mode) ? s.mode : 'tabs' };
        return {
            ...DEFAULTS,
            mode: s.newWindow ? 'window' : s.groupByHost ? 'windowPerHost' : 'tabs',
            delay: s.delayBetweenPages ? Number(s.delayValue) || 1 : 0,
            max: s.maxTotal ? Number(s.xNumTotal) || 100 : 0,
            saveList: !!s.saveList
        };
    };
    const saveSettings = () => chrome.storage.local.set({ cleanerSettings: settings });

    // ── Messages ──────────────────────────────────────────────
    // One status line under the buttons: progress while a batch runs, otherwise the last message.
    function say(text, level = 'info', undo) {
        const box = $('bulkStatus'), line = $('bulkStatusText');
        box.classList.remove('d-none');
        box.querySelector('.progress').classList.add('d-none');
        line.className = `small ${level === 'error' ? 'text-danger' : level === 'success' ? 'text-success' : 'text-muted'}`;
        line.textContent = text;
        if (undo) {
            const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-link btn-sm p-0 ms-2 align-baseline', textContent: 'Undo' });
            b.addEventListener('click', () => { undo(); say('Restored.'); });
            line.append(b);
        }
    }

    // ── Checking the list ─────────────────────────────────────
    let analyseTimer = 0;
    function onListChanged() {
        clearTimeout(analyseTimer);
        analyseTimer = setTimeout(() => { analysis = L.analyse(list.value); render(); rememberList(); }, 120);
    }
    function setList(text) {
        list.value = text;
        analysis = L.analyse(text);
        render();
        rememberList();
    }

    function render() {
        const { valid, invalid, duplicates, entries } = analysis;
        const parts = [];
        if (!entries.length) parts.push('No URLs yet.');
        else parts.push(`${valid} URL${valid === 1 ? '' : 's'} ready`);
        if (invalid) parts.push(`${invalid} invalid`);
        if (duplicates) parts.push(`${duplicates} duplicate${duplicates === 1 ? '' : 's'}`);
        $('urlStats').textContent = parts.join(' · ');
        $('urlStats').className = invalid ? 'text-danger' : 'text-muted';
        const problems = invalid + duplicates;
        $('issuesToggle').classList.toggle('d-none', !problems);
        if (!problems) $('urlIssues').classList.add('d-none');
        if (!$('urlIssues').classList.contains('d-none')) renderIssues();
        renderOpenButton();
    }

    function renderIssues() {
        const box = $('urlIssues');
        const rows = analysis.entries.filter(e => e.error || e.dupOf).slice(0, 300);
        box.replaceChildren(...rows.map(e => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `buo-issue${e.dupOf ? ' is-dup' : ''}`;
            b.title = 'Select this line';
            b.append(
                Object.assign(document.createElement('span'), { className: 'ln', textContent: `Line ${e.line}` }),
                Object.assign(document.createElement('span'), { className: 'txt', textContent: e.text }),
                Object.assign(document.createElement('span'), { className: 'why', textContent: e.dupOf ? `Duplicate of line ${e.dupOf}` : e.error }));
            b.addEventListener('click', () => selectLine(e.line));
            return b;
        }));
    }

    function selectLine(n) {
        const lines = list.value.split('\n');
        const start = lines.slice(0, n - 1).reduce((sum, l) => sum + l.length + 1, 0);
        list.focus();
        list.setSelectionRange(start, start + (lines[n - 1] || '').length);
        const lineHeight = parseFloat(getComputedStyle(list).lineHeight) || 20;
        list.scrollTop = Math.max(0, (n - 1) * lineHeight - list.clientHeight / 2);
    }

    // ── Which URLs open ───────────────────────────────────────
    // Selected lines: every line the selection touches. Range: positions in the list of valid URLs (1-based).
    function pick() {
        let entries = analysis.entries.filter(e => e.url && !(settings.skipDuplicates && e.dupOf));
        if (settings.scope === 'selection') {
            const before = list.value.slice(0, list.selectionStart).split('\n').length;
            const after = list.value.slice(0, list.selectionEnd).split('\n').length;
            if (list.selectionStart === list.selectionEnd) return { urls: [], note: 'Select some lines in the list first.' };
            entries = entries.filter(e => e.line >= before && e.line <= after);
        } else if (settings.scope === 'range') {
            const from = Math.max(1, parseInt($('rangeFrom').value, 10) || 1);
            const to = Math.min(entries.length, parseInt($('rangeTo').value, 10) || entries.length);
            if (from > to) return { urls: [], note: `The range is empty: there are ${entries.length} URLs.` };
            entries = entries.slice(from - 1, to);
        }
        let urls = entries.map(e => e.url);
        let note = '';
        if (settings.max > 0 && urls.length > settings.max) {
            note = `Only the first ${settings.max} open (Max per batch).`;
            urls = urls.slice(0, settings.max);
        }
        return { urls, note };
    }

    function renderOpenButton() {
        const { urls } = pick();
        $('openBtnText').textContent = urls.length ? `Open ${urls.length} URL${urls.length === 1 ? '' : 's'}` : 'Open URLs';
        $('openBtn').disabled = running || !urls.length;
    }

    // ── Opening ───────────────────────────────────────────────
    async function open() {
        if (running) return;
        const { urls, note } = pick();
        if (!urls.length) return say(note || 'There is no valid URL to open.', 'error');
        let res;
        try {
            res = await chrome.runtime.sendMessage({ action: 'bulk_open_urls', urls, target: settings.mode, delayMs: Math.round(settings.delay * 1000), dedupe: settings.skipDuplicates });
        } catch {
            return say('The opener did not answer. Reload the extension and try again.', 'error');
        }
        if (!res || !res.ok) return say(res?.error || 'The batch could not start.', 'error');
        if (!res.total) return say('There is no valid URL to open.', 'error');
        saveRecent(urls);
        if (note) say(note);
    }

    function renderJob(job) {
        if (!job) return;
        running = job.state === 'running';
        $('stopBtn').classList.toggle('d-none', !running);
        renderOpenButton();
        const box = $('bulkStatus'), line = $('bulkStatusText'), bar = $('bulkProgressBar');
        box.classList.remove('d-none');
        box.querySelector('.progress').classList.toggle('d-none', !running);
        const done = job.opened + job.failed.length;
        const pct = job.total ? Math.round(done / job.total * 100) : 0;
        bar.style.width = `${pct}%`;
        box.querySelector('.progress').setAttribute('aria-valuenow', String(pct));
        const failed = job.failed.length ? ` · ${job.failed.length} failed` : '';
        const text = {
            running: `Opening ${Math.min(done + 1, job.total)} of ${job.total}${failed}`,
            done: `Opened ${job.opened} of ${job.total}${failed}.`,
            stopped: `Stopped: ${job.opened} of ${job.total} opened${failed}. The rest were not opened.`,
            interrupted: `Interrupted: ${job.opened} of ${job.total} opened (the extension restarted).`
        }[job.state] || '';
        line.className = `small ${job.failed.length || job.state === 'interrupted' ? 'text-danger' : job.state === 'done' ? 'text-success' : 'text-muted'}`;
        line.textContent = text;
        if (!running && job.failed.length) {
            const ul = document.createElement('ul');
            ul.className = 'mb-0 ps-3';
            ul.append(...job.failed.slice(0, 5).map(f => Object.assign(document.createElement('li'), { textContent: `${f.url}: ${f.error}` })));
            line.append(ul);
        }
    }
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes.bulkJob) renderJob(changes.bulkJob.newValue); });

    // ── List tools ────────────────────────────────────────────
    const append = (text) => {
        const add = String(text).trim();
        if (!add) return 0;
        const before = analysis.entries.length;
        setList(list.value.trim() ? `${list.value.replace(/\s+$/, '')}\n${add}` : add);
        return analysis.entries.length - before;
    };

    async function paste() {
        try {
            const n = append(await navigator.clipboard.readText());
            say(n ? `Added ${n} line${n === 1 ? '' : 's'} from the clipboard.` : 'The clipboard is empty.', n ? 'info' : 'error');
        } catch {
            say('The clipboard could not be read.', 'error');
        }
    }

    // The tab the user is on: the active tab of this window in the popup; from the full-screen page, the most
    // recently used web tab.
    async function fromTab() {
        const web = (t) => t && /^https?:/i.test(t.url || '') && !/^https:\/\/chromewebstore\.google\.com\//.test(t.url);
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = web(active) ? active
            : (await chrome.tabs.query({})).filter(web).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
        if (!tab) return say('Open a web page first: Chrome pages and the Web Store cannot be read.', 'error');
        try {
            const [res] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => /^https?:/i.test(h)))]
            });
            const n = append((res?.result || []).join('\n'));
            say(n ? `Added ${n} links from ${new URL(tab.url).hostname}.` : 'That page has no links.', n ? 'info' : 'error');
        } catch {
            say('That page cannot be read.', 'error');
        }
    }

    // .txt as written (one URL per line); .csv and .tsv: links in any column; .html: link targets (a Chrome
    // bookmarks export); .json: every string that is a URL. Added under the current list.
    function importFile() {
        const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.txt,.csv,.tsv,.json,.html,.htm' });
        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;
            const text = await file.text();
            const ext = (file.name.split('.').pop() || '').toLowerCase();
            let lines;
            try {
                if (ext === 'html' || ext === 'htm') {
                    lines = [...new DOMParser().parseFromString(text, 'text/html').querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => /^https?:/i.test(h));
                } else if (ext === 'json') {
                    lines = [];
                    (function walk(v) {
                        if (typeof v === 'string') { if (!/\s/.test(v.trim()) && L.normalize(v).url && /[./]/.test(v)) lines.push(v.trim()); }
                        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
                    })(JSON.parse(text));
                } else if (ext === 'csv' || ext === 'tsv') {
                    lines = L.extract(text);
                } else {
                    lines = text.split(/\r?\n/);
                }
            } catch {
                return say(`${file.name} could not be read as ${ext.toUpperCase()}.`, 'error');
            }
            const n = append(lines.join('\n'));
            say(n ? `Added ${n} line${n === 1 ? '' : 's'} from ${file.name}.` : `No URLs found in ${file.name}.`, n ? 'info' : 'error');
        });
        input.click();
    }

    function download(name, text, type) {
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    const stamp = () => new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    function exportTxt() {
        if (!analysis.urls.length) return say('There is no valid URL to export.', 'error');
        download(`bulk-urls-${stamp()}.txt`, analysis.urls.join('\n') + '\n', 'text/plain');
    }
    function exportCsv() {
        if (!analysis.entries.length) return say('The list is empty.', 'error');
        const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = analysis.entries.map(e => [e.line, e.error ? 'invalid' : e.dupOf ? 'duplicate' : 'valid', e.text, e.url || '', e.error || (e.dupOf ? `duplicate of line ${e.dupOf}` : '')].map(q).join(','));
        download(`bulk-urls-${stamp()}.csv`, ['line,status,input,url,note', ...rows].join('\r\n') + '\r\n', 'text/csv');
    }
    async function copyValid() {
        if (!analysis.urls.length) return say('There is no valid URL to copy.', 'error');
        try {
            await navigator.clipboard.writeText(analysis.urls.join('\n'));
            say(`Copied ${analysis.urls.length} URLs.`, 'success');
        } catch {
            say('The clipboard could not be written.', 'error');
        }
    }

    // Tidy actions rewrite the list; each can be undone once.
    function tidy(rewrite, message) {
        const before = list.value;
        const after = rewrite(before);
        if (after === before) return say('Nothing to change.');
        setList(after);
        say(message(before, after), 'info', () => setList(before));
    }
    const lineCount = (t) => t.split('\n').filter(l => l.trim()).length;
    const extract = () => {
        const found = L.extract(list.value);
        if (!found.length) return say('No links found in the text.', 'error');
        tidy(() => found.join('\n'), () => `Extracted ${found.length} link${found.length === 1 ? '' : 's'}.`);
    };
    const normalizeAll = () => tidy(
        (t) => t.split('\n').map(l => (l.trim() && L.normalize(l).url) || l).join('\n'),
        () => 'Rewrote the valid lines as full URLs.');
    const dedupe = () => tidy(
        (t) => { const seen = new Set(); return t.split('\n').filter(l => { const u = l.trim() && L.normalize(l).url; if (!u) return true; if (seen.has(u)) return false; seen.add(u); return true; }).join('\n'); },
        (b, a) => `Removed ${lineCount(b) - lineCount(a)} duplicate line${lineCount(b) - lineCount(a) === 1 ? '' : 's'}.`);
    const removeInvalid = () => tidy(
        (t) => t.split('\n').filter(l => !l.trim() || L.normalize(l).url).join('\n').replace(/\n{3,}/g, '\n\n'),
        (b, a) => `Removed ${lineCount(b) - lineCount(a)} invalid line${lineCount(b) - lineCount(a) === 1 ? '' : 's'}.`);
    const clearList = () => {
        if (!list.value.trim()) return;
        const before = list.value;
        setList('');
        say('List cleared.', 'info', () => setList(before));
    };

    // ── Remembered list and recent batches ────────────────────
    let rememberTimer = 0;
    function rememberList() {
        clearTimeout(rememberTimer);
        rememberTimer = setTimeout(() => {
            if (settings.saveList) chrome.storage.local.set({ URLs: list.value });
            else chrome.storage.local.remove('URLs');
        }, 400);
    }

    async function saveRecent(urls) {
        const text = urls.join('\n');
        const { bulkRecent = [] } = await chrome.storage.local.get('bulkRecent');
        const next = [{ at: Date.now(), count: urls.length, text }, ...bulkRecent.filter(r => r.text !== text)].slice(0, 5);
        chrome.storage.local.set({ bulkRecent: next });
    }
    async function renderRecent() {
        const menu = $('recentMenu');
        if (!menu) return;
        const { bulkRecent = [] } = await chrome.storage.local.get('bulkRecent');
        if (!bulkRecent.length) {
            menu.replaceChildren(Object.assign(document.createElement('li'), { className: 'dropdown-item-text small text-muted', textContent: 'Lists you open appear here.' }));
            return;
        }
        menu.replaceChildren(...bulkRecent.map(r => {
            const li = document.createElement('li');
            const b = Object.assign(document.createElement('button'), { type: 'button', className: 'dropdown-item' });
            const first = (() => { try { return new URL(r.text.split('\n')[0]).hostname; } catch { return ''; } })();
            b.textContent = `${r.count} URL${r.count === 1 ? '' : 's'} · ${first} · ${new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
            b.addEventListener('click', () => {
                const before = list.value;
                setList(r.text);
                say(`Loaded a list of ${r.count} URLs.`, 'info', before.trim() ? () => setList(before) : null);
            });
            li.append(b);
            return li;
        }));
    }
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.bulkRecent) renderRecent(); });

    // ── Options ───────────────────────────────────────────────
    function renderOptions() {
        $('openMode').value = settings.mode;
        $('openScope').value = settings.scope;
        $('delayValue').value = settings.delay;
        $('xNumTotal').value = settings.max;
        $('skipDuplicates').checked = settings.skipDuplicates;
        $('saveList').checked = settings.saveList;
        const range = settings.scope === 'range';
        $('rangeFrom').classList.toggle('d-none', !range);
        $('rangeTo').classList.toggle('d-none', !range);
        renderOpenButton();
    }
    function readOptions() {
        settings = {
            ...settings,
            mode: MODES.includes($('openMode').value) ? $('openMode').value : 'tabs',
            scope: $('openScope').value,
            delay: Math.min(600, Math.max(0, Number($('delayValue').value) || 0)),
            max: Math.max(0, parseInt($('xNumTotal').value, 10) || 0),
            skipDuplicates: $('skipDuplicates').checked,
            saveList: $('saveList').checked
        };
        saveSettings();
        renderOptions();
        rememberList();
    }

    // ── Wiring ────────────────────────────────────────────────
    const on = (id, fn) => $(id)?.addEventListener('click', fn);
    on('pasteBtn', paste);
    on('fromTabBtn', fromTab);
    on('importBtn', importFile);
    on('exportBtn', exportTxt);
    on('exportCsvBtn', exportCsv);
    on('copyBtn', copyValid);
    on('extractBtn', extract);
    on('normalizeBtn', normalizeAll);
    on('dedupeBtn', dedupe);
    on('removeInvalidBtn', removeInvalid);
    on('clearBtn', clearList);
    on('openBtn', open);
    on('stopBtn', () => chrome.runtime.sendMessage({ action: 'bulk_stop' }).catch(() => {}));
    on('closeStudioBtn', () => window.close());
    on('restoreDefaults', () => { settings = { ...DEFAULTS }; saveSettings(); renderOptions(); rememberList(); });
    on('issuesToggle', () => {
        const box = $('urlIssues'), show = box.classList.contains('d-none');
        box.classList.toggle('d-none', !show);
        $('issuesToggle').setAttribute('aria-expanded', String(show));
        $('issuesToggle').textContent = show ? 'Hide' : 'Review';
        if (show) renderIssues();
    });
    ['openMode', 'openScope', 'delayValue', 'xNumTotal', 'skipDuplicates', 'saveList', 'rangeFrom', 'rangeTo']
        .forEach(id => $(id)?.addEventListener('change', readOptions));
    ['rangeFrom', 'rangeTo'].forEach(id => $(id)?.addEventListener('input', renderOpenButton));
    list.addEventListener('input', onListChanged);
    // The selection decides the count when "Selected lines" is chosen.
    ['select', 'keyup', 'mouseup'].forEach(ev => list.addEventListener(ev, () => { if (settings.scope === 'selection') renderOpenButton(); }));
    list.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); open(); } });

    // ── Start ─────────────────────────────────────────────────
    chrome.storage.local.get(['cleanerSettings', 'URLs'], (res) => {
        settings = migrate(res.cleanerSettings);
        if (res.cleanerSettings?.v !== 2) saveSettings();
        renderOptions();
        if (settings.saveList && res.URLs && !list.value) list.value = res.URLs;
        analysis = L.analyse(list.value);
        render();
    });
    renderRecent();
    // A batch still opening (or one that just ended) when this view opens.
    chrome.storage.session.get('bulkJob').then(({ bulkJob: job }) => {
        if (job && (job.state === 'running' || Date.now() - (job.endedAt || 0) < 120000)) renderJob(job);
    }).catch(() => {});
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'buoSection') initBulkUrl();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('urls')) initBulkUrl();
});
