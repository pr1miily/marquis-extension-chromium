// Notifications panel: the bell in the header and #notificationsModal.
// background.js records every event (notify) in storage.local marquisNotifications and owns every edit to that
// list ({ action: 'notifyEdit' | 'notifyDismiss' }), so this file only shows it and saves preferences
// (storage.local notifyPrefs: { dnd, dndReminders, popups: { [source]: false } }).
// Overdue Kanban cards and tasks are listed on top from their own data: they are a state, not an event.
document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const list = $('globalNotifList'), empty = $('notifEmptyState'), modalEl = $('notificationsModal');
    const bell = $('notifContainer'), badge = $('notifBadge'), bellIcon = $('notifIcon');
    if (!list || !modalEl) return;

    const esc = MarquisHtml.esc;
    const SOURCES = typeof MarquisNotifySources !== 'undefined' ? MarquisNotifySources : {};
    const src = (key) => SOURCES[key] || SOURCES.marquis || { label: 'Marquis', icon: 'bell-fill', color: '#64748b' };
    const LEVEL_ICON = {
        error: '<i class="bi bi-exclamation-triangle-fill text-danger" aria-label="Error"></i>',
        success: '<i class="bi bi-check-circle-fill text-success" aria-label="Done"></i>',
        reminder: '<i class="bi bi-alarm-fill text-warning" aria-label="Reminder"></i>'
    };
    const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

    let entries = [], prefs = {}, board = null, tasks = [];

    // ── Overdue (derived) ─────────────────────────────────────
    function overdueItems() {
        const out = [];
        const now = new Date();
        if (typeof KanbanStore !== 'undefined' && board && Array.isArray(board.columns)) {
            for (const col of board.columns) for (const card of col.cards || []) {
                if (KanbanStore.due(card, now)?.status === 'overdue') out.push({ source: 'kanban', section: 'kanbanSection', title: card.title || 'Untitled card', when: col.title || 'Board' });
            }
        }
        const today = new Date(new Date().setHours(0, 0, 0, 0)); // same rule as the task list (sticky_notes.js)
        for (const t of tasks) {
            if (t && !t.completed && t.date && new Date(t.date) < today) out.push({ source: 'tasks', section: 'stickyNotesSection', title: t.title || 'Untitled task', when: `due ${new Date(t.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}` });
        }
        return out;
    }

    // ── Rendering ─────────────────────────────────────────────
    function ago(iso) {
        const d = new Date(iso), s = (Date.now() - d) / 1000;
        if (!Number.isFinite(s)) return '';
        if (s < 60) return 'just now';
        if (s < 3600) return `${Math.floor(s / 60)} min ago`;
        if (s < 86400 && d.getDate() === new Date().getDate()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    const toolIcon = (s) => `<span class="mq-tool-icon" style="--tool: ${esc(s.color)}; --size: 20px;" aria-hidden="true"><i class="bi bi-${esc(s.icon)}"></i></span>`;
    const groupHead = (s, extra) => `<div class="mq-notif-group-head">${toolIcon(s)}<span>${esc(s.label)}</span>${extra || ''}</div>`;

    function render() {
        const overdue = overdueItems();
        let html = '';
        if (overdue.length) {
            html += `<section class="mq-notif-group" aria-label="Overdue">
                <div class="mq-notif-group-head text-danger"><i class="bi bi-exclamation-circle-fill" aria-hidden="true"></i><span>Overdue</span><span class="ms-auto">${overdue.length}</span></div>
                ${overdue.map((o, i) => `<button type="button" class="mq-notif-row is-link" data-overdue="${i}">
                    ${toolIcon(src(o.source))}
                    <span class="flex-grow-1 min-w-0"><span class="mq-notif-title d-block text-truncate">${esc(o.title)}</span>
                    <span class="mq-notif-msg">${esc(src(o.source).label)} · ${esc(o.when)}</span></span>
                    <i class="bi bi-chevron-right text-muted align-self-center" aria-hidden="true"></i></button>`).join('')}
            </section>`;
        }
        // Events grouped by tool; groups ordered by their newest event.
        const groups = new Map();
        for (const n of entries) {
            const key = SOURCES[n.source] ? n.source : 'marquis';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(n);
        }
        for (const [key, items] of groups) {
            const unread = items.filter(n => !n.isRead).length;
            html += `<section class="mq-notif-group" aria-label="${esc(src(key).label)}">
                ${groupHead(src(key), unread ? `<span class="ms-auto">${unread} new</span>` : '')}
                ${items.map(n => `<div class="mq-notif-row${n.isRead ? '' : ' is-unread'}">
                    <span class="mq-notif-dot" aria-hidden="true"></span>
                    <span class="flex-grow-1 min-w-0">
                        <span class="mq-notif-title d-flex align-items-center gap-1">${LEVEL_ICON[n.level] || ''}<span class="text-truncate">${esc(n.title)}</span></span>
                        ${n.message ? `<span class="mq-notif-msg">${esc(n.message)}</span>` : ''}
                    </span>
                    <span class="mq-notif-time">${esc(ago(n.date))}</span>
                    <button type="button" class="mq-icon-btn mq-notif-del" data-id="${esc(n.id)}" title="Remove" aria-label="Remove notification"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
                </div>`).join('')}
            </section>`;
        }
        list.innerHTML = html;
        list.querySelectorAll('[data-overdue]').forEach(btn => btn.addEventListener('click', () => openSection(overdue[+btn.dataset.overdue].section)));
        list.querySelectorAll('.mq-notif-del').forEach(btn => btn.addEventListener('click', () => send({ action: 'notifyDismiss', id: btn.dataset.id })));
        empty.classList.toggle('d-none', !!html);
        $('notifMarkAllBtn').disabled = !entries.some(n => !n.isRead);
        $('notifClearBtn').disabled = !entries.length;
        renderBell(overdue.length);
    }

    // Bell: unread count on the badge; the icon shows Do Not Disturb and turns red while something needs you.
    function renderBell(overdueCount) {
        const unread = entries.filter(n => !n.isRead).length;
        if (badge) {
            badge.textContent = unread > 99 ? '99+' : String(unread);
            badge.classList.toggle('d-none', !unread);
        }
        if (bellIcon) {
            bellIcon.classList.toggle('bi-bell-fill', !prefs.dnd);
            bellIcon.classList.toggle('bi-bell-slash-fill', !!prefs.dnd);
            bellIcon.classList.toggle('text-danger', !!(unread || overdueCount));
            bellIcon.classList.toggle('text-secondary', !(unread || overdueCount));
        }
        if (bell) {
            const parts = [unread ? `${unread} new` : '', overdueCount ? `${overdueCount} overdue` : '', prefs.dnd ? 'Do not disturb on' : ''].filter(Boolean);
            bell.title = parts.length ? `Notifications (${parts.join(', ')})` : 'Notifications';
        }
        $('notifDndPill')?.classList.toggle('d-none', !prefs.dnd);
    }

    function openSection(sectionId) {
        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        const sel = $('menuSelector');
        if (sel && sel.value !== sectionId) { sel.value = sectionId; sel.dispatchEvent(new Event('change')); }
    }

    // ── Preferences ───────────────────────────────────────────
    function renderPrefs() {
        $('notifDndToggle').checked = !!prefs.dnd;
        $('notifDndReminders').checked = !!prefs.dndReminders;
        $('notifDndReminders').disabled = !prefs.dnd;
        const popups = prefs.popups || {};
        $('notifSourcePrefs').innerHTML = Object.entries(SOURCES).filter(([key]) => key !== 'marquis').map(([key, s]) => `
            <div class="form-check form-switch m-0 d-flex align-items-center gap-2 ps-0">
                ${toolIcon(s)}
                <label class="form-check-label flex-grow-1" for="notifPop_${esc(key)}">${esc(s.label)}</label>
                <input class="form-check-input m-0" type="checkbox" role="switch" id="notifPop_${esc(key)}" data-source="${esc(key)}" ${popups[key] === false ? '' : 'checked'}>
            </div>`).join('');
    }
    const savePrefs = (patch) => { prefs = { ...prefs, ...patch }; chrome.storage.local.set({ notifyPrefs: prefs }); };
    $('notifDndToggle').addEventListener('change', (e) => savePrefs({ dnd: e.target.checked }));
    $('notifDndReminders').addEventListener('change', (e) => savePrefs({ dndReminders: e.target.checked }));
    $('notifSourcePrefs').addEventListener('change', (e) => {
        const key = e.target.dataset.source;
        if (key) savePrefs({ popups: { ...(prefs.popups || {}), [key]: e.target.checked } });
    });

    // ── Actions ───────────────────────────────────────────────
    $('notifMarkAllBtn').addEventListener('click', () => send({ action: 'notifyEdit', op: 'readAll' }));
    $('notifClearBtn').addEventListener('click', () => send({ action: 'notifyEdit', op: 'clear' }));
    bell?.addEventListener('click', () => bootstrap.Modal.getOrCreateInstance(modalEl).show());
    // New entries stay marked while the panel is open; they count as read once it closes.
    modalEl.addEventListener('hidden.bs.modal', () => { if (entries.some(n => !n.isRead)) send({ action: 'notifyEdit', op: 'readAll' }); });

    // ── Data ──────────────────────────────────────────────────
    const BOARD_KEY = typeof KanbanStore !== 'undefined' ? KanbanStore.KEY : 'kanbanBoard';
    chrome.storage.local.get(['marquisNotifications', 'notifyPrefs', BOARD_KEY, 'marquisTasks'], (res) => {
        entries = res.marquisNotifications || [];
        prefs = res.notifyPrefs || {};
        board = res[BOARD_KEY] || null;
        tasks = res.marquisTasks || [];
        renderPrefs();
        render();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.marquisNotifications) entries = changes.marquisNotifications.newValue || [];
        if (changes.notifyPrefs) { prefs = changes.notifyPrefs.newValue || {}; renderPrefs(); }
        if (changes[BOARD_KEY]) board = changes[BOARD_KEY].newValue || null;
        if (changes.marquisTasks) tasks = changes.marquisTasks.newValue || [];
        if (changes.marquisNotifications || changes.notifyPrefs || changes[BOARD_KEY] || changes.marquisTasks) render();
    });
});
