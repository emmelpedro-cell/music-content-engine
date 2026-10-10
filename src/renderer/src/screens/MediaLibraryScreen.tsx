import { useEffect, useMemo, useState } from 'react'
import type { MediaAsset } from '../../../shared/media'
import { api, errorMessage, unwrap } from '../api'
import type { NoticeState } from '../components/Notice'
import { AssetCard } from '../components/media/AssetCard'
import { AssetDetail } from '../components/media/AssetDetail'
import { ImportProgress } from '../components/media/ImportProgress'
import { ToolsBanner } from '../components/media/ToolsBanner'
import { assetState, importNotice } from '../media/format'
import type { MediaLibrary } from '../media/useMediaLibrary'

type Props = {
  library: MediaLibrary
  onNotice: (n: NoticeState) => void
  onError: (e: unknown) => void
}

type KindFilter = 'all' | 'audio' | 'video'
type StateFilter = 'all' | 'issues' | 'importing'
type SortKey = 'added' | 'name' | 'duration' | 'type'

const SORTS: Record<SortKey, (a: MediaAsset, b: MediaAsset) => number> = {
  added: (a, b) => b.importedAt.localeCompare(a.importedAt) || a.fileName.localeCompare(b.fileName),
  name: (a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' }),
  duration: (a, b) => (b.durationSeconds ?? -1) - (a.durationSeconds ?? -1),
  type: (a, b) => (a.kind ?? 'z').localeCompare(b.kind ?? 'z') || a.fileName.localeCompare(b.fileName)
}

export function MediaLibraryScreen({ library, onNotice, onError }: Props) {
  const { assets, queue, tools } = library
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [state, setState] = useState<StateFilter>('all')
  const [sort, setSort] = useState<SortKey>('added')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const toolsReady = tools?.ok === true
  const selected = assets?.find((a) => a.id === selectedId) ?? null
  const missingCount = assets?.filter((a) => a.availability === 'missing').length ?? 0

  // Re-check file locations whenever the library is opened.
  useEffect(() => {
    void api.media.checkAvailability()
  }, [])

  const visible = useMemo(() => {
    if (!assets) return []
    const q = query.trim().toLowerCase()
    return assets
      .filter((a) => kind === 'all' || a.kind === kind)
      .filter((a) => {
        const s = assetState(a)
        if (state === 'issues') return s === 'error' || s === 'missing'
        if (state === 'importing') return s === 'importing' || s === 'queued'
        return true
      })
      .filter((a) => !q || a.fileName.toLowerCase().includes(q) || a.sourcePath.toLowerCase().includes(q))
      .sort(SORTS[sort])
  }, [assets, query, kind, state, sort])

  async function importWith(mode: 'files' | 'folder') {
    setBusy(true)
    try {
      const result = await unwrap(api.media.importWithDialog(mode))
      if (!result.cancelled) {
        const notice = importNotice(result)
        if (notice) onNotice(notice)
      }
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  async function relinkFolder() {
    try {
      const result = await unwrap(api.media.relinkFolder())
      if (result.cancelled) return
      onNotice(
        result.relinked
          ? {
              tone: 'success',
              text: `Found ${result.relinked} missing ${result.relinked === 1 ? 'file' : 'files'}.${
                result.stillMissing ? ` ${result.stillMissing} still missing.` : ''
              }`
            }
          : { tone: 'info', text: `None of the missing files were in that folder (${result.scannedFiles} media files checked).` }
      )
    } catch (e) {
      onError(e)
    }
  }

  return (
    <div className={`library${selected ? ' has-detail' : ''}`}>
      <div className="library-main">
        <header className="screen-header library-header">
          <div>
            <p className="eyebrow">Footage and audio</p>
            <h1>Media Library</h1>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => importWith('folder')}
              disabled={!toolsReady || busy}
              data-testid="import-folder"
            >
              Import folder…
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => importWith('files')}
              disabled={!toolsReady || busy}
              data-testid="import-files"
            >
              Import files…
            </button>
          </div>
        </header>

        <ToolsBanner tools={tools} onRecheck={library.recheckTools} onError={onError} />
        <ImportProgress queue={queue} onCancelAll={() => api.media.cancelAll().then(() => undefined, onError)} />

        {missingCount > 0 && (
          <div className="banner banner-warn" role="status" data-testid="missing-banner">
            <span>
              {missingCount === 1 ? '1 file can’t be found' : `${missingCount} files can’t be found`}. They may have been
              moved, renamed or be on a drive that isn’t connected.
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={relinkFolder}>
              Search a folder…
            </button>
          </div>
        )}

        <div className="toolbar" role="search">
          <input
            type="search"
            className="toolbar-search"
            placeholder="Search by name or folder"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search media"
          />
          <div className="segmented" role="group" aria-label="Type">
            {(['all', 'video', 'audio'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={kind === k ? 'is-active' : ''}
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                {k === 'all' ? 'All' : k === 'video' ? 'Video' : 'Audio'}
              </button>
            ))}
          </div>
          <select value={state} onChange={(e) => setState(e.target.value as StateFilter)} aria-label="Status">
            <option value="all">Any status</option>
            <option value="issues">Needs attention</option>
            <option value="importing">Importing</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by">
            <option value="added">Recently added</option>
            <option value="name">Name</option>
            <option value="duration">Longest first</option>
            <option value="type">Type</option>
          </select>
        </div>

        {assets === null && !library.loadError && <p className="muted">Loading…</p>}
        {library.loadError && (
          <p className="form-error" role="alert">
            Couldn’t load the library: {library.loadError}
          </p>
        )}

        {assets && assets.length === 0 && (
          <div className="empty-library" data-testid="library-empty">
            <p className="lead">Your footage lives here.</p>
            <p className="muted">
              Import performances, close-ups, b-roll and your songs’ audio. Files stay where they are: the library only
              keeps a reference, metadata and a thumbnail.
            </p>
            <p className="muted small">
              You can also drag files or folders anywhere onto this window. Supported: MP4, MOV, MKV, WebM and other
              video formats; WAV, MP3, FLAC, M4A, AIFF, OGG and other audio formats.
            </p>
          </div>
        )}

        {assets && assets.length > 0 && visible.length === 0 && (
          <p className="muted">Nothing matches these filters.</p>
        )}

        {visible.length > 0 && (
          <>
            <p className="muted small result-count">
              {visible.length === assets?.length ? `${visible.length} items` : `${visible.length} of ${assets?.length} items`}
            </p>
            <ul className="asset-grid" data-testid="asset-grid">
              {visible.map((asset) => (
                <li key={asset.id}>
                  <AssetCard asset={asset} selected={asset.id === selectedId} onSelect={() => setSelectedId(asset.id)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {selected && (
        <AssetDetail
          key={selected.id}
          asset={selected}
          onClose={() => setSelectedId(null)}
          onNotice={onNotice}
          onError={(e) => onNotice({ tone: 'error', text: errorMessage(e) })}
        />
      )}
    </div>
  )
}
