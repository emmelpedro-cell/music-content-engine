import { randomUUID } from 'node:crypto'
import type { SqlDriver } from '../db/driver'
import { transaction } from '../db/driver'
import { NotFoundError, UnprocessableError } from '../errors'
import type { CreateProjectData, Project, UpdateProjectData } from '../../shared/schemas'

// Re-exported for existing imports.
export { NotFoundError }

type SongRow = {
  id: string
  title: string
  artist: string | null
  audio_asset_id: string | null
  created_at: string
  updated_at: string
}

function toProject(row: SongRow): Project {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    audioAssetId: row.audio_asset_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// songs.source_audio_path and songs.duration_seconds (migration v1) are unused since
// migration v2: the song's audio is a media asset. See TECHNICAL_DECISIONS TD-016.
const COLUMNS = 'id, title, artist, audio_asset_id, created_at, updated_at'

/**
 * A "project" is a song project (spec §4.2): the song is the unit that owns
 * audio, analysis, lyrics, hooks and edits. Inputs arrive already validated
 * by the IPC layer; the table's CHECK constraints are the last line of defense.
 */
export class ProjectsRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = randomUUID
  ) {}

  list(): Project[] {
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM songs ORDER BY updated_at DESC, created_at DESC`)
      .all() as SongRow[]
    return rows.map(toProject)
  }

  get(id: string): Project {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM songs WHERE id = ?`).get(id) as SongRow | undefined
    if (!row) throw new NotFoundError(`Project ${id} was not found. It may have been deleted.`)
    return toProject(row)
  }

  create(input: CreateProjectData): Project {
    const id = this.newId()
    const timestamp = this.now()
    this.db
      .prepare(
        `INSERT INTO songs (id, title, artist, source_audio_path, duration_seconds, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?)`
      )
      .run(id, input.title, input.artist ?? null, timestamp, timestamp)
    return this.get(id)
  }

  update(input: UpdateProjectData): Project {
    return transaction(this.db, () => {
      const current = this.get(input.id)
      const title = input.title ?? current.title
      const artist = input.artist === undefined ? current.artist : input.artist
      this.db
        .prepare('UPDATE songs SET title = ?, artist = ?, updated_at = ? WHERE id = ?')
        .run(title, artist, this.now(), input.id)
      return this.get(input.id)
    })
  }

  /** Sets (or clears) the song's audio. The asset must be a ready audio file in the library. */
  setAudio(id: string, audioAssetId: string | null): Project {
    return transaction(this.db, () => {
      this.get(id)
      if (audioAssetId !== null) {
        const asset = this.db
          .prepare('SELECT kind, status FROM media_assets WHERE id = ?')
          .get(audioAssetId) as { kind: string | null; status: string } | undefined
        if (!asset) throw new NotFoundError('That audio file is no longer in the library.')
        if (asset.kind !== 'audio' || asset.status !== 'ready') {
          throw new UnprocessableError('Choose an audio file that has finished importing.')
        }
      }
      this.db
        .prepare('UPDATE songs SET audio_asset_id = ?, updated_at = ? WHERE id = ?')
        .run(audioAssetId, this.now(), id)
      return this.get(id)
    })
  }

  /** Deletes the project record only. Source media files are never touched. */
  delete(id: string): void {
    const result = this.db.prepare('DELETE FROM songs WHERE id = ?').run(id)
    if (Number(result.changes) === 0) {
      throw new NotFoundError(`Project ${id} was not found. It may have been deleted.`)
    }
  }
}
