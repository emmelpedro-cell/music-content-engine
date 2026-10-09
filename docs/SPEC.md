PROJECT SPECIFICATION — MUSIC CONTENT ENGINE

Desktop-first video editor for musicians, automatic beat editing, lyrics, reusable footage and batch content generation

Document type: Product requirements + technical implementation plan
Target platform: Windows 10/11, initially local-first
Working title: Music Content Engine
Alternative names: FlowCut, BeatFlow, Luneta Studio
Status: Greenfield project — independent application
Primary goal: Transform a song and a collection of video clips into multiple polished, beat-synchronized short-form videos with minimal manual editing.

⸻

1. PROJECT OVERVIEW

Build a desktop application for musicians and independent artists that combines three workflows:

1. 0dB-style editing: Import music, automatically transcribe lyrics, synchronize words, detect beats, create cuts and generate multiple video variants.
2. Flowstage-style content production: Organize footage into reusable libraries, create editing presets, build visual identities, save hooks and concepts, and generate batches of videos.
3. A professional review and editing workflow: Inspect each generated video, adjust cuts and lyrics, replace clips, customize visual effects, and export the final result.

Reference products:

* 0dB.studio: https://www.0db.studio/
* Flowstage: https://app.theflowstage.com/

Use these products as workflow references, not as code or design assets to copy. The application must have its own name, interface, implementation and visual identity.

The central concept is:

One song + many video clips + one visual style = many editable video variations.

The software should automate repetitive editing without removing the artist’s creative control.

1.1 Target user

The initial target user is an independent musician who needs to produce regular social media content without spending hours editing each video.

Typical use cases:

* Promoting a new single.
* Creating lyric videos.
* Producing multiple Reels from one performance.
* Combining different camera angles and takes.
* Creating instrumental performance videos.
* Generating different edits of the same musical hook.
* Reusing footage across multiple releases.
* Maintaining a consistent visual identity across social media.

1.2 Core product principles

1. Music-first: Editing decisions are based on musical timing, not arbitrary video cuts.
2. Batch-first: Creating multiple useful videos should be a primary workflow, not an afterthought.
3. Human control: Automatic results must always be editable.
4. Reusable assets: Footage, lyrics, hooks and presets should not need to be recreated for each video.
5. Non-destructive editing: Changes should update project data, not permanently modify original media.
6. Local-first: Audio, video, projects and renders should remain on the user’s computer by default.
7. Predictable output: Preview and exported video must match as closely as technically possible.
8. Progressive development: Build a working MVP before introducing complex AI features.

⸻

2. PRODUCT SCOPE

The application should contain six main subsystems.

A. Music Engine

Analyzes audio, detects beats, estimates tempo, identifies musical sections and synchronizes lyrics.

B. Media Library

Imports, organizes, previews, tags and indexes reusable video clips.

C. Automatic Editing Engine

Combines music, lyrics, clips and editing rules into complete video drafts.

D. Timeline Editor

Allows manual correction of cuts, timing, lyrics, framing and effects.

E. Preset and Batch Engine

Saves editing styles and generates multiple variations of an edit.

F. Export Manager

Renders videos in social media formats and manages batches of finished exports.

These subsystems must be designed as independent modules connected through a common project data model.

The application must not depend on Drop Machine, its source code, its database, its file structure or its runtime. This is a separate greenfield project.

⸻

3. TECHNOLOGY STACK

Use the following stack unless a concrete technical limitation requires a documented alternative.

Component	Technology	Responsibility
Desktop runtime	Electron	Windows desktop application
Frontend	React + TypeScript	User interface
Build tooling	Vite	Development and production builds
Styling	Tailwind CSS or CSS Modules	Application styling
UI components	shadcn/ui or equivalent	Accessible interface components
Backend	Node.js + TypeScript	Application services and processing orchestration
Video rendering	FFmpeg	Media processing and final encoding
Motion graphics	Remotion	Animated text, graphics and composited scenes
Audio analysis	Essentia.js or librosa via a Python worker	Beat, tempo and audio feature analysis
Speech recognition	Whisper-compatible local transcription engine	Initial lyric transcription
Word alignment	Whisper timestamps or a forced-alignment model	Word-level lyric timing
Metadata	SQLite	Projects, clips, presets and jobs
Schema validation	Zod	Runtime validation of project data
Media metadata	FFprobe	Codec, duration, frame rate and stream information
Background jobs	Persistent SQLite-backed job queue	Analysis and rendering tasks
Testing	Vitest + Playwright	Unit and UI testing

Important architectural decisions

* Use FFmpeg as the authoritative media-processing and export engine.
* Use Remotion for motion graphics, animated lyrics, title cards and other React-based visual compositions.
* Do not force every video operation through Remotion if FFmpeg is more efficient.
* Do not implement the entire app as a web page requiring media uploads to an external service.
* Use a Python worker only where it provides a clear advantage for audio analysis or machine-learning models.
* Pin and document compatible dependency versions.
* Check FFmpeg licensing and distribution requirements before packaging binaries with the application.
* Use GPU acceleration when available, but preserve a reliable CPU fallback.

The application should work without a paid API key. Any optional external AI provider must be explicitly configured and must never receive media without the user’s consent.

⸻

4. APPLICATION STRUCTURE

The primary navigation should contain:

1. Home
2. Songs
3. Media Library
4. Create
5. Presets
6. Exports
7. Settings

4.1 Home

Display:

* Recent projects.
* Recent songs.
* Number of pending renders.
* Recently exported videos.
* Saved editing presets.
* A prominent Create New Project action.

4.2 Songs

Each song is a reusable content project containing:

* Original audio.
* Audio analysis.
* Lyrics.
* Song sections.
* Hooks and selected time ranges.
* Linked footage.
* Editing presets.
* Generated video drafts.
* Export history.

One song can have many edits, and each edit can have many rendered variations.

4.3 Media Library

A central library of reusable video assets.

Support:

* Importing individual files.
* Importing entire folders.
* Drag-and-drop import.
* Video thumbnails.
* Preview playback.
* Searching and filtering.
* User-defined tags.
* Automatic metadata extraction.
* Favorite clips.
* Clip usage history.

Example organization:

Media Library
├── Performances
│   ├── Erhu
│   ├── Flute
│   ├── Guitar
│   └── Full Performance
├── Close-ups
├── Hands and Instruments
├── Studio Footage
├── Objects and Textures
└── B-roll

Folders and tags must remain flexible. Do not impose a fixed taxonomy on users.

4.4 Create

The main workflow for producing a video or batch of videos.

Users should be able to start from:

* A song.
* A specific musical section.
* A selected collection of clips.
* An existing preset.
* A previous edit.

4.5 Presets

Store reusable editing styles, including:

* Caption appearance.
* Font and typography.
* Caption position.
* Animation style.
* Cut frequency.
* Beat synchronization behavior.
* Transition style.
* Zoom intensity.
* Aspect ratio.
* Framing behavior.
* Clip-selection rules.
* Preferred clip tags.
* Hook and opening-shot rules.

4.6 Exports

Display:

* Pending jobs.
* Processing progress.
* Completed renders.
* Failed jobs.
* Output paths.
* Export format and settings.
* The ability to retry failed renders.

⸻

5. PRIMARY USER WORKFLOW

The first complete workflow must be simple enough for a nontechnical musician.

Step 1 — Create a song project

The user creates a project and imports an audio file.

Supported input formats should include MP3, WAV, FLAC, M4A and other formats supported by the installed FFmpeg build.

Store the original audio without modification.

Extract:

* Duration.
* Sample rate.
* Channel count.
* Loudness estimate.
* Waveform data.
* BPM estimate.
* Beat positions.
* Downbeats where available.
* Musical sections where reliably detected.

BPM and section detection must be presented as estimates, with manual correction available.

Step 2 — Transcribe and verify lyrics

Automatically transcribe vocals.

The user must be able to:

* Edit the transcription.
* Add missing lines.
* Delete incorrect words.
* Correct punctuation.
* Mark instrumental passages.
* Set the start and end time of each word.
* Shift a whole line or group of words.
* Import a supplied TXT, SRT, VTT or LRC file where supported.

Do not assume that speech recognition will perfectly recognize singing. The transcription interface must make corrections easy.

Critical rule: Lyrics must be confirmed or explicitly accepted before large batch generation. The application must not silently generate dozens of videos using an incorrect transcription.

Step 3 — Select the musical section

Allow the user to select:

* The full song.
* A chorus.
* A verse.
* An instrumental section.
* A custom time range.

The selected section should be represented as a reusable hook.

Each hook contains a name, start time, end time, optional lyrics and notes.

Example:

Hook 01
Start: 00:12.000
End:   00:27.000
Label: Main riff
Tags:  instrumental, erhu, energetic

Support short-form video lengths such as 10, 15, 20, 30 and 60 seconds, plus custom durations. These are presets, not mandatory limits.

Step 4 — Import video footage

The user selects video files or folders.

The application extracts:

* Duration.
* Resolution.
* Frame rate.
* Audio stream information.
* Thumbnail frames.
* Orientation.
* Codec information.

Generate proxies and thumbnails for efficient browsing when necessary.

Original media must remain untouched.

The user can manually assign tags or allow automatic suggestions.

Step 5 — Choose an editing style

Offer initial editing modes:

Beat: Place cuts on detected beats.

Bar: Place cuts at selected musical intervals, such as every 2 or 4 bars.

Energy: Use faster cuts during higher-energy sections and longer shots during quieter passages.

Lyrics: Use lyric changes and phrase boundaries as editing cues.

Cinematic: Favor longer shots and fewer transitions.

Hybrid: Combine musical timing, footage variation and lyric changes.

These are editing strategies, not promises that the system understands musical meaning perfectly.

Step 6 — Generate drafts

The user chooses:

* Number of variations.
* Video duration.
* Aspect ratio.
* Editing preset.
* Available footage.
* Caption style.
* Cut mode.
* Whether to use zooms and transitions.
* Whether the first shot should vary between versions.

The engine generates a batch of editable drafts.

Step 7 — Review and edit

Display all drafts in a grid or gallery.

The user can:

* Preview each draft.
* Keep or reject it.
* Open it in the timeline editor.
* Replace a clip.
* Move a cut.
* Change lyric timing.
* Change the font or style.
* Reroll the edit.
* Duplicate the edit.
* Export selected videos.

Step 8 — Export

Render selected videos to MP4.

Default social media settings:

* 1080 × 1920.
* 9:16.
* 30 fps.
* H.264 video.
* AAC audio.
* Original song audio.
* No watermark.

Also support 16:9 and 1:1.

Allow optional custom resolution, frame rate, bitrate and quality settings.

⸻

6. MUSIC ENGINE

This module is responsible for converting the song into usable timing information.

6.1 Waveform

Generate a waveform representation suitable for the editor timeline.

The waveform should support zooming and scrubbing without decoding the entire audio file repeatedly.

6.2 Beat detection

Generate a list of candidate beat positions.

Example:

{
  "bpm": 130,
  "beats": [0.46, 0.92, 1.38, 1.85],
  "downbeats": [0.46, 2.31, 4.15],
  "confidence": 0.91
}

This is illustrative data only. Real analysis must produce the actual results.

Store beat positions in seconds with adequate precision.

The engine must support:

* Tempo estimates.
* Beat markers.
* Downbeat estimates.
* Beat strength where available.
* Manual marker correction.
* Manual BPM correction.
* Half-time and double-time alternatives.
* Tempo changes where detectable.

Do not assume every song has a constant tempo or that the first beat occurs at time zero.

6.3 Energy analysis

Calculate an audio-energy curve using short-time analysis.

Use this to help determine:

* Quiet and loud sections.
* Potential drops.
* High-energy passages.
* Moments suitable for faster or slower edits.

Energy analysis must remain separate from beat detection. A loud transient is not necessarily a musical downbeat.

6.4 Song structure

Attempt to identify:

* Intro.
* Verse.
* Chorus.
* Bridge.
* Drop.
* Instrumental passage.
* Outro.

Use confidence scores or mark uncertain sections for user review.

For an MVP, automatic section labeling is optional. Manual range selection is mandatory.

6.5 Music map

Represent the analysis in a reusable object:

MusicMap
├── duration
├── tempo estimate
├── beat markers
├── downbeat markers
├── energy curve
├── section candidates
└── confidence metadata

The editor should visualize the waveform, beats, sections and current playhead together.

⸻

7. LYRICS ENGINE

7.1 Data model

Represent each word as a timed element.

Example:

{
  "text": "Rumelaj",
  "start": 12.31,
  "end": 12.82,
  "lineId": "line-001"
}

Store the original transcription separately from the user-edited version.

Each word should support:

* Start time.
* End time.
* Text.
* Line identifier.
* Optional confidence.
* Manual correction status.

7.2 Timing modes

Support:

1. Word-by-word.
2. Whole-line captions.
3. Karaoke highlighting.
4. Phrase-based captions.
5. Static text hooks.
6. Instrumental title cards.

Users should be able to set different lyric styles for different sections.

7.3 Lyric animations

Initial animation library:

* Fade in/out.
* Pop.
* Scale up.
* Highlight current word.
* Type-on effect.
* Sliding text.
* Word-by-word reveal.
* Line-by-line reveal.
* Subtle pulse.

Keep animations configurable and avoid making every preset visually aggressive.

7.4 Lyric editing

Provide a dedicated lyrics panel.

The user must be able to:

* Adjust word timing.
* Move multiple words together.
* Split a line.
* Merge lines.
* Change the start time of the lyrics relative to the video.
* Preview animation timing.
* Edit font, color, stroke, shadow and spacing.

Timing adjustments must be stored in project data and applied consistently to preview and final render.

⸻

8. MEDIA LIBRARY AND FOOTAGE ANALYSIS

8.1 Import pipeline

When media is imported:

1. Validate the file.
2. Extract metadata with FFprobe.
3. Generate a thumbnail.
4. Generate a proxy when appropriate.
5. Register the asset in SQLite.
6. Preserve the original file location.
7. Record a content hash or equivalent identity where practical.

Do not duplicate large source videos unnecessarily.

If an original file is moved or deleted, mark the asset as missing and provide a relink workflow.

8.2 Clip segmentation

Allow users to define multiple usable segments within one source video.

For example:

performance.mp4
├── Segment A: 00:03–00:09
├── Segment B: 00:14–00:21
└── Segment C: 00:34–00:41

A segment references the source file and its in/out points. It does not need to be physically extracted as a separate video.

8.3 Tags and classifications

Support manual tags such as:

* erhu.
* flute.
* guitar.
* close-up.
* wide shot.
* hands.
* face.
* studio.
* outdoor.
* energetic.
* calm.
* instrumental.
* performance.

Optional AI features may suggest tags based on visible content and motion.

These suggestions must never block basic import or editing.

8.4 Footage selection

The editing engine should choose clips based on:

* User-selected source pool.
* Tags.
* Clip duration.
* Segment duration.
* Previous usage.
* Repetition limits.
* Optional motion or visual-quality scores.

Do not introduce face recognition, identity matching or cloud vision APIs as mandatory dependencies.

⸻

9. AUTOMATIC EDITING ENGINE

This is the core of the application.

Its responsibility is to create a valid edit plan from the music, footage, lyrics and user settings.

9.1 Edit-plan model

The engine should produce an intermediate representation called EditPlan.

An edit plan describes the timeline before rendering.

It must include:

* Output duration.
* Source audio.
* Timeline segments.
* Video source references.
* Source in/out points.
* Output in/out points.
* Cut positions.
* Lyric events.
* Text styling.
* Effects.
* Transitions.
* Crop and framing instructions.
* Render settings.

The edit plan must be serializable as JSON and independently testable.

9.2 Cut generation

Support configurable cut strategies:

Beat-snap: Choose cut positions from beat markers.

Bar-snap: Choose cuts from bar or downbeat markers.

Interval: Cut at a selected interval.

Energy-based: Change shot duration based on musical energy.

Lyric-based: Use lyric phrase boundaries as candidate cut points.

Hybrid: Combine the above with configurable priorities.

All strategies must respect minimum and maximum shot durations.

Avoid creating a cut on every beat by default. A 130 BPM track can produce excessively rapid edits if every beat is used.

9.3 Footage assignment

For every output segment, choose an appropriate source segment.

The selection algorithm should:

1. Filter footage to the user’s selected pool.
2. Apply tag preferences.
3. Reject unavailable or unusable segments.
4. Avoid immediate repetition where alternatives exist.
5. Respect the minimum usable source duration.
6. Prefer segments that have not been overused.
7. Avoid arbitrary cropping that removes the subject.
8. Record why each segment was selected where practical.

If no suitable footage exists, reuse a valid segment or notify the user. Never create a broken reference.

9.4 Framing and crop

For vertical video, convert horizontal footage into a 9:16 frame.

MVP requirements:

* Center crop.
* Manual crop positioning.
* Scale and position controls.
* Optional keyframed position changes.

Later enhancements:

* Subject tracking.
* Face-aware crop.
* Motion-aware reframing.

Subject tracking must be an optional module rather than a dependency for the first release.

9.5 Zoom and motion effects

Support configurable effects:

* Static shot.
* Subtle zoom-in.
* Subtle zoom-out.
* Punch-in on a beat.
* Pan.
* Simple speed change.

Effects should be deterministic and reproducible from saved settings.

Speed ramps and optical-flow interpolation can be deferred.

9.6 Reroll

Reroll generates a new edit variation while retaining the user’s chosen constraints.

By default, preserve:

* Song.
* Selected hook.
* Output duration.
* Aspect ratio.
* Editing mode.
* Preset.
* Caption style.

Allow configuration for whether reroll can change:

* Opening shot.
* Clip order.
* Source segments.
* Cut pattern.
* Zoom variation.
* Transition selection.

Use a saved random seed for reproducibility.

A reroll must not overwrite the existing edit.

⸻

10. BATCH GENERATION

Batch generation is a first-class feature.

10.1 Batch configuration

Allow the user to choose:

* One or more hooks.
* One or more presets.
* Number of variations.
* Footage collections.
* Caption styles.
* Cut strategies.
* Opening-shot strategies.
* Output formats.

Example:

Song: Rumelaj
Hooks: 3
Presets: 2
Variations per combination: 3
Potential output:
3 hooks × 2 presets × 3 variations
= 18 draft videos

Show the expected output count before starting.

10.2 Variation diversity

Variations should be meaningfully different, not simply identical renders with a different filename.

Vary selected parameters such as:

* Opening shot.
* Clip sequence.
* Source segments.
* Cut density.
* Crop framing.
* Caption presentation.

Avoid changing too many variables simultaneously if the user wants to compare specific creative choices.

10.3 Draft review

Each draft should have a status:

* Draft.
* Rendering.
* Ready for review.
* Approved.
* Rejected.
* Exported.
* Failed.

Users should be able to approve or reject drafts in bulk.

Batch generation must be interruptible, resumable and recoverable after an application restart.

⸻

11. TIMELINE EDITOR

The timeline editor is essential, but it does not need to replicate a full professional nonlinear editor.

11.1 Timeline tracks

Provide at least:

VIDEO TRACK
[ Clip A ][ Clip B ][ Clip C ][ Clip D ]
LYRICS TRACK
      [ Word ][ Word ][ Word ][ Word ]
TEXT / EFFECTS
[ Title ]          [ Zoom ]
AUDIO TRACK
[             Full Song             ]
MUSIC MARKERS
| beat | beat | beat | downbeat | beat |

11.2 Essential interactions

* Scrub timeline.
* Play/pause.
* Frame or time-based seeking.
* Zoom timeline in/out.
* Move a cut.
* Trim a segment.
* Replace a source clip.
* Change clip order.
* Adjust lyric timing.
* Undo/redo.
* Save project.
* Preview the current edit.

11.3 Editing model

Use a non-destructive timeline model.

All edits must update the EditPlan rather than modifying original source files.

Undo/redo should operate on edit commands or equivalent snapshots.

The preview should be responsive, using proxies and reduced-resolution playback where needed.

11.4 Keyboard shortcuts

Initial shortcuts:

* Space: Play/pause.
* Left/right arrows: Seek.
* Shift + arrows: Larger seek interval.
* Ctrl + Z: Undo.
* Ctrl + Shift + Z: Redo.
* Ctrl + S: Save.
* Delete: Remove selected timeline element.

Provide a visible shortcut guide.

⸻

12. PRESET SYSTEM

Presets define how an edit is generated and styled.

12.1 Preset categories

* Typography.
* Lyric animation.
* Cut rhythm.
* Transitions.
* Motion.
* Framing.
* Color treatment.
* Combined editing styles.

12.2 Preset structure

A preset must contain configuration, not rendered media.

Example:

{
  "name": "Organic Electronic",
  "version": 1,
  "aspectRatio": "9:16",
  "cutMode": "hybrid",
  "barInterval": 2,
  "captionMode": "word-by-word",
  "animation": "subtle-pop",
  "zoomIntensity": 0.06,
  "transitionMode": "hard-cut",
  "repetitionLimit": 2
}

Values are illustrative. Validate all settings and provide safe defaults.

12.3 Preset operations

Users must be able to:

* Create a preset.
* Duplicate a preset.
* Edit a preset.
* Rename a preset.
* Delete a preset.
* Apply a preset to an existing edit.
* Apply a preset to a batch.
* Export/import preset configuration as JSON.

Changing a preset must not silently modify previously rendered videos.

12.4 Artist identity

Presets should support reusable branding elements:

* Logo or artist name.
* Preferred fonts.
* Color palette.
* Caption placement.
* Intro/outro cards.
* Consistent visual treatments.

Avoid hardcoding any single artist identity into the application.

⸻

13. EXPORT ENGINE

13.1 Output formats

Initial presets:

Preset	Resolution	Aspect ratio
Reels / TikTok / Shorts	1080 × 1920	9:16
YouTube landscape	1920 × 1080	16:9
Square social video	1080 × 1080	1:1

Support custom output dimensions in a later settings panel.

13.2 Render pipeline

1. Validate the edit plan.
2. Validate source file availability.
3. Resolve source segments and timing.
4. Prepare required proxies or intermediate media.
5. Render video segments and overlays.
6. Composite lyrics and effects.
7. Mix or attach the selected audio.
8. Encode the final file.
9. Validate the output with FFprobe.
10. Register the export in SQLite.
11. Display the result and output path.

13.3 Rendering requirements

* Do not stretch video unintentionally.
* Do not truncate the music unexpectedly.
* Do not create black frames at cuts.
* Avoid audio/video sync drift.
* Use consistent frame-rate handling.
* Ensure lyric timing matches the rendered frames.
* Clean up temporary files after successful completion.
* Preserve diagnostic logs after failed jobs.

13.4 Render queue

Use a persistent job queue.

Requirements:

* Configurable render concurrency.
* Default to one simultaneous render until resource use is measured.
* Progress reporting.
* Cancel job.
* Retry job.
* Resume pending jobs after restart.
* Distinguish analysis progress from rendering progress.
* Record error messages and logs.

Do not assume that launching multiple FFmpeg processes will always improve throughput.

⸻

14. DATABASE AND PROJECT DATA

Use SQLite as the source of truth for application metadata.

Suggested entities:

Song

* id
* title
* artist
* source_audio_path
* duration
* created_at
* updated_at

MusicAnalysis

* id
* song_id
* bpm
* confidence
* beat_data
* downbeat_data
* energy_data
* section_data
* analysis_version

LyricDocument

* id
* song_id
* language
* source
* transcript_status
* word_timing_data
* updated_at

Hook

* id
* song_id
* name
* start_time
* end_time
* notes
* tags

MediaAsset

* id
* source_path
* content_hash
* duration
* width
* height
* frame_rate
* thumbnail_path
* proxy_path
* tags
* availability_status

MediaSegment

* id
* media_asset_id
* source_in
* source_out
* tags

Preset

* id
* name
* version
* configuration_json
* created_at
* updated_at

Edit

* id
* song_id
* hook_id
* preset_id
* name
* edit_plan_json
* status
* random_seed
* created_at
* updated_at

Batch

* id
* name
* configuration_json
* status
* created_at

BatchItem

* id
* batch_id
* edit_id
* status

RenderJob

* id
* edit_id
* status
* progress
* output_path
* error_message
* started_at
* completed_at

Use proper foreign keys, migrations and indexes.

Large waveform and analysis data may be stored in separate files when that is more efficient. SQLite should retain references and version information.

14.1 File organization

Use a user-configurable application data directory.

Suggested layout:

MusicContentEngine/
├── app-data/
│   ├── database.sqlite
│   ├── projects/
│   ├── thumbnails/
│   ├── proxies/
│   ├── waveforms/
│   ├── analysis/
│   ├── presets/
│   ├── temp/
│   └── logs/
└── exports/
    └── SongName/
        ├── Hook01_Variant01.mp4
        ├── Hook01_Variant02.mp4
        └── Hook02_Variant01.mp4

The original source files should normally remain in their existing locations.

The application must provide a way to relink missing source media and change the export destination.

⸻

15. PRIVACY AND RELIABILITY

The default application must operate locally.

Requirements:

* No mandatory account.
* No mandatory upload of original audio or video.
* No hidden cloud processing.
* Explicit consent before sending media to an external service.
* Clear indication when an optional external service is in use.
* Local logs and diagnostics.
* Recoverable database migrations.
* Graceful handling of missing source files.
* Safe handling of interrupted renders.
* Clear warnings before destructive operations.
* No deletion of original media during cleanup.

Any optional online features must be isolated behind a provider interface so they can be disabled without breaking the core application.

⸻

16. MVP: FIRST WORKING RELEASE

The MVP should be deliberately narrow.

Its goal is to prove that the entire workflow works reliably from imported media to final exported video.

Required for MVP

1. Create and save a song project.
2. Import one audio file.
3. Analyze audio and generate beat markers.
4. Manually select a hook or time range.
5. Import multiple video clips.
6. Preview and manually tag clips.
7. Automatically transcribe lyrics, with manual correction.
8. Generate word or line timing.
9. Create an automatic beat-synchronized edit.
10. Render lyrics over video.
11. Preview the result.
12. Edit cut positions and lyric timing.
13. Generate multiple variations.
14. Save and apply at least one reusable preset.
15. Export 1080 × 1920 MP4.
16. Persist project state in SQLite.
17. Recover pending jobs after restart.
18. Provide useful error messages and logs.

Explicitly out of scope for MVP

Do not implement these before the core pipeline works:

* Automatic social media posting.
* Social media account integrations.
* Cloud collaboration.
* Subscription or billing infrastructure.
* A mobile companion application.
* Full AI scene understanding.
* Automatic face recognition.
* Sophisticated subject tracking.
* AI-generated video.
* Advanced speed ramps.
* Professional color grading.
* A full multi-camera nonlinear editor.
* A complete content calendar.
* Automatic trend discovery.

These may be considered later.

⸻

17. DEVELOPMENT ROADMAP

Implement the application in phases. Every phase must leave the application runnable.

Phase 0 — Project foundation

* Initialize the repository.
* Configure Electron, React, TypeScript and Vite.
* Establish main-process/renderer-process boundaries.
* Configure SQLite and migrations.
* Implement persistent settings.
* Implement logging.
* Build the main navigation and empty project screens.
* Add unit tests and a basic application smoke test.

Acceptance criterion: The app launches on Windows, creates a database and saves/reloads a test project.

Phase 1 — Media ingestion

* Import audio.
* Import video.
* Extract metadata using FFprobe.
* Generate thumbnails.
* Build a basic media library.
* Preview audio and video.
* Track missing files.

Acceptance criterion: A user can import a song and multiple clips, close the application, reopen it and access the same assets.

Phase 2 — Music analysis and lyrics

* Generate a waveform.
* Detect BPM and beat markers.
* Implement manual beat correction.
* Integrate a transcription engine.
* Build lyric editing.
* Store word-level timestamps.
* Implement manual hook selection.

Acceptance criterion: The user can verify lyrics and inspect musical markers against the waveform.

Phase 3 — First automatic edit

* Implement the EditPlan schema.
* Implement beat-snap cuts.
* Assign video segments to timeline segments.
* Implement vertical cropping.
* Add basic lyric overlays.
* Render using FFmpeg and Remotion as appropriate.

Acceptance criterion: A song, several video clips and verified lyrics can produce a playable 15-second vertical MP4 with synchronized cuts and captions.

This is the first major project milestone.

Phase 4 — Timeline editing

* Implement the timeline UI.
* Add cut movement and trimming.
* Add clip replacement.
* Add lyric timing adjustments.
* Add undo/redo.
* Implement non-destructive saving.
* Verify preview/render consistency.

Acceptance criterion: A user can correct the automatically generated edit and export the corrected result without restarting the project.

Phase 5 — Presets and reroll

* Implement preset creation and persistence.
* Apply presets to edits.
* Implement deterministic variation generation.
* Add clip repetition rules.
* Add opening-shot variation.
* Add edit duplication.

Acceptance criterion: A user can generate distinct versions of the same hook and reproduce a specific variation from its saved settings and seed.

Phase 6 — Batch generation

* Create the batch configuration UI.
* Generate multiple edits.
* Add batch status tracking.
* Implement keep/reject workflows.
* Add persistent rendering jobs.
* Add retry and cancellation.
* Implement batch export.

Acceptance criterion: A batch of at least 10 drafts can be generated, reviewed, selectively rendered and recovered after restarting the application.

Phase 7 — Advanced editing

Only after the previous phases are stable:

* Energy-based cutting.
* Section-aware editing.
* Advanced animations.
* Subject tracking.
* Improved auto-reframing.
* Color treatments.
* Speed effects.
* Advanced footage recommendations.

Phase 8 — Content management

Optional future additions:

* Content calendar.
* Hook and concept database.
* Export collections.
* Posting status.
* Social platform integrations.
* Analytics integrations.
* Optional cloud backup or synchronization.

These are separate capabilities, not prerequisites for the core editor.

⸻

18. TESTING STRATEGY

Create a small, controlled test library containing:

* One short song with clear beats.
* One song with vocals.
* One instrumental track.
* Several vertical clips.
* Several horizontal clips.
* A clip with variable frame rate.
* A clip with audio and a clip without audio.
* A clip with unusual metadata.

Use these assets to validate the pipeline.

Required automated tests

Unit tests

* Beat-marker validation.
* Timeline calculations.
* Cut generation.
* Source segment bounds.
* Lyric timing.
* Preset validation.
* Variation reproducibility.

Integration tests

* Import media.
* Generate thumbnails.
* Save and reload projects.
* Create an edit plan.
* Render a short video.
* Validate output duration and streams.
* Recover interrupted jobs.

UI tests

* Create project.
* Import media.
* Edit lyrics.
* Generate a draft.
* Modify a cut.
* Save and reopen.
* Export video.

Quality checks

After each test render, use FFprobe and other appropriate checks to verify:

* Output file exists.
* Video stream is valid.
* Audio stream is valid when expected.
* Duration is within a reasonable tolerance.
* Resolution matches the selected preset.
* Frame rate is correct.
* Output can be decoded.
* No missing-media references remain.

Use visual spot checks for black frames, bad crops and caption timing.

⸻

19. PERFORMANCE REQUIREMENTS

The application should remain usable with large footage libraries.

Initial engineering targets:

* Thumbnail generation runs in the background.
* UI interactions remain responsive during analysis.
* Long-running tasks do not block the main interface.
* Media previews use proxies where beneficial.
* Audio analysis results are cached.
* Unchanged assets are not analyzed repeatedly without reason.
* Render concurrency is configurable.
* Temporary files have a managed lifecycle.
* Progress and cancellation are available for long jobs.

Do not promise real-time rendering or a specific render speed until measured on representative hardware.

Implement clear progress reporting instead of displaying a frozen interface during processing.

⸻

20. INITIAL INTERFACE DESIGN

The interface should feel like a focused creative studio rather than a generic video editor.

Use a dark, restrained visual design, with the option to customize the accent color.

Avoid excessive panels and unnecessary settings on the first screen.

Create screen

┌─────────────────────────────────────────────────────────────┐
│ MUSIC CONTENT ENGINE                         Settings       │
├──────────────┬──────────────────────────────────────────────┤
│ Home         │ Create Content                               │
│ Songs        │                                              │
│ Media Library│  Select song                                 │
│ Create       │  [ Import audio ]                             │
│ Presets      │                                              │
│ Exports      │  Select footage                              │
│              │  [ Import videos or folder ]                  │
│              │                                              │
│              │  Lyrics      [ Auto-transcribe ]              │
│              │  Section     [ Select hook ]                  │
│              │  Style       [ Hybrid ▼ ]                     │
│              │  Format      [ 9:16 ▼ ]                      │
│              │  Variations  [ 5 ]                            │
│              │                                              │
│              │           [ Generate drafts ]                 │
└──────────────┴──────────────────────────────────────────────┘

Batch review screen

Display a grid of generated drafts, each with:

* Thumbnail.
* Duration.
* Applied preset.
* Hook name.
* Status.
* Preview/play control.
* Keep/reject action.
* Edit action.
* Export action.

Support bulk selection and bulk export.

Timeline screen

The timeline must show:

* Video track.
* Lyrics track.
* Audio waveform.
* Beat markers.
* Playhead.
* Preview monitor.
* Properties panel.

The editor must support both manual corrections and fast navigation between generated drafts.

⸻

21. IMPLEMENTATION RULES FOR THE CODING AGENT

These rules are mandatory.

1. Do not attempt to implement the entire application in one response. Work incrementally.
2. Inspect the existing repository before modifying it.
3. This is an independent project. Do not import or depend on Drop Machine.
4. Create a README.md with setup, build, run and troubleshooting instructions.
5. Create a PROJECT_STATUS.md to track implemented features, known bugs and the next task.
6. Create a TECHNICAL_DECISIONS.md documenting meaningful architectural decisions.
7. Use TypeScript strict mode.
8. Define and validate shared data schemas before implementing dependent UI.
9. Keep media processing out of React components.
10. Keep Electron’s renderer isolated from unrestricted operating-system access.
11. Use typed IPC interfaces and validate incoming IPC requests.
12. Do not expose arbitrary shell execution to the renderer.
13. Do not build long-running processing tasks into UI event handlers.
14. Use real media processing. Do not fake beat detection, transcription, renders or progress.
15. Do not create placeholder controls that appear functional but do nothing.
16. If a feature is not implemented, label it clearly as unavailable or unfinished.
17. Add automated tests for core timing and rendering logic.
18. Use migrations when changing the database schema.
19. Preserve project compatibility when changing EditPlan or preset schemas.
20. Keep all generated outputs reproducible from saved project settings whenever possible.
21. Record processing errors and provide actionable messages.
22. Do not delete source media or existing project data during routine cleanup.
23. Validate every output before marking a render as complete.
24. Update PROJECT_STATUS.md after each meaningful milestone.
25. At the end of each phase, provide a concise summary of implemented features, tests performed, known limitations and the exact next steps.

If an implementation decision has significant consequences for reliability, rendering quality or maintainability, document the alternatives and the reason for the selected approach.

Do not introduce cloud dependencies, paid APIs or external services without documenting the cost, privacy implications and local alternative.

⸻

22. FIRST TASK FOR THE CODING AGENT

Begin with Phase 0 only.

Do the following:

1. Inspect the current workspace and identify whether a project already exists.
2. Create the application skeleton using Electron, React, TypeScript and Vite.
3. Establish secure IPC boundaries.
4. Set up SQLite with a migration system.
5. Create the initial navigation and placeholder screens for Home, Songs, Media Library, Create, Presets and Exports.
6. Implement project creation and persistence.
7. Add logging and basic automated tests.
8. Document installation and launch instructions.
9. Run the application and the available tests.
10. Update PROJECT_STATUS.md.

Do not begin advanced AI, beat analysis or batch rendering until this foundation works.

Once Phase 0 is verified, proceed to Phase 1 and implement actual media import.

The goal is to maintain a continuously runnable application rather than producing a large codebase that has not been tested end to end.

⸻

23. DEFINITION OF SUCCESS

The project succeeds when a musician can:

1. Import a finished song.
2. Import a collection of original performance videos.
3. Generate and correct lyrics.
4. Select a musical hook.
5. Automatically create beat-synchronized edits.
6. Generate several meaningfully different versions.
7. Review and correct the edits.
8. Save a reusable visual preset.
9. Export selected videos as clean MP4 files.
10. Reopen the project later and continue editing without losing work.

The most important milestone is not the number of AI features or interface screens.

It is this complete, reliable workflow:

Import music → import footage → analyze → synchronize lyrics → generate edit → review → render → save and reuse.

Build that first. Everything else should extend it rather than complicate it.