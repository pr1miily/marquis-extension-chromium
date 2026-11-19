function initStickyNotes() {

    // Notes and task descriptions are rich text, also written by the dock editor on any website:
    // they are rendered through the sanitizer, and plain values are escaped (scripts/safe_html.js).
    const { esc, sanitize } = MarquisHtml;
    const plainText = (html) => new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent;
    // Images are stored as data URLs from FileReader; anything else is not shown.
    const safeImage = (src) => /^data:image\/[a-z+.-]+;base64,/i.test(src || '') ? src : '';

    // Text-colour swatches shared by the note and task toolbars.
    const swatchHtml = (cls) => ['#000000', '#475569', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'].map(c =>
        `<div class="${cls} shadow-sm" data-color="${c}" style="background: ${c}; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid rgba(0,0,0,0.1);"></div>`
    ).join('');

    // Link panel: the URL field takes focus, so the editor's selection is saved when the panel opens
    // and restored before the link goes in. With nothing selected, the URL itself becomes the link text.
    function wireLinkPanel(btn, panel, editorEl) {
        if (!btn || !panel || !editorEl) return;
        const input = panel.querySelector('input');
        let range = null;
        const close = () => panel.classList.replace('d-flex', 'd-none');
        btn.addEventListener('click', () => {
            if (panel.classList.contains('d-flex')) return close();
            const sel = getSelection();
            range = sel.rangeCount && editorEl.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
            panel.classList.replace('d-none', 'd-flex');
            input.value = '';
            input.focus();
        });
        const apply = () => {
            let url = input.value.trim();
            close();
            if (!url) return;
            if (!/^(https?:\/\/|mailto:)/i.test(url)) url = 'https://' + url;
            editorEl.focus();
            const sel = getSelection();
            if (range) { sel.removeAllRanges(); sel.addRange(range); }
            if (sel.isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(url)}</a>`);
            else document.execCommand('createLink', false, url);
        };
        panel.querySelector('button').addEventListener('click', apply);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); apply(); }
            else if (e.key === 'Escape') { e.stopPropagation(); close(); } // stop: Escape would also close the task modal
        });
    }

    // ==========================================
    // 🟡 1. STICKY NOTES ENGINE
    // ==========================================
    const editor = document.getElementById('newStickyNote');
    const imageInput = document.getElementById('stickyNoteImage');
    const imagePreviewContainer = document.getElementById('imagePreviewContainer');
    const imagePreview = document.getElementById('imagePreview');
    const removeImageBtn = document.getElementById('removeImageBtn');
    const addNoteBtn = document.getElementById('addStickyNoteBtn');
    
    const sizePicker = document.getElementById('sn-size-picker');
    const attachBtn = document.getElementById('sn-attach-btn');
    const colorBtn = document.getElementById('sn-color-btn');
    const colorPalette = document.getElementById('sn-color-palette');
    const emojiBtn = document.getElementById('sn-emoji-btn');
    const emojiPicker = document.getElementById('sn-emoji-picker');

    const wrapper = document.getElementById('stickyNotesWrapper');
    const notePageInfo = document.getElementById('notePageInfo');
    const prevBtn = document.getElementById('prevStickyBtn');
    const nextBtn = document.getElementById('nextStickyBtn');
    const downloadBtn = document.getElementById('downloadAllStickyNoteBtn');
    const deleteBtn = document.getElementById('deleteStickyNoteBtn');

    let currentImageBase64 = null;
    let notes = [];
    let currentPage = 1;
    const notesPerPage = 12;

    document.getElementById('sticky-toolbar')?.addEventListener('mousedown', (e) => { 
        if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') e.preventDefault();
    });
    if (colorPalette) colorPalette.addEventListener('mousedown', (e) => e.preventDefault());
    if (emojiPicker) emojiPicker.addEventListener('mousedown', (e) => e.preventDefault());
    
    const snCmdBtns = document.querySelectorAll('.sn-cmd');
    
    function updateSnToolbarState() {
        if (!editor) return;
        snCmdBtns.forEach(btn => {
            const cmd = btn.getAttribute('data-cmd');
            if (cmd && document.queryCommandState(cmd)) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    }

    if (editor) {
        editor.addEventListener('keyup', updateSnToolbarState);
        editor.addEventListener('mouseup', updateSnToolbarState);
        editor.addEventListener('focus', updateSnToolbarState);
    }

    snCmdBtns.forEach(btn => {
        if(['sn-color-btn', 'sn-size-picker', 'sn-emoji-btn', 'sn-attach-btn', 'sn-link-btn'].includes(btn.id)) return;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const cmd = btn.getAttribute('data-cmd');
            if (cmd) document.execCommand(cmd, false, btn.dataset.val ?? null); // data-val: e.g. the highlight colour
            updateSnToolbarState();
            editor.focus(); // Keep cursor inside the sticky note
        });
    });

    if (sizePicker) sizePicker.addEventListener('change', (e) => {
        document.execCommand('fontSize', false, e.target.value);
        sizePicker.value = "2"; 
    });

    if (colorBtn && colorPalette) {
        colorPalette.innerHTML = swatchHtml('sn-color-swatch');
        colorBtn.addEventListener('click', () => {
            const isShowing = colorPalette.classList.contains('d-flex');
            if (isShowing) colorPalette.classList.replace('d-flex', 'd-none');
            else {
                colorPalette.classList.replace('d-none', 'd-flex');
                if (emojiPicker) emojiPicker.classList.replace('d-flex', 'd-none');
            }
        });
        document.querySelectorAll('.sn-color-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                document.execCommand('foreColor', false, swatch.getAttribute('data-color'));
                colorPalette.classList.replace('d-flex', 'd-none');
            });
        });
    }

    if (emojiBtn && emojiPicker) {
        emojiBtn.addEventListener('click', () => {
            const isShowing = emojiPicker.classList.contains('d-flex');
            if (isShowing) emojiPicker.classList.replace('d-flex', 'd-none');
            else {
                emojiPicker.classList.replace('d-none', 'd-flex');
                if (colorPalette) colorPalette.classList.replace('d-flex', 'd-none');
            }
        });
        document.querySelectorAll('.sn-emoji').forEach(emj => {
            emj.addEventListener('click', () => {
                document.execCommand('insertText', false, emj.textContent);
                emojiPicker.classList.replace('d-flex', 'd-none');
            });
        });
    }

    wireLinkPanel(document.getElementById('sn-link-btn'), document.getElementById('sn-link-panel'), editor);

    if (attachBtn) attachBtn.addEventListener('click', () => imageInput.click());
    if (imageInput) imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                currentImageBase64 = ev.target.result;
                imagePreview.src = currentImageBase64;
                imagePreviewContainer.classList.remove('d-none');
            };
            reader.readAsDataURL(file);
        }
    });
    if (removeImageBtn) removeImageBtn.addEventListener('click', () => {
        currentImageBase64 = null;
        imageInput.value = '';
        imagePreviewContainer.classList.add('d-none');
    });

    function loadNotes() {
        chrome.storage.local.get(['stickyNotes'], (res) => {
            notes = res.stickyNotes || [];
            renderNotes();
        });
    }

    function renderNotes() {
        if (!wrapper) return;
        wrapper.innerHTML = '';
        
        if (notes.length === 0) {
            wrapper.innerHTML = `
                <div class="col-12 text-center text-muted fst-italic py-3 small mt-2 border border-dashed rounded-3 bg-body-tertiary">
                    No notes yet. Jot something down!
                </div>`;
            notePageInfo.innerText = `Page 1 of 1`;
            prevBtn.disabled = true;
            nextBtn.disabled = true;
            return;
        }

        const totalPages = Math.ceil(notes.length / notesPerPage);
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;

        notePageInfo.innerText = `Page ${currentPage} of ${totalPages}`;
        prevBtn.disabled = currentPage === 1;
        nextBtn.disabled = currentPage === totalPages;

        const startIdx = (currentPage - 1) * notesPerPage;
        const currentNotes = notes.slice(startIdx, startIdx + notesPerPage);

        currentNotes.forEach((note) => {
            const dateStr = new Date(note.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const image = safeImage(note.image);
            const displayText = plainText(note.text).trim() ? sanitize(note.text) : (image ? '<i class="bi bi-image text-muted" aria-hidden="true"></i> Image only' : '');
            const imgHtml = image ? `<div class="mt-2 text-center bg-dark bg-opacity-10 rounded p-1"><img src="${esc(image)}" alt="Note image" class="img-fluid rounded shadow-sm" style="max-height: 100px; object-fit: contain;"></div>` : '';

            const div = document.createElement('div');
            div.className = 'col-6 col-md-4 col-lg-3 col-xl-2';
            div.innerHTML = `
                <div class="card h-100 shadow-sm border-warning border-opacity-50 bg-warning bg-opacity-10 position-relative group-hover" style="transition: transform 0.2s;">
                    <div class="card-body p-2 d-flex flex-column">
                        <div class="small mb-1 text-body" style="word-break: break-word; line-height: 1.4; flex-grow: 1;">${displayText}</div>
                        ${imgHtml}
                        <div class="d-flex justify-content-between align-items-end mt-2 pt-2 border-top border-warning border-opacity-25">
                            <small class="text-muted" style="font-size: var(--mq-fs-xs);">${dateStr}</small>
                            <button type="button" class="btn btn-sm btn-link text-danger p-0 delete-note-btn" title="Delete Note" aria-label="Delete note" style="line-height: 1;"><i class="bi bi-trash-fill" aria-hidden="true"></i></button>
                        </div>
                    </div>
                </div>
            `;

            // Two-step delete, as in the capture history: the first click arms the button for 3 s.
            const delBtn = div.querySelector('.delete-note-btn');
            let armed = null;
            delBtn.addEventListener('click', () => {
                if (!armed) {
                    delBtn.textContent = 'Delete?';
                    armed = setTimeout(() => { armed = null; delBtn.innerHTML = '<i class="bi bi-trash-fill" aria-hidden="true"></i>'; }, 3000);
                    return;
                }
                clearTimeout(armed);
                notes = notes.filter(n => n.id !== note.id);
                chrome.storage.local.set({ stickyNotes: notes }, loadNotes);
            });
            wrapper.appendChild(div);
        });
    }

    if (addNoteBtn) addNoteBtn.addEventListener('click', () => {
        const text = editor.innerHTML.trim();
        if (!text && !currentImageBase64 && text !== "<br>") return;

        notes.unshift({ id: Date.now(), text: text === "<br>" ? "" : text, image: currentImageBase64, createdAt: new Date().toISOString() });
        chrome.storage.local.set({ stickyNotes: notes }, () => {
            editor.innerHTML = '';
            if (currentImageBase64) removeImageBtn.click();
            
            const orig = addNoteBtn.innerHTML;
            addNoteBtn.innerHTML = '<i class="bi bi-check-lg"></i> Saved';
            addNoteBtn.classList.replace('btn-primary', 'btn-success');
            addNoteBtn.classList.replace('text-dark', 'text-white');
            setTimeout(() => {
                addNoteBtn.innerHTML = orig;
                addNoteBtn.classList.replace('btn-success', 'btn-primary');
                addNoteBtn.classList.replace('text-white', 'text-dark');
            }, 1000);
            
            currentPage = 1;
            loadNotes();
        });
    });

    if (prevBtn) prevBtn.addEventListener('click', () => { currentPage--; renderNotes(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { currentPage++; renderNotes(); });
    if (downloadBtn) downloadBtn.addEventListener('click', () => {
        if (notes.length === 0) return;
        const a = document.createElement('a');
        a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(notes, null, 2));
        a.download = `sticky_notes_${Date.now()}.json`;
        a.click();
    });

    if (deleteBtn) {
        const _confirmModalEl = document.getElementById('stickyNoteConfirmModal');
        if (_confirmModalEl) {
            const confirmModal = new bootstrap.Modal(_confirmModalEl);
            deleteBtn.addEventListener('click', () => { if (notes.length > 0) confirmModal.show(); });
            document.getElementById('cancelSnDelete')?.addEventListener('click', () => confirmModal.hide());
            document.getElementById('btnConfirmSnDelete')?.addEventListener('click', () => {
                notes = [];
                chrome.storage.local.set({ stickyNotes: notes }, () => { confirmModal.hide(); loadNotes(); });
            });
        }
    }


    // ==========================================
    // 🔵 2. TO-DO & TASKS ENGINE (MODAL UI)
    // ==========================================
    const todoListContainer = document.getElementById('taskListContainer');
    const todoSearchInput = document.getElementById('taskSearchInput');
    const todoFilterStatus = document.getElementById('taskFilterStatus');
    const todoFilterPriority = document.getElementById('taskFilterPriority');
    
    const todoCreateNewBtn = document.getElementById('taskCreateNewBtn');
    const todoSaveBtn = document.getElementById('taskSaveBtn');
    const todoDeleteBtn = document.getElementById('taskDeleteBtn');
    const todoSaveIndicator = document.getElementById('taskSaveIndicator');

    const eId = document.getElementById('taskCurrentId');
    const eStatus = document.getElementById('taskStatusCheck');
    const eTitle = document.getElementById('taskTitleInput');
    const eDate = document.getElementById('taskDateInput');
    const ePriority = document.getElementById('taskPriorityInput');
    const eCat = document.getElementById('taskCategoryInput');
    const eDesc = document.getElementById('taskDescInput');
    const subtaskList = document.getElementById('taskSubtaskList');
    const subtaskInput = document.getElementById('taskSubtaskInput');
    const addSubtaskBtn = document.getElementById('taskAddSubtaskBtn');
    const progressBadge = document.getElementById('taskChecklistProgress');

    let currentTaskImageBase64 = null;

    let tasks = [];
    let activeTaskId = null;
    let taskModal = null; // Will hold the Bootstrap Modal instance

    function loadTasks() {
        chrome.storage.local.get(['marquisTasks'], (res) => {
            tasks = res.marquisTasks || [];
            renderTaskList();
        });
    }

    function saveTasks() {
        chrome.storage.local.set({ marquisTasks: tasks });
    }

    function getPriorityColor(priority) {
        switch(priority) {
            case 'high': return 'bg-danger';
            case 'medium': return 'bg-warning';
            case 'low': return 'bg-primary';
            default: return 'bg-secondary';
        }
    }

    function renderTaskList() {
        if (!todoListContainer) return;
        const search = (todoSearchInput.value || '').toLowerCase();
        const statusF = todoFilterStatus.value;
        const priorityF = todoFilterPriority.value;

        todoListContainer.innerHTML = '';

        let filtered = tasks.filter(t => {
            // Description is matched as plain text, not markup (searching "span" no longer matches every task).
            const matchSearch = t.title.toLowerCase().includes(search) || plainText(t.desc).toLowerCase().includes(search) || t.category.toLowerCase().includes(search);
            const matchStatus = statusF === 'all' || (statusF === 'completed' && t.completed) || (statusF === 'pending' && !t.completed);
            const matchPriority = priorityF === 'all' || t.priority === priorityF;
            return matchSearch && matchStatus && matchPriority;
        });

        filtered.sort((a, b) => {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            if (a.date !== b.date) return new Date(a.date || '2099') - new Date(b.date || '2099');
            return 0;
        });

        if (filtered.length === 0) {
            todoListContainer.innerHTML = `
                <div class="col-12 text-center p-3 text-muted small fst-italic border border-dashed rounded-3 bg-body shadow-sm">
                    No tasks found in your archive.
                </div>`;
            return;
        }

        filtered.forEach(t => {
            const isOverdue = !t.completed && t.date && new Date(t.date) < new Date(new Date().setHours(0,0,0,0));
            const dateHtml = t.date ? `<span class="${isOverdue ? 'text-danger' : 'text-secondary'} fw-bold" style="font-size: var(--mq-fs-xs);"><i class="bi bi-calendar-event me-1"></i>${new Date(t.date).toLocaleDateString()}</span>` : '';
            const catHtml = t.category ? `<span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-25 px-1 py-0 text-uppercase text-truncate" style="max-width:80px; font-size: var(--mq-fs-xs);">${esc(t.category)}</span>` : '';
            const subDones = t.subtasks.filter(s => s.done).length;
            const subTotal = t.subtasks.length;
            const subHtml = subTotal > 0 ? `<span class="text-primary fw-bold ms-auto" style="font-size: var(--mq-fs-xs);"><i class="bi bi-check2-square me-1"></i>${subDones}/${subTotal}</span>` : '';

            // 🟢 Grid Column Wrapper
            const col = document.createElement('div');
            col.className = 'col-12 col-md-6 col-lg-4';
            
            // 🟢 The Card
            const card = document.createElement('div');
            card.className = `p-3 rounded-4 border shadow-sm cursor-pointer transition-colors h-100 ${t.completed ? 'opacity-75 bg-body-tertiary border-secondary-subtle' : 'bg-body border-secondary-subtle group-hover'}`;
            
            card.innerHTML = `
                <div class="d-flex align-items-start gap-2 h-100 flex-column">
                    <div class="d-flex align-items-center gap-2 w-100 mb-1">
                        <div class="rounded-circle flex-shrink-0 ${getPriorityColor(t.priority)}" style="width: 12px; height: 12px;"></div>
                        <h6 class="mb-0 small fw-bold text-body text-truncate ${t.completed ? 'text-decoration-line-through text-muted' : ''}">${esc(t.title || 'Untitled Task')}</h6>
                    </div>
                    <p class="text-muted mb-2 lh-sm flex-grow-1" style="font-size: var(--mq-fs-xs); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                        ${esc(plainText(t.desc).trim()) || 'No description...'}
                    </p>
                    <div class="d-flex align-items-center gap-2 w-100 mt-auto pt-2 border-top border-secondary-subtle">
                        ${dateHtml} ${catHtml} ${subHtml}
                    </div>
                </div>
            `;
            card.addEventListener('click', () => openEditor(t.id));
            // Keyboard: the card is the only way to open a task.
            card.tabIndex = 0;
            card.setAttribute('role', 'button');
            card.setAttribute('aria-label', `Open task: ${t.title || 'Untitled Task'}`);
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(t.id); }
            });
            col.appendChild(card);
            todoListContainer.appendChild(col);
        });
    }

    function getOrCreateTaskModal() {
        if (!taskModal && typeof bootstrap !== 'undefined') {
            const el = document.getElementById('taskEditorModal');
            if (el) {
                taskModal = new bootstrap.Modal(el);
                el.addEventListener('hidden.bs.modal', dropBlankTask);
            }
        }
        return taskModal;
    }

    // "New task" stores a blank task at once (subtasks need its id). If the editor closes while the stored
    // task is still empty, it is removed instead of piling up as "Untitled Task".
    function dropBlankTask() {
        const t = tasks.find(x => x.id === activeTaskId);
        if (!t || t.title || plainText(t.desc).trim() || t.subtasks.length || t.image) return;
        tasks = tasks.filter(x => x !== t);
        activeTaskId = null;
        saveTasks();
        renderTaskList();
    }

    function openEditor(id) {
        const task = tasks.find(t => t.id === id);
        if (!task) return;

        activeTaskId = id;
        
        eId.value = task.id;
        eTitle.value = task.title;
        eDesc.innerHTML = sanitize(task.desc || '');
        eDate.value = task.date;
        ePriority.value = task.priority;
        eCat.value = task.category;
        eStatus.checked = task.completed;

        // Load attached image if present
        currentTaskImageBase64 = safeImage(task.image) || null;
        if (currentTaskImageBase64) {
            document.getElementById('taskImagePreview').src = currentTaskImageBase64;
            document.getElementById('taskImagePreviewContainer').classList.remove('d-none');
        } else {
            document.getElementById('taskImagePreviewContainer').classList.add('d-none');
        }
        
        renderSubtasks(task.subtasks);
        todoDeleteBtn.classList.remove('d-none');
        
        const modal = getOrCreateTaskModal();
        if (modal) modal.show();
    }

    function renderSubtasks(subtasks) {
        subtaskList.innerHTML = '';
        let dones = 0;

        subtasks.forEach((sub, idx) => {
            if (sub.done) dones++;
            const item = document.createElement('div');
            item.className = "d-flex align-items-center gap-2 p-2 bg-body-tertiary rounded border border-secondary-subtle";
            item.innerHTML = `
                <input type="checkbox" class="form-check-input mt-0 cursor-pointer border-secondary-subtle" aria-label="Subtask done" ${sub.done ? 'checked' : ''}>
                <input type="text" class="form-control form-control-sm border-0 bg-transparent shadow-none fw-medium text-body ${sub.done ? 'text-decoration-line-through text-muted' : ''}" aria-label="Subtask" value="${esc(sub.text)}">
                <button type="button" class="btn btn-sm btn-link text-danger p-0 ms-auto" aria-label="Remove subtask" title="Remove subtask"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
            `;

            item.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
                sub.done = e.target.checked;
                renderSubtasks(subtasks);
                autoSaveTask();
            });

            item.querySelector('input[type="text"]').addEventListener('input', (e) => {
                sub.text = e.target.value;
            });

            item.querySelector('button').addEventListener('click', () => {
                subtasks.splice(idx, 1);
                renderSubtasks(subtasks);
                autoSaveTask();
            });
            subtaskList.appendChild(item);
        });

        progressBadge.innerText = `${dones}/${subtasks.length}`;
        if (subtasks.length > 0 && dones === subtasks.length) {
            progressBadge.classList.replace('bg-primary', 'bg-success');
            progressBadge.classList.replace('text-primary', 'text-success');
            progressBadge.classList.replace('border-primary', 'border-success');
        } else {
            progressBadge.classList.replace('bg-success', 'bg-primary');
            progressBadge.classList.replace('text-success', 'text-primary');
            progressBadge.classList.replace('border-success', 'border-primary');
        }
    }

    function addSubtask() {
        const text = subtaskInput.value.trim();
        if (!text || !activeTaskId) return;

        const task = tasks.find(t => t.id === activeTaskId);
        task.subtasks.push({ text: text, done: false });
        subtaskInput.value = '';
        renderSubtasks(task.subtasks);
        autoSaveTask();
    }

    if (addSubtaskBtn) addSubtaskBtn.addEventListener('click', addSubtask);
    if (subtaskInput) subtaskInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') addSubtask(); });

    function autoSaveTask() {
        if (!activeTaskId) return;
        const taskIndex = tasks.findIndex(t => t.id === activeTaskId);
        if (taskIndex === -1) return;

        tasks[taskIndex] = {
            id: activeTaskId,
            title: eTitle.value.trim() || 'Untitled Task',
            desc: eDesc.innerHTML,
            date: eDate.value,
            priority: ePriority.value,
            category: eCat.value.trim(),
            completed: eStatus.checked,
            subtasks: tasks[taskIndex].subtasks,
            image: currentTaskImageBase64 // Save the image!
        };

        saveTasks();
        renderTaskList();
    }

    if (todoSaveBtn) todoSaveBtn.addEventListener('click', () => {
        if (!activeTaskId && eTitle.value.trim() === '') return;
        autoSaveTask();
        
        todoSaveIndicator.classList.remove('d-none');
        todoSaveIndicator.classList.add('d-flex');
        setTimeout(() => {
            todoSaveIndicator.classList.add('d-none');
            todoSaveIndicator.classList.remove('d-flex');
            
            const modal = getOrCreateTaskModal();
            if (modal) modal.hide();
        }, 500);
    });

    if (todoCreateNewBtn) todoCreateNewBtn.addEventListener('click', () => {
        const newId = Date.now().toString();
        
        // Push blank task instantly so subtasks have an ID to attach to
        tasks.unshift({
            id: newId, title: '', desc: '', date: '', priority: 'none', category: '', completed: false, subtasks: []
        });
        saveTasks();
        
        todoDeleteBtn.classList.add('d-none');
        openEditor(newId);
        
        setTimeout(() => { eTitle.focus(); }, 200);
    });

    if (todoDeleteBtn) {
        const _taskConfirmEl = document.getElementById('taskConfirmDeleteModal');
        let taskConfirmModal = null;
        
        todoDeleteBtn.addEventListener('click', () => {
            if (!activeTaskId) return;
            
            if (_taskConfirmEl && typeof bootstrap !== 'undefined') {
                if (!taskConfirmModal) taskConfirmModal = new bootstrap.Modal(_taskConfirmEl);
                taskConfirmModal.show();
            }
        });

        document.getElementById('btnConfirmTaskDelete')?.addEventListener('click', () => {
            tasks = tasks.filter(t => t.id !== activeTaskId);
            saveTasks();
            activeTaskId = null;
            
            if (taskConfirmModal) taskConfirmModal.hide();
            
            const modal = getOrCreateTaskModal();
            if (modal) modal.hide();
            
            renderTaskList();
        });
    }

    if (eStatus) eStatus.addEventListener('change', () => {
        if (eStatus.checked) eTitle.classList.add('text-decoration-line-through', 'text-muted');
        else eTitle.classList.remove('text-decoration-line-through', 'text-muted');
        autoSaveTask();
    });

    if (todoSearchInput) todoSearchInput.addEventListener('input', renderTaskList);
    if (todoFilterStatus) todoFilterStatus.addEventListener('change', renderTaskList);
    if (todoFilterPriority) todoFilterPriority.addEventListener('change', renderTaskList);

// ==========================================
    // 🟢 TASK EDITOR: FULL TOOLBAR LOGIC
    // ==========================================
    
    // Setup Colors
    const taskColorPalette = document.getElementById('task-color-palette');
    if (taskColorPalette) taskColorPalette.innerHTML = swatchHtml('sn-color-swatch task-color-swatch');
    // Keep the description's selection while toolbar buttons are clicked (the size select still opens).
    document.getElementById('task-toolbar')?.addEventListener('mousedown', (e) => {
        if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') e.preventDefault();
    });

    const tSizePicker = document.getElementById('task-size-picker');
    const tColorBtn = document.getElementById('task-color-btn');
    const tEmojiBtn = document.getElementById('task-emoji-btn');
    const tEmojiPicker = document.getElementById('task-emoji-picker');
    const tAttachBtn = document.getElementById('task-attach-btn');
    const tImgInput = document.getElementById('taskImageInput');

    if (tSizePicker) tSizePicker.addEventListener('change', (e) => {
        document.execCommand('fontSize', false, e.target.value);
        tSizePicker.value = "2"; 
    });

    if (tColorBtn && taskColorPalette) {
        tColorBtn.addEventListener('click', () => {
            taskColorPalette.classList.toggle('d-none');
            taskColorPalette.classList.toggle('d-flex');
            if (tEmojiPicker) { tEmojiPicker.classList.add('d-none'); tEmojiPicker.classList.remove('d-flex'); }
        });
        document.querySelectorAll('.task-color-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                document.execCommand('foreColor', false, swatch.getAttribute('data-color'));
                taskColorPalette.classList.add('d-none');
                taskColorPalette.classList.remove('d-flex');
            });
        });
    }

    if (tEmojiBtn && tEmojiPicker) {
        tEmojiBtn.addEventListener('click', () => {
            tEmojiPicker.classList.toggle('d-none');
            tEmojiPicker.classList.toggle('d-flex');
            if (taskColorPalette) { taskColorPalette.classList.add('d-none'); taskColorPalette.classList.remove('d-flex'); }
        });
        document.querySelectorAll('.task-emoji').forEach(emj => {
            emj.addEventListener('click', () => {
                document.execCommand('insertText', false, emj.textContent);
                tEmojiPicker.classList.add('d-none');
                tEmojiPicker.classList.remove('d-flex');
            });
        });
    }

    if (tAttachBtn) tAttachBtn.addEventListener('click', () => tImgInput.click());
    if (tImgInput) tImgInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                currentTaskImageBase64 = ev.target.result;
                document.getElementById('taskImagePreview').src = currentTaskImageBase64;
                document.getElementById('taskImagePreviewContainer').classList.remove('d-none');
                autoSaveTask();
            };
            reader.readAsDataURL(file);
        }
    });
    document.getElementById('taskRemoveImageBtn')?.addEventListener('click', () => {
        currentTaskImageBase64 = null;
        tImgInput.value = '';
        document.getElementById('taskImagePreviewContainer').classList.add('d-none');
        autoSaveTask();
    });

    const taskCmdBtns = document.querySelectorAll('.task-cmd');
    function updateToolbarState() {
        if (!eDesc) return;
        taskCmdBtns.forEach(btn => {
            const cmd = btn.getAttribute('data-cmd');
            if (cmd && document.queryCommandState(cmd)) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    }

    if (eDesc) {
        eDesc.addEventListener('keyup', updateToolbarState);
        eDesc.addEventListener('mouseup', updateToolbarState);
        eDesc.addEventListener('focus', updateToolbarState);
    }

    taskCmdBtns.forEach(btn => {
        if (btn.id === 'task-link-btn') return; // focuses its URL field instead of the description
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const cmd = btn.getAttribute('data-cmd');
            if (cmd) document.execCommand(cmd, false, btn.dataset.val ?? null);
            updateToolbarState();
            eDesc.focus();
        });
    });
    wireLinkPanel(document.getElementById('task-link-btn'), document.getElementById('task-link-panel'), eDesc);

    loadNotes();
    loadTasks();
}


// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'stickyNotesSection') initStickyNotes();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('newStickyNote')) initStickyNotes();
});