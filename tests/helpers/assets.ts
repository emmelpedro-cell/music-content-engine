import { stat } from 'node:fs/promises'
import { quickFingerprint, pathKey } from '../../src/main/media/files'
import type { MediaRepository } from '../../src/main/repositories/media'
import type { MediaAsset } from '../../src/shared/media'

/** Registers a file as a ready library asset without running the import pipeline. */
export async function addReadyAsset(
  repo: MediaRepository,
  path: string,
  kind: 'audio' | 'video',
  durationSeconds: number
): Promise<MediaAsset> {
  const info = await stat(path)
  const asset = repo.insertPending({ path, pathKey: pathKey(path), size: info.size, mtimeMs: info.mtimeMs })!
  const fp = await quickFingerprint(path)
  repo.setFingerprint(asset.id, fp.hash, fp.size)
  return repo.markReady(
    asset.id,
    {
      kind,
      durationSeconds,
      container: 'wav',
      bitRate: null,
      primaryStreamIndex: 0,
      video: kind === 'video' ? { codec: 'h264', width: 320, height: 240, rotation: 0, frameRate: 30 } : null,
      audio: { codec: 'pcm_s16le', sampleRate: 22050, channels: 1 }
    },
    '{}',
    null
  )
}
