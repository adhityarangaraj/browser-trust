# Progress

## Phase 3 implementation checkpoint

Implemented in the existing Phase 2 architecture:

- Connected deterministic analysis to the shared event pipeline and added bounded, locally persisted findings with stable IDs and duplicate prevention.
- Added explainable findings for trusted form activity followed by browser-observed requests, selected sensitive API calls, capability-call/request temporal relationships, and repeated cross-origin POST observations.
- Findings include supporting event IDs and timestamps, source/destination where available, evidence strength, and explicit limitations. Request bodies and sensitive field values are not collected.
- Added grouped destination summaries that retain observation counts and label browser metadata versus page-hook evidence.
- Reworked the popup around monitoring and permission coverage, evidence-based assessment states, event/network/finding counts, expandable evidence, destinations, and recent activity.
- Kept the product general-purpose; the loopback testbed remains separate from extension source code.
- Updated README and agent guidance. `AGENTS.md` explicitly requires reading `sol.md` before planning or implementation.

## Verification in this workspace

- `npm.cmd run typecheck`: passed.
- `vitest run --maxWorkers=1`: passed, 17 files and 89 tests. The default highly parallel run hit a timeout in the DOM mutation-cap test; the single-worker run passed. The package test script now uses one worker for repeatable execution.
- `node --test testbed/server-test.mjs`: passed, 5/5 tests.
- `npm.cmd run build`: passed and generated `dist/` bundles.
- `npm.cmd run check` after the script update: passed end to end (typecheck, all 89 Vitest tests, all 5 collector tests, and build).
- No real Chrome/Chromium end-to-end demo or ordinary-site check was performed. Browser presence alone does not verify extension permissions, dynamic script registration, event delivery, or popup rendering.

## Remaining before Phase 3 is demo-ready

1. In Chrome/Chromium, load `dist/`, grant the testbed host and optional `webRequest` permission, reload the testbed page, then verify form, storage, page-hook, and browser network events; inspect destination metadata and the correlated finding/evidence.
2. Verify monitoring-off, missing-permission, and empty-activity states, then grant access to one ordinary site and confirm behavior is not testbed-specific.
3. Record the manual results here and update README only if observed behavior differs from the documented flow.

Phase 3 is implemented and automated checks largely pass, but it is not marked demo-ready until the remaining commands and real-browser checks above are completed.
