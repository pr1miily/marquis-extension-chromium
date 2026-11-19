// Self-test for scripts/mq_float.js. Results render in #results and land in window.__mqResults.
(async () => {
    const results = (window.__mqResults = []);
    const pageErrors = [];
    window.addEventListener('error', (e) => pageErrors.push(e.message || 'error'));
    const $ = (id) => document.getElementById(id);
    const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const key = (el, k, o = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...o }));
    const down = (el) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    const visible = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
    const inViewport = (r) => r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    async function test(name, fn) {
        try { await fn(); results.push({ name, ok: true }); }
        catch (e) { results.push({ name, ok: false, detail: String(e && e.message || e) }); }
        MarquisFloat.close();
        await tick(10);
    }
    const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
    const eq = (a, b, msg) => assert(a === b, `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

    // Fixtures built in script: a long list, and a select inside a closed shadow root (like the dock).
    for (let i = 1; i <= 40; i++) $('sLong').add(new Option(`Option ${i}`, `o${i}`));
    const shadow = $('shadowHost').attachShadow({ mode: 'closed' });
    shadow.innerHTML = '<select aria-label="Shadow colour"><option value="r">Red</option><option value="g">Green</option></select>';
    const shSel = shadow.querySelector('select');

    let changes = 0;
    $('sBasic').addEventListener('change', () => changes++);
    MarquisFloat.enhanceAll(document);
    MarquisFloat.enhanceAll(shadow);
    await tick();

    const T = (id) => $(id)._mqSelect.trigger;
    const P = (id) => $(id)._mqSelect.panel;

    await test('every select enhanced; native hidden; trigger shows selection', async () => {
        for (const id of ['sBasic', 'sGroups', 'sLong', 'sClip', 'sGlass', 'sModal', 'sBottom']) {
            assert($(id)._mqSelect, `${id} not enhanced`);
            assert(!$(id).getClientRects().length, `${id} native still rendered`);
        }
        eq(T('sBasic').textContent.trim(), 'Apple', 'trigger text');
        eq(T('sBasic').getAttribute('role'), 'combobox', 'trigger role');
    });

    await test('label names the trigger and focuses it on click', async () => {
        const label = document.querySelector('label[for="sBasic"]');
        eq(T('sBasic').getAttribute('aria-labelledby'), label.id, 'aria-labelledby');
        label.click();
        eq(document.activeElement, T('sBasic'), 'focus after label click');
    });

    await test('click opens a listbox in <body> with the selected option active', async () => {
        T('sBasic').click();
        const p = P('sBasic');
        assert(visible(p), 'panel not visible');
        eq(p.parentElement, document.body, 'panel layer');
        eq(T('sBasic').getAttribute('aria-expanded'), 'true', 'aria-expanded');
        const opts = p.querySelectorAll('[role="option"]');
        eq(opts.length, 4, 'option count');
        eq(T('sBasic').getAttribute('aria-activedescendant'), opts[0].id, 'active descendant');
        eq(opts[1].getAttribute('aria-disabled'), 'true', 'disabled option');
    });

    await test('ArrowDown skips disabled; Enter commits, fires one change, closes, refocuses', async () => {
        changes = 0;
        T('sBasic').focus();
        key(T('sBasic'), 'ArrowDown');           // open
        key(T('sBasic'), 'ArrowDown');           // Apple -> Cherry (Banana disabled)
        key(T('sBasic'), 'Enter');
        eq($('sBasic').value, 'c', 'value');
        eq(changes, 1, 'change events');
        eq(T('sBasic').textContent.trim(), 'Cherry', 'trigger text');
        assert(!visible(P('sBasic')), 'panel still open');
        eq(document.activeElement, T('sBasic'), 'focus');
    });

    await test('Escape closes without changing the value', async () => {
        changes = 0;
        key(T('sBasic'), 'ArrowDown');
        key(T('sBasic'), 'End');
        key(T('sBasic'), 'Escape');
        eq($('sBasic').value, 'c', 'value');
        eq(changes, 0, 'change events');
        assert(!visible(P('sBasic')), 'panel open');
    });

    await test('code that sets value / selectedIndex updates the trigger', async () => {
        $('sBasic').value = 'd';
        eq(T('sBasic').textContent.trim(), 'Date', 'after .value');
        $('sBasic').selectedIndex = 0;
        eq(T('sBasic').textContent.trim(), 'Apple', 'after .selectedIndex');
    });

    await test('options added or refilled by code appear', async () => {
        $('sBasic').add(new Option('Elderberry', 'e'));
        await tick();
        T('sBasic').click();
        eq(P('sBasic').querySelectorAll('[role="option"]').length, 5, 'after add');
        MarquisFloat.close();
        $('sBasic').innerHTML = '<option value="x">Xigua</option><option value="y">Yuzu</option>';
        await tick();
        eq(T('sBasic').textContent.trim(), 'Xigua', 'after innerHTML');
    });

    await test('data-icon + data-color draw a tinted tile on the trigger and in the list', async () => {
        $('sBasic').innerHTML = '<option value="x" data-icon="bi bi-house" data-color="#ef4444">Xigua</option><option value="y" data-icon="bi bi-star">Yuzu</option>';
        await tick();
        const tile = T('sBasic').querySelector('i.mq-float-tile.bi-house');
        assert(tile, 'no tile on trigger');
        eq(tile.style.getPropertyValue('--tile'), '#ef4444', 'tile colour');
        T('sBasic').click();
        eq(P('sBasic').querySelectorAll('.mq-float-tile').length, 1, 'tiles in list (only the coloured option)');
        eq(P('sBasic').querySelectorAll('i.bi-star:not(.mq-float-tile)').length, 1, 'plain icon without data-color');
        MarquisFloat.close();
        $('sBasic').value = 'y';
        await tick();
        eq(T('sBasic').querySelectorAll('i').length, 1, 'trigger keeps one icon');
        assert(!T('sBasic').querySelector('.mq-float-tile'), 'stale tile after change');
        $('sBasic').innerHTML = '<option value="x">Xigua</option><option value="y">Yuzu</option>';
        await tick();
    });

    await test('type-ahead on the closed trigger selects and fires change', async () => {
        changes = 0;
        T('sBasic').focus();
        key(T('sBasic'), 'y');
        eq($('sBasic').value, 'y', 'value');
        eq(changes, 1, 'change events');
    });

    await test('optgroups render as labelled groups; form-select-sm maps to mq-select-sm', async () => {
        T('sGroups').click();
        eq(P('sGroups').querySelectorAll('[role="group"]').length, 2, 'groups');
        eq(P('sGroups').querySelectorAll('.mq-float-header').length, 2, 'headers');
        assert(T('sGroups').classList.contains('mq-select-sm'), 'size class');
    });

    await test('long list: search box takes focus, filters, Enter picks the match', async () => {
        T('sLong').click();
        const input = P('sLong').querySelector('input[type="search"]');
        assert(input, 'no search box');
        eq(document.activeElement, input, 'focus in search');
        input.value = 'option 37';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        eq(P('sLong').querySelectorAll('[role="option"]').length, 1, 'filtered rows');
        key(input, 'Enter');
        eq($('sLong').value, 'o37', 'value');
        input.value = 'zzz';
        T('sLong').click();
        eq(input.value, '', 'search resets on open');
    });

    await test('near the viewport bottom the panel flips above and stays on screen', async () => {
        T('sBottom').click();
        await frame();
        const p = P('sBottom');
        eq(p.dataset.side, 'top', 'side');
        const pr = p.getBoundingClientRect(), tr = T('sBottom').getBoundingClientRect();
        assert(pr.bottom <= tr.top + 0.5, 'panel overlaps trigger');
        assert(inViewport(pr), 'panel off screen');
    });

    await test('inside overflow:hidden the panel is not clipped', async () => {
        T('sClip').click();
        await frame();
        const pr = P('sClip').getBoundingClientRect();
        assert(inViewport(pr), 'off screen');
        const hit = document.elementFromPoint(pr.left + pr.width / 2, pr.bottom - 8);
        assert(P('sClip').contains(hit), 'bottom of panel hidden by the clipping box');
    });

    await test('inside backdrop-filter the panel sits right under the trigger', async () => {
        T('sGlass').click();
        await frame();
        await Promise.all(P('sGlass').getAnimations().map((a) => a.finished)); // measure the resting position
        const pr = P('sGlass').getBoundingClientRect(), tr = T('sGlass').getBoundingClientRect();
        assert(Math.abs(pr.top - (tr.bottom + 4)) < 1 && Math.abs(pr.left - tr.left) < 1, `offset ${pr.left - tr.left},${pr.top - tr.bottom}`);
        MarquisFloat.close();
    });

    await test('scrolling the list or the page does not move the panel off its trigger', async () => {
        T('sLong').click();
        await frame();
        await Promise.all(P('sLong').getAnimations().map((a) => a.finished));
        const gap = () => P('sLong').getBoundingClientRect().top - T('sLong').getBoundingClientRect().bottom;
        const g0 = gap();
        P('sLong').querySelector('[role="listbox"]').scrollTop = 120;
        await frame(); await frame();
        assert(Math.abs(gap() - g0) < 0.5, `moved ${gap() - g0}px on list scroll`);
        window.dispatchEvent(new Event('scroll'));
        await frame(); await frame();
        assert(Math.abs(gap() - g0) < 0.5, `moved ${gap() - g0}px on page scroll`);
        MarquisFloat.close();
    });

    await test('inside a Bootstrap modal: panel lives in the modal and keeps focus', async () => {
        const modal = new bootstrap.Modal($('tModal'));
        await new Promise((r) => { $('tModal').addEventListener('shown.bs.modal', r, { once: true }); modal.show(); });
        T('sModal').click();
        await tick(50);
        eq(P('sModal').parentElement, $('tModal'), 'layer');
        const input = P('sModal').querySelector('input');
        eq(document.activeElement, input, 'focus kept by the modal focus trap');
        key(input, 'ArrowDown');
        key(input, 'Enter');
        eq($('sModal').value, 'Beta', 'value');
        await new Promise((r) => { $('tModal').addEventListener('hidden.bs.modal', r, { once: true }); modal.hide(); });
    });

    await test('outside pointerdown closes; opening another closes the first', async () => {
        T('sBasic').click();
        T('sGroups').click();
        assert(!visible(P('sBasic')), 'first still open');
        assert(visible(P('sGroups')), 'second not open');
        down(document.body);
        assert(!visible(P('sGroups')), 'outside click did not close');
    });

    await test('Bootstrap dropdown adopted: roles, keyboard, item handler, focus return', async () => {
        let renamed = 0, deleted = 0;
        $('mRename').addEventListener('click', () => renamed++);
        $('mDelete').addEventListener('click', () => deleted++);
        const m = MarquisFloat.menu($('mBtn'), $('mBtn').nextElementSibling);
        assert(!$('mBtn').hasAttribute('data-bs-toggle'), 'Bootstrap toggle still attached');
        $('mBtn').focus();
        key($('mBtn'), 'ArrowDown');
        assert(m.isOpen(), 'not open');
        eq(m.panel.getAttribute('role'), 'menu', 'role');
        eq(document.activeElement, $('mRename'), 'first item focused');
        key(document.activeElement, 'ArrowDown');           // skips the disabled item
        eq(document.activeElement, $('mDelete'), 'second focus');
        key(document.activeElement, 'Enter');
        eq(deleted, 1, 'item handler');
        assert(!m.isOpen(), 'still open');
        eq(document.activeElement, $('mBtn'), 'focus back on trigger');
        $('mBtn').click();
        assert(m.isOpen(), 'click did not open');
        $('mRename').click();
        eq(renamed, 1, 'click handler');
    });

    await test('menu from items array: onSelect, disabled ignored, Escape returns focus', async () => {
        let picked = '';
        const m = MarquisFloat.menu($('m2Btn'), [
            { header: 'Export' },
            { label: 'Copy', icon: 'bi bi-clipboard', onSelect: () => (picked = 'copy') },
            { label: 'Locked', disabled: true, onSelect: () => (picked = 'locked') },
            { divider: true },
            { label: 'Delete', danger: true, onSelect: () => (picked = 'delete') },
        ], { placement: 'bottom-end' });
        $('m2Btn').focus();
        key($('m2Btn'), 'ArrowUp');                         // opens on the last item
        eq(document.activeElement.textContent.trim(), 'Delete', 'last item');
        key(document.activeElement, 'Home');
        key(document.activeElement, 'Enter');
        eq(picked, 'copy', 'onSelect');
        key($('m2Btn'), 'Enter');
        key(document.activeElement, 'Escape');
        assert(!m.isOpen(), 'open after Escape');
        eq(document.activeElement, $('m2Btn'), 'focus');
    });

    await test('an open panel follows a theme change immediately', async () => {
        T('sGroups').click();
        const p = P('sGroups');
        const before = getComputedStyle(p).backgroundColor;
        document.documentElement.dataset.marquisTheme = 'light';
        document.documentElement.dataset.bsTheme = 'light';
        const after = getComputedStyle(p).backgroundColor;
        document.documentElement.dataset.marquisTheme = 'default';
        document.documentElement.dataset.bsTheme = 'dark';
        assert(before !== after, `background unchanged (${before})`);
        eq(after, 'rgb(255, 255, 255)', 'light surface');
    });

    await test('closed shadow root (dock): own styles, panel in the shadow, selection works', async () => {
        const inst = shSel._mqSelect;
        assert(inst, 'not enhanced');
        assert(shadow.querySelector('style[data-mq-float]'), 'no style in shadow root');
        inst.trigger.click();
        eq(inst.panel.getRootNode(), shadow, 'panel root');
        const green = inst.panel.querySelectorAll('[role="option"]')[1];
        down(green);                                      // must not count as an outside click
        assert(inst.isOpen(), 'pointerdown inside closed shadow panel closed it');
        green.click();
        eq(shSel.value, 'g', 'value');
        inst.trigger.click();
        down(document.body);
        assert(!inst.isOpen(), 'outside click did not close');
    });

    await test('disabled and d-none on the select carry to the trigger', async () => {
        $('sGroups').disabled = true;
        $('sGroups').classList.add('d-none');
        await tick();
        assert(T('sGroups').disabled, 'not disabled');
        assert(T('sGroups').classList.contains('d-none'), 'not hidden');
        $('sGroups').disabled = false;
        $('sGroups').classList.remove('d-none');
        await tick();
        assert(!T('sGroups').disabled && visible(T('sGroups')), 'not restored');
    });

    await test('destroy() restores the native select', async () => {
        const inst = $('sGlass')._mqSelect;
        inst.destroy();
        assert(!$('sGlass')._mqSelect && $('sGlass').getClientRects().length, 'native not back');
        assert(!inst.trigger.isConnected, 'trigger left behind');
        $('sGlass').value = 'South';
        eq($('sGlass').value, 'South', 'native value');
    });

    await test('enhanceAll adopts a Bootstrap dropdown added later; no items = popover that stays open on inside clicks', async () => {
        const wrap = document.createElement('div');
        wrap.className = 'dropdown fixture';
        wrap.innerHTML = '<button id="pBtn" class="btn btn-outline-secondary" data-bs-toggle="dropdown" data-bs-auto-close="outside" type="button">Labels</button>'
            + '<div class="dropdown-menu p-2"><label><input type="checkbox" id="pChk"> Urgent</label></div>';
        document.body.insertBefore(wrap, $('results'));
        await tick();
        const pop = $('pBtn')._mqPopover;
        assert(pop, 'not adopted');
        assert(!$('pBtn').hasAttribute('data-bs-toggle'), 'Bootstrap toggle still attached');
        $('pBtn').click();
        assert(pop.isOpen(), 'not open');
        eq(pop.panel.getAttribute('role'), 'dialog', 'role');
        down($('pChk')); $('pChk').click();
        assert(pop.isOpen() && $('pChk').checked, 'inside click closed it');
        key($('pChk'), 'Escape');
        assert(!pop.isOpen(), 'Escape did not close');
        eq(document.activeElement, $('pBtn'), 'focus back');
    });

    await test('a re-rendered trigger leaves no orphan panel behind', async () => {
        const host = document.createElement('div');
        host.innerHTML = '<div class="dropdown"><button id="oBtn" class="btn" data-bs-toggle="dropdown" type="button">x</button><ul class="dropdown-menu"><li><a class="dropdown-item" href="#">a</a></li></ul></div>';
        document.body.insertBefore(host, $('results'));
        await tick();
        $('oBtn').click();
        const panel = $('oBtn')._mqMenu.panel;
        eq(panel.parentElement, document.body, 'portalled');
        MarquisFloat.close();
        host.remove();
        T('sBasic').click();                              // any open() sweeps
        assert(!panel.isConnected, 'orphan panel still in <body>');
    });

    await test('select first in an .input-group keeps its left corners', async () => {
        const g = document.createElement('div');
        g.className = 'input-group fixture';
        g.innerHTML = '<select class="form-select" aria-label="Grouped"><option>One</option></select><button class="btn btn-outline-secondary" type="button">Go</button>';
        document.body.insertBefore(g, $('results'));
        await tick();
        const t = g.querySelector('.mq-select');
        assert(t, 'not enhanced');
        const cs = getComputedStyle(t);
        assert(parseFloat(cs.borderTopLeftRadius) > 0 && cs.marginLeft === '0px', `radius ${cs.borderTopLeftRadius}, margin ${cs.marginLeft}`);
        eq(parseFloat(cs.borderTopRightRadius), 0, 'right radius (joins the button)');
    });

    await test('picking from a list keeps the text selection of a rich-text editor', async () => {
        const ed = document.createElement('div');
        ed.contentEditable = 'true';
        ed.textContent = 'hello world';
        document.body.insertBefore(ed, $('results'));
        const r = document.createRange(); r.setStart(ed.firstChild, 0); r.setEnd(ed.firstChild, 5);
        getSelection().removeAllRanges(); getSelection().addRange(r);
        T('sGroups').click();
        const opt = P('sGroups').querySelectorAll('[role="option"]')[1];
        const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        opt.dispatchEvent(md);
        assert(md.defaultPrevented, 'mousedown on an option was not cancelled');
        opt.click();
        eq(getSelection().toString(), 'hello', 'editor selection');
        ed.remove();
    });

    await test('arrow keys and Escape in an adopted menu raise no page errors (Bootstrap capture handler)', async () => {
        const m = $('mBtn')._mqMenu;
        const before = pageErrors.length;
        m.open();
        const item = m.panel.querySelector('.dropdown-item:not(.disabled)');
        item.focus();
        for (const k of ['ArrowDown', 'ArrowUp', 'Escape']) key(document.activeElement, k);
        await tick(20);
        assert(!m.panel.classList.contains('dropdown-menu'), 'adopted panel still matches .dropdown-menu');
        eq(pageErrors.length - before, 0, 'uncaught errors');
    });

    await test('no uncaught page errors during the whole run', async () => {
        eq(pageErrors.length, 0, `uncaught errors (${pageErrors.slice(0, 3).join(' | ')})`);
    });

    const failed = results.filter((r) => !r.ok);
    $('results').innerHTML = results.map((r) => `<li class="${r.ok ? 'pass' : 'fail'}">${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ' — ' + r.detail.replace(/</g, '&lt;')}</li>`).join('');
    $('summary').textContent = failed.length ? `${failed.length} failed` : `all ${results.length} passed`;
    $('summary').className = `badge ${failed.length ? 'bg-danger' : 'bg-success'}`;
    window.__mqDone = true;
})();
