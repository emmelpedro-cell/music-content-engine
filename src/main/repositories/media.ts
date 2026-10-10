import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { SqlDriver } from '../db/driver'
import { NotFoundError } from '../errors'
import type { MediaAsset, MediaAvailability, MediaKind, MediaStatus } from '../../shared/media'
import type { MediaMetadata } from '../media/probe'

type Row = {
  id: string
  source_path: string
  path_key: string
  file_name: string
  file_size: number
  file_mtime_ms: number | null
  content_hash: string | null
  kind: MediaKind | null
  status: MediaStatus
  error_message: string | null
  availability: MediaAvailability
  duration_seconds: number | null
  container: string | null
  video_codec: string | null
  audio_codec: string | null
  width: number | null
  height: number | null
  frame_rate: number | null
  rotation: number | null
  sample_rate: number | null
  channels: number | null
  bit_rate: number | null
  thumbnail_path: string | null
  imported_at: string
  updated_at: string
}

const n = (v: number | bigint | null): number | null => (v === null ? null : Number(v))

function toAsset(row: Row): MediaAsset {
  return {
    id: row.id,
    fileName: row.file_name,
    sourcePath: row.source_path,
    fileSize: Number(row.file_size),
    kind: row.kind,
    status: row.status,
    errorMessage: row.error_message,
    availability: row.availability,
    durationSeconds: n(row.duration_seconds),
    container: row.container,
    videoCodec: row.video_codec,
    audioCodec: row.audio_codec,
    width: n(row.width),
    height: n(row.height),
    frameRate: n(row.frame_rate),
    rotation: n(row.rotation),
    sampleRate: n(row.sample_rate),
    channels: n(row.channels),
    bitRate: n(row.bit_rate),
    hasThumbnail: row.thumbnail_path !== null,
    importedAt: row.imported_at,
    updatedAt: row.updated_at
  }
}

const COLUMNS = `id, source_path, path_key, file_name, file_size, file_mtime_ms, content_hash, kind, status,
  error_message, availability, duration_seconds, container, video_codec, audio_codec, width, height,
  frame_rate, rotation, sample_rate, channels, bit_rate, thumbnail_path, imported_at, updated_at`

const CLEAR_METADATA = `kind = NULL, duration_seconds = NULL, container = NULL, video_codec = NULL,
  audio_codec = NULL, width = NULL, height = NULL, frame_rate = NULL, rotation = NULL, sample_rate = NULL,
  channels = NULL, bit_rate = NULL, probe_json = NULL`

/** Internal fields the import service needs but the renderer never sees. */
export type AssetRecord = MediaAsset & {
  pathKey: string
  contentHash: string | null
  thumbnailPath: string | null
  fileMtimeMs: number | null
}

/**
 * Persistence for media assets. Only references and derived data are stored:
 * source files are never copied, moved or deleted.
 */
export class MediaRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = randomUUID
  ) {}

  private row(id: string): Row | undefined {
    return this.db.prepare(`SELECT ${COLUMNS} FROM media_assets WHERE id = ?`).get(id) as Row | undefined
  }

  list(): MediaAsset[] {
    return (this.db.prepare(`SELECT ${COLUMNS} FROM media_assets ORDER BY imported_at DESC, file_name`).all() as Row[]).map(
      toAsset
    )
  }

  get(id: string): MediaAsset {
    const row = this.row(id)
    if (!row) throw new NotFoundError('That media file is no longer in the library.')
    return toAsset(row)
  }

  find(id: string): MediaAsset | null {
    const row = this.row(id)
    return row ? toAsset(row) : null
  }

  record(id: string): AssetRecord {
    const row = this.row(id)
    if (!row) throw new NotFoundError('That media file is no longer in the library.')
    return {
      ...toAsset(row),
      pathKey: row.path_key,
      contentHash: row.content_hash,
      thumbnailPath: row.thumbnail_path,
      fileMtimeMs: n(row.file_mtime_ms)
    }
  }

  findByPathKey(key: string): MediaAsset | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM media_assets WHERE path_key = ?`).get(key) as Row | undefined
    return row ? toAsset(row) : null
  }

  /** Another asset with the same content (used to skip duplicates and to verify relinks). */
  findByContentHash(hash: string, excludeId: string): MediaAsset | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM media_assets WHERE content_hash = ? AND id <> ? AND status <> 'error' LIMIT 1`)
      .get(hash, excludeId) as Row | undefined
    return row ? toAsset(row) : null
  }

  /** Inserts a pending asset. Returns null if a file with that path is already in the library. */
  insertPending(input: { path: string; pathKey: string; size: number; mtimeMs: number }): MediaAsset | null {
    const id = this.newId()
    const t = this.now()
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO media_assets
           (id, source_path, path_key, file_name, file_size, file_mtime_ms, status, availability, imported_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 'online', ?, ?)`
      )
      .run(id, input.path, input.pathKey, basename(input.path), input.size, input.mtimeMs, t, t)
    return Number(result.changes) === 1 ? this.get(id) : null
  }

  pendingIds(): string[] {
    return (
      this.db.prepare(`SELECT id FROM media_assets WHERE status = 'pending' ORDER BY imported_at, file_name`).all() as {
        id: string
      }[]
    ).map((r) => r.id)
  }

  /** After a crash or forced quit, work that was in progress is queued again. */
  resetInterrupted(): number {
    const result = this.db
      .prepare(`UPDATE media_assets SET status = 'pending', updated_at = ? WHERE status = 'processing'`)
      .run(this.now())
    return Number(result.changes)
  }

  markProcessing(id: string): void {
    this.db
      .prepare(`UPDATE media_assets SET status = 'processing', error_message = NULL, updated_at = ? WHERE id = ?`)
      .run(this.now(), id)
  }

  setFingerprint(id: string, hash: string, size: number): void {
    this.db
      .prepare(`UPDATE media_assets SET content_hash = ?, file_size = ?, updated_at = ? WHERE id = ?`)
      .run(hash, size, this.now(), id)
  }

  markReady(id: string, metadata: MediaMetadata, probeJson: string, thumbnailPath: string | null): MediaAsset {
    this.db
      .prepare(
        `UPDATE media_assets SET
           status = 'ready', error_message = NULL, availability = 'online',
           kind = ?, duration_seconds = ?, container = ?, video_codec = ?, audio_codec = ?,
           width = ?, height = ?, frame_rate = ?, rotation = ?, sample_rate = ?, channels = ?,
           bit_rate = ?, probe_json = ?, thumbnail_path = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        metadata.kind,
        metadata.durationSeconds,
        metadata.container,
        metadata.video?.codec ?? null,
        metadata.audio?.codec ?? null,
        metadata.video?.width ?? null,
        metadata.video?.height ?? null,
        metadata.video?.frameRate ?? null,
        metadata.video?.rotation ?? null,
        metadata.audio?.sampleRate ?? null,
        metadata.audio?.channels ?? null,
        metadata.bitRate === null ? null : Math.round(metadata.bitRate),
        probeJson,
        thumbnailPath,
        this.now(),
        id
      )
    return this.get(id)
  }

  markError(id: string, message: string, availability?: MediaAvailability): MediaAsset {
    this.db
      .prepare(
        `UPDATE media_assets SET status = 'error', error_message = ?, availability = COALESCE(?, availability),
           updated_at = ? WHERE id = ?`
      )
      .run(message, availability ?? null, this.now(), id)
    return this.get(id)
  }

  requeue(id: string): MediaAsset {
    this.db
      .prepare(`UPDATE media_assets SET status = 'pending', error_message = NULL, updated_at = ? WHERE id = ?`)
      .run(this.now(), id)
    return this.get(id)
  }

  setAvailability(id: string, availability: MediaAvailability): MediaAsset {
    this.db
      .prepare(`UPDATE media_assets SET availability = ?, availability_checked_at = ?, updated_at = ? WHERE id = ?`)
      .run(availability, this.now(), this.now(), id)
    return this.get(id)
  }

  /**
   * Points an asset at a new file location. With `resetMetadata` the asset is
   * re-imported (the file's content differs from what was analysed before).
   */
  relink(
    id: string,
    input: { path: string; pathKey: string; size: number; mtimeMs: number; contentHash: string },
    resetMetadata: boolean
  ): MediaAsset {
    this.db
      .prepare(
        `UPDATE media_assets SET source_path = ?, path_key = ?, file_name = ?, file_size = ?, file_mtime_ms = ?,
           content_hash = ?, availability = 'online', availability_checked_at = ?, updated_at = ?
           ${resetMetadata ? `, status = 'pending', error_message = NULL, thumbnail_path = NULL, ${CLEAR_METADATA}` : ''}
         WHERE id = ?`
      )
      .run(input.path, input.pathKey, basename(input.path), input.size, input.mtimeMs, input.contentHash, this.now(), this.now(), id)
    return this.get(id)
  }

  /** Removes the library entry only. Returns the thumbnail path so the caller can delete that file. */
  delete(id: string): { thumbnailPath: string | null } {
    const row = this.row(id)
    if (!row) throw new NotFoundError('That media file is no longer in the library.')
    this.db.prepare('DELETE FROM media_assets WHERE id = ?').run(id)
    return { thumbnailPath: row.thumbnail_path }
  }

  missingAssets(): AssetRecord[] {
    const ids = (this.db.prepare(`SELECT id FROM media_assets WHERE availability = 'missing'`).all() as { id: string }[]).map(
      (r) => r.id
    )
    return ids.map((id) => this.record(id))
  }

  allLocations(): { id: string; sourcePath: string; availability: MediaAvailability }[] {
    return (
      this.db.prepare('SELECT id, source_path, availability FROM media_assets').all() as {
        id: string
        source_path: string
        availability: MediaAvailability
      }[]
    ).map((r) => ({ id: r.id, sourcePath: r.source_path, availability: r.availability }))
  }
}
