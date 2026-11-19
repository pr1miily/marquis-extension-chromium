(function() {
    // 🟢 Attach globally so script.js can trigger it instantly on button click
    window.applyMarquisTheme = function(theme) {
        const isLight = (theme === 'light');
        document.documentElement.setAttribute('data-bs-theme', isLight ? 'light' : 'dark');
        document.documentElement.setAttribute('data-marquis-theme', theme);
        // The dock reads sync.marquis_theme itself; nothing to mirror.
    };

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        // Fetch saved theme on boot
        chrome.storage.sync.get(['marquis_theme'], (res) => {
            window.applyMarquisTheme(res.marquis_theme || 'default');
        });
        
        // Listen for live changes across tabs
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && changes.marquis_theme) {
                window.applyMarquisTheme(changes.marquis_theme.newValue || 'default');
            }
        });
    } else {
        // Failsafe for local testing
        window.applyMarquisTheme('default');
    }
})();