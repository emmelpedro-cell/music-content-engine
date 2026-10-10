# Lyrics transcription (whisper.cpp)

The app can transcribe a song's lyrics on the user's computer with [whisper.cpp](https://github.com/ggml-org/whisper.cpp). Audio never leaves the machine. The only network use in the app is downloading a speech model, and only when the user clicks **Download** in the Lyrics tab.

Automatic transcription is a starting point, not the result: sung lyrics are much harder than speech, so the Lyrics tab is built around checking and correcting the words and their timing. A transcription is always stored as a **draft**; lyrics only become **checked** when the user clicks **Mark as checked**.

## What is bundled

| | |
| --- | --- |
| Version | whisper.cpp **1.8.4** (commit `9386f239401074690479731c1e41683fbbeac557`) |
| Binary | official release asset `whisper-bin-x64.zip` (CPU build for Windows x64) |
| SHA-256 | `74f973345cb52ef5ba3ec9e7e7af8e48cc8c71722d1528603b80588a11f82e3e` (4,078,768 bytes) |
| License | MIT (whisper.cpp and ggml) |
| Pin | `scripts/whisper-sources.json` |

`npm install` (postinstall) runs `scripts/fetch-whisper.mjs`, which downloads the pinned archive, checks its size and SHA-256, and installs into `vendor/whisper/win32-x64/`:

```
vendor/whisper/win32-x64/
├── bin/whisper-cli.exe, whisper.dll, ggml.dll, ggml-base.dll, ggml-cpu.dll
├── LICENSE-whisper.cpp.txt      MIT license of whisper.cpp / ggml
├── LICENSE-whisper-models.txt   license and origin of the downloadable models
├── NOTICE.txt                   version, source commit, download URL and checksum
└── manifest.json
```

Only the command-line transcriber and the libraries it needs are copied. The demo programs in the release archive (and their SDL2 dependency) are not shipped. electron-builder copies the folder to `resources/whisper` in the installed app. The packaged-app test checks that exact file list.

On other platforms (development on Linux/macOS) no binary is bundled. The Lyrics tab then says transcription is unavailable; everything else works.

To reinstall or update:

```powershell
npm run fetch:whisper                                   # install if missing
node scripts/fetch-whisper.mjs --force                  # reinstall
node scripts/fetch-whisper.mjs --model base             # also download a model into vendor/whisper-models (used by tests)
```

To update the version, change `version`, `commit`, `url`, `file`, `sha256` and `size` in `scripts/whisper-sources.json`. Compute the checksum from the official download, run the tests (they run the real binary on Windows CI), and update this file.

## Microsoft Visual C++ runtime

The official Windows build is compiled with MSVC and needs the **Microsoft Visual C++ 2015–2022 Redistributable (x64)** (`MSVCP140.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`, `VCOMP140.dll`). Almost every Windows 10/11 installation already has it. If it's missing, Windows refuses to start the program (`STATUS_DLL_NOT_FOUND`, 0xC0000135). The app detects this and tells the user to install it from <https://aka.ms/vs/17/release/vc_redist.x64.exe>, then click **Check again**. Importing or typing lyrics still works in the meantime.

The runtime is not bundled: Microsoft's redistribution terms allow it, but the installer would grow and could conflict with a newer system-wide copy. This can be revisited if users hit the message often.

## Speech models

Models are not bundled (they are 75 MB to 875 MB). They are downloaded on demand from the official whisper.cpp model repository on Hugging Face (`https://huggingface.co/ggerganov/whisper.cpp`). Each download is streamed to a `.part` file, checked against a pinned size and SHA-256, and only then renamed into `app-data/models/`. A download can be cancelled; a failed or altered download is deleted.

| Model | File | Size | Use |
| --- | --- | --- | --- |
| Tiny | `ggml-tiny.bin` | 74 MB | testing only |
| Base | `ggml-base.bin` | 141 MB | fast; clear English vocals |
| Small | `ggml-small.bin` | 465 MB | better, also other languages |
| **Large v3 Turbo (q5_0)** — recommended | `ggml-large-v3-turbo-q5_0.bin` | 547 MB | best for sung lyrics and Portuguese |
| Large v3 Turbo (q8_0) | `ggml-large-v3-turbo-q8_0.bin` | 834 MB | slightly more accurate, slower |

The models are OpenAI's Whisper weights (MIT license) converted to the ggml format by the whisper.cpp project. See `LICENSE-whisper-models.txt`.

Models can be deleted from the Lyrics tab. They live in `app-data/models/` and are never sent anywhere.

## How a transcription runs

1. FFmpeg converts the song to a temporary 16 kHz mono WAV in `app-data/temp` (named `mce-…`, removed afterwards and at startup).
2. `whisper-cli` runs with one word per segment (`-ml 1 -sow`), full JSON output (`-ojf`) and progress (`-pp`). The language is chosen by the user or detected.
3. The JSON is parsed into words with start/end times and confidence. Special tokens are dropped, and words are grouped into lines at pauses, sentence ends and the start of each phrase Whisper recognised (rap and fast singing often have no pauses).
4. The result is stored as the song's **original transcription**. If the user hasn't written any lyrics yet, it also becomes the editable draft. Otherwise the user's lyrics are kept and the Lyrics tab offers **Use latest transcription**.

Only one transcription runs at a time. It can be cancelled, and quitting the app stops it; an interrupted transcription is marked as such at the next start.

## Correcting lyrics

- Click a word to select it; double-click to retype it. Typing several words splits it, sharing its time span.
- **S** (or **Start at playhead**) times the selected word at the playhead; **[** / **]** nudge it by 50 ms; **Delete** removes it.
- **Tap to time**: tick it, play the song, and press **T** on each word as it's sung.
- Lines can be split, merged, shifted, deleted and played; instrumental sections can be marked.
- **Paste lyrics…** replaces the text with the correct lyrics. If there is a transcription, its timings are carried over to matching words (edit-distance alignment), and the rest are placed between them.
- **Import file…** reads TXT, SRT, VTT and LRC (including word-timed "enhanced" LRC).
- A global offset shifts all lyrics against the audio.
- Undo/redo (Ctrl+Z / Ctrl+Shift+Z). Edits are saved automatically. Any edit after **Mark as checked** turns the lyrics back into a draft until checked again.
