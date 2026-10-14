# AGENTS.md

Guidance for AI agents and contributors working on BrowserTrust. Read `README.md` first for the stack, commands and permissions.

## What this is

A general-purpose Chrome MV3 extension that will observe what arbitrary websites do with their access and explain suspicious behavior. It is standalone: do not integrate with, depend on, or shape the design around Redact Agent, uBlock Origin or any other extension. Test fixtures must never define product behavior.

Phase 1 is a foundation. Do not describe a capability as working unless code observes it and a test or manual check shows it.

## Architecture

| Responsibility | Location | Runs in |
| --- | --- | --- |
| Lifecycle, message routing | `src/background/index.ts` | service worker |
| Background event sources | `src/collectors/` (`Collector`, `collectors` registry) managed by `src/background/collector-manager.ts` | service worker |
| Page-level event sources | `src/content/` (`ContentObserver`, `observers` registry, `index.ts` bootstrap) | content script, isolated world |
| Validation, storage, ingestion | `src/core/` (`normalize.ts`, `store.ts`, `pipeline.ts`) | service worker |
| Rules and findings | `src/analysis/` (`types.ts`, `engine.ts`, `rules/`) | not wired yet |
| Settings and site access | `src/config/` | any extension context |
| UI | `src/popup/` | popup |
| Schema and messages | `src/shared/` | everywhere |

Entry points (bundled by `scripts/build.mjs`): `src/background/index.ts` → `background.js` (ESM), `src/content/index.ts` → `content.js` (IIFE), `src/popup/popup.ts` → `popup.js` (IIFE). `public/manifest.json` and `src/popup/popup.{html,css}` are copied to `dist/`.

Key rule: **all events go through `EventPipeline`** (`emit` for collectors, `ingestFromContent` for content scripts). Nothing else writes events to storage.

## Conventions

- TypeScript strict mode; no `any`. Validate untrusted input at boundaries (`validateEvent`, message handlers).
- Keep browser-API code thin and put logic in pure functions that tests can import without `chrome`. Files under `src/core` and the pure parts of `src/config/access.ts` are tested this way; do not call `chrome.*` at module top level in them.
- Service worker: register listeners synchronously at top level; keep no state that must survive a restart in memory.
- Event actions are lowercase dotted words (`request.sent`). Collector ids are namespaced (`network.webrequest`).
- No unnecessary abstractions or backend services. Add a registry entry rather than a new framework.
- Tests live in `tests/*.test.ts`. Run `npm run check` before handing work back.
- Documentation stays short and accurate. Update README status and PROGRESS.md with each change in capability.

## Security constraints

- Never store raw sensitive values: form field values, passwords, cookie or storage values, clipboard contents, request or response bodies. Record metadata (field type, size, API name, host) instead.
- Strip query strings and fragments from stored URLs unless a feature explicitly needs them and the README says so.
- Content scripts and the page share a hostile environment. A content script may only send `ingest-event`; the background derives `source` from the message sender and ignores any source the content script claims. Privileged messages (`get-state`, `set-monitoring`, `list-events`, `clear-events`) are rejected when they come from a tab.
- Render event data in the UI with `textContent` or DOM APIs, never `innerHTML`.
- Never hardcode hostnames. Site access comes only from user-granted optional host permissions.
- No network calls to third parties from the extension. Any AI analysis must be local or explicitly opt-in, and must receive normalized events, not raw page content.
- Do not request new permissions without documenting them in the README table.

## Extending in later phases

- **New background source** (e.g. webRequest metadata): implement `Collector`, add it to `src/collectors/index.ts`, declare any new optional permission in `public/manifest.json` and README, request it from the popup on user action, emit through the provided `CollectorContext`.
- **New page source** (DOM, forms): implement `ContentObserver`, add it to `src/content/observers/index.ts`. Emit `ContentEventInput` only.
- **Page API hooks** (fetch, storage, clipboard, geolocation): requires a MAIN-world script. Register it in `syncContentScripts` (`world: 'MAIN'`, `runAt: 'document_start'`), add an esbuild entry in `scripts/build.mjs`, and relay its events through the isolated content script (e.g. `window.postMessage` with a per-page nonce), treating them as untrusted. Mark evidence `mechanism: 'main-world-hook'` and document bypass limits.
- **Detection**: add `Rule`s to `src/analysis/rules/index.ts`, subscribe `analyze` to `pipeline.subscribe`, store findings separately from events. Findings must cite `eventIds`; inferred events must set `provenance: 'inferred'` and `relatedEventIds`.
- **Correlation**: produce inferred events or findings that reference observed ones; never rewrite observed events.
- **AI analysis**: implement `BehaviorAnalyzer`, optional and off by default.
- **Phase 2 test site and collector**: add them as separate top-level directories (e.g. `testbed/`) that the extension never imports. Test the extension through its normal collectors and observers.
- Add or change UI in `src/popup/`; if the message set changes, update `src/shared/messages.ts` and the sender checks in `src/background/index.ts`.
