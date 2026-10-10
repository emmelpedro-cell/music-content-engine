import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { synthTrack, wavBytes } from '../helpers/synth'
import { card, launchApp, makeDataDir, openLibrary, stubOpenDialog } from './helpers'

/**
 * Phase 2 acceptance: a song is analysed in the background (beats, bars,
 * waveform, energy), the beat markers can be inspected and corrected, lyrics
 * can be entered, checked and (on Windows, with the base model) transcribed,
 * hooks can be saved, and every manual decision survives a restart and a
 * re-analysis.
 */
test.describe.configure({ mode: 'serial' })

const dataDir = makeDataDir('workspace')
const mediaDir = join(dataDir, 'songs')
const songFile = join(mediaDir, 'Beat study 128.wav')
const speechFile = join(mediaDir, 'Fox speech.wav')
const baseModel = resolve('vendor', 'whisper-models', 'ggml-base.bin')
const canTranscribe = process.platform === 'win32' && existsSync(baseModel)

test.beforeAll(() => {
  mkdirSync(mediaDir, { recursive: true })
  const track = synthTrack({ bpm: 128, seconds: 24, offset: 0.5, sampleRate: 44100 })
  writeFileSync(songFile, wavBytes(track.samples, track.sampleRate))
  if (canTranscribe) {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${speechFile}'); $s.Speak('The quick brown fox jumps over the lazy dog. Every song has a story.'); $s.Dispose()`
    ])
    // As if the user had downloaded the model from the Lyrics tab.
    const models = join(dataDir, 'app-data', 'models')
    mkdirSync(models, { recursive: true })
    copyFileSync(baseModel, join(models, 'ggml-base.bin'))
  }
})

test.afterAll(() => {
  if (!process.env.MCE_E2E_DATA) rmSync(dataDir, { recursive: true, force: true })
})

async function importFiles(app: Parameters<typeof stubOpenDialog>[0], page: Page, files: string[]) {
  await openLibrary(page)
  await expect(page.getByTestId('import-files')).toBeEnabled({ timeout: 30_000 })
  await stubOpenDialog(app, files)
  await page.getByTestId('import-files').click()
  for (const f of files) {
    const name = f.split(/[\\/]/).pop()!
    await expect(card(page, name)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 })
  }
}

async function newSong(page: Page, title: string, audioFileName: string) {
  await page.getByRole('navigation').getByRole('button', { name: 'Home' }).click()
  await page.getByTestId('home-new-project').click()
  await page.getByTestId('new-project-title').fill(title)
  await page.getByTestId('new-project-submit').click()
  await expect(page.getByTestId('project-title')).toHaveText(title)
  const select = page.getByTestId('song-audio')
  const value = await select.locator('option', { hasText: audioFileName }).getAttribute('value')
  await select.selectOption(value!)
  await expect(page.getByTestId('transport')).toBeVisible()
}

async function openSong(page: Page, title: string) {
  await page.getByRole('navigation').getByRole('button', { name: 'Songs' }).click()
  await page.getByTestId('song-list').getByText(title, { exact: true }).click()
  await expect(page.getByTestId('project-title')).toHaveText(title)
}

const bpmOf = async (page: Page) => Number(await page.getByTestId('bpm').innerText())

/** Fraction of the timeline's waveform band that has been painted. */
async function paintedWaveform(page: Page): Promise<number> {
  return page.getByTestId('timeline').locator('canvas').evaluate((c: HTMLCanvasElement) => {
    const g = c.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    // The band just around the waveform's centre line.
    const y = Math.round((30 + 48) * dpr)
    const row = g.getImageData(0, y - 2, c.width, 5).data
    let lit = 0
    for (let x = 0; x < c.width; x++) {
      let max = 0
      for (let r = 0; r < 5; r++) max = Math.max(max, row[(r * c.width + x) * 4]!)
      if (max > 60) lit++
    }
    return lit / c.width
  })
}

test('analyses a song, shows its beats on the waveform and keeps corrections, lyrics and hooks', async () => {
  let { app, page } = await launchApp(dataDir)
  await importFiles(app, page, canTranscribe ? [songFile, speechFile] : [songFile])
  await newSong(page, 'Beat study', 'Beat study 128.wav')

  // Analysis runs in a worker thread; the tempo is found and the grid drawn.
  await page.getByTestId('tab-beats').click()
  await expect(page.getByTestId('bpm')).not.toHaveText('–', { timeout: 90_000 })
  expect(Math.abs((await bpmOf(page)) - 128)).toBeLessThan(1)
  await expect.poll(() => paintedWaveform(page), { timeout: 15_000 }).toBeGreaterThan(0.5)

  // Clicking the timeline moves the playhead.
  const timeline = page.getByTestId('timeline')
  const box = (await timeline.boundingBox())!
  await timeline.click({ position: { x: box.width / 2, y: 60 } })
  await expect(page.getByTestId('playhead-time')).not.toHaveText('0:00.00')

  // Correct the tempo: double time.
  await page.getByRole('button', { name: 'Double time' }).click()
  await expect.poll(() => bpmOf(page)).toBeGreaterThan(250)
  await expect(page.getByText('BPM (corrected)')).toBeVisible()

  // Lyrics typed in by hand, then checked.
  await page.getByTestId('tab-lyrics').click()
  await expect(page.getByTestId('lyrics-status')).toContainText('No lyrics')
  await page.getByTestId('paste-lyrics').click()
  await page.getByTestId('paste-text').fill('Rumelaj, rumelaj, vem\nDança comigo na luz')
  await page.getByTestId('paste-apply').click()
  await expect(page.getByTestId('word')).toHaveCount(7)
  await expect(page.getByTestId('lyrics-status')).toContainText('Draft')
  await page.getByTestId('confirm-lyrics').click()
  await expect(page.getByTestId('lyrics-status')).toContainText('Checked')

  // A hook from the playhead, snapped to bars.
  await page.getByTestId('tab-hooks').click()
  await page.getByTestId('hook-name').fill('Groove')
  await page.getByTestId('hook-preset-10').click()
  await expect(page.getByTestId('hook')).toHaveCount(1)
  await expect(page.getByTestId('tab-hooks')).toHaveText('Hooks (1)')
  await app.close()

  // After a restart everything is still there.
  ;({ app, page } = await launchApp(dataDir))
  await openSong(page, 'Beat study')
  await page.getByTestId('tab-beats').click()
  await expect.poll(() => bpmOf(page), { timeout: 30_000 }).toBeGreaterThan(250)
  await expect(page.getByText('BPM (corrected)')).toBeVisible()

  // Analysing again keeps the user's corrections.
  await page.getByRole('button', { name: 'Analyse again' }).click()
  await expect(page.getByTestId('analysis-status')).toHaveCount(0, { timeout: 90_000 })
  await expect.poll(() => bpmOf(page)).toBeGreaterThan(250)
  await page.getByRole('button', { name: 'As detected' }).click()
  await expect.poll(() => bpmOf(page)).toBeLessThan(130)

  await page.getByTestId('tab-lyrics').click()
  await expect(page.getByTestId('lyrics-status')).toContainText('Checked')
  await expect(page.getByTestId('word').first()).toHaveText('Rumelaj,')
  await page.getByTestId('tab-hooks').click()
  await expect(page.getByTestId('hook')).toHaveCount(1)
  await expect(page.getByTestId('hook').getByLabel('Hook name')).toHaveValue('Groove')
  await app.close()
})

test('transcribes sung or spoken words on this computer and leaves them as a draft', async () => {
  test.skip(!canTranscribe, 'Needs Windows and the base speech model (npm run fetch:whisper -- --model base).')
  const { app, page } = await launchApp(dataDir)
  await newSong(page, 'Fox speech', 'Fox speech.wav')
  await page.getByTestId('tab-lyrics').click()
  await expect(page.getByTestId('transcribe-box')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('model-select')).toHaveValue('base')
  await page.getByTestId('language-select').selectOption('en')
  await page.getByTestId('transcribe').click()

  await expect(page.getByTestId('word').filter({ hasText: /fox/i })).toHaveCount(1, { timeout: 180_000 })
  // A transcription is never treated as checked on its own.
  await expect(page.getByTestId('lyrics-status')).toContainText('Draft')
  const timed = await page.getByTestId('lyrics-status').innerText()
  expect(timed).toMatch(/(\d+) words · \1 timed/)
  await app.close()
})
