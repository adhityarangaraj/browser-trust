# Progress

## Snapshot: Phase 2 in progress (checkpoint 2)

Done (Phase 1): MV3 foundation, event schema/validation/store/pipeline, popup, dynamic content-script registration.

Done so far in Phase 2:
- `src/shared/url.ts`: query/fragment-stripping URL description; `destination.isCrossOrigin`.
- Collector API changed to `attach()` (synchronous listener registration) + `isAvailable()`; events gated on the monitoring switch in `CollectorManager`.
- Network collector (`src/collectors/network.ts`, chrome.webRequest, optional permission, metadata only).
- Store coalesces concurrent appends; popup shows collector state and a permission button.
- 37 unit tests pass.

- Content observers: page, DOM (script/iframe/form), forms; hook relay (`src/content/observers/`).
- MAIN-world page hook (`src/page-hooks/`): fetch, XHR, beacon, WebSocket, Web Storage methods, cookie, clipboard, geolocation, getUserMedia/getDisplayMedia, form.submit/requestSubmit. `syncContentScripts` registers it as a second script (world MAIN).
- 64 tests pass (jsdom for observers; fake window for hooks).

Remaining in Phase 2 (in order):
3. `testbed/`: static test site + zero-dependency Node server that logs what it receives. Not imported by the extension.
4. Update README/AGENTS, final `npm run check`, zip.

Not verified in a real browser (no Chrome in the build environment).
