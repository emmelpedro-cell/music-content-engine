import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ANALYSIS_VERSION, type MusicAnalysis, type Waveform } from '../../shared/analysis'
import type { AnalysisState, WorkspaceEvent } from '../../shared/workspace'
import { ConflictError, UnprocessableError } from '../errors'
import type { Logger } from '../logger'
import type { MediaTools } from '../media/binaries'
import { MediaReadError } from '../media/probe'
import { ProcessError } from '../media/run-process'
import type { AnalysisRepository } from '../repositories/analysis'
import type { MediaRepository } from '../repositories/media'
import { WAVEFORM_RATE } from './analyze'
import { decodeForAnalysis } from './decode'
import type { AnalysisRunner } from './run-in-worker'

export type AnalysisServiceOptions = {
  repo: AnalysisRepository
  media: MediaRepository
  getTools: () => Promise<MediaTools>
  runner: AnalysisRunner
  waveformsDirectory: string
  logger: Logger
  emit: (event: WorkspaceEvent) => void
}

/**
 * Analyses song audio (one file at a time: it is CPU-heavy) and caches the
 * result per asset, keyed by content fingerprint and algorithm version.
 * Status lives in SQLite, so interrupted work resumes on the next start.
 */
export class AnalysisService {
  private queue: string[] = []
  private running: { assetId: string; controller: AbortController } | null = null
  private shuttingDown = false
  private idleWaiters: (() => void)[] = []

  constructor(private readonly o: AnalysisServiceOptions) {}

  start(): void {
    const reset = this.o.repo.resetInterrupted()
    const pending = this.o.repo.pendingIds()
    if (reset || pending.length) this.o.logger.info('Resuming analysis', { interrupted: reset, pending: pending.length })
    for (const id of pending) this.enqueue(id)
    void this.pump()
  }

  shutdown(): void {
    this.shuttingDown = true
    this.queue = []
    this.running?.controller.abort()
  }

  state(assetId: string): AnalysisState | null {
    const record = this.o.repo.get(assetId)
    if (!record) return null
    return { assetId, status: record.status, error: record.error, analysis: record.analysis, updatedAt: record.updatedAt }
  }

  /**
   * Makes sure an up-to-date analysis exists or is on its way. Re-analyses
   * when forced, when the file's content changed, or when the algorithm did.
   */
  ensure(assetId: string, options: { force?: boolean } = {}): AnalysisState | null {
    const asset = this.o.media.record(assetId)
    if (asset.status !== 'ready' || (asset.kind !== 'audio' && asset.kind !== 'video')) {
      throw new UnprocessableError('This file has not finished importing yet.')
    }
    const current = this.o.repo.get(assetId)
    const busy = this.running?.assetId === assetId || this.queue.includes(assetId)
    const fresh =
      current &&
      current.status === 'ready' &&
      current.analysis?.version === ANALYSIS_VERSION &&
      current.contentHash === asset.contentHash
    if (busy || (fresh && !options.force)) return this.state(assetId)
    if (asset.availability === 'missing') {
      if (current) return this.state(assetId)
      throw new ConflictError('The audio file can’t be found. Relink it in the Media Library first.')
    }
    this.o.repo.queue(assetId, asset.contentHash, ANALYSIS_VERSION)
    this.enqueue(assetId)
    this.emitState(assetId)
    void this.pump()
    return this.state(assetId)
  }

  async waveform(assetId: string): Promise<Waveform | null> {
    const record = this.o.repo.get(assetId)
    if (!record?.waveformPath || !record.analysis) return null
    try {
      const bytes = await readFile(record.waveformPath)
      return { rate: WAVEFORM_RATE, durationSeconds: record.analysis.durationSeconds, peaks: new Uint8Array(bytes) }
    } catch {
      return null
    }
  }

  waitForIdle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  private enqueue(assetId: string): void {
    if (!this.queue.includes(assetId) && this.running?.assetId !== assetId) this.queue.push(assetId)
  }

  private async pump(): Promise<void> {
    if (this.running || this.shuttingDown) return
    const assetId = this.queue.shift()
    if (!assetId) {
      const waiters = this.idleWaiters
      this.idleWaiters = []
      waiters.forEach((w) => w())
      return
    }
    const controller = new AbortController()
    this.running = { assetId, controller }
    try {
      await this.process(assetId, controller.signal)
    } catch (error) {
      if (this.shuttingDown) return
      const message = describe(error)
      this.o.logger.warn('Analysis failed', { assetId, message, error })
      try {
        this.o.repo.markError(assetId, message)
      } catch {
        // asset removed meanwhile
      }
      this.emitState(assetId)
    } finally {
      this.running = null
      if (!this.shuttingDown) void this.pump()
    }
  }

  private async process(assetId: string, signal: AbortSignal): Promise<void> {
    const asset = this.o.media.record(assetId)
    this.o.repo.markProcessing(assetId)
    this.emitState(assetId)
    const tools = await this.o.getTools()
    const started = Date.now()
    const audio = await decodeForAnalysis(tools, asset.sourcePath, asset.fileName, signal)
    const { analysis, waveform } = await this.o.runner({ samples: audio.samples, sampleRate: audio.sampleRate, beatsPerBar: 4 }, signal)
    const path = await this.writeWaveform(assetId, waveform)
    this.o.repo.markReady(assetId, analysis satisfies MusicAnalysis, path)
    this.o.logger.info('Analysis ready', { assetId, bpm: analysis.bpm, beats: analysis.beats.length, ms: Date.now() - started })
    this.emitState(assetId)
  }

  private async writeWaveform(assetId: string, waveform: Waveform): Promise<string> {
    await mkdir(this.o.waveformsDirectory, { recursive: true })
    const path = join(this.o.waveformsDirectory, `${assetId}.peaks`)
    const tmp = `${path}.tmp`
    await writeFile(tmp, waveform.peaks)
    await rm(path, { force: true })
    await rename(tmp, path)
    return path
  }

  private emitState(assetId: string): void {
    const state = this.state(assetId)
    if (!state) return
    try {
      this.o.emit({ type: 'analysis', state })
    } catch (error) {
      this.o.logger.warn('Analysis event delivery failed', { error })
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof MediaReadError || error instanceof UnprocessableError) return error.message
  if (error instanceof ProcessError) {
    if (error.code === 'TIMEOUT') return 'Decoding the audio took too long and was stopped.'
    return `FFmpeg failed while decoding the audio.${error.stderrSummary ? ` (${error.stderrSummary})` : ''}`
  }
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOENT') return 'The audio file can’t be found. Relink it in the Media Library.'
  return `Analysis failed: ${(error as Error)?.message ?? String(error)}`
}
