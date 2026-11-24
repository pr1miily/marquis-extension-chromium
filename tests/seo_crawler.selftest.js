// Self-test for the pure parts of scripts/seo_crawler.js (URL normalizing, robots.txt):  node tests/seo_crawler.selftest.js
// The crawl itself (fetch, DOMParser, issues) is checked in a browser against a fixture site.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'seo_crawler.js'), 'utf8') + '\nthis.C = MarquisSeoCrawler;', ctx);
const C = ctx.C;
let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  got: ${JSON.stringify(got)}`}`); if (!ok) failed++; };
const n = (h, b, o) => C.normalizeUrl(h, b, o);

check('relative link resolved, fragment dropped', n('../b?x=1#top', 'https://site.test/a/c') === 'https://site.test/b?x=1', n('../b?x=1#top', 'https://site.test/a/c'));
check('host lowercased, default port dropped', n('HTTPS://Site.Test:443/Path') === 'https://site.test/Path', n('HTTPS://Site.Test:443/Path'));
check('tracking parameters removed, others kept', n('https://s.test/p?utm_source=x&id=7&gclid=y') === 'https://s.test/p?id=7', n('https://s.test/p?utm_source=x&id=7&gclid=y'));
check('tracking kept when the option is off', n('https://s.test/p?utm_source=x', undefined, { stripTracking: false }) === 'https://s.test/p?utm_source=x', n('https://s.test/p?utm_source=x', undefined, { stripTracking: false }));
check('ignoreQuery drops the query', n('https://s.test/p?id=7', undefined, { ignoreQuery: true }) === 'https://s.test/p', n('https://s.test/p?id=7', undefined, { ignoreQuery: true }));
check('trailing slash kept as written (servers decide by redirecting)', n('https://s.test/a/') !== n('https://s.test/a'), [n('https://s.test/a/'), n('https://s.test/a')]);
check('non-web links refused', n('mailto:a@b.test') === null && n('javascript:void(0)') === null, [n('mailto:a@b.test'), n('javascript:void(0)')]);

const robots = C.parseRobots(`# comment
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /private/
Allow: /private/ok
Disallow: /*.pdf$
Disallow: /search?
Crawl-delay: 2
Sitemap: https://s.test/sitemap.xml`);
const allows = (p) => C.robotsAllows(robots, `https://s.test${p}`).allowed;
check('robots: the * group applies (not Googlebot\'s)', allows('/') && allows('/about'), [allows('/'), allows('/about')]);
check('robots: Disallow prefix', !allows('/private/x'), C.robotsAllows(robots, 'https://s.test/private/x'));
check('robots: longer Allow wins', allows('/private/ok'), C.robotsAllows(robots, 'https://s.test/private/ok'));
check('robots: * and $ patterns', !allows('/files/a.pdf') && allows('/files/a.pdf?v=1'), [allows('/files/a.pdf'), allows('/files/a.pdf?v=1')]);
check('robots: query in the rule', !allows('/search?q=x') && allows('/search'), [allows('/search?q=x'), allows('/search')]);
check('robots: crawl-delay and sitemap read', robots.groups[1].delay === 2 && robots.sitemaps[0] === 'https://s.test/sitemap.xml', robots);
check('robots: empty file allows everything', C.robotsAllows(C.parseRobots(''), 'https://s.test/x').allowed, null);

const issues = C.pageIssues({ url: 'https://s.test/a', finalUrl: 'https://s.test/a', status: 200, html: true, title: '', desc: 'x'.repeat(200), h1: ['A', 'B'], headingSkips: 0,
    canonicals: ['https://s.test/a', 'https://s.test/b'], noindex: false, lang: '', og: { title: 'a', image: '' }, schema: [{ types: [], error: 'JSON does not parse' }],
    images: [{ alt: null, sized: true }, { alt: '', sized: false }], mixedActive: 0, mixedPassive: 0, ms: 2500, bytes: 1000, renderBlocking: 0 }).map(i => i.code).sort();
check('page checks pick the right issues', JSON.stringify(issues) === JSON.stringify(['canonical_multiple', 'desc_long', 'h1_multiple', 'img_alt_empty', 'img_alt_missing', 'img_size_missing', 'lang_missing', 'og_missing', 'schema_invalid', 'slow', 'title_missing']), issues);
check('every issue code has severity, explanation and fix', Object.values(C.ISSUES).every(d => ['critical', 'warning', 'info'].includes(d.severity) && d.why && d.fix && d.category), null);

console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
