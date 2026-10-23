# BrowserTrust

BrowserTrust is a standalone Chrome Manifest V3 extension that records selected website activity, tracks observed network destinations, and presents deterministic evidence-backed findings locally. The local test site is only a fixture; extension code does not import or depend on it.

**Status: Phase 6 implementation plus initial Web Recall.** The event pipeline, deterministic analysis, local findings store, destination summary, assessment-first popup, View Activity page, local History summaries, estimated active browsing time, optional permission manager, local tab workspaces, dashboard Trust Monitor, manual local follow-up tracking, and local history search with saved Recall items are implemented. Automated checks pass; manual Chrome behavior still needs verification for the dashboard features; see [Verification](#verification).

## Requirements and commands

- Chrome or Chromium 111 or newer
- Node.js 20 or newer and npm
- TypeScript, esbuild, Vitest, jsdom for DOM tests, and Node's built-in test runner
- No extension backend, database, cloud service, or remote analysis
- React dashboard, Lucide icons, and Inter font files are bundled locally; the dashboard makes no network requests

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run check         # typecheck + tests + build + verify-dist
npm run icons         # regenerate 16/48/128 PNGs under public/icons/
npm run format        # Prettier write
npm run format:check  # Prettier check
```

To load the extension, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the generated `dist/` directory. After each build, reload the extension from that page.

The standalone dashboard page is at `chrome-extension://<installed-extension-id>/dashboard.html` after loading `dist/`. Sites & Activity, Permissions, Web Recall, and Context Keeper request optional access only after an explicit action. Trust Monitor reads the same stored events, findings, and settings as the popup and Activity page, then derives assessments, destinations, and reports with the shared functions. Ignoring a site only hides it from the overview attention list; it does not stop collection or delete evidence. Follow-up Tracker entries are user-created, validated, bounded local records; there are no automatic reminders or background notifications.

## Permissions and coverage

| Permission | Kind | Purpose |
| --- | --- | --- |
| `storage` | Required | Store settings, up to 1,000 events, and up to 500 findings locally. |
| `scripting` | Required | Register isolated and MAIN-world scripts for permitted origins. |
| `activeTab` | Required | Read the current page in the popup. |
| `webRequest` | Optional | Observe browser request metadata; grant from the popup. |
| `notifications` | Required | Fallback native OS alert for **Suspicious activity detected** when the in-page alert dialog cannot be shown in the triggering tab (for example, a tab covered only by `webRequest`). |
| `history` | Optional | Read local visit records for the dashboard after explicit user approval; URLs are processed in memory and not transmitted. |
| `tabs` | Optional | Requested from Context Keeper to read open tab URLs/titles for saving and duplicate review; also used with `idle` and `alarms` for opt-in active-time estimates. |
| `idle`, `alarms` | Optional | Required only for opt-in active browsing-time estimates: detect idle state and checkpoint once per minute. |
| `contentSettings` | Optional | Requested from Permissions when the user enables settings review. Reads effective per-site content settings and can add a BrowserTrust-owned restrictive site rule after explicit confirmation. |
| `http://*/*`, `https://*/*` | Optional host permissions | User-controlled site access, requested per site or for all HTTP/HTTPS sites. |

Monitoring is enabled by default, but BrowserTrust observes no site until host access is granted. The popup can grant or remove current-site access, allow all HTTP and HTTPS sites, pause monitoring, and grant `webRequest`. With only one site allowed, requests to other hosts may be invisible. Incomplete access or fewer than three observations including a network event is reported as **Insufficient evidence**.

History summaries query up to 3,000 history items and count matching local top-level visit records in the selected local calendar range. Chrome returns visits per URL, which are filtered to the range before aggregation; a reached item cap or per-URL API failures can make results incomplete. Active time counts eligible intervals only while an HTTP(S) tab is active in the focused Chrome window and Chrome reports the user active. It is a foreground-time estimate, not attention measurement. Minute checkpoints and long worker/browser interruptions can undercount. Only local-day and hostname aggregates are stored, bounded to 30 days and 2,000 records. Current tab URLs are transiently read only to derive the hostname and are not stored by this feature. Tracking is separate from monitoring and can be paused or cleared in the dashboard.

Web Recall also requires the optional `history` permission, requested from its own view after the user chooses **Allow history access**. Search reads Chrome history locally and returns at most 500 matching HTTP(S) pages per search; page content is never read. Search results are not saved automatically. Recent search terms are kept on this device (up to 20) and can be cleared in the view. A user-saved Recall item keeps its credential-free HTTP(S) URL, including query and fragment, so the selected page can be reopened; saved items, notes, and tags stay in `chrome.storage.local`, bounded to 500 items and 2 MiB. Deleting a Recall item does not delete the browser-history entry.

The Permissions dashboard discovers up to 100 hostnames from the last 30 days of local History results (maximum 3,000 history items), then queries effective Chrome content settings when `contentSettings` is granted. This is not a complete inventory of site grants. Chrome's API does not identify whether an effective value came from a site exception or a broader default. Blocking adds an extension-owned site rule after confirmation; resetting individual rules is done in Chrome site settings because Chrome's `contentSettings.clear()` clears all rules created by this extension. USB, Serial, HID, and Bluetooth site-grant inventories are not exposed to this manager. Its local action log records only BrowserTrust manager actions, retains at most 100 entries for 90 days, and cannot reconstruct earlier Chrome changes. See [Chrome's contentSettings API](https://developer.chrome.com/docs/extensions/reference/api/contentSettings) for API scope and limitations.

Context Keeper reads open tabs only after the user grants the existing optional `tabs` permission. It saves only credential-free HTTP(S) URLs, titles, order, pinned state, and window grouping; Incognito tabs are excluded. Query strings and fragments are retained solely to restore the exact saved destination and compare duplicates conservatively; they remain local. Workspaces stay in `chrome.storage.local`, bounded to 40 workspaces, 120 tabs each, 20 window groups each, 2,000 total saved tabs, and 3 MiB serialized data. Import files are limited to 4 MiB and schema version 1; imported IDs are regenerated. Restore previews show the selected tab count and duplicate URLs before opening, then report per-tab failures. Workspace JSON export/import is local and contains no live browser tab IDs.

The dashboard Trust Monitor reads the existing `bt.events`, `bt.findings`, and `bt.settings` records through extension messages and reuses `assessSite`, `summarizeDestinations`, and the existing report builder. Site views are based on recorded event origins; the assessment retains the same coverage limits as the popup. Ignoring an origin adds it to `bt.settings.ignoredOrigins` (bounded to 100 normalized HTTP(S) origins), hiding it from the overview attention list while leaving collection, stored evidence, and direct site review intact. It adds no permission and does not change findings or event retention. Trust Monitor activity filters the same retained event records, provides the existing Markdown and JSON report formats, and can clear the shared activity after confirmation.

Follow-up Tracker stores manually entered items under `bt.followUps` in `chrome.storage.local`. The list is bounded to 500 records and 2 MiB, with bounded title/details/URL fields. Due soon means today through the next seven local calendar days, inclusive; overdue and due-soon totals exclude completed items. Associated links accept only HTTP(S), reject embedded credentials, and discard query strings and fragments. No browser history, page contents, email, or calendar data is read, and no reminder scheduler or notification is active.

## What BrowserTrust observes

- **Browser network metadata:** the `webRequest` collector records destination host and path (query and fragment removed), method, resource type, source context, and whether query parameters existed and how many. It emits a `request.sent` event before the response and, when available, matching `request.completed` events carrying the HTTP status code and `request.failed` events carrying the Chrome error string. All three events share a `requestId` so the destinations view can merge them without double-counting. It does not read headers or request/response bodies. Evidence is labelled `extension-api`.
- **Page activity:** isolated observers report page load, added script/iframe/form elements, field edits, and form submission. They store structure and metadata, never field names or values.
- **Selected page API calls:** MAIN-world wrappers report calls through fetch, XHR, beacon, WebSocket, Web Storage methods, cookies, clipboard, geolocation, media capture, and scripted form submission entry points. The relay treats page-world messages as untrusted, limits their size/rate, and labels them `main-world-hook`.
- **Event processing:** all events pass through `EventPipeline`, which validates and normalizes them before storage. Content event source identity is derived from the browser message sender. Event storage is a local 1,000-event ring buffer.
- **Destinations:** the popup groups network observations by hostname and shows observed methods, source page origins, evidence mechanisms, HTTP status codes (merged from `request.completed`), failure counts (from `request.failed`), a `third-party` label when any observation to the host was cross-site, and latest observation time. Counts are `request.sent` observations only; completions never double-count. Third-party is derived from a trimmed registrable-domain heuristic (not the full Public Suffix List), so uncommon multi-label TLDs may understate cross-site relationships.

## Deterministic findings

Analysis runs locally after each validated event has been stored. Findings are persisted in `chrome.storage.local`, bounded to the latest 500, and deduplicated by stable rule/event IDs. The popup shows supporting event IDs and timestamps, source page, destination when available, evidence strength, and limitations.

| Rule | Trigger | Severity | What it does not establish |
| --- | --- | --- | --- |
| Form activity followed by network | A browser-trusted form submit followed within 30 seconds by a browser-observed request from the same tab and page origin, with matching method and destination when those fields exist. | medium | It does not show that form values were sent. The request payload is not collected. |
| Sensitive capability call | A reported geolocation, clipboard-read, or media-capture API invocation. | low | It does not prove permission was granted or the API succeeded. Page-world hook messages can be forged or suppressed by the page. |
| Capability call followed by network | A supported capability call followed within 15 seconds by browser-observed network metadata in the same tab and page origin. Escalates to **high** when that request is a cross-origin POST. | medium / high | This is temporal association only; it does not prove causation or data transmission. The request body is not collected. |
| Repeated cross-origin POST pattern | At least three browser-observed cross-origin POST requests to the same host in 60 seconds from the same tab and page origin. A sustained burst of six or more emits an additional **high**-severity finding. | medium / high | Repetition alone does not establish malicious intent or reveal request contents. |
| Scripted form submission followed by network | A page-hook `form.submit()` call followed within 30 seconds by a browser-observed request from the same tab and page origin. | low | The submit was reported by a page-world hook that the page can forge or suppress; the request body is not collected. |
| Hidden cross-origin iframe added | A newly added iframe whose destination is a different origin and whose attributes or inline style mark it hidden or zero-size. | low | Large sites use hidden cross-origin iframes for ads, analytics and embedded players, so this is informational only. |
| Script injected dynamically from a different site | A `<script>` element added after the initial page scan whose destination is on a different registrable domain than the page. | low | Many legitimate integrations load scripts from other sites; the script source is not fetched or inspected. |

These rules produce review findings, not a verdict that a website is safe or malicious. Ordinary external GET requests do not trigger the repeated-POST rule. No arbitrary risk score or confidence percentage is used. The analysis engine runs incrementally against prior stored events; errors are logged and do not reject an already-stored event. A high-severity finding promotes the assessment to **Suspicious activity detected**; medium and low findings produce **Review recommended**.

## Assessment and popup

The popup is assessment-first: it shows the active hostname and monitoring status, an evidence-based assessment, observed-behavior summary, event/network/finding counts, three latest findings, a compact destination preview, and four recent events. Finding details expand inline. **View Activity** opens a full extension page for the same active tab and stored events/findings, with complete findings, destinations, and retained timeline. The activity page also exposes a search box and category chips that filter the timeline client-side without re-fetching, and clicking a supporting-event link in any finding or destination row scrolls to the row and briefly highlights it so the connection is visible even when it was already on screen. **Refresh** reloads state; **Clear activity** clears events and findings from either view. **Copy report** writes a human-readable Markdown summary (assessment, findings with supporting events, destinations with status codes, event timeline, and a privacy footer) to the clipboard; the activity page additionally offers **Download JSON** which saves the same report as a structured file named `browsertrust-<host>-<timestamp>.json`. Both reports are built client-side from already-sanitized data — BrowserTrust never collects raw request bodies, cookie values, form values or clipboard contents. Both views use the same assessment and background storage APIs.

Assessment states:

- **Insufficient evidence:** monitoring is off, site access or required permissions are missing, page scripts are not registered, or fewer than three observations including a network event exist for the active tab.
- **No suspicious activity observed:** monitoring and coverage checks pass, sufficient activity exists, and no configured rule matched. This is not proof the site is safe.
- **Review recommended:** at least one current finding carries medium severity AND the page's registrable domain is not on the built-in common-sites allowlist. Low-severity informational findings (hidden-iframe, dynamic-third-party-script, scripted-form, sensitive-capability-call) are always listed below the assessment but do not flip the overall state — they are common on legitimate large sites.

The common-sites allowlist lives in [`src/analysis/known-hosts.ts`](src/analysis/known-hosts.ts) and is keyed by registrable domain (so `music.youtube.com`, `scholar.google.com`, etc. all match). For pages on that list, both medium and high findings render in the findings panel for transparency but do not promote the overall state away from "No suspicious activity observed" — large legitimate sites routinely match pattern-based rules in the course of normal use (telemetry endpoints, analytics bursts, embedded players). The alerts module mirrors this: no alert dialog or OS notification fires for allowlisted hosts. To restore full escalation and alerts for a site, delete its entry from `known-hosts.ts` and rebuild.
- **Suspicious activity detected:** at least one current finding carries high severity. Today this is reached by a capability call followed by a cross-origin POST, or by a sustained repeated cross-origin POST burst (six or more in a minute).

All event-derived text is rendered with DOM text nodes/`textContent`. The popup does not display mock findings, fabricated charts, or a security score.

### Background alerts

When a **high-severity** or **medium-severity** finding is appended for a tab, BrowserTrust adds a colored `!` badge on the extension icon for that tab (red for high, orange for medium) and shows a large **in-page alert dialog** over the page: the background pushes a `show-alert` message (finding title, explanation, severity, destination/source host, evidence strength, limitations, time — no page data) to the top frame of the triggering tab, and the BrowserTrust content script renders a modal dialog in a closed shadow root using DOM text only. The dialog adapts to the assessment level: an orange "Review recommended" theme for medium findings, and an escalated red "Suspicious activity detected" theme if any high-severity finding is present. Further findings for the same page stack into the open dialog. It closes with **Dismiss** or `Esc`. If the dialog cannot be delivered — no tab id, no BrowserTrust content script in that tab (for example, the tab is observed only through `webRequest`), or no acknowledgement — BrowserTrust falls back to a native OS notification (via `chrome.notifications`, respects the user's system Do Not Disturb) that stays on screen until acknowledged; clicking it opens the activity page for the triggering tab. Limitation: the dialog lives in the page's DOM, so a hostile page can remove or cover it; the toolbar badge is set independently. Alerts are de-duplicated by finding id for the lifetime of the service worker, and are cleared automatically when the tab navigates to a new URL, the tab closes, monitoring is turned off, or **Clear activity** is used. Low-severity informational findings never alert — they are reviewable in the popup but do not interrupt the user.

Each finding card has small **Pin** and **Dismiss** controls. Pinned findings sort to the top of the list and gain an orange edge; dismissed findings are hidden and reachable through a "Show N dismissed" link at the bottom. State is persisted locally in `chrome.storage.local` as `bt.preferences` (pin/dismiss id lists are capped and sanitized on load), scoped per-browser-profile, and reset by **Clear activity**. The theme toggle in the top bar switches between the default dark theme and a light theme that reuses the same red/green/orange accent tokens; the choice is persisted in the same preference bundle and applied before each render.

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

## Future work

Items deliberately out of scope so far: ESLint (Prettier is wired, the lint pass can land alongside a dependency bump); a Playwright or Puppeteer smoke test that loads `dist/` into headless Chrome and walks the testbed demo end-to-end; a `system.worker.woken` lifecycle event (rate-limited so cold starts don't flood the ring buffer); a settings UI exposing the rule thresholds (`FORM_NETWORK_WINDOW_MS`, `REPEATED_POST_*`, retention sizes) that currently live as constants in `src/analysis/rules/index.ts`; and real screenshots of each popup state for the top of this README.

## Verification

Automated type, unit, testbed, and build commands are available above. A passing build or unit suite does not prove Chrome permission prompts, dynamic registration, event delivery, or popup behavior work together. Manual Chrome verification must include the local demo, monitoring-disabled state, missing-permission state, empty state, and at least one permitted ordinary website before Phase 3 is called demo-ready.

The latest automated verification passes typecheck, all 208 Vitest tests, all 9 testbed tests, build, and distribution verification. Manual Chrome verification remains: load `dist/`, open `chrome-extension://<EXTENSION_ID>/dashboard.html`, verify the history permission prompt and denial/grant paths, search/filter/sort results, save/edit/delete Recall items, clear recent searches, and confirm data remains local after reload. Also verify the other dashboard permission prompts and extension behavior in Chrome/Chromium before calling those flows browser-verified.

For Context Keeper, load the rebuilt extension, open the dashboard's Context Keeper view, grant optional Tabs access, and verify current-window/selected/all-window saves, selection/search behavior, edit/duplicate/delete, duplicate review, current-window and new-window restores, partial failures, and JSON export/import (including an invalid or oversized file). Incognito, restricted URLs, and URLs containing embedded credentials should not be saved.

For Trust Monitor, verify the empty and error states; assessments for multiple observed sites; findings with supporting IDs, timestamps, evidence strength, and limitations; destination grouping and browser status/failure metadata; activity search/category filters; copied Markdown and downloaded JSON reports; and site ignore/unignore. Confirm that ignored sites continue to collect events and that their findings and activity remain available. The dashboard reads the retained event cap (1,000) and finding cap (500), so older activity can be absent after the existing ring buffers roll over.

For Follow-up Tracker, verify create/edit, completion/reopen, confirmed deletion and cancellation, reload persistence, invalid title/date/URL messages, local-calendar due groups including date boundaries, all filters and sort orders, empty/no-match states, and deliberate opening of an associated HTTP(S) link. Confirm that no browser permission prompt or automatic reminder appears.

For Web Recall, verify empty and no-match states, date ranges, domain filtering, each sort mode, recent-search clearing, pagination, saved-item notes/tags, reload persistence, and deliberate opening of a saved HTTP(S) page. Grant History access only from the view and confirm denying it does not break other dashboard views.
