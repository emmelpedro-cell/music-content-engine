import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeSamples, waveformPeaks } from '../../src/main/analysis/analyze'
import { AnalysisService } from '../../src/main/analysis/service'
import { runMigrations } from '../../src/main/db/migrations'
import type { SqlDriver } from '../../src/main/db/driver'
import { AnalysisRepository } from '../../src/main/repositories/analysis'
import { MediaRepository } from '../../src/main/repositories/media'
import type { WorkspaceEvent } from '../../src/shared/workspace'
import { addReadyAsset } from '../helpers/assets'
import { testTools } from '../helpers/media'
import { createNodeSqliteDriver, memoryLogger, tempDir } from '../helpers/node-sqlite-driver'
import { synthTrack, wavBytes, beatRecall } from '../helpers/synth'

const tools = testTools()

describe.skipIf(!tools)('AnalysisService with real FFmpeg decoding', () => {
  const dir = tempDir('mce-analysis-')
  let db: SqlDriver
  let media: MediaRepository
  let repo: AnalysisRepository
  let events: WorkspaceEvent[]
  let service: AnalysisService
  let runs: number
  const track = synthTrack({ bpm: 124, seconds: 20, offset: 0.4 })
  const song = join(dir.path, 'song.wav')
  writeFileSync(song, wavBytes(track.samples, track.sampleRate))

  const make = () =>
    new AnalysisService({
      repo,
      media,
      getTools: async () => ({ ffmpeg: tools!.ffmpeg, ffprobe: tools!.ffprobe }),
      runner: async (input) => {
        runs++
        return { analysis: analyzeSamples(input, { beatsPerBar: input.beatsPerBar }), waveform: waveformPeaks(input) }
      },
      waveformsDirectory: join(dir.path, 'waveforms'),
      logger: memoryLogger(),
      emit: (e) => events.push(e)
    })

  beforeEach(() => {
    db = createNodeSqliteDriver()
    runMigrations(db)
    media = new MediaRepository(db)
    repo = new AnalysisRepository(db)
    events = []
    runs = 0
    rmSync(join(dir.path, 'waveforms'), { recursive: true, force: true })
    service = make()
  })
  afterEach(() => service.shutdown())
  afterAll(() => dir.cleanup())

  it('decodes the song, finds its beats and stores a waveform', async () => {
    const asset = await addReadyAsset(media, song, 'audio', 20)
    expect(['pending', 'processing']).toContain(service.ensure(asset.id)!.status)
    await service.waitForIdle()

    const state = service.state(asset.id)!
    expect(state.status).toBe('ready')
    expect(Math.abs(state.analysis!.bpm! - 124)).toBeLessThan(1)
    expect(beatRecall(track.beats, state.analysis!.beats)).toBeGreaterThanOrEqual(0.95)
    expect(state.analysis!.durationSeconds).toBeCloseTo(20, 1)

    const waveform = await service.waveform(asset.id)
    expect(waveform!.peaks.length).toBe(4000)
    expect(events.map((e) => e.type === 'analysis' && e.state.status)).toEqual(['pending', 'processing', 'ready'])
  })

  it('reuses a fresh analysis, and re-analyses when forced or when the file changed', async () => {
    const asset = await addReadyAsset(media, song, 'audio', 20)
    service.ensure(asset.id)
    await service.waitForIdle()
    service.ensure(asset.id)
    await service.waitForIdle()
    expect(runs).toBe(1)

    service.ensure(asset.id, { force: true })
    await service.waitForIdle()
    expect(runs).toBe(2)

    db.prepare('UPDATE media_assets SET content_hash = ? WHERE id = ?').run('qf1:changed', asset.id)
    service.ensure(asset.id)
    await service.waitForIdle()
    expect(runs).toBe(3)
  })

  it('records a clear error when the audio cannot be decoded', async () => {
    const broken = join(dir.path, 'broken.wav')
    writeFileSync(broken, 'not audio at all')
    const asset = await addReadyAsset(media, broken, 'audio', 3)
    service.ensure(asset.id)
    await service.waitForIdle()
    const state = service.state(asset.id)!
    expect(state.status).toBe('error')
    expect(state.error).toContain('could not be decoded')
  })

  it('resumes analysis interrupted by a crash', async () => {
    const asset = await addReadyAsset(media, song, 'audio', 20)
    repo.queue(asset.id, null, 1)
    repo.markProcessing(asset.id)
    service.start()
    await service.waitForIdle()
    expect(service.state(asset.id)!.status).toBe('ready')
  })

  it('refuses files that are still importing', async () => {
    const asset = media.insertPending({ path: song, pathKey: 'x', size: 1, mtimeMs: 0 })!
    expect(() => service.ensure(asset.id)).toThrow(/finished importing/)
  })

  it('keeps the last result when the file goes missing', async () => {
    const copy = join(dir.path, 'copy.wav')
    writeFileSync(copy, wavBytes(track.samples, track.sampleRate))
    const asset = await addReadyAsset(media, copy, 'audio', 20)
    service.ensure(asset.id)
    await service.waitForIdle()
    rmSync(copy)
    media.setAvailability(asset.id, 'missing')
    expect(service.ensure(asset.id, { force: true })!.status).toBe('ready')
    expect(existsSync(join(dir.path, 'waveforms', `${asset.id}.peaks`))).toBe(true)
  })
})
