# Marquis of Meow'An

A Chrome extension (Manifest V3) that gathers everyday productivity, web-development and media tools
into one popup, plus an optional floating dock that sits on any web page.

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

## Install (unpacked)

There is no build step: the repository is the extension.

1. Clone or download this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the repository folder.
4. Pin Marquis from the extensions menu and click its icon to open the hub.

After changing `background.js` or `manifest.json`, click the reload button on the extension's card.

## Store packages (Chrome and Firefox)

```
node tools/build.js            # both targets (Node 22+, no dependencies)
node tools/build.js firefox    # one target: chrome | firefox
npx web-ext lint -s dist/firefox
```

Output goes to `dist/` (gitignored): `dist/chrome/` and `dist/firefox/` are loadable unpacked builds, and
`dist/marquis-<target>-<version>.zip` is the store upload (same input, byte-identical zip).
Both builds share every file. The Firefox build swaps in `platform/firefox/manifest.json` (event-page background,
gecko id, data-collection declaration) and takes its `version` from the root `manifest.json`. Copy any new
permission, web-accessible file or content script into it as well; the build stops if `background.js` imports a
file that the Firefox manifest does not list. To try it: `about:debugging` > This Firefox > Load Temporary Add-on >
`dist/firefox/manifest.json`.

## Project layout

| Path | What it is |
|---|---|
| `manifest.json` | Extension manifest (permissions, popup, service worker, content script) |
| `Marquis.html`, `script.js` | The popup hub: tool registry, Home, navigation, settings |
| `background.js` | Service worker: captures, focus blocking, alarms, workspaces, dock injection |
| `scripts/` | One script per tool, shared modules (`mq_float.js` menus, `safe_html.js`, stores), the dock (`inject_dock.js`) and vendor libraries |
| `styles/main.css` | Design system and theme tokens (on top of Bootstrap) |
| `*_fullscreen.html`, `bulk_url_tools.html`, `diffWindow.html`, `preview.html`, `recorder.html`, `simulator.html` | Full-screen tool pages |
| `blocked.html` | Page shown for sites blocked during a focus session |
| `img/` | Logo and artwork |
| `tests/` | Self-test pages |
| `platform/firefox/` | Firefox-only manifest and event-page shim (used by the Firefox build) |
| `tools/build.js` | Builds `dist/chrome`, `dist/firefox` and the store zips |

## Tests

Open the files in `tests/` directly in Chrome (`file://`); each page runs its checks and shows a
pass/fail summary:

- `tests/mq_float.selftest.html`: floating menus and custom selects
- `tests/safe_html.selftest.html`: HTML escaping and sanitizing
- `tests/meet_attendance.selftest.html`: Google Meet participant extraction

## Permissions

| Permission | Used for |
|---|---|
| `<all_urls>`, `tabs`, `scripting`, `activeTab` | Page tools (SEO, QA, highlighter, CSS inspector, capture) and the floating dock |
| `storage`, `unlimitedStorage` | Settings, boards, notes and workspaces; captures and recordings in IndexedDB |
| `tabGroups`, `windows` | Workspace Manager |
| `declarativeNetRequest` | Focus Mode site blocking and the Device Simulator |
| `alarms`, `notifications` | Focus timer, Kanban reminders, Keep Awake timer |
| `power`, `offscreen` | Keep Awake |
| `webNavigation` | Device Simulator (frame list) |
| `geolocation` | Weather "use my location" |
| `clipboardRead`, `clipboardWrite` | Paste into Bulk URL and the toolkit; copy results |

## Privacy

Marquis has no server of its own and no analytics. Data stays in the browser (theme, weather unit and
license key also follow Chrome Sync), except where a tool needs an outside service (weather, OCR,
dictionary, PageSpeed, license check, feedback) and a small connection check behind the header's network
indicator. The full list, with what each service receives, is in [PRIVACY.md](PRIVACY.md) (also shown in
the popup footer → Privacy Policy).

## Third-party software

Bundled libraries and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

This repository does not include a license yet, so default copyright applies: all rights reserved by
the author.
