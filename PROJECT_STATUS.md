# Project status

_Last updated: 2026-10-10 — Phase 0_

## Current phase: 0 — Project foundation

Acceptance criterion: _the app launches on Windows, creates a database and saves/reloads a test project._

| Item | Status |
| --- | --- |
| Electron + React + TypeScript (strict) + Vite via electron-vite | Done |
| Secure process boundaries (context isolation, sandbox, no Node in renderer, CSP, navigation/popup blocking, permission denial) | Done |
| Typed IPC, zod-validated input, sender-frame check, error envelope | Done |
| SQLite (better-sqlite3) with versioned, checksummed migrations and pre-migration backups | Done |
| Persistent settings (accent color, export folder, render concurrency) | Done |
| User-configurable data folder (applies after restart) | Done |
| File logging with rotation; renderer errors forwarded to the log | Done |
| Navigation: Home, Songs, Media Library, Create, Presets, Exports, Settings | Done (unbuilt areas are clearly labelled, no fake controls) |
| Song project create / rename / delete / persist | Done |
| Unit tests (38) | Written and passing — see verification note |
| E2E smoke test (launch, create, restart, verify; renderer isolation) | Written, **not yet run** |
| README, TECHNICAL_DECISIONS | Done |

### Verification so far

The project was written in a sandbox that blocks the npm registry, so dependencies could not be installed there. What was verified:

- **All 38 unit tests pass** (migrations, rollback, checksum and downgrade protection, backups, project CRUD, persistence across close/reopen, settings validation and fallbacks, logger rotation and serialization, folder layout, IPC validation and error handling, sender validation). They were run on Node 22 with `node:sqlite` and zod 3.25.76, using a minimal stand-in for Vitest's API.
- **Type check passes with zero errors** for main, preload, shared, tests and renderer, against the Electron 37.2.0, Node, React and better-sqlite3 type definitions.
- **UI rendered and clicked through** in Chromium with a mock of the preload API: every screen renders, the create-project flow works, no console errors.

**Not yet verified:** `npm install`, `npm run dev`, the production build, the Electron window itself and the E2E test. These need a first run on Windows:

```powershell
npm install
npm test
npm run typecheck
npm run dev          # create a project, close, reopen → it should still be there
npm run test:e2e
```

## Known issues / limitations

- Dependency versions are pinned by caret range from known releases but were not resolved together by an actual install. If `npm install` reports a peer conflict, adjust and record it in TECHNICAL_DECISIONS.
- Changing the data folder does not move existing data (by design for now; the UI says so).
- No app icon yet (electron-builder uses its default).
- FFmpeg licensing/distribution is not decided yet (needed in Phase 1).

## Next task

1. Run the verification commands above on Windows and fix anything that breaks. Update this file with the result.
2. Then **Phase 1 — Media ingestion**:
   - Decide how FFmpeg/FFprobe are provided (bundled vs. user-installed) and document licensing in TECHNICAL_DECISIONS.
   - Migration v2: `media_assets`, `media_segments`; add `songs.source_audio_*` metadata as needed.
   - Import audio into a song project; import video files/folders into the library (file dialog + drag-and-drop).
   - FFprobe metadata extraction and thumbnail generation in a background job (not in IPC handlers).
   - Media Library screen: grid, preview, tags.
   - Missing-file detection and relink.
   - Acceptance: import a song and several clips, restart, everything is still there.
