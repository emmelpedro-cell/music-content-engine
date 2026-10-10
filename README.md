# Music Content Engine

Desktop app for musicians: one song + many clips + one visual style → many editable, beat-synchronized short videos.
Local-first, Windows 10/11, Electron + React + TypeScript.

**Current state: Phase 1 (media ingestion).** Song projects, plus a Media Library: import audio and video (files, folders or drag-and-drop), real metadata from FFprobe, video thumbnails, preview, missing-file detection and relinking. A song's audio is chosen from the library. Analysis, editing and rendering are not built yet; their screens say so. See `PROJECT_STATUS.md`.

## Requirements

- Windows 10 or 11 (x64)
- [Node.js](https://nodejs.org/) **22.13 or newer** (22 LTS recommended). Unit tests use Node's built-in SQLite.
- Git (optional)

Internet access during `npm install`: besides npm packages, it downloads the pinned FFmpeg build (~77 MB, checksum-verified) into `vendor/ffmpeg/`. See [docs/FFMPEG.md](docs/FFMPEG.md).

`better-sqlite3` is a native module. `npm install` downloads a prebuilt binary for Electron automatically. Only if that download fails will it try to compile, which needs Visual Studio Build Tools with the "Desktop development with C++" workload (see Troubleshooting).

## Setup and run

```powershell
cd music-content-engine
npm install
npm run dev
```

`npm run dev` starts Vite with hot reload and opens the Electron window.

If `npm install` couldn't download FFmpeg (offline, proxy), the app still starts but the Media Library says import is unavailable. Fix it with:

```powershell
npm run fetch:ffmpeg
```

## Using the Media Library

- **Import files…** / **Import folder…**, or drag files and folders onto the window. Folders are scanned recursively for audio and video files; explicitly chosen files are always checked, whatever their extension.
- Each file is checked by FFprobe and a short decode, so damaged files, renamed documents and still images are rejected with a clear message instead of failing later.
- Files stay where they are. The library stores a reference, metadata and (for video) a 480-pixel-wide thumbnail. **Remove from library** never deletes the file.
- If a file is moved or renamed, it shows **File missing** but keeps its metadata. Use **Relink…** on the file, or **Search a folder…** to find all missing files at once.
- The same file can't be added twice: not by path, and not as a copy under another name.
- Imports run in the background (two files at a time), can be cancelled, and resume after a crash or forced quit.
- Supported: anything the bundled FFmpeg reads, including MP4, MOV, MKV, WebM, AVI, MTS, WAV, MP3, FLAC, M4A/AAC, AIFF, OGG and Opus. The built-in preview plays what Chromium can decode (H.264, VP8/9, AV1, AAC, MP3, FLAC, WAV, Opus); other codecs (e.g. ProRes) import fine and say the preview isn't available.

## Scripts

```powershell
npm run dev            # development, hot reload
npm run build          # production build into out/
npm start              # run the production build
npm test               # unit tests (Vitest), including real FFmpeg runs
npm run typecheck      # TypeScript, strict mode: main, renderer, E2E
npm run test:e2e       # build, then drive the real app with Playwright
npm run dist:win       # Windows installer into dist/ (includes FFmpeg)
npm run test:packaged  # Playwright against dist/win-unpacked (after dist:win)
npm run fetch:ffmpeg   # (re)install the pinned FFmpeg into vendor/ffmpeg
```

## Where data lives

By default: `Documents\MusicContentEngine\`

```
MusicContentEngine\
├── app-data\
│   ├── database.sqlite      SQLite: projects, settings, media library
│   ├── backups\             automatic copy taken before every schema migration
│   ├── logs\app.log         JSON lines, rotated at 5 MB (3 files kept)
│   ├── thumbnails\          video thumbnails (one JPEG per clip)
│   ├── temp\                work files; leftovers are removed at startup
│   └── projects, proxies, waveforms, analysis, presets\   (later phases)
└── exports\                 default export folder
```

- Change the data folder in **Settings → Storage**. It takes effect after a restart. Existing data is not moved; copy the folder first if you want to keep it.
- The location chosen in Settings is stored in `%APPDATA%\music-content-engine\bootstrap.json`.
- `MCE_FFMPEG_DIR` points the app at a different FFmpeg folder (one containing `bin/ffmpeg(.exe)` and `bin/ffprobe(.exe)`). For troubleshooting only.
- `MCE_DATA_DIR` overrides everything (used by the E2E tests; also handy for a throwaway test profile):

  ```powershell
  $env:MCE_DATA_DIR = "C:\Temp\mce-test"; npm run dev
  ```

Original media is never copied, modified or deleted by the app.

## Project layout

```
src/
├── shared/      types, zod schemas, IPC channel names (used by all processes)
├── main/        Electron main process: window, security, IPC, SQLite, logging
│   ├── db/      driver interface, migrations, database opening + backup
│   ├── ipc/     validated handler table and registration
│   ├── media/   FFmpeg discovery, process runner, probe, thumbnails, import queue, mce-media:// protocol
│   └── repositories/
├── preload/     the only bridge to the renderer (window.mce)
└── renderer/    React UI (no Node access)
scripts/
├── fetch-ffmpeg.mjs     downloads + verifies the pinned FFmpeg
├── ffmpeg-sources.json  the pin (URLs, SHA-256)
└── licenses/            GPL v3 text and FFmpeg licensing notes shipped with FFmpeg
tests/
├── unit/          Vitest on plain Node (node:sqlite, real FFmpeg)
├── e2e/           Playwright driving the built Electron app
├── e2e-packaged/  Playwright against the unpacked Windows build
└── helpers/       fixtures: real media generated with the bundled FFmpeg
vendor/ffmpeg/     installed FFmpeg (not committed)
```

## Troubleshooting

**`npm install` fails while building better-sqlite3 (node-gyp / MSBuild errors).**
No prebuilt binary matched your Electron version, so it tried to compile. Either install
[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++" and run `npm install` again, or check that `electron` and `better-sqlite3` in `package.json` are versions that ship prebuilds for each other.

**App starts, then: "The module … was compiled against a different Node.js version".**
The native module was built for plain Node instead of Electron. Run:

```powershell
npx electron-builder install-app-deps
```

**`npm test` fails with "No such built-in module: node:sqlite".**
Your Node is older than 22.13. Check with `node -v` and update.

**"The database was created by a newer version of the app".**
You opened a data folder with an older build. Update the app, or restore a file from `app-data\backups\`.

**"Migration vN … failed and was rolled back".**
The database is left at its previous version, and a backup was written to `app-data\backups\` before trying. Send the log file (Settings → Open logs folder) along with the error.

**Media Library says "Media import is unavailable".**
- During development: `npm run fetch:ffmpeg`, then **Check again**.
- Installed app: reinstall. If it happens again, antivirus software may have quarantined files in `<install dir>\resources\ffmpeg`; restore them or add an exclusion.
- **Technical details** in the banner shows exactly which file is missing or failed to start.

**`npm run fetch:ffmpeg` fails with "Checksum mismatch".**
The download was corrupted or altered and has been deleted. Run it again. If it keeps failing, the pinned archive may have changed upstream; see "Updating the pinned build" in `docs/FFMPEG.md`.

**A file shows "Can't import".**
The message says why (damaged, unsupported codec, still image, not media). Fix or re-export the file, then **Try again** in its details panel.

**A video imports but won't play in the preview.**
The built-in player supports the formats a web browser plays. ProRes and some HEVC files import correctly but can't be previewed yet.

**Something else went wrong.**
Settings → Open logs folder, then look at the last lines of `app.log`. Errors include the full stack trace.

## Documentation

- `PROJECT_STATUS.md`: what works, known issues, next task
- `TECHNICAL_DECISIONS.md`: why things are built the way they are
- `docs/FFMPEG.md`: bundled FFmpeg build, license obligations, how to update it
- `docs/SPEC.md`: the full product specification
