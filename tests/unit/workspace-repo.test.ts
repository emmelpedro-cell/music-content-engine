import { beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../src/main/db/migrations'
import type { SqlDriver } from '../../src/main/db/driver'
import { NotFoundError, UnprocessableError } from '../../src/main/errors'
import { ProjectsRepository } from '../../src/main/repositories/projects'
import { WorkspaceRepository } from '../../src/main/repositories/workspace'
import { DEFAULT_CORRECTIONS } from '../../src/shared/analysis'
import { CreateHookInputSchema } from '../../src/shared/hooks'
import { parseLyrics } from '../../src/shared/lyrics'
import { CreateProjectInputSchema } from '../../src/shared/schemas'
import { createNodeSqliteDriver, memoryLogger } from '../helpers/node-sqlite-driver'

describe('WorkspaceRepository', () => {
  let db: SqlDriver
  let repo: WorkspaceRepository
  let songId: string

  beforeEach(() => {
    db = createNodeSqliteDriver()
    runMigrations(db)
    repo = new WorkspaceRepository(db, memoryLogger())
    songId = new ProjectsRepository(db).create(CreateProjectInputSchema.parse({ title: 'Rumelaj' })).id
  })

  it('stores beat corrections and falls back to defaults when unreadable', () => {
    expect(repo.corrections(songId)).toEqual(DEFAULT_CORRECTIONS)
    const c = { ...DEFAULT_CORRECTIONS, tempoFactor: 0.5 as const, downbeatPhase: 2 }
    expect(repo.setCorrections(songId, c)).toEqual(c)
    db.prepare('UPDATE song_beat_corrections SET corrections_json = ? WHERE song_id = ?').run('{"mode":"weird"}', songId)
    expect(repo.corrections(songId)).toEqual(DEFAULT_CORRECTIONS)
  })

  it('saves lyrics as draft until explicitly confirmed', () => {
    expect(repo.lyrics(songId).status).toBe('empty')
    const document = parseLyrics('one two\nthree', 'txt')
    const base = { songId, document, offsetSeconds: 0.1, language: 'pt', source: 'manual' as const }
    expect(repo.saveLyrics({ ...base, confirm: false }).status).toBe('draft')
    const confirmed = repo.saveLyrics({ ...base, confirm: true })
    expect(confirmed).toMatchObject({ status: 'confirmed', offsetSeconds: 0.1, language: 'pt', source: 'manual' })
    expect(confirmed.document).toEqual(document)
    expect(repo.saveLyrics({ ...base, document: { version: 1, lines: [] }, confirm: false }).status).toBe('empty')
  })

  it('keeps the transcription as the original and never overwrites the user’s lyrics', () => {
    const transcript = parseLyrics('[00:01.00]hello there', 'lrc')
    const first = repo.storeTranscription(songId, transcript, 'en', 'base')
    expect(first).toMatchObject({ status: 'draft', source: 'transcription', language: 'en' })
    expect(first.document).toEqual(transcript)
    expect(first.transcription).toMatchObject({ status: 'ready', model: 'base' })

    const mine = parseLyrics('my own words', 'txt')
    repo.saveLyrics({ songId, document: mine, offsetSeconds: 0, language: 'en', source: 'manual', confirm: true })
    const again = repo.storeTranscription(songId, parseLyrics('[00:02.00]new attempt', 'lrc'), 'en', 'small')
    expect(again.document).toEqual(mine)
    expect(again.status).toBe('confirmed')
    expect(again.original!.lines[0]!.words[0]!.text).toBe('new')
  })

  it('resets corrections and un-confirms lyrics when the audio changes', () => {
    repo.setCorrections(songId, { ...DEFAULT_CORRECTIONS, shiftSeconds: 0.05 })
    repo.saveLyrics({ songId, document: parseLyrics('a b', 'txt'), offsetSeconds: 0, language: null, source: 'manual', confirm: true })
    repo.audioChanged(songId)
    expect(repo.corrections(songId)).toEqual(DEFAULT_CORRECTIONS)
    expect(repo.lyrics(songId).status).toBe('draft')
  })

  it('marks transcriptions interrupted by a shutdown as failed', () => {
    repo.setTranscriptionState(songId, 'processing', { model: 'base' })
    expect(repo.resetInterruptedTranscriptions()).toBe(1)
    expect(repo.lyrics(songId).transcription).toMatchObject({ status: 'error', model: 'base' })
  })

  it('creates, updates, lists and deletes hooks', () => {
    const chorus = repo.createHook(CreateHookInputSchema.parse({ songId, name: 'Chorus', start: 42, end: 57, tags: ['erhu'] }))
    const intro = repo.createHook(CreateHookInputSchema.parse({ songId, name: 'Intro riff', start: 0, end: 15 }))
    expect(repo.hooks(songId).map((h) => h.name)).toEqual(['Intro riff', 'Chorus'])
    expect(repo.updateHook({ id: chorus.id, end: 60, notes: 'use the drop' })).toMatchObject({ start: 42, end: 60, notes: 'use the drop', tags: ['erhu'] })
    expect(() => repo.updateHook({ id: intro.id, end: 0.1 })).toThrow(UnprocessableError)
    repo.deleteHook(intro.id)
    expect(repo.hooks(songId)).toHaveLength(1)
    expect(() => repo.deleteHook(intro.id)).toThrow(NotFoundError)
  })

  it('validates hook ranges at the boundary', () => {
    expect(CreateHookInputSchema.safeParse({ songId, name: 'x', start: 10, end: 10.1 }).success).toBe(false)
    expect(CreateHookInputSchema.safeParse({ songId, name: '  ', start: 0, end: 5 }).success).toBe(false)
  })

  it('deletes everything with the song', () => {
    repo.createHook(CreateHookInputSchema.parse({ songId, name: 'Chorus', start: 1, end: 5 }))
    repo.saveLyrics({ songId, document: parseLyrics('a', 'txt'), offsetSeconds: 0, language: null, source: 'manual', confirm: false })
    repo.setCorrections(songId, DEFAULT_CORRECTIONS)
    new ProjectsRepository(db).delete(songId)
    for (const table of ['hooks', 'lyric_documents', 'song_beat_corrections']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 })
    }
  })
})
