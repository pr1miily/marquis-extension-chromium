function initKanban() {
    
    let automationRules = [];
    let currentEditCard = null; 
    let sortableInstances = [];
    
    let pendingKanbanAction = null;
    let pendingKanbanTarget = null;

    // For the few templates that still interpolate user text (list titles, label names, rule text).
    const esc = MarquisHtml.esc; // scripts/safe_html.js

    async function loadKanbanData() {
        const [board, res] = await Promise.all([
            KanbanStore.load(),
            chrome.storage.local.get(['kanbanRules', 'kanbanBoardBg'])
        ]);
        // Date badges are computed while rendering, so newly overdue cards show as overdue.
        renderBoard(board.columns);
        countAndSyncOverdueBadges();

        if (res.kanbanRules) {
            automationRules = res.kanbanRules;
            renderRulesList();
        }

        if (res.kanbanBoardBg && res.kanbanBoardBg !== 'transparent') {
            document.getElementById('kanbanBoardWrapper').style.backgroundColor = res.kanbanBoardBg;
        }
    }

    function renderBoard(columnsArray) {
        const board = document.getElementById('kanbanBoard');
        const addListWrapper = document.getElementById('addListWrapper');
        
        Array.from(board.children).forEach(child => {
            if(child.id !== 'addListWrapper') child.remove();
        });

        sortableInstances.forEach(inst => inst.destroy());
        sortableInstances = [];

        columnsArray.forEach(col => {
            addListWrapper.insertAdjacentHTML('beforebegin', createColumnHTML(col.id, col.title));
            addListWrapper.previousElementSibling.querySelector('.kanban-col').append(...col.cards.map(buildCard));
        });

        document.querySelectorAll('.kanban-col').forEach(col => {
            sortableInstances.push(new Sortable(col, {
                group: 'shared', 
                animation: 150,
                ghostClass: 'sortable-ghost',
                dragClass: 'sortable-drag',
                easing: "cubic-bezier(1, 0, 0, 1)",
                delay: 50, 
                delayOnTouchOnly: true,
                onEnd: function (evt) {
                    updateColumnCounts();
                    executeAutomations(evt.item, 'moved_to', evt.to.id);
                    saveBoardState();
                }
            }));
        });

        sortableInstances.push(new Sortable(board, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            easing: "cubic-bezier(1, 0, 0, 1)",
            draggable: '.column-wrapper', 
            filter: '#addListWrapper',    
            onEnd: function () {
                saveBoardState(); 
            }
        }));

        updateColumnCounts();
    }

    function createColumnHTML(rawId, rawTitle) {
        const id = esc(rawId), title = esc(rawTitle);
        return `
        <div class="kanban-list flex-shrink-0 p-2 column-wrapper me-2" style="width: 280px;" id="wrapper-${id}">
            <div class="d-flex justify-content-between align-items-center mb-2 px-1">
                <h6 class="fw-bold mb-0 text-body list-title d-flex align-items-center" style="font-size: var(--mq-fs-base);">
                    ${title} <span class="badge bg-secondary bg-opacity-25 text-body-secondary rounded-pill ms-2 fw-bold col-count" style="font-size: var(--mq-fs-xs);">0</span>
                </h6>
                <div class="dropdown">
                    <button class="btn btn-sm btn-link text-secondary p-0 shadow-none" type="button" data-bs-toggle="dropdown" aria-label="List options" title="List options"><i class="bi bi-three-dots" aria-hidden="true"></i></button>
                    <ul class="dropdown-menu shadow-sm">
                        <li><a class="dropdown-item rename-col-btn small fw-bold" href="#" data-id="${id}" data-title="${title}"><i class="bi bi-pencil me-2 text-muted"></i>Rename List</a></li>
                        <li><a class="dropdown-item clear-col-btn small fw-bold" href="#" data-col="${id}"><i class="bi bi-eraser me-2 text-muted"></i>Clear All Cards</a></li>
                        <li><hr class="dropdown-divider"></li>
                        <li><a class="dropdown-item text-danger delete-col-btn small fw-bold" href="#" data-id="${id}"><i class="bi bi-trash me-2"></i>Delete List</a></li>
                    </ul>
                </div>
            </div>
            <div class="d-flex flex-column kanban-col custom-scrollbar px-1" id="${id}" style="min-height: 10px; max-height: 60vh; overflow-y: auto; overflow-x: hidden;"></div>
            <button class="btn btn-sm text-start text-muted fw-bold btn-lift-hover add-kanban-card mt-1 p-2 rounded bg-transparent border-0 shadow-none w-100" data-col="${id}">
                <i class="bi bi-plus-lg me-1"></i> Add a card
            </button>
        </div>`;
    }

    // Card markup holds no data; buildCard fills it from the stored JSON through textContent and
    // DOM properties, and KanbanStore.readCard reads it back when the board is saved.
    const CARD_TEMPLATE = `
        <div class="trello-card p-2 mb-2 mt-2 group-hover" data-cover="none">
            <div class="trello-cover"></div>
            <button class="btn btn-sm edit-hover-btn rounded shadow-sm d-flex align-items-center justify-content-center" title="Edit Task" style="width: 26px; height: 26px; padding: 0;">
                <i class="bi bi-pencil-fill text-secondary" style="font-size: 0.75rem;"></i>
            </button>

            <div class="trello-labels d-none mb-1"></div>

            <div class="d-flex align-items-start mt-1 pe-4">
                <div class="form-check m-0 me-2 flex-shrink-0" title="Mark Complete">
                    <input class="form-check-input card-quick-complete rounded-circle border-secondary-subtle shadow-sm" type="checkbox" style="cursor: pointer; width: 1.1em; height: 1.1em; margin-top: 0.15em;">
                </div>
                <div class="fw-medium text-body card-title-text" style="font-size: 0.85rem; line-height: 1.4; word-break: break-word;"></div>
            </div>

            <div class="card-indicators d-flex gap-2 flex-wrap align-items-center mt-2 text-muted" style="font-size: var(--mq-fs-xs);">
                <span class="d-none card-desc-text"></span>
                <span class="d-none card-date-text"></span>
                <div class="d-none card-checklist-data"></div>

                <span class="indicator-date badge d-none"></span>
                <span class="indicator-desc d-none"><i class="bi bi-justify-left fs-6" title="This card has a description"></i></span>
                <span class="indicator-check badge bg-secondary bg-opacity-10 text-secondary border border-secondary-subtle d-none"><i class="bi bi-check2-square me-1"></i><span class="check-count">0/0</span></span>
            </div>
        </div>`;

    const CHECKLIST_ITEM_TEMPLATE = `
        <li class="list-group-item bg-transparent px-3 py-2 mb-1 d-flex align-items-center gap-2 border-0 group-hover rounded-3">
            <input class="form-check-input checklist-toggle m-0 shadow-sm border-secondary-subtle flex-shrink-0" type="checkbox" style="cursor: pointer; transform: scale(1.2);">
            <span class="flex-grow-1 text-body fw-medium lh-sm"></span>
            <button class="btn btn-sm btn-link text-danger p-1 checklist-del opacity-50 flex-shrink-0" style="line-height: 1; transition: opacity 0.2s;" onmouseover="this.classList.remove('opacity-50')" onmouseout="this.classList.add('opacity-50')"><i class="bi bi-x-lg fs-6"></i></button>
        </li>`;

    function fromTemplate(html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = html.trim();
        return tpl.content.firstElementChild;
    }

    function setChecked(box, textEl, checked) {
        box.checked = checked;
        box.toggleAttribute('checked', checked); // the attribute survives the innerHTML copy into the edit modal
        textEl.classList.toggle('text-decoration-line-through', checked);
        textEl.classList.toggle('text-muted', checked);
    }

    function checklistItem(text, done) {
        const li = fromTemplate(CHECKLIST_ITEM_TEMPLATE);
        li.querySelector('span').textContent = text;
        setChecked(li.querySelector('.checklist-toggle'), li.querySelector('span'), done);
        return li;
    }

    function labelEl({ text, cls, color }) {
        const el = document.createElement('div');
        el.className = 'trello-label';
        if (/^bg-[a-z-]+$/.test(cls || '')) el.classList.add(cls);
        else if (color) el.style.backgroundColor = color; // a CSSOM property: invalid values are dropped
        el.setAttribute('data-text', text || '');
        return el;
    }

    function renderLabels(container, labels) {
        container.replaceChildren(...labels.map(labelEl));
        container.classList.toggle('d-none', labels.length === 0);
    }

    // Description icon and checklist badge, derived from the card's own data.
    function syncIndicators(card) {
        card.querySelector('.indicator-desc').classList.toggle('d-none', !card.querySelector('.card-desc-text').textContent);
        const totalChecks = card.querySelectorAll('.card-checklist-data li').length;
        const doneChecks = card.querySelectorAll('.card-checklist-data .checklist-toggle:checked').length;
        const checkBadge = card.querySelector('.indicator-check');
        if (totalChecks > 0) {
            checkBadge.classList.remove('d-none');
            checkBadge.querySelector('.check-count').innerText = `${doneChecks}/${totalChecks}`;
            if (doneChecks === totalChecks) checkBadge.className = 'indicator-check badge bg-success text-white border border-success';
            else checkBadge.className = 'indicator-check badge bg-secondary bg-opacity-10 text-secondary border';
        } else {
            checkBadge.classList.add('d-none');
        }
    }

    function buildCard(card) {
        const el = fromTemplate(CARD_TEMPLATE);
        el.setAttribute('data-card-id', card.id);
        el.setAttribute('data-cover', card.cover || 'none');
        if (card.cover && card.cover !== 'none') {
            el.querySelector('.trello-cover').style.backgroundColor = card.cover;
            el.classList.add('has-cover');
        }
        renderLabels(el.querySelector('.trello-labels'), card.labels);
        const titleEl = el.querySelector('.card-title-text');
        titleEl.textContent = card.title;
        setChecked(el.querySelector('.card-quick-complete'), titleEl, card.completed);
        el.querySelector('.card-desc-text').textContent = card.desc;
        el.querySelector('.card-date-text').textContent = card.date ? `${card.date}|${card.time}` : '';
        el.querySelector('.card-checklist-data').append(...card.checklist.map(i => checklistItem(i.text, i.done)));
        syncIndicators(el);
        updateCardDateBadge(el, card.date, card.time);
        return el;
    }

    function saveBoardState() {
        const columns = [...document.querySelectorAll('.column-wrapper')].map(wrapper => {
            const colContainer = wrapper.querySelector('.kanban-col');
            return {
                id: colContainer.id,
                title: wrapper.querySelector('.list-title').childNodes[0].nodeValue.trim(),
                cards: [...colContainer.querySelectorAll(':scope > .trello-card')].map(KanbanStore.readCard)
            };
        });
        KanbanStore.save(columns);

        // 🟢 SYNC BADGES ON EVERY SAVE
        countAndSyncOverdueBadges();
    }

    function updateColumnCounts() {
        document.querySelectorAll('.column-wrapper').forEach(wrapper => {
            const colContainer = wrapper.querySelector('.kanban-col');
            const countBadge = wrapper.querySelector('.col-count');
            if(colContainer && countBadge) countBadge.innerText = colContainer.children.length;
        });
    }

    // 🟢 Calculate Overdue Tasks and Inject into Generic Modal
    function countAndSyncOverdueBadges() {
        const notifList = document.getElementById('globalNotifList');
        const emptyState = document.getElementById('notifEmptyState');

        // 1. Remove ONLY Kanban notifications to prepare for a fresh render
        if (notifList) {
            notifList.querySelectorAll('.notif-item[data-source="kanban"]').forEach(el => el.remove());
        }

        let overdueCount = 0;
        
        document.querySelectorAll('.trello-card').forEach(card => {
            const isCompleted = card.querySelector('.card-quick-complete')?.checked;
            const dateBadge = card.querySelector('.indicator-date');
            const isOverdue = dateBadge && dateBadge.classList.contains('bg-danger') && !dateBadge.classList.contains('d-none');
            
            if (!isCompleted && isOverdue) {
                overdueCount++;
                const title = card.querySelector('.card-title-text').innerText;
                
                // 2. Inject modular notification items (Now entirely clickable with hover effects)
                if (notifList) {
                    const notifHtml = `
                        <div class="notif-item p-2 bg-danger bg-opacity-10 border border-danger border-opacity-25 rounded-3 shadow-sm text-start go-to-kanban-btn btn-lift-hover" 
                            data-source="kanban" 
                            data-bs-dismiss="modal" 
                            style="cursor: pointer; transition: all 0.2s ease;"
                            onmouseover="this.classList.replace('bg-opacity-10', 'bg-opacity-25'); this.querySelector('.bi-chevron-right').style.transform='translateX(4px)';"
                            onmouseout="this.classList.replace('bg-opacity-25', 'bg-opacity-10'); this.querySelector('.bi-chevron-right').style.transform='translateX(0)';">
                            
                            <div class="d-flex justify-content-between align-items-center mb-1">
                                <span class="badge bg-danger text-white shadow-sm"><i class="bi bi-kanban me-1"></i>Kanban Overdue</span>
                                <i class="bi bi-chevron-right text-danger fw-bold" style="transition: transform 0.2s ease;"></i>
                            </div>
                            <h6 class="fw-bold text-danger-emphasis mb-0 mt-2" style="font-size: var(--mq-fs-sm);">${esc(title)}</h6>
                            
                        </div>
                    `;
                    notifList.insertAdjacentHTML('beforeend', notifHtml);
                }
            }
        });

        // 3. Re-evaluate Total Notifications & Empty State
        let totalNotifs = 0;
        if (notifList) {
            totalNotifs = notifList.querySelectorAll('.notif-item').length;
            if (totalNotifs > 0) {
                emptyState?.classList.add('d-none');
            } else {
                emptyState?.classList.remove('d-none');
            }
        }

        // 4. Update Global Bell Icon Badge
        const notifBadge = document.getElementById('notifBadge');
        const notifIcon = document.getElementById('notifIcon');
        const notifContainer = document.getElementById('notifContainer');

        if (notifBadge && notifIcon) {
            if (totalNotifs > 0) {
                notifBadge.innerText = totalNotifs;
                notifBadge.classList.remove('d-none');
                notifIcon.classList.replace('text-secondary', 'text-danger');
                notifIcon.classList.add('animate__animated', 'animate__swing');
                if (notifContainer) notifContainer.title = `${totalNotifs} Notification(s)`;
            } else {
                notifBadge.classList.add('d-none');
                notifIcon.classList.replace('text-danger', 'text-secondary');
                notifIcon.classList.remove('animate__animated', 'animate__swing');
                if (notifContainer) notifContainer.title = `Notifications`;
            }
        }

        // 5. Update Chrome Extension Icon
        if (typeof chrome !== 'undefined' && chrome.action) {
            if (overdueCount > 0) {
                chrome.action.setBadgeText({ text: overdueCount.toString() });
                chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); 
            } else {
                chrome.action.setBadgeText({ text: '' }); 
            }
        }

        // 6. Attach dynamic listeners to the new "View" buttons
        document.querySelectorAll('.go-to-kanban-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const menuSel = document.getElementById("menuSelector");
                if (menuSel && menuSel.value !== "kanbanSection") {
                    menuSel.value = "kanbanSection";
                    menuSel.dispatchEvent(new Event('change'));
                }
            });
        });
    }

    // ==========================================
    // 🟢 NAVBAR BELL CLICK ROUTING
    // ==========================================
    document.getElementById('notifContainer')?.addEventListener('click', () => {
        const notifModalEl = document.getElementById('notificationsModal');
        if (notifModalEl) {
            bootstrap.Modal.getOrCreateInstance(notifModalEl).show();
        }
    });

    // ==========================================
    // 🟢 DATE, TIME, & ALARM LOGIC
    // ==========================================

    async function setKanbanAlarm(cardId, title, dateStr, timeStr) {
        const alarmName = `kanban_due_${cardId}`;
        chrome.alarms.clear(alarmName);

        if (!dateStr) return;

        let time = timeStr || '12:00';
        const dueDateTime = new Date(`${dateStr}T${time}:00`);
        
        if (dueDateTime > new Date()) {
            chrome.alarms.create(alarmName, { when: dueDateTime.getTime() });
            const data = await chrome.storage.local.get('kanbanAlarms');
            const alarms = data.kanbanAlarms || {};
            alarms[alarmName] = title;
            chrome.storage.local.set({ kanbanAlarms: alarms });
        }
    }

    // Badge look per KanbanStore.due() status: [classes, icon].
    const DUE_LOOK = {
        scheduled: ['bg-secondary bg-opacity-10 text-secondary border-secondary-subtle', 'bi-clock'],
        // If it's done, make it a satisfying green/muted badge
        done: ['bg-success bg-opacity-25 text-success border-success border-opacity-50', 'bi-check2-all'],
        overdue: ['bg-danger text-white border-danger', 'bi-exclamation-circle-fill'],
        // ✅ FIX: text-warning-emphasis adapts to all themes; text-dark is invisible on dark
        soon: ['bg-warning bg-opacity-25 text-warning-emphasis border-warning', 'bi-clock-history']
    };

    function updateCardDateBadge(cardElement, dateStr, timeStr) {
        const dateBadge = cardElement.querySelector('.indicator-date');
        const completed = !!cardElement.querySelector('.card-quick-complete')?.checked;
        const due = KanbanStore.due({ date: dateStr, time: timeStr, completed });
        if (!due) {
            dateBadge.classList.add('d-none');
            return;
        }
        const [statusClass, icon] = DUE_LOOK[due.status];
        dateBadge.innerHTML = `<i class="bi ${icon} me-1"></i>`;
        dateBadge.append(due.text);
        dateBadge.className = `indicator-date badge border shadow-sm ${statusClass}`;
    }

    // ==========================================
    // UI ACTIONS & EVENT LISTENERS
    // ==========================================

    function showKanbanConfirm(title, message, action, target) {
        document.getElementById('kgcTitle').innerText = title;
        document.getElementById('kgcMessage').innerText = message;
        pendingKanbanAction = action;
        pendingKanbanTarget = target;
        bootstrap.Modal.getOrCreateInstance(document.getElementById('kanbanGenericConfirmModal')).show();
    }

    document.getElementById('kgcConfirmBtn')?.addEventListener('click', () => {
        if (pendingKanbanAction === 'delete_card') {
            if (currentEditCard) {
                const cardId = currentEditCard.getAttribute('data-card-id');
                chrome.alarms.clear(`kanban_due_${cardId}`); // Remove alarm on delete
                currentEditCard.remove();
                updateColumnCounts();
                saveBoardState();
                currentEditCard = null;
            }
        } else if (pendingKanbanAction === 'clear_list') {
            document.getElementById(pendingKanbanTarget).innerHTML = '';
            updateColumnCounts();
            saveBoardState();
        } else if (pendingKanbanAction === 'delete_list') {
            document.getElementById('wrapper-' + pendingKanbanTarget).remove();
            saveBoardState();
        }
        
        bootstrap.Modal.getOrCreateInstance(document.getElementById('kanbanGenericConfirmModal')).hide();
    });

    document.getElementById('btnShowAddList')?.addEventListener('click', () => {
        document.getElementById('btnShowAddList').classList.add('d-none');
        document.getElementById('addListForm').classList.remove('d-none');
        document.getElementById('newListTitleInput').focus();
    });

    document.getElementById('btnCancelAddList')?.addEventListener('click', () => {
        document.getElementById('btnShowAddList').classList.remove('d-none');
        document.getElementById('addListForm').classList.add('d-none');
        document.getElementById('newListTitleInput').value = '';
    });

    document.getElementById('newListTitleInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('btnConfirmAddList').click();
    });

    document.getElementById('btnConfirmAddList')?.addEventListener('click', () => {
        const titleInput = document.getElementById('newListTitleInput');
        const title = titleInput.value.trim();
        if(!title) return;

        const newId = 'kb-' + Date.now();
        const colHtml = createColumnHTML(newId, title);
        document.getElementById('addListWrapper').insertAdjacentHTML('beforebegin', colHtml);
        
        const newCol = document.getElementById(newId);
        sortableInstances.push(new Sortable(newCol, {
            group: 'shared', 
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            delay: 50,
            onEnd: function (evt) { 
                updateColumnCounts(); 
                executeAutomations(evt.item, 'moved_to', evt.to.id);
                saveBoardState(); 
            }
        }));

        saveBoardState();
        document.getElementById('btnCancelAddList').click();
    });

    document.getElementById('kanbanBoard')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('card-quick-complete')) {
            e.stopPropagation(); 
            const card = e.target.closest('.trello-card');
            const titleEl = card.querySelector('.card-title-text');
            const cardId = card.getAttribute('data-card-id'); // Fetch ID
            
            if (e.target.checked) {
                e.target.setAttribute('checked', 'checked'); 
                titleEl.classList.add('text-decoration-line-through', 'text-muted');
                executeAutomations(card, 'marked_complete', null); 
                
                if (cardId) {
                    chrome.alarms.clear(`kanban_due_${cardId}`);
                    
                    // 🟢 NEW: Clear the specific task from the Notification Center
                    chrome.storage.local.get(['marquisNotifications', 'unreadNotifCount'], (res) => {
                        if (res.marquisNotifications) {
                            const cleanedNotifs = res.marquisNotifications.filter(n => !(n.source === 'kanban' && n.message.includes(titleEl.innerText)));
                            
                            // Adjust the unread badge count if we deleted an unread notification
                            const deletedUnreadCount = res.marquisNotifications.filter(n => !n.isRead && n.source === 'kanban' && n.message.includes(titleEl.innerText)).length;
                            const newUnreadCount = Math.max(0, (res.unreadNotifCount || 0) - deletedUnreadCount);

                            chrome.storage.local.set({ 
                                marquisNotifications: cleanedNotifs,
                                unreadNotifCount: newUnreadCount
                            });
                        }
                    });
                }
                
                // 🟢 Force the date badge to turn green instantly
                const dateData = card.querySelector('.card-date-text').innerText.split('|');
                updateCardDateBadge(card, dateData[0], dateData[1]);

            } else {
                e.target.removeAttribute('checked'); 
                titleEl.classList.remove('text-decoration-line-through', 'text-muted');
                
                // 🟢 Force the date badge to recalculate (it might turn red again)
                const dateData = card.querySelector('.card-date-text').innerText.split('|');
                updateCardDateBadge(card, dateData[0], dateData[1]);
                
                // Re-enable the alarm if we unchecked it
                if (cardId) setKanbanAlarm(cardId, titleEl.innerText, dateData[0], dateData[1]);
            }
            updateColumnCounts();
            saveBoardState(); // This will now recalculate the badges automatically!
            return;
        }

        if(e.target.closest('.add-kanban-card')) {
            window.addKanbanCard(e.target.closest('.add-kanban-card').getAttribute('data-col'));
        }
    });

    // List menu actions. The menus open as floating panels outside #kanbanBoard (MarquisFloat), so listen on document.
    document.addEventListener('click', (e) => {
        if(e.target.closest('.clear-col-btn')) {
            e.preventDefault();
            const colId = e.target.closest('.clear-col-btn').getAttribute('data-col');
            showKanbanConfirm('Clear this list?', 'All cards in this list will be deleted.', 'clear_list', colId);
        }

        if(e.target.closest('.delete-col-btn')) {
            e.preventDefault();
            const colId = e.target.closest('.delete-col-btn').getAttribute('data-id');
            showKanbanConfirm('Delete entire list?', 'This list and all its cards will be permanently removed.', 'delete_list', colId);
        }

        if(e.target.closest('.rename-col-btn')) {
            e.preventDefault();
            const btn = e.target.closest('.rename-col-btn');
            const colId = btn.getAttribute('data-id');
            const currentTitle = btn.getAttribute('data-title');
            
            document.getElementById('renameListId').value = colId;
            document.getElementById('renameListTitleInput').value = currentTitle;
            
            bootstrap.Modal.getOrCreateInstance(document.getElementById('kanbanRenameListModal')).show();
            setTimeout(() => document.getElementById('renameListTitleInput').focus(), 400);
        }
    });

    document.getElementById('renameListTitleInput')?.addEventListener('keypress', (e) => {
        if(e.key === 'Enter') document.getElementById('btnSaveRenameList').click();
    });

    document.getElementById('btnSaveRenameList')?.addEventListener('click', () => {
        const newTitle = document.getElementById('renameListTitleInput').value.trim();
        const colId = document.getElementById('renameListId').value;
        if(!newTitle) return;

        const wrapper = document.getElementById('wrapper-' + colId);
        const titleEl = wrapper.querySelector('.list-title');
        titleEl.childNodes[0].nodeValue = newTitle + ' ';
        wrapper.querySelector('.rename-col-btn').setAttribute('data-title', newTitle);

        saveBoardState();
        bootstrap.Modal.getOrCreateInstance(document.getElementById('kanbanRenameListModal')).hide();
    });

    document.querySelectorAll('.kb-bg-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const color = e.target.getAttribute('data-bg');
            document.getElementById('kanbanBoardWrapper').style.backgroundColor = color === 'transparent' ? '' : color;
            chrome.storage.local.set({ kanbanBoardBg: color });
        });
    });

    // 🟢 ENHANCED Search
    document.getElementById('kanbanSearchInput')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        const allCards = document.querySelectorAll('.trello-card');

        if (!term) {
            allCards.forEach(card => {
                card.classList.remove('search-match', 'search-mismatch');
                card.style.display = 'block'; 
            });
            return;
        }

        allCards.forEach(card => {
            const title = card.querySelector('.card-title-text').innerText.toLowerCase();
            const desc = card.querySelector('.card-desc-text').innerText.toLowerCase();
            
            if (title.includes(term) || desc.includes(term)) {
                card.classList.remove('search-match'); 
                void card.offsetWidth; 
                card.classList.add('search-match');
                card.classList.remove('search-mismatch');
                card.style.display = 'block'; 
            } else {
                card.classList.add('search-mismatch');
                card.classList.remove('search-match');
                card.style.display = 'block'; 
            }
        });
    });

    document.querySelectorAll('.modal').forEach(modalEl => {
        modalEl.addEventListener('show.bs.modal', () => {
            const searchInput = document.getElementById('kanbanSearchInput');
            if (searchInput && searchInput.value) {
                searchInput.value = '';
                searchInput.dispatchEvent(new Event('input'));
            }
        });
    });

    window.addKanbanCard = function(columnId) {
        document.getElementById('kanbanTargetCol').value = columnId;
        document.getElementById('kanbanNewCardTitle').value = '';
        document.getElementById('kanbanNewCardTitle').classList.remove('is-invalid');
        
        bootstrap.Modal.getOrCreateInstance(document.getElementById('kanbanAddCardModal')).show();
        setTimeout(() => { document.getElementById('kanbanNewCardTitle').focus(); }, 400);
    };

    document.getElementById('kanbanNewCardTitle')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('btnSaveKanbanCard').click();
        }
    });

    // 🟢 CREATE NEW CARD
    document.getElementById('btnSaveKanbanCard')?.addEventListener('click', () => {
        const title = document.getElementById('kanbanNewCardTitle').value.trim();
        const columnId = document.getElementById('kanbanTargetCol').value;
        const dateVal = document.getElementById('kanbanNewCardDate')?.value || '';
        const timeVal = document.getElementById('kanbanNewCardTime')?.value || '';

        if (!title) {
            document.getElementById('kanbanNewCardTitle').classList.add('is-invalid');
            return;
        }

        const card = KanbanStore.newCard({ title, date: dateVal, time: dateVal ? timeVal : '' });
        document.getElementById(columnId).append(buildCard(card));
        setKanbanAlarm(card.id, title, dateVal, timeVal);

        updateColumnCounts();
        saveBoardState(); 
        bootstrap.Modal.getOrCreateInstance(document.getElementById('kanbanAddCardModal')).hide();
    });

    let selectedCustomColor = '#9333ea';

    document.querySelectorAll('.custom-color-pick').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            document.querySelectorAll('.custom-color-pick').forEach(b => {
                b.style.borderWidth = '1px';
                b.style.borderColor = 'var(--bs-border-color)';
            });
            e.currentTarget.style.borderWidth = '2px';
            e.currentTarget.style.borderColor = '#fff';
            selectedCustomColor = e.currentTarget.getAttribute('data-color');
        });
    });

    document.getElementById('btnAddCustomLabel')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const labelText = document.getElementById('customLabelInput').value.trim();
        if(!labelText) return;

        const customClass = 'custom-lbl-' + Date.now();
        const style = document.createElement('style');
        style.innerHTML = `.${customClass} { background-color: ${selectedCustomColor} !important; }`;
        document.head.appendChild(style);

        const newHtml = `
            <div class="form-check d-flex align-items-center p-0 m-0">
                <input class="form-check-input me-2 ms-0 kb-label-check border-secondary-subtle" type="checkbox" value="${customClass}" data-text="${esc(labelText)}" id="${customClass}" checked>
                <label class="form-check-label w-100 rounded px-2 py-1 text-white fw-bold small shadow-sm" for="${customClass}" style="background-color: ${selectedCustomColor};">${esc(labelText)}</label>
            </div>
        `;
        
        document.getElementById('kanbanLabelSelector').insertAdjacentHTML('beforeend', newHtml);
        document.getElementById(customClass).addEventListener('change', updateEditModalLabelsUI);
        
        document.getElementById('customLabelInput').value = '';
        updateEditModalLabelsUI();
    });

    document.getElementById('kanbanBoard')?.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.edit-hover-btn');
        const cardBody = e.target.closest('.trello-card');
        
        if ((editBtn || cardBody) && !e.target.classList.contains('card-quick-complete')) {
            currentEditCard = cardBody;
            
            const title = currentEditCard.querySelector('.card-title-text').innerText;
            const desc = currentEditCard.querySelector('.card-desc-text').innerText;
            
            // 🟢 Extract Date and Time for Modal
            const dateData = currentEditCard.querySelector('.card-date-text').innerText.split('|');
            document.getElementById('editKanbanCardDate').value = dateData[0] || '';
            document.getElementById('editKanbanCardTime').value = dateData[1] || '';

            const checklistData = currentEditCard.querySelector('.card-checklist-data').innerHTML;
            const currentCover = currentEditCard.getAttribute('data-cover') || 'none';
            
            const listTitle = currentEditCard.closest('.column-wrapper').querySelector('.list-title').childNodes[0].nodeValue.trim();
            document.getElementById('editKanbanListInfo').innerText = listTitle;

            document.getElementById('editKanbanCardTitle').value = title;
            document.getElementById('editKanbanCardDesc').value = desc;
            document.getElementById('kanbanChecklistInput').value = '';

            const headerCover = document.getElementById('editModalCover');
            const closeBtn = document.getElementById('editModalCloseBtn');
            if(currentCover !== 'none') {
                headerCover.style.backgroundColor = currentCover;
                headerCover.classList.remove('d-none');
                closeBtn.classList.add('btn-close-white');
            } else {
                headerCover.classList.add('d-none');
                closeBtn.classList.remove('btn-close-white');
            }

            document.getElementById('editKanbanChecklistArea').innerHTML = checklistData;
            updateChecklistProgress();

            document.querySelectorAll('.kb-label-check').forEach(chk => chk.checked = false);
            const labelStrip = currentEditCard.querySelector('.trello-labels');
            labelStrip.querySelectorAll('.trello-label').forEach(lbl => {
                const colorClass = Array.from(lbl.classList).find(c => c.startsWith('bg-'));
                if(colorClass) {
                    const chk = document.querySelector(`.kb-label-check[value="${colorClass}"]`);
                    if(chk) chk.checked = true;
                }
            });
            updateEditModalLabelsUI();

            bootstrap.Modal.getOrCreateInstance(document.getElementById('kanbanEditCardModal')).show();
        }
    });

    document.querySelectorAll('.kb-label-check').forEach(chk => {
        chk.addEventListener('change', updateEditModalLabelsUI);
    });

    function updateEditModalLabelsUI() {
        const wrapper = document.getElementById('editModalLabelsWrapper');
        const display = document.getElementById('editModalLabelsDisplay');
        display.innerHTML = '';
        
        let hasChecked = false;
        document.querySelectorAll('.kb-label-check:checked').forEach(chk => {
            hasChecked = true;
            display.innerHTML += `<div class="badge ${esc(chk.value)} py-1 px-2 rounded-1 text-white shadow-sm">${esc(chk.nextElementSibling.innerText)}</div>`;
        });

        if (hasChecked) wrapper.classList.remove('d-none');
        else wrapper.classList.add('d-none');
    }

    document.querySelectorAll('.kb-cover-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const color = e.currentTarget.getAttribute('data-color');
            currentEditCard.setAttribute('data-cover', color);
            
            const headerCover = document.getElementById('editModalCover');
            const closeBtn = document.getElementById('editModalCloseBtn');
            if(color !== 'none') {
                headerCover.style.backgroundColor = color;
                headerCover.classList.remove('d-none');
                closeBtn.classList.add('btn-close-white');
            } else {
                headerCover.classList.add('d-none');
                closeBtn.classList.remove('btn-close-white');
            }
        });
    });

    document.getElementById('kanbanAddChecklistBtn')?.addEventListener('click', () => {
        const input = document.getElementById('kanbanChecklistInput');
        const text = input.value.trim();
        if (text) {
            document.getElementById('editKanbanChecklistArea').append(checklistItem(text, false));
            input.value = '';
            updateChecklistProgress();
        }
    });

    document.getElementById('kanbanChecklistInput')?.addEventListener('keypress', (e) => {
        if(e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('kanbanAddChecklistBtn').click();
        }
    })

    document.getElementById('editKanbanChecklistArea')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('checklist-toggle')) {
            const textSpan = e.target.nextElementSibling;
            if (e.target.checked) {
                e.target.setAttribute('checked', 'checked'); 
                textSpan.classList.add('text-decoration-line-through', 'text-muted');
            } else {
                e.target.removeAttribute('checked');
                textSpan.classList.remove('text-decoration-line-through', 'text-muted');
            }
            updateChecklistProgress();
        } else if (e.target.closest('.checklist-del')) {
            e.target.closest('li').remove();
            updateChecklistProgress();
        }
    });

    function updateChecklistProgress() {
        const area = document.getElementById('editKanbanChecklistArea');
        const total = area.querySelectorAll('li').length;
        const done = area.querySelectorAll('.checklist-toggle:checked').length;
        
        const pct = total === 0 ? 0 : Math.round((done / total) * 100);
        document.getElementById('editKanbanChecklistProgress').innerText = `${pct}%`;
        
        const bar = document.getElementById('editKanbanProgressBar');
        bar.style.width = `${pct}%`;
        
        if (pct === 100 && total > 0) bar.classList.replace('bg-primary', 'bg-success');
        else bar.classList.replace('bg-success', 'bg-primary');
    }

    // 🟢 UPDATE SAVED CARD
    document.getElementById('btnUpdateKanbanCard')?.addEventListener('click', () => {
        if (!currentEditCard) return;

        const newTitle = document.getElementById('editKanbanCardTitle').value.trim();
        const newDesc = document.getElementById('editKanbanCardDesc').value.trim();
        
        const newDate = document.getElementById('editKanbanCardDate').value;
        const newTime = document.getElementById('editKanbanCardTime').value;
        
        const checklistHtml = document.getElementById('editKanbanChecklistArea').innerHTML;
        const coverColor = currentEditCard.getAttribute('data-cover');

        if (!newTitle) return;

        currentEditCard.querySelector('.card-title-text').innerText = newTitle;
        // textContent keeps line breaks as text; innerText would turn them into <br> elements.
        currentEditCard.querySelector('.card-desc-text').textContent = newDesc;
        
        // Save the new date/time format
        const dateStorageString = newDate ? `${newDate}|${newTime}` : '';
        currentEditCard.querySelector('.card-date-text').innerText = dateStorageString;
        
        currentEditCard.querySelector('.card-checklist-data').innerHTML = checklistHtml;

        const coverDiv = currentEditCard.querySelector('.trello-cover');
        if(coverColor && coverColor !== 'none') {
            coverDiv.style.backgroundColor = coverColor;
            currentEditCard.classList.add('has-cover');
        } else {
            coverDiv.style.backgroundColor = '';
            currentEditCard.classList.remove('has-cover');
        }

        const labels = [...document.querySelectorAll('.kb-label-check:checked')].map(chk => {
            const text = chk.getAttribute('data-text');
            return chk.value.startsWith('custom-lbl-')
                ? { text, color: chk.nextElementSibling.style.backgroundColor }
                : { text, cls: chk.value };
        });
        renderLabels(currentEditCard.querySelector('.trello-labels'), labels);

        // 🟢 Calculate new Status and Update Notification Alarm
        const cardId = currentEditCard.getAttribute('data-card-id');
        updateCardDateBadge(currentEditCard, newDate, newTime);
        
        // ONLY set an alarm if the card is not completed!
        const isCompleted = currentEditCard.querySelector('.card-quick-complete')?.checked;
        if (!isCompleted) {
            setKanbanAlarm(cardId, newTitle, newDate, newTime);
        } else {
            chrome.alarms.clear(`kanban_due_${cardId}`);
        }

        syncIndicators(currentEditCard);

        saveBoardState();
        bootstrap.Modal.getOrCreateInstance(document.getElementById('kanbanEditCardModal')).hide();
    });

    document.getElementById('btnDeleteKanbanCard')?.addEventListener('click', () => {
        if (!currentEditCard) return;
        bootstrap.Modal.getOrCreateInstance(document.getElementById('kanbanEditCardModal')).hide();
        showKanbanConfirm('Delete this card?', 'This card will be permanently removed from the board.', 'delete_card', null);
    });

    document.getElementById('kanbanBoard')?.addEventListener('click', (e) => {
        if(e.target.classList.contains('trello-label') || e.target.classList.contains('trello-labels')) {
            e.stopPropagation(); 
            const board = document.getElementById('kanbanBoard');
            board.classList.toggle('labels-expanded');
            
            document.querySelectorAll('.trello-label').forEach(lbl => {
                lbl.classList.toggle('expanded');
                if(lbl.classList.contains('expanded')) {
                    const colorMap = {
                        'bg-danger': 'Urgent / Bug',
                        'bg-warning': 'Review',
                        'bg-success': 'Approved',
                        'bg-info': 'Design',
                        'bg-primary': 'Dev / Backend'
                    };
                    const colorClass = Array.from(lbl.classList).find(c => c.startsWith('bg-'));
                    if(colorClass && colorMap[colorClass]) lbl.innerText = colorMap[colorClass];
                } else {
                    lbl.innerText = '';
                }
            });
        }
    });

    // ==========================================
    // AUTOMATION ENGINE
    // ==========================================

    document.getElementById('ruleTrigger')?.addEventListener('change', (e) => {
        const triggerCol = document.getElementById('ruleTriggerCol');
        if (e.target.value === 'moved_to') {
            triggerCol.classList.remove('d-none');
        } else {
            triggerCol.classList.add('d-none'); 
        }
    });

    document.getElementById('ruleAction')?.addEventListener('change', (e) => {
        const actionLabel = document.getElementById('ruleActionLabel');
        const actionCol = document.getElementById('ruleActionCol');

        if (e.target.value === 'add_label') {
            actionLabel.classList.remove('d-none');
            actionCol.classList.add('d-none');
        } else if (e.target.value === 'move_to') {
            actionLabel.classList.add('d-none');
            actionCol.classList.remove('d-none');
        } else {
            actionLabel.classList.add('d-none');
            actionCol.classList.add('d-none');
        }
    });

    document.getElementById('kanbanAutomationModal')?.addEventListener('show.bs.modal', () => {
        const tCol = document.getElementById('ruleTriggerCol');
        const aCol = document.getElementById('ruleActionCol');
        tCol.innerHTML = '';
        aCol.innerHTML = '';

        document.querySelectorAll('.column-wrapper').forEach(wrapper => {
            const id = wrapper.querySelector('.kanban-col').id;
            const title = wrapper.querySelector('.list-title').childNodes[0].nodeValue.trim();
            const opt = `<option value="${esc(id)}">${esc(title)}</option>`;
            tCol.innerHTML += opt;
            aCol.innerHTML += opt;
        });
    });

    document.getElementById('btnAddAutomationRule')?.addEventListener('click', () => {
        const trigger = document.getElementById('ruleTrigger').value;
        const triggerVal = document.getElementById('ruleTriggerCol').value;
        const action = document.getElementById('ruleAction').value;
        const actionLabel = document.getElementById('ruleActionLabel').value.trim();
        const actionCol = document.getElementById('ruleActionCol').value;

        if (action === 'add_label' && !actionLabel) {
            document.getElementById('ruleActionLabel').classList.add('is-invalid');
            return;
        }
        document.getElementById('ruleActionLabel').classList.remove('is-invalid');

        let actionVal = null;
        if (action === 'add_label') actionVal = actionLabel;
        if (action === 'move_to') actionVal = actionCol;

        const newRule = { id: Date.now(), trigger, triggerVal, action, actionVal };
        automationRules.push(newRule);
        chrome.storage.local.set({ kanbanRules: automationRules });

        renderRulesList();
        document.getElementById('ruleActionLabel').value = '';
    });

    function renderRulesList() {
        const ruleList = document.getElementById('automationRulesList');
        if (!ruleList) return;
        ruleList.innerHTML = '';

        if (automationRules.length === 0) {
            ruleList.innerHTML = '<div class="text-muted small fst-italic p-2">No active rules.</div>';
            return;
        }

        automationRules.forEach(rule => {
            let triggerText = '';
            if (rule.trigger === 'moved_to') {
                const list = document.getElementById(rule.triggerVal);
                const colName = list ? list.closest('.column-wrapper').querySelector('.list-title').childNodes[0].nodeValue.trim() : 'Unknown List';
                triggerText = `card moves to <span class="badge bg-secondary">${esc(colName)}</span>`;
            } else if (rule.trigger === 'marked_complete') {
                triggerText = `card is marked <span class="badge bg-secondary"><i class="bi bi-check-circle-fill me-1"></i>Complete</span>`;
            }

            let actionText = '';
            if (rule.action === 'add_label') {
                actionText = `add label <span class="badge bg-dark border">${esc(rule.actionVal)}</span>`;
            } else if (rule.action === 'move_to') {
                const list = document.getElementById(rule.actionVal);
                const colName = list ? list.closest('.column-wrapper').querySelector('.list-title').childNodes[0].nodeValue.trim() : 'Unknown List';
                actionText = `move to list <span class="badge bg-primary">${esc(colName)}</span>`;
            } else if (rule.action === 'mark_complete') {
                actionText = `mark as <span class="badge bg-success bg-opacity-25 text-success border border-success">Complete</span>`;
            }

            const ruleHtml = `
                <div class="d-flex justify-content-between align-items-center p-2 bg-body-tertiary border border-secondary-subtle rounded-3 shadow-sm mb-2">
                    <div class="d-flex align-items-center gap-2">
                        <i class="bi bi-lightning-charge-fill text-warning"></i>
                        <span class="fw-bold small text-body ms-2">
                            <span class="text-primary">WHEN</span> ${triggerText}
                            <span class="text-success ms-2">THEN</span> ${actionText}
                        </span>
                    </div>
                    <button class="btn btn-sm btn-link text-danger p-0 delete-rule-btn" data-id="${rule.id}"><i class="bi bi-trash3"></i></button>
                </div>
            `;
            ruleList.insertAdjacentHTML('beforeend', ruleHtml);
        });
    }

    document.getElementById('automationRulesList')?.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.delete-rule-btn');
        if (deleteBtn) {
            const ruleId = parseInt(deleteBtn.getAttribute('data-id'));
            automationRules = automationRules.filter(r => r.id !== ruleId);
            chrome.storage.local.set({ kanbanRules: automationRules });
            renderRulesList();
        }
    });

    document.getElementById('closeFullscreenBtn')?.addEventListener('click', () => {
        window.close();
    });

    function executeAutomations(cardElement, eventType, eventValue) {
        automationRules.forEach(rule => {
            let isTriggered = false;

            if (rule.trigger === 'moved_to' && eventType === 'moved_to' && rule.triggerVal === eventValue) {
                isTriggered = true;
            } else if (rule.trigger === 'marked_complete' && eventType === 'marked_complete') {
                isTriggered = true;
            }

            if (isTriggered) {
                if (rule.action === 'add_label') {
                    const labelContainer = cardElement.querySelector('.trello-labels');
                    const targetText = rule.actionVal;
                    const alreadyHasLabel = Array.from(labelContainer.querySelectorAll('.trello-label')).some(lbl => lbl.getAttribute('data-text') === targetText);
                    if (!alreadyHasLabel) {
                        labelContainer.append(labelEl({ text: targetText, cls: 'bg-dark' }));
                        labelContainer.classList.remove('d-none');
                    }
                } 
                else if (rule.action === 'move_to') {
                    const targetCol = document.getElementById(rule.actionVal);
                    if (targetCol && cardElement.parentElement.id !== rule.actionVal) {
                        targetCol.appendChild(cardElement);
                        setTimeout(() => executeAutomations(cardElement, 'moved_to', rule.actionVal), 50); 
                    }
                } 
                else if (rule.action === 'mark_complete') {
                    const checkbox = cardElement.querySelector('.card-quick-complete');
                    const titleEl = cardElement.querySelector('.card-title-text');
                    if (checkbox && !checkbox.checked) {
                        checkbox.checked = true;
                        checkbox.setAttribute('checked', 'checked');
                        titleEl.classList.add('text-decoration-line-through', 'text-muted');
                    }
                }
            }
        });
    }

    loadKanbanData();
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'kanbanSection') initKanban();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('kanbanBoardWrapper')) initKanban();
});