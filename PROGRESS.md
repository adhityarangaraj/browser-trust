# Progress

## Phase 2 implementation checkpoint

Implemented:

- MV3 extension foundation, dynamic optional host access, monitoring switch, collector lifecycle, validated event pipeline, local 1,000-event ring buffer, and popup event display.
- Metadata-only `webRequest` collector with optional permission state and retry after permission registration failures.
- Isolated page/DOM/form observers and MAIN-world hooks for selected page APIs, relayed as untrusted events.
- Popup activity rows identify evidence mechanism, collector, and provenance. Permission requests use the current popup page snapshot and remain in the click handler's user-gesture context.
- Separate `testbed/` demo page and built-in Node HTTP collector. It binds to `127.0.0.1`, exercises synthetic form input/submission and storage, accepts one exact synthetic payload, limits request size, and logs no arbitrary request data. Extension sources do not import testbed files or contain its host/port.
- README, this file, manifest description, and agent guidance updated to match the implementation. `AGENTS.md` instructs future agents to read `sol.md` before planning or implementation.

Not implemented (outside this Phase 2 completion): live detection rules/findings, correlation, explanations, or AI analysis. The analysis engine is not wired into the event pipeline.

## Verification in this workspace

- `npm.cmd run typecheck`: passed after the implementation changes.
- `node --test testbed/server-test.mjs`: passed, 5/5 tests, including invalid and oversized payload rejection.
- `npm.cmd run build`: passed and generated the expected extension bundles in ignored `dist/`.
- `npm.cmd test`: 56 tests passed; two DOM-dependent test files could not start because `jsdom` is declared but missing from the installed `node_modules`. No dependencies were installed in this workspace.
- A clean `npm run check` is not yet verified because the Vitest step is blocked by the missing `jsdom` installation. Re-run after dependencies are installed.
- Manual Chrome/Chromium checks of permission prompts, dynamic script registration, live event delivery, and popup display have not been performed.

## Remaining

1. Install the existing locked dependencies, then run `npm run check` and resolve any code/test failures.
2. Load `dist/` in Chrome/Chromium, grant a site and optional `webRequest`, run the local testbed, and manually confirm observed activity appears in the popup with the correct evidence labels.
