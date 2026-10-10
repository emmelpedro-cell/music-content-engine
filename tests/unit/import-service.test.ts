import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MediaAsset, MediaEvent } from '../../src/shared/media'
import { openDatabase } from '../../src/main/db/open'
import type { SqlDriver } from '../../src/main/db/driver'
import { UnavailableError } from '../../src/main/errors'
import { ImportService } from '../../src/main/media/import-service'
import { MediaRepository } from '../../src/main/repositories/media'
import { ProjectsRepository } from '../../src/main/repositories/projects'
import { CreateProjectInputSchema } from '../../src/shared/schemas'
import { createNodeSqliteDriver, memoryLogger, tempDir } from '../helpers/node-sqlite-driver'
import { createFixtures, testTools, type Fixtures } from '../helpers/media'

const tools = testTools()

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 2))
  }
}

describe.skipIf(!tools)('ImportService with real FFmpeg and SQLite', () => {
  const root = tempDir('mce-import-')
  let fx: Fixtures
  let work: string
  let db: SqlDriver
  let repo: MediaRepository
  let events: MediaEvent[]
  let service: ImportService
  let available: boolean
  const appData = join(root.path, 'app-data')
  const thumbs = join(appData, 'thumbnails')
  const temp = join(appData, 'temp')
  const dbOptions = () => ({
    databasePath: join(appData, 'database.sqlite'),
    backupsDirectory: join(appData, 'backups'),
    createDriver: createNodeSqliteDriver,
    logger: memoryLogger()
  })

  const makeService = () =>
    new ImportService({
      repo,
      getTools: async () => {
        if (!available) throw new UnavailableError('FFmpeg is missing (test).')
        return { ffmpeg: tools!.ffmpeg, ffprobe: tools!.ffprobe }
      },
      thumbnailsDirectory: thumbs,
      tempDirectory: temp,
      logger: memoryLogger(),
      emit: (e) => events.push(e)
    })

  beforeAll(() => {
    fx = createFixtures(tools!, join(root.path, 'fixtures'))
  })
  afterAll(() => root.cleanup())

  beforeEach(() => {
    rmSync(appData, { recursive: true, force: true })
    mkdirSync(thumbs, { recursive: true })
    mkdirSync(temp, { recursive: true })
    work = join(root.path, `work-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(work)
    db = openDatabase(dbOptions()).db
    repo = new MediaRepository(db)
    events = []
    available = true
    service = makeService()
  })
  afterEach(() => {
    service.shutdown()
    db.close()
  })

  /** Copies fixtures into a fresh folder so tests can move/delete them. */
  const stage = (...paths: string[]) =>
    paths.map((p) => {
      const target = join(work, p.split(/[\\/]/).pop()!)
      copyFileSync(p, target)
      return target
    })

  const byName = (name: string): MediaAsset => {
    const asset = repo.list().find((a) => a.fileName === name)
    if (!asset) throw new Error(`${name} not in library: ${repo.list().map((a) => a.fileName).join(', ')}`)
    return asset
  }

  it('imports real audio and video, extracts metadata and makes a video thumbnail', async () => {
    const [mp3, mp4] = stage(fx.mp3, fx.mp4)
    const summary = await service.importPaths([mp3!, mp4!])
    expect(summary).toMatchObject({ queued: 2, alreadyInLibrary: 0, errors: [] })
    await service.waitForIdle()

    const audio = byName('tone.mp3')
    expect(audio).toMatchObject({ kind: 'audio', status: 'ready', availability: 'online', audioCodec: 'mp3', sampleRate: 44100, channels: 2, hasThumbnail: false })
    expect(audio.durationSeconds).toBeGreaterThan(2.9)

    const video = byName('clip.mp4')
    expect(video).toMatchObject({ kind: 'video', status: 'ready', width: 320, height: 240, frameRate: 30, videoCodec: 'h264', audioCodec: 'aac', hasThumbnail: true })
    expect(existsSync(join(thumbs, `${video.id}.jpg`))).toBe(true)

    // Progress was reported, ending idle.
    const queueEvents = events.filter((e) => e.type === 'queue')
    expect(queueEvents.some((e) => e.type === 'queue' && e.state.active)).toBe(true)
    expect(service.queueState().active).toBe(false)
  })

  it('keeps everything after closing and reopening the database', async () => {
    const [wav, mov] = stage(fx.wav, fx.mov)
    await service.importPaths([wav!, mov!])
    await service.waitForIdle()
    const before = repo.list()
    service.shutdown()
    db.close()

    db = openDatabase(dbOptions()).db
    repo = new MediaRepository(db)
    service = makeService()
    service.start()
    await service.waitForIdle()
    expect(repo.list()).toEqual(before)
    expect(repo.list().every((a) => a.status === 'ready')).toBe(true)
  })

  it('imports a folder recursively, skipping non-media files', async () => {
    const nested = join(work, 'takes', 'day 1')
    mkdirSync(nested, { recursive: true })
    copyFileSync(fx.flac, join(work, 'tone.flac'))
    copyFileSync(fx.mov, join(nested, 'clip.mov'))
    copyFileSync(fx.notes, join(nested, 'notes.txt'))
    mkdirSync(join(work, '.hidden'))
    copyFileSync(fx.m4a, join(work, '.hidden', 'secret.m4a'))

    const summary = await service.importPaths([work])
    expect(summary).toMatchObject({ queued: 2, skippedNonMedia: 1, truncated: false })
    await service.waitForIdle()
    expect(repo.list().map((a) => a.fileName).sort()).toEqual(['clip.mov', 'tone.flac'])
  })

  it('records clear errors for invalid media and keeps going', async () => {
    const files = stage(fx.corrupt, fx.textAsMp3, fx.truncated, fx.still, fx.m4a)
    const summary = await service.importPaths(files)
    expect(summary.queued).toBe(5)
    await service.waitForIdle()

    for (const name of ['corrupt.mp4', 'not-really.mp3', 'truncated.mp4']) {
      const a = byName(name)
      expect(a.status, name).toBe('error')
      expect(a.errorMessage, name).toContain(name)
      expect(a.kind, name).toBeNull()
    }
    expect(byName('still.png').errorMessage).toContain('still image')
    expect(byName('tone.m4a').status).toBe('ready')
  })

  it('does not import the same file twice, by path or by content', async () => {
    const [wav] = stage(fx.wav)
    await service.importPaths([wav!])
    await service.waitForIdle()

    const again = await service.importPaths([wav!])
    expect(again).toMatchObject({ queued: 0, alreadyInLibrary: 1 })

    const copy = join(work, 'tone copy.wav')
    copyFileSync(wav!, copy)
    await service.importPaths([copy])
    await service.waitForIdle()
    expect(repo.list()).toHaveLength(1)
    expect(events).toContainEqual({ type: 'duplicate', fileName: 'tone copy.wav', existingFileName: 'tone.wav' })
  })

  it('detects duplicates imported in the same batch', async () => {
    const [mp3] = stage(fx.mp3)
    const copy = join(work, 'tone (1).mp3')
    copyFileSync(mp3!, copy)
    await service.importPaths([mp3!, copy])
    await service.waitForIdle()
    expect(repo.list()).toHaveLength(1)
  })

  it('marks moved files as missing and relinks them by file or by folder', async () => {
    const [mp4, flac] = stage(fx.mp4, fx.flac)
    await service.importPaths([mp4!, flac!])
    await service.waitForIdle()

    const moved = join(work, 'moved')
    mkdirSync(moved)
    renameSync(mp4!, join(moved, 'clip.mp4'))
    renameSync(flac!, join(moved, 'tone.flac'))
    expect(await service.checkAvailability()).toEqual({ missing: 2 })
    expect(byName('clip.mp4').availability).toBe('missing')
    // Metadata and thumbnail survive while the file is missing.
    expect(byName('clip.mp4')).toMatchObject({ status: 'ready', width: 320, hasThumbnail: true })

    const single = await service.relink(byName('clip.mp4').id, join(moved, 'clip.mp4'))
    expect(single).toMatchObject({ status: 'relinked', reprocessing: false })
    expect(byName('clip.mp4')).toMatchObject({ availability: 'online', sourcePath: join(moved, 'clip.mp4') })

    const folder = await service.relinkFromFolder(work)
    expect(folder).toMatchObject({ relinked: 1, stillMissing: 0 })
    expect(byName('tone.flac').availability).toBe('online')
    expect(await service.checkAvailability()).toEqual({ missing: 0 })
  })

  it('asks for confirmation before relinking to a file with different content', async () => {
    const [wav, mp3] = stage(fx.wav, fx.mp3)
    await service.importPaths([wav!])
    await service.waitForIdle()
    rmSync(wav!)
    await service.checkAvailability()
    const id = byName('tone.wav').id

    const result = await service.relink(id, mp3!)
    expect(result).toEqual({ status: 'mismatch', fileName: 'tone.mp3' })
    expect(repo.get(id).availability).toBe('missing')

    const confirmed = await service.confirmRelink(id)
    expect(confirmed).toMatchObject({ status: 'relinked', reprocessing: true })
    await service.waitForIdle()
    expect(repo.get(id)).toMatchObject({ fileName: 'tone.mp3', audioCodec: 'mp3', status: 'ready', availability: 'online' })
  })

  it('refuses to relink to a file that is already in the library', async () => {
    const [wav, mp3] = stage(fx.wav, fx.mp3)
    await service.importPaths([wav!, mp3!])
    await service.waitForIdle()
    await expect(service.relink(byName('tone.wav').id, mp3!)).rejects.toThrow(/already in the library/)
  })

  it('removes an asset without touching the source file, and unlinks it from songs', async () => {
    const [mp4, mp3] = stage(fx.mp4, fx.mp3)
    await service.importPaths([mp4!, mp3!])
    await service.waitForIdle()
    const projects = new ProjectsRepository(db)
    const song = projects.create(CreateProjectInputSchema.parse({ title: 'Rumelaj' }))
    projects.setAudio(song.id, byName('tone.mp3').id)

    const video = byName('clip.mp4')
    await service.remove(video.id)
    await service.remove(byName('tone.mp3').id)
    expect(repo.list()).toEqual([])
    expect(existsSync(mp4!)).toBe(true)
    expect(existsSync(mp3!)).toBe(true)
    expect(existsSync(join(thumbs, `${video.id}.jpg`))).toBe(false)
    expect(projects.get(song.id).audioAssetId).toBeNull()
  })

  it('cancels queued and running imports', async () => {
    const files = stage(fx.wav, fx.mp3, fx.flac, fx.m4a, fx.mp4, fx.mov)
    await service.importPaths(files)
    // Wait until FFmpeg work is actually running, so both paths (queued and running) are exercised.
    await waitFor(() => service.queueState().current.length > 0)
    expect(service.queueState().current.length).toBeGreaterThan(0)
    await service.cancelAll()
    await service.waitForIdle()
    expect(repo.list()).toEqual([])
    expect(readdirSync(temp)).toEqual([])
    expect(files.every((f) => existsSync(f))).toBe(true)
  })

  it('resumes imports interrupted by a crash', async () => {
    const [m4a, mov] = stage(fx.m4a, fx.mov)
    // Simulate a crash mid-import: rows left in 'pending' / 'processing'.
    const a = repo.insertPending({ path: m4a!, pathKey: m4a!, size: 1, mtimeMs: 0 })!
    const b = repo.insertPending({ path: mov!, pathKey: mov!, size: 1, mtimeMs: 0 })!
    repo.markProcessing(b.id)

    service.start()
    await service.waitForIdle()
    expect(repo.get(a.id).status).toBe('ready')
    expect(repo.get(b.id)).toMatchObject({ status: 'ready', kind: 'video', hasThumbnail: true })
  })

  it('fails fast when FFmpeg is unavailable, then resumes pending work once it is back', async () => {
    available = false
    await expect(service.importPaths(stage(fx.wav))).rejects.toThrow(UnavailableError)
    expect(repo.list()).toEqual([])

    // Work left pending from an earlier session stays pending while FFmpeg is missing...
    const [flac] = stage(fx.flac)
    const pending = repo.insertPending({ path: flac!, pathKey: flac!, size: 1, mtimeMs: 0 })!
    service.start()
    await service.waitForIdle()
    expect(repo.get(pending.id).status).toBe('pending')

    // ...and is processed after FFmpeg is fixed.
    available = true
    service.resume()
    await service.waitForIdle()
    expect(repo.get(pending.id).status).toBe('ready')
  })

  it('reports a file deleted between selection and processing', async () => {
    const [wav] = stage(fx.wav)
    const asset = repo.insertPending({ path: wav!, pathKey: wav!, size: 1, mtimeMs: 0 })!
    rmSync(wav!)
    service.start()
    await service.waitForIdle()
    expect(repo.get(asset.id)).toMatchObject({ status: 'error', availability: 'missing' })
    expect(repo.get(asset.id).errorMessage).toContain('moved or deleted')
  })

  it('retries a failed import', async () => {
    const [m4a] = stage(fx.m4a)
    const broken = join(work, 'later.m4a')
    writeFileSync(broken, 'not yet')
    await service.importPaths([broken])
    await service.waitForIdle()
    expect(byName('later.m4a').status).toBe('error')

    copyFileSync(m4a!, broken)
    service.retry(byName('later.m4a').id)
    await service.waitForIdle()
    expect(byName('later.m4a').status).toBe('ready')
  })
})
