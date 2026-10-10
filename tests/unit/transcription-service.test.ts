import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { runMigrations } from '../../src/main/db/migrations'
import type { SqlDriver } from '../../src/main/db/driver'
import { MediaRepository } from '../../src/main/repositories/media'
import { ProjectsRepository } from '../../src/main/repositories/projects'
import { WorkspaceRepository } from '../../src/main/repositories/workspace'
import { SpeechModels } from '../../src/main/transcription/models'
import { TranscriptionService } from '../../src/main/transcription/service'
import { resolveWhisper, verifyWhisper } from '../../src/main/transcription/whisper-binary'
import { UnavailableError } from '../../src/main/errors'
import { lineText, wordsOf } from '../../src/shared/lyrics'
import { CreateProjectInputSchema } from '../../src/shared/schemas'
import type { WorkspaceEvent } from '../../src/shared/workspace'
import { addReadyAsset } from '../helpers/assets'
import { testTools } from '../helpers/media'
import { createNodeSqliteDriver, memoryLogger, tempDir } from '../helpers/node-sqlite-driver'
import { synthTrack, wavBytes } from '../helpers/synth'

const tools = testTools()

function setup(dir: string, cli: string, modelsDir: string) {
  const db: SqlDriver = createNodeSqliteDriver()
  runMigrations(db)
  const media = new MediaRepository(db)
  const projects = new ProjectsRepository(db)
  const workspace = new WorkspaceRepository(db, memoryLogger())
  const events: WorkspaceEvent[] = []
  const service = new TranscriptionService({
    workspace,
    projects,
    media,
    models: new SpeechModels({ directory: modelsDir, logger: memoryLogger(), emit: () => {} }),
    getFfmpeg: async () => ({ ffmpeg: tools!.ffmpeg, ffprobe: tools!.ffprobe }),
    getWhisper: async () => cli,
    tempDirectory: join(dir, 'temp'),
    logger: memoryLogger(),
    emit: (e) => events.push(e),
    threads: 2
  })
  mkdirSync(join(dir, 'temp'), { recursive: true })
  return { db, media, projects, workspace, events, service }
}

/* ------------------------------------------------------------------ */
/* Pipeline test with a stand-in whisper CLI (POSIX only: a node script) */
/* ------------------------------------------------------------------ */

describe.skipIf(!tools || process.platform === 'win32')('TranscriptionService pipeline (stand-in transcriber)', () => {
  const dir = tempDir('mce-transcribe-')
  const cli = join(dir.path, 'fake-whisper')
  const modelsDir = join(dir.path, 'models')
  let ctx: ReturnType<typeof setup>
  let songId: string

  beforeAll(() => {
    // Mimics whisper-cli: reads -of, prints progress to stderr, writes <of>.json.
    writeFileSync(
      cli,
      `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args.includes('--help')) { console.error('usage: whisper-cli [options] file0 file1 ...'); process.exit(0) }
if (process.env.FAKE_WHISPER_FAIL) { console.error('error: failed to initialize whisper context'); process.exit(3) }
const of = args[args.indexOf('-of') + 1]
const wav = args[args.indexOf('-f') + 1]
if (!require('fs').existsSync(wav)) { console.error('error: input file not found'); process.exit(2) }
for (const p of [10, 50, 100]) process.stderr.write('whisper_print_progress_callback: progress = ' + p + '%\\n')
const seg = (text, from, to) => ({ offsets: { from, to }, text, tokens: [{ text, p: 0.9 }] })
const lang = args[args.indexOf('-l') + 1]
require('fs').writeFileSync(of + '.json', JSON.stringify({ result: { language: lang === 'auto' ? 'pt' : lang }, transcription: [seg(' Rumelaj', 500, 1200), seg(' rumelaj', 1300, 2000), seg('.', 2000, 2050), seg(' vem', 3500, 3900), seg(' dançar', 3900, 4600)] }))
`
    )
    chmodSync(cli, 0o755)
    mkdirSync(modelsDir, { recursive: true })
    // The catalog checks size only for "installed"; a placeholder of the right size stands in.
    writeFileSync(join(modelsDir, 'ggml-tiny.bin'), Buffer.alloc(77691713))
  })
  afterAll(() => dir.cleanup())

  beforeEach(async () => {
    ctx = setup(dir.path, cli, modelsDir)
    const track = synthTrack({ bpm: 120, seconds: 6 })
    const wav = join(dir.path, `song-${Date.now()}.wav`)
    writeFileSync(wav, wavBytes(track.samples, track.sampleRate))
    const audio = await addReadyAsset(ctx.media, wav, 'audio', 6)
    songId = ctx.projects.create(CreateProjectInputSchema.parse({ title: 'Rumelaj' })).id
    ctx.projects.setAudio(songId, audio.id)
  })
  afterEach(() => {
    ctx.service.shutdown()
    ctx.db.close()
    delete process.env.FAKE_WHISPER_FAIL
  })

  it('transcribes, reports progress, and stores timed lyrics', async () => {
    const pending = await ctx.service.transcribe({ songId, model: 'tiny', language: null })
    expect(['pending', 'processing']).toContain(pending.transcription.status)
    await ctx.service.waitForIdle()

    const state = ctx.service.lyrics(songId)
    expect(state.transcription).toMatchObject({ status: 'ready', model: 'tiny', error: null })
    expect(state).toMatchObject({ status: 'draft', source: 'transcription', language: 'pt' })
    expect(state.document.lines.map(lineText)).toEqual(['Rumelaj rumelaj.', 'vem dançar'])
    expect(wordsOf(state.document)[0]).toMatchObject({ start: 0.5, end: 1.2 })
    expect(state.original).toEqual(state.document)

    const statuses = ctx.events.map((e) => (e.type === 'lyrics' ? e.state.transcription.status : null))
    expect(statuses).toContain('processing')
    expect(statuses[statuses.length - 1]).toBe('ready')
    expect(readdirSync(join(dir.path, 'temp'))).toEqual([])
  })

  it('records a clear error when the transcriber fails', async () => {
    process.env.FAKE_WHISPER_FAIL = '1'
    await ctx.service.transcribe({ songId, model: 'tiny', language: 'pt' })
    await ctx.service.waitForIdle()
    const t = ctx.service.lyrics(songId).transcription
    expect(t.status).toBe('error')
    expect(t.error).toContain('failed to initialize whisper context')
  })

  it('checks requirements before queueing', async () => {
    await expect(ctx.service.transcribe({ songId, model: 'base', language: null })).rejects.toThrow(UnavailableError)
    const noAudio = ctx.projects.create(CreateProjectInputSchema.parse({ title: 'Empty' })).id
    await expect(ctx.service.transcribe({ songId: noAudio, model: 'tiny', language: null })).rejects.toThrow(/audio/)
  })

  it('can be cancelled', async () => {
    await ctx.service.transcribe({ songId, model: 'tiny', language: null })
    ctx.service.cancel(songId)
    await ctx.service.waitForIdle()
    expect(ctx.service.lyrics(songId).transcription.status).toBe('none')
  })

  it('verifies the transcriber binary', async () => {
    const status = await verifyWhisper({ source: 'environment', directory: dir.path, cli })
    expect(status.ok).toBe(true)
    const missing = await verifyWhisper({ source: 'packaged', directory: dir.path, cli: join(dir.path, 'nope') })
    expect(missing).toMatchObject({ ok: false, code: 'MISSING' })
  })
})

/* ------------------------------------------------------------------ */
/* Real whisper.cpp on real speech (Windows; required in CI)          */
/* ------------------------------------------------------------------ */

const whisper = resolveWhisper({ isPackaged: false, appPath: process.cwd(), resourcesPath: '', platform: process.platform, arch: process.arch, env: process.env })
const realModel = resolve('vendor', 'whisper-models', 'ggml-base.bin')
const realAvailable = process.platform === 'win32' && existsSync(whisper.cli) && existsSync(realModel)
if (process.platform === 'win32' && process.env.CI && !realAvailable) {
  throw new Error('CI must run the real transcription test: run "npm run fetch:whisper" and "node scripts/fetch-whisper.mjs --model base".')
}

describe.skipIf(!tools || !realAvailable)('whisper.cpp on real speech (Windows)', () => {
  const dir = tempDir('mce-whisper-real-')
  afterAll(() => dir.cleanup())

  it('transcribes spoken words with word timestamps', async () => {
    const status = await verifyWhisper(whisper)
    expect(status.ok).toBe(true)

    // Real speech from the Windows speech synthesizer.
    const speech = join(dir.path, 'speech.wav')
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${speech}'); $s.Speak('The quick brown fox jumps over the lazy dog. Every song has a story.'); $s.Dispose()`
    ])

    // The models folder is the project's vendor/whisper-models (same file names as the catalog).
    const ctx = setup(dir.path, whisper.cli, dirname(realModel))
    const audio = await addReadyAsset(ctx.media, speech, 'audio', 5)
    const songId = ctx.projects.create(CreateProjectInputSchema.parse({ title: 'Speech' })).id
    ctx.projects.setAudio(songId, audio.id)

    await ctx.service.transcribe({ songId, model: 'base', language: 'en' })
    await ctx.service.waitForIdle()
    const state = ctx.service.lyrics(songId)
    expect(state.transcription.error).toBeNull()
    expect(state.transcription.status).toBe('ready')
    const words = wordsOf(state.document)
    const text = words.map((w) => w.text.toLowerCase().replace(/[^a-z]/g, '')).join(' ')
    for (const expected of ['quick', 'brown', 'fox', 'lazy', 'dog', 'song', 'story']) expect(text).toContain(expected)
    // Timestamps are real and in order.
    const starts = words.map((w) => w.start!)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(starts[0]!).toBeLessThan(1.5)
    expect(starts[starts.length - 1]!).toBeGreaterThan(2)
    ctx.service.shutdown()
    ctx.db.close()
  })
})
