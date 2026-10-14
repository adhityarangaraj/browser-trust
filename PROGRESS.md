# Progress

## Snapshot: Phase 1 complete (foundation)

- TypeScript + esbuild + Vitest; MV3 extension builds to `dist/`.
- Service worker, popup (monitoring toggle, per-site access, empty state), dynamic content-script registration on user-granted origins.
- Event schema, validation, local store (1000-event ring buffer), single ingestion pipeline.
- Empty registries and interfaces for collectors, content observers and rules.
- Verified: `npm run typecheck`, `npm test` (30 tests) and `npm run build` pass. Not yet loaded in a real browser session or tried on live sites.
- No monitoring, detection or AI exists yet.

## Next: Phase 2

- Controlled test website and local collector as separate directories, not imported by the extension.
- First real collectors through the existing registries: page lifecycle and network request metadata (`webRequest`), DOM and form observers.
- MAIN-world hook script for storage and `fetch`/XHR, relayed through the content script.
- Popup shows real events; tests run through the same general-purpose pipeline.
- Verify the extension manually in Chrome and record the result.
