# Project status

_Last updated: 2026-10-10 — Phase 1_

## Current phase: 1 — Media ingestion

Acceptance criterion: _a real audio file and a real video file can be imported, their metadata is displayed, a video thumbnail is generated, and the imported assets remain available after restarting the application._

| Item | Status |
| --- | --- |
| FFmpeg 9.0.2 bundled (LGPL v3, shared build, pinned + SHA-256 verified), license texts and source notice shipped | Done |
| Binary discovery: development (`vendor/ffmpeg`), packaged (`resources/ffmpeg`), `MCE_FFMPEG_DIR`; never PATH | Done |
| Verification before media work; actionable errors when missing / not starting; "Check again" | Done |
| Import audio and video: multiple files, folders (recursive), drag-and-drop | Done |
| Content validation: FFprobe + 3 s decode check; still images, text files, damaged/truncated files rejected with clear messages | Done |
| Metadata: duration, resolution (rotation-aware), frame rate, codecs, sample rate, channels, bit rate, container | Done |
| Video thumbnails (480 px wide JPEG, rotation applied, written atomically) | Done |
| Preview of audio and video via `mce-media://` (range requests, id-only access) | Done |
| SQLite persistence (migration v2: `media_assets`, `songs.audio_asset_id`) | Done |
| Duplicate prevention: same path, and same content under another name | Done |
| Background queue (2 at a time), live progress, cancel one / all, crash recovery, temp cleanup | Done |
| Missing-file detection (startup, window focus, library open) and relink by file or by folder | Done |
| Media Library: search, type/status filters, sorting, details panel, remove from library (source never touched) | Done |
| Song audio chosen from the library | Done |
| Unit tests (real FFmpeg on Windows), Electron E2E, packaged-app test | Passing on Windows CI |
| README, TECHNICAL_DECISIONS (TD-012 – TD-020), docs/FFMPEG.md | Done |

### Verification

**Phase 1 accepted**: verified on a real Windows machine (GitHub Actions `windows-latest`, run 38041413189, 2026-10-10). Every step passed: install, strict FFmpeg verification, type check, unit tests, E2E, installer build, packaged-app test. The run publishes a per-test summary as annotations, so skips are visible:

- **Unit tests: 109 passed, 1 skipped** (the symlink test, which only applies outside Windows). The media tests run the bundled FFmpeg on generated real media: WAV, MP3, FLAC, M4A, MP3 with cover art, H.264/AAC MP4, MPEG-4/PCM MOV, a rotated phone-style MP4, and invalid inputs (random bytes, a text file named .mp3, a truncated MP4, a PNG).
- **Electron E2E (built app): 7 passed.** These include the acceptance flow through the real UI:
  - a WAV and an MP4 are imported, and the cards show `0:03 · 48 kHz · stereo` and `0:02 · 320×240 · 30 fps`
  - the video thumbnail loads (480 px wide), and the preview plays through `mce-media://`: Electron decodes the H.264, giving duration 2 s at 320×240
  - after a restart, both assets are still ready with metadata and thumbnail, and re-importing adds nothing
  - a moved file shows as missing and is relinked
  - drag-and-drop import works through `webUtils`, and a forged path is rejected
  - a damaged file shows a clear error
  - the song's audio is chosen from the library
- **Packaged app (`dist/win-unpacked`): 2 passed.**
  - `resources/ffmpeg` contains ffmpeg, ffprobe, the DLLs, LICENSE.txt (LGPL v3), COPYING.GPLv3, FFMPEG-LICENSE.md, NOTICE.txt and manifest.json, and no ffplay.
  - The shipped ffmpeg.exe reports an LGPL configuration (`--enable-version3`, no `--enable-gpl` or `--enable-nonfree`).
  - The installed app finds its bundled FFmpeg (`source: packaged`), verifies it, and imports a video with metadata and thumbnail.
- The installer (136 MB, including FFmpeg) is uploaded as the `windows-installer` artifact.

## Known issues / limitations

- No proxies: files the built-in player can't decode (ProRes, some HEVC) import correctly but can't be previewed. Proxies are planned with the timeline, only if needed (TD-018).
- Thumbnails are a single frame at ~20 % of the clip (max 10 s in). No hover scrubbing yet.
- No user tags or segments (in/out ranges) yet. The spec lists them under the Media Library; they fit best with clip selection in Phase 3.
- Duplicate detection samples 3 MB per file (TD-015): two files identical in those samples but different elsewhere would be treated as the same.
- Changing the data folder does not move existing data (by design; the UI says so).
- No `package-lock.json` committed yet; CI uses `npm install`.
- The installer is unsigned, so Windows SmartScreen will warn when it is run.
- No app icon yet.
- **Before distributing the installer to anyone**, archive the FFmpeg corresponding source next to the release (docs/FFMPEG.md, "License obligations").

## Next task

**Phase 2 — Music analysis and lyrics** (only after Phase 1 is accepted):

- Decide the audio-analysis runtime (Essentia.js in a worker vs. a Python worker with librosa/madmom) and the transcription engine (whisper.cpp vs. faster-whisper); document in TECHNICAL_DECISIONS.
- Waveform generation for the song's audio (cached in `app-data/waveforms`).
- BPM and beat markers with manual correction; half/double-time alternatives.
- Lyric transcription with word timestamps, lyric editing, TXT/SRT/VTT/LRC import.
- Manual hook selection.
- Acceptance: the user can verify lyrics and inspect beat markers against the waveform.
