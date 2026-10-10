import { beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { runMigrations } from '../../src/main/db/migrations'
import type { SqlDriver } from '../../src/main/db/driver'
import { openDatabase } from '../../src/main/db/open'
import { NotFoundError, ProjectsRepository } from '../../src/main/repositories/projects'
import { MediaRepository } from '../../src/main/repositories/media'
import { CreateProjectInputSchema, UpdateProjectInputSchema } from '../../src/shared/schemas'
import { createNodeSqliteDriver, memoryLogger, tempDir } from '../helpers/node-sqlite-driver'

function clock(start = Date.parse('2026-10-10T10:00:00.000Z')) {
  let t = start
  return () => new Date((t += 1000)).toISOString()
}

describe('ProjectsRepository', () => {
  let repo: ProjectsRepository
  let db: SqlDriver

  beforeEach(() => {
    db = createNodeSqliteDriver()
    runMigrations(db)
    repo = new ProjectsRepository(db, clock())
  })

  it('creates and reads a project', () => {
    const created = repo.create(CreateProjectInputSchema.parse({ title: '  Rumelaj  ', artist: 'Luneta' }))
    expect(created.title).toBe('Rumelaj')
    expect(created.artist).toBe('Luneta')
    expect(created.audioAssetId).toBeNull()
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(repo.get(created.id)).toEqual(created)
  })

  it('stores an empty artist as null', () => {
    const created = repo.create(CreateProjectInputSchema.parse({ title: 'Untitled', artist: '   ' }))
    expect(created.artist).toBeNull()
  })

  it('lists projects most recently updated first', () => {
    const a = repo.create(CreateProjectInputSchema.parse({ title: 'A' }))
    const b = repo.create(CreateProjectInputSchema.parse({ title: 'B' }))
    expect(repo.list().map((p) => p.title)).toEqual(['B', 'A'])
    repo.update(UpdateProjectInputSchema.parse({ id: a.id, title: 'A2' }))
    expect(repo.list().map((p) => p.id)).toEqual([a.id, b.id])
  })

  it('updates only the provided fields and bumps updatedAt', () => {
    const p = repo.create(CreateProjectInputSchema.parse({ title: 'Song', artist: 'Someone' }))
    const renamed = repo.update(UpdateProjectInputSchema.parse({ id: p.id, title: 'Song (Trance)' }))
    expect(renamed.title).toBe('Song (Trance)')
    expect(renamed.artist).toBe('Someone')
    expect(renamed.createdAt).toBe(p.createdAt)
    expect(renamed.updatedAt > p.updatedAt).toBe(true)

    const cleared = repo.update(UpdateProjectInputSchema.parse({ id: p.id, artist: '' }))
    expect(cleared.artist).toBeNull()
    expect(cleared.title).toBe('Song (Trance)')
  })

  it('deletes a project', () => {
    const p = repo.create(CreateProjectInputSchema.parse({ title: 'Temp' }))
    repo.delete(p.id)
    expect(repo.list()).toEqual([])
    expect(() => repo.get(p.id)).toThrow(NotFoundError)
  })

  it('links a ready audio asset as the song audio, and rejects anything else', () => {
    const media = new MediaRepository(db)
    const p = repo.create(CreateProjectInputSchema.parse({ title: 'Song' }))
    const audio = media.insertPending({ path: '/m/a.wav', pathKey: '/m/a.wav', size: 1, mtimeMs: 0 })!
    const video = media.insertPending({ path: '/m/v.mp4', pathKey: '/m/v.mp4', size: 1, mtimeMs: 0 })!

    expect(() => repo.setAudio(p.id, audio.id)).toThrow(/finished importing/)
    const meta = (kind: 'audio' | 'video') => ({
      kind,
      durationSeconds: 3,
      container: 'wav',
      bitRate: null,
      primaryStreamIndex: 0,
      video: kind === 'video' ? { codec: 'h264', width: 2, height: 2, rotation: 0, frameRate: 30 } : null,
      audio: { codec: 'pcm_s16le', sampleRate: 48000, channels: 2 }
    })
    media.markReady(audio.id, meta('audio'), '{}', null)
    media.markReady(video.id, meta('video'), '{}', null)

    expect(repo.setAudio(p.id, audio.id).audioAssetId).toBe(audio.id)
    expect(() => repo.setAudio(p.id, video.id)).toThrow(/audio file/)
    expect(() => repo.setAudio(p.id, '00000000-0000-4000-8000-000000000000')).toThrow(NotFoundError)
    expect(repo.setAudio(p.id, null).audioAssetId).toBeNull()
  })

  it('reports missing projects as NotFoundError', () => {
    const id = '00000000-0000-4000-8000-000000000000'
    expect(() => repo.get(id)).toThrow(NotFoundError)
    expect(() => repo.delete(id)).toThrow(NotFoundError)
    expect(() => repo.update(UpdateProjectInputSchema.parse({ id, title: 'x' }))).toThrow(NotFoundError)
  })
})

describe('project persistence across restarts', () => {
  it('saves a project, closes the database and reloads it (Phase 0 acceptance)', () => {
    const dir = tempDir()
    const options = {
      databasePath: join(dir.path, 'app-data', 'database.sqlite'),
      backupsDirectory: join(dir.path, 'app-data', 'backups'),
      createDriver: createNodeSqliteDriver,
      logger: memoryLogger()
    }
    try {
      // openDatabase expects the folder to exist, as ensureLayout guarantees in the app.
      mkdirSync(join(dir.path, 'app-data'), { recursive: true })

      const first = openDatabase(options)
      const created = new ProjectsRepository(first.db).create(
        CreateProjectInputSchema.parse({ title: 'Rumelaj', artist: 'Luneta' })
      )
      first.db.close()

      const second = openDatabase(options)
      const reloaded = new ProjectsRepository(second.db).list()
      second.db.close()

      expect(reloaded).toEqual([created])
    } finally {
      dir.cleanup()
    }
  })
})
