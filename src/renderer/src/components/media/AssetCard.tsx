import { useState } from 'react'
import type { MediaAsset } from '../../../../shared/media'
import { assetState, kindLabel, metaLine, STATE_LABEL, thumbnailUrl } from '../../media/format'

export function AudioGlyph() {
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
      <path d="M18 34V14l20-4v20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="14" cy="34" r="4.5" fill="currentColor" />
      <circle cx="34" cy="30" r="4.5" fill="currentColor" />
    </svg>
  )
}

type Props = { asset: MediaAsset; selected: boolean; onSelect: () => void }

export function AssetCard({ asset, selected, onSelect }: Props) {
  const state = assetState(asset)
  const [thumbFailed, setThumbFailed] = useState(false)
  const showThumb = asset.kind === 'video' && asset.hasThumbnail && !thumbFailed

  return (
    <button
      type="button"
      className={`asset-card state-${state}${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
      data-testid="asset-card"
      data-file-name={asset.fileName}
      data-state={state}
    >
      <span className="asset-thumb">
        {showThumb ? (
          <img src={thumbnailUrl(asset)} alt="" loading="lazy" onError={() => setThumbFailed(true)} data-testid="asset-thumb" />
        ) : (
          <span className={`asset-placeholder kind-${asset.kind ?? 'unknown'}`}>
            {asset.kind === 'audio' ? <AudioGlyph /> : <span className="placeholder-label">{kindLabel(asset)}</span>}
          </span>
        )}
        {state !== 'ready' && (
          <span className={`asset-badge badge-${state}`} data-testid="asset-status">
            {(state === 'importing' || state === 'queued') && <span className="spinner" aria-hidden="true" />}
            {STATE_LABEL[state]}
          </span>
        )}
        {asset.kind && <span className="asset-kind">{kindLabel(asset)}</span>}
      </span>
      <span className="asset-name" title={asset.fileName}>
        {asset.fileName}
      </span>
      <span className="asset-meta" data-testid="asset-meta">
        {state === 'error' ? asset.errorMessage : metaLine(asset) || ' '}
      </span>
    </button>
  )
}
