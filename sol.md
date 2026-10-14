# BrowserTrust — `sol.md`
## Implementation plan and source of truth

This document is the implementation plan for continuing BrowserTrust. Read it before making changes. `AGENTS.md` must instruct future coding agents to read both `README.md` and this `sol.md` before implementation. Keep `AGENTS.md`, `README.md`, and `PROGRESS.md` consistent with the actual code and this plan.

## 1. Product goal

BrowserTrust is a standalone, general-purpose Chrome Manifest V3 extension intended to make observable website behavior understandable: what activity occurred, what browser/page API was used, where a request was directed, and why a sequence may deserve review.

It must not be designed around one demo website, Redact Agent, uBlock Origin, or any other extension. A local test site is only a reproducible test fixture. BrowserTrust should use the same general-purpose monitoring pipeline on permitted ordinary websites.

Be precise about limitations. An extension cannot observe everything a website or another extension does. Distinguish direct observations from inferences, avoid collecting raw sensitive values, and never claim complete protection or universal visibility.

## 2. Existing repository and stack

The supplied project is in `browsertrust/`. It uses:
- TypeScript with strict checking.
- Chrome Manifest V3.
- esbuild via `scripts/build.mjs`; the build output is `dist/`.
- Vitest for tests.
- Plain HTML/CSS/TypeScript for the popup; no UI framework.
- `chrome.storage.local` for local event storage; no backend or database is needed for the extension.

Install/build/test commands from the project root:
```bash
npm install
npm run typecheck
npm test
npm run build
npm run check
```
Chrome loads the generated `dist/` directory as an unpacked extension. `.gitignore` may ignore `dist/`; that does not prevent the build from creating it. Do not initialize Git, create commits, or include a `.git` directory in generated delivery ZIPs. The user manages Git separately.

## 3. Current code architecture

- `src/shared/types.ts`, `messages.ts`, `hook-protocol.ts`, `url.ts`: event types, message contracts, page-hook protocol, and URL normalization.
- `src/config/settings.ts`, `access.ts`: monitoring settings and optional site access/dynamic content-script registration.
- `src/content/`: isolated-world content script and observers for page lifecycle, DOM elements, forms, and hook-message relay.
- `src/page-hooks/`: MAIN-world wrappers for selected page APIs, including fetch, XHR, beacon, WebSocket, Web Storage method calls, cookies, clipboard, geolocation, media capture requests, and script-driven form submission.
- `src/collectors/network.ts`: `chrome.webRequest` request metadata collector, using optional permission.
- `src/background/`, `src/background/collector-manager.ts`: service worker, message routing, and collector lifecycle.
- `src/core/normalize.ts`, `store.ts`, `pipeline.ts`: event validation/normalization, local bounded event storage, and single ingestion pipeline.
- `src/analysis/`: rule/finding types and chronological rule engine; the analysis engine is not yet wired into the live pipeline.
- `src/popup/`: UI for monitoring/access controls and activity.
- `public/manifest.json`: Manifest V3 configuration.
- `scripts/build.mjs`: bundles the extension and copies static files into `dist/`.
- `tests/`: unit tests for core logic and several observers/hooks.

All events should pass through the shared event pipeline. Content/page messages are untrusted. The background must derive the source from the browser message sender, validate inputs, strip URL query strings/fragments from stored URLs, and never store raw passwords, form values, cookies, storage values, clipboard contents, or request/response bodies.

## 4. Phase 2 status at handoff

The uploaded ZIP's `PROGRESS.md` reports Phase 2 in progress. The repository already contains substantial monitoring code; do not recreate it from scratch.

Reported as implemented:
- URL description and query/fragment stripping.
- Collector interface and manager; monitoring-switch gating.
- Network metadata collector using optional `webRequest` permission.
- Popup collector state and permission control.
- Page, DOM, form observers and hook relay.
- MAIN-world hooks for selected browser/page APIs.
- Unit tests reported as 64 passing.
- The README is stale and still describes the Phase 1 foundation. Update it to reflect the actual code only after checking it against implementation and test results.

Not yet complete according to `PROGRESS.md`:
1. Add `testbed/` containing a static demonstration site and a zero-dependency Node.js local server/collector that logs only synthetic data it receives. Keep this testbed separate from the extension; the extension must not import or depend on it.
2. Update `README.md` and `AGENTS.md` so they describe the current implementation and real limitations.
3. Run `npm run check`, fix any failures, and produce a clean ZIP checkpoint.
4. Test manually in Chrome/Chromium if available. The supplied progress notes say real-browser behavior has not been verified. Do not claim it has been.

Before assuming the reported test count is current, run the tests and record the actual result.

## 5. Work sequence

### Phase 2A — Finish the local testbed
- Create a clearly labelled, local-only test website with synthetic form data.
- Include actions that exercise existing observable behavior: form interaction/submission, a storage method call, and a POST to the local collector.
- Build a minimal Node.js server using built-in modules only if practical; bind to loopback (`127.0.0.1`), validate payload shape, and log only synthetic test data.
- Keep ports and startup commands documented.
- Avoid real credentials, external destinations, cloud services, databases, or actual phishing behavior.
- The testbed is a fixture; do not hardcode its hostname into product logic or require it for ordinary monitoring.

### Phase 2B — Validate and fix the end-to-end pipeline
- Run typecheck, tests, and build.
- Confirm all collected events enter through the common pipeline and are visible in the popup.
- Confirm the monitoring switch and site permission controls work as intended.
- Confirm network metadata is clearly distinguished from page-hook reports.
- Confirm the UI does not present inferred facts as observed facts.
- Fix bugs uncovered by tests or manual checks, keeping scope limited to correctness of the existing phase.
- Add or update tests for important regressions.

### Phase 2C — Documentation and delivery
- Rewrite README status, architecture, permission explanation, setup/run commands, testbed instructions, observed capabilities, unsupported contexts, and limitations based on verified behavior.
- Update `AGENTS.md` with the actual architecture and an explicit instruction to read `sol.md`.
- Update `PROGRESS.md` with concise completion status and any remaining unverified checks.
- Run `npm run check`.
- Create `browsertrust-phase2.zip` containing source, documentation, tests, manifests, and lockfile. Exclude `node_modules`, `dist`, caches, secrets, and `.git`. Verify the ZIP contents before providing it.

## 6. Important technical limitations to document

- Optional host permissions mean coverage is limited to sites the user grants.
- `chrome.webRequest` visibility is constrained by host permissions and browser APIs; the collector records metadata, not request or response bodies.
- MAIN-world API wrappers observe calls through wrapped entry points only. Pages may bypass/tamper with wrappers or use other execution contexts. They report API calls, not proof of successful hardware access or completed network transmission.
- Storage hooks cover method calls such as `setItem`, `getItem`, `removeItem`, and `clear`; property-style storage access may not be observed.
- Camera, microphone, screen capture, geolocation, clipboard, and similar hooks indicate requested API activity, not necessarily successful use.
- Other extensions cannot generally be inspected directly by Chrome extensions. BrowserTrust may observe some effects, but must not claim comprehensive monitoring of another extension.
- Restricted browser pages and contexts are unsupported.
- Event correlation and rule-based findings must cite supporting event IDs. An observed form submission followed by a request does not prove the form data was sent unless the implementation has reliable evidence for that claim.
- No remote AI calls or external data transmission should be added by default. Any future AI analysis must be opt-in and use normalized/minimized event data.

## 7. Explicitly out of scope for this handoff

Do not add AI/LLM analysis, cloud services, database persistence, authentication, Docker, integration with other extensions, or a production-grade dashboard. Do not redesign the stack or rewrite working modules merely for style. Focus on finishing and validating Phase 2.

## 8. Acceptance criteria

Phase 2 is complete when:
- The testbed and local collector work using synthetic data.
- BrowserTrust can be loaded from `dist/` after `npm run build`.
- Supported events from the testbed flow through the normal collectors/observers and event pipeline into the popup.
- The project passes `npm run check`.
- README, AGENTS, and PROGRESS accurately reflect tested functionality and limitations.
- A verified `browsertrust-phase2.zip` is delivered without `.git`, dependencies, or build output.
- Any manual Chrome checks not performed are explicitly marked as unverified.
