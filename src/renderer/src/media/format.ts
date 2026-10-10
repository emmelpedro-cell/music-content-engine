import {
  formatChannels,
  formatDuration,
  formatFrameRate,
  type ImportSummary,
  type MediaAsset
} from '../../../shared/media'
import type { NoticeState } from '../components/Notice'

export const thumbnailUrl = (asset: MediaAsset) =>
  `mce-media://thumb/${asset.id}?v=${encodeURIComponent(asset.updatedAt)}`

export const sourceUrl = (asset: MediaAsset) => `mce-media://asset/${asset.id}?v=${encodeURIComponent(asset.updatedAt)}`

export function kindLabel(asset: MediaAsset): string {
  if (asset.kind === 'video') return 'Video'
  if (asset.kind === 'audio') return 'Audio'
  return 'Media'
}

/** One line of the most useful facts, e.g. "0:42 · 1920×1080 · 29.97 fps". */
export function metaLine(asset: MediaAsset): string {
  if (asset.status !== 'ready') return ''
  const parts = [formatDuration(asset.durationSeconds)]
  if (asset.kind === 'video') {
    if (asset.width && asset.height) parts.push(`${asset.width}×${asset.height}`)
    if (asset.frameRate) parts.push(formatFrameRate(asset.frameRate))
  } else {
    if (asset.sampleRate) parts.push(`${(asset.sampleRate / 1000).toFixed(asset.sampleRate % 1000 ? 1 : 0)} kHz`)
    const ch = formatChannels(asset.channels)
    if (ch) parts.push(ch)
  }
  return parts.join(' · ')
}

export type AssetState = 'importing' | 'queued' | 'error' | 'missing' | 'ready'

export function assetState(asset: MediaAsset): AssetState {
  if (asset.availability === 'missing') return 'missing'
  if (asset.status === 'error') return 'error'
  if (asset.status === 'processing') return 'importing'
  if (asset.status === 'pending') return 'queued'
  return 'ready'
}

export const STATE_LABEL: Record<AssetState, string> = {
  importing: 'Analysing…',
  queued: 'Queued',
  error: 'Can’t import',
  missing: 'File missing',
  ready: 'Ready'
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function importNotice(summary: ImportSummary): NoticeState | null {
  const parts: string[] = []
  if (summary.queued) parts.push(`Importing ${plural(summary.queued, 'file', 'files')}.`)
  if (summary.alreadyInLibrary) parts.push(`${plural(summary.alreadyInLibrary, 'file is', 'files are')} already in the library.`)
  if (summary.skippedNonMedia) parts.push(`${plural(summary.skippedNonMedia, 'non-media file was', 'non-media files were')} skipped.`)
  if (summary.truncated) parts.push('The folder holds more files than can be imported at once; only the first 10,000 were taken.')
  if (summary.errors.length) {
    const first = summary.errors[0]!.message
    parts.push(summary.errors.length === 1 ? first : `${first} (and ${summary.errors.length - 1} more problems)`)
  }
  if (!parts.length) return { tone: 'info', text: 'No audio or video files were found.' }
  return { tone: summary.queued || !summary.errors.length ? 'info' : 'error', text: parts.join(' ') }
}
