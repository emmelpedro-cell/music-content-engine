import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { SpeechToolsStatus } from '../../shared/workspace'
import { UnavailableError } from '../errors'
import type { Logger } from '../logger'
import { ProcessError, runProcess } from '../media/run-process'

export type WhisperLocation = { directory: string; cli: string; source: 'packaged' | 'development' | 'environment' }

/** Same rules as FFmpeg: MCE_WHISPER_DIR, then resources/whisper, then vendor/whisper/<platform>-<arch>. */
export function resolveWhisper(options: {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
  platform: NodeJS.Platform
  arch: string
  env: NodeJS.ProcessEnv
}): WhisperLocation {
  const exe = options.platform === 'win32' ? '.exe' : ''
  const fromEnv = options.env.MCE_WHISPER_DIR?.trim()
  const [source, directory]: [WhisperLocation['source'], string] = fromEnv
    ? ['environment', resolve(fromEnv)]
    : options.isPackaged
      ? ['packaged', join(options.resourcesPath, 'whisper')]
      : ['development', join(options.appPath, 'vendor', 'whisper', `${options.platform}-${options.arch}`)]
  return { source, directory, cli: join(directory, 'bin', `whisper-cli${exe}`) }
}

/** Windows NTSTATUS for "a required DLL was not found" (as an unsigned exit code). */
const STATUS_DLL_NOT_FOUND = 0xc0000135
const STATUS_ENTRYPOINT_NOT_FOUND = 0xc0000139
export const VC_REDIST_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'

export async function verifyWhisper(location: WhisperLocation, platform: NodeJS.Platform = process.platform): Promise<SpeechToolsStatus> {
  try {
    await access(location.cli, platform === 'win32' ? constants.F_OK : constants.X_OK)
  } catch {
    if (location.source === 'development' && platform !== 'win32') {
      return {
        ok: false,
        code: 'UNSUPPORTED',
        message: 'Transcription is available in the Windows app. On this system you can import lyrics files or type them.',
        detail: `${location.cli} not found`
      }
    }
    return {
      ok: false,
      code: 'MISSING',
      message:
        location.source === 'development'
          ? 'The transcriber (whisper.cpp) is not installed for development. Run "npm run fetch:whisper", then check again.'
          : 'The transcriber is missing from this installation. Reinstall Music Content Engine.',
      detail: `${location.cli} not found`
    }
  }

  let output = ''
  try {
    const result = await runProcess(location.cli, ['--help'], { timeoutMs: 20_000 })
    output = result.stdout + result.stderr
  } catch (error) {
    const exit = error instanceof ProcessError ? error.details.exitCode : null
    const unsigned = typeof exit === 'number' ? exit >>> 0 : null
    if (unsigned === STATUS_DLL_NOT_FOUND || unsigned === STATUS_ENTRYPOINT_NOT_FOUND) {
      return {
        ok: false,
        code: 'RUNTIME_MISSING',
        message: `Transcription needs the Microsoft Visual C++ Redistributable (x64), which isn't installed on this computer. Install it from ${VC_REDIST_URL}, then check again.`,
        detail: `whisper-cli exited with 0x${unsigned.toString(16)} (a required DLL was not found)`
      }
    }
    if (error instanceof ProcessError && error.code === 'EXIT' && /usage/i.test(error.details.stderr ?? '')) {
      output = error.details.stderr ?? ''
    } else {
      return {
        ok: false,
        code: 'FAILED',
        message: 'The transcriber is installed but could not start. Antivirus software may have blocked it; reinstalling may help.',
        detail: error instanceof Error ? error.message : String(error)
      }
    }
  }
  if (!/usage/i.test(output)) {
    return { ok: false, code: 'FAILED', message: 'The transcriber answered unexpectedly. Reinstalling may help.', detail: output.slice(0, 500) }
  }
  let version = 'unknown'
  try {
    version = (JSON.parse(await readFile(join(location.directory, 'manifest.json'), 'utf8')) as { version?: string }).version ?? version
  } catch {
    // no manifest (custom MCE_WHISPER_DIR)
  }
  return { ok: true, version, directory: location.directory }
}

export class WhisperManager {
  private pending: Promise<SpeechToolsStatus> | null = null
  constructor(
    readonly location: WhisperLocation,
    private readonly logger: Logger
  ) {}

  status(): Promise<SpeechToolsStatus> {
    this.pending ??= verifyWhisper(this.location).then((status) => {
      if (status.ok) this.logger.info('Transcriber ready', { version: status.version, directory: status.directory })
      else this.logger.warn('Transcriber unavailable', { code: status.code, detail: status.detail })
      return status
    })
    return this.pending
  }

  recheck(): Promise<SpeechToolsStatus> {
    this.pending = null
    return this.status()
  }

  async require(): Promise<string> {
    const status = await this.status()
    if (!status.ok) throw new UnavailableError(status.message)
    return this.location.cli
  }
}
