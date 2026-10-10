import { useState, type ReactNode } from 'react'
import {
  formatBytes,
  formatChannels,
  formatDuration,
  formatFrameRate,
  type MediaAsset,
  type RelinkResult
} from '../../../../shared/media'
import { api, unwrap } from '../../api'
import { formatDateTime } from '../../format'
import { assetState, kindLabel, sourceUrl, STATE_LABEL } from '../../media/format'
import type { NoticeState } from '../Notice'
import { AudioGlyph } from './AssetCard'

type Props = {
  asset: MediaAsset
  onClose: () => void
  onNotice: (n: NoticeState) => void
  onError: (e: unknown) => void
}

export function AssetDetail({ asset, onClose, onNotice, onError }: Props) {
  const state = assetState(asset)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [mismatch, setMismatch] = useState<string | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)

  const handleRelinkResult = (result: RelinkResult) => {
    if (result.status === 'mismatch') setMismatch(result.fileName)
    else if (result.status === 'relinked') {
      setMismatch(null)
      onNotice({
        tone: 'success',
        text: result.reprocessing ? `Relinked. “${result.asset.fileName}” is being analysed again.` : 'Relinked.'
      })
    }
  }

  const relink = () => unwrap(api.media.relink(asset.id)).then(handleRelinkResult, onError)
  const confirmRelink = () => unwrap(api.media.relinkConfirm(asset.id)).then(handleRelinkResult, onError)
  const retry = () => unwrap(api.media.retry(asset.id)).then(() => undefined, onError)
  const cancel = () => unwrap(api.media.cancel(asset.id)).then(() => undefined, onError)
  const showInFolder = () => unwrap(api.media.showInFolder(asset.id)).then(() => undefined, onError)
  const remove = () =>
    unwrap(api.media.remove(asset.id)).then(() => {
      onNotice({ tone: 'info', text: `Removed “${asset.fileName}” from the library. The file itself was not touched.` })
      onClose()
    }, onError)

  const canPreview = state === 'ready' && !previewFailed

  return (
    <aside className="asset-detail" aria-label={`Details for ${asset.fileName}`} data-testid="asset-detail">
      <header className="asset-detail-head">
        <div>
          <p className="eyebrow">{kindLabel(asset)}</p>
          <h2 className="asset-detail-title">{asset.fileName}</h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details">
          ×
        </button>
      </header>

      <div className="preview">
        {canPreview && asset.kind === 'video' && (
          <video
            src={sourceUrl(asset)}
            controls
            preload="metadata"
            onError={() => setPreviewFailed(true)}
            data-testid="preview-video"
          />
        )}
        {canPreview && asset.kind === 'audio' && (
          <div className="preview-audio">
            <AudioGlyph />
            <audio src={sourceUrl(asset)} controls preload="metadata" onError={() => setPreviewFailed(true)} data-testid="preview-audio" />
          </div>
        )}
        {state === 'ready' && previewFailed && (
          <p className="preview-note">
            The built-in player can’t play this format ({asset.videoCodec ?? asset.audioCodec}). The file was imported
            correctly and can still be used for editing.
          </p>
        )}
        {(state === 'importing' || state === 'queued') && (
          <p className="preview-note">
            <span className="spinner" aria-hidden="true" /> {STATE_LABEL[state]}
          </p>
        )}
        {state === 'missing' && (
          <p className="preview-note warn">
            The file isn’t at its last known location. If you moved or renamed it, use <strong>Relink</strong> to point
            the library at the new location.
          </p>
        )}
        {state === 'error' && (
          <p className="preview-note error" data-testid="asset-error">
            {asset.errorMessage}
          </p>
        )}
      </div>

      {mismatch && (
        <div className="confirm" role="alertdialog" aria-label="Confirm relink">
          <p>
            “{mismatch}” doesn’t have the same content as the original file. Use it anyway? It will be analysed again and
            replace this entry’s metadata.
          </p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={confirmRelink}>
              Use this file
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMismatch(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="row wrap">
        {(state === 'missing' || state === 'ready' || state === 'error') && (
          <button type="button" className={`btn ${state === 'missing' ? 'btn-primary' : 'btn-ghost'}`} onClick={relink} data-testid="relink">
            Relink…
          </button>
        )}
        {state === 'error' && asset.availability === 'online' && (
          <button type="button" className="btn btn-ghost" onClick={retry}>
            Try again
          </button>
        )}
        {(state === 'importing' || state === 'queued') && (
          <button type="button" className="btn btn-ghost" onClick={cancel}>
            Cancel import
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={showInFolder}>
          Show in folder
        </button>
      </div>

      <dl className="facts compact" data-testid="asset-facts">
        <Fact label="Status" value={STATE_LABEL[state]} />
        {asset.status === 'ready' && (
          <>
            <Fact label="Duration" value={formatDuration(asset.durationSeconds)} />
            {asset.kind === 'video' && (
              <>
                <Fact label="Resolution" value={asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—'} />
                <Fact label="Frame rate" value={formatFrameRate(asset.frameRate)} />
                <Fact label="Video codec" value={asset.videoCodec ?? '—'} />
                {asset.rotation ? <Fact label="Rotation" value={`${asset.rotation}°`} /> : null}
              </>
            )}
            <Fact
              label="Audio"
              value={
                asset.audioCodec
                  ? [asset.audioCodec, asset.sampleRate ? `${asset.sampleRate} Hz` : '', formatChannels(asset.channels)]
                      .filter(Boolean)
                      .join(' · ')
                  : 'None'
              }
            />
            <Fact label="Container" value={asset.container?.split(',')[0] ?? '—'} />
            <Fact label="Bit rate" value={asset.bitRate ? `${Math.round(asset.bitRate / 1000)} kb/s` : '—'} />
          </>
        )}
        <Fact label="File size" value={formatBytes(asset.fileSize)} />
        <Fact label="Location" value={<code className="path">{asset.sourcePath}</code>} />
        <Fact label="Added" value={formatDateTime(asset.importedAt)} />
      </dl>

      <div className="danger-zone">
        {confirmRemove ? (
          <div className="confirm">
            <p>Remove “{asset.fileName}” from the library? The file on your disk is not deleted.</p>
            <div className="row">
              <button type="button" className="btn btn-danger" onClick={remove}>
                Remove from library
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmRemove(false)}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmRemove(true)}>
            Remove from library…
          </button>
        )}
      </div>
    </aside>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
