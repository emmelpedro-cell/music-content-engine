import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import sources from '../../../scripts/whisper-sources.json'
import type { SpeechModelInfo } from '../../shared/workspace'
import { ConflictError, NotFoundError, UnavailableError } from '../errors'
import type { Logger } from '../logger'

export type CatalogEntry = { id: string; file: string; size: number; sha256: string }

const DESCRIPTIONS: Record<string, { label: string; description: string; recommended?: boolean }> = {
  tiny: { label: 'Tiny', description: 'Fastest, lowest accuracy. Mainly for testing.' },
  base: { label: 'Base', description: 'Fast. Fine for clear vocals in English; struggles with singing.' },
  small: { label: 'Small', description: 'Slower, better accuracy, also for other languages.' },
  'large-v3-turbo-q5_0': {
    label: 'Large v3 Turbo',
    description: 'Best accuracy for sung lyrics and Portuguese. Takes a few minutes per song on a typical CPU.',
    recommended: true
  },
  'large-v3-turbo-q8_0': { label: 'Large v3 Turbo (higher precision)', description: 'Slightly more accurate, larger and slower.' }
}

export type ModelFetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>

/**
 * Speech models are not in the installer. The user downloads the one they
 * want; each download is verified against its pinned SHA-256 while it streams,
 * written to a temporary file, and only moved into place once it checks out.
 */
export class SpeechModels {
  private readonly catalog: CatalogEntry[]
  private readonly downloads = new Map<string, { controller: AbortController; received: number; total: number }>()
  private readonly errors = new Map<string, string>()

  constructor(
    private readonly o: {
      directory: string
      logger: Logger
      emit: (models: SpeechModelInfo[]) => void
      fetch?: ModelFetch
      baseUrl?: string
      /** Defaults to the pinned catalog in scripts/whisper-sources.json (tests pass their own). */
      catalog?: CatalogEntry[]
    }
  ) {
    this.catalog = o.catalog ?? sources.models
  }

  private entry(id: string): CatalogEntry {
    const e = this.catalog.find((m) => m.id === id)
    if (!e) throw new NotFoundError(`Unknown speech model "${id}".`)
    return e
  }

  pathOf(id: string): string {
    return join(this.o.directory, this.entry(id).file)
  }

  private async installed(e: CatalogEntry): Promise<boolean> {
    try {
      return (await stat(join(this.o.directory, e.file))).size === e.size
    } catch {
      return false
    }
  }

  async list(): Promise<SpeechModelInfo[]> {
    return Promise.all(
      this.catalog.map(async (e) => {
        const d = this.downloads.get(e.id)
        const meta = DESCRIPTIONS[e.id] ?? { label: e.id, description: '' }
        return {
          id: e.id,
          label: meta.label,
          description: meta.description,
          sizeBytes: e.size,
          recommended: Boolean(meta.recommended),
          installed: await this.installed(e),
          download: d ? { received: d.received, total: d.total } : null,
          error: this.errors.get(e.id) ?? null
        }
      })
    )
  }

  /** Path of an installed model, or a clear error. */
  async require(id: string): Promise<string> {
    const e = this.entry(id)
    if (!(await this.installed(e))) {
      throw new UnavailableError(`The "${DESCRIPTIONS[id]?.label ?? id}" speech model isn't downloaded yet.`)
    }
    return join(this.o.directory, e.file)
  }

  /** Starts a download in the background. Progress arrives through `emit`. */
  download(id: string): void {
    const e = this.entry(id)
    if (this.downloads.has(id)) return
    const controller = new AbortController()
    this.downloads.set(id, { controller, received: 0, total: e.size })
    this.errors.delete(id)
    void this.publish()
    void this.run(e, controller).finally(() => {
      this.downloads.delete(id)
      void this.publish()
    })
  }

  cancel(id: string): void {
    this.downloads.get(id)?.controller.abort()
  }

  async remove(id: string): Promise<void> {
    if (this.downloads.has(id)) throw new ConflictError('Wait for the download to finish or cancel it first.')
    await rm(this.pathOf(id), { force: true })
    this.errors.delete(id)
    await this.publish()
  }

  cancelAll(): void {
    for (const d of this.downloads.values()) d.controller.abort()
  }

  private async run(e: CatalogEntry, controller: AbortController): Promise<void> {
    const url = `${this.o.baseUrl ?? sources.modelBaseUrl}/${e.file}`
    const final = join(this.o.directory, e.file)
    const part = `${final}.part`
    const state = this.downloads.get(e.id)!
    let lastPublish = 0
    try {
      await mkdir(this.o.directory, { recursive: true })
      const response = await (this.o.fetch ?? fetch)(url, { signal: controller.signal })
      if (!response.ok || !response.body) throw new Error(`The download server answered ${response.status}.`)
      const hash = createHash('sha256')
      const meter = new Transform({
        transform: (chunk: Buffer, _enc, done) => {
          hash.update(chunk)
          state.received += chunk.length
          if (Date.now() - lastPublish > 250) {
            lastPublish = Date.now()
            void this.publish()
          }
          done(null, chunk)
        }
      })
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), meter, createWriteStream(part), {
        signal: controller.signal
      })
      const digest = hash.digest('hex')
      if (digest !== e.sha256) throw new Error('The downloaded file is damaged (checksum mismatch). Please try again.')
      await rename(part, final)
      this.o.logger.info('Speech model installed', { id: e.id, bytes: state.received })
    } catch (error) {
      await rm(part, { force: true }).catch(() => undefined)
      if (controller.signal.aborted) {
        this.o.logger.info('Speech model download cancelled', { id: e.id })
        return
      }
      const message =
        error instanceof Error && /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(`${error.message} ${String((error as { cause?: unknown }).cause)}`)
          ? 'The download failed. Check the internet connection and try again.'
          : error instanceof Error
            ? error.message
            : String(error)
      this.errors.set(e.id, message)
      this.o.logger.warn('Speech model download failed', { id: e.id, error })
    }
  }

  private async publish(): Promise<void> {
    try {
      this.o.emit(await this.list())
    } catch (error) {
      this.o.logger.warn('Model event delivery failed', { error })
    }
  }
}
