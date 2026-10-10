import { expect, test } from '@playwright/test'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, makeDataDir } from './helpers'

/**
 * Phase 0 acceptance: the app launches, creates its database, and a project
 * saved in one session is still there after a restart.
 * Requires a build first (`npm run test:e2e` does both).
 */
const dataDir = makeDataDir('smoke')

test.afterAll(() => {
  if (!process.env.MCE_E2E_DATA) rmSync(dataDir, { recursive: true, force: true })
})

test('creates a project and finds it again after a restart', async () => {
  const title = `Smoke test ${Date.now()}`

  const first = await launchApp(dataDir)
  await expect(first.page.getByRole('heading', { name: 'One song, many videos.' })).toBeVisible()
  expect(existsSync(join(dataDir, 'app-data', 'database.sqlite'))).toBe(true)

  await first.page.getByTestId('home-new-project').click()
  await first.page.getByTestId('new-project-title').fill(title)
  await first.page.getByTestId('new-project-submit').click()
  await expect(first.page.getByTestId('project-title')).toHaveText(title)
  await first.app.close()

  const second = await launchApp(dataDir)
  await expect(second.page.getByTestId('recent-projects')).toContainText(title)
  await second.app.close()
})

test('the renderer has no access to Node or ipcRenderer', async () => {
  const { app, page } = await launchApp(dataDir)
  const exposure = await page.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>)['require'],
    process: typeof (globalThis as Record<string, unknown>)['process'],
    api: Object.keys(window.mce).sort()
  }))
  expect(exposure).toEqual({
    require: 'undefined',
    process: 'undefined',
    api: ['app', 'log', 'media', 'projects', 'settings', 'speech', 'workspace']
  })
  await app.close()
})

test('the media protocol only serves library assets', async () => {
  const { app, page } = await launchApp(dataDir)
  const statuses = await page.evaluate(async () => {
    const urls = [
      'mce-media://asset/00000000-0000-4000-8000-000000000000',
      'mce-media://asset/..%2F..%2Fapp-data%2Fdatabase.sqlite',
      'mce-media://file/C:/Windows/win.ini'
    ]
    return Promise.all(urls.map((u) => fetch(u).then((r) => r.status, () => 0)))
  })
  for (const status of statuses) expect(status === 0 || status >= 400).toBe(true)
  await app.close()
})
