import type {
  AppInfo,
  CreateProjectInput,
  DirectoryChoiceResult,
  IpcResult,
  LogWriteInput,
  Project,
  Settings,
  SettingsUpdateInput,
  UpdateProjectInput
} from './schemas'
import type {
  ImportDialogResult,
  ImportQueueState,
  ImportSummary,
  MediaAsset,
  MediaEvent,
  MediaToolsStatus,
  RelinkFolderResult,
  RelinkResult
} from './media'
import type { BeatCorrections, BeatMap, Waveform } from './analysis'
import type { CreateHookInput, Hook, UpdateHookInput } from './hooks'
import type { LyricsState, SaveLyricsInput } from './lyrics'
import type { AnalysisState, SongWorkspace, SpeechModelInfo, SpeechToolsStatus, TranscribeInput, WorkspaceEvent } from './workspace'

/** The API exposed to the renderer as `window.mce`. Every call is validated in the main process. */
export interface MceApi {
  app: {
    getInfo(): Promise<IpcResult<AppInfo>>
    openLogsFolder(): Promise<IpcResult<null>>
  }
  projects: {
    list(): Promise<IpcResult<Project[]>>
    get(id: string): Promise<IpcResult<Project>>
    create(input: CreateProjectInput): Promise<IpcResult<Project>>
    update(input: UpdateProjectInput): Promise<IpcResult<Project>>
    setAudio(id: string, audioAssetId: string | null): Promise<IpcResult<Project>>
    delete(id: string): Promise<IpcResult<null>>
  }
  media: {
    toolsStatus(): Promise<IpcResult<MediaToolsStatus>>
    recheckTools(): Promise<IpcResult<MediaToolsStatus>>
    list(): Promise<IpcResult<MediaAsset[]>>
    queueState(): Promise<IpcResult<ImportQueueState>>
    /** Opens the system file or folder picker and imports the selection. */
    importWithDialog(mode: 'files' | 'folder'): Promise<IpcResult<ImportDialogResult>>
    /** Imports files or folders dropped onto the window. */
    importDropped(files: readonly File[]): Promise<IpcResult<ImportSummary>>
    cancel(id: string): Promise<IpcResult<null>>
    cancelAll(): Promise<IpcResult<null>>
    retry(id: string): Promise<IpcResult<MediaAsset>>
    remove(id: string): Promise<IpcResult<null>>
    /** Opens a file picker to locate a moved file. */
    relink(id: string): Promise<IpcResult<RelinkResult>>
    /** Confirms a relink whose file content differs from the original. */
    relinkConfirm(id: string): Promise<IpcResult<RelinkResult>>
    /** Opens a folder picker and relinks every missing file found inside it. */
    relinkFolder(): Promise<IpcResult<RelinkFolderResult>>
    checkAvailability(): Promise<IpcResult<{ missing: number }>>
    showInFolder(id: string): Promise<IpcResult<null>>
    /** Subscribes to library changes. Returns an unsubscribe function. */
    onEvent(listener: (event: MediaEvent) => void): () => void
  }
  workspace: {
    get(songId: string): Promise<IpcResult<SongWorkspace>>
    waveform(assetId: string): Promise<IpcResult<Waveform | null>>
    reanalyze(songId: string): Promise<IpcResult<AnalysisState | null>>
    setCorrections(songId: string, corrections: BeatCorrections): Promise<IpcResult<{ corrections: BeatCorrections; beatMap: BeatMap | null }>>
    saveLyrics(input: SaveLyricsInput): Promise<IpcResult<LyricsState>>
    transcribe(input: TranscribeInput): Promise<IpcResult<LyricsState>>
    cancelTranscription(songId: string): Promise<IpcResult<LyricsState>>
    createHook(input: CreateHookInput): Promise<IpcResult<Hook>>
    updateHook(input: UpdateHookInput): Promise<IpcResult<Hook>>
    deleteHook(id: string): Promise<IpcResult<null>>
    /** Analysis progress, lyrics/transcription changes and model downloads. Returns an unsubscribe function. */
    onEvent(listener: (event: WorkspaceEvent) => void): () => void
  }
  speech: {
    status(): Promise<IpcResult<SpeechToolsStatus>>
    recheck(): Promise<IpcResult<SpeechToolsStatus>>
    models(): Promise<IpcResult<SpeechModelInfo[]>>
    /** Starts downloading a model (explicit user action; the only network use in the app). */
    downloadModel(id: string): Promise<IpcResult<null>>
    cancelDownload(id: string): Promise<IpcResult<null>>
    deleteModel(id: string): Promise<IpcResult<null>>
  }
  settings: {
    get(): Promise<IpcResult<Settings>>
    update(input: SettingsUpdateInput): Promise<IpcResult<Settings>>
    chooseDataDirectory(): Promise<IpcResult<DirectoryChoiceResult>>
    chooseExportDirectory(): Promise<IpcResult<DirectoryChoiceResult>>
  }
  log: {
    write(input: LogWriteInput): Promise<IpcResult<null>>
  }
}
