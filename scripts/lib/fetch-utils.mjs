// Shared helpers for the pinned-binary fetch scripts (FFmpeg, whisper.cpp).
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export async function sha256OfFile(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

export async function download(url, outFile, expectedSize, log) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`)
  const total = Number(response.headers.get('content-length')) || expectedSize
  let received = 0
  let nextReport = 0.1
  const counter = new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength
      if (total && received / total >= nextReport) {
        log(`  ${Math.round((received / total) * 100)}%`)
        nextReport += 0.1
      }
      controller.enqueue(chunk)
    }
  })
  const tmp = `${outFile}.part`
  await pipeline(Readable.fromWeb(response.body.pipeThrough(counter)), createWriteStream(tmp))
  renameSync(tmp, outFile)
}

/** Downloads into the cache (if not there yet) and verifies the SHA-256. Returns the archive path. */
export async function fetchVerified({ url, file, sha256, size, cacheDir, log }) {
  mkdirSync(cacheDir, { recursive: true })
  const archive = join(cacheDir, file)
  if (existsSync(archive) && (await sha256OfFile(archive)) !== sha256) {
    log('Cached file does not match the pinned checksum; downloading again.')
    rmSync(archive)
  }
  if (!existsSync(archive)) {
    log(`Downloading ${file} (${Math.round(size / 1048576)} MB)`)
    await download(url, archive, size, log)
  }
  const actual = await sha256OfFile(archive)
  if (actual !== sha256) {
    rmSync(archive, { force: true })
    throw new Error(`Checksum mismatch for ${file}: expected ${sha256}, got ${actual}. The file was deleted.`)
  }
  log('Checksum verified.')
  return archive
}

export function extract(archive, into) {
  mkdirSync(into, { recursive: true })
  const isZip = archive.endsWith('.zip')
  // On Windows use the system bsdtar explicitly: it reads zip files, while a GNU tar
  // from Git for Windows that may come first on PATH cannot.
  let command
  let commandArgs
  if (process.platform === 'win32') {
    command = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    commandArgs = [isZip ? '-xf' : '-xJf', archive, '-C', into]
  } else if (isZip) {
    command = 'unzip'
    commandArgs = ['-q', archive, '-d', into]
  } else {
    command = 'tar'
    commandArgs = ['-xJf', archive, '-C', into]
  }
  const result = spawnSync(command, commandArgs, { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`Extracting ${archive} failed (${result.error?.message ?? `exit code ${result.status}`})`)
  }
}

/** Exits with an error in strict mode, otherwise warns and exits successfully. */
export function makeFail(tag, strict, hint) {
  return (message) => {
    if (strict) {
      console.error(`[${tag}] ERROR: ${message}`)
      process.exit(1)
    }
    console.warn(`[${tag}] WARNING: ${message}`)
    if (hint) console.warn(`[${tag}] ${hint}`)
    process.exit(0)
  }
}
