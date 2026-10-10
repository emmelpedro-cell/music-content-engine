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
  projectsSetAudio: 'projects:set-audio',
  mediaToolsStatus: 'media:tools-status',
  mediaToolsRecheck: 'media:tools-recheck',
  mediaList: 'media:list',
  mediaQueueState: 'media:queue-state',
  mediaImportDialog: 'media:import-dialog',
  mediaImportPaths: 'media:import-paths',
  mediaCancel: 'media:cancel',
  mediaCancelAll: 'media:cancel-all',
  mediaRetry: 'media:retry',
  mediaRemove: 'media:remove',
  mediaRelink: 'media:relink',
  mediaRelinkConfirm: 'media:relink-confirm',
  mediaRelinkFolder: 'media:relink-folder',
  mediaCheckAvailability: 'media:check-availability',
  mediaShowInFolder: 'media:show-in-folder',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChooseDataDirectory: 'settings:choose-data-directory',
  settingsChooseExportDirectory: 'settings:choose-export-directory',
  logWrite: 'log:write'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

export const ALL_IPC_CHANNELS: readonly IpcChannel[] = Object.values(IpcChannels)

/** Main → renderer push channels (not invokable from the renderer). */
export const IpcEvents = {
  media: 'media:event'
} as const
