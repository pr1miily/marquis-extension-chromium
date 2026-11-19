// Shared HTML safety helpers for extension pages and content scripts.
//   MarquisHtml.esc(value)      text -> escaped string, for templates that must interpolate text.
//   MarquisHtml.sanitize(html)  rich text written by the note editor -> markup with formatting tags and safe links only.
// Assigned to globalThis instead of declared with const so that injecting it twice does not throw.
globalThis.MarquisHtml = globalThis.MarquisHtml || (() => {
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

    // Tags the note editor's toolbar (execCommand) produces, with the attributes each may keep.
    // Any other element is unwrapped: its text stays, the element and its attributes go.
    const ALLOWED = {
        B: [], STRONG: [], I: [], EM: [], U: [], S: [], STRIKE: [], BR: [], P: [],
        DIV: ['style'], SPAN: ['style'], UL: [], OL: [], LI: ['style'], FONT: ['color', 'size', 'face'],
        BLOCKQUOTE: ['style'], A: ['href']
    };
    // A link keeps only a web or mail target, and always opens in a new tab with no handle back to this page.
    const SAFE_HREF = /^(https?:|mailto:)/i;
    // Removed together with their content: they can run script or load resources.
    const DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED',
        'LINK', 'META', 'BASE', 'TITLE', 'SVG', 'MATH', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'SOURCE', 'FORM']);
    // A style may not fetch anything (url(), image-set(), @import).
    const UNSAFE_STYLE = /url\s*\(|image-set|@import|expression/i;

    function clean(node) {
        for (const child of [...node.childNodes]) {
            if (child.nodeType === 3) continue; // text
            if (child.nodeType !== 1) { child.remove(); continue; } // comments, processing instructions
            const tag = child.tagName.toUpperCase();
            if (DROP.has(tag)) { child.remove(); continue; }
            clean(child);
            const allowed = ALLOWED[tag];
            if (!allowed) { child.replaceWith(...child.childNodes); continue; }
            for (const { name, value } of [...child.attributes]) {
                if (!allowed.includes(name) || (name === 'style' && UNSAFE_STYLE.test(value))) child.removeAttribute(name);
            }
            if (tag === 'A') {
                if (!SAFE_HREF.test(child.getAttribute('href') || '')) child.removeAttribute('href');
                child.setAttribute('target', '_blank');
                child.setAttribute('rel', 'noopener noreferrer');
            }
        }
    }

    // DOMParser documents are inert: nothing in `html` runs or loads while it is cleaned.
    function sanitize(html) {
        const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
        clean(doc.body);
        return doc.body.innerHTML;
    }

    return { esc, sanitize };
})();
