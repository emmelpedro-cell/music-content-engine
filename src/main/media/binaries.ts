import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { MediaToolsSource, MediaToolsStatus } from '../../shared/media'
import { ProcessError, runProcess } from './run-process'

export type MediaToolsLocation = {
  source: MediaToolsSource
  /** Folder containing bin/ (and LICENSE.txt, NOTICE.txt, manifest.json). */
  directory: string
  ffmpeg: string
  ffprobe: string
}

/**
 * Where the bundled FFmpeg lives. The system PATH is never consulted.
 *
 * - MCE_FFMPEG_DIR (tests, troubleshooting) wins.
 * - Packaged app: <resources>/ffmpeg, copied there by electron-builder (extraResources).
 * - Development: <project>/vendor/ffmpeg/<platform>-<arch>, installed by scripts/fetch-ffmpeg.mjs.
 */
export function resolveMediaTools(options: {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
  platform: NodeJS.Platform
  arch: string
  env: NodeJS.ProcessEnv
}): MediaToolsLocation {
  const exe = options.platform === 'win32' ? '.exe' : ''
  const fromEnv = options.env.MCE_FFMPEG_DIR?.trim()

  let source: MediaToolsSource
  let directory: string
  if (fromEnv) {
    source = 'environment'
    directory = resolve(fromEnv)
  } else if (options.isPackaged) {
    source = 'packaged'
    directory = join(options.resourcesPath, 'ffmpeg')
  } else {
    source = 'development'
    directory = join(options.appPath, 'vendor', 'ffmpeg', `${options.platform}-${options.arch}`)
  }

  return {
    source,
    directory,
    ffmpeg: join(directory, 'bin', `ffmpeg${exe}`),
    ffprobe: join(directory, 'bin', `ffprobe${exe}`)
  }
}

function missingMessage(source: MediaToolsSource, directory: string): string {
  switch (source) {
    case 'development':
      return 'FFmpeg is not installed for development. Run "npm run fetch:ffmpeg" in the project folder, then click Check again.'
    case 'environment':
      return `FFmpeg was not found in the folder set by MCE_FFMPEG_DIR (${directory}). Fix or remove that variable and restart the app.`
    case 'packaged':
      return 'FFmpeg is missing from this installation. Reinstall Music Content Engine. If it disappears again, check whether antivirus software quarantined files in the "resources\\ffmpeg" folder.'
  }
}

function failedMessage(source: MediaToolsSource): string {
  return source === 'packaged'
    ? 'FFmpeg is installed but could not start. Antivirus software may have blocked it: check its quarantine or exclusions, then reinstall Music Content Engine if needed.'
    : 'FFmpeg was found but could not start. Run "npm run fetch:ffmpeg -- --force" to reinstall it, then click Check again.'
}

const VERSION_PATTERN = /^ff(?:mpeg|probe) version (\S+)/m

async function checkBinary(path: string): Promise<{ ok: true; version: string } | { ok: false; missing: boolean; detail: string }> {
  try {
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return { ok: false, missing: code === 'ENOENT', detail: `${path}: ${code ?? String(error)}` }
  }
  try {
    const { stdout } = await runProcess(path, ['-hide_banner', '-version'], { timeoutMs: 20_000 })
    const version = VERSION_PATTERN.exec(stdout)?.[1]
    if (!version) return { ok: false, missing: false, detail: `${path}: unexpected -version output` }
    return { ok: true, version }
  } catch (error) {
    const detail =
      error instanceof ProcessError
        ? `${path}: ${error.message}${error.stderrSummary ? ` — ${error.stderrSummary}` : ''}`
        : `${path}: ${String(error)}`
    return { ok: false, missing: false, detail }
  }
}

/** Checks that both programs exist and actually run. */
export async function verifyMediaTools(location: MediaToolsLocation): Promise<MediaToolsStatus> {
  const [ffmpeg, ffprobe] = await Promise.all([checkBinary(location.ffmpeg), checkBinary(location.ffprobe)])
  const base = { source: location.source, directory: location.directory }

  if (!ffmpeg.ok || !ffprobe.ok) {
    const failures = [ffmpeg, ffprobe].filter((r): r is Extract<typeof r, { ok: false }> => !r.ok)
    const missing = failures.some((f) => f.missing)
    return {
      ...base,
      ok: false,
      code: missing ? 'MISSING' : 'FAILED',
      message: missing ? missingMessage(location.source, location.directory) : failedMessage(location.source),
      detail: failures.map((f) => f.detail).join('\n')
    }
  }

  let license: string | null = null
  let build: string | null = null
  try {
    const manifest = JSON.parse(await readFile(join(location.directory, 'manifest.json'), 'utf8')) as {
      license?: unknown
      publisher?: unknown
      releaseTag?: unknown
    }
    if (typeof manifest.license === 'string') license = manifest.license
    if (typeof manifest.publisher === 'string' && typeof manifest.releaseTag === 'string') {
      build = `${manifest.publisher} ${manifest.releaseTag}`
    }
  } catch {
    // A custom MCE_FFMPEG_DIR may have no manifest; that's fine.
  }

  return { ...base, ok: true, ffmpegVersion: ffmpeg.version, ffprobeVersion: ffprobe.version, license, build }
}

/** Ready-to-run paths, available only once verification succeeded. */
export type MediaTools = { ffmpeg: string; ffprobe: string }
