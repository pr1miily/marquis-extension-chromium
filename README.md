# Marquis of Meow'An

A browser extension (Manifest V3) for Chromium browsers (Chrome, Edge, Brave, Opera) and Firefox that
gathers everyday productivity, web-development and media tools into one popup, plus an optional floating
dock that sits on any web page. Both browsers run the same code from this one repository.

![Marquis logo](img/46087a1c-4b4d-4a36-a268-1b57cb06908c.png)

## Features

**Home dashboard**: favorites, recently used and most-used tools, tool search, and two navigation
modes (inline picker or a tools window), chosen in Settings.

**Productivity**

- Kanban Board (also as a full-screen board), with due-date reminders
- Workspace Manager: save and restore sets of tabs as named tab groups
- Focus Mode & Site Blocker with a Pomodoro-style timer
- Notes & Tasks with a rich-text editor
- Diff Checker
- Weather Center with radar
- ISO Language Codes, World Time, Dictionary & Thesaurus
- Screen Capture (visible area, full page, region) with an editor, and a Screen Recorder
- Google Meet Auto-Attendance (reads the participant list into a CSV)

**Web & media tools**

- QA Testing Hub and a Device Simulator
- CSS Inspector, SEO Spider & Audit
- Bulk URL Opener
- Developer Toolkit (converters, calculator)
- Text Extractor (OCR and PDF)
- Multi-Highlighter, Design & Color Picker, Web Paint
- Image Compressor, Internet Speed Test

**Look and feel**: nine themes (Default, Glass, Light, OLED, Neon, Dracula, Cyber, Aqua, Ghost)
shared by the popup, the full-screen pages and the dock.

**Floating dock (Command Center)**: quick widgets on any web page. It needs a Marquis license
(sold through Gumroad); everything else works without one.

## Browser support

| Browser | Minimum | Notes |
|---|---|---|
| Chrome, Edge, Brave, Opera (Chromium) | Chromium with Manifest V3 | Every feature |
| Firefox (desktop) | 140 | Same tools; the differences below come from Firefox's APIs |

What works differently in Firefox:

- **Keep Awake**: Firefox gives extensions no way to keep the computer awake, so "Screen On" and
  "System Running" are unavailable (the panel says so). The countdown timer works.
- **Color picker**: Firefox has no EyeDropper. Marquis picks the color from a snapshot of the current tab
  instead, so it cannot pick outside the browser window.
- **Screen Recorder**: WebM only (Firefox cannot record MP4). The camera pop-out needs Firefox 153 or newer.
- **Notifications**: reminders do not stay on screen until dismissed.
- **Feedback form**: browser and version details are sent only if you allow "technical data" for Marquis in
  `about:addons`.

## Install from source

### Chrome, Edge and other Chromium browsers

There is no build step: the repository is the extension.

1. Clone or download this repository.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and select the repository folder.
4. Pin Marquis from the extensions menu and click its icon to open the hub.

After changing `background.js` or `manifest.json`, click the reload button on the extension's card.

### Firefox

Firefox needs its own manifest, so load the Firefox build (Node 22 or newer):

1. Clone or download this repository and run `node tools/build.js firefox`.
2. Open `about:debugging#/runtime/this-firefox` and click **Load Temporary Add-on…**.
3. Select `dist/firefox/manifest.json`.
4. Pin Marquis from the Extensions (puzzle piece) menu and click its icon to open the hub.

A temporary add-on is removed when Firefox closes. After a code change, run the build again and click
**Reload** on the Marquis card in `about:debugging`. A permanent install needs a copy signed by Mozilla
(through addons.mozilla.org).

## Store packages

```
node tools/build.js            # both targets (Node 22+, no dependencies)
node tools/build.js firefox    # one target: chrome | firefox
npx web-ext lint -s dist/firefox
```

Output goes to `dist/` (gitignored): `dist/chrome/` and `dist/firefox/` are loadable unpacked builds, and
`dist/marquis-<target>-<version>.zip` is the store upload (same input, byte-identical zip).

Both builds share every file. The Firefox build swaps in `platform/firefox/manifest.json` (event-page background,
gecko id, data-collection declaration) and takes its `version` from the root `manifest.json`. When you add a
permission, a web-accessible file or a content script to `manifest.json`, add it to the Firefox manifest as well;
the build stops if `background.js` imports a file that the Firefox manifest does not list.

## Project layout

| Path | What it is |
|---|---|
| `manifest.json` | Chromium manifest (permissions, popup, service worker, content script) |
| `Marquis.html`, `script.js` | The popup hub: tool registry, Home, navigation, settings |
| `background.js` | Background script (a service worker in Chromium, an event page in Firefox): captures, focus blocking, alarms, workspaces, dock injection |
| `scripts/` | One script per tool, shared modules (`mq_float.js` menus, `safe_html.js`, stores), the dock (`inject_dock.js`) and vendor libraries |
| `styles/main.css` | Design system and theme tokens (on top of Bootstrap) |
| `*_fullscreen.html`, `bulk_url_tools.html`, `diffWindow.html`, `preview.html`, `recorder.html`, `simulator.html` | Full-screen tool pages |
| `blocked.html` | Page shown for sites blocked during a focus session |
| `img/` | Logo and artwork |
| `tests/` | Self-test pages |
| `platform/firefox/` | Firefox-only manifest and event-page shim (used by the Firefox build) |
| `tools/build.js` | Builds `dist/chrome`, `dist/firefox` and the store zips |

## Tests

Open the `.html` files in `tests/` directly in Chrome or Firefox (`file://`); each page runs its checks and
shows a pass/fail summary:

- `tests/mq_float.selftest.html`: floating menus and custom selects
- `tests/safe_html.selftest.html`: HTML escaping and sanitizing
- `tests/meet_attendance.selftest.html`: Google Meet participant extraction

The `.js` self-tests run in Node: `node tests/background.selftest.js`, `node tests/url_list.selftest.js` and
`node tests/seo_crawler.selftest.js`.

## Permissions

| Permission | Used for |
|---|---|
| `<all_urls>`, `tabs`, `scripting`, `activeTab` | Page tools (SEO, QA, highlighter, CSS inspector, capture) and the floating dock |
| `storage`, `unlimitedStorage` | Settings, boards, notes and workspaces; captures and recordings in IndexedDB |
| `tabGroups`, `windows` | Workspace Manager |
| `declarativeNetRequest` | Focus Mode site blocking and the Device Simulator |
| `alarms`, `notifications` | Focus timer, Kanban reminders, Keep Awake timer |
| `power`, `offscreen` | Keep Awake (Chromium only) |
| `webNavigation` | Device Simulator (frame list) |
| `geolocation` | Weather "use my location" |
| `clipboardRead`, `clipboardWrite` | Paste into Bulk URL and the toolkit; copy results |

The Firefox build asks for the same permissions except `power`, `offscreen` and `windows`, which Firefox does
not have. It also declares the data Marquis sends to outside services (Firefox shows this when you install):
the license key, feedback text and email, weather location, OCR images, dictionary words, site domains for
favicons and PageSpeed. Browser and version details for feedback are optional.

## Privacy

Marquis has no server of its own and no analytics. Data stays in the browser (theme, weather unit and
license key also follow Chrome Sync or Firefox Sync), except where a tool needs an outside service (weather, OCR,
dictionary, PageSpeed, license check, feedback) and a small connection check behind the header's network
indicator. The full list, with what each service receives, is in [PRIVACY.md](PRIVACY.md) (also shown in
the popup footer → Privacy Policy).

## Third-party software

Bundled libraries and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

This repository does not include a license yet, so default copyright applies: all rights reserved by
the author.
