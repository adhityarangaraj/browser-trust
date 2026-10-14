# AGENTS.md

Guidance for AI agents and contributors working on BrowserTrust.

**Before planning or implementing any change, read both `README.md` and `sol.md`.** `sol.md` is the source of truth for the product plan, phase boundaries, architecture, and acceptance criteria. Keep it, this file, and `PROGRESS.md` consistent with the actual implementation. Read the README first for stack, commands, and permissions.

## Product and scope

BrowserTrust is a standalone, general-purpose Chrome Manifest V3 extension for observing and explaining selected website behavior. Do not integrate with, depend on, or shape product behavior around Redact Agent, uBlock Origin, or another extension. `testbed/` is a fixture only; extension code must never import or depend on it. Do not claim a capability works unless code observes it and tests or a documented manual check support the claim.

Phase 2 covers metadata collection, page observers and selected MAIN-world hooks, local event processing/storage, the popup, and the isolated local testbed. Detection rules, findings, correlation, and AI analysis are not live features.

## Architecture

| Responsibility | Location | Runs in |
| --- | --- | --- |
| Lifecycle, message routing | `src/background/index.ts` | service worker |
| Background event sources | `src/collectors/` managed by `src/background/collector-manager.ts` | service worker |
| Page event sources | `src/content/` observers and bootstrap | isolated content script |
| Selected page API wrappers | `src/page-hooks/` | MAIN world |
| Validation, storage, ingestion | `src/core/` | service worker |
| Analysis types/engine | `src/analysis/` | not wired into live collection |
| Settings and site access | `src/config/` | extension contexts |
| UI | `src/popup/` | popup |
| Schema and messages | `src/shared/` | shared |
| Local test fixture | `testbed/` | standalone Node process/browser page; never imported by extension |

Entry points are bundled by `scripts/build.mjs`: `src/background/index.ts` to `background.js` (ESM), `src/content/index.ts` to `content.js` (IIFE), `src/page-hooks/index.ts` to `page-hook.js` (IIFE), and `src/popup/popup.ts` to `popup.js` (IIFE). Static extension files are copied into `dist/`.

**All events go through `EventPipeline`** (`emit` for collectors, `ingestFromContent` for content scripts). No other module writes events to storage.

## Conventions

- TypeScript strict mode; do not add `any` outside the existing dynamic page-hook boundary. Validate untrusted input.
- Keep browser API code thin. Keep pure logic importable without `chrome`; do not call `chrome.*` at module top level in core logic.
- Register service-worker listeners synchronously at module load. Do not rely on in-memory state surviving worker suspension.
- Event actions are lowercase dotted words; collector IDs are namespaced.
- Add a collector or observer through its registry. Avoid new frameworks, services, or unnecessary abstractions.
- Tests live in `tests/*.test.ts`; testbed HTTP server tests use Node's built-in test runner. Run `npm run check` before handoff when the environment permits.
- Update README status and `PROGRESS.md` when capabilities change. Report exact failed or unavailable checks.

## Security constraints

- Never store raw form values, passwords, cookie/storage values, clipboard contents, or request/response bodies. Record metadata such as type, size, API, and host.
- Strip query strings and fragments from stored URLs unless a feature explicitly needs them and the README documents why.
- Content/page messages are untrusted. A content script may only send `ingest-event`; the background derives source from `sender` and ignores any claimed source. Reject privileged messages (`get-state`, `set-monitoring`, `list-events`, `clear-events`) from tabs.
- Render event data with `textContent` or DOM APIs, never `innerHTML`.
- Never hardcode a product hostname. Site access comes only from user-granted optional host permissions. The local testbed hostname may appear only in `testbed/` and its documentation.
- Do not add third-party network calls to the extension. Any future AI analysis must be optional/off by default and receive only normalized/minimized events.
- Document any new permission in the README table.

## Extending the project

- Background sources implement `Collector`, register in `src/collectors/index.ts`, document/request optional permissions through the popup, and emit via `CollectorContext`.
- Page sources implement `ContentObserver`, register in `src/content/observers/index.ts`, and emit `ContentEventInput` only.
- MAIN-world hooks register in `syncContentScripts` at `document_start`; relay as untrusted input through the isolated script. Document bypass limits.
- Future rules must cite supporting event IDs and be explicitly wired into analysis. Inferred events must set `provenance: 'inferred'` and `relatedEventIds`; never rewrite observed events.
- Keep testbed fixtures in `testbed/`. The extension must never import testbed files or encode its host/port as product behavior.
- If message types change, update `src/shared/messages.ts` and sender checks in `src/background/index.ts`.
