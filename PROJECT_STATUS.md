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

**Phase 2 verified on Windows** (GitHub Actions `windows-latest`, run 38051706356, 2026-10-10). Every step passed: install, strict FFmpeg and whisper.cpp verification, type check, unit tests, E2E, installer build, packaged-app test.

- **Unit tests: 185 passed, 6 skipped.** The skips are the symlink test and the five transcription-service tests that use a fake shell-script transcriber (non-Windows only); on Windows the real whisper.cpp runs instead.
  - Beat analysis on synthetic music with known beats: 75–174 BPM at various offsets, human timing jitter, tempo ramps, 3/4 time, half/double alternatives, and silence, noise and pads that must report "no clear beat".
  - Correction layer (`resolveBeatMap`), lyrics parsing/alignment, lyric edit operations, whisper JSON parsing, model download verification (checksum, cancel, `.part` cleanup), repositories, migration v3, the analysis service with real FFmpeg decoding.
  - **Real transcription**: the bundled whisper.cpp with the base model transcribes Windows text-to-speech audio and returns timed words.
- **Electron E2E (built app): 9 passed**, including Phase 2 acceptance through the real UI:
  - a 128 BPM song is analysed in the worker thread; the Beats tab shows 128 ± 1 BPM and the timeline's waveform band is painted
  - clicking the timeline moves the playhead; "Double time" gives a corrected 256 BPM
  - lyrics are pasted (draft), then marked as checked; a hook is created from the playhead
  - after a restart: the correction, the checked lyrics and the hook are still there; **Analyse again** keeps the correction
  - a spoken WAV is transcribed with the base model: the words (including "fox") appear, all timed, and the lyrics stay a **draft**
- **Packaged app (`dist/win-unpacked`): 4 passed.** `resources/whisper` contains exactly `bin/{whisper-cli.exe, whisper.dll, ggml.dll, ggml-base.dll, ggml-cpu.dll}`, the two license files, NOTICE.txt and manifest.json (no demo tools, no SDL2, no models). The installed app finds and verifies whisper.cpp from `resources/whisper` and analyses a song in its worker (120 BPM found).

**Real song check (2026-10-10):** "Indian Fall 2" (Luneta, 2:58, FL Studio export) analysed with the app's code: 109.0 BPM, 79 bars, tempo confidence 89 %, no warnings, 1.8 s for the whole song. All 38 loudest hits in the track (one every two bars) fall on detected beats and on bar lines. The artist listened to the song mixed with a click on every detected beat and confirmed the tempo is right.

**Real transcription check (2026-10-10):** the same song (Portuguese rap, verses up to 2:10, instrumental ending) transcribed with the bundled whisper.cpp version (built from the same commit on Linux) and Large v3 Turbo q5_0, exactly the app's arguments, language auto-detected (pt, p = 0.999); 11 minutes on a 2-core cloud machine. Against the artist's lyrics: **83.5 % of words right (WER 16.5 %, 442 words)**. Findings and fixes:
- Lines broke mid-phrase because rap has no pauses → lines now also break where Whisper starts a new phrase.
- Over the instrumental ending Whisper repeated one phrase 25 times (repetition loop) → runs of 6+ identical lines are collapsed into a marked section "Repeated phrase removed… check this part". Trying `--max-context 0` instead removed the loop but made the verses worse (WER 18.8 %) and invented subtitle credits over the ending, so the default is kept.
- Pasting the correct lyrics ("Paste lyrics…") aligned 421 of 442 words; the rest were first words of lines with nothing to interpolate from → now placed next to their line's matched words: **442 of 442 words timed, all in order**. A karaoke render from that result was sent to the artist to check the timing by eye.

**Second real song (2026-10-10): Nepali trap, 2:27, plus five phone videos of the artist rapping to it (song playing from another phone).**
- Beat analysis first read 99.6 BPM with beats wandering 20–80 ms (triplet hi-hats look periodic at 2/3 of the tempo). Fixed: 3:2 relatives are checked against where the attacks land, and a steady grid replaces the tracked beats when the tracker wanders but one constant-tempo grid fits. Now 150.04 BPM, steady. Regression test with a synthetic trap loop (fails before the fix). Indian Fall 2 stays at 109 BPM.
- Transcription (Large v3 Turbo, language forced to Nepali) is poor: invented text in the intro, a one-word loop, a missed minute, and one chorus written in Hangul. Single-word loops are now collapsed too.
- Romanised lyrics vs. Devanagari transcription share almost no spelling, so lyrics can now also be aligned by sound (cross-script consonant skeletons, word level, free ends for partial lyrics). With the artist's partial lyrics, 18 of 20 lines got timings; the well-heard parts land where Whisper heard them.
- Prototype (not in the app yet): audio sync of the five videos to the master by cross-correlating band-energy features. Each video's start in the song was found consistently to ±2 ms over 8–9 windows; two videos started before the music. A synced 5-up mosaic, a 9:16 edit cutting between takes on every bar and the same edit with karaoke captions were rendered for review.

Not yet checked by hand: the installer on a real PC.

## Known issues / limitations

- **Beat analysis accuracy is measured mostly on synthetic music** with known beats, plus one real song so far (several tempos, human timing, tempo ramps, 3/4 time, no-beat material). Real recordings, especially rubato, free-time intros or songs with tempo changes, may still get a wrong grid or a beat on the off-beat; that's what the corrections are for. Meter is assumed to be 4/4 unless the user changes beats per bar.
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
