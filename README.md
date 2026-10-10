# Music Content Engine

Desktop app for musicians: one song + many clips + one visual style → many editable, beat-synchronized short videos.
Local-first, Windows 10/11, Electron + React + TypeScript.

**Current state: Phase 2 (music analysis and lyrics).** Song projects and a Media Library (import audio and video, real metadata from FFprobe, thumbnails, preview, missing-file detection and relinking). Each song has a workspace: waveform and energy timeline, detected tempo, beats and bars that you can check by ear and correct, lyrics transcribed on your computer with Whisper (or imported/typed) and corrected word by word, and hooks (the passages videos will be cut from). Editing and rendering are not built yet; their screens say so. See `PROJECT_STATUS.md`.

## Requirements

- Windows 10 or 11 (x64)
- [Node.js](https://nodejs.org/) **22.13 or newer** (22 LTS recommended). Unit tests use Node's built-in SQLite.
- Git (optional)

Internet access during `npm install`: besides npm packages, it downloads the pinned FFmpeg build (~77 MB) into `vendor/ffmpeg/` and the pinned whisper.cpp build (4 MB) into `vendor/whisper/`, both checksum-verified. See [docs/FFMPEG.md](docs/FFMPEG.md) and [docs/TRANSCRIPTION.md](docs/TRANSCRIPTION.md).

Automatic transcription needs the Microsoft Visual C++ 2015–2022 Redistributable (x64), which most Windows installations already have. If it's missing, the Lyrics tab says so and links to it.

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

The same applies to transcription: `npm run fetch:whisper`.

## Using the Media Library

- **Import files…** / **Import folder…**, or drag files and folders onto the window. Folders are scanned recursively for audio and video files; explicitly chosen files are always checked, whatever their extension.
- Each file is checked by FFprobe and a short decode, so damaged files, renamed documents and still images are rejected with a clear message instead of failing later.
- Files stay where they are. The library stores a reference, metadata and (for video) a 480-pixel-wide thumbnail. **Remove from library** never deletes the file.
- If a file is moved or renamed, it shows **File missing** but keeps its metadata. Use **Relink…** on the file, or **Search a folder…** to find all missing files at once.
- The same file can't be added twice: not by path, and not as a copy under another name.
- Imports run in the background (two files at a time), can be cancelled, and resume after a crash or forced quit.
- Supported: anything the bundled FFmpeg reads, including MP4, MOV, MKV, WebM, AVI, MTS, WAV, MP3, FLAC, M4A/AAC, AIFF, OGG and Opus. The built-in preview plays what Chromium can decode (H.264, VP8/9, AV1, AAC, MP3, FLAC, WAV, Opus); other codecs (e.g. ProRes) import fine and say the preview isn't available.

## Working on a song

Create a song (**New**), then choose its audio in the **Details** tab. The song is analysed in the background (a few seconds per minute of audio) and the workspace fills in:

- **Timeline**: bar numbers, waveform, energy curve (green), beats and bar lines (orange), hooks and lyrics lanes. Click to move the playhead, drag to select a range, Ctrl + wheel to zoom. **Space** plays and pauses.
- **Beats**: the detected tempo, with confidence and steadiness. Turn on **Click on beats while playing** to hear the markers, then correct what's off: half/double time, shift all beats, add or remove a beat at the playhead, beats per bar, **Bar starts at playhead**, or switch to a **Manual grid** (type the BPM or tap it). Corrections are kept separately from the detection, so **Analyse again** never loses them. When there's no clear beat, the app says so instead of guessing.
- **Lyrics**: transcribe automatically (download a model first; *Large v3 Turbo* is recommended for singing and Portuguese), import a TXT/SRT/VTT/LRC file, paste the correct text (timings are carried over from the transcription where words match), or type it. Then correct words and timing: select a word and press **S** to time it at the playhead, **[** / **]** to nudge it, or tick **Tap to time** and press **T** on each word while the song plays. Lyrics stay a **Draft** until you click **Mark as checked**.
- **Hooks**: drag across the timeline and **Save selection as hook**, or create one from the playhead with a length button (snapped to bars). Give it a name, tags and notes; the lyrics inside it are shown.

Everything is saved as you go. See [docs/TRANSCRIPTION.md](docs/TRANSCRIPTION.md) for how transcription works and what it downloads.

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
npm run fetch:whisper  # (re)install the pinned whisper.cpp into vendor/whisper
```

On Windows, the transcription tests run the real whisper.cpp with the base model. Download it once with:

```powershell
node scripts/fetch-whisper.mjs --model base
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
│   ├── waveforms\           waveform peaks for each analysed song
│   ├── models\              speech models you downloaded (Lyrics tab)
│   ├── temp\                work files; leftovers are removed at startup
│   └── projects, proxies, analysis, presets\   (later phases)
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
│   ├── analysis/  tempo, beats, bars, energy and waveform (runs in a worker thread)
│   ├── transcription/  whisper.cpp discovery, model downloads, transcription runs
│   ├── workspace.ts    song workspace service (analysis + corrections + lyrics + hooks)
│   └── repositories/
├── preload/     the only bridge to the renderer (window.mce)
└── renderer/    React UI (no Node access); src/workspace/ is the song workspace
scripts/
├── fetch-ffmpeg.mjs     downloads + verifies the pinned FFmpeg
├── ffmpeg-sources.json  the pin (URLs, SHA-256)
├── fetch-whisper.mjs    downloads + verifies the pinned whisper.cpp (and, on request, a model)
├── whisper-sources.json the pin for whisper.cpp and the speech models
└── licenses/            license texts shipped with FFmpeg and whisper.cpp
tests/
├── unit/          Vitest on plain Node (node:sqlite, real FFmpeg)
├── e2e/           Playwright driving the built Electron app
├── e2e-packaged/  Playwright against the unpacked Windows build
└── helpers/       fixtures: real media generated with the bundled FFmpeg
vendor/ffmpeg/     installed FFmpeg (not committed)
vendor/whisper/    installed whisper.cpp (not committed)
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

**Lyrics tab: "Automatic transcription is unavailable".**
- "needs the Microsoft Visual C++ Redistributable": install it from https://aka.ms/vs/17/release/vc_redist.x64.exe, then **Check again**.
- During development: `npm run fetch:whisper`, then **Check again**.
- You can always import or type lyrics instead.

**Transcription is slow or the words are wrong.**
Singing is much harder than speech. Use *Large v3 Turbo*, choose the language instead of "Detect automatically", and expect to correct the result. Pasting the correct lyrics keeps the timing of the words that matched.

**The BPM is half or double what it should be, or the bar lines are off.**
Use **Half time** / **Double time** and **Bar starts at playhead** in the Beats tab. For songs without a steady beat, use **Manual grid**.

**Something else went wrong.**
Settings → Open logs folder, then look at the last lines of `app.log`. Errors include the full stack trace.

## Documentation

- `PROJECT_STATUS.md`: what works, known issues, next task
- `TECHNICAL_DECISIONS.md`: why things are built the way they are
- `docs/FFMPEG.md`: bundled FFmpeg build, license obligations, how to update it
- `docs/TRANSCRIPTION.md`: bundled whisper.cpp, speech models, what is downloaded and when
- `docs/SPEC.md`: the full product specification
