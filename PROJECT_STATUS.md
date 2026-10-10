# Project status

_Last updated: 2026-10-10 — Phase 2_

## Current phase: 2 — Music analysis and lyrics

Acceptance criterion: _the user can verify lyrics and inspect beat markers against the waveform._ The spec adds that automatic analysis is not the truth: every result must be correctable, and corrections must survive re-analysis.

| Item | Status |
| --- | --- |
| Tempo, beats, bars (downbeats) analysed in TypeScript in a worker thread; "no clear beat" instead of invented markers (TD-021) | Done |
| Waveform peaks and energy curve, cached per audio file and algorithm version | Done |
| Beat corrections stored apart from detection: half/double time, shift, add/remove beat, beats per bar, bar start, manual grid with tap tempo; kept on re-analysis (TD-022) | Done |
| Song workspace: canvas timeline (bars, waveform, energy, beats, hooks, lyrics), zoom, selection, playback with optional click on beats | Done |
| whisper.cpp 1.8.4 bundled (MIT, pinned, checksum-verified, only the CLI + DLLs), VC++ runtime check with clear message (TD-023) | Done |
| Speech models downloaded on request with pinned SHA-256, cancel/delete; no other network use | Done |
| Local transcription with word timestamps and confidence; progress, cancel, one at a time, marked as interrupted after a crash | Done |
| Lyrics editor: retype/split/delete words, time at playhead, nudge, tap-to-time, split/merge/shift lines, instrumental sections, offset, undo/redo, autosave | Done |
| TXT/SRT/VTT/LRC (incl. word-timed LRC) import; paste correct lyrics aligned to the transcription's timings | Done |
| Lyrics status draft → checked only by explicit confirmation; original transcription kept separately (TD-024) | Done |
| Hooks: from a timeline selection or a length preset snapped to bars; name, tags, notes, lyrics inside, play, show | Done |
| SQLite migration v3: `music_analyses`, `song_beat_corrections`, `lyric_documents`, `hooks` | Done |
| Unit tests (incl. real whisper.cpp + real FFmpeg on Windows), Electron E2E, packaged-app test | See Verification |
| README, TECHNICAL_DECISIONS (TD-021 – TD-025), docs/TRANSCRIPTION.md | Done |

### Verification

VERIFICATION_PLACEHOLDER

## Known issues / limitations

- **Beat analysis accuracy is measured on synthetic music** with known beats (several tempos, human timing, tempo ramps, 3/4 time, no-beat material). Real recordings, especially rubato, free-time intros or songs with tempo changes, may still get a wrong grid or a beat on the off-beat; that's what the corrections are for. Meter is assumed to be 4/4 unless the user changes beats per bar.
- **Song sections** (verse/chorus) and **automatic hook suggestions** are not built; hooks are chosen by hand (the spec marks sections as optional for this phase).
- **Transcription of singing is approximate**, especially with backing music; vocals are not separated from the mix. Word timings come from Whisper's segment timestamps and can be off by a few hundred milliseconds; DTW token timing didn't work with this build (TD-023).
- Transcription is only available on Windows x64 (the bundled build). It needs the Microsoft Visual C++ runtime, which is not bundled.
- The click on beats is triggered from the display loop, so it can be up to one frame (~16 ms) late; good enough to judge markers by ear, not a metronome.
- Carried over from Phase 1: no proxies (ProRes/HEVC can't be previewed), no user tags or segments on clips yet, unsigned installer, no app icon, no `package-lock.json`.
- **Before distributing the installer to anyone**, archive the FFmpeg corresponding source next to the release (docs/FFMPEG.md, "License obligations").

## Next task

**Phase 3 — Automatic edit generation and rendering** (only after Phase 2 is accepted):

- Decide the H.264 export encoder (TD-012 open decision) and the rendering approach (Remotion vs. FFmpeg filter graphs); check Remotion's license terms.
- Clip selection from the library for a hook, cut points on beats/bars from the resolved beat map.
- Lyric captions from the checked lyric document.
- First vertical (9:16) render of one hook.
