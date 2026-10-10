import type { SqlDriver } from '../db/driver'
import type { MusicAnalysis } from '../../shared/analysis'

export type AnalysisStatus = 'pending' | 'processing' | 'ready' | 'error'

export type AnalysisRecord = {
  assetId: string
  contentHash: string | null
  version: number
  status: AnalysisStatus
  error: string | null
  analysis: MusicAnalysis | null
  waveformPath: string | null
  updatedAt: string
}

type Row = {
  asset_id: string
  content_hash: string | null
  analysis_version: number
  status: AnalysisStatus
  error_message: string | null
  result_json: string | null
  waveform_path: string | null
  updated_at: string
}

export class AnalysisRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  get(assetId: string): AnalysisRecord | null {
    const row = this.db
      .prepare(
        `SELECT asset_id, content_hash, analysis_version, status, error_message, result_json, waveform_path, updated_at
         FROM music_analyses WHERE asset_id = ?`
      )
      .get(assetId) as Row | undefined
    if (!row) return null
    let analysis: MusicAnalysis | null = null
    if (row.result_json) {
      try {
        analysis = JSON.parse(row.result_json) as MusicAnalysis
      } catch {
        analysis = null
      }
    }
    return {
      assetId: row.asset_id,
      contentHash: row.content_hash,
      version: Number(row.analysis_version),
      status: row.status,
      error: row.error_message,
      analysis,
      waveformPath: row.waveform_path,
      updatedAt: row.updated_at
    }
  }

  /** Queues (re)analysis. The previous result stays readable until the new one is ready. */
  queue(assetId: string, contentHash: string | null, version: number): void {
    const t = this.now()
    this.db
      .prepare(
        `INSERT INTO music_analyses (asset_id, content_hash, analysis_version, status, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(asset_id) DO UPDATE SET status = 'pending', error_message = NULL,
           content_hash = excluded.content_hash, analysis_version = excluded.analysis_version, updated_at = excluded.updated_at`
      )
      .run(assetId, contentHash, version, t, t)
  }

  markProcessing(assetId: string): void {
    this.db.prepare(`UPDATE music_analyses SET status = 'processing', updated_at = ? WHERE asset_id = ?`).run(this.now(), assetId)
  }

  markReady(assetId: string, analysis: MusicAnalysis, waveformPath: string): void {
    this.db
      .prepare(
        `UPDATE music_analyses SET status = 'ready', error_message = NULL, result_json = ?, waveform_path = ?,
           analysis_version = ?, updated_at = ? WHERE asset_id = ?`
      )
      .run(JSON.stringify(analysis), waveformPath, analysis.version, this.now(), assetId)
  }

  markError(assetId: string, message: string): void {
    this.db
      .prepare(`UPDATE music_analyses SET status = 'error', error_message = ?, updated_at = ? WHERE asset_id = ?`)
      .run(message, this.now(), assetId)
  }

  resetInterrupted(): number {
    return Number(
      this.db.prepare(`UPDATE music_analyses SET status = 'pending', updated_at = ? WHERE status = 'processing'`).run(this.now()).changes
    )
  }

  pendingIds(): string[] {
    return (this.db.prepare(`SELECT asset_id FROM music_analyses WHERE status = 'pending' ORDER BY updated_at`).all() as {
      asset_id: string
    }[]).map((r) => r.asset_id)
  }
}
