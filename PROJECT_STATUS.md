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
| Unit tests (real FFmpeg on Windows), Electron E2E, packaged-app test | See verification |
| README, TECHNICAL_DECISIONS (TD-012 – TD-020), docs/FFMPEG.md | Done |

### Verification

_To be filled in from the Windows CI run that passes Phase 1 acceptance._

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
