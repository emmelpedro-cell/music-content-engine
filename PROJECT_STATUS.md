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
| Unit tests (38) | Passing on Windows CI |
| E2E smoke test (launch, create, restart, verify; renderer isolation) | Passing on Windows CI |
| README, TECHNICAL_DECISIONS | Done |

### Verification

**Phase 0 accepted** — verified on a real Windows machine (GitHub Actions `windows-latest`, run 38006744034, 2026-10-10):

- `npm install` resolves all dependencies (Electron 37.10.3, electron-builder 26.15.3, Vite 7.3.7) and rebuilds better-sqlite3 for Electron.
- `npm run typecheck`: no errors.
- `npm test`: all unit tests pass.
- `npm run test:e2e`: the built Electron app launches, creates its database, creates a project, restarts and finds it again; the renderer has no access to `require`, `process` or `ipcRenderer`.
- `npm run dist:win`: NSIS installer builds (uploaded as the `windows-installer` artifact).

CI runs all of the above on every push (`.github/workflows/ci.yml`).

## Known issues / limitations

- No `package-lock.json` committed yet; CI uses `npm install`. Commit the lockfile from the first local install and switch CI to `npm ci`.
- The installer is unsigned, so Windows SmartScreen will warn when it is run.
- Changing the data folder does not move existing data (by design for now; the UI says so).
- No app icon yet (electron-builder uses its default).
- FFmpeg licensing/distribution is not decided yet (needed in Phase 1).

## Next task

1. **Phase 1 — Media ingestion**:
   - Decide how FFmpeg/FFprobe are provided (bundled vs. user-installed) and document licensing in TECHNICAL_DECISIONS.
   - Migration v2: `media_assets`, `media_segments`; add `songs.source_audio_*` metadata as needed.
   - Import audio into a song project; import video files/folders into the library (file dialog + drag-and-drop).
   - FFprobe metadata extraction and thumbnail generation in a background job (not in IPC handlers).
   - Media Library screen: grid, preview, tags.
   - Missing-file detection and relink.
   - Acceptance: import a song and several clips, restart, everything is still there.
