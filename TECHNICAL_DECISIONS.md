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

## Open decisions

- **FFmpeg distribution and licensing** (Phase 1): bundle an LGPL build vs. require a user-installed FFmpeg. Must be documented before packaging binaries.
- **Audio analysis runtime** (Phase 2): Essentia.js in a worker vs. a Python worker with librosa/madmom.
- **Transcription engine** (Phase 2): whisper.cpp binary vs. Python faster-whisper; word-level alignment approach.
- **Remotion licensing** (Phase 3): free for individuals and small teams; check the current license terms before any commercial distribution.
