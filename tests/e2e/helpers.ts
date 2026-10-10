import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A data folder for one test file. In CI (MCE_E2E_DATA set) it lives in the
 * workspace so the app's logs can be uploaded when a test fails.
 */
export function makeDataDir(name: string): string {
  const base = process.env.MCE_E2E_DATA
  if (base) {
    const dir = join(base, name)
    mkdirSync(dir, { recursive: true })
    return dir
  }
  return mkdtempSync(join(tmpdir(), `mce-e2e-${name}-`))
}

export async function launchApp(
  dataDir: string,
  options: { executablePath?: string } = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    ...(options.executablePath ? { executablePath: options.executablePath, args: [] } : { args: ['.'] }),
    env: { ...process.env, MCE_DATA_DIR: dataDir, NODE_ENV: 'test' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

/** Replaces the native open dialog with one that "selects" the given paths. */
export async function stubOpenDialog(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: selected })) as typeof dialog.showOpenDialog
  }, paths)
}

export async function openLibrary(page: Page): Promise<void> {
  await page.getByRole('navigation').getByRole('button', { name: 'Media Library' }).click()
}

export const card = (page: Page, fileName: string) => page.locator(`[data-testid="asset-card"][data-file-name="${fileName}"]`)
