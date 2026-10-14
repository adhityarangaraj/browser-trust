# BrowserTrust

BrowserTrust is a standalone Chrome Manifest V3 extension that records metadata about selected website activity and shows it in the popup. It is general-purpose: the local test site is only a fixture and is not imported by or required by the extension.

**Status: Phase 2 implementation.** Collection, local event storage, and popup display are implemented and have unit coverage. End-to-end behavior still needs a manual Chrome/Chromium run; see [Verification](#verification).

## Stack and requirements

- Chrome or Chromium 111 or newer
- Node.js 20 or newer and npm
- TypeScript, esbuild, Vitest, and Node's built-in test runner; no runtime dependency is shipped with the extension
- Events are stored locally in `chrome.storage.local`; there is no extension backend or cloud service

## Build and load

```bash
npm install
npm run typecheck
npm test
npm run build
npm run check
```

In Chrome, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose the generated `dist/` directory. After rebuilding, reload the extension from that page.

## Permissions and site access

| Permission | Kind | Purpose |
| --- | --- | --- |
| `storage` | Required | Store settings and the bounded local event list. |
| `scripting` | Required | Register content scripts on origins the user grants. |
| `activeTab` | Required | Read the active page URL in the popup. |
| `webRequest` | Optional | Collect request metadata. The popup offers a user-initiated grant. |
| `http://*/*`, `https://*/*` | Optional host permissions | User-controlled site access, requested per site or for all websites. |

Monitoring is enabled by default, but nothing is observed until the user grants host access. The popup can grant or remove access for the current site, grant both optional host patterns for all sites, pause monitoring, and request the optional `webRequest` permission. Coverage follows the host permissions actually granted. Granting only one site may hide requests to other hosts.

## What is observed

- **Network requests:** `chrome.webRequest` records URL path (without query or fragment), method, resource type, source/initiator metadata, and query presence/count. It does not read headers, request bodies, or response bodies. This is labelled `extension-api` evidence.
- **Page lifecycle, DOM, and forms:** the isolated content script reports page load, added script/iframe/form elements, form field edits, and form submissions. It records structure and metadata only, never field values or names.
- **Selected page API calls:** a MAIN-world hook reports calls through wrapped fetch, XHR, beacon, WebSocket, Web Storage methods, cookie access, clipboard, geolocation, media capture, and scripted form submission entry points. These are labelled `main-world-hook` evidence and relayed as untrusted input through the content script.
- **Popup:** shows recent stored events with their source, destination when known, evidence mechanism/collector, and provenance. The store is a 1,000-event ring buffer; old events are dropped first.

All event writes pass through the background `EventPipeline`, which validates and normalizes input before storage. Content event source identity comes from the browser message sender. The page and MAIN-world messages are untrusted; the hook relay applies size and rate limits, and the background validates events again.

There are no active detection rules or explanations yet. The analysis types and engine are not wired into the live pipeline. Current collection produces observed events; the UI includes provenance so future inferred events can be distinguished.

## Local test site and collector

The fixture uses fixed synthetic values only and binds to loopback. It has no dependencies beyond Node.js and does not send data to external hosts.

```bash
npm run testbed
```

Open <http://127.0.0.1:4173/>. Grant BrowserTrust access to that site in the popup and, for network collector coverage, grant `webRequest`. Use the buttons to:

1. Trigger synthetic form input events and submit the fixed synthetic form; the page observer sees interaction/submission and the page hook reports the local POST.
2. Write a fixed synthetic value with `localStorage.setItem`.
3. Send the synthetic form payload to the local `/collect` endpoint.

The server accepts only the exact fixture payload, enforces a small body limit, and logs only that known synthetic payload. Stop it with Ctrl+C. Test the server without external dependencies using `node --test testbed/server-test.mjs` (also included in `npm test`).

After using the fixture, reopen the extension popup to inspect the collected events and evidence labels.

The fixture is not part of product logic. There are no testbed hostnames or endpoint assumptions in `src/`.

## Architecture

| Area | Location | Role |
| --- | --- | --- |
| Service worker and routing | `src/background/` | Lifecycle, message trust checks, collector lifecycle. |
| Background collection | `src/collectors/` | `webRequest` metadata collector and registry. |
| Page collection | `src/content/`, `src/page-hooks/` | Isolated observers, MAIN-world API wrappers, untrusted hook relay. |
| Event processing | `src/core/` | Validation/normalization, bounded local store, single event pipeline. |
| Settings and access | `src/config/` | Monitoring switch, optional host grants, dynamic script registration. |
| Popup | `src/popup/` | Site access and monitoring controls, collector state, recent events. |
| Test fixture | `testbed/` | Standalone local demo page and built-in Node HTTP server; never imported by extension code. |

## Limitations and unsupported contexts

- Observation only covers sites the user grants and browser contexts where Chrome permits extension scripts.
- `webRequest` visibility depends on optional permission, host access, and Chrome's API behavior. It records metadata only.
- MAIN-world wrappers see calls through wrapped entry points. A page can bypass or tamper with them, including by using other execution contexts. Storage property-style access is not covered.
- API-call reports show that a call was attempted, not that clipboard, geolocation, camera, microphone, screen capture, or a network operation succeeded.
- Form interaction observations do not prove what data was transmitted. A form event followed by a request is not proof that the request carried the form values.
- Other extensions cannot generally be inspected directly. BrowserTrust may observe some page effects but cannot comprehensively monitor another extension.
- Browser-internal pages, extension pages, the Chrome Web Store, `file:` pages, and other restricted contexts are unsupported. Incognito requires the user to allow the extension there.
- There is no event correlation, rule-based finding generation, AI analysis, or guarantee of complete visibility.

## Verification

Unit and server tests, type checks, and builds are automated. A successful local test run does not prove Chrome permission prompts, dynamic registration, live event delivery, or popup display all work together. Manual Chrome/Chromium verification must be recorded separately; do not treat the test fixture as proof of universal site coverage.
