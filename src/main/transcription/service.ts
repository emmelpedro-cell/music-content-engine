import { randomUUID } from 'node:crypto'
import { cpus } from 'node:os'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { LyricsState } from '../../shared/lyrics'
import type { WorkspaceEvent } from '../../shared/workspace'
import { ConflictError, UnprocessableError } from '../errors'
import type { Logger } from '../logger'
import type { MediaTools } from '../media/binaries'
import { TEMP_PREFIX } from '../media/operations'
import { MediaReadError } from '../media/probe'
import { ProcessError, runProcess } from '../media/run-process'
import type { MediaRepository } from '../repositories/media'
import type { ProjectsRepository } from '../repositories/projects'
import type { WorkspaceRepository } from '../repositories/workspace'
import type { SpeechModels } from './models'
import { parseWhisperJson, transcriptToDocument } from './parse'

export type TranscriptionServiceOptions = {
  workspace: WorkspaceRepository
  projects: ProjectsRepository
  media: MediaRepository
  models: SpeechModels
  getFfmpeg: () => Promise<MediaTools>
  getWhisper: () => Promise<string>
  tempDirectory: string
  logger: Logger
  emit: (event: WorkspaceEvent) => void
  threads?: number
}

type Job = { songId: string; model: string; language: string | null }

const PROGRESS = /progress\s*=\s*(\d{1,3})%/g

/**
 * Local transcription with whisper.cpp, one song at a time. Nothing leaves the
 * computer. The result is stored as the "original" transcription; it becomes
 * the working lyrics only if the user has none yet.
 */
export class TranscriptionService {
  private queue: Job[] = []
  private running: { job: Job; controller: AbortController } | null = null
  private readonly progress = new Map<string, number>()
  private shuttingDown = false
  private idleWaiters: (() => void)[] = []

  constructor(private readonly o: TranscriptionServiceOptions) {}

  start(): void {
    const reset = this.o.workspace.resetInterruptedTranscriptions()
    if (reset) this.o.logger.info('Transcriptions interrupted by the last shutdown were marked as failed', { reset })
  }

  shutdown(): void {
    this.shuttingDown = true
    this.queue = []
    this.running?.controller.abort()
  }

  /** Lyrics state with live progress filled in. */
  lyrics(songId: string): LyricsState {
    const state = this.o.workspace.lyrics(songId)
    const p = this.progress.get(songId)
    return p === undefined ? state : { ...state, transcription: { ...state.transcription, progress: p } }
  }

  /** Validates everything up front so problems show immediately, then queues the work. */
  async transcribe(job: Job): Promise<LyricsState> {
    if (this.running?.job.songId === job.songId || this.queue.some((j) => j.songId === job.songId)) {
      throw new ConflictError('This song is already being transcribed.')
    }
    const project = this.o.projects.get(job.songId)
    if (!project.audioAssetId) throw new UnprocessableError('Choose the song’s audio before transcribing.')
    const audio = this.o.media.get(project.audioAssetId)
    if (audio.availability === 'missing') throw new ConflictError('The song’s audio file can’t be found. Relink it in the Media Library.')
    await this.o.getWhisper()
    await this.o.models.require(job.model)
    await this.o.getFfmpeg()

    this.o.workspace.setTranscriptionState(job.songId, 'pending', { model: job.model })
    this.queue.push(job)
    this.emit(job.songId)
    void this.pump()
    return this.lyrics(job.songId)
  }

  cancel(songId: string): void {
    const index = this.queue.findIndex((j) => j.songId === songId)
    if (index >= 0) {
      this.queue.splice(index, 1)
      this.o.workspace.setTranscriptionState(songId, 'none')
      this.emit(songId)
      return
    }
    if (this.running?.job.songId === songId) this.running.controller.abort()
  }

  waitForIdle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  private async pump(): Promise<void> {
    if (this.running || this.shuttingDown) return
    const job = this.queue.shift()
    if (!job) {
      const waiters = this.idleWaiters
      this.idleWaiters = []
      waiters.forEach((w) => w())
      return
    }
    const controller = new AbortController()
    this.running = { job, controller }
    try {
      await this.process(job, controller.signal)
    } catch (error) {
      if (this.shuttingDown) return
      if (controller.signal.aborted) {
        this.o.workspace.setTranscriptionState(job.songId, 'none')
        this.o.logger.info('Transcription cancelled', { songId: job.songId })
      } else {
        const message = describe(error)
        this.o.logger.warn('Transcription failed', { songId: job.songId, message, error })
        this.o.workspace.setTranscriptionState(job.songId, 'error', { error: message })
      }
    } finally {
      this.progress.delete(job.songId)
      this.running = null
      try {
        this.emit(job.songId)
      } catch {
        // song deleted meanwhile
      }
      if (!this.shuttingDown) void this.pump()
    }
  }

  private async process(job: Job, signal: AbortSignal): Promise<void> {
    const project = this.o.projects.get(job.songId)
    if (!project.audioAssetId) throw new UnprocessableError('The song no longer has audio.')
    const audio = this.o.media.get(project.audioAssetId)
    const [ffmpeg, cli, model] = await Promise.all([this.o.getFfmpeg(), this.o.getWhisper(), this.o.models.require(job.model)])

    this.o.workspace.setTranscriptionState(job.songId, 'processing', { model: job.model })
    this.progress.set(job.songId, 0)
    this.emit(job.songId)

    const base = join(this.o.tempDirectory, `${TEMP_PREFIX}transcribe-${randomUUID()}`)
    const wav = `${base}.wav`
    try {
      // whisper.cpp expects 16 kHz mono PCM.
      await runProcess(
        ffmpeg.ffmpeg,
        ['-v', 'error', '-nostdin', '-i', audio.sourcePath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', wav],
        { signal, timeoutMs: 5 * 60_000 }
      ).catch((error: unknown) => {
        if (error instanceof ProcessError && error.code === 'EXIT') {
          throw new MediaReadError(`The audio of "${audio.fileName}" could not be decoded.`)
        }
        throw error
      })

      const threads = this.o.threads ?? Math.max(1, Math.min(8, cpus().length - 1))
      let lastEmit = 0
      await runProcess(
        cli,
        ['-m', model, '-f', wav, '-l', job.language ?? 'auto', '-ml', '1', '-sow', '-ojf', '-of', base, '-pp', '-t', String(threads)],
        {
          signal,
          // Large models on slow CPUs can take several times the song's length.
          timeoutMs: Math.max(15 * 60_000, (audio.durationSeconds ?? 300) * 1000 * 12),
          maxStdoutBytes: 64 * 1024 * 1024,
          onStderr: (chunk) => {
            const matches = [...chunk.matchAll(PROGRESS)]
            const last = matches[matches.length - 1]
            if (!last) return
            this.progress.set(job.songId, Math.min(1, Number(last[1]) / 100))
            if (Date.now() - lastEmit > 500) {
              lastEmit = Date.now()
              this.emit(job.songId)
            }
          }
        }
      ).catch((error: unknown) => {
        if (error instanceof ProcessError && error.code === 'EXIT') {
          throw new MediaReadError(`The transcriber stopped with an error.${error.stderrSummary ? ` (${error.stderrSummary})` : ''}`)
        }
        throw error
      })

      const output = parseWhisperJson(await readFile(`${base}.json`))
      const document = transcriptToDocument(output)
      const language = output.result?.language ?? job.language
      this.o.workspace.storeTranscription(job.songId, document, language ?? null, job.model)
      this.o.logger.info('Transcription ready', {
        songId: job.songId,
        model: job.model,
        language,
        lines: document.lines.length,
        words: document.lines.reduce((n, l) => n + l.words.length, 0)
      })
    } finally {
      await rm(wav, { force: true }).catch(() => undefined)
      await rm(`${base}.json`, { force: true }).catch(() => undefined)
    }
  }

  private emit(songId: string): void {
    try {
      this.o.emit({ type: 'lyrics', state: this.lyrics(songId) })
    } catch (error) {
      this.o.logger.warn('Lyrics event delivery failed', { error })
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof MediaReadError || error instanceof UnprocessableError || error instanceof ConflictError) return error.message
  if (error instanceof ProcessError) {
    if (error.code === 'TIMEOUT') return 'Transcription took too long and was stopped. Try a smaller model.'
    if (error.code === 'SPAWN') return `The transcriber could not be started (${error.message}).`
    return `The transcriber failed.${error.stderrSummary ? ` (${error.stderrSummary})` : ''}`
  }
  if (error instanceof SyntaxError || (error as Error)?.name === 'ZodError') return 'The transcriber produced output that could not be read.'
  return `Transcription failed: ${(error as Error)?.message ?? String(error)}`
}
