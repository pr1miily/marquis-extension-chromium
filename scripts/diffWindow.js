document.addEventListener('DOMContentLoaded', function() {
    // 🟢 NEW: Legally bind the close button
    const closeBtn = document.getElementById('closeStudioBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => window.close());
    }

    const originalEl = document.getElementById('originalResult');
    const changedEl = document.getElementById('changedResult');

    // 2. Retrieve Data Asynchronously via chrome.storage
    chrome.storage.local.get(['diffOriginal', 'diffModified'], (res) => {
        const original = res.diffOriginal || '';
        const modified = res.diffModified || '';
        
        // 3. Calculate Diff (Wait for lib)
        if (typeof diff_match_patch === 'undefined') {
            console.error("Diff library not loaded in window.");
            originalEl.textContent = "A tragic error: The necessary library is missing from my archives.";
            return;
        }

        const dmp = new diff_match_patch();
        const diffs = dmp.diff_main(original, modified);
        dmp.diff_cleanupSemantic(diffs);
        
        // 4. Render
        diffs.forEach(([change, text]) => {
            const span1 = document.createElement('span');
            const span2 = document.createElement('span');
            
            span1.textContent = text;
            span2.textContent = text;
            
            if (change === 1) { // Insert
                span2.className = 'diff-added';
                changedEl.appendChild(span2);
            } else if (change === -1) { // Delete
                span1.className = 'diff-removed';
                originalEl.appendChild(span1);
            } else { // Equal
                originalEl.appendChild(span1);
                changedEl.appendChild(span2);
            }
        });

        // 5. Sync Scroll
        originalEl.addEventListener('scroll', () => changedEl.scrollTop = originalEl.scrollTop);
        changedEl.addEventListener('scroll', () => originalEl.scrollTop = changedEl.scrollTop);
    });
});