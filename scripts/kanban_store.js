// Kanban board storage, shared by the popup Kanban section, kanban_fullscreen.html and the dock content script.
//
// chrome.storage.local `kanbanBoard`:
//   { version: 1, columns: [{ id, title, cards: [Card] }] }
//   Card: { id, title, desc, date: 'YYYY-MM-DD' | '', time: 'HH:MM' | '', completed,
//           cover: 'none' | CSS color, labels: [{ text, cls: 'bg-*' } | { text, color: CSS color }],
//           checklist: [{ text, done }] }
//
// The legacy key `kanbanBoardData` ([{ id, title, html }], cards stored as serialized markup) is migrated
// on first load and is never modified or deleted, so it remains as a backup of the pre-migration board.
// Assigned to globalThis instead of declared with const so that re-injecting the dock does not throw.
globalThis.KanbanStore = globalThis.KanbanStore || (() => {
    const KEY = 'kanbanBoard';
    const LEGACY_KEY = 'kanbanBoardData';
    const VERSION = 1;

    const defaultBoard = () => ({
        version: VERSION,
        columns: [['kb-todo', 'To Do'], ['kb-inprogress', 'In Progress'], ['kb-done', 'Done']]
            .map(([id, title]) => ({ id, title, cards: [] }))
    });

    function newCard(fields) {
        return {
            id: `card-${Date.now()}`, title: '', desc: '', date: '', time: '', completed: false,
            cover: 'none', labels: [], checklist: [], ...fields
        };
    }

    // Reads one card from the board's card markup. The live board and the legacy stored HTML use the
    // same markup, so the board's save and the migration share this reader.
    // Null-safe, so one malformed legacy card cannot abort the migration.
    function readCard(el) {
        const text = (root, sel) => root.querySelector(sel)?.textContent ?? '';
        const [date = '', time = ''] = text(el, '.card-date-text').split('|');
        return {
            id: el.getAttribute('data-card-id'),
            title: text(el, '.card-title-text'),
            desc: text(el, '.card-desc-text'),
            date, time,
            completed: !!el.querySelector('.card-quick-complete')?.checked,
            cover: el.getAttribute('data-cover') || 'none',
            labels: [...el.querySelectorAll('.trello-labels .trello-label')].map(lbl => {
                const text = lbl.getAttribute('data-text') || '';
                const cls = [...lbl.classList].find(c => c.startsWith('bg-'));
                return cls ? { text, cls } : { text, color: lbl.style.backgroundColor };
            }),
            checklist: [...el.querySelectorAll('.card-checklist-data li')].map(li => ({
                text: text(li, 'span'),
                done: !!li.querySelector('.checklist-toggle')?.checked
            }))
        };
    }

    // DOMParser documents are inert: the stored markup cannot run script or load resources while parsed.
    function fromLegacy(columns) {
        const parser = new DOMParser();
        return {
            version: VERSION,
            columns: columns.filter(col => col && typeof col === 'object').map((col, ci) => {
                const doc = parser.parseFromString(String(col.html || ''), 'text/html');
                // Legacy descriptions were written with innerText, which stores line breaks as <br>.
                doc.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
                return {
                    id: String(col.id || `kb-legacy-${ci}`),
                    title: String(col.title ?? ''),
                    cards: [...doc.querySelectorAll('.trello-card')].map((el, i) => {
                        const card = readCard(el);
                        // Deterministic, so two contexts migrating at once write the same board.
                        card.id = card.id || `card-legacy-${ci}-${i}`;
                        return card;
                    })
                };
            })
        };
    }

    // The stored board, migrated from the legacy key on first use. An empty board falls back to the
    // default lists, as the HTML version did.
    async function load() {
        const res = await chrome.storage.local.get([KEY, LEGACY_KEY]);
        const stored = res[KEY];
        if (stored && Array.isArray(stored.columns)) return stored.columns.length ? stored : defaultBoard();
        if (Array.isArray(res[LEGACY_KEY]) && res[LEGACY_KEY].length) {
            const board = fromLegacy(res[LEGACY_KEY]);
            await chrome.storage.local.set({ [KEY]: board });
            return board;
        }
        return defaultBoard();
    }

    function save(columns) {
        return chrome.storage.local.set({ [KEY]: { version: VERSION, columns } });
    }

    // Read-modify-write for edits made outside the board page (the dock).
    async function update(mutate) {
        const board = await load();
        mutate(board);
        await chrome.storage.local.set({ [KEY]: board });
        return board;
    }

    // Due-date badge state, shared by the board and the dock. null when the card has no date.
    function due(card, now = new Date()) {
        if (!card.date) return null;
        const at = new Date(`${card.date}T${card.time || '12:00'}:00`);
        const status = card.completed ? 'done'
            : at < now ? 'overdue'
            : at - now < 24 * 60 * 60 * 1000 ? 'soon'
            : 'scheduled';
        const text = status === 'overdue' ? 'OVERDUE'
            : status === 'soon' ? 'DUE SOON'
            : `${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${card.time ? at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}`.trim();
        return { status, text };
    }

    return { KEY, LEGACY_KEY, load, save, update, newCard, readCard, fromLegacy, due };
})();
