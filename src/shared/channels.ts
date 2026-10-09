/**
 * IPC channel names. This file must stay free of runtime dependencies:
 * it is bundled into the sandboxed preload script.
 */
export const IpcChannels = {
  appGetInfo: 'app:get-info',
  appOpenLogsFolder: 'app:open-logs-folder',
  projectsList: 'projects:list',
  projectsGet: 'projects:get',
  projectsCreate: 'projects:create',
  projectsUpdate: 'projects:update',
  projectsDelete: 'projects:delete',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChooseDataDirectory: 'settings:choose-data-directory',
  settingsChooseExportDirectory: 'settings:choose-export-directory',
  logWrite: 'log:write'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

export const ALL_IPC_CHANNELS: readonly IpcChannel[] = Object.values(IpcChannels)
