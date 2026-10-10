import { useEffect, useState, type FormEvent } from 'react'
import { formatDuration, type MediaAsset } from '../../../shared/media'
import type { Project } from '../../../shared/schemas'
import { api, errorMessage, unwrap } from '../api'
import type { NoticeState } from '../components/Notice'
import { formatDateTime, formatRelative } from '../format'

type Props = {
  projects: Project[] | null
  assets: MediaAsset[] | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  onNewProject: () => void
  onChanged: () => Promise<void>
  onOpenLibrary: () => void
  onNotice: (n: NoticeState) => void
  onError: (e: unknown) => void
}

export function SongsScreen({
  projects,
  assets,
  selectedId,
  onSelect,
  onNewProject,
  onChanged,
  onOpenLibrary,
  onNotice,
  onError
}: Props) {
  const selected = projects?.find((p) => p.id === selectedId) ?? projects?.[0] ?? null

  return (
    <div className="screen screen-split">
      <section className="list-pane">
        <header className="pane-header">
          <h1>Songs</h1>
          <button type="button" className="btn btn-primary" onClick={onNewProject}>
            New
          </button>
        </header>
        {projects === null && <p className="muted pad">Loading…</p>}
        {projects?.length === 0 && (
          <div className="empty pad">
            <p>No song projects yet.</p>
            <button type="button" className="btn btn-ghost" onClick={onNewProject}>
              Create the first one
            </button>
          </div>
        )}
        <ul className="song-list" data-testid="song-list">
          {projects?.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={`song-row${selected?.id === p.id ? ' is-active' : ''}`}
                onClick={() => onSelect(p.id)}
              >
                <span className="song-row-title">{p.title}</span>
                <span className="song-row-meta">
                  {p.artist ?? '—'} · {formatRelative(p.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="detail-pane">
        {selected ? (
          <ProjectDetail
            key={selected.id}
            project={selected}
            assets={assets}
            onOpenLibrary={onOpenLibrary}
            onChanged={onChanged}
            onDeleted={() => onSelect(null)}
            onNotice={onNotice}
            onError={onError}
          />
        ) : (
          projects &&
          projects.length > 0 && <p className="muted pad">Select a song.</p>
        )}
      </section>
    </div>
  )
}

function ProjectDetail({
  project,
  assets,
  onOpenLibrary,
  onChanged,
  onDeleted,
  onNotice,
  onError
}: {
  project: Project
  assets: MediaAsset[] | null
  onOpenLibrary: () => void
  onChanged: () => Promise<void>
  onDeleted: () => void
  onNotice: (n: NoticeState) => void
  onError: (e: unknown) => void
}) {
  const [title, setTitle] = useState(project.title)
  const [artist, setArtist] = useState(project.artist ?? '')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setTitle(project.title)
    setArtist(project.artist ?? '')
  }, [project.title, project.artist])

  const dirty = title !== project.title || artist !== (project.artist ?? '')
  const audioChoices = (assets ?? []).filter((a) => a.kind === 'audio' && a.status === 'ready')
  const currentAudio = assets?.find((a) => a.id === project.audioAssetId) ?? null

  async function setAudio(audioAssetId: string | null) {
    try {
      await unwrap(api.projects.setAudio(project.id, audioAssetId))
      await onChanged()
    } catch (e) {
      onError(e)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!dirty) return
    setSaving(true)
    setFormError(null)
    try {
      await unwrap(api.projects.update({ id: project.id, title, artist }))
      await onChanged()
      onNotice({ tone: 'success', text: 'Saved.' })
    } catch (e) {
      setFormError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    try {
      await unwrap(api.projects.delete(project.id))
      onDeleted()
      await onChanged()
      onNotice({ tone: 'info', text: `Deleted “${project.title}”. Source files were not touched.` })
    } catch (e) {
      onError(e)
    } finally {
      setConfirmDelete(false)
    }
  }

  return (
    <div className="detail">
      <p className="eyebrow">Song project</p>
      <h2 className="detail-title" data-testid="project-title">
        {project.title}
      </h2>

      <form className="detail-form" onSubmit={save}>
        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </label>
        <label className="field">
          <span>
            Artist <em className="optional">optional</em>
          </span>
          <input value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={200} />
        </label>
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {dirty && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setTitle(project.title)
                setArtist(project.artist ?? '')
              }}
            >
              Revert
            </button>
          )}
        </div>
      </form>

      <dl className="facts">
        <div>
          <dt>Song audio</dt>
          <dd>
            {audioChoices.length > 0 ? (
              <select
                className="audio-select"
                value={project.audioAssetId ?? ''}
                onChange={(e) => setAudio(e.target.value || null)}
                aria-label="Song audio"
                data-testid="song-audio"
              >
                <option value="">No audio chosen</option>
                {audioChoices.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.fileName} ({formatDuration(a.durationSeconds)})
                  </option>
                ))}
              </select>
            ) : (
              <span className="muted">
                No audio in the library yet.{' '}
                <button type="button" className="link-btn" onClick={onOpenLibrary}>
                  Import it in the Media Library
                </button>
              </span>
            )}
            {currentAudio?.availability === 'missing' && (
              <p className="hint">This audio file can’t be found. Relink it in the Media Library.</p>
            )}
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDateTime(project.createdAt)}</dd>
        </div>
        <div>
          <dt>Last changed</dt>
          <dd>{formatDateTime(project.updatedAt)}</dd>
        </div>
      </dl>

      <div className="danger-zone">
        {confirmDelete ? (
          <div className="confirm">
            <p>
              Delete “{project.title}” from the app? This removes the project record. Your original audio and video
              files are never deleted.
            </p>
            <div className="row">
              <button type="button" className="btn btn-danger" onClick={remove}>
                Delete project
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmDelete(true)}>
            Delete project…
          </button>
        )}
      </div>
    </div>
  )
}
