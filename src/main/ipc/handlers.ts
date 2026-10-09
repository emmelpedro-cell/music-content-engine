import { IpcChannels, type IpcChannel } from '../../shared/channels'
import {
  CreateProjectInputSchema,
  EmptyInputSchema,
  LogWriteInputSchema,
  ProjectIdInputSchema,
  SettingsUpdateInputSchema,
  UpdateProjectInputSchema,
  type AppInfo,
  type DirectoryChoiceResult
} from '../../shared/schemas'
import type { Logger } from '../logger'
import type { ProjectsRepository } from '../repositories/projects'
import type { SettingsRepository } from '../repositories/settings'
import { defineHandler, type HandlerDefinition } from './handler'

/** Everything the handlers need from the outside world, so they can be tested without Electron. */
export type HandlerDeps = {
  projects: ProjectsRepository
  settings: SettingsRepository
  logger: Logger
  rendererLogger: Logger
  getAppInfo: () => AppInfo
  openLogsFolder: () => Promise<void>
  chooseDataDirectory: () => Promise<DirectoryChoiceResult>
  chooseExportDirectory: () => Promise<DirectoryChoiceResult>
}

// Input/output types are enforced per entry by defineHandler; the table itself is heterogeneous.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HandlerTable = Record<IpcChannel, HandlerDefinition<any, any>>

export function buildHandlers(deps: HandlerDeps): HandlerTable {
  return {
    [IpcChannels.appGetInfo]: defineHandler({
      schema: EmptyInputSchema,
      handle: () => deps.getAppInfo()
    }),
    [IpcChannels.appOpenLogsFolder]: defineHandler({
      schema: EmptyInputSchema,
      handle: async () => {
        await deps.openLogsFolder()
        return null
      }
    }),

    [IpcChannels.projectsList]: defineHandler({
      schema: EmptyInputSchema,
      handle: () => deps.projects.list()
    }),
    [IpcChannels.projectsGet]: defineHandler({
      schema: ProjectIdInputSchema,
      handle: ({ id }) => deps.projects.get(id)
    }),
    [IpcChannels.projectsCreate]: defineHandler({
      schema: CreateProjectInputSchema,
      handle: (input) => {
        const project = deps.projects.create(input)
        deps.logger.info('Project created', { id: project.id })
        return project
      }
    }),
    [IpcChannels.projectsUpdate]: defineHandler({
      schema: UpdateProjectInputSchema,
      handle: (input) => deps.projects.update(input)
    }),
    [IpcChannels.projectsDelete]: defineHandler({
      schema: ProjectIdInputSchema,
      handle: ({ id }) => {
        deps.projects.delete(id)
        deps.logger.info('Project deleted', { id })
        return null
      }
    }),

    [IpcChannels.settingsGet]: defineHandler({
      schema: EmptyInputSchema,
      handle: () => deps.settings.get()
    }),
    [IpcChannels.settingsUpdate]: defineHandler({
      schema: SettingsUpdateInputSchema,
      handle: (patch) => deps.settings.update(patch)
    }),
    [IpcChannels.settingsChooseDataDirectory]: defineHandler({
      schema: EmptyInputSchema,
      handle: () => deps.chooseDataDirectory()
    }),
    [IpcChannels.settingsChooseExportDirectory]: defineHandler({
      schema: EmptyInputSchema,
      handle: () => deps.chooseExportDirectory()
    }),

    [IpcChannels.logWrite]: defineHandler({
      schema: LogWriteInputSchema,
      handle: ({ level, message, context }) => {
        deps.rendererLogger[level](message, context)
        return null
      }
    })
  }
}
