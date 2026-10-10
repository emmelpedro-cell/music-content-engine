import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createFixtures, testTools } from '../helpers/media'
import { synthTrack, wavBytes } from '../helpers/synth'
import { card, launchApp, makeDataDir, openLibrary, stubOpenDialog } from '../e2e/helpers'

/**
 * Runs against the unpacked Windows build produced by `npm run dist:win`,
 * proving that FFmpeg is bundled, found and working in the installed layout.
 */
const exe = resolve(process.env.MCE_PACKAGED_EXE ?? join('dist', 'win-unpacked', 'Music Content Engine.exe'))
const ffmpegDir = join(dirname(exe), 'resources', 'ffmpeg')
const whisperDir = join(dirname(exe), 'resources', 'whisper')

// Locally a missing build just skips; in CI it must fail, so a green run proves the packaged app was tested.
if (process.env.CI && !existsSync(exe)) throw new Error(`Packaged app not found at ${exe}.`)
test.skip(!existsSync(exe), `Packaged app not found at ${exe}. Run "npm run dist:win" first.`)

const dataDir = makeDataDir('packaged')

test.afterAll(() => {
  if (!process.env.MCE_E2E_DATA) rmSync(dataDir, { recursive: true, force: true })
})

test('ships FFmpeg with its license notices and without ffplay', () => {
  for (const file of ['bin/ffmpeg.exe', 'bin/ffprobe.exe', 'LICENSE.txt', 'COPYING.GPLv3', 'FFMPEG-LICENSE.md', 'NOTICE.txt', 'manifest.json']) {
    expect(existsSync(join(ffmpegDir, file)), file).toBe(true)
  }
  expect(existsSync(join(ffmpegDir, 'bin', 'ffplay.exe'))).toBe(false)
  const manifest = JSON.parse(readFileSync(join(ffmpegDir, 'manifest.json'), 'utf8')) as { license: string }
  expect(manifest.license).toBe('LGPL-3.0-or-later')
  expect(readFileSync(join(ffmpegDir, 'LICENSE.txt'), 'utf8')).toContain('GNU LESSER GENERAL PUBLIC LICENSE')

  // The bundled build reports an LGPL configuration (no --enable-gpl / --enable-nonfree).
  const version = execFileSync(join(ffmpegDir, 'bin', 'ffmpeg.exe'), ['-hide_banner', '-version'], { encoding: 'utf8' })
  expect(version).not.toContain('--enable-gpl')
  expect(version).not.toContain('--enable-nonfree')
  expect(version).toContain('--enable-version3')
})

test('the installed app finds and verifies its bundled FFmpeg, and imports a video', async () => {
  const { app, page } = await launchApp(dataDir, { executablePath: exe })
  const status = await page.evaluate(() => window.mce.media.toolsStatus())
  expect(status.ok).toBe(true)
  if (!status.ok || !status.data.ok) throw new Error(JSON.stringify(status))
  expect(status.data.source).toBe('packaged')
  expect(status.data.directory.toLowerCase()).toBe(ffmpegDir.toLowerCase())
  expect(status.data.license).toBe('LGPL-3.0-or-later')

  const tools = testTools()
  if (!tools) throw new Error('FFmpeg is required to create test media.')
  const fx = createFixtures(tools, join(dataDir, 'fixtures'))
  const clip = join(dataDir, 'footage', 'Packaged test.mp4')
  mkdirSync(dirname(clip), { recursive: true })
  copyFileSync(fx.mp4, clip)

  await openLibrary(page)
  await expect(page.getByTestId('import-files')).toBeEnabled()
  await stubOpenDialog(app, [clip])
  await page.getByTestId('import-files').click()
  await expect(card(page, 'Packaged test.mp4')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 })
  await expect(card(page, 'Packaged test.mp4').getByTestId('asset-meta')).toHaveText('0:02 · 320×240 · 30 fps')
  const img = card(page, 'Packaged test.mp4').getByTestId('asset-thumb')
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(480)
  await app.close()
})

test('ships whisper.cpp with its licenses and nothing else', () => {
  expect(readdirSync(whisperDir).sort()).toEqual(['LICENSE-whisper-models.txt', 'LICENSE-whisper.cpp.txt', 'NOTICE.txt', 'bin', 'manifest.json'])
  // Only the command-line transcriber and its libraries: no demo tools, no SDL2.
  const files = readdirSync(join(whisperDir, 'bin')).sort()
  expect(files).toEqual(['ggml-base.dll', 'ggml-cpu.dll', 'ggml.dll', 'whisper-cli.exe', 'whisper.dll'])
  const manifest = JSON.parse(readFileSync(join(whisperDir, 'manifest.json'), 'utf8')) as { license: string }
  expect(manifest.license).toBe('MIT')
  // No speech model is bundled; they are downloaded on request.
  expect(files.some((f) => f.endsWith('.bin'))).toBe(false)
})

test('the installed app runs speech tools and analyses a song in its worker', async () => {
  const song = join(dataDir, 'songs', 'Packaged beat.wav')
  mkdirSync(dirname(song), { recursive: true })
  const track = synthTrack({ bpm: 120, seconds: 16, offset: 0.5 })
  writeFileSync(song, wavBytes(track.samples, track.sampleRate))

  const { app, page } = await launchApp(dataDir, { executablePath: exe })
  const speech = await page.evaluate(() => window.mce.speech.status())
  if (!speech.ok || !speech.data.ok) throw new Error(JSON.stringify(speech))
  expect(speech.data.directory.toLowerCase()).toBe(whisperDir.toLowerCase())

  await openLibrary(page)
  await expect(page.getByTestId('import-files')).toBeEnabled()
  await stubOpenDialog(app, [song])
  await page.getByTestId('import-files').click()
  await expect(card(page, 'Packaged beat.wav')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 })

  const songId = await page.evaluate(async () => {
    const assets = await window.mce.media.list()
    if (!assets.ok) throw new Error(assets.error.message)
    const audio = assets.data.find((a) => a.fileName === 'Packaged beat.wav')!
    const project = await window.mce.projects.create({ title: 'Packaged song' })
    if (!project.ok) throw new Error(project.error.message)
    const set = await window.mce.projects.setAudio(project.data.id, audio.id)
    if (!set.ok) throw new Error(set.error.message)
    return project.data.id
  })
  const bpm = async () => {
    const ws = await page.evaluate((id) => window.mce.workspace.get(id), songId)
    if (!ws.ok) throw new Error(ws.error.message)
    if (ws.data.analysis?.status === 'error') throw new Error(ws.data.analysis.error ?? 'analysis failed')
    return ws.data.beatMap?.bpm ?? 0
  }
  await expect.poll(bpm, { timeout: 90_000 }).toBeGreaterThan(119)
  expect(await bpm()).toBeLessThan(121)
  await app.close()
})
