# Marquis of Meow'An: Privacy Policy

_Effective: November 19, 2026._ This is the same policy shown inside the extension (popup footer → Privacy Policy).

## 1. The Marquis's Vow of Discretion

Your data is yours alone. The Marquis works inside your browser and has no server of its own. It does not
collect your browsing history or your tool data. A few tools need an outside service to do their job; each is
listed below with exactly what it receives.

## 2. Where Your Data Lives

Workspaces, kanban boards, notes, tasks, favorites, palettes and settings are kept in your browser's extension
storage (`chrome.storage.local`). Screenshots and screen recordings are kept in the extension's own database on
this device (IndexedDB). Your theme, weather unit and license key are kept in `chrome.storage.sync`, so Chrome
Sync copies them to your Google account when sync for extensions is on. Uninstalling the extension deletes its
local data.

## 3. Third-Party Couriers

These services are contacted only when you use the tool named, except the network indicator:

- **Weather**: *open-meteo.com* receives the city you search or, if you choose GPS, your coordinates. The radar
  map loads from *windy.com* with those coordinates.
- **Text Extractor**: *ocr.space* receives the image or PDF you choose to read.
- **Dictionary**: *dictionaryapi.dev* and *datamuse.com* receive the word you look up or type.
- **Device Simulator**: Google PageSpeed Insights receives the page address you analyze (with your own API key,
  if you add one).
- **SEO Audit**: Google's favicon service receives the domain of the page you audit.
- **License**: *gumroad.com* receives your license key when you activate or re-check it.
- **Feedback**: *web3forms.com* receives your message, your email if you give it, your browser's user agent and
  the extension version.
- **Support**: the *ko-fi.com* page loads only when you open "A bowl of milk?".
- **Network indicator**: while the popup is open it sends a small request to Cloudflare (*1.1.1.1*) every few
  seconds to measure your connection. No data of yours is included.

Tools that read a web page (SEO, QA, highlighter, Meet attendance) do that work inside your browser.
After uninstalling, Chrome opens a short feedback page.

## 4. Analytics & Tracking

The Marquis employs no hidden trackers, no analytics engines, and no telemetry. Your workflow remains entirely
undisturbed and unmonitored.

## Contact

Questions about this policy: use the feedback form in the extension (Suggestions).
