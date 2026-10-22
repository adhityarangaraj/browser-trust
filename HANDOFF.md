# BrowserTrust — handoff brief for Antigravity

Share this file with the agent (Antigravity) when onboarding it to the project. Read `AGENTS.md` and `sol.md` immediately after this document; they are the authoritative rules.

---

## 1. What the project is

BrowserTrust is a standalone, general-purpose **Chrome Manifest V3** extension that observes selected website behavior and presents **evidence-based deterministic findings**. It runs entirely locally — no backend, no telemetry, no cloud, no AI call-outs at runtime. It never collects form values, cookie values, request bodies, clipboard contents, or passwords. Metadata only.

Status: shipping-ready. 139 unit tests + 9 Node tests + typecheck + build + post-build dist verification all pass.

- **Repo root**: `/Users/irfanulhaq/Desktop/Projects/browser-trust`
- **Build output**: `dist/` (load this folder as an unpacked extension in Chrome)
- **Testbed**: a loopback-only Node fixture at `127.0.0.1:4173` used to rehearse the demo

## 2. Required reading order

1. **`AGENTS.md`** — hard rules for any agent/contributor. **Do not violate.**
2. **`sol.md`** — product scope, architecture, phase plan, acceptance criteria.
3. **`README.md`** — stack, permissions, commands, user-facing docs.
4. **`PROGRESS.md`** — append-only log of what each phase landed (most recent entries are the current state).
5. **`src/`** — source. Entry point for the mental model: `src/background/index.ts`.

## 3. Stack

- TypeScript strict (TS 7)
- Chrome Manifest V3 (service worker, isolated + MAIN world content scripts)
- esbuild bundler (`scripts/build.mjs`)
- Vitest + Node's built-in test runner
- No runtime dependencies. Only devDependencies in `package.json`.
- Node 20+ required.

## 4. Commands

```bash
npm ci                # install (uses pinned lockfile)
npm run build         # bundle to dist/
npm run typecheck     # tsc --noEmit
npm test              # vitest + testbed node tests
npm run check         # typecheck + test + build + verify-dist
npm run testbed       # launch loopback-only synthetic site
npm run icons         # regenerate 16/48/128 brand PNGs
npm run format        # Prettier write
npm run format:check  # Prettier check
```

`npm run check` is the one command to run before claiming anything works.

## 5. Architecture in one page

Four execution contexts, one shared event pipeline, one bounded local store.

```
┌──────────────────────────── service worker ─────────────────────────────┐
│  src/background/index.ts     ─ lifecycle, message routing, sender gate  │
│  src/background/collector-manager.ts                                    │
│  src/background/alerts.ts    ─ in-page alert dialog / OS notif + badge  │
│  src/collectors/network.ts   ─ chrome.webRequest (before/completed/err) │
│  src/core/pipeline.ts        ─ validate → store → notify (non-blocking) │
│  src/core/store.ts           ─ bounded 1,000-event ring buffer          │
│  src/analysis/service.ts     ─ connects pipeline to rules → findings    │
└─────────────────────────────────────────────────────────────────────────┘
          ▲ ingest-event (untrusted)             ▲ privileged RPCs
          │                                      │
┌─────── content script (ISOLATED) ────────┐  ┌─ popup / activity page ─┐
│  src/content/index.ts                    │  │  src/popup/popup.ts     │
│  src/content/observers/                  │  │  src/popup/popup.html   │
│    page.ts, dom.ts, forms.ts,            │  │  src/popup/activity.html│
│    hook-relay.ts                         │  │  src/popup/popup.css    │
└──────────────────────────────────────────┘  └─────────────────────────┘
          ▲ CustomEvent (page world → isolated world)
          │
┌─ MAIN world (page's own JS context) ────┐
│  src/page-hooks/hooks.ts                │
│  src/page-hooks/describe.ts             │
└─────────────────────────────────────────┘
```

**The one invariant**: every event — from every source — flows through `EventPipeline.emit`. Nothing else writes to storage. Content scripts and MAIN-world messages are untrusted; the background rebuilds `source` from the browser message sender.

## 6. Source tree

```
src/
├── shared/            schema + messages + URL/PSL helpers
│   ├── types.ts         BrowserTrustEvent, EventCategory, severities
│   ├── messages.ts      MessageMap for background↔UI RPCs
│   ├── hook-protocol.ts shape of MAIN-world hook messages
│   ├── url.ts           describeUrl, toDestination (populates isCrossOrigin + isThirdParty)
│   └── psl.ts           lightweight registrable-domain heuristic
│
├── background/        service worker + lifecycle
│   ├── index.ts         entry point, message routing, sender gate
│   ├── collector-manager.ts
│   └── alerts.ts        in-page alert dialog (OS notification fallback) + icon badge for HIGH
│
├── collectors/        background event sources
│   ├── types.ts         Collector interface
│   ├── network.ts       chrome.webRequest (buildNetworkEvent + completed + failed)
│   └── index.ts
│
├── content/           isolated-world content script
│   ├── index.ts
│   ├── observer.ts
│   ├── alert-overlay.ts full-page "Suspicious activity detected" dialog (closed shadow root)
│   └── observers/       page, dom, forms, hook-relay, index
│
├── page-hooks/        MAIN-world API wrappers
│   ├── index.ts
│   ├── hooks.ts         fetch/XHR/beacon/WebSocket/storage/cookie/clipboard/geo/media/form
│   └── describe.ts      pure helpers (body shape, cookie attrs, throttle)
│
├── core/              pipeline + storage
│   ├── normalize.ts     createEvent, validateEvent, EventValidationError
│   ├── pipeline.ts      EventPipeline (non-blocking emit)
│   └── store.ts         EventStore (ring buffer, generation counter)
│
├── analysis/          rules + findings + destinations + assessment + report
│   ├── types.ts         Rule, Finding, EvidenceStrength
│   ├── engine.ts        analyze / analyzeEvent (chronological ordering)
│   ├── rules/index.ts   seven rules
│   ├── service.ts       connectAnalysis (drain, generation guard, 60s window)
│   ├── store.ts         FindingStore (bounded, deduped by stable id)
│   ├── destinations.ts  summarizeDestinations (merges by requestId)
│   ├── assessment.ts    assessSite (four states, honors allowlist)
│   ├── known-hosts.ts   ~90-entry allowlist of common sites
│   └── report.ts        buildReport + Markdown + JSON
│
├── config/            user-facing settings + permissions
│   ├── settings.ts      monitoring switch
│   ├── preferences.ts   theme + pinned + dismissed findings
│   └── access.ts        syncContentScripts, analyzeUrl, isOriginCovered
│
└── popup/             shared renderer for popup and activity page
    ├── popup.html
    ├── activity.html
    ├── popup.ts         one file does both views
    └── popup.css        single sheet with [data-theme="light"] override
```

## 7. Permissions declared in `public/manifest.json`

| Permission | Kind | Why |
|---|---|---|
| `storage` | Required | bounded local event + finding + preferences store |
| `scripting` | Required | dynamic content-script registration per granted origin |
| `activeTab` | Required | read current tab URL in the popup |
| `notifications` | Required | native OS alert when a high-severity finding fires |
| `webRequest` | Optional | observe network metadata; requested from the popup |
| `http://*/*`, `https://*/*` | Optional host permissions | user-granted per site or all sites |

Monitoring is a single on/off switch. BrowserTrust observes nothing until the user grants a site. Document any new permission in the README table.

## 8. The seven rules

| Rule | Severity | What it does not establish |
|---|---|---|
| Form submission followed by network request | medium | Does not prove form values were sent. |
| Scripted form.submit() followed by network | low | Hook-sourced, forgeable. |
| Sensitive capability call (geo / clipboard-read / media) | low | Not proof of granted access or success. |
| Capability call followed by network | medium (high if cross-origin POST) | Temporal association only. |
| Repeated cross-origin POST burst (3+) | medium (high at 6+) | Repetition is not malicious intent. |
| Hidden cross-origin iframe added | low | Attribute-only hidden hint. |
| Script injected dynamically from a different site | low | Many legitimate integrations do this. |

Assessment states: `insufficient-evidence`, `no-suspicious-activity-observed`, `review-recommended`, `suspicious-activity-detected`.

- **High** severity → `suspicious-activity-detected` AND shows a red-accented in-page alert dialog (OS notification fallback when the tab has no content script) + red `!` badge.
- **Medium** severity → `review-recommended` AND shows an orange-accented in-page alert dialog (OS notification fallback) + orange `!` badge.
- Everything above is suppressed for pages whose registrable domain is on the common-sites allowlist (`src/analysis/known-hosts.ts`).
- The allowlist's existence is NEVER mentioned in UI text — findings are still listed, just not escalated.

## 9. Hard rules — do not violate (from AGENTS.md)

- **Never store** raw form values, passwords, cookie/storage values, clipboard contents, or request/response bodies.
- **Strip query strings and fragments** from stored URLs unless the feature explicitly needs them and the README documents why.
- **Content/MAIN-world messages are untrusted.** A content script may only send `ingest-event`; privileged requests (`get-state`, `set-monitoring`, `list-events`, `list-findings`, `clear-events`) are refused from tabs *unless* the sender URL is one of the extension's own pages.
- Render event-derived text with `textContent` or DOM APIs. **Never `innerHTML`.**
- **Never hardcode a product hostname** for site access. Site access comes only from user-granted optional host permissions. (The allowlist in `known-hosts.ts` is a scoped exception the user explicitly authorized — it affects assessment severity only, not site access or data collection.)
- **No third-party network calls** in the extension at runtime.
- **No new frameworks or services.** TypeScript strict, no `any` outside the existing dynamic page-hook boundary.
- Service-worker listeners register synchronously at module load. Do not rely on in-memory state surviving worker suspension.
- Register through the existing registries (`src/collectors/index.ts`, `src/content/observers/index.ts`); do not open a second pipeline.
- The `testbed/` folder is a fixture only; extension code must never import it.

## 10. Known limitations (document, do not hide)

- `webRequest` coverage depends on both the optional permission and the user's granted host permissions.
- MAIN-world hooks see only wrapped entry points — a page can bypass them.
- Storage wrappers cover method calls; property-style access (`localStorage.key = v`) is invisible.
- API-call reports do not prove permission grant or success.
- Form events + later requests are not proof the form data was transmitted.
- The registrable-domain helper (`src/shared/psl.ts`) is a short multi-label suffix list, not the full PSL — uncommon TLDs may understate cross-site relationships.
- The common-sites allowlist trusts site identity, not site behavior.
- A real Chrome end-to-end demo has not been automated; manual verification is required before claiming anything about live Chrome behavior.

## 11. How to verify changes

1. `npm run check` — must be green (typecheck + Vitest + Node testbed tests + build + verify-dist).
2. For UI or runtime behavior, load `dist/` as an unpacked extension in Chrome:
   - Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, select `dist/`.
   - Grant the testbed host (`http://127.0.0.1:4173`) from the popup.
   - Grant the optional `webRequest` permission from the popup.
   - Reload the testbed page so dynamic scripts register.
   - Trigger the three testbed buttons (form, storage, repeat POSTs) and verify events, findings, destinations, and assessment behavior.
   - For the in-page alert dialog: trigger the "Send 3 requests" button multiple times to hit the HIGH-severity sustained burst threshold on a non-allowlisted host.

Never claim real-browser behavior works without actually testing it in Chrome.

## 12. Next-work ideas (open, non-blocking)

Documented at the bottom of `README.md` under **Future work**:
- ESLint (Prettier is already wired).
- Playwright or Puppeteer smoke test that loads `dist/` into headless Chrome and walks the testbed demo end-to-end.
- Rate-limited `system.worker.woken` lifecycle event in the activity timeline.
- A settings UI for rule thresholds (currently constants in `src/analysis/rules/index.ts`).
- Real popup screenshots for the top of the README.

Pick these up only after confirming all the hard rules in section 9 still hold.

## 13. First-session suggestions for an agent

1. Run `npm ci && npm run check`. Everything must pass before touching anything.
2. Read `AGENTS.md` and `sol.md` cover to cover.
3. Load `dist/` into Chrome and complete the demo flow in section 11 manually. Confirm what you observe matches `README.md`.
4. Skim `PROGRESS.md` bottom-up — the most recent entries describe the current behavior.
5. Pick a task from section 12, or ask the user. **Do not add features at the expense of making the end-to-end scenario reliable.** A small, polished, working demo is more valuable than a broad but unreliable feature set.
6. For every change: write/update tests, run `npm run check`, keep the three authoritative docs (`README.md`, `AGENTS.md`, `PROGRESS.md`) consistent with the actual code.

## 14. Minimum truthfulness bar

- Never claim a value was transmitted unless reliable evidence establishes it.
- Never label a website definitively safe simply because no suspicious behavior was detected.
- Distinguish Observed / Inferred / Unknown.
- Prefer explicit reasons over arbitrary numerical risk scores.
- If you did not run a check in Chrome, say so.
