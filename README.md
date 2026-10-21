# BrowserTrust

BrowserTrust is a standalone Chrome Manifest V3 extension that records selected website activity, tracks observed network destinations, and presents deterministic evidence-backed findings locally. The local test site is only a fixture; extension code does not import or depend on it.

**Status: Phase 3 implementation.** The event pipeline, deterministic analysis, local findings store, destination summary, assessment-first popup, and View Activity page are implemented. A real Chrome demonstration has not yet been verified in this workspace; see [Verification](#verification).

## Requirements and commands

- Chrome or Chromium 111 or newer
- Node.js 20 or newer and npm
- TypeScript, esbuild, Vitest, jsdom for DOM tests, and Node's built-in test runner
- No extension backend, database, cloud service, or remote analysis

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run check
```

To load the extension, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the generated `dist/` directory. After each build, reload the extension from that page.

## Permissions and coverage

| Permission | Kind | Purpose |
| --- | --- | --- |
| `storage` | Required | Store settings, up to 1,000 events, and up to 500 findings locally. |
| `scripting` | Required | Register isolated and MAIN-world scripts for permitted origins. |
| `activeTab` | Required | Read the current page in the popup. |
| `webRequest` | Optional | Observe browser request metadata; grant from the popup. |
| `http://*/*`, `https://*/*` | Optional host permissions | User-controlled site access, requested per site or for all HTTP/HTTPS sites. |

Monitoring is enabled by default, but BrowserTrust observes no site until host access is granted. The popup can grant or remove current-site access, allow all HTTP and HTTPS sites, pause monitoring, and grant `webRequest`. With only one site allowed, requests to other hosts may be invisible. Incomplete access or fewer than three observations including a network event is reported as **Insufficient evidence**.

## What BrowserTrust observes

- **Browser network metadata:** the `webRequest` collector records destination host and path (query and fragment removed), method, resource type, source context, and whether query parameters existed and how many. It listens before the response, so HTTP status is not available. It does not read headers or request/response bodies. Evidence is labelled `extension-api`.
- **Page activity:** isolated observers report page load, added script/iframe/form elements, field edits, and form submission. They store structure and metadata, never field names or values.
- **Selected page API calls:** MAIN-world wrappers report calls through fetch, XHR, beacon, WebSocket, Web Storage methods, cookies, clipboard, geolocation, media capture, and scripted form submission entry points. The relay treats page-world messages as untrusted, limits their size/rate, and labels them `main-world-hook`.
- **Event processing:** all events pass through `EventPipeline`, which validates and normalizes them before storage. Content event source identity is derived from the browser message sender. Event storage is a local 1,000-event ring buffer.
- **Destinations:** the popup groups network observations by hostname and shows observed methods, source page origins, evidence mechanisms, and latest observation time. Counts are observations, not deduplicated unique requests. No HTTP response status is currently collected.

## Deterministic findings

Analysis runs locally after each validated event has been stored. Findings are persisted in `chrome.storage.local`, bounded to the latest 500, and deduplicated by stable rule/event IDs. The popup shows supporting event IDs and timestamps, source page, destination when available, evidence strength, and limitations.

| Rule | Trigger | What it does not establish |
| --- | --- | --- |
| Form activity followed by network | A browser-trusted form submit followed within 30 seconds by a browser-observed request from the same tab and page origin, with matching method and destination when those fields exist. | It does not show that form values were sent. The request payload is not collected. |
| Sensitive capability call | A reported geolocation, clipboard-read, or media-capture API invocation. | It does not prove permission was granted or the API succeeded. Page-world hook messages can be forged or suppressed by the page. |
| Capability call followed by network | A supported capability call followed within 15 seconds by browser-observed network metadata in the same tab and page origin. | This is temporal association only; it does not prove causation or data transmission. |
| Repeated cross-origin POST pattern | At least three browser-observed cross-origin POST requests to the same host in 60 seconds from the same tab and page origin. | Repetition alone does not establish malicious intent or reveal request contents. |

These rules produce review findings, not a verdict that a website is safe or malicious. Ordinary external GET requests do not trigger the repeated-POST rule. No arbitrary risk score or confidence percentage is used. The analysis engine runs incrementally against prior stored events; errors are logged and do not reject an already-stored event.

## Assessment and popup

The popup is assessment-first: it shows the active hostname and monitoring status, an evidence-based assessment, observed-behavior summary, event/network/finding counts, three latest findings, a compact destination preview, and four recent events. Finding details expand inline. **View Activity** opens a full extension page for the same active tab and stored events/findings, with complete findings, destinations, and retained timeline. **Refresh** reloads state; **Clear activity** clears events and findings from either view. Both views use the same assessment and background storage APIs.

Assessment states:

- **Insufficient evidence:** monitoring is off, site access or required permissions are missing, page scripts are not registered, or fewer than three observations including a network event exist for the active tab.
- **No suspicious activity observed:** monitoring and coverage checks pass, sufficient activity exists, and no configured rule matched. This is not proof the site is safe.
- **Review recommended:** one or more current findings matched a review rule.
- **Suspicious activity detected:** reserved for a high-severity finding supported by evidence. Current rules do not assign high severity, so they produce review recommendations instead.

All event-derived text is rendered with DOM text nodes/`textContent`. The popup does not display mock findings, fabricated charts, or a security score.

## Repeatable local demo

Start the loopback-only synthetic site and collector:

```bash
npm run testbed
```

Then:

1. Build and load `dist/` in Chrome/Chromium.
2. Open <http://127.0.0.1:4173/>. Grant BrowserTrust access to this site and grant optional `webRequest` from the popup.
3. Reload the testbed tab so the newly registered scripts run on it.
4. Trigger synthetic form input, write the fixed local-storage sample, and submit the fixed synthetic form.
5. Reopen the popup. The activity should include form, storage, page-hook request, and browser network observations. The form/network rule should produce a **Review recommended** finding with both supporting events and explicit payload/causation limitations.
6. Inspect the destination group and expand the finding. Use **Clear activity** to reset BrowserTrust's event and finding stores before repeating.

The testbed accepts only its fixed synthetic JSON payload, enforces a small request-body limit, binds to `127.0.0.1`, and logs only the known synthetic values. It sends no data to external destinations. Test the server with `node --test testbed/server-test.mjs`; `npm test` includes this test after Vitest. Stop the server with Ctrl+C.

## Limitations

- BrowserTrust only observes sites with user-granted host access and contexts where Chrome allows extension scripts. Restricted browser pages, extension pages, the Chrome Web Store, and `file:` pages are unsupported; Incognito requires enabling the extension there.
- `webRequest` coverage depends on optional permission, host permissions, and Chrome's API behavior. Service-worker, browser-internal, and other restricted traffic may not be visible.
- MAIN-world wrappers see selected calls through wrapped entry points. A page may bypass/tamper with them or use another execution context. Hook events are page-reported and untrusted.
- Storage wrappers cover method calls; property-style storage access may not be observed. API-call reports do not prove success for clipboard, geolocation, camera, microphone, or screen capture.
- Form events and later requests are not proof that form data was transmitted. BrowserTrust never collects form values, raw storage/cookie values, clipboard contents, or network bodies.
- BrowserTrust cannot comprehensively inspect another extension's internal behavior.
- Findings are deterministic heuristics with explicit evidence and limitations. No event correlation can prove causation when only timing and metadata are available.

## Verification

Automated type, unit, testbed, and build commands are available above. A passing build or unit suite does not prove Chrome permission prompts, dynamic registration, event delivery, or popup behavior work together. Manual Chrome verification must include the local demo, monitoring-disabled state, missing-permission state, empty state, and at least one permitted ordinary website before Phase 3 is called demo-ready.

Latest workspace result: typecheck, all 89 Vitest tests, and build passed. The combined `npm run check` is currently blocked by a testbed fixture assertion that expects `A suspicious website`, while the fixture page currently says `Suspicious behavior demo` (8/9 Node server tests passed). Chrome/Chromium was not available on PATH, so the redesigned popup and activity page have not been browser-verified.
