function initDictionary() {
    const searchInput = document.getElementById('dictSearchInput');
    const searchBtn = document.getElementById('dictSearchBtn');
    const suggestionsBox = document.getElementById('dictSuggestions'); // 🟢 NEW
    
    const loadingUI = document.getElementById('dictLoading');
    const errorUI = document.getElementById('dictError');
    const errorTitle = document.getElementById('dictErrorTitle');
    const errorMsg = document.getElementById('dictErrorMsg');
    
    const resultsUI = document.getElementById('dictResults');
    const wordDisplay = document.getElementById('dictWord');
    const phoneticDisplay = document.getElementById('dictPhonetic');
    const audioBtn = document.getElementById('dictAudioBtn');
    const meaningsContainer = document.getElementById('dictMeanings');

    let currentAudio = null;
    let suggestTimeout;

    // --- 1. AUTO-SUGGEST (Partial Matches) ---
    searchInput.addEventListener('input', (e) => {
        clearTimeout(suggestTimeout);
        const query = e.target.value.trim();
        
        if (query.length < 2) {
            suggestionsBox.classList.add('d-none');
            return;
        }

        // Wait 300ms after user stops typing before fetching to save bandwidth
        suggestTimeout = setTimeout(() => fetchSuggestions(query), 300);
    });

    async function fetchSuggestions(query) {
        try {
            // 🟢 REVERTED: Hardcoded back to English Datamuse
            const sugUrl = `https://api.datamuse.com/sug?s=${encodeURIComponent(query)}`;
            const res = await fetch(sugUrl);
            const data = await res.json();
            
            suggestionsBox.innerHTML = '';
            
            if (data.length === 0) {
                suggestionsBox.classList.add('d-none');
                return;
            }

            // Render up to 8 suggestions
            data.slice(0, 8).forEach(item => {
                const btn = document.createElement('button');
                btn.className = "list-group-item list-group-item-action small bg-body text-start fw-medium text-body";
                
                // Highlight the matching part of the word
                const regex = new RegExp(`^(${query})`, "i");
                const highlightedWord = item.word.replace(regex, `<span class="text-primary fw-bold">$1</span>`);
                btn.innerHTML = highlightedWord;

                btn.addEventListener('click', () => {
                    searchInput.value = item.word;
                    suggestionsBox.classList.add('d-none');
                    fetchDictionary(item.word); // Trigger full search
                });
                suggestionsBox.appendChild(btn);
            });
            
            suggestionsBox.classList.remove('d-none');

        } catch(e) {
            console.error("Suggestion API Error:", e);
        }
    }

    // Close suggestions if clicked outside
    document.addEventListener('click', (e) => {
        if (!suggestionsBox.contains(e.target) && e.target !== searchInput) {
            suggestionsBox.classList.add('d-none');
        }
    });

    // --- 2. MAIN DICTIONARY SEARCH ---
    searchBtn.addEventListener('click', () => {
        const query = searchInput.value.trim();
        if (query) {
            suggestionsBox.classList.add('d-none');
            fetchDictionary(query);
        }
    });

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = searchInput.value.trim();
            if (query) {
                suggestionsBox.classList.add('d-none');
                fetchDictionary(query);
            }
        }
    });

    audioBtn.addEventListener('click', () => {
        if (currentAudio) currentAudio.play();
    });

    async function fetchDictionary(word) {
        // UI Reset
        resultsUI.classList.add('d-none');
        errorUI.classList.add('d-none');
        loadingUI.classList.remove('d-none');
        audioBtn.classList.add('d-none');
        currentAudio = null;

        try {
            // 🟢 REVERTED: Hardcoded back to English Free Dictionary
            const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
            const data = await response.json();

            loadingUI.classList.add('d-none');

            if (!response.ok) {
                showError(data.title || "Word Absent", data.message || "The Marquis's archives hold no record for that particular word.");
                return;
            }

            renderResults(data[0]);

        } catch (error) {
            loadingUI.classList.add('d-none');
            showError("Network Interrupted", "Pray, check your connection and summon me again.");
        }
    }

    // --- 3. RENDER LOGIC ---
    function renderResults(data) {
        wordDisplay.textContent = data.word;
        
        // Find phonetic text
        const phoneticText = data.phonetic || (data.phonetics.find(p => p.text) || {}).text || '';
        phoneticDisplay.textContent = phoneticText || 'N/A';

        // Find audio
        const audioObj = data.phonetics.find(p => p.audio && p.audio.length > 0);
        if (audioObj) {
            // 🟢 FIXED: Ensure the URL has https:// so the browser doesn't try to look in local files!
            const safeAudioUrl = audioObj.audio.startsWith('//') ? 'https:' + audioObj.audio : audioObj.audio;
            currentAudio = new Audio(safeAudioUrl);
            audioBtn.classList.remove('d-none');
        } else {
            audioBtn.classList.add('d-none');
        }

        // 🟢 Show/Hide the Pronunciation Block dynamically
        const pronunBlock = document.getElementById('dictPronunciationBlock');
        if (phoneticText || audioObj) {
            pronunBlock.classList.remove('d-none');
        } else {
            pronunBlock.classList.add('d-none');
        }

        meaningsContainer.innerHTML = ''; 

        data.meanings.forEach(meaning => {
            const partOfSpeech = meaning.partOfSpeech;
            
            // Build definitions
            let defHtml = '<ul class="list-group list-group-flush mb-2">';
            meaning.definitions.forEach((def, index) => {
                const exampleHtml = def.example ? `<div class="text-muted small fst-italic mt-1">"${MarquisHtml.esc(def.example)}"</div>` : '';
                defHtml += `
                    <li class="list-group-item bg-transparent px-0 py-2 border-secondary-subtle">
                        <div class="d-flex">
                            <span class="text-secondary fw-bold me-2">${index + 1}.</span>
                            <div>
                                <span class="text-body">${MarquisHtml.esc(def.definition)}</span>
                                ${exampleHtml}
                            </div>
                        </div>
                    </li>
                `;
            });
            defHtml += '</ul>';

            // Build Synonyms / Antonyms
            let synAntHtml = '';
            if (meaning.synonyms && meaning.synonyms.length > 0) {
                const synBadges = meaning.synonyms.map(syn => 
                    `<span class="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 dict-chip" style="cursor: pointer; transition: 0.2s;" data-word="${MarquisHtml.esc(syn)}">${MarquisHtml.esc(syn)}</span>`
                ).join(' ');
                synAntHtml += `<div class="mb-2"><span class="small fw-bold text-secondary me-2">Synonyms:</span> ${synBadges}</div>`;
            }

            if (meaning.antonyms && meaning.antonyms.length > 0) {
                const antBadges = meaning.antonyms.map(ant => 
                    `<span class="badge bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25 dict-chip" style="cursor: pointer; transition: 0.2s;" data-word="${MarquisHtml.esc(ant)}">${MarquisHtml.esc(ant)}</span>`
                ).join(' ');
                synAntHtml += `<div><span class="small fw-bold text-secondary me-2">Antonyms:</span> ${antBadges}</div>`;
            }

            const block = document.createElement('div');
            block.className = "bg-body-tertiary p-3 rounded border border-secondary-subtle shadow-sm";
            block.innerHTML = `
                <h6 class="fw-bold text-success fst-italic border-bottom border-secondary-subtle pb-2 mb-2">${MarquisHtml.esc(partOfSpeech)}</h6>
                ${defHtml}
                ${synAntHtml}
            `;
            meaningsContainer.appendChild(block);
        });

        // Add click listeners to synonym/antonym chips
        document.querySelectorAll('.dict-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                const newWord = e.target.getAttribute('data-word');
                searchInput.value = newWord;
                fetchDictionary(newWord);
            });
            chip.addEventListener('mouseenter', (e) => e.target.classList.add('shadow-sm', 'bg-opacity-25'));
            chip.addEventListener('mouseleave', (e) => e.target.classList.remove('shadow-sm', 'bg-opacity-25'));
        });

        resultsUI.classList.remove('d-none');
    }

    function showError(title, msg) {
        errorTitle.textContent = title;
        errorMsg.textContent = msg;
        errorUI.classList.remove('d-none');
    }
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'dictionarySection') initDictionary();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('dictSearchInput')) initDictionary();
});