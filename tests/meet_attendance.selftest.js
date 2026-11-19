// Self-test for scrapeGoogleMeetParticipants (scripts/meet_attendance.js) against the fixture in the page.
(() => {
    const results = document.getElementById('results');
    let failed = 0;
    const check = (name, ok, detail = '') => {
        if (!ok) failed++;
        const li = document.createElement('li');
        li.textContent = `${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`;
        results.appendChild(li);
    };

    const names = scrapeGoogleMeetParticipants();
    const expected = ['Avery Jordan ADAMS', 'Blake Morgan BAKER', 'Casey CRUZ', 'Dana DIAZ',
        'Emery Lee EVANS', 'Finley FOX', 'Gray GARCIA'];

    check('finds every participant once, sorted', JSON.stringify(names) === JSON.stringify(expected), JSON.stringify(names));
    check('no icon glyph or "More options" text', !names.some((n) => /more_vert|more options/i.test(n)), JSON.stringify(names));
    check('no (You) / presenting suffixes', !names.some((n) => /\(you\)|presenting/i.test(n)), JSON.stringify(names));
    check('no text without letters (timers)', !names.some((n) => !/\p{L}/u.test(n)), JSON.stringify(names));

    document.getElementById('summary').textContent = failed ? `${failed} failed` : `all ${results.children.length} passed`;
})();
