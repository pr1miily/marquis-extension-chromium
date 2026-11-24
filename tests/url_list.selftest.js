// Self-test for scripts/url_list.js (Bulk URL parsing):  node tests/url_list.selftest.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'url_list.js'), 'utf8') + '\nthis.L = MarquisUrlList;', ctx);
const L = ctx.L;
let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  got: ${JSON.stringify(got)}`}`); if (!ok) failed++; };
const n = (s) => L.normalize(s);

check('bare host gets https, not http', n('example.com').url === 'https://example.com/', n('example.com'));
check('path, query and fragment are kept', n('example.com/a/b?q=1&x=Y#Top').url === 'https://example.com/a/b?q=1&x=Y#Top', n('example.com/a/b?q=1&x=Y#Top'));
check('explicit http stays http', n('http://example.com/x').url === 'http://example.com/x', n('http://example.com/x'));
check('host lowercased, default port dropped', n('HTTPS://WWW.Example.COM:443/Path').url === 'https://www.example.com/Path', n('HTTPS://WWW.Example.COM:443/Path'));
check('localhost with port', n('localhost:3000/app').url === 'https://localhost:3000/app', n('localhost:3000/app'));
check('IP address', n('192.168.1.10/admin').url === 'https://192.168.1.10/admin', n('192.168.1.10/admin'));
check('wrapping <> and quotes removed', n('<https://a.com/x>').url === 'https://a.com/x' && n('"b.org"').url === 'https://b.org/', [n('<https://a.com/x>'), n('"b.org"')]);
check('javascript: refused with a reason', /javascript/.test(n('javascript:alert(1)').error), n('javascript:alert(1)'));
check('ftp:// refused', !!n('ftp://files.example.com').error, n('ftp://files.example.com'));
check('mailto refused', !!n('mailto:a@b.com').error, n('mailto:a@b.com'));
check('a word with no domain refused', !!n('hello').error, n('hello'));
check('text with spaces refused (points to Extract)', /Extract/.test(n('see example.com now').error || ''), n('see example.com now'));
check('double dot host refused', !!n('example..com').error, n('example..com'));

const a = L.analyse('example.com\n\nhttps://example.com/\nfoo\nhttp://example.com/\nexample.com/page');
check('analyse: counts valid, invalid and duplicates', a.valid === 3 && a.invalid === 1 && a.duplicates === 1, { valid: a.valid, invalid: a.invalid, duplicates: a.duplicates });
check('analyse: duplicate points at the first line', a.entries.find(e => e.dupOf)?.dupOf === 1, a.entries);
check('analyse: http and https are different URLs', a.urls.includes('http://example.com/') && a.urls.includes('https://example.com/'), a.urls);

const text = 'Docs: https://developer.mozilla.org/en-US/docs/Web (great). Also see example.org, and wiki https://en.wikipedia.org/wiki/Cat_(disambiguation). Mail me at jo@corp.com. e.g. file.txt or v1.2.';
const ex = L.extract(text);
check('extract: finds links in prose and trims punctuation', JSON.stringify(ex) === JSON.stringify(['https://developer.mozilla.org/en-US/docs/Web', 'example.org', 'https://en.wikipedia.org/wiki/Cat_(disambiguation)']), ex);
// readme.txt is skipped (.txt is no TLD); note readme.md would match, .md being Moldova's real country domain.
check('extract: bare domains with real TLDs only', JSON.stringify(L.extract('go to news.ycombinator.com/item?id=1 and readme.txt')) === JSON.stringify(['news.ycombinator.com/item?id=1']), L.extract('go to news.ycombinator.com/item?id=1 and readme.txt'));

check('groupKey ignores www, keeps subdomains apart', L.groupKey('https://www.example.com/a') === 'example.com' && L.groupKey('https://blog.example.com/') === 'blog.example.com', [L.groupKey('https://www.example.com/a'), L.groupKey('https://blog.example.com/')]);

console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
