// ── Module-level state ────────────────────────────────────────────────────────
// Using module-level (not closure-level) variables fixes the core bug:
// initFavorites() can be called multiple times (DOMContentLoaded + sectionReady),
// but all calls share the SAME favorites array and render functions, so the click
// listener always operates on fresh, current data.
// ─────────────────────────────────────────────────────────────────────────────
const FAV_STORAGE_KEY = 'webAssistantFavorites';
let _favorites = [];
let _favInitDone = false;

// ── One-time delegation listener ─────────────────────────────────────────────
// Attached at script parse time, not inside initFavorites(), so it is
// guaranteed to run only once regardless of how many times init is called.
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.favorite-star');
    if (!btn) return;
    e.stopPropagation();

    const sectionId = btn.dataset.section;
    if (!sectionId) return;

    const index = _favorites.indexOf(sectionId);
    if (index === -1) {
        _favorites.push(sectionId);
    } else {
        _favorites.splice(index, 1);
    }

    chrome.storage.local.set({ [FAV_STORAGE_KEY]: _favorites }, () => {
        _updateFavoriteIcons();
        _announceFavorites();
    });
});

// ── _updateFavoriteIcons ──────────────────────────────────────────────────────
// Queries all .favorite-star currently in the DOM and sets filled/empty state.
// Called whenever favorites change AND whenever a new section renders.
function _updateFavoriteIcons() {
    document.querySelectorAll('.favorite-star').forEach(btn => {
        const sectionId = btn.dataset.section;
        const isFav = _favorites.includes(sectionId);
        btn.innerHTML = isFav
            ? '<i class="bi bi-star-fill text-warning" aria-hidden="true"></i>'
            : '<i class="bi bi-star text-warning" aria-hidden="true"></i>';
        btn.setAttribute('aria-label', 'Favorite');
        btn.setAttribute('aria-pressed', String(isFav));
        btn.title = isFav ? 'Remove from favorites' : 'Add to favorites';
    });
}
// Exported so marquis:sectionReady can call it when new sections stamp into DOM
window.marquisUpdateFavoriteIcons = _updateFavoriteIcons;
// Read-only view for Home, My Favorites and the tools window (script.js draws them as launch tiles).
// Favorites are only changed in this file, which fires marquis:favoritesChanged after loading them
// and after every change.
window.marquisFavorites = () => [..._favorites];
const _announceFavorites = () => document.dispatchEvent(new Event('marquis:favoritesChanged'));

// ── initFavorites ─────────────────────────────────────────────────────────────
function initFavorites() {
    if (_favInitDone) {
        _updateFavoriteIcons();
        return;
    }
    _favInitDone = true;

    chrome.storage.local.get([FAV_STORAGE_KEY], result => {
        _favorites = result[FAV_STORAGE_KEY] || [];
        _updateFavoriteIcons();
        _announceFavorites();
    });
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'favoritesSection') initFavorites();
});

// Refresh star icons whenever ANY section is stamped into the DOM
document.addEventListener('marquis:sectionReady', () => {
    if (_favInitDone) _updateFavoriteIcons();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('menuSelector')) initFavorites();
});