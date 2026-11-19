// ============================================================
// MARQUIS — collage_page.js
// Floating GIF collage + back link for blocked.html and uninstall.html.
// Lives in its own file because the MV3 extension CSP blocks inline <script>
// (and javascript: URLs), which left both pages without their collage.
// ============================================================
(() => {
    const collage = document.getElementById('background-collage');
    if (!collage) return;

    // data-gif-count keeps each page's original set (blocked: 27, uninstall: 28).
    const gifCount = Number(collage.dataset.gifCount) || 28;
    const gifUrls = Array.from({ length: gifCount }, (_, i) => `img/gif${i + 1}.gif`);
    let isInitialized = false;

    function updateCollage() {
        if (!isInitialized) {
            for (let i = 0; i < gifUrls.length; i++) {
                const gif = document.createElement('img');
                gif.className = 'collage-gif';
                gif.alt = '';
                gif.src = gifUrls[i];
                collage.appendChild(gif);
            }
            isInitialized = true;
        }

        const gifs = collage.querySelectorAll('.collage-gif');

        gifs.forEach(gif => {
            const size = 120 + Math.random() * 160;
            gif.style.width = size + 'px';
            gif.style.height = size + 'px';

            const posX = Math.random() * window.innerWidth - (size / 2);
            const posY = Math.random() * window.innerHeight - (size / 2);

            gif.style.left = posX + 'px';
            gif.style.top = posY + 'px';

            const rotation = (Math.random() - 0.5) * 50;
            gif.style.transform = `rotate(${rotation}deg)`;
        });
    }

    window.addEventListener('load', () => {
        updateCollage();
        setInterval(updateCollage, 5000);
    });
    window.addEventListener('resize', updateCollage);

    // blocked.html "I humbly return to work" link
    document.querySelector('[data-action="back"]')?.addEventListener('click', (e) => {
        e.preventDefault();
        history.back();
    });
})();
