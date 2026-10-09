import { beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ALL_IPC_CHANNELS, IpcChannels } from '../../src/shared/channels'
import type { IpcResult, Project } from '../../src/shared/schemas'
import { runMigrations } from '../../src/main/db/migrations'
import { wrapHandler } from '../../src/main/ipc/handler'
import { buildHandlers, type HandlerTable } from '../../src/main/ipc/handlers'
import { ProjectsRepository } from '../../src/main/repositories/projects'
import { SettingsRepository } from '../../src/main/repositories/settings'
import { createSenderValidator } from '../../src/main/security'
import { createNodeSqliteDriver, memoryLogger } from '../helpers/node-sqlite-driver'

function setup() {
  const db = createNodeSqliteDriver()
  runMigrations(db)
  const logger = memoryLogger()
  const table = buildHandlers({
    projects: new ProjectsRepository(db),
    settings: new SettingsRepository(db, logger),
    logger,
    rendererLogger: logger,
    getAppInfo: () => {
      throw new Error('internal detail that must not leak')
    },
    openLogsFolder: async () => {},
    chooseDataDirectory: async () => ({ changed: false }),
    chooseExportDirectory: async () => ({ changed: false })
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
      [IpcChannels.logWrite, { level: 'fatal', message: 'x' }]
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
