import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SpeechModels, type CatalogEntry } from '../../src/main/transcription/models'
import { UnavailableError } from '../../src/main/errors'
import type { SpeechModelInfo } from '../../src/shared/workspace'
import { memoryLogger, tempDir } from '../helpers/node-sqlite-driver'

const dirs: { cleanup: () => void }[] = []
afterEach(() => dirs.splice(0).forEach((d) => d.cleanup()))

const content = Buffer.alloc(300_000, 7)
const sha = createHash('sha256').update(content).digest('hex')
const catalog: CatalogEntry[] = [{ id: 'base', file: 'ggml-base.bin', size: content.length, sha256: sha }]

function setup(body: () => Uint8Array | Promise<never>, status = 200) {
  const dir = tempDir('mce-models-')
  dirs.push(dir)
  const published: SpeechModelInfo[][] = []
  const requested: string[] = []
  const models = new SpeechModels({
    directory: join(dir.path, 'models'),
    logger: memoryLogger(),
    emit: (m) => published.push(m),
    catalog,
    baseUrl: 'https://models.example',
    fetch: async (url, init) => {
      requested.push(url)
      const bytes = await body()
      // Stream in chunks, honouring abort.
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          for (let i = 0; i < bytes.length; i += 65536) {
            if (init.signal.aborted) return controller.error(new DOMException('aborted', 'AbortError'))
            controller.enqueue(bytes.subarray(i, i + 65536))
            await new Promise((r) => setTimeout(r, 2))
          }
          controller.close()
        }
      })
      return new Response(stream, { status })
    }
  })
  const until = async (fn: () => Promise<boolean>) => {
    for (let i = 0; i < 500 && !(await fn()); i++) await new Promise((r) => setTimeout(r, 5))
  }
  return { dir, models, published, requested, until }
}

describe('SpeechModels', () => {
  it('downloads, verifies and installs a model, reporting progress', async () => {
    const { models, published, requested, until, dir } = setup(() => content)
    expect((await models.list())[0]).toMatchObject({ id: 'base', installed: false, recommended: false })
    await expect(models.require('base')).rejects.toThrow(UnavailableError)

    models.download('base')
    await until(async () => (await models.list())[0]!.installed)
    expect(requested).toEqual(['https://models.example/ggml-base.bin'])
    expect(await models.require('base')).toBe(join(dir.path, 'models', 'ggml-base.bin'))
    expect(published.some((p) => p[0]!.download !== null)).toBe(true)
    expect(readdirSync(join(dir.path, 'models'))).toEqual(['ggml-base.bin'])
  })

  it('rejects a corrupted download and leaves nothing behind', async () => {
    const { models, until, dir } = setup(() => Buffer.alloc(content.length, 9))
    models.download('base')
    await until(async () => (await models.list())[0]!.error !== null)
    const info = (await models.list())[0]!
    expect(info.installed).toBe(false)
    expect(info.error).toContain('checksum')
    expect(readdirSync(join(dir.path, 'models'))).toEqual([])
  })

  it('reports server errors', async () => {
    const { models, until } = setup(() => content, 404)
    models.download('base')
    await until(async () => (await models.list())[0]!.error !== null)
    expect((await models.list())[0]!.error).toContain('404')
  })

  it('can cancel a download and delete an installed model', async () => {
    const { models, until, dir } = setup(() => content)
    models.download('base')
    models.cancel('base')
    await until(async () => (await models.list())[0]!.download === null)
    expect((await models.list())[0]).toMatchObject({ installed: false, error: null })
    expect(existsSync(join(dir.path, 'models', 'ggml-base.bin.part'))).toBe(false)

    writeFileSync(join(dir.path, 'models', 'ggml-base.bin'), content)
    expect((await models.list())[0]!.installed).toBe(true)
    await models.remove('base')
    expect((await models.list())[0]!.installed).toBe(false)
  })

  it('ships a pinned catalog with the recommended model for singing', async () => {
    const dir = tempDir('mce-models-')
    dirs.push(dir)
    const list = await new SpeechModels({ directory: dir.path, logger: memoryLogger(), emit: () => {} }).list()
    expect(list.map((m) => m.id)).toContain('large-v3-turbo-q5_0')
    expect(list.find((m) => m.recommended)?.id).toBe('large-v3-turbo-q5_0')
  })
})
