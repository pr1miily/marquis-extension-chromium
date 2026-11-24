// Marquis notification sources, shared by background.js (importScripts) and the popup's Notifications panel.
// One entry per tool that can notify. Labels and icons match the tool registry (#menuSelector in Marquis.html),
// so the in-app list, device pop-ups and the rest of Marquis name each tool the same way.
//   reminder: true  the tool sends due-date reminders (they may get through Do Not Disturb when allowed)
//   open:           extension page a click on its device notification opens
const MarquisNotifySources = Object.freeze({
    kanban:    { label: 'Kanban Board', icon: 'trello', color: '#8b5cf6', reminder: true, open: 'kanban_fullscreen.html' },
    tasks:     { label: 'Notes & Tasks', icon: 'journal-text', color: '#eab308', reminder: true },
    focus:     { label: 'Focus Mode & Blocker', icon: 'stopwatch', color: '#4f46e5' },
    keepawake: { label: 'Keep Awake', icon: 'cup-hot-fill', color: '#f59e0b' },
    capture:   { label: 'Screen Capture & Recorder', icon: 'camera-reels-fill', color: '#ef4444' },
    workspace: { label: 'Workspace Manager', icon: 'collection-fill', color: '#94a3b8' },
    bulk:      { label: 'Bulk URL Opener', icon: 'rocket-takeoff-fill', color: '#06b6d4' },
    seo:       { label: 'SEO Spider & Audit', icon: 'search-heart', color: '#84cc16' },
    marquis:   { label: 'Marquis', icon: 'bell-fill', color: '#64748b' } // fallback for older or unknown entries
});
