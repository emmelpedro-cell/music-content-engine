import { beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ALL_IPC_CHANNELS, IpcChannels } from '../../src/shared/channels'
import type { IpcResult, Project } from '../../src/shared/schemas'
import { runMigrations } from '../../src/main/db/migrations'
import { wrapHandler } from '../../src/main/ipc/handler'
import { buildHandlers, type HandlerTable } from '../../src/main/ipc/handlers'
import { ProjectsRepository } from '../../src/main/repositories/projects'
import { MediaRepository } from '../../src/main/repositories/media'
import { ImportService } from '../../src/main/media/import-service'
import { UnavailableError } from '../../src/main/errors'
import { AnalysisService } from '../../src/main/analysis/service'
import { AnalysisRepository } from '../../src/main/repositories/analysis'
import { WorkspaceRepository } from '../../src/main/repositories/workspace'
import { SpeechModels } from '../../src/main/transcription/models'
import { TranscriptionService } from '../../src/main/transcription/service'
import { SongWorkspaceService } from '../../src/main/workspace'
import { SettingsRepository } from '../../src/main/repositories/settings'
import { createSenderValidator } from '../../src/main/security'
import { createNodeSqliteDriver, memoryLogger } from '../helpers/node-sqlite-driver'

function setup() {
  const db = createNodeSqliteDriver()
  runMigrations(db)
  const logger = memoryLogger()
  const mediaRepo = new MediaRepository(db)
  const projects = new ProjectsRepository(db)
  const workspaceRepo = new WorkspaceRepository(db, logger)
  const models = new SpeechModels({ directory: '/nonexistent/models', logger, emit: () => {} })
  const table = buildHandlers({
    projects,
    settings: new SettingsRepository(db, logger),
    logger,
    rendererLogger: logger,
    getAppInfo: () => {
      throw new Error('internal detail that must not leak')
    },
    openLogsFolder: async () => {},
    chooseDataDirectory: async () => ({ changed: false }),
    chooseExportDirectory: async () => ({ changed: false }),
    media: {
      repo: mediaRepo,
      service: new ImportService({
        repo: mediaRepo,
        getTools: async () => {
          throw new UnavailableError('FFmpeg is missing from this installation. Reinstall Music Content Engine.')
        },
        thumbnailsDirectory: '/nonexistent/thumbs',
        tempDirectory: '/nonexistent/temp',
        logger,
        emit: () => {}
      }),
      toolsStatus: async () => ({ ok: false, source: 'packaged', directory: '/x', code: 'MISSING', message: 'missing', detail: '' }),
      recheckTools: async () => ({ ok: false, source: 'packaged', directory: '/x', code: 'MISSING', message: 'missing', detail: '' }),
      importWithDialog: async () => ({ cancelled: true }),
      relinkWithDialog: async () => ({ status: 'cancelled' }),
      relinkFolderWithDialog: async () => ({ cancelled: true }),
      showInFolder: () => {}
    },
    workspace: new SongWorkspaceService({
      projects,
      media: mediaRepo,
      repo: workspaceRepo,
      analysis: new AnalysisService({
        repo: new AnalysisRepository(db),
        media: mediaRepo,
        getTools: async () => {
          throw new UnavailableError('FFmpeg is missing.')
        },
        runner: async () => {
          throw new Error('not used')
        },
        waveformsDirectory: '/nonexistent/waveforms',
        logger,
        emit: () => {}
      }),
      transcription: new TranscriptionService({
        workspace: workspaceRepo,
        projects,
        media: mediaRepo,
        models,
        getFfmpeg: async () => {
          throw new UnavailableError('FFmpeg is missing.')
        },
        getWhisper: async () => {
          throw new UnavailableError('The transcriber is missing from this installation.')
        },
        tempDirectory: '/nonexistent/temp',
        logger,
        emit: () => {}
      }),
      logger
    }),
    speech: {
      status: async () => ({ ok: false, code: 'MISSING', message: 'missing', detail: '' }),
      recheck: async () => ({ ok: false, code: 'MISSING', message: 'missing', detail: '' }),
      models
    }
  })
  const call = <T>(channel: keyof HandlerTable, input?: unknown) =>
    wrapHandler(channel, table[channel], logger)(input) as Promise<IpcResult<T>>
  return { call, logger, table }
}

describe('IPC handlers', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  it('has a handler for every declared channel', () => {
    expect(Object.keys(ctx.table).sort()).toEqual([...ALL_IPC_CHANNELS].sort())
  })

  it('creates, lists, updates and deletes projects', async () => {
    const created = await ctx.call<Project>(IpcChannels.projectsCreate, { title: 'Rumelaj', artist: 'Luneta' })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const id = created.data.id

    const list = await ctx.call<Project[]>(IpcChannels.projectsList)
    expect(list.ok && list.data.map((p) => p.id)).toEqual([id])

    const updated = await ctx.call<Project>(IpcChannels.projectsUpdate, { id, title: 'Rumelaj (Trance)' })
    expect(updated.ok && updated.data.title).toBe('Rumelaj (Trance)')

    expect(await ctx.call(IpcChannels.projectsDelete, { id })).toEqual({ ok: true, data: null })
    const missing = await ctx.call(IpcChannels.projectsGet, { id })
    expect(missing.ok).toBe(false)
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND')
  })

  it('rejects invalid input before running the handler', async () => {
    const cases: [keyof HandlerTable, unknown][] = [
      [IpcChannels.projectsCreate, { title: '   ' }],
      [IpcChannels.projectsCreate, { title: 'ok', extra: 'not allowed' }],
      [IpcChannels.projectsCreate, 'just a string'],
      [IpcChannels.projectsGet, { id: 'not-a-uuid' }],
      [IpcChannels.projectsUpdate, { id: '00000000-0000-4000-8000-000000000000' }],
      [IpcChannels.projectsList, { unexpected: true }],
      [IpcChannels.settingsUpdate, { accentColor: 'red' }],
      [IpcChannels.settingsUpdate, { exportDirectory: 'C:\\Windows' }],
      [IpcChannels.logWrite, { level: 'fatal', message: 'x' }],
      [IpcChannels.mediaImportPaths, { paths: [] }],
      [IpcChannels.mediaImportPaths, { paths: 'C:\\Windows' }],
      [IpcChannels.mediaImportPaths, { paths: Array.from({ length: 2001 }, () => '/x.mp4') }],
      [IpcChannels.mediaImportDialog, { mode: 'everything' }],
      [IpcChannels.mediaCancel, { id: '../../etc' }],
      [IpcChannels.mediaRemove, {}],
      [IpcChannels.mediaShowInFolder, { id: 1 }],
      [IpcChannels.mediaRelink, { id: 'x', path: '/etc/passwd' }],
      [IpcChannels.projectsSetAudio, { id: '00000000-0000-4000-8000-000000000000', audioAssetId: 'nope' }],
      [IpcChannels.workspaceGet, { songId: 'x' }],
      [IpcChannels.beatsSetCorrections, { songId: '00000000-0000-4000-8000-000000000000', corrections: { mode: 'grid' } }],
      [IpcChannels.lyricsSave, { songId: '00000000-0000-4000-8000-000000000000', document: { version: 2, lines: [] }, offsetSeconds: 0, language: null, source: null, confirm: false }],
      [IpcChannels.lyricsTranscribe, { songId: '00000000-0000-4000-8000-000000000000', model: '../../evil', language: null }],
      [IpcChannels.lyricsTranscribe, { songId: '00000000-0000-4000-8000-000000000000', model: 'base', language: 'portuguese' }],
      [IpcChannels.modelsDownload, { id: 'https://evil.example/x.bin' }],
      [IpcChannels.hooksCreate, { songId: '00000000-0000-4000-8000-000000000000', name: 'x', start: 5, end: 5.1 }],
      [IpcChannels.hooksDelete, { id: 'nope' }]
    ]
    for (const [channel, input] of cases) {
      const result = await ctx.call(channel, input)
      expect(result.ok, `${channel} should reject ${JSON.stringify(input)}`).toBe(false)
      expect(!result.ok && result.error.code).toBe('VALIDATION')
    }
    const listed = await ctx.call<Project[]>(IpcChannels.projectsList)
    expect(listed.ok && listed.data).toEqual([])
  })

  it('hides internal error details from the renderer but logs them', async () => {
    const result = await ctx.call(IpcChannels.appGetInfo)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('INTERNAL')
    expect(result.error.message).not.toContain('internal detail')
    const logged = ctx.logger.entries.find((e) => e.level === 'error')
    expect((logged?.context?.error as Error).message).toBe('internal detail that must not leak')
  })

  it('reports unavailable FFmpeg with its actionable message', async () => {
    const result = await ctx.call(IpcChannels.mediaImportPaths, { paths: ['/music/take.mp4'] })
    expect(result).toEqual({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'FFmpeg is missing from this installation. Reinstall Music Content Engine.' }
    })
  })

  it('runs the song workspace end to end through IPC', async () => {
    const created = await ctx.call<{ id: string }>(IpcChannels.projectsCreate, { title: 'Rumelaj' })
    if (!created.ok) throw new Error('create failed')
    const songId = created.data.id
    const ws = await ctx.call<{ audio: unknown; lyrics: { status: string }; hooks: unknown[]; beatMap: unknown }>(IpcChannels.workspaceGet, { songId })
    expect(ws.ok && ws.data).toMatchObject({ audio: null, beatMap: null, hooks: [], lyrics: { status: 'empty' } })

    const hook = await ctx.call<{ id: string }>(IpcChannels.hooksCreate, { songId, name: 'Chorus', start: 12, end: 27, tags: ['erhu'] })
    expect(hook.ok).toBe(true)
    const saved = await ctx.call<{ status: string }>(IpcChannels.lyricsSave, {
      songId,
      document: { version: 1, lines: [{ id: 'l1', kind: 'lyric', words: [{ id: 'w1', text: 'Rumelaj', start: 1, end: 1.5 }] }] },
      offsetSeconds: 0,
      language: 'pt',
      source: 'manual',
      confirm: true
    })
    expect(saved.ok && saved.data.status).toBe('confirmed')
    const transcribe = await ctx.call(IpcChannels.lyricsTranscribe, { songId, model: 'base', language: null })
    expect(!transcribe.ok && transcribe.error.code).toBe('UNPROCESSABLE')
    const models = await ctx.call<{ id: string }[]>(IpcChannels.modelsList)
    expect(models.ok && models.data.length).toBe(5)
  })

  it('lists an empty media library and idle queue', async () => {
    expect(await ctx.call(IpcChannels.mediaList)).toEqual({ ok: true, data: [] })
    expect(await ctx.call(IpcChannels.mediaQueueState)).toEqual({
      ok: true,
      data: { active: false, total: 0, completed: 0, failed: 0, current: [] }
    })
    const missing = await ctx.call(IpcChannels.mediaRemove, { id: '00000000-0000-4000-8000-000000000000' })
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND')
  })

  it('updates settings through the allowed keys only', async () => {
    const result = await ctx.call(IpcChannels.settingsUpdate, { accentColor: '#4c9be8' })
    expect(result.ok && (result.data as { accentColor: string }).accentColor).toBe('#4c9be8')
  })

  it('forwards renderer log messages', async () => {
    await ctx.call(IpcChannels.logWrite, { level: 'warn', message: 'from renderer', context: { x: 1 } })
    expect(ctx.logger.entries).toContainEqual({ level: 'warn', message: 'from renderer', context: { x: 1 } })
  })
})

describe('sender validation', () => {
  const indexPath = join(process.cwd(), 'out', 'renderer', 'index.html')

  it('accepts the bundled renderer page', () => {
    const isTrusted = createSenderValidator({ rendererIndexPath: indexPath })
    const url = pathToFileURL(indexPath).href
    expect(isTrusted(url)).toBe(true)
    expect(isTrusted(url + '#/songs')).toBe(true)
  })

  it('rejects other pages', () => {
    const isTrusted = createSenderValidator({ rendererIndexPath: indexPath })
    expect(isTrusted('https://example.com/')).toBe(false)
    expect(isTrusted('file:///C:/somewhere/else.html')).toBe(false)
    expect(isTrusted('')).toBe(false)
    expect(isTrusted(undefined)).toBe(false)
    expect(isTrusted('not a url')).toBe(false)
  })

  it('accepts the dev server only when configured', () => {
    const dev = createSenderValidator({ devServerUrl: 'http://localhost:5173', rendererIndexPath: indexPath })
    expect(dev('http://localhost:5173/')).toBe(true)
    expect(dev('http://localhost:5174/')).toBe(false)
    const prod = createSenderValidator({ rendererIndexPath: indexPath })
    expect(prod('http://localhost:5173/')).toBe(false)
  })
})
