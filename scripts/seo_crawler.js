// SEO Spider crawl engine, used by seo_spider.html (scripts/seo_spider.js). Runs in an extension page: fetch()
// with the extension's host permissions (no CORS limits, cookies left out so pages are seen as a visitor sees
// them) and DOMParser for the raw HTML. JavaScript-built content is not executed or seen.
//   crawl(config, { signal, onProgress }) -> result   (see finish() for its shape)
//   normalizeUrl, parseRobots, robotsAllows, ISSUES   (pure, also used by tests/seo_crawler.selftest.js)
const MarquisSeoCrawler = (() => {
    // ── Issue catalogue ─────────────────────────────────────────
    // severity: critical (breaks crawling or indexing), warning (likely hurts search results), info (worth a look,
    // often fine). Every reported issue is one of these, found in the crawled data.
    const ISSUES = {
        status_error:     { severity: 'critical', category: 'Responses', title: 'Page returns an error (4xx/5xx)', why: 'Search engines drop pages that answer with an error, and links to them lead nowhere.', fix: 'Restore the page, or redirect (301) it to the closest live page and update links to it.' },
        fetch_failed:     { severity: 'critical', category: 'Responses', title: 'Page could not be fetched', why: 'The request failed (network error, timeout, too many redirects or a redirect loop), so neither visitors nor crawlers may reach it.', fix: 'Open the URL and check the server, its certificate and its redirects.' },
        link_broken:      { severity: 'critical', category: 'Links', title: 'Links to a broken internal page', why: 'Visitors and crawlers following this link hit an error page.', fix: 'Point the link at a live URL or remove it.' },
        title_missing:    { severity: 'critical', category: 'Titles', title: 'Missing page title', why: 'The <title> is the main headline in search results; without it search engines invent one.', fix: 'Add a unique, descriptive <title> in the <head>.' },
        mixed_active:     { severity: 'critical', category: 'Security', title: 'Insecure scripts, frames or styles on an HTTPS page', why: 'Browsers block http:// scripts, iframes and stylesheets on https:// pages, which can break the page.', fix: 'Load these resources over https://.' },
        title_duplicate:  { severity: 'warning', category: 'Titles', title: 'Duplicate page title', why: 'Several pages share this title, which makes them hard to tell apart in search results.', fix: 'Write a title that is unique to each page.' },
        title_long:       { severity: 'warning', category: 'Titles', title: 'Title over 60 characters', why: 'Search results usually cut titles at about 60 characters.', fix: 'Put the important words first and shorten the title.' },
        title_short:      { severity: 'info', category: 'Titles', title: 'Title under 20 characters', why: 'Very short titles waste space that could describe the page.', fix: 'Describe the page more fully, if it helps the reader.' },
        desc_missing:     { severity: 'warning', category: 'Descriptions', title: 'Missing meta description', why: 'Without one, search engines pick a snippet from the page, which may not sell it well.', fix: 'Add a <meta name="description"> that summarises the page in one or two sentences.' },
        desc_duplicate:   { severity: 'warning', category: 'Descriptions', title: 'Duplicate meta description', why: 'Several pages share this description, so their snippets look the same.', fix: 'Write a description unique to each page.' },
        desc_long:        { severity: 'info', category: 'Descriptions', title: 'Meta description over 160 characters', why: 'Search results usually cut descriptions at about 155-160 characters.', fix: 'Shorten it, keeping the key message first.' },
        desc_short:       { severity: 'info', category: 'Descriptions', title: 'Meta description under 70 characters', why: 'A very short description gives searchers little to go on.', fix: 'Expand it to one or two full sentences.' },
        h1_missing:       { severity: 'warning', category: 'Headings', title: 'No H1 heading', why: 'The H1 tells readers and search engines what the page is about.', fix: 'Add one H1 that states the page topic.' },
        h1_multiple:      { severity: 'info', category: 'Headings', title: 'More than one H1', why: 'HTML allows it, but one clear H1 usually reads better and states the topic plainly.', fix: 'Keep one H1 and turn the others into H2s, if that matches the page structure.' },
        heading_skip:     { severity: 'info', category: 'Headings', title: 'Heading levels skipped', why: 'Jumping from, say, H2 to H4 makes the outline harder to follow for screen readers.', fix: 'Use heading levels in order.' },
        canonical_missing:{ severity: 'info', category: 'Canonical', title: 'No canonical tag', why: 'Optional, but it tells search engines which URL to show when the same page is reachable at several URLs.', fix: 'Add <link rel="canonical" href="..."> pointing at the preferred URL.' },
        canonical_multiple:{ severity: 'warning', category: 'Canonical', title: 'Conflicting canonical tags', why: 'The page declares more than one canonical URL, so search engines may ignore all of them.', fix: 'Keep a single canonical tag.' },
        canonical_other:  { severity: 'info', category: 'Canonical', title: 'Canonical points to another URL', why: 'This page asks search engines to index a different URL instead. Fine for duplicates; a mistake on unique pages.', fix: 'Check that the canonical URL is the page you want indexed.' },
        canonical_broken: { severity: 'warning', category: 'Canonical', title: 'Canonical points to an error or redirect', why: 'A canonical URL that fails or redirects sends mixed signals, and is often ignored.', fix: 'Point the canonical at the final, live URL.' },
        noindex:          { severity: 'info', category: 'Indexability', title: 'Page is set to noindex', why: 'Search engines are asked not to show this page. Right for private or thin pages; a problem if it should rank.', fix: 'Remove noindex (meta robots or X-Robots-Tag) if the page should appear in search.' },
        nofollow:         { severity: 'info', category: 'Indexability', title: 'Page is set to nofollow', why: 'Search engines are asked not to follow any link on this page; the crawler did not follow them either.', fix: 'Remove nofollow if its links should pass value.' },
        noindex_sitemap:  { severity: 'warning', category: 'Indexability', title: 'Sitemap lists a URL that is not indexable', why: 'The sitemap asks search engines to index a page that is noindex, redirects or fails.', fix: 'List only live, indexable, final URLs in the sitemap.' },
        lang_missing:     { severity: 'warning', category: 'Content', title: 'No language declared', why: 'The <html lang> attribute helps search engines and screen readers handle the language.', fix: 'Add lang="..." to the <html> element (for example lang="en").' },
        og_missing:       { severity: 'info', category: 'Social', title: 'Open Graph title or image missing', why: 'Social networks use og:title and og:image for link previews.', fix: 'Add <meta property="og:title"> and <meta property="og:image">.' },
        schema_invalid:   { severity: 'warning', category: 'Structured data', title: 'Structured data (JSON-LD) does not parse', why: 'A JSON-LD block has a syntax error or no @type, so search engines ignore it.', fix: 'Fix the JSON and check it with a structured data validator.' },
        img_alt_missing:  { severity: 'warning', category: 'Images', title: 'Images without alt text', why: 'Screen readers and image search rely on alt text. (An empty alt="" is fine for decorative images and is reported separately.)', fix: 'Add alt text that describes each meaningful image.' },
        img_alt_empty:    { severity: 'info', category: 'Images', title: 'Images with empty alt=""', why: 'Correct for purely decorative images; a gap for images that carry meaning.', fix: 'Describe any meaningful image in its alt text.' },
        img_size_missing: { severity: 'info', category: 'Images', title: 'Images without width and height', why: 'Without dimensions the layout can jump while images load (layout shift).', fix: 'Set width and height attributes (or a CSS aspect-ratio).' },
        img_broken:       { severity: 'warning', category: 'Images', title: 'Broken image', why: 'The image URL returns an error, so it does not show.', fix: 'Fix the image URL or remove the image.' },
        img_large:        { severity: 'info', category: 'Images', title: 'Image over 300 KB', why: 'Heavy images slow the page down, especially on mobile data.', fix: 'Compress or resize it, or serve WebP/AVIF.' },
        mixed_passive:    { severity: 'warning', category: 'Security', title: 'Insecure images or media on an HTTPS page', why: 'http:// images and media on an https:// page show a "not fully secure" warning, and may be upgraded or blocked.', fix: 'Load them over https://.' },
        redirect:         { severity: 'info', category: 'Responses', title: 'URL redirects', why: 'This URL forwards to another one. Normal for moved pages; internal links should point at the final URL.', fix: 'Update links to use the final URL.' },
        link_redirect:    { severity: 'info', category: 'Links', title: 'Links to a URL that redirects', why: 'Each redirect adds a round trip for visitors and crawlers.', fix: 'Link straight to the final URL.' },
        link_http:        { severity: 'warning', category: 'Security', title: 'Links to the http:// version of the site', why: 'The site is on HTTPS, but this page links to insecure http:// URLs.', fix: 'Change these links to https://.' },
        slow:             { severity: 'warning', category: 'Performance', title: 'Slow response (over 2 s)', why: 'Measured by this crawler: server response plus download of the HTML. This is not a Core Web Vitals measurement.', fix: 'Check server speed, caching and page weight.' },
        large_html:       { severity: 'info', category: 'Performance', title: 'HTML over 500 KB', why: 'Large HTML takes longer to download and parse.', fix: 'Remove inline data, unused markup or move large inline scripts to files.' },
        render_blocking:  { severity: 'info', category: 'Performance', title: 'Render-blocking scripts in <head>', why: 'Scripts in <head> without async or defer stop the page from showing until they load.', fix: 'Add defer (or async) to scripts that do not need to run first.' },
        blocked_robots:   { severity: 'info', category: 'Crawl', title: 'Blocked by robots.txt', why: 'robots.txt tells crawlers not to fetch this URL, so it was not checked.', fix: 'Allow it in robots.txt if it should be crawled.' },
        orphan:           { severity: 'warning', category: 'Crawl', title: 'In the sitemap but not linked from crawled pages', why: 'Pages no internal link points to are hard for visitors and crawlers to find.', fix: 'Link to the page from a relevant page, or drop it from the sitemap.' },
        external_broken:  { severity: 'warning', category: 'Links', title: 'Broken link to another site', why: 'The linked page on another site answers with an error.', fix: 'Update or remove the link.' }
    };

    // ── URLs ────────────────────────────────────────────────────
    const TRACKING = /^(utm_[a-z]+|gclid|fbclid|msclkid|dclid|yclid|mc_cid|mc_eid|_ga|_gl)$/i;
    // One crawl target per page: resolves relative links, keeps http(s) only, drops the #fragment (never sent to
    // the server), lowercases the host, drops the default port. Query strings are kept (they can be different
    // pages) except tracking parameters when stripTracking is on, or all of them when ignoreQuery is on.
    function normalizeUrl(href, base, opts = {}) {
        let u;
        try { u = new URL(String(href).trim(), base); } catch { return null; }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        u.hash = '';
        if (opts.ignoreQuery) u.search = '';
        else if (opts.stripTracking !== false && u.search) {
            [...u.searchParams.keys()].filter(k => TRACKING.test(k)).forEach(k => u.searchParams.delete(k));
        }
        return u.href;
    }
    const bareHost = (host) => host.replace(/^www\./, '');

    // ── robots.txt ──────────────────────────────────────────────
    function parseRobots(text) {
        const groups = [], sitemaps = [];
        let group = null, agentLine = false;
        for (const raw of String(text).split(/\r?\n/)) {
            const line = raw.replace(/#.*/, '').trim();
            const i = line.indexOf(':');
            if (i < 1) continue;
            const key = line.slice(0, i).trim().toLowerCase(), val = line.slice(i + 1).trim();
            if (key === 'user-agent') {
                if (!group || !agentLine) groups.push(group = { agents: [], rules: [], delay: null });
                group.agents.push(val.toLowerCase());
                agentLine = true;
                continue;
            }
            agentLine = false;
            if (key === 'sitemap') sitemaps.push(val);
            else if (!group) continue;
            else if ((key === 'allow' || key === 'disallow') && val) group.rules.push({ allow: key === 'allow', path: val });
            else if (key === 'crawl-delay' && Number(val) >= 0) group.delay = Number(val);
        }
        return { groups, sitemaps };
    }
    const AGENT = 'marquisspider';
    function robotsGroup(robots) {
        return robots.groups.find(g => g.agents.some(a => a !== '*' && AGENT.includes(a)))
            || robots.groups.find(g => g.agents.includes('*')) || null;
    }
    const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const ruleRe = (p) => new RegExp('^' + (p.endsWith('$') ? p.slice(0, -1) : p).split('*').map(escapeRe).join('.*') + (p.endsWith('$') ? '$' : ''));
    // Longest matching rule wins; on a tie Allow wins (RFC 9309).
    function robotsAllows(robots, url) {
        const group = robots && robotsGroup(robots);
        if (!group) return { allowed: true };
        const u = new URL(url), path = u.pathname + u.search;
        let best = null;
        for (const r of group.rules) {
            if (!ruleRe(r.path).test(path)) continue;
            if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
        }
        return { allowed: !best || best.allow, rule: best ? `${best.allow ? 'Allow' : 'Disallow'}: ${best.path}` : null };
    }

    // ── Fetching ────────────────────────────────────────────────
    const sleep = (ms, signal) => new Promise(r => {
        if (!ms) return r();
        const t = setTimeout(r, ms);
        signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
    });
    async function get(url, signal, method = 'GET') {
        const t0 = performance.now();
        const res = await fetch(url, { method, redirect: 'follow', credentials: 'omit', cache: 'no-store',
            signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
        return { res, ms: Math.round(performance.now() - t0) };
    }
    // Chrome reports a redirect loop (over 20 redirects) with the same "Failed to fetch" as a connection failure.
    const failMessage = (err) => err.name === 'TimeoutError' ? 'Timed out after 20 s'
        : err.name === 'AbortError' ? 'Stopped'
        : 'Could not connect, or too many redirects (redirect loop)';

    // ── Page analysis (raw HTML) ────────────────────────────────
    function analyseHtml(html, url) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const baseEl = doc.querySelector('base[href]');
        const base = baseEl ? (() => { try { return new URL(baseEl.getAttribute('href'), url).href; } catch { return url; } })() : url;
        const metas = (name) => [...doc.querySelectorAll('meta[name]')].filter(m => m.getAttribute('name').trim().toLowerCase() === name).map(m => (m.getAttribute('content') || '').trim());
        const prop = (p) => doc.querySelector(`meta[property="${p}"]`)?.getAttribute('content')?.trim() || '';
        const titles = [...doc.querySelectorAll('title')].filter(t => !t.closest('svg'));
        const headings = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => ({ level: +h.tagName[1], text: h.textContent.replace(/\s+/g, ' ').trim().slice(0, 140) }));
        let skips = 0;
        headings.forEach((h, i) => { if (i && h.level > headings[i - 1].level + 1) skips++; });
        const canonicals = [...doc.querySelectorAll('link[rel]')].filter(l => /(^|\s)canonical(\s|$)/i.test(l.getAttribute('rel')))
            .map(l => { try { return new URL(l.getAttribute('href') || '', base).href; } catch { return ''; } });
        const robots = metas('robots').concat(metas('googlebot')).join(', ').toLowerCase();
        const schema = [...doc.querySelectorAll('script[type="application/ld+json"]')].map(s => {
            try {
                const data = JSON.parse(s.textContent);
                const items = [].concat(data['@graph'] || data);
                const types = items.flatMap(it => [].concat(it && it['@type'] || [])).filter(Boolean);
                return types.length ? { types } : { types: [], error: 'No @type' };
            } catch (err) { return { types: [], error: 'JSON does not parse' }; }
        });
        const links = [];
        doc.querySelectorAll('a[href]').forEach(a => {
            const raw = a.getAttribute('href').trim();
            if (!raw || /^(#|mailto:|tel:|javascript:|data:)/i.test(raw)) return;
            let abs;
            try { abs = new URL(raw, base).href; } catch { return; }
            if (!/^https?:/i.test(abs)) return;
            links.push({ href: abs, nofollow: /(^|\s)nofollow(\s|$)/i.test(a.getAttribute('rel') || '') });
        });
        const images = [...doc.querySelectorAll('img')].map(img => {
            const src = img.getAttribute('src') || (img.getAttribute('srcset') || '').trim().split(/\s+/)[0] || '';
            let abs = '';
            try { abs = src ? new URL(src, base).href : ''; } catch {}
            return { src: abs, alt: img.hasAttribute('alt') ? img.getAttribute('alt').trim() : null, sized: img.hasAttribute('width') && img.hasAttribute('height') };
        }).filter(i => i.src && !i.src.startsWith('data:'));
        const isHttps = url.startsWith('https:');
        const insecure = (sel, attr) => isHttps ? [...doc.querySelectorAll(sel)].filter(el => /^http:\/\//i.test(el.getAttribute(attr) || '')).length : 0;
        const mixedActive = insecure('script[src]', 'src') + insecure('iframe[src]', 'src') + insecure('link[rel~="stylesheet"][href]', 'href');
        const mixedPassive = insecure('img[src]', 'src') + insecure('video[src],audio[src],source[src]', 'src');
        const renderBlocking = [...doc.head.querySelectorAll('script[src]')].filter(s => !s.async && !s.defer && s.type !== 'module').length;
        const body = doc.body ? doc.body.cloneNode(true) : null;
        body?.querySelectorAll('script,style,noscript,template,svg').forEach(el => el.remove());
        const words = body ? (body.textContent.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length : 0;
        return {
            title: titles[0]?.textContent.replace(/\s+/g, ' ').trim() || '',
            titleCount: titles.length,
            desc: metas('description')[0] || '',
            descCount: metas('description').length,
            h1: headings.filter(h => h.level === 1).map(h => h.text),
            headings: headings.slice(0, 60),
            headingSkips: skips,
            canonicals: [...new Set(canonicals.filter(Boolean))],
            robotsMeta: robots,
            lang: doc.documentElement.getAttribute('lang') || '',
            og: { title: prop('og:title'), desc: prop('og:description'), image: prop('og:image') },
            schema,
            links,
            images,
            mixedActive, mixedPassive, renderBlocking, words
        };
    }

    // Issues found on one page from its own data (site-wide ones are added in finish()).
    function pageIssues(p) {
        const out = [];
        const add = (code, detail) => out.push({ code, url: p.url, detail });
        if (p.blocked) { add('blocked_robots', p.blockedBy); return out; }
        if (p.error) { add('fetch_failed', p.error); return out; }
        if (p.status >= 400) { add('status_error', `HTTP ${p.status}`); return out; }
        if (p.redirected) add('redirect', `→ ${p.finalUrl}`);
        if (!p.html || p.duplicateOf) return out;
        if (!p.title) add('title_missing');
        else if (p.title.length > 60) add('title_long', `${p.title.length} characters`);
        else if (p.title.length < 20) add('title_short', `${p.title.length} characters`);
        if (!p.desc) add('desc_missing');
        else if (p.desc.length > 160) add('desc_long', `${p.desc.length} characters`);
        else if (p.desc.length < 70) add('desc_short', `${p.desc.length} characters`);
        if (!p.h1.length) add('h1_missing');
        else if (p.h1.length > 1) add('h1_multiple', `${p.h1.length} H1 headings`);
        if (p.headingSkips) add('heading_skip', `${p.headingSkips} skip${p.headingSkips === 1 ? '' : 's'}`);
        if (!p.canonicals.length) add('canonical_missing');
        else if (p.canonicals.length > 1) add('canonical_multiple', p.canonicals.join(' | '));
        else if (p.canonicals[0] !== p.finalUrl) add('canonical_other', `→ ${p.canonicals[0]}`);
        if (p.noindex) add('noindex', p.noindexSource);
        if (p.nofollow) add('nofollow');
        if (!p.lang) add('lang_missing');
        if (!p.og.title || !p.og.image) add('og_missing', [!p.og.title && 'og:title', !p.og.image && 'og:image'].filter(Boolean).join(', '));
        const badSchema = p.schema.filter(s => s.error);
        if (badSchema.length) add('schema_invalid', badSchema.map(s => s.error).join(', '));
        const noAlt = p.images.filter(i => i.alt === null).length, emptyAlt = p.images.filter(i => i.alt === '').length, noSize = p.images.filter(i => !i.sized).length;
        if (noAlt) add('img_alt_missing', `${noAlt} image${noAlt === 1 ? '' : 's'}`);
        if (emptyAlt) add('img_alt_empty', `${emptyAlt} image${emptyAlt === 1 ? '' : 's'}`);
        if (noSize) add('img_size_missing', `${noSize} image${noSize === 1 ? '' : 's'}`);
        if (p.mixedActive) add('mixed_active', `${p.mixedActive} resource${p.mixedActive === 1 ? '' : 's'}`);
        if (p.mixedPassive) add('mixed_passive', `${p.mixedPassive} resource${p.mixedPassive === 1 ? '' : 's'}`);
        if (p.ms > 2000) add('slow', `${(p.ms / 1000).toFixed(1)} s`);
        if (p.bytes > 500 * 1024) add('large_html', `${Math.round(p.bytes / 1024)} KB`);
        if (p.renderBlocking) add('render_blocking', `${p.renderBlocking} script${p.renderBlocking === 1 ? '' : 's'}`);
        return out;
    }

    // ── Crawl ───────────────────────────────────────────────────
    // config: { startUrl, maxPages, maxDepth, scope: 'host' | 'subdomains', include: [patterns], exclude: [patterns],
    //           ignoreQuery, stripTracking, useSitemap, checkResources, concurrency, delayMs }
    async function crawl(config, { signal = new AbortController().signal, onProgress = () => {} } = {}) {
        const cfg = {
            maxPages: 200, maxDepth: 5, scope: 'host', include: [], exclude: [], ignoreQuery: false, stripTracking: true,
            useSitemap: true, checkResources: false, concurrency: 3, delayMs: 250, ...config
        };
        cfg.maxPages = Math.min(5000, Math.max(1, cfg.maxPages | 0));
        cfg.concurrency = Math.min(6, Math.max(1, cfg.concurrency | 0));
        const startUrl = normalizeUrl(/^https?:\/\//i.test(cfg.startUrl) ? cfg.startUrl : `https://${cfg.startUrl}`, undefined, cfg);
        if (!startUrl) throw new Error('Enter a valid http(s) address to crawl.');
        const start = new URL(startUrl);
        const siteHost = bareHost(start.hostname);
        const pattern = (p) => new RegExp(p.split('*').map(escapeRe).join('.*'), 'i');
        const include = cfg.include.filter(Boolean).map(pattern), exclude = cfg.exclude.filter(Boolean).map(pattern);
        const inScope = (url) => {
            const h = bareHost(new URL(url).hostname);
            return cfg.scope === 'subdomains' ? (h === siteHost || h.endsWith(`.${siteHost}`)) : h === siteHost;
        };
        const wanted = (url) => (!include.length || include.some(re => re.test(url))) && !exclude.some(re => re.test(url));

        const startedAt = Date.now();
        const site = { startUrl, host: start.hostname, robots: { status: null, url: `${start.origin}/robots.txt` }, sitemaps: [], notes: [] };
        const pages = new Map();            // requested URL -> page record
        const byFinal = new Map();          // final URL -> requested URL of the record that was analysed
        const inlinks = new Map();          // internal URL -> { count, from: [up to 10 source pages] }
        const external = new Map();         // external URL -> { from: [up to 5] }
        const imageUrls = new Map();        // image URL -> { from: [up to 5] }
        const sitemapUrls = new Set();
        const queue = [], queued = new Set();
        let active = 0, lastProgress = 0, current = '', droppedByLimit = 0;

        const progress = (force) => {
            const now = Date.now();
            if (!force && now - lastProgress < 200) return;
            lastProgress = now;
            onProgress({ crawled: pages.size, discovered: queued.size, queued: queue.length, current, elapsed: now - startedAt,
                failed: [...pages.values()].filter(p => p.error || p.status >= 400).length, blocked: [...pages.values()].filter(p => p.blocked).length });
        };
        const addLink = (map, url, from, cap) => {
            const e = map.get(url) || { count: 0, from: [] };
            e.count++;
            if (e.from.length < cap && !e.from.includes(from)) e.from.push(from);
            map.set(url, e);
        };
        const enqueue = (url, depth, from) => {
            if (!url || queued.has(url) || !inScope(url) || !wanted(url)) return;
            if (queued.size >= cfg.maxPages * 3) { droppedByLimit++; return; } // keeps memory bounded on huge sites
            queued.add(url);
            queue.push({ url, depth, from });
        };

        // robots.txt
        let robots = null, crawlDelay = 0;
        try {
            const { res } = await get(site.robots.url, signal);
            site.robots.status = res.status;
            if (res.ok) {
                robots = parseRobots(await res.text());
                crawlDelay = (robotsGroup(robots)?.delay || 0) * 1000;
                if (crawlDelay > 10000) { site.notes.push(`robots.txt asks for ${crawlDelay / 1000} s between requests; the crawler waited 10 s.`); crawlDelay = 10000; }
            }
        } catch (err) { site.robots.status = 0; site.robots.error = failMessage(err); }

        // Sitemaps: those robots.txt lists, else /sitemap.xml; sitemap indexes are followed (up to 20 files, 50 000 URLs).
        if (cfg.useSitemap && !signal.aborted) {
            const files = robots?.sitemaps.length ? [...robots.sitemaps] : [`${start.origin}/sitemap.xml`];
            const seenFiles = new Set();
            while (files.length && seenFiles.size < 20 && !signal.aborted) {
                const file = files.shift();
                if (seenFiles.has(file)) continue;
                seenFiles.add(file);
                const entry = { url: file, status: null, urls: 0 };
                site.sitemaps.push(entry);
                try {
                    const { res } = await get(file, signal);
                    entry.status = res.status;
                    if (!res.ok) continue;
                    const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
                    if (xml.querySelector('parsererror')) { entry.error = 'Not valid XML'; continue; }
                    const locs = (tag) => [...xml.getElementsByTagNameNS('*', tag)].map(n => n.getElementsByTagNameNS('*', 'loc')[0]?.textContent.trim()).filter(Boolean);
                    locs('sitemap').forEach(u => files.push(u));
                    for (const loc of locs('url')) {
                        if (sitemapUrls.size >= 50000) break;
                        const u = normalizeUrl(loc, undefined, cfg);
                        if (u) { sitemapUrls.add(u); entry.urls++; }
                    }
                } catch (err) { entry.status = 0; entry.error = failMessage(err); }
            }
        }

        enqueue(startUrl, 0, null);
        if (cfg.useSitemap) for (const u of sitemapUrls) enqueue(u, 1, 'sitemap');

        async function visit({ url, depth, from }) {
            current = url;
            const rule = robots ? robotsAllows(robots, url) : { allowed: true };
            if (!rule.allowed) { pages.set(url, { url, depth, from, blocked: true, blockedBy: rule.rule }); return; }
            const p = { url, depth, from };
            pages.set(url, p);
            try {
                const { res, ms } = await get(url, signal);
                p.status = res.status;
                p.ms = ms;
                p.finalUrl = normalizeUrl(res.url, undefined, cfg) || url;
                p.redirected = p.finalUrl !== url;
                p.contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
                const xRobots = (res.headers.get('x-robots-tag') || '').toLowerCase();
                if (p.redirected && !inScope(p.finalUrl)) { p.offsite = true; return; }
                if (p.redirected && byFinal.has(p.finalUrl)) { p.duplicateOf = byFinal.get(p.finalUrl); return; }
                byFinal.set(p.finalUrl, url);
                if (!res.ok || !/html/i.test(p.contentType)) return;
                const html = await res.text();
                p.bytes = new Blob([html]).size;
                const a = analyseHtml(html, p.finalUrl);
                p.html = true;
                const directives = `${a.robotsMeta}, ${xRobots}`;
                p.noindex = /\b(noindex|none)\b/.test(directives);
                p.nofollow = /\b(nofollow|none)\b/.test(directives);
                p.noindexSource = p.noindex ? (/\b(noindex|none)\b/.test(xRobots) ? 'X-Robots-Tag header' : 'meta robots') : '';
                const internalLinks = [];
                let externalCount = 0;
                for (const l of a.links) {
                    const target = normalizeUrl(l.href, undefined, cfg);
                    if (!target) continue;
                    if (inScope(target)) {
                        internalLinks.push(target);
                        addLink(inlinks, target, p.finalUrl, 10);
                        if (!p.nofollow && !l.nofollow && depth < cfg.maxDepth) enqueue(target, depth + 1, p.finalUrl);
                    } else {
                        externalCount++;
                        if (cfg.checkResources) addLink(external, target, p.finalUrl, 5);
                    }
                }
                if (cfg.checkResources) a.images.forEach(img => addLink(imageUrls, img.src, p.finalUrl, 5));
                Object.assign(p, {
                    title: a.title, titleCount: a.titleCount, desc: a.desc, descCount: a.descCount, h1: a.h1, headings: a.headings,
                    headingSkips: a.headingSkips, canonicals: a.canonicals, lang: a.lang, og: a.og, schema: a.schema,
                    images: a.images.map(({ src, alt, sized }) => ({ src, alt, sized })),
                    mixedActive: a.mixedActive, mixedPassive: a.mixedPassive, renderBlocking: a.renderBlocking, words: a.words,
                    linksInternal: internalLinks.length, linksExternal: externalCount,
                    httpLinks: start.protocol === 'https:' ? [...new Set(internalLinks.filter(u => u.startsWith('http:')))].slice(0, 10) : []
                });
            } catch (err) {
                if (signal.aborted) { pages.delete(url); return; }
                p.error = failMessage(err);
            }
        }

        async function worker() {
            for (;;) {
                if (signal.aborted) return;
                const job = queue.shift();
                if (!job) { if (!active) return; await sleep(50); continue; }
                if (pages.size >= cfg.maxPages) { droppedByLimit++; continue; }
                active++;
                try { await visit(job); } finally { active--; }
                progress();
                await sleep(Math.max(cfg.delayMs, crawlDelay), signal);
            }
        }
        await Promise.all(Array.from({ length: cfg.concurrency }, worker));

        // Links to other sites and images: status and size, one HEAD request each (GET when HEAD is refused).
        const checked = { external: [], images: [] };
        if (cfg.checkResources && !signal.aborted) {
            const check = async (url) => {
                try {
                    let { res } = await get(url, signal, 'HEAD');
                    if (res.status === 405 || res.status === 403 || res.status === 501) ({ res } = await get(url, signal, 'GET'));
                    return { status: res.status, bytes: Number(res.headers.get('content-length')) || 0 };
                } catch (err) { return { status: 0, error: failMessage(err) }; }
            };
            const run = async (map, out, limit) => {
                const items = [...map].slice(0, limit);
                for (let i = 0; i < items.length && !signal.aborted; i += 4) {
                    current = 'Checking links and images...';
                    progress(true);
                    const batch = await Promise.all(items.slice(i, i + 4).map(async ([url, e]) => ({ url, from: e.from, ...(await check(url)) })));
                    out.push(...batch);
                }
            };
            await run(external, checked.external, 200);
            await run(imageUrls, checked.images, 200);
        }

        return finish({ cfg, site, pages, inlinks, sitemapUrls, checked, startedAt, stopped: signal.aborted, droppedByLimit, queueLeft: queue.length });
    }

    // ── Site-wide checks and the result ─────────────────────────
    // result: { version: 1, config, site: { startUrl, host, robots, sitemaps, notes, sitemapUrlCount }, state:
    //   'completed' | 'stopped', startedAt, endedAt, stats, pages: [page record + { issues: [codes], inlinks }],
    //   issues: [{ code, url, detail }], external: [{ url, status, from }], images: [{ url, status, bytes, from }] }
    function finish({ cfg, site, pages, inlinks, sitemapUrls, checked, startedAt, stopped, droppedByLimit, queueLeft }) {
        const list = [...pages.values()];
        const issues = list.flatMap(pageIssues);
        const add = (code, url, detail) => issues.push({ code, url, detail });
        const finalIndex = new Map(list.filter(p => p.finalUrl).map(p => [p.finalUrl, p]));
        const recordOf = (url) => pages.get(url) || finalIndex.get(url);
        const indexable = list.filter(p => p.html && !p.duplicateOf && p.status < 300 && !p.noindex);

        const dupes = (field, code) => {
            const groups = new Map();
            indexable.forEach(p => { const v = (p[field] || '').toLowerCase(); if (v) groups.set(v, [...(groups.get(v) || []), p]); });
            groups.forEach(g => { if (g.length > 1) g.forEach(p => add(code, p.url, `Shared with ${g.length - 1} other page${g.length === 2 ? '' : 's'}`)); });
        };
        dupes('title', 'title_duplicate');
        dupes('desc', 'desc_duplicate');

        for (const [target, e] of inlinks) {
            const t = recordOf(target);
            if (!t || t.blocked) continue;
            if (t.error || t.status >= 400) e.from.forEach(src => add('link_broken', src, `${target} (${t.error || `HTTP ${t.status}`})`));
            else if (t.redirected) e.from.forEach(src => add('link_redirect', src, `${target} → ${t.finalUrl}`));
        }
        list.filter(p => p.httpLinks?.length).forEach(p => add('link_http', p.url, p.httpLinks.join(' | ')));
        list.filter(p => p.canonicals?.length === 1 && p.canonicals[0] !== p.finalUrl).forEach(p => {
            const c = recordOf(p.canonicals[0]);
            if (c && (c.error || c.status >= 300 || c.redirected)) add('canonical_broken', p.url, `${p.canonicals[0]} (${c.error || (c.redirected ? `redirects to ${c.finalUrl}` : `HTTP ${c.status}`)})`);
        });
        for (const u of sitemapUrls) {
            const p = recordOf(u);
            if (!p || p.blocked) continue;
            const why = p.error ? p.error : p.status >= 400 ? `HTTP ${p.status}` : p.redirected ? `redirects to ${p.finalUrl}` : p.noindex ? 'noindex' : '';
            if (why) add('noindex_sitemap', u, why);
        }
        // Orphans need the whole site: only after a crawl that finished on its own.
        const complete = !stopped && !droppedByLimit && !queueLeft;
        if (complete && sitemapUrls.size) {
            for (const u of sitemapUrls) {
                const p = recordOf(u);
                if (p && p.html && !p.redirected && !(inlinks.get(u)?.count) && u !== site.startUrl) add('orphan', u, 'Found only in the sitemap');
            }
        } else if (sitemapUrls.size) {
            site.notes.push('Orphan pages are not reported: the crawl did not cover the whole site (stopped or page limit reached).');
        }
        checked.external.filter(r => r.error || r.status >= 400).forEach(r => r.from.forEach(src => add('external_broken', src, `${r.url} (${r.error || `HTTP ${r.status}`})`)));
        checked.images.forEach(r => {
            if (r.error || r.status >= 400) r.from.forEach(src => add('img_broken', src, `${r.url} (${r.error || `HTTP ${r.status}`})`));
            else if (r.bytes > 300 * 1024) r.from.forEach(src => add('img_large', src, `${r.url} (${Math.round(r.bytes / 1024)} KB)`));
        });
        if (droppedByLimit) site.notes.push(`Page limit reached: ${droppedByLimit} more URL${droppedByLimit === 1 ? ' was' : 's were'} found but not crawled.`);

        const issueCodes = new Map();
        issues.forEach(i => issueCodes.set(i.url, [...(issueCodes.get(i.url) || []), i.code]));
        const pagesOut = list.map(p => ({ ...p, issues: [...new Set(issueCodes.get(p.url) || [])], inlinks: inlinks.get(p.url)?.count || inlinks.get(p.finalUrl)?.count || 0 }));
        const count = (fn) => list.filter(fn).length;
        return {
            version: 1,
            config: cfg,
            site: { ...site, sitemapUrlCount: sitemapUrls.size },
            state: stopped ? 'stopped' : 'completed',
            startedAt, endedAt: Date.now(),
            stats: {
                pages: list.length,
                ok: count(p => p.status >= 200 && p.status < 300 && !p.redirected),
                redirected: count(p => p.redirected),
                errors: count(p => p.status >= 400),
                failed: count(p => p.error),
                blocked: count(p => p.blocked),
                html: count(p => p.html),
                critical: issues.filter(i => ISSUES[i.code].severity === 'critical').length,
                warning: issues.filter(i => ISSUES[i.code].severity === 'warning').length,
                info: issues.filter(i => ISSUES[i.code].severity === 'info').length
            },
            pages: pagesOut,
            issues,
            external: checked.external,
            images: checked.images
        };
    }

    return { ISSUES, normalizeUrl, parseRobots, robotsAllows, analyseHtml, pageIssues, crawl };
})();
