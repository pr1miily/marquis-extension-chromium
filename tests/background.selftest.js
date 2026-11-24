// Self-test for background.js: the notification service (notify, Do Not Disturb, edits, task reminders, toolbar
// badge) and the Bulk URL opener (queue, stop, one batch at a time, grouping). Runs the real service worker file
// against an in-memory `chrome` stub:
//   node tests/background.selftest.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');

function makeChrome() {
    const store = { local: {}, session: {}, sync: {} };
    const listeners = { storage: [], message: [], alarm: [], clicked: [] };
    const log = { created: [], cleared: [], badge: [], alarms: new Map(), tabs: [], windows: [], groups: [], groupTitles: {} };
    let ids = 100;
    const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
    const area = (name) => ({
        async get(keys) {
            const all = store[name], out = {};
            [].concat(keys ?? Object.keys(all)).forEach(k => { if (k in all) out[k] = clone(all[k]); });
            return out;
        },
        async set(obj) {
            const changes = {};
            for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: store[name][k], newValue: clone(v) }; store[name][k] = clone(v); }
            listeners.storage.forEach(l => l(changes, name));
        },
        async remove(keys) { [].concat(keys).forEach(k => delete store[name][k]); }
    });
    const evt = (bucket) => ({ addListener: (l) => bucket && listeners[bucket].push(l), removeListener() {} });
    // Anything the test does not model is a harmless no-op that resolves.
    const anything = () => new Proxy(function () {}, { get: (_, k) => (k === 'then' ? undefined : anything()), apply: () => Promise.resolve() });
    const chrome = new Proxy({
        storage: { local: area('local'), session: area('session'), sync: area('sync'), onChanged: evt('storage') },
        runtime: { getURL: (p) => `chrome-extension://lab/${p.replace(/^\//, '')}`, onMessage: evt('message'),
            getContexts: async () => [], onInstalled: evt(), onStartup: evt(), id: 'lab' },
        notifications: { create: (id, opts) => log.created.push({ id, ...opts }), clear: (id) => log.cleared.push(id), onClicked: evt('clicked') },
        alarms: {
            create: async (name, { when }) => log.alarms.set(name, when),
            clear: async (name) => log.alarms.delete(name),
            getAll: async () => [...log.alarms].map(([name, scheduledTime]) => ({ name, scheduledTime })),
            onAlarm: evt('alarm')
        },
        action: { setBadgeText: ({ text, tabId }) => { if (tabId == null) log.badge.push(text); }, setBadgeBackgroundColor() {}, getBadgeText() {} },
        tabs: new Proxy({
            create: async ({ url, windowId }) => { log.tabs.push({ url, windowId }); return { id: ++ids }; },
            group: async ({ tabIds, groupId }) => { const id = groupId ?? ++ids; log.groups.push({ tabIds, groupId: id }); return id; }
        }, { get: (t, k) => (k in t ? t[k] : anything()) }),
        windows: new Proxy({
            create: async ({ url }) => { log.windows.push(url); return { id: ++ids }; }
        }, { get: (t, k) => (k in t ? t[k] : anything()) }),
        tabGroups: { update: async (id, { title }) => { log.groupTitles[id] = title; } },
        declarativeNetRequest: anything(), scripting: anything()
    }, { get: (t, k) => (k in t ? t[k] : anything()) });
    return { chrome, store, listeners, log };
}

function loadWorker() {
    const env = makeChrome();
    const context = vm.createContext({
        chrome: env.chrome, console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Blob, TextEncoder, TextDecoder,
        fetch: async () => { throw new Error('no network in the self-test'); } // getPaddedIcon falls back to the URL
    });
    context.self = context;
    context.importScripts = (...files) => files.forEach(f => {
        if (/notify_sources|focus_timer|url_list/.test(f)) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f });
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context, { filename: 'background.js' });
    return { ...env, context };
}

const settle = () => new Promise(r => setTimeout(r, 30));
const send = (env, msg) => env.listeners.message.forEach(l => l(msg, {}, () => {}));
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; };

(async () => {
    {
        const env = loadWorker(); const { context, store, log } = env;
        context.notify({ source: 'kanban', title: 'Card due now', message: 'Ship v4', level: 'reminder', id: 'kanban_due_1' });
        await settle();
        const list = store.local.marquisNotifications;
        check('notify records the event, unread, newest first', list.length === 1 && list[0].id === 'kanban_due_1' && !list[0].isRead && store.local.unreadNotifCount === 1);
        check('device pop-up carries the same title/text and the tool name', log.created.length === 1 && log.created[0].title === 'Card due now'
            && log.created[0].message === 'Ship v4' && log.created[0].contextMessage === 'Marquis · Kanban Board' && log.created[0].requireInteraction === true);
        check('toolbar badge shows the unread count', log.badge.at(-1) === '1');

        context.notify({ source: 'kanban', title: 'Card due now', message: 'Ship v4', level: 'reminder', id: 'kanban_due_1' });
        await settle();
        check('same id replaces the entry (no duplicate)', store.local.marquisNotifications.length === 1);

        await Promise.all(['a', 'b', 'c', 'd'].map(t => context.notify({ source: 'capture', title: t })));
        await settle();
        check('events sent at the same moment are all kept', store.local.marquisNotifications.length === 5);

        context.notify({ source: 'nonsense', title: 'x' });
        await settle();
        check('unknown source falls back to Marquis', store.local.marquisNotifications[0].source === 'marquis');

        send(env, { action: 'notifyEdit', op: 'readAll' });
        await settle();
        check('mark all read', store.local.marquisNotifications.every(n => n.isRead) && store.local.unreadNotifCount === 0 && log.badge.at(-1) === '');

        store.local.marquisNotifications.push({ id: 1700000000000, source: 'kanban', title: 'Deadline Reached', message: 'Your task "Old card" is now due.', isRead: false });
        send(env, { action: 'notifyDismiss', id: 'kanban_due_9', source: 'kanban', text: 'Old card' });
        await settle();
        check('dismiss also removes older numeric-id entries by text', !store.local.marquisNotifications.some(n => n.id === 1700000000000));

        send(env, { action: 'notifyEdit', op: 'clear' });
        await settle();
        check('clear all empties the list', store.local.marquisNotifications.length === 0);
    }
    {
        const env = loadWorker(); const { context, store, log } = env;
        store.local.notifyPrefs = { dnd: true };
        context.notify({ source: 'focus', title: 'Focus session complete' });
        context.notify({ source: 'kanban', title: 'Card due now', level: 'reminder' });
        await settle();
        check('Do Not Disturb: no pop-ups, events still listed as unread', log.created.length === 0 && store.local.marquisNotifications.length === 2 && store.local.unreadNotifCount === 2);

        store.local.notifyPrefs = { dnd: true, dndReminders: true };
        context.notify({ source: 'tasks', title: 'Task due today', level: 'reminder' });
        context.notify({ source: 'capture', title: 'Screenshot failed', level: 'error' });
        await settle();
        check('Do Not Disturb lets reminders through only when allowed', log.created.length === 1 && log.created[0].title === 'Task due today');

        store.local.notifyPrefs = { dnd: false, popups: { capture: false } };
        context.notify({ source: 'capture', title: 'Screenshot failed', level: 'error' });
        context.notify({ source: 'focus', title: 'Break is over', silent: true });
        await settle();
        check('a tool switched off, or a silent event, records without a pop-up', log.created.length === 1 && store.local.marquisNotifications.length === 6);
        check('turning Do Not Disturb off replays nothing', log.created.length === 1);

        store.session.recorderWindowId = 42;
        const before = log.badge.length;
        context.notify({ source: 'focus', title: 'x' });
        await settle();
        check('recorder window open: the badge is left to it', log.badge.length === before);
    }
    {
        const env = loadWorker(); const { store, log, listeners } = env;
        const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
        await env.chrome.storage.local.set({ marquisTasks: [
            { id: 1, title: 'Send invoice', date: day(2), completed: false },
            { id: 2, title: 'Done already', date: day(2), completed: true },
            { id: 3, title: 'No date', date: '', completed: false }] });
        await settle();
        const when = log.alarms.get('task_due_1');
        check('task reminder: one alarm at 9:00 on the due date', log.alarms.size === 1 && new Date(when).getHours() === 9 && !log.alarms.has('task_due_2'));

        await env.chrome.storage.local.set({ marquisTasks: [{ id: 1, title: 'Send invoice', date: day(2), completed: true }] });
        await settle();
        check('completing the task drops its reminder', !log.alarms.has('task_due_1'));

        await env.chrome.storage.local.set({ marquisTasks: [{ id: 5, title: 'Pay rent', date: day(1), completed: false }] });
        await settle();
        listeners.alarm.forEach(l => l({ name: 'task_due_5' }));
        await settle();
        const e = store.local.marquisNotifications?.[0];
        check('the reminder fires as a Notes & Tasks reminder', e && e.id === 'task_due_5' && e.source === 'tasks' && e.level === 'reminder' && e.message === 'Pay rent');

        store.local.kanbanAlarms = { kanban_due_7: 'Launch post' };
        listeners.alarm.forEach(l => l({ name: 'kanban_due_7' }));
        await settle();
        check('Kanban due alarm notifies once and forgets the alarm', store.local.marquisNotifications[0].id === 'kanban_due_7'
            && store.local.marquisNotifications[0].message === 'Launch post' && !('kanban_due_7' in store.local.kanbanAlarms));
    }
    {
        // ── Bulk URL opener ──
        const env = loadWorker(); const { store, log } = env;
        const ask = (msg) => new Promise(r => env.listeners.message.forEach(l => l(msg, {}, r)));
        const res = await ask({ action: 'bulk_open_urls', urls: ['a.com', 'B.com/x?y=1#z', 'https://a.com/', 'not a url', 'javascript:alert(1)'], target: 'tabs' });
        await settle();
        check('bulk: answers totals, skipped lines and duplicates', res.ok && res.total === 2 && res.duplicates === 1 && res.skipped.length === 2, res);
        check('bulk: opens https URLs one by one, path/query/fragment kept', JSON.stringify(log.tabs.map(t => t.url)) === JSON.stringify(['https://a.com/', 'https://b.com/x?y=1#z']), log.tabs);
        check('bulk: progress ends as done with counts', store.session.bulkJob.state === 'done' && store.session.bulkJob.opened === 2 && store.session.bulkJob.total === 2, store.session.bulkJob);

        log.tabs.length = 0;
        const first = await ask({ action: 'bulk_open_urls', urls: ['one.com', 'two.com', 'three.com', 'four.com'], target: 'tabs', delayMs: 120 });
        const second = await ask({ action: 'bulk_open_urls', urls: ['five.com'], target: 'tabs' });
        check('bulk: a second batch is refused while one runs', first.ok && !second.ok && second.busy, second);
        await new Promise(r => setTimeout(r, 160));
        await ask({ action: 'bulk_stop' });
        await new Promise(r => setTimeout(r, 400));
        check('bulk: Stop keeps the rest from opening', store.session.bulkJob.state === 'stopped' && log.tabs.length >= 1 && log.tabs.length < 4, { opened: log.tabs.length, state: store.session.bulkJob.state });
        const third = await ask({ action: 'bulk_open_urls', urls: ['six.com'], target: 'tabs' });
        await settle();
        check('bulk: a new batch can start after Stop', third.ok, third);

        log.tabs.length = 0; log.groups.length = 0;
        await ask({ action: 'bulk_open_urls', urls: ['www.alpha.com/1', 'alpha.com/2', 'beta.com', 'blog.alpha.com'], target: 'groupPerHost' });
        await settle();
        const titles = Object.values(log.groupTitles).sort();
        check('bulk: tab group per domain (www ignored, subdomain separate)', JSON.stringify(titles) === JSON.stringify(['alpha.com', 'beta.com', 'blog.alpha.com']) && log.tabs.length === 4, { titles, tabs: log.tabs.length });

        log.tabs.length = 0; log.windows.length = 0;
        await ask({ action: 'bulk_open_urls', urls: ['alpha.com/1', 'beta.com/1', 'alpha.com/2'], target: 'windowPerHost' });
        await settle();
        check('bulk: window per domain adds later URLs as tabs of that window', log.windows.length === 2 && log.tabs.length === 1 && log.tabs[0].url === 'https://alpha.com/2' && log.tabs[0].windowId, { windows: log.windows, tabs: log.tabs });

        log.tabs.length = 0;
        await ask({ action: 'bulk_open_urls', urls: ['a.com', 'b.com', 'c.com', 'd.com'], target: 'tabs', max: 2 });
        await settle();
        check('bulk: max per batch', log.tabs.length === 2, log.tabs);
    }
    console.log(failed ? `${failed} FAILED` : 'ALL PASS');
    process.exit(failed ? 1 : 0);
})();
