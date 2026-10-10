import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { IpcEvents } from '../shared/channels'
import type { MediaEvent } from '../shared/media'
import type { WorkspaceEvent } from '../shared/workspace'
import { workerRunner } from './analysis/run-in-worker'
import { AnalysisService } from './analysis/service'
import { AnalysisRepository } from './repositories/analysis'
import { WorkspaceRepository } from './repositories/workspace'
import { SpeechModels } from './transcription/models'
import { TranscriptionService } from './transcription/service'
import { resolveWhisper, WhisperManager } from './transcription/whisper-binary'
import { SongWorkspaceService } from './workspace'
import type { SqlDriver } from './db/driver'
import { createBetterSqliteDriver } from './db/better-sqlite3-driver'
import { openDatabase } from './db/open'
import { NotFoundError } from './errors'
import { buildHandlers } from './ipc/handlers'
import { registerIpcHandlers } from './ipc/register'
import { createLogger, type Logger } from './logger'
import { resolveMediaTools } from './media/binaries'
import { cleanTempDirectory, MEDIA_EXTENSIONS } from './media/files'
import { ImportService } from './media/import-service'
import { handleMediaRequest, MEDIA_SCHEME, MEDIA_SCHEME_PRIVILEGES } from './media/protocol'
import { MediaToolsManager } from './media/tools-manager'
import { ensureLayout, resolveLayout, resolveRootDirectory, writeBootstrap, type AppLayout } from './paths'
import { MediaRepository } from './repositories/media'
import { ProjectsRepository } from './repositories/projects'
import { SettingsRepository } from './repositories/settings'
import { createSenderValidator } from './security'

const isDev = !app.isPackaged
const devServerUrl = process.env['ELECTRON_RENDERER_URL']
const rendererIndexPath = join(__dirname, '../renderer/index.html')
const preloadPath = join(__dirname, '../preload/index.js')
const bootstrapFile = join(app.getPath('userData'), 'bootstrap.json')

// Must happen before the app is ready.
protocol.registerSchemesAsPrivileged([MEDIA_SCHEME_PRIVILEGES])

let mainWindow: BrowserWindow | null = null
let db: SqlDriver | null = null
let logger: Logger | null = null
let importService: ImportService | null = null
const shutdownHooks: (() => void)[] = []

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(start).catch(fatal)
}

function start(): void {
  const { root, overridden } = resolveRootDirectory({
    env: process.env,
    bootstrapFile,
    documentsDirectory: app.getPath('documents')
  })
  const layout = resolveLayout(root)
  ensureLayout(layout)

  logger = createLogger({ directory: layout.logs, mirrorToConsole: isDev, minLevel: isDev ? 'debug' : 'info' })
  const log = logger
  log.info('App starting', { version: app.getVersion(), root, overridden, electron: process.versions.electron })

  process.on('uncaughtException', (error) => log.error('Uncaught exception', { error }))
  process.on('unhandledRejection', (reason) => log.error('Unhandled promise rejection', { reason }))

  const opened = openDatabase({
    databasePath: layout.database,
    backupsDirectory: layout.backups,
    createDriver: createBetterSqliteDriver,
    logger: log.child('db')
  })
  db = opened.db

  const projects = new ProjectsRepository(opened.db)
  const settings = new SettingsRepository(opened.db, log.child('settings'))
  const mediaRepo = new MediaRepository(opened.db)

  // ---- Media -----------------------------------------------------------
  const toolsLocation = resolveMediaTools({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    platform: process.platform,
    arch: process.arch,
    env: process.env
  })
  const tools = new MediaToolsManager(toolsLocation, log.child('ffmpeg'))
  void tools.status() // verify in the background right away

  void cleanTempDirectory(layout.temp).then((removed) => {
    if (removed) log.info('Removed leftover temporary files', { removed })
  })

  const service = new ImportService({
    repo: mediaRepo,
    getTools: () => tools.require(),
    thumbnailsDirectory: layout.thumbnails,
    tempDirectory: layout.temp,
    logger: log.child('media'),
    emit: sendMediaEvent
  })
  importService = service

  // ---- Phase 2: analysis, transcription, workspace -----------------------
  const workspaceRepo = new WorkspaceRepository(opened.db, log.child('workspace'))
  const analysis = new AnalysisService({
    repo: new AnalysisRepository(opened.db),
    media: mediaRepo,
    getTools: () => tools.require(),
    runner: workerRunner(join(__dirname, 'analysis-worker.js')),
    waveformsDirectory: layout.waveforms,
    logger: log.child('analysis'),
    emit: sendWorkspaceEvent
  })
  const whisper = new WhisperManager(
    resolveWhisper({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      platform: process.platform,
      arch: process.arch,
      env: process.env
    }),
    log.child('whisper')
  )
  void whisper.status()
  const models = new SpeechModels({
    directory: layout.models,
    logger: log.child('models'),
    emit: (list) => sendWorkspaceEvent({ type: 'models', models: list })
  })
  const transcription = new TranscriptionService({
    workspace: workspaceRepo,
    projects,
    media: mediaRepo,
    models,
    getFfmpeg: () => tools.require(),
    getWhisper: () => whisper.require(),
    tempDirectory: layout.temp,
    logger: log.child('transcription'),
    emit: sendWorkspaceEvent
  })
  const workspace = new SongWorkspaceService({
    projects,
    media: mediaRepo,
    repo: workspaceRepo,
    analysis,
    transcription,
    logger: log.child('workspace')
  })
  shutdownHooks.push(
    () => analysis.shutdown(),
    () => transcription.shutdown(),
    () => models.cancelAll()
  )

  protocol.handle(MEDIA_SCHEME, (request) =>
    handleMediaRequest(request, { repo: mediaRepo, thumbnailsDirectory: layout.thumbnails })
  )

  hardenSessions()

  const handlers = buildHandlers({
    projects,
    settings,
    logger: log.child('ipc'),
    rendererLogger: log.child('renderer'),
    getAppInfo: () => ({
      version: app.getVersion(),
      rootDirectory: layout.root,
      appDataDirectory: layout.appData,
      databasePath: layout.database,
      logsDirectory: layout.logs,
      exportDirectory: settings.get().exportDirectory ?? layout.defaultExports,
      schemaVersion: opened.schemaVersion,
      rootDirectoryOverridden: overridden
    }),
    openLogsFolder: async () => {
      const error = await shell.openPath(layout.logs)
      if (error) throw new Error(`Could not open logs folder: ${error}`)
    },
    chooseDataDirectory: () => chooseDataDirectory(layout),
    chooseExportDirectory: async () => {
      const path = await pickFolder('Choose export folder')
      if (!path) return { changed: false }
      settings.update({ exportDirectory: path })
      log.info('Export folder changed', { path })
      return { changed: true, path, restartRequired: false }
    },
    media: {
      repo: mediaRepo,
      service,
      toolsStatus: () => tools.status(),
      recheckTools: () => tools.recheck(),
      importWithDialog: async (mode) => {
        // Check first, so the user isn't asked to pick files that can't be imported.
        await tools.require()
        const paths = await pickMedia(mode)
        if (!paths) return { cancelled: true }
        return { cancelled: false, ...(await service.importPaths(paths)) }
      },
      relinkWithDialog: async (id) => {
        const asset = mediaRepo.get(id)
        const folder = dirname(asset.sourcePath)
        const result = await showOpenDialog({
          title: `Locate “${asset.fileName}”`,
          defaultPath: existsSync(folder) ? folder : undefined,
          properties: ['openFile'],
          filters: mediaFilters()
        })
        if (result.canceled || !result.filePaths[0]) return { status: 'cancelled' }
        return service.relink(id, result.filePaths[0])
      },
      relinkFolderWithDialog: async () => {
        const folder = await pickFolder('Choose a folder to search for missing files')
        if (!folder) return { cancelled: true }
        return service.relinkFromFolder(folder)
      },
      showInFolder: (id) => {
        const asset = mediaRepo.get(id)
        if (existsSync(asset.sourcePath)) {
          shell.showItemInFolder(asset.sourcePath)
        } else if (existsSync(dirname(asset.sourcePath))) {
          void shell.openPath(dirname(asset.sourcePath))
        } else {
          throw new NotFoundError(`Neither “${asset.fileName}” nor its folder exists anymore. Use Relink to locate it.`)
        }
      }
    },
    workspace,
    speech: {
      status: () => whisper.status(),
      recheck: () => whisper.recheck(),
      models
    }
  })

  registerIpcHandlers(
    ipcMain,
    handlers,
    createSenderValidator({ devServerUrl: isDev ? devServerUrl : undefined, rendererIndexPath }),
    log.child('ipc')
  )

  createWindow()
  service.start()
  analysis.start()
  transcription.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

/* ---------------------------------------------------------------------- */
/* Dialogs                                                                */
/* ---------------------------------------------------------------------- */

function mediaFilters(): Electron.FileFilter[] {
  return [
    { name: 'Audio and video', extensions: [...MEDIA_EXTENSIONS] },
    { name: 'All files', extensions: ['*'] }
  ]
}

function showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options)
}

async function pickMedia(mode: 'files' | 'folder'): Promise<string[] | null> {
  const result = await showOpenDialog(
    mode === 'files'
      ? {
          title: 'Import audio and video',
          properties: ['openFile', 'multiSelections'],
          filters: mediaFilters()
        }
      : { title: 'Import a folder of media', properties: ['openDirectory', 'multiSelections'] }
  )
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths
}

async function chooseDataDirectory(current: AppLayout) {
  const path = await pickFolder('Choose where Music Content Engine stores its data')
  if (!path || path === current.root) return { changed: false } as const
  writeBootstrap(bootstrapFile, { rootDirectory: path })
  logger?.info('Data folder changed (takes effect after restart)', { from: current.root, to: path })
  return { changed: true, path, restartRequired: true } as const
}

async function pickFolder(title: string): Promise<string | null> {
  const result = await showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] })
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
}

/* ---------------------------------------------------------------------- */
/* Window                                                                 */
/* ---------------------------------------------------------------------- */

function sendMediaEvent(event: MediaEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IpcEvents.media, event)
}

function sendWorkspaceEvent(event: WorkspaceEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IpcEvents.workspace, event)
}

let lastAvailabilityCheck = 0
function checkAvailabilitySoon(): void {
  // Files may have been moved while the app was in the background.
  if (!importService || Date.now() - lastAvailabilityCheck < 15_000) return
  lastAvailabilityCheck = Date.now()
  void importService.checkAvailability().catch((error) => logger?.warn('Availability check failed', { error }))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0f1012',
    title: 'Music Content Engine',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.on('focus', checkAvailabilitySoon)
  mainWindow.webContents.on('did-finish-load', checkAvailabilitySoon)

  // No popups, no navigation away from the app. External http(s) links open in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Also covers files dropped outside the drop zone, which would otherwise open as a page.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev && devServerUrl && url.startsWith(devServerUrl)
    if (!allowed) {
      event.preventDefault()
      logger?.warn('Blocked navigation', { url })
    }
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger?.error('Renderer process gone', { ...details })
  })

  if (isDev && devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(rendererIndexPath)
  }
}

function hardenSessions(): void {
  // The app needs no camera, microphone, notifications or geolocation.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
}

function fatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  logger?.error('Fatal startup error', { error })
  const logHint = logger ? `\n\nLog file: ${logger.filePath}` : ''
  dialog.showErrorBox('Music Content Engine could not start', `${message}${logHint}`)
  app.exit(1)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  try {
    // Stop FFmpeg child processes; unfinished imports resume on the next start.
    importService?.shutdown()
    for (const stop of shutdownHooks) stop()
    db?.close()
    logger?.info('App closed')
  } catch (error) {
    logger?.error('Error while closing database', { error })
  }
})
