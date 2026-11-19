document.addEventListener('DOMContentLoaded', () => {
    const notifContainer = document.getElementById('notifContainer');
    const notifBadge = document.getElementById('notifBadge');
    const globalNotifList = document.getElementById('globalNotifList');
    const notifEmptyState = document.getElementById('notifEmptyState');
    const notifModalEl = document.getElementById('notificationsModal');
    let notifModal = null;

    if (notifModalEl && typeof bootstrap !== 'undefined') {
        notifModal = new bootstrap.Modal(notifModalEl);
    }

    // 1. Update the Red Badge on the Bell
    function updateBadge(count) {
        if (!notifBadge) return;
        if (count > 0) {
            notifBadge.innerText = count > 99 ? '99+' : count;
            notifBadge.classList.remove('d-none');
            // Give it a little bounce animation when a new one arrives
            notifBadge.classList.add('animate__animated', 'animate__rubberBand');
            setTimeout(() => notifBadge.classList.remove('animate__animated', 'animate__rubberBand'), 1000);
        } else {
            notifBadge.classList.add('d-none');
        }
    }

    // 2. Render the Notification List in the Modal
    function renderNotifications(notifs) {
        if (!globalNotifList || !notifEmptyState) return;

        // Clear out existing items (keep the empty state div)
        const items = globalNotifList.querySelectorAll('.notif-item');
        items.forEach(item => item.remove());

        if (!notifs || notifs.length === 0) {
            notifEmptyState.classList.remove('d-none');
            return;
        }

        notifEmptyState.classList.add('d-none');

        notifs.forEach(notif => {
            // Format time nicely
            const date = new Date(notif.date);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            // Set dynamic icons and colors based on source
            let iconStr = '<i class="bi bi-info-circle-fill text-primary"></i>';
            let bgClass = 'bg-primary';

            if (notif.source === 'autoclicker') {
                iconStr = '<i class="bi bi-robot text-danger"></i>';
                bgClass = 'bg-danger';
            } else if (notif.source === 'kanban') {
                iconStr = '<i class="bi bi-trello text-primary"></i>';
                bgClass = 'bg-primary';
            } 
            // 🟢 NEW: Added Keep Awake Icon
            else if (notif.source === 'keepawake') {
                iconStr = '<i class="bi bi-cup-hot-fill text-warning"></i>';
                bgClass = 'bg-warning';
            }

            const html = `
                <div class="notif-item p-2 ${notif.isRead ? 'bg-body' : 'bg-body-tertiary border-start border-4 border-primary'} border border-secondary-subtle rounded-3 shadow-sm text-start position-relative">
                    <button class="btn btn-sm btn-link text-muted position-absolute top-0 end-0 mt-2 me-2 p-0 delete-notif-btn" data-id="${MarquisHtml.esc(notif.id)}"><i class="bi bi-x-lg"></i></button>
                    <div class="d-flex align-items-center mb-1 gap-2">
                        <div class="${bgClass} bg-opacity-10 rounded p-1 d-flex align-items-center justify-content-center" style="width:24px; height:24px;">
                            ${iconStr}
                        </div>
                        <span class="small fw-bold text-body">${MarquisHtml.esc(notif.title)}</span>
                        <span class="text-muted ms-auto" style="font-size:var(--mq-fs-xs);">${timeStr}</span>
                    </div>
                    <p class="small text-muted mb-0 lh-sm ms-4 ps-1">${MarquisHtml.esc(notif.message)}</p>
                </div>
            `;
            globalNotifList.insertAdjacentHTML('beforeend', html);
        });

        // Bind the "X" buttons to delete individual notifications
        globalNotifList.querySelectorAll('.delete-notif-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt(e.currentTarget.getAttribute('data-id'));
                deleteNotification(id);
            });
        });
    }

    function deleteNotification(id) {
        chrome.storage.local.get(['marquisNotifications'], (res) => {
            let notifs = res.marquisNotifications || [];
            notifs = notifs.filter(n => n.id !== id); // Remove the matched ID
            chrome.storage.local.set({ marquisNotifications: notifs }, () => {
                renderNotifications(notifs);
            });
        });
    }

    // 3. Load Initial Data when Extension Opens
    chrome.storage.local.get(['marquisNotifications', 'unreadNotifCount'], (res) => {
        updateBadge(res.unreadNotifCount || 0);
        renderNotifications(res.marquisNotifications || []);
    });

    // 4. Live Listener (If a background script adds a notification while you have the popup open)
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            if (changes.unreadNotifCount) {
                updateBadge(changes.unreadNotifCount.newValue);
            }
            if (changes.marquisNotifications) {
                renderNotifications(changes.marquisNotifications.newValue);
            }
        }
    });

    // 5. Open Modal & Mark All As Read
    notifContainer?.addEventListener('click', () => {
        chrome.storage.local.get(['marquisNotifications'], (res) => {
            let notifs = res.marquisNotifications || [];
            
            // Mark all existing notifications as read
            notifs = notifs.map(n => ({...n, isRead: true}));
            
            chrome.storage.local.set({ 
                marquisNotifications: notifs, 
                unreadNotifCount: 0 
            }, () => {
                // Clear the Chrome browser toolbar icon badge too!
                chrome.action.setBadgeText({ text: '' });
                if (notifModal) notifModal.show();
            });
        });
    });
});