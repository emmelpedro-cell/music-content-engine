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
    delete(id: string): Promise<IpcResult<null>>
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
