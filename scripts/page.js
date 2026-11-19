// ============================================================
// MARQUIS — page.js (DOM Freeze & Absolute Lock Engine)
// ============================================================

if (!window._marquisPageCapturing) {
    window._marquisPageCapturing = true;

    chrome.runtime.onMessage.addListener(function onMessage(data, sender, callback) {
        if (data.msg === 'scrollPage') {
            chrome.runtime.onMessage.removeListener(onMessage);
            startEnterpriseCapture(callback);
            return true;
        }
    });

    async function startEnterpriseCapture(callback) {
        const originalX = window.scrollX;
        const originalY = window.scrollY;

        // 1. FREEZE SCROLLBARS & CSS ANIMATIONS
        const style = document.createElement('style');
        style.id = 'marquis-capture-style';
        style.textContent = `
            ::-webkit-scrollbar { display: none !important; }
            * { 
                scroll-behavior: auto !important; 
                animation-play-state: paused !important;
                transition: none !important;
            }
            html, body {
                height: auto !important;
                overflow: visible !important;
            }
        `;
        document.head.appendChild(style);

        // 2. PRE-SCROLL: Force images to load
        const fullHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        window.scrollTo(0, fullHeight);
        await new Promise(r => setTimeout(r, 600));
        window.scrollTo(0, 0);
        await new Promise(r => setTimeout(r, 300));

        const viewWidth = window.innerWidth;
        const viewHeight = window.innerHeight;
        const fullWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);

        // 3. 🟢 THE DOM FREEZER (YOUR INJECTION METHOD)
        // We find every floating/sticky/fixed element, measure its exact coordinates,
        // and nail it to the page permanently. This stops JS libraries from moving the watch!
        const lockedElements = [];
        document.querySelectorAll('*').forEach(el => {
            const compStyle = window.getComputedStyle(el);
            if (compStyle.position === 'fixed' || compStyle.position === 'sticky') {
                const rect = el.getBoundingClientRect();
                
                // Only lock headers/footers. If we lock massive full-screen GSAP containers, 
                // the site will collapse. We hide small ones after chunk 0.
                if (rect.height < viewHeight * 0.5 && rect.height > 0) {
                    lockedElements.push({
                        el: el,
                        origVisibility: el.style.visibility
                    });
                }
            }
        });

        // 4. EDGE-TO-EDGE GRID
        const arrangements = [];
        let yPos = 0;
        while (yPos < fullHeight) {
            let xPos = 0;
            while (xPos < fullWidth) {
                arrangements.push([xPos, yPos]);
                xPos += viewWidth;
            }
            yPos += viewHeight; 
        }

        const numArrangements = arrangements.length;
        let isFirstChunk = true;

        function cleanUp() {
            document.getElementById('marquis-capture-style')?.remove();
            lockedElements.forEach(item => { item.el.style.visibility = item.origVisibility; });
            window.scrollTo(originalX, originalY);
            delete window._marquisPageCapturing;
        }

        (function processArrangements() {
            if (!arrangements.length) {
                cleanUp();
                if (callback) callback();
                return;
            }

            const [x, y] = arrangements.shift();
            window.scrollTo(x, y);

            // Hide headers completely using visibility (doesn't break layout like display:none)
            if (!isFirstChunk) {
                lockedElements.forEach(item => { item.el.style.setProperty('visibility', 'hidden', 'important'); });
            }

            // Wait 250ms for the GSAP/Javascript to settle
            setTimeout(() => {
                const data = {
                    msg: 'capture',
                    x: window.scrollX, 
                    y: window.scrollY,
                    complete: (numArrangements - arrangements.length) / numArrangements,
                    windowWidth: viewWidth,
                    windowHeight: viewHeight,
                    totalWidth: fullWidth,
                    totalHeight: fullHeight
                };

                chrome.runtime.sendMessage(data, (captured) => {
                    isFirstChunk = false;
                    if (captured) processArrangements();
                    else { cleanUp(); if (callback) callback(); }
                });
            }, 250); 
        })();
    }
}