import { randomUUID } from 'node:crypto'
import type { SqlDriver } from '../db/driver'
import { transaction } from '../db/driver'
import { NotFoundError, UnprocessableError } from '../errors'
import { BeatCorrectionsSchema, DEFAULT_CORRECTIONS, type BeatCorrections } from '../../shared/analysis'
import type { CreateHookInput, Hook, UpdateHookInput } from '../../shared/hooks'
import {
  EMPTY_LYRICS,
  LyricDocumentSchema,
  documentStats,
  type LyricDocument,
  type LyricsState,
  type SaveLyricsInput,
  type TranscriptionStatus
} from '../../shared/lyrics'
import type { Logger } from '../logger'

type LyricRow = {
  song_id: string
  status: LyricsState['status']
  source: LyricsState['source']
  language: string | null
  document_json: string
  original_json: string | null
  offset_seconds: number
  transcription_status: TranscriptionStatus
  transcription_error: string | null
  transcription_model: string | null
  updated_at: string
}

type HookRow = {
  id: string
  song_id: string
  name: string
  start_seconds: number
  end_seconds: number
  notes: string | null
  tags_json: string
  created_at: string
  updated_at: string
}

/**
 * Song-level user data for Phase 2: beat corrections, lyrics and hooks.
 * Everything here is the user's work and survives re-analysis.
 */
export class WorkspaceRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly logger: Logger,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = randomUUID
  ) {}

  private requireSong(songId: string): void {
    if (!this.db.prepare('SELECT 1 FROM songs WHERE id = ?').get(songId)) {
      throw new NotFoundError('That song no longer exists.')
    }
  }

  /* -------------------------------------------------------------- */
  /* Beat corrections                                               */
  /* -------------------------------------------------------------- */

  corrections(songId: string): BeatCorrections {
    const row = this.db.prepare('SELECT corrections_json FROM song_beat_corrections WHERE song_id = ?').get(songId) as
      | { corrections_json: string }
      | undefined
    if (!row) return { ...DEFAULT_CORRECTIONS }
    try {
      const parsed = BeatCorrectionsSchema.safeParse(JSON.parse(row.corrections_json))
      if (parsed.success) return parsed.data
    } catch {
      // fall through
    }
    this.logger.warn('Ignoring unreadable beat corrections', { songId })
    return { ...DEFAULT_CORRECTIONS }
  }

  setCorrections(songId: string, corrections: BeatCorrections): BeatCorrections {
    this.requireSong(songId)
    this.db
      .prepare(
        `INSERT INTO song_beat_corrections (song_id, corrections_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(song_id) DO UPDATE SET corrections_json = excluded.corrections_json, updated_at = excluded.updated_at`
      )
      .run(songId, JSON.stringify(corrections), this.now())
    return this.corrections(songId)
  }

  resetCorrections(songId: string): void {
    this.db.prepare('DELETE FROM song_beat_corrections WHERE song_id = ?').run(songId)
  }

  /* -------------------------------------------------------------- */
  /* Lyrics                                                         */
  /* -------------------------------------------------------------- */

  lyrics(songId: string): LyricsState {
    const row = this.db
      .prepare(
        `SELECT song_id, status, source, language, document_json, original_json, offset_seconds, transcription_status,
           transcription_error, transcription_model, updated_at FROM lyric_documents WHERE song_id = ?`
      )
      .get(songId) as LyricRow | undefined
    if (!row) {
      return {
        songId,
        status: 'empty',
        source: null,
        language: null,
        document: EMPTY_LYRICS,
        original: null,
        offsetSeconds: 0,
        transcription: { status: 'none', progress: null, error: null, model: null },
        updatedAt: null
      }
    }
    return {
      songId,
      status: row.status,
      source: row.source,
      language: row.language,
      document: this.parseDocument(row.document_json, songId) ?? EMPTY_LYRICS,
      original: row.original_json ? this.parseDocument(row.original_json, songId) : null,
      offsetSeconds: Number(row.offset_seconds),
      transcription: {
        status: row.transcription_status,
        progress: null,
        error: row.transcription_error,
        model: row.transcription_model
      },
      updatedAt: row.updated_at
    }
  }

  private parseDocument(json: string, songId: string): LyricDocument | null {
    try {
      const parsed = LyricDocumentSchema.safeParse(JSON.parse(json))
      if (parsed.success) return parsed.data
    } catch {
      // fall through
    }
    this.logger.warn('Unreadable lyric document', { songId })
    return null
  }

  private ensureLyricsRow(songId: string): void {
    this.requireSong(songId)
    this.db
      .prepare(
        `INSERT OR IGNORE INTO lyric_documents (song_id, status, document_json, updated_at) VALUES (?, 'empty', ?, ?)`
      )
      .run(songId, JSON.stringify(EMPTY_LYRICS), this.now())
  }

  /** Saves the user's version. Only an explicit confirm marks the lyrics as checked. */
  saveLyrics(input: SaveLyricsInput): LyricsState {
    return transaction(this.db, () => {
      this.ensureLyricsRow(input.songId)
      const empty = documentStats(input.document).words === 0 && input.document.lines.length === 0
      const status = empty ? 'empty' : input.confirm ? 'confirmed' : 'draft'
      this.db
        .prepare(
          `UPDATE lyric_documents SET document_json = ?, offset_seconds = ?, language = ?, source = ?, status = ?, updated_at = ?
           WHERE song_id = ?`
        )
        .run(
          JSON.stringify(input.document),
          input.offsetSeconds,
          input.language,
          empty ? null : input.source,
          status,
          this.now(),
          input.songId
        )
      return this.lyrics(input.songId)
    })
  }

  setTranscriptionState(songId: string, status: TranscriptionStatus, details: { error?: string | null; model?: string | null } = {}): void {
    this.ensureLyricsRow(songId)
    this.db
      .prepare(
        `UPDATE lyric_documents SET transcription_status = ?, transcription_error = ?,
           transcription_model = COALESCE(?, transcription_model), updated_at = ? WHERE song_id = ?`
      )
      .run(status, details.error ?? null, details.model ?? null, this.now(), songId)
  }

  /**
   * Stores a finished transcription as the original. It becomes the working
   * document only if the user has no lyrics yet: their own work is never replaced.
   */
  storeTranscription(songId: string, original: LyricDocument, language: string | null, model: string): LyricsState {
    return transaction(this.db, () => {
      this.ensureLyricsRow(songId)
      const current = this.lyrics(songId)
      const adopt = current.status === 'empty'
      this.db
        .prepare(
          `UPDATE lyric_documents SET original_json = ?, transcription_status = 'ready', transcription_error = NULL,
             transcription_model = ?, transcription_language = ?, updated_at = ?
             ${adopt ? `, document_json = ?, status = 'draft', source = 'transcription', language = ?` : ''}
           WHERE song_id = ?`
        )
        .run(
          ...([JSON.stringify(original), model, language, this.now()] as (string | null)[]),
          ...(adopt ? [JSON.stringify(original), language] : []),
          songId
        )
      return this.lyrics(songId)
    })
  }

  /** After a crash: transcriptions that were running are marked as interrupted. */
  resetInterruptedTranscriptions(): number {
    return Number(
      this.db
        .prepare(
          `UPDATE lyric_documents SET transcription_status = 'error',
             transcription_error = 'Interrupted when the app closed. Start it again.', updated_at = ?
           WHERE transcription_status IN ('pending', 'processing')`
        )
        .run(this.now()).changes
    )
  }

  /** When the song's audio changes, timings may no longer match: confirmed lyrics go back to draft. */
  audioChanged(songId: string): void {
    this.resetCorrections(songId)
    this.db
      .prepare(`UPDATE lyric_documents SET status = 'draft', updated_at = ? WHERE song_id = ? AND status = 'confirmed'`)
      .run(this.now(), songId)
  }

  /* -------------------------------------------------------------- */
  /* Hooks                                                          */
  /* -------------------------------------------------------------- */

  private toHook(row: HookRow): Hook {
    let tags: string[] = []
    try {
      const parsed: unknown = JSON.parse(row.tags_json)
      if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string')
    } catch {
      tags = []
    }
    return {
      id: row.id,
      songId: row.song_id,
      name: row.name,
      start: Number(row.start_seconds),
      end: Number(row.end_seconds),
      notes: row.notes,
      tags,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  hooks(songId: string): Hook[] {
    return (
      this.db
        .prepare(
          `SELECT id, song_id, name, start_seconds, end_seconds, notes, tags_json, created_at, updated_at
           FROM hooks WHERE song_id = ? ORDER BY start_seconds, name`
        )
        .all(songId) as HookRow[]
    ).map((r) => this.toHook(r))
  }

  hook(id: string): Hook {
    const row = this.db
      .prepare(`SELECT id, song_id, name, start_seconds, end_seconds, notes, tags_json, created_at, updated_at FROM hooks WHERE id = ?`)
      .get(id) as HookRow | undefined
    if (!row) throw new NotFoundError('That hook no longer exists.')
    return this.toHook(row)
  }

  createHook(input: CreateHookInput): Hook {
    this.requireSong(input.songId)
    const id = this.newId()
    const t = this.now()
    this.db
      .prepare(
        `INSERT INTO hooks (id, song_id, name, start_seconds, end_seconds, notes, tags_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.songId, input.name, input.start, input.end, input.notes ?? null, JSON.stringify(input.tags ?? []), t, t)
    return this.hook(id)
  }

  updateHook(input: UpdateHookInput): Hook {
    return transaction(this.db, () => {
      const current = this.hook(input.id)
      const start = input.start ?? current.start
      const end = input.end ?? current.end
      if (end - start < 0.25) throw new UnprocessableError('A hook must be at least 0.25 seconds long.')
      this.db
        .prepare(
          `UPDATE hooks SET name = ?, start_seconds = ?, end_seconds = ?, notes = ?, tags_json = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          input.name ?? current.name,
          start,
          end,
          input.notes === undefined ? current.notes : input.notes,
          JSON.stringify(input.tags ?? current.tags),
          this.now(),
          input.id
        )
      return this.hook(input.id)
    })
  }

  deleteHook(id: string): void {
    if (Number(this.db.prepare('DELETE FROM hooks WHERE id = ?').run(id).changes) === 0) {
      throw new NotFoundError('That hook no longer exists.')
    }
  }
}
