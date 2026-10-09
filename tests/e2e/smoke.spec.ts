import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Phase 0 acceptance: the app launches, creates its database, and a project
 * saved in one session is still there after a restart.
 * Requires a build first (`npm run test:e2e` does both).
 */
const dataDir = mkdtempSync(join(tmpdir(), 'mce-e2e-'))

async function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: { ...process.env, MCE_DATA_DIR: dataDir, NODE_ENV: 'test' }
  })
}

test.afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

test('creates a project and finds it again after a restart', async () => {
  const title = `Smoke test ${Date.now()}`

  const first = await launch()
  const window = await first.firstWindow()
  await expect(window.getByRole('heading', { name: 'One song, many videos.' })).toBeVisible()
  expect(existsSync(join(dataDir, 'app-data', 'database.sqlite'))).toBe(true)

  await window.getByTestId('home-new-project').click()
  await window.getByTestId('new-project-title').fill(title)
  await window.getByTestId('new-project-submit').click()
  await expect(window.getByTestId('project-title')).toHaveText(title)
  await first.close()

  const second = await launch()
  const again = await second.firstWindow()
  await expect(again.getByTestId('recent-projects')).toContainText(title)
  await second.close()
})

test('the renderer has no access to Node or ipcRenderer', async () => {
  const app = await launch()
  const window = await app.firstWindow()
  const exposure = await window.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>)['require'],
    process: typeof (globalThis as Record<string, unknown>)['process'],
    api: Object.keys((window as unknown as { mce: object }).mce).sort()
  }))
  expect(exposure).toEqual({ require: 'undefined', process: 'undefined', api: ['app', 'log', 'projects', 'settings'] })
  await app.close()
})
