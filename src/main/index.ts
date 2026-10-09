import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
import type { SqlDriver } from './db/driver'
import { createBetterSqliteDriver } from './db/better-sqlite3-driver'
import { openDatabase } from './db/open'
import { buildHandlers } from './ipc/handlers'
import { registerIpcHandlers } from './ipc/register'
import { createLogger, type Logger } from './logger'
import { ensureLayout, resolveLayout, resolveRootDirectory, writeBootstrap, type AppLayout } from './paths'
import { ProjectsRepository } from './repositories/projects'
import { SettingsRepository } from './repositories/settings'
import { createSenderValidator } from './security'

const isDev = !app.isPackaged
const devServerUrl = process.env['ELECTRON_RENDERER_URL']
const rendererIndexPath = join(__dirname, '../renderer/index.html')
const preloadPath = join(__dirname, '../preload/index.js')
const bootstrapFile = join(app.getPath('userData'), 'bootstrap.json')

let mainWindow: BrowserWindow | null = null
let db: SqlDriver | null = null
let logger: Logger | null = null

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
    }
  })

  registerIpcHandlers(
    ipcMain,
    handlers,
    createSenderValidator({ devServerUrl: isDev ? devServerUrl : undefined, rendererIndexPath }),
    log.child('ipc')
  )

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

async function chooseDataDirectory(current: AppLayout) {
  const path = await pickFolder('Choose where Music Content Engine stores its data')
  if (!path || path === current.root) return { changed: false } as const
  writeBootstrap(bootstrapFile, { rootDirectory: path })
  logger?.info('Data folder changed (takes effect after restart)', { from: current.root, to: path })
  return { changed: true, path, restartRequired: true } as const
}

async function pickFolder(title: string): Promise<string | null> {
  const options: Electron.OpenDialogOptions = { title, properties: ['openDirectory', 'createDirectory'] }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
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

  // No popups, no navigation away from the app. External http(s) links open in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
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
  // The app needs no camera, microphone, notifications or geolocation in Phase 0.
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
    db?.close()
    logger?.info('App closed')
  } catch (error) {
    logger?.error('Error while closing database', { error })
  }
})
