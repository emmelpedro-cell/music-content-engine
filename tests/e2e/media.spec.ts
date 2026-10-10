import { expect, test, type Page } from '@playwright/test'
import { copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createFixtures, testTools, type Fixtures } from '../helpers/media'
import { card, launchApp, makeDataDir, openLibrary, stubOpenDialog } from './helpers'

/**
 * Phase 1 acceptance: a real audio file and a real video file are imported
 * through the UI, their metadata is shown, the video gets a thumbnail and
 * plays in the preview, and everything is still there after a restart.
 */
test.describe.configure({ mode: 'serial' })

const dataDir = makeDataDir('media')
const mediaDir = join(dataDir, 'my-footage')
let fx: Fixtures
let song: string
let take: string

test.beforeAll(() => {
  const tools = testTools()
  if (!tools) throw new Error('FFmpeg is required for the E2E tests. Run "npm run fetch:ffmpeg".')
  fx = createFixtures(tools, join(dataDir, 'fixtures'))
  mkdirSync(mediaDir, { recursive: true })
  song = join(mediaDir, 'Rumelaj master.wav')
  take = join(mediaDir, 'Erhu take 1.mp4')
  copyFileSync(fx.wav, song)
  copyFileSync(fx.mp4, take)
})

test.afterAll(() => {
  if (!process.env.MCE_E2E_DATA) rmSync(dataDir, { recursive: true, force: true })
})

async function expectThumbnailLoaded(page: Page, fileName: string) {
  const img = card(page, fileName).getByTestId('asset-thumb')
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(480)
}

test('imports real audio and video, shows metadata, thumbnail and preview, and keeps them after a restart', async () => {
  let { app, page } = await launchApp(dataDir)
  await openLibrary(page)
  await expect(page.getByTestId('library-empty')).toBeVisible()
  await expect(page.getByTestId('import-files')).toBeEnabled({ timeout: 30_000 })

  await stubOpenDialog(app, [song, take])
  await page.getByTestId('import-files').click()

  const audioCard = card(page, 'Rumelaj master.wav')
  const videoCard = card(page, 'Erhu take 1.mp4')
  await expect(audioCard).toHaveAttribute('data-state', 'ready', { timeout: 60_000 })
  await expect(videoCard).toHaveAttribute('data-state', 'ready', { timeout: 60_000 })

  // Metadata from FFprobe.
  await expect(audioCard.getByTestId('asset-meta')).toHaveText('0:03 · 48 kHz · stereo')
  await expect(videoCard.getByTestId('asset-meta')).toHaveText('0:02 · 320×240 · 30 fps')
  await expectThumbnailLoaded(page, 'Erhu take 1.mp4')

  // Details and preview: the video is streamed through mce-media:// and decoded by Electron.
  await videoCard.click()
  const facts = page.getByTestId('asset-facts')
  await expect(facts).toContainText('320 × 240')
  await expect(facts).toContainText('h264')
  await expect(facts).toContainText(take)
  const video = page.getByTestId('preview-video')
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(1)
  expect(await video.evaluate((el: HTMLVideoElement) => Math.round(el.duration))).toBe(2)
  expect(await video.evaluate((el: HTMLVideoElement) => [el.videoWidth, el.videoHeight])).toEqual([320, 240])

  await audioCard.click()
  const audio = page.getByTestId('preview-audio')
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(1)

  await app.close()

  // Restart: everything is still there, ready, with its thumbnail.
  ;({ app, page } = await launchApp(dataDir))
  await openLibrary(page)
  await expect(card(page, 'Rumelaj master.wav')).toHaveAttribute('data-state', 'ready')
  await expect(card(page, 'Erhu take 1.mp4')).toHaveAttribute('data-state', 'ready')
  await expect(card(page, 'Erhu take 1.mp4').getByTestId('asset-meta')).toHaveText('0:02 · 320×240 · 30 fps')
  await expectThumbnailLoaded(page, 'Erhu take 1.mp4')

  // Importing the same files again adds nothing.
  await stubOpenDialog(app, [song, take])
  await page.getByTestId('import-files').click()
  await expect(page.getByRole('status').filter({ hasText: 'already in the library' })).toBeVisible()
  await expect(page.getByTestId('asset-card')).toHaveCount(2)
  await app.close()
})

test('uses an imported audio file as a song’s audio', async () => {
  const { app, page } = await launchApp(dataDir)
  await page.getByTestId('home-new-project').click()
  await page.getByTestId('new-project-title').fill('Rumelaj (Trance)')
  await page.getByTestId('new-project-submit').click()
  const select = page.getByTestId('song-audio')
  await select.selectOption({ label: 'Rumelaj master.wav (0:03)' })
  await expect(select).toHaveValue(/[0-9a-f-]{36}/)
  await app.close()
})

test('flags a moved file as missing and relinks it', async () => {
  const movedDir = join(mediaDir, 'moved')
  mkdirSync(movedDir, { recursive: true })
  const movedTake = join(movedDir, 'Erhu take 1.mp4')
  renameSync(take, movedTake)

  const { app, page } = await launchApp(dataDir)
  await openLibrary(page)
  const videoCard = card(page, 'Erhu take 1.mp4')
  await expect(videoCard).toHaveAttribute('data-state', 'missing', { timeout: 20_000 })
  await expect(page.getByTestId('missing-banner')).toBeVisible()
  // Metadata and thumbnail are kept while the file is missing.
  await expect(videoCard.getByTestId('asset-meta')).toHaveText('0:02 · 320×240 · 30 fps')

  await videoCard.click()
  await stubOpenDialog(app, [movedTake])
  await page.getByTestId('relink').click()
  await expect(videoCard).toHaveAttribute('data-state', 'ready')
  await expect(page.getByTestId('missing-banner')).toHaveCount(0)
  await expect(page.getByTestId('asset-facts')).toContainText(movedTake)
  await app.close()
})

test('imports files handed over the drag-and-drop path and reports invalid media clearly', async () => {
  const mov = join(mediaDir, 'Studio b-roll.mov')
  const broken = join(mediaDir, 'export-broken.mp4')
  copyFileSync(fx.mov, mov)
  copyFileSync(fx.corrupt, broken)

  const { app, page } = await launchApp(dataDir)
  await openLibrary(page)
  await expect(page.getByTestId('import-files')).toBeEnabled({ timeout: 30_000 })

  // Real File objects, as a drop would produce; the preload resolves their paths.
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.id = 'e2e-files'
    input.style.display = 'none'
    document.body.append(input)
  })
  await page.setInputFiles('#e2e-files', [mov, broken])
  const result = await page.evaluate(async () => {
    const input = document.getElementById('e2e-files') as HTMLInputElement
    return window.mce.media.importDropped(Array.from(input.files ?? []))
  })
  expect(result).toMatchObject({ ok: true, data: { queued: 2 } })

  await expect(card(page, 'Studio b-roll.mov')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 })
  await expect(card(page, 'Studio b-roll.mov').getByTestId('asset-meta')).toHaveText('0:02 · 640×360 · 25 fps')

  const brokenCard = card(page, 'export-broken.mp4')
  await expect(brokenCard).toHaveAttribute('data-state', 'error', { timeout: 60_000 })
  await expect(brokenCard.getByTestId('asset-meta')).toContainText("isn't a readable audio or video file")

  // The renderer can't smuggle in arbitrary paths: plain strings are rejected.
  const forged = await page.evaluate(() =>
    window.mce.media.importDropped([new File(['x'], 'C:\\Windows\\win.ini')])
  )
  expect(forged.ok).toBe(false)
  await app.close()
})
