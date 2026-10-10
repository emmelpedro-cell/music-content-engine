# Technical decisions

Each entry: the decision, the alternatives, and why.

## TD-001 — electron-vite as the build tool

**Decision:** electron-vite 4 (Vite 7 under the hood) builds main, preload and renderer.
**Alternatives:** hand-rolled Vite + tsc + concurrently; Electron Forge with the Vite plugin.
**Why:** one config for the three Electron targets, dev-server URL injection and hot reload out of the box, and it stays plain Vite for the renderer. Forge adds packaging opinions we don't need yet; electron-builder handles packaging.

## TD-002 — better-sqlite3 behind a small driver interface

**Decision:** production uses `better-sqlite3`. All database code depends on a four-method `SqlDriver` interface (`exec`, `prepare`, `close`, plus a shared `transaction` helper). Unit tests run the same code on Node's built-in `node:sqlite`.
**Alternatives:** `node:sqlite` in production; `sqlite3` (async); an ORM (Drizzle, Prisma).
**Why:**
- better-sqlite3 is synchronous, fast and well proven in Electron, with prebuilt binaries per Electron version.
- After `npm install`, better-sqlite3 is rebuilt for Electron's ABI, so plain-Node test runners can't load it. Running tests on `node:sqlite` avoids the classic "compiled against a different Node.js version" problem without maintaining two builds.
- `node:sqlite` is still flagged experimental and its availability inside Electron's Node is not guaranteed, so it isn't used in production yet. Revisit once it is stable.
- Only positional `?` parameters are used, because the two drivers handle named parameters differently.
- No ORM: the schema is small and explicit SQL migrations are easier to audit.

## TD-003 — Migrations: append-only, checksummed, one transaction each, backup first

**Decision:** migrations are a TypeScript array of SQL strings with strictly increasing versions. Each runs in its own transaction and is recorded in `schema_migrations` with a SHA-256 checksum. Before migrating an existing database, a consistent copy is written to `app-data/backups/` with `VACUUM INTO` (last 10 kept).
**Why:** spec requires recoverable migrations. A failed migration rolls back and leaves the previous version intact; editing a shipped migration is detected at startup instead of silently diverging; opening a database from a newer build is refused with a clear message. `VACUUM INTO` gives a valid single-file copy even in WAL mode, unlike copying the file.
**Scope:** Phase 0 only creates `songs` and `app_settings`. Other entities from spec §14 get their own migrations in the phases that use them, so no table exists before code that maintains it.

## TD-004 — A "project" is a song

**Decision:** the `songs` table is the project entity. `source_audio_path` and `duration_seconds` are nullable until audio import exists.
**Why:** spec §4.2 defines the song as the reusable content project that owns analysis, lyrics, hooks and edits. A separate `projects` table would duplicate it.

## TD-005 — IPC: one validated handler table, result envelope

**Decision:** every channel is declared in `shared/channels.ts` and implemented in a single handler table (`main/ipc/handlers.ts`). Each handler has a zod schema; input is parsed before any code runs, including channels that take no input. Handlers return `{ ok: true, data } | { ok: false, error: { code, message } }`. Unexpected errors are logged in full and returned to the renderer as a generic message.
**Why:** Electron strips error details across `invoke`, so typed results give the UI actionable messages. A single table makes it testable without Electron and ensures every channel has validation (a test checks that each declared channel has a handler).
Additionally, every call checks `event.senderFrame.url` against the app's own page (dev server origin or the bundled `index.html`).

## TD-006 — Renderer isolation

**Decision:** `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP, popups denied (http(s) links open in the system browser), navigation blocked, all permission requests denied. The preload exposes only named functions on `window.mce`, never `ipcRenderer`.
**Why:** spec §21 rules 10–12. Because the preload runs sandboxed, it cannot `require()` packages; it imports only constants and types, and the build bundles it.

## TD-007 — Data folder location via a bootstrap file

**Decision:** default root `Documents\MusicContentEngine`; a user-chosen root is stored in `userData/bootstrap.json` (atomic write); `MCE_DATA_DIR` overrides both. Changing it applies after restart and does not move data.
**Why:** the database lives inside the root, so it can't store its own location. Not moving data automatically avoids a risky multi-gigabyte copy before there's a proper progress/recovery UI for it.

## TD-008 — Settings as validated key/value rows

**Decision:** `app_settings(key, value_json)`; each key validated with zod on read, falling back to its default (and logging) when invalid; unknown keys ignored. Directory settings can only be changed through native folder dialogs in main, not set to arbitrary strings from the renderer.
**Why:** one corrupt value must never stop the app from starting; newer builds can add keys without a migration; the renderer can't point the app at arbitrary paths.

## TD-009 — Logging: synchronous JSON lines with rotation

**Decision:** small in-house logger, `app-data/logs/app.log`, JSON per line, 5 MB rotation, 3 files kept; errors serialized with stack; renderer errors and unhandled rejections forwarded through a validated IPC channel.
**Alternatives:** electron-log, pino.
**Why:** the volume is low, synchronous writes guarantee the last line before a crash is on disk, and it is ~100 lines with no dependency. Revisit if render workers need high-volume logging.

## TD-010 — Styling with plain CSS and design tokens

**Decision:** one stylesheet with CSS custom properties; the accent color is a user setting applied as `--accent`. No Tailwind or component library yet.
**Alternatives:** Tailwind + shadcn/ui (spec's first suggestion), CSS Modules.
**Why:** Phase 0 has a handful of screens; adding Tailwind and shadcn now means more dependencies and build config before there is UI that benefits. Revisit at Phase 3–4 when the timeline and draft grid need many interactive components (Radix primitives via shadcn are the likely choice for dialogs, menus and sliders).

## TD-011 — Tests

**Decision:** Vitest for unit tests (Node environment, `node:sqlite`), Playwright's Electron support for E2E against the built app with an isolated `MCE_DATA_DIR`.
**Why:** spec §3. E2E covers the Phase 0 acceptance criterion directly (create → restart → still there) and asserts the renderer has no Node access.

## TD-012 — Bundle a pinned LGPL FFmpeg build (BtbN 9.0.2, shared)

**Decision:** ship FFmpeg 9.0.2 from BtbN/FFmpeg-Builds, variant `lgpl-shared`, pinned to a month-end release by URL and SHA-256 (`scripts/ffmpeg-sources.json`). `scripts/fetch-ffmpeg.mjs` downloads and verifies it into `vendor/ffmpeg/<platform>-<arch>` (on `npm install` and before packaging); electron-builder copies it to `resources/ffmpeg`. Details and license obligations: `docs/FFMPEG.md`.
**Alternatives:** `ffmpeg-static`/`ffprobe-static` (GPL, mismatched versions); gyan.dev builds (GPL v3); a user-installed FFmpeg (spec requires bundling; unknown version); a GPL build with libx264.
**Why:**
- LGPL keeps the app's own licensing free: FFmpeg runs as separate, replaceable programs and libraries, and the obligations are notices plus corresponding source (documented, with the texts shipped).
- Shared libraries: one set of DLLs for both programs (the archive is 77 MB, against 171 MB for the static variant that embeds every library in each executable), and they are user-replaceable as the LGPL intends.
- Pinning by checksum makes builds reproducible and tamper-evident; the CI cache stores the archive and the checksum is re-verified after restore.
**Consequence for later phases:** no libx264. H.264 export (Phase 3) will use OpenH264 (BSD) or a hardware encoder; OpenH264 output quality per bitrate is lower than x264's. If that turns out to matter, the options are a GPL build (then the whole distribution must comply with the GPL) or another encoder. To be measured in Phase 3, not assumed.

## TD-013 — Media processing in the main process, as child processes, behind one service

**Decision:** `ImportService` (main process) owns importing: it scans selections, records assets in SQLite, and runs FFprobe/FFmpeg with `runProcess` (async `spawn`, argument arrays, no shell, timeouts, kill on abort). React components only call IPC and render state pushed back over `media:event`.
**Alternatives:** a Node worker thread or utility process; a separate job runner process.
**Why:** all heavy work already happens in FFmpeg child processes, so the main process only awaits them and never blocks. A worker would add a second state owner without moving real CPU work off the main thread. Revisit for Phase 2 audio analysis, which may compute in JavaScript.

## TD-014 — Validate content, not extensions

**Decision:** an import passes three checks: (1) FFprobe reads the container and streams; (2) `interpretProbe` rejects still images, files without audio/video, undecodable codecs and files without a duration, and treats cover art as audio; (3) FFmpeg decodes the first 3 seconds of the main stream. Extensions only decide which files inside a folder are considered at all; files the user picks or drops explicitly are always probed.
**Why:** spec Phase 1. Renamed text files, half-copied videos and images with video extensions are caught with a specific message instead of failing later during editing.

## TD-015 — Duplicate detection and file identity

**Decision:** the same path (case-insensitive on Windows) is never imported twice (`UNIQUE path_key`). The same content at a different path is detected with a quick fingerprint: SHA-256 over the size and three 1 MB samples (start, middle, end), and the new entry is dropped with a notice. The fingerprint also verifies relinks.
**Alternatives:** full-file hashing (minutes for large camera files), or size + name only (false matches).
**Why:** fast on multi-gigabyte files and reliable for telling recordings apart. Not a cryptographic identity: two files differing only outside the sampled regions would match, which is acceptable for this purpose.

## TD-016 — Asset model, missing files and relinking

**Decision:** `media_assets` stores a reference to the original file, metadata, processing status (`pending → processing → ready | error`) and availability (`online | missing`) separately. Availability is checked at startup, when the window regains focus (throttled) and when the library opens. Missing assets keep their metadata and thumbnail. Relinking takes a single file (confirmed by fingerprint; a different file needs explicit confirmation and is re-analysed) or a folder (matched by name and size, then fingerprint). A song's audio is now `songs.audio_asset_id` (FK, `ON DELETE SET NULL`); `songs.source_audio_path` and `songs.duration_seconds` from v1 are unused and stay in the table (SQLite can't drop columns without rebuilding the table, which isn't worth it for unused nullable columns).
**Why:** spec requires preserving references and never moving or deleting source media. Splitting status from availability means a moved file doesn't lose its analysis.

## TD-017 — Persistent queue with recovery

**Decision:** queue state is the `status` column. On start, `processing` rows go back to `pending` and every `pending` row is queued; leftover temp files (only names with the `mce-` prefix, only in `app-data/temp`) are deleted. Two files are analysed at a time. Cancelling removes the entry and any thumbnail; quitting stops FFmpeg and leaves work for the next start. If FFmpeg becomes unavailable, items stay pending and resume after a successful "Check again".
**Why:** spec §4 reliability: interruptible, recoverable, no orphaned processes or temp files.

## TD-018 — Preview through a custom protocol

**Decision:** `mce-media://asset/<id>` streams the original file with HTTP range support (seeking); `mce-media://thumb/<id>` serves thumbnails. Only ids present in the database resolve, thumbnails only from the thumbnails folder. CSP allows `mce-media:` for `img-src` and `media-src` only.
**Alternatives:** `file://` URLs (would require relaxing `webSecurity` and expose arbitrary paths); `net.fetch` of `file://` inside the handler (range handling not reliable for seeking).
**Why:** the renderer can preview library media without ever handling a file path. No proxies are generated: Chromium plays H.264/VP9/AV1/AAC/MP3/FLAC/WAV directly; other codecs (e.g. ProRes, HEVC on some machines) show a clear "can't preview, imported correctly" message. Proxies arrive with the timeline (Phase 4) only if needed.

## TD-019 — Drag-and-drop without trusting renderer paths

**Decision:** the preload derives paths with `webUtils.getPathForFile` from the dropped `File` objects and sends those to main; the renderer never supplies path strings. Main validates the list (count, length) and stats every path.
**Why:** since Electron 32 `File.path` is gone; and this keeps a compromised renderer from asking main to read arbitrary files.

## TD-020 — Separate tsconfig for E2E tests; real FFmpeg in unit tests

**Decision:** `tsconfig.e2e.json` adds DOM types for Playwright `page.evaluate` callbacks. Unit tests that touch media use the real pinned FFmpeg and generate their fixtures with it (`tests/helpers/media.ts`); without FFmpeg they skip locally but fail in CI.
**Why:** media handling is only meaningful against the real tools; generated fixtures avoid committing binary media.

## Open decisions

- **H.264 export encoder** (Phase 3): OpenH264 vs. hardware encoders vs. a GPL build with libx264 (see TD-012).
- **Audio analysis runtime** (Phase 2): Essentia.js in a worker vs. a Python worker with librosa/madmom.
- **Transcription engine** (Phase 2): whisper.cpp binary vs. Python faster-whisper; word-level alignment approach.
- **Remotion licensing** (Phase 3): free for individuals and small teams; check the current license terms before any commercial distribution.
