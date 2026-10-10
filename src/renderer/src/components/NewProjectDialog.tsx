import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CreateProjectInput } from '../../../shared/schemas'
import { errorMessage } from '../api'

type Props = {
  onCancel: () => void
  onCreate: (input: CreateProjectInput) => Promise<void>
}

export function NewProjectDialog({ onCancel, onCreate }: Props) {
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) {
      setError('Give the song a title.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onCreate({ title, artist })
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="dialog" onSubmit={submit} aria-labelledby="new-project-title">
        <h2 id="new-project-title">New song project</h2>
        <p className="muted">
          A project holds one song and everything made from it: lyrics, hooks, footage and edits. After creating it,
          choose the song's audio file to analyse beats and sync lyrics.
        </p>
        <label className="field">
          <span>Song title</span>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="e.g. Rumelaj"
            data-testid="new-project-title"
          />
        </label>
        <label className="field">
          <span>
            Artist <em className="optional">optional</em>
          </span>
          <input value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={200} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="new-project-submit">
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  )
}
