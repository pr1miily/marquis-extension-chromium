// Self-test for scripts/safe_html.js. Results render in #results and land in window.__mqResults.
(() => {
    const results = (window.__mqResults = []);
    const check = (name, input, expected = input) => {
        const got = MarquisHtml.sanitize(input);
        results.push({ name, ok: got === expected, detail: got });
    };
    const NEW_TAB = 'target="_blank" rel="noopener noreferrer"';

    // What the note toolbar produces must survive a save.
    check('keeps formatting tags', '<b>b</b><i>i</i><u>u</u><strike>s</strike><ol><li>n</li></ol>');
    check('keeps highlight span', '<span style="background-color: rgba(250, 204, 21, 0.4);">h</span>');
    check('keeps indent blockquote', '<blockquote style="margin: 0 0 0 40px; border: none; padding: 0px;">x</blockquote>');
    check('keeps https link, forces new tab', '<a href="https://example.com/a?b=1">e</a>', `<a href="https://example.com/a?b=1" ${NEW_TAB}>e</a>`);
    check('keeps mailto link', '<a href="mailto:a@example.com">m</a>', `<a href="mailto:a@example.com" ${NEW_TAB}>m</a>`);

    // Anything that could run script or reach out is removed.
    check('drops javascript: href', '<a href="javascript:alert(1)">x</a>', `<a ${NEW_TAB}>x</a>`);
    check('drops padded javascript: href', '<a href=" javascript:alert(1)">x</a>', `<a ${NEW_TAB}>x</a>`);
    check('drops data: href', '<a href="data:text/html,<script>1</script>">x</a>', `<a ${NEW_TAB}>x</a>`);
    check('drops event handlers and page target', '<a href="https://e.com" onclick="x()" target="_self">x</a>', `<a href="https://e.com" ${NEW_TAB}>x</a>`);
    check('drops script with its content', '<script>alert(1)</script>ok', 'ok');
    check('drops style that fetches', '<blockquote style="background: url(https://e.com/t)">q</blockquote>', '<blockquote>q</blockquote>');
    check('unwraps unknown tags', '<h1 onclick="x()">t</h1>', 't');

    const failed = results.filter(r => !r.ok);
    document.getElementById('summary').textContent = failed.length ? `${failed.length} failed` : `all ${results.length} passed`;
    document.getElementById('results').innerHTML = results
        .map(r => `<li>${r.ok ? 'PASS' : 'FAIL'}: ${MarquisHtml.esc(r.name)}${r.ok ? '' : ` (got ${MarquisHtml.esc(r.detail)})`}</li>`).join('');
})();
