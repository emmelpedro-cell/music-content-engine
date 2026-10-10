#!/usr/bin/env node
/**
 * Installs the pinned whisper.cpp command-line build (scripts/whisper-sources.json)
 * into vendor/whisper/<platform>-<arch>/ for development and packaging, and
 * optionally a speech model for development and tests.
 *
 *   node scripts/fetch-whisper.mjs                       current platform; warns instead of failing
 *   node scripts/fetch-whisper.mjs --target win32-x64 --strict
 *   node scripts/fetch-whisper.mjs --model base          also download a model to vendor/whisper-models/
 *
 * Only Windows x64 is pinned (the app's target). On other platforms transcription
 * is reported as unavailable; everything else works.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extract, fetchVerified, makeFail } from './lib/fetch-utils.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sources = JSON.parse(readFileSync(join(root, 'scripts', 'whisper-sources.json'), 'utf8'))
const args = process.argv.slice(2)
const strict = args.includes('--strict')
const force = args.includes('--force')
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const target = arg('--target') ?? `${process.platform}-${process.arch}`
const modelId = arg('--model')

const LAYOUT_VERSION = 1
const vendorDir = join(root, 'vendor', 'whisper')
const cacheDir = join(vendorDir, '.cache')
const destDir = join(vendorDir, target)
const log = (m) => console.log(`[fetch-whisper] ${m}`)
const fail = makeFail('fetch-whisper', strict, 'Transcription stays unavailable until whisper.cpp is installed. Retry with: npm run fetch:whisper')

async function installBinaries() {
  const spec = sources.targets[target]
  if (!spec) {
    if (strict) fail(`No pinned whisper.cpp build for "${target}" (only ${Object.keys(sources.targets).join(', ')}).`)
    log(`No pinned whisper.cpp build for "${target}"; transcription is only available on Windows builds.`)
    return
  }
  const manifestPath = join(destDir, 'manifest.json')
  if (!force && existsSync(manifestPath) && spec.files.every((f) => existsSync(join(destDir, 'bin', f)))) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.sha256 === spec.sha256 && manifest.layoutVersion === LAYOUT_VERSION) {
      log(`whisper.cpp ${manifest.version} for ${target} is up to date.`)
      return
    }
  }
  let archive
  try {
    archive = await fetchVerified({ url: spec.url, file: spec.file, sha256: spec.sha256, size: spec.size, cacheDir, log })
  } catch (error) {
    fail(error.cause?.message ?? error.message)
    return
  }
  const work = join(vendorDir, `.extract-${target}`)
  const staging = join(vendorDir, `.staging-${target}`)
  rmSync(work, { recursive: true, force: true })
  rmSync(staging, { recursive: true, force: true })
  try {
    extract(archive, work)
    const release = join(work, 'Release')
    const from = existsSync(release) ? release : work
    mkdirSync(join(staging, 'bin'), { recursive: true })
    // Only the command-line transcriber and its libraries; the demo tools (and SDL2) are not shipped.
    for (const file of spec.files) copyFileSync(join(from, file), join(staging, 'bin', file))
    for (const file of ['LICENSE-whisper.cpp.txt', 'LICENSE-whisper-models.txt']) {
      copyFileSync(join(root, 'scripts', 'licenses', 'whisper', file), join(staging, file))
    }
    writeFileSync(
      join(staging, 'NOTICE.txt'),
      `whisper.cpp ${sources.version} — bundled with Music Content Engine\n\n` +
        `License: MIT (see LICENSE-whisper.cpp.txt). Includes ggml (MIT, same authors).\n` +
        `Source: https://github.com/ggml-org/whisper.cpp/tree/${sources.commit}\n` +
        `Binary: ${spec.url}\nSHA-256: ${spec.sha256}\n\n` +
        `Speech models are downloaded separately when the user asks for one; see LICENSE-whisper-models.txt.\n` +
        `This build needs the Microsoft Visual C++ 2015–2022 Redistributable (x64), which most Windows installations already have.\n`
    )
    writeFileSync(
      join(staging, 'manifest.json'),
      JSON.stringify({ version: sources.version, license: sources.license, sha256: spec.sha256, target, layoutVersion: LAYOUT_VERSION }, null, 2) + '\n'
    )
    rmSync(destDir, { recursive: true, force: true })
    renameSync(staging, destDir)
    log(`Installed whisper.cpp ${sources.version} into vendor/whisper/${target}`)
  } catch (error) {
    fail(error.message)
  } finally {
    rmSync(work, { recursive: true, force: true })
    rmSync(staging, { recursive: true, force: true })
  }
}

async function installModel(id) {
  const model = sources.models.find((m) => m.id === id)
  if (!model) fail(`Unknown model "${id}". Known: ${sources.models.map((m) => m.id).join(', ')}`)
  const dir = join(root, 'vendor', 'whisper-models')
  try {
    await fetchVerified({ url: `${sources.modelBaseUrl}/${model.file}`, file: model.file, sha256: model.sha256, size: model.size, cacheDir: dir, log })
    log(`Model ${id} ready in vendor/whisper-models/${model.file}`)
  } catch (error) {
    fail(error.cause?.message ?? error.message)
  }
}

await installBinaries()
if (modelId) await installModel(modelId)
