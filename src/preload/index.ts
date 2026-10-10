import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { MceApi } from '../shared/api'
import { IpcChannels, IpcEvents, type IpcChannel } from '../shared/channels'
import type { MediaEvent } from '../shared/media'
import type { WorkspaceEvent } from '../shared/workspace'
import type { IpcResult } from '../shared/schemas'

/**
 * The renderer gets exactly these functions and nothing else: no ipcRenderer,
 * no generic invoke, no Node APIs. Inputs are validated again in main.
 */
const call = <T>(channel: IpcChannel, input?: unknown): Promise<IpcResult<T>> =>
  ipcRenderer.invoke(channel, input) as Promise<IpcResult<T>>

const api: MceApi = {
  app: {
    getInfo: () => call(IpcChannels.appGetInfo),
    openLogsFolder: () => call(IpcChannels.appOpenLogsFolder)
  },
  projects: {
    list: () => call(IpcChannels.projectsList),
    get: (id) => call(IpcChannels.projectsGet, { id }),
    create: (input) => call(IpcChannels.projectsCreate, input),
    update: (input) => call(IpcChannels.projectsUpdate, input),
    setAudio: (id, audioAssetId) => call(IpcChannels.projectsSetAudio, { id, audioAssetId }),
    delete: (id) => call(IpcChannels.projectsDelete, { id })
  },
  media: {
    toolsStatus: () => call(IpcChannels.mediaToolsStatus),
    recheckTools: () => call(IpcChannels.mediaToolsRecheck),
    list: () => call(IpcChannels.mediaList),
    queueState: () => call(IpcChannels.mediaQueueState),
    importWithDialog: (mode) => call(IpcChannels.mediaImportDialog, { mode }),
    importDropped: (files) => {
      // Real paths are only obtainable from genuine File objects (drag-and-drop or <input>),
      // so the renderer can't hand arbitrary path strings to the main process.
      const paths = Array.from(files)
        .map((file) => webUtils.getPathForFile(file))
        .filter((path) => path.length > 0)
      if (paths.length === 0) {
        return Promise.resolve({
          ok: false,
          error: { code: 'VALIDATION', message: 'Nothing importable was dropped. Drop files or folders from your computer.' }
        })
      }
      return call(IpcChannels.mediaImportPaths, { paths })
    },
    cancel: (id) => call(IpcChannels.mediaCancel, { id }),
    cancelAll: () => call(IpcChannels.mediaCancelAll),
    retry: (id) => call(IpcChannels.mediaRetry, { id }),
    remove: (id) => call(IpcChannels.mediaRemove, { id }),
    relink: (id) => call(IpcChannels.mediaRelink, { id }),
    relinkConfirm: (id) => call(IpcChannels.mediaRelinkConfirm, { id }),
    relinkFolder: () => call(IpcChannels.mediaRelinkFolder),
    checkAvailability: () => call(IpcChannels.mediaCheckAvailability),
    showInFolder: (id) => call(IpcChannels.mediaShowInFolder, { id }),
    onEvent: (listener) => {
      // Only the payload is forwarded; the IpcRendererEvent (with its sender) never reaches the page.
      const handler = (_event: Electron.IpcRendererEvent, payload: MediaEvent) => listener(payload)
      ipcRenderer.on(IpcEvents.media, handler)
      return () => {
        ipcRenderer.removeListener(IpcEvents.media, handler)
      }
    }
  },
  workspace: {
    get: (songId) => call(IpcChannels.workspaceGet, { songId }),
    waveform: (assetId) => call(IpcChannels.workspaceWaveform, { assetId }),
    reanalyze: (songId) => call(IpcChannels.analysisReanalyze, { songId }),
    setCorrections: (songId, corrections) => call(IpcChannels.beatsSetCorrections, { songId, corrections }),
    saveLyrics: (input) => call(IpcChannels.lyricsSave, input),
    transcribe: (input) => call(IpcChannels.lyricsTranscribe, input),
    cancelTranscription: (songId) => call(IpcChannels.lyricsCancelTranscription, { songId }),
    createHook: (input) => call(IpcChannels.hooksCreate, input),
    updateHook: (input) => call(IpcChannels.hooksUpdate, input),
    deleteHook: (id) => call(IpcChannels.hooksDelete, { id }),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: WorkspaceEvent) => listener(payload)
      ipcRenderer.on(IpcEvents.workspace, handler)
      return () => {
        ipcRenderer.removeListener(IpcEvents.workspace, handler)
      }
    }
  },
  speech: {
    status: () => call(IpcChannels.speechStatus),
    recheck: () => call(IpcChannels.speechRecheck),
    models: () => call(IpcChannels.modelsList),
    downloadModel: (id) => call(IpcChannels.modelsDownload, { id }),
    cancelDownload: (id) => call(IpcChannels.modelsCancel, { id }),
    deleteModel: (id) => call(IpcChannels.modelsDelete, { id })
  },
  settings: {
    get: () => call(IpcChannels.settingsGet),
    update: (input) => call(IpcChannels.settingsUpdate, input),
    chooseDataDirectory: () => call(IpcChannels.settingsChooseDataDirectory),
    chooseExportDirectory: () => call(IpcChannels.settingsChooseExportDirectory)
  },
  log: {
    write: (input) => call(IpcChannels.logWrite, input)
  }
}

contextBridge.exposeInMainWorld('mce', api)
