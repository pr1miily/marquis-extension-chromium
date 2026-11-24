function initHighlighter() {
    
    // --- UI Refs ---
    const termInput = document.getElementById('hlTermInput');
    const addBtn = document.getElementById('hlAddBtn');
    const clearAllBtn = document.getElementById('hlClearAllBtn');
    const container = document.getElementById('hlCardContainer');
    const emptyState = document.getElementById('hlEmptyState');
    const menuSelector = document.getElementById('menuSelector');
    const checkCase = document.getElementById('hlCaseSensitive');
    const checkWhole = document.getElementById('hlWholeWord');
    
    // Nav & Context Refs
    const navBar = document.getElementById('hlNavBar');
    const totalBadge = document.getElementById('hlTotalBadge');
    const btnNext = document.getElementById('hlGlobalNext');
    const btnPrev = document.getElementById('hlGlobalPrev');
    const contextCard = document.getElementById('hlContextCard');
    const contextText = document.getElementById('hlContextText');

    let activeTerms = []; 
    const PALETTE = [
        '#fef08a', '#7dd3fc', '#86efac', '#67e8f9', 
        '#fdba74', '#fca5a5', '#d8b4fe', '#cbd5e1'
    ];

    // 🟢 SECURITY GATEKEEPER
    const isRestrictedUrl = (url) => {
        if (!url) return true;
        const prefixes = ['chrome://', 'edge://', 'about:', 'chrome-extension://'];
        const domains = ['chrome.google.com/webstore', 'chromewebstore.google.com'];
        return prefixes.some(p => url.startsWith(p)) || domains.some(d => url.includes(d));
    };

    // --- INITIALIZATION ---
    if (menuSelector) {
        menuSelector.addEventListener('change', () => {
            if (menuSelector.value !== 'highlighterSection') return;
            syncFromPage();
            setTimeout(() => termInput.focus(), 100);
        });
        // First open: init runs after the 'change' that opened this section, so that listener missed it.
        if (menuSelector.value === 'highlighterSection') { syncFromPage(); setTimeout(() => termInput.focus(), 100); }
    }

    if (termInput) {
        termInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addCurrentTerm(); }
        });
    }

    if (addBtn) addBtn.addEventListener('click', addCurrentTerm);
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
            activeTerms = [];
            renderUI();
            updatePage();
            hideContext();
        });
    }

    if (checkCase) checkCase.addEventListener('change', updatePage);
    if (checkWhole) checkWhole.addEventListener('change', updatePage);
    
    // Global Navigation
    if(btnNext) btnNext.addEventListener('click', () => navigateGlobal(1));
    if(btnPrev) btnPrev.addEventListener('click', () => navigateGlobal(-1));

    // --- CORE FUNCTIONS ---

    function addCurrentTerm() {
        const val = termInput.value.trim();
        if (!val) return;
        const newTerms = val.split(',').map(t => t.trim()).filter(t => t);
        newTerms.forEach(term => {
            if (!activeTerms.includes(term)) activeTerms.push(term);
        });
        termInput.value = '';
        renderUI();
        updatePage();
    }

    function removeTerm(term) {
        activeTerms = activeTerms.filter(t => t !== term);
        renderUI();
        updatePage();
        hideContext();
    }

    function renderUI() {
        container.innerHTML = '';
        
        if (activeTerms.length === 0) {
            container.appendChild(emptyState);
            navBar.classList.add('d-none');
            return;
        } else {
            navBar.classList.remove('d-none');
        }

        activeTerms.forEach((term, index) => {
            const color = PALETTE[index % PALETTE.length];
            
            const chip = document.createElement('div');
            chip.className = 'hl-chip animate__animated animate__fadeIn';
            chip.style.backgroundColor = color;
            chip.style.animationDuration = '0.3s';
            
            chip.innerHTML = `
                <span>${MarquisHtml.esc(term)}</span>
                <span class="badge-count" id="count-${index}">0</span>
                <button class="hl-chip-close">
                    <i class="bi bi-x"></i>
                </button>
            `;

            chip.addEventListener('click', (e) => {
                if(e.target.closest('.hl-chip-close')) return;
                jumpToSpecific(term);
            });

            const delBtn = chip.querySelector('.hl-chip-close');
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeTerm(term);
            });

            container.appendChild(chip);
        });
    }

    // The keyword list lives with the page (window.__marquisHl in the extension's world on that tab, set by
    // injectHighlighter), so the popup rebuilds it on every open instead of starting empty. Same scope as the
    // highlights themselves: per tab, until the page reloads. A user edit made while this runs wins.
    let editSeq = 0;
    async function syncFromPage() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const seq = editSeq; // read after the first await: the first-open call runs before init declares editSeq
            if (!tab || isRestrictedUrl(tab.url || '')) return;
            const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readHighlightState });
            const state = res?.result;
            if (!state || seq !== editSeq) return;
            activeTerms = [...state.terms];
            checkCase.checked = !!state.caseSensitive;
            checkWhole.checked = !!state.wholeWord;
            renderUI();
            totalBadge.innerText = `${state.total} Matches`;
            activeTerms.forEach((term, index) => {
                const badge = document.getElementById(`count-${index}`);
                if (badge) badge.innerText = state.counts?.[term] || 0;
            });
        } catch { /* page not scriptable or closed: keep the current list */ }
    }

    async function updatePage() {
        editSeq++;
        const caseSensitive = checkCase.checked;
        const wholeWord = checkWhole.checked;

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // 🟢 PRE-FLIGHT SECURITY CHECK
        if (isRestrictedUrl(tab.url)) {
            window.showGlobalAlert("Domain Secured", "My highlighters are utterly useless against the defenses of Chrome system pages.", "error");
            return;
        }

        if (activeTerms.length === 0) {
            chrome.scripting.executeScript({ target: { tabId: tab.id }, func: clearHighlights }).catch(err => console.log(err));
            totalBadge.innerText = "0 Matches";
            return;
        }

        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: injectHighlighter,
            args: [activeTerms, PALETTE, caseSensitive, wholeWord]
        }, (results) => {
            if (chrome.runtime.lastError || !results || !results[0]) {
                console.warn("Highlighter failed to run on page.");
                return;
            }
            const data = results[0].result; 
            
            totalBadge.innerText = `${data.total} Matches`;
            activeTerms.forEach((term, index) => {
                const badge = document.getElementById(`count-${index}`);
                if (badge) badge.innerText = data.counts[term] || 0;
            });
        });
    }

    function jumpToSpecific(term) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if(!tabs[0] || isRestrictedUrl(tabs[0].url)) return;
            
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: focusTermInPage,
                args: [term]
            }, (results) => {
                // Update Context Card with returned text
                if (results && results[0] && results[0].result) {
                    showContext(results[0].result);
                }
            });
        });
    }

    function navigateGlobal(dir) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if(!tabs[0] || isRestrictedUrl(tabs[0].url)) return;

            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: focusGlobalInPage,
                args: [dir]
            }, (results) => {
                if (results && results[0] && results[0].result) {
                    showContext(results[0].result);
                }
            });
        });
    }

    // --- UI HELPERS ---
    function showContext(text) {
        if (!text) return;
        // Simple sanitization
        const safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;")
                             .replace(/\[HIGHLIGHT\]/g, '<strong style="color:#d63384; background:#f0f0f0; padding:0 4px; border-radius:3px;">')
                             .replace(/\[\/HIGHLIGHT\]/g, '</strong>');
        
        contextText.innerHTML = safeText;
        contextCard.classList.remove('d-none');
    }

    function hideContext() {
        contextCard.classList.add('d-none');
        contextText.innerHTML = "";
    }

    // --- INJECTED FUNCTIONS (Run in Page) ---

    function clearHighlights() {
        document.querySelectorAll('mark.odh-highlight').forEach(m => m.outerHTML = m.innerHTML);
        document.normalize();
        window.odhNavIndex = -1;
        window.__marquisHl = null;
    }

    // Injected: the keyword state recorded with the page, and how many highlights are on it now.
    function readHighlightState() {
        const s = window.__marquisHl;
        return s ? { ...s, total: document.querySelectorAll('mark.odh-highlight').length } : null;
    }

    function injectHighlighter(terms, palette, caseSensitive, wholeWord) {
        document.querySelectorAll('mark.odh-highlight').forEach(m => m.outerHTML = m.innerHTML);
        document.normalize();

        const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sortedTerms = [...terms].sort((a, b) => b.length - a.length);
        
        const patternParts = sortedTerms.map(t => {
            const esc = escapeRegExp(t);
            return wholeWord ? `\\b${esc}\\b` : esc;
        });
        
        const flags = caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(`(${patternParts.join('|')})`, flags);

        let total = 0;
        let counts = {};
        terms.forEach(t => counts[t] = 0);

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let nodesToReplace = [];

        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (['SCRIPT', 'STYLE', 'MARK', 'TEXTAREA', 'INPUT'].includes(node.parentElement.tagName) || 
                node.parentElement.isContentEditable) continue;

            if (regex.test(node.nodeValue)) nodesToReplace.push(node);
        }

        nodesToReplace.forEach(node => {
            const fragment = document.createDocumentFragment();
            const text = node.nodeValue;
            let lastIdx = 0;
            let match;
            regex.lastIndex = 0; 

            while ((match = regex.exec(text)) !== null) {
                fragment.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));

                const mark = document.createElement('mark');
                mark.className = 'odh-highlight';
                mark.textContent = match[0];
                
                const matchedText = match[0];
                const termKey = terms.find(t => 
                    caseSensitive ? t === matchedText : t.toLowerCase() === matchedText.toLowerCase()
                );
                
                if (termKey) {
                    const idx = terms.indexOf(termKey);
                    mark.style.backgroundColor = palette[idx % palette.length];
                    mark.dataset.term = termKey; 
                    counts[termKey]++;
                } else {
                    mark.style.backgroundColor = '#ffff00';
                }
                
                mark.style.color = '#222';
                mark.style.borderRadius = '3px';
                mark.style.padding = '0 2px';
                mark.style.boxShadow = '0 1px 2px rgba(0,0,0,0.1)';

                fragment.appendChild(mark);
                lastIdx = regex.lastIndex;
                total++;
            }
            fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
            node.parentNode.replaceChild(fragment, node);
        });

        window.odhNavIndex = -1;
        if(!window.odhTermNav) window.odhTermNav = {};

        window.__marquisHl = { terms, caseSensitive, wholeWord, counts, total }; // read back by readHighlightState
        return { total, counts };
    }

    function focusTermInPage(term) {
        if(!window.odhTermNav) window.odhTermNav = {};
        if(typeof window.odhTermNav[term] === 'undefined') window.odhTermNav[term] = -1;

        const marks = Array.from(document.querySelectorAll(`mark.odh-highlight`))
                           .filter(m => m.dataset.term === term);

        if (marks.length === 0) return null;

        const prevIdx = window.odhTermNav[term];
        if (prevIdx >= 0 && marks[prevIdx]) {
            marks[prevIdx].style.outline = 'none';
            marks[prevIdx].style.zIndex = 'auto';
        }

        let nextIdx = prevIdx + 1;
        if (nextIdx >= marks.length) nextIdx = 0;
        window.odhTermNav[term] = nextIdx;

        const target = marks[nextIdx];
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.style.outline = '3px solid #dc3545';
        target.style.zIndex = '9999';
        target.style.position = 'relative';

        // --- INLINE EXTRACTION LOGIC ---
        const range = 60;
        const textContent = target.parentElement.textContent || "";
        const fullText = textContent.replace(/\s+/g, ' ').trim();
        const termTxt = target.textContent;
        
        // Find best match in full text
        const idx = fullText.indexOf(termTxt);
        if (idx === -1) return fullText.substring(0, 100) + "..."; // Fallback

        const start = Math.max(0, idx - range);
        const end = Math.min(fullText.length, idx + termTxt.length + range);
        
        let snippet = fullText.substring(start, end);
        if (start > 0) snippet = "..." + snippet;
        if (end < fullText.length) snippet = snippet + "...";
        
        // Mark the term for highlighting in popup (using placeholders)
        return snippet.replace(termTxt, `[HIGHLIGHT]${termTxt}[/HIGHLIGHT]`);
    }

    function focusGlobalInPage(dir) {
        const marks = document.querySelectorAll('mark.odh-highlight');
        if (marks.length === 0) return null;

        if (typeof window.odhNavIndex === 'undefined') window.odhNavIndex = -1;

        if (window.odhNavIndex >= 0 && marks[window.odhNavIndex]) {
            marks[window.odhNavIndex].style.outline = 'none';
            marks[window.odhNavIndex].style.zIndex = 'auto';
        }

        window.odhNavIndex += dir;
        if (window.odhNavIndex >= marks.length) window.odhNavIndex = 0;
        if (window.odhNavIndex < 0) window.odhNavIndex = marks.length - 1;

        const target = marks[window.odhNavIndex];
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.style.outline = '4px solid #0d6efd';
        target.style.zIndex = '9999';
        target.style.position = 'relative';

        // --- INLINE EXTRACTION LOGIC ---
        const range = 60;
        const textContent = target.parentElement.textContent || "";
        const fullText = textContent.replace(/\s+/g, ' ').trim();
        const termTxt = target.textContent;
        
        const idx = fullText.indexOf(termTxt);
        if (idx === -1) return fullText.substring(0, 100) + "...";

        const start = Math.max(0, idx - range);
        const end = Math.min(fullText.length, idx + termTxt.length + range);
        
        let snippet = fullText.substring(start, end);
        if (start > 0) snippet = "..." + snippet;
        if (end < fullText.length) snippet = snippet + "...";
        
        return snippet.replace(termTxt, `[HIGHLIGHT]${termTxt}[/HIGHLIGHT]`);
    }
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'highlighterSection') initHighlighter();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('hlTermInput')) initHighlighter();
});