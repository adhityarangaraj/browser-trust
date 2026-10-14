# BrowserTrust

A Chrome (Manifest V3) extension that will show users what websites do with the access they have: what was touched, what happened to it, and where it went. It is a standalone product and does not depend on or integrate with any other extension.

**Status: Phase 1 (foundation). The extension records and detects nothing yet.** See [Current status](#current-status).

## Stack

| Choice | Why |
| --- | --- |
| TypeScript (strict) | A shared event schema and message types are checked at compile time across the service worker, content script and popup. |
| esbuild | Fast, one small build script (`scripts/build.mjs`), no framework or plugin ecosystem. |
| Vitest | Tests the browser-independent core (schema, store, access rules, analysis) in plain Node. |
| No UI framework, no backend | The popup is plain DOM. Everything runs locally in the browser. |

Dependencies are dev-only (`typescript`, `esbuild`, `vitest`, `@types/chrome`); the built extension ships no third-party runtime code.

## Prerequisites

- Node.js 20 or newer and npm
- Chrome or another Chromium browser, version 111 or newer

## Build and load

```bash
npm install        # installs from package-lock.json
npm run build      # bundles the extension into dist/
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run check      # typecheck + test + build
npm run watch      # rebuild on change (manifest and popup.html/css are copied once; rebuild after editing them)
npm run clean      # removes dist/
```

Load the extension:

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the `dist/` folder.
4. After rebuilding, click the reload icon on the BrowserTrust card.

## Permissions

| Permission | Kind | Used for |
| --- | --- | --- |
| `storage` | required | Settings and the local event store (`chrome.storage.local`). |
| `scripting` | required | Registering the content script on origins the user has granted. |
| `activeTab` | required | Reading the current tab's URL in the popup. |
| `webRequest` | optional | Reserved for the network metadata collector (not requested in Phase 1). |
| `http://*/*`, `https://*/*` | optional host permissions | Site access, requested at runtime from the popup. |

Nothing is injected anywhere until the user grants access. No host permissions are granted at install time.

### Optional host permissions vs. all websites

BrowserTrust declares host access as **optional** and asks for it from the popup, either for the current site or for all websites.

| | Per-site (optional) grants | All websites up front |
| --- | --- | --- |
| Privacy and trust | The user decides where BrowserTrust runs. The install prompt is minimal. | Install warns "read and change all your data on all websites". |
| Coverage | Only sites the user opted in to. Anything else is a blind spot. | Complete coverage, including pages the user did not think to enable. |
| Friction | One click per site. | None after install. |
| Fit | Default. Matches a tool that watches other software. | Possible later as an explicit one-click "all websites" grant. |

The popup offers both. "Allow all websites" grants the same optional pattern pair, not a different permission model. No per-site entries exist in code.

## Architecture

```
src/
  shared/      types.ts (event schema), messages.ts (typed popup/content <-> background messages)
  config/      settings.ts (monitoring switch), access.ts (site-access rules, content-script registration)
  core/        normalize.ts (validate + build events), store.ts (local ring buffer), pipeline.ts (the one path events take)
  background/  index.ts (service worker, message routing), collector-manager.ts
  collectors/  Collector interface + registry for background sources (empty)
  content/     index.ts (content script), observer.ts (interface), observers/ (registry, empty)
  analysis/    types.ts (Rule, Finding, BehaviorAnalyzer), engine.ts, rules/ (registry, empty)
  popup/       popup.html/css/ts
tests/         Vitest unit tests
scripts/       build.mjs
public/        manifest.json
```

Event flow (target design; only the plumbing exists today):

```
page ──► content observers ─┐
                            ├─► pipeline.emit ─► validate/normalize ─► store ─► (later) analysis ─► popup
chrome.* ► collectors ──────┘
```

### Event model

Defined in `src/shared/types.ts`. Each event has an id, timestamp, `category` and `action`, a `source` (origin, URL, tab, frame), optional `destination` (host, origin, method, third-party flag), `evidence` (collector, mechanism, small JSON facts), `provenance` and optional `confidence`/`severity`. Provenance is `observed` (reported directly by the browser or page) or `inferred` (derived; must list `relatedEventIds`). Events never contain raw secrets such as form values or cookie contents.

### Which mechanism for which signal

A content script alone cannot see everything a page does. Planned mechanisms and their limits:

| Signal | Mechanism | Main limits |
| --- | --- | --- |
| Page lifecycle, navigation | `chrome.webNavigation`/`tabs` or content script | Only granted origins for content-level detail. |
| DOM activity, form interaction | Content script (isolated world) | Sees the DOM, not page JS state. The page can alter the DOM it shares with the script. |
| `fetch`/XHR/storage/clipboard/geolocation API calls | Script injected into the page's MAIN world that wraps those APIs | Must load before page code; can be bypassed by code that grabs unwrapped references (e.g. from an iframe) and can be detected by the page. Reports what the API surface was asked to do, not OS-level facts. |
| Network request metadata | `chrome.webRequest` (optional `webRequest` permission) | Metadata only (URL, method, type, initiator); no bodies. Service workers and some requests are visible only with host access. |
| Camera/microphone/location use | API wrapping plus permission state | Observes calls, not the hardware. Streams used by other means are not seen. |
| Other extensions' behavior | Indirect (their network and DOM effects) | Chrome gives no API to inspect another extension. |

None of these are implemented in Phase 1.

### Unsupported contexts

Even with permission, extensions cannot run on `chrome://` pages, other extensions' pages, the Chrome Web Store, `about:` pages, `data:`/`blob:` top-level pages, or `view-source:`. `file://` pages additionally require the user to enable "Allow access to file URLs" in the extension's details, and Phase 1 treats them as unsupported. Incognito requires the user to enable the extension there. The popup says so instead of pretending to monitor.

## Current status

Implemented:

- MV3 manifest, service worker, dynamic content-script registration from granted origins
- Popup: monitoring toggle, per-site access request/removal, honest empty state
- Event schema with validation, local ring buffer (1000 events), single ingestion pipeline
- Interfaces and empty registries for collectors, content observers and rules
- Unit tests for the schema, store, pipeline, access rules and analysis engine

Not implemented: every monitoring capability (DOM, forms, storage, network, sensitive APIs), correlation, detection rules, explanations and AI analysis. The popup shows no events because none are collected. The content script is registered on granted sites but contains no observers.

## Limitations

- Observation is limited to origins the user grants and to the contexts listed above.
- Phase 1 has not been exercised against real websites; it has been type-checked, unit-tested and built.
- No icons are bundled; Chrome shows its default.
- The service worker can be suspended by Chrome at any time; state lives in `chrome.storage.local`.

## Later phases

A controlled test website and local collector are planned for Phase 2 as separate, optional directories that the extension does not import. Tests against them must run through the same collectors and observers used on ordinary sites.
