import { IpcChannels, type IpcChannel } from '../../shared/channels'
import {
  AssetIdInputSchema,
  ImportDialogInputSchema,
  ImportPathsInputSchema,
  type ImportDialogResult,
  type MediaToolsStatus,
  type RelinkFolderResult,
  type RelinkResult
} from '../../shared/media'
import {
  CreateProjectInputSchema,
  EmptyInputSchema,
  LogWriteInputSchema,
  ProjectIdInputSchema,
  SetProjectAudioInputSchema,
  SettingsUpdateInputSchema,
  UpdateProjectInputSchema,
  type AppInfo,
  type DirectoryChoiceResult
} from '../../shared/schemas'
import { CreateHookInputSchema, UpdateHookInputSchema } from '../../shared/hooks'
import { SaveLyricsInputSchema } from '../../shared/lyrics'
import {
  AssetIdOnlySchema,
  HookIdInputSchema,
  ModelIdInputSchema,
  SetCorrectionsInputSchema,
  SongIdInputSchema,
  TranscribeInputSchema,
  type SpeechToolsStatus
} from '../../shared/workspace'
import type { Logger } from '../logger'
import type { SpeechModels } from '../transcription/models'
import type { SongWorkspaceService } from '../workspace'
import type { ImportService } from '../media/import-service'
import type { MediaRepository } from '../repositories/media'
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
  media: {
    repo: MediaRepository
    service: ImportService
    toolsStatus: () => Promise<MediaToolsStatus>
    recheckTools: () => Promise<MediaToolsStatus>
    /** Native dialogs and shell integration live in main/index.ts. */
    importWithDialog: (mode: 'files' | 'folder') => Promise<ImportDialogResult>
    relinkWithDialog: (id: string) => Promise<RelinkResult>
    relinkFolderWithDialog: () => Promise<RelinkFolderResult>
    showInFolder: (id: string) => void
  }
  workspace: SongWorkspaceService
  speech: {
    status: () => Promise<SpeechToolsStatus>
    recheck: () => Promise<SpeechToolsStatus>
    models: SpeechModels
  }
}

// Input/output types are enforced per entry by defineHandler; the table itself is heterogeneous.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HandlerTable = Record<IpcChannel, HandlerDefinition<any, any>>

export function buildHandlers(deps: HandlerDeps): HandlerTable {
  const { media } = deps
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
    [IpcChannels.projectsSetAudio]: defineHandler({
      schema: SetProjectAudioInputSchema,
      handle: ({ id, audioAssetId }) => {
        const previous = deps.projects.get(id)
        const next = deps.projects.setAudio(id, audioAssetId)
        deps.workspace.audioChanged(previous, next)
        return next
      }
    }),
    [IpcChannels.projectsDelete]: defineHandler({
      schema: ProjectIdInputSchema,
      handle: ({ id }) => {
        deps.projects.delete(id)
        deps.logger.info('Project deleted', { id })
        return null
      }
    }),

    [IpcChannels.mediaToolsStatus]: defineHandler({
      schema: EmptyInputSchema,
      handle: () => media.toolsStatus()
    }),
    [IpcChannels.mediaToolsRecheck]: defineHandler({
      schema: EmptyInputSchema,
      handle: async () => {
        const status = await media.recheckTools()
        if (status.ok) media.service.resume()
        return status
      }
    }),
    [IpcChannels.mediaList]: defineHandler({
      schema: EmptyInputSchema,
      handle: () => media.repo.list()
    }),
    [IpcChannels.mediaQueueState]: defineHandler({
      schema: EmptyInputSchema,
      handle: () => media.service.queueState()
    }),
    [IpcChannels.mediaImportDialog]: defineHandler({
      schema: ImportDialogInputSchema,
      handle: ({ mode }) => media.importWithDialog(mode)
    }),
    [IpcChannels.mediaImportPaths]: defineHandler({
      schema: ImportPathsInputSchema,
      handle: ({ paths }) => media.service.importPaths(paths)
    }),
    [IpcChannels.mediaCancel]: defineHandler({
      schema: AssetIdInputSchema,
      handle: async ({ id }) => {
        await media.service.cancel(id)
        return null
      }
    }),
    [IpcChannels.mediaCancelAll]: defineHandler({
      schema: EmptyInputSchema,
      handle: async () => {
        await media.service.cancelAll()
        return null
      }
    }),
    [IpcChannels.mediaRetry]: defineHandler({
      schema: AssetIdInputSchema,
      handle: ({ id }) => media.service.retry(id)
    }),
    [IpcChannels.mediaRemove]: defineHandler({
      schema: AssetIdInputSchema,
      handle: async ({ id }) => {
        await media.service.remove(id)
        return null
      }
    }),
    [IpcChannels.mediaRelink]: defineHandler({
      schema: AssetIdInputSchema,
      handle: ({ id }) => media.relinkWithDialog(id)
    }),
    [IpcChannels.mediaRelinkConfirm]: defineHandler({
      schema: AssetIdInputSchema,
      handle: ({ id }) => media.service.confirmRelink(id)
    }),
    [IpcChannels.mediaRelinkFolder]: defineHandler({
      schema: EmptyInputSchema,
      handle: () => media.relinkFolderWithDialog()
    }),
    [IpcChannels.mediaCheckAvailability]: defineHandler({
      schema: EmptyInputSchema,
      handle: () => media.service.checkAvailability()
    }),
    [IpcChannels.mediaShowInFolder]: defineHandler({
      schema: AssetIdInputSchema,
      handle: ({ id }) => {
        media.showInFolder(id)
        return null
      }
    }),

    [IpcChannels.workspaceGet]: defineHandler({
      schema: SongIdInputSchema,
      handle: ({ songId }) => deps.workspace.get(songId)
    }),
    [IpcChannels.workspaceWaveform]: defineHandler({
      schema: AssetIdOnlySchema,
      handle: ({ assetId }) => deps.workspace.waveform(assetId)
    }),
    [IpcChannels.analysisReanalyze]: defineHandler({
      schema: SongIdInputSchema,
      handle: ({ songId }) => deps.workspace.reanalyze(songId)
    }),
    [IpcChannels.beatsSetCorrections]: defineHandler({
      schema: SetCorrectionsInputSchema,
      handle: ({ songId, corrections }) => deps.workspace.setCorrections(songId, corrections)
    }),
    [IpcChannels.lyricsSave]: defineHandler({
      schema: SaveLyricsInputSchema,
      handle: (input) => deps.workspace.saveLyrics(input)
    }),
    [IpcChannels.lyricsTranscribe]: defineHandler({
      schema: TranscribeInputSchema,
      handle: (input) => deps.workspace.transcribe(input)
    }),
    [IpcChannels.lyricsCancelTranscription]: defineHandler({
      schema: SongIdInputSchema,
      handle: ({ songId }) => deps.workspace.cancelTranscription(songId)
    }),
    [IpcChannels.speechStatus]: defineHandler({
      schema: EmptyInputSchema,
      handle: () => deps.speech.status()
    }),
    [IpcChannels.speechRecheck]: defineHandler({
      schema: EmptyInputSchema,
      handle: () => deps.speech.recheck()
    }),
    [IpcChannels.modelsList]: defineHandler({
      schema: EmptyInputSchema,
      handle: () => deps.speech.models.list()
    }),
    [IpcChannels.modelsDownload]: defineHandler({
      schema: ModelIdInputSchema,
      handle: ({ id }) => {
        deps.speech.models.download(id)
        return null
      }
    }),
    [IpcChannels.modelsCancel]: defineHandler({
      schema: ModelIdInputSchema,
      handle: ({ id }) => {
        deps.speech.models.cancel(id)
        return null
      }
    }),
    [IpcChannels.modelsDelete]: defineHandler({
      schema: ModelIdInputSchema,
      handle: async ({ id }) => {
        await deps.speech.models.remove(id)
        return null
      }
    }),
    [IpcChannels.hooksCreate]: defineHandler({
      schema: CreateHookInputSchema,
      handle: (input) => deps.workspace.createHook(input)
    }),
    [IpcChannels.hooksUpdate]: defineHandler({
      schema: UpdateHookInputSchema,
      handle: (input) => deps.workspace.updateHook(input)
    }),
    [IpcChannels.hooksDelete]: defineHandler({
      schema: HookIdInputSchema,
      handle: ({ id }) => {
        deps.workspace.deleteHook(id)
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
