// Runs inside the Meet tab (chrome.scripting.executeScript func), so it must not use anything outside itself.
// Meet's markup is obfuscated and changes: names come from accessible labels and from plain text nodes,
// never from buttons or icon-font glyphs. Reading whole elements used to glue a tile's "More options"
// button into names like "more_vertMore options for Jane DOE".
function scrapeGoogleMeetParticipants() {
    const SKIP = 'button, [role="button"], i, svg, [aria-hidden="true"], [class*="icon" i]';
    const UI_TEXT = new Set(['people', 'chat', 'activities', 'host controls', 'mute all', 'add people', 'search for people',
        'contributors', 'in the meeting', 'in call', 'you', 'everyone', 'waiting to join', 'meeting host']);
    const clean = (raw) => String(raw || '')
        .replace(/\s+/g, ' ')
        .replace(/^(?:[a-z]+(?:_[a-z]+)+\s*)+/, '')             // icon ligature names: more_vert, mic_off
        .replace(/^more options for\s+/i, '')
        .replace(/\s*\((?:you|presentation|host|meeting host|co-host)\)\s*$/i, '')
        .trim();
    const texts = (root) => {
        const out = [];
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            if (n.parentElement && !n.parentElement.closest(SKIP) && n.nodeValue.trim()) out.push(n.nodeValue);
        }
        return out;
    };
    const names = new Map(); // lower case -> name as shown
    const add = (raw) => {
        const name = clean(raw);
        const key = name.toLowerCase();
        if (name.length < 2 || name.length > 60 || !/\p{L}/u.test(name) || UI_TEXT.has(key) || /present(ation|ing)/i.test(name)) return false;
        if (!names.has(key)) names.set(key, name);
        return true;
    };

    // People sidebar: each person is a listitem whose aria-label is their name.
    document.querySelectorAll('div[role="listitem"]').forEach((el) => {
        if (add(el.getAttribute('aria-label'))) return;
        const img = el.querySelector('img[alt]');
        if (img && add(img.alt)) return;
        texts(el).some(add);
    });
    // Video tiles (people are listed even when the sidebar is closed): the first plain-text label.
    document.querySelectorAll('[data-participant-id]').forEach((tile) => {
        if (add(tile.querySelector('[data-self-name]')?.getAttribute('data-self-name'))) return;
        texts(tile).some(add);
    });

    return [...names.values()].sort((a, b) => a.localeCompare(b));
}

function initMeetAttendance() {
    const scanBtn = document.getElementById('meetScanBtn');
    const resultsArea = document.getElementById('meetResultsArea');
    const participantList = document.getElementById('meetParticipantList');
    const countBadge = document.getElementById('meetCountBadge');
    const downloadCsvBtn = document.getElementById('meetDownloadCsv');
    
    // ✅ FIX: Guard against missing element before accessing .parentNode
    const copyAllBtn = document.createElement('button');
    copyAllBtn.className = "btn btn-sm btn-link text-decoration-none text-primary p-0 fw-bold ms-3";
    copyAllBtn.innerHTML = '<i class="bi bi-clipboard"></i> Copy All';
    if (downloadCsvBtn && downloadCsvBtn.parentNode) {
        downloadCsvBtn.parentNode.appendChild(copyAllBtn);
    }

    let currentParticipants = [];

    // --- 1. DOM SCRAPING LOGIC ---
    scanBtn.addEventListener('click', async () => {
        scanBtn.disabled = true;
        scanBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Scanning...';

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab.url.includes("meet.google.com")) {
                throw new Error("I must point out, this active tab is clearly not a Google Meet window.");
            }

            const injectionResults = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: scrapeGoogleMeetParticipants
            });

            currentParticipants = injectionResults[0].result;

            if (currentParticipants.length === 0) {
                throw new Error("A barren room. I found no names. Pray, ensure the 'People' sidebar is open on the right.");
            }

            renderParticipants();

        } catch (error) {
            window.showGlobalAlert("Observation Thwarted", error.message, "error");
        } finally {
            scanBtn.disabled = false;
            scanBtn.innerHTML = '<i class="bi bi-search me-1"></i> Scan Meeting Tab';
        }
    });


    // --- 2. RENDER LIST ---
    function renderParticipants() {
        participantList.innerHTML = '';
        currentParticipants.forEach(name => {
            const li = document.createElement('li');
            li.className = 'list-group-item bg-transparent px-3 py-2 border-secondary-subtle d-flex justify-content-between align-items-center group-hover';
            li.innerHTML = `
                <div class="text-truncate fw-medium" title="${MarquisHtml.esc(name)}">
                    <i class="bi bi-person-circle text-primary me-3 fs-6"></i><span class="participant-name text-body">${MarquisHtml.esc(name)}</span>
                </div>
            `;
            participantList.appendChild(li);
        });

        countBadge.innerText = `${currentParticipants.length} Participants Found`;
        resultsArea.classList.remove('d-none');
    }

    // --- 3. EXPORTS ---
    // Participant names are chosen by other people: quote every cell, double inner quotes, and prefix a
    // leading = + - @ (or tab/CR) with ' so a spreadsheet does not run the name as a formula.
    function csvCell(value) {
        let s = String(value ?? '');
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return `"${s.replace(/"/g, '""')}"`;
    }

    downloadCsvBtn.addEventListener('click', () => {
        if (currentParticipants.length === 0) return;
        
        const timestamp = new Date().toLocaleTimeString();
        const dateStr = new Date().toLocaleDateString();
        let csvContent = "Name,Date Logged,Time Logged\n";
        
        currentParticipants.forEach(name => {
            csvContent += `${csvCell(name)},${csvCell(dateStr)},${csvCell(timestamp)}\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `Meet_Attendance_${new Date().getTime()}.csv`;
        link.click();
    });

    copyAllBtn.addEventListener('click', () => {
        if (currentParticipants.length === 0) return;
        
        navigator.clipboard.writeText(currentParticipants.join('\n')).then(() => {
            const originalHTML = copyAllBtn.innerHTML;
            copyAllBtn.innerHTML = '<i class="bi bi-check2"></i> Copied!';
            setTimeout(() => { copyAllBtn.innerHTML = originalHTML; }, 2000);
        });
    });
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'meetAttendanceSection') initMeetAttendance();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('meetScanBtn')) initMeetAttendance();
});