# Music Content Engine

Desktop app for musicians: one song + many clips + one visual style → many editable, beat-synchronized short videos.
Local-first, Windows 10/11, Electron + React + TypeScript.

**Current state: Phase 0 (foundation).** The app launches, creates its database, and lets you create, edit and delete song projects that persist across restarts. Media import, analysis, editing and rendering are not built yet; their screens say so. See `PROJECT_STATUS.md`.

## Requirements

- Windows 10 or 11 (x64)
- [Node.js](https://nodejs.org/) **22.13 or newer** (22 LTS recommended). Unit tests use Node's built-in SQLite.
- Git (optional)

`better-sqlite3` is a native module. `npm install` downloads a prebuilt binary for Electron automatically. Only if that download fails will it try to compile, which needs Visual Studio Build Tools with the "Desktop development with C++" workload (see Troubleshooting).

## Setup and run

```powershell
cd music-content-engine
npm install
npm run dev
```

`npm run dev` starts Vite with hot reload and opens the Electron window.

## Scripts

```powershell
npm run dev         # development, hot reload
npm run build       # production build into out/
npm start           # run the production build
npm test            # unit tests (Vitest)
npm run typecheck   # TypeScript, strict mode, main + renderer
npm run test:e2e    # build, then launch the real app with Playwright
npm run dist:win    # Windows installer into dist/
```

## Where data lives

By default: `Documents\MusicContentEngine\`

```
MusicContentEngine\
├── app-data\
│   ├── database.sqlite      SQLite: projects, settings (more tables arrive per phase)
│   ├── backups\             automatic copy taken before every schema migration
│   ├── logs\app.log         JSON lines, rotated at 5 MB (3 files kept)
│   └── projects, thumbnails, proxies, waveforms, analysis, presets, temp\
└── exports\                 default export folder
```

- Change the data folder in **Settings → Storage**. It takes effect after a restart. Existing data is not moved; copy the folder first if you want to keep it.
- The location chosen in Settings is stored in `%APPDATA%\music-content-engine\bootstrap.json`.
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
│   └── repositories/
├── preload/     the only bridge to the renderer (window.mce)
└── renderer/    React UI (no Node access)
tests/
├── unit/        Vitest, runs on plain Node with node:sqlite
└── e2e/         Playwright driving the built Electron app
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

**Something else went wrong.**
Settings → Open logs folder, then look at the last lines of `app.log`. Errors include the full stack trace.

## Documentation

- `PROJECT_STATUS.md`: what works, known issues, next task
- `TECHNICAL_DECISIONS.md`: why things are built the way they are
