import { contextBridge, ipcRenderer } from 'electron'
import type { MceApi } from '../shared/api'
import { IpcChannels, type IpcChannel } from '../shared/channels'
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
    delete: (id) => call(IpcChannels.projectsDelete, { id })
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
