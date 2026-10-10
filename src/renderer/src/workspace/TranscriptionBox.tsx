import { useEffect, useState } from 'react'
import { formatBytes } from '../../../shared/media'
import type { LyricsState } from '../../../shared/lyrics'
import { TRANSCRIPTION_LANGUAGES, type SpeechModelInfo, type SpeechToolsStatus } from '../../../shared/workspace'
import { api, errorMessage, unwrap } from '../api'

type Props = {
  songId: string
  lyrics: LyricsState
  speech: SpeechToolsStatus | null
  models: SpeechModelInfo[]
  onRecheck: () => void
  onError: (e: unknown) => void
}

const STORAGE_KEY = 'mce.transcription'

function remembered(): { model: string | null; language: string | null } {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { model?: string; language?: string | null }
    return { model: v.model ?? null, language: v.language ?? null }
  } catch {
    return { model: null, language: null }
  }
}

export function TranscriptionBox({ songId, lyrics, speech, models, onRecheck, onError }: Props) {
  const saved = remembered()
  const installed = models.filter((m) => m.installed)
  const [model, setModel] = useState<string>(saved.model ?? '')
  const [language, setLanguage] = useState<string | null>(saved.language)
  const t = lyrics.transcription
  const busy = t.status === 'pending' || t.status === 'processing'
  // Once there are lyrics, the box folds away so the lyrics get the space.
  const [open, setOpen] = useState(lyrics.status === 'empty')

  useEffect(() => {
    if (!installed.some((m) => m.id === model) && installed[0]) setModel((installed.find((m) => m.recommended) ?? installed[0]).id)
  }, [installed, model])

  const start = async () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ model, language }))
    } catch {
      // per-viewer convenience only
    }
    try {
      await unwrap(api.workspace.transcribe({ songId, model, language }))
    } catch (e) {
      onError(e)
    }
  }

  if (speech && !speech.ok) {
    return (
      <div className="banner banner-warn" data-testid="speech-unavailable">
        <div>
          <strong>Automatic transcription is unavailable.</strong> {speech.message}
          {speech.code === 'RUNTIME_MISSING' && (
            <p className="small muted">
              After installing it, click Check again. You can still import a lyrics file or type the lyrics below.
            </p>
          )}
        </div>
        {speech.code !== 'UNSUPPORTED' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRecheck}>
            Check again
          </button>
        )}
      </div>
    )
  }

  if (!open && !busy && t.status !== 'error') {
    return (
      <div className="transcribe-box transcribe-folded" data-testid="transcribe-box">
        <span className="muted small">Automatic transcription with Whisper, on this computer.</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} data-testid="transcribe-open">
          Transcribe again…
        </button>
      </div>
    )
  }

  return (
    <div className="transcribe-box" data-testid="transcribe-box">
      <div className="transcribe-head">
        <div>
          <h3>Transcribe automatically</h3>
          <p className="muted small">
            Runs on this computer with Whisper; the audio never leaves it. Singing is harder than speech, so expect to correct
            the result.
          </p>
        </div>
      </div>

      <ul className="model-list">
        {models.map((m) => (
          <li key={m.id} className={`model${m.recommended ? ' is-recommended' : ''}`}>
            <div className="model-info">
              <strong>{m.label}</strong>
              {m.recommended && <span className="tag tag-done">Recommended</span>}
              <span className="muted small">
                {formatBytes(m.sizeBytes)} · {m.description}
              </span>
              {m.error && <span className="form-error small">{m.error}</span>}
            </div>
            <div className="model-actions">
              {m.download ? (
                <>
                  <span className="mono small">{Math.round((m.download.received / m.download.total) * 100)}%</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.speech.cancelDownload(m.id).then(() => undefined, onError)}>
                    Cancel
                  </button>
                </>
              ) : m.installed ? (
                <button type="button" className="btn btn-ghost btn-sm btn-danger-text" onClick={() => api.speech.deleteModel(m.id).then(() => undefined, onError)}>
                  Delete
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => api.speech.downloadModel(m.id).then(() => undefined, onError)}
                  data-testid={`download-${m.id}`}
                >
                  Download
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small">Models are downloaded from Hugging Face only when you click Download, and checked before use.</p>

      <div className="row wrap">
        <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!installed.length || busy} aria-label="Speech model" data-testid="model-select">
          {!installed.length && <option value="">Download a model first</option>}
          {installed.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          value={language ?? ''}
          onChange={(e) => setLanguage(e.target.value || null)}
          disabled={busy}
          aria-label="Language of the lyrics"
          data-testid="language-select"
        >
          {TRANSCRIPTION_LANGUAGES.map((l) => (
            <option key={l.code ?? 'auto'} value={l.code ?? ''}>
              {l.label}
            </option>
          ))}
        </select>
        {busy ? (
          <button type="button" className="btn btn-ghost" onClick={() => api.workspace.cancelTranscription(songId).then(() => undefined, onError)}>
            Cancel
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={start} disabled={!model || !installed.length} data-testid="transcribe">
            Transcribe
          </button>
        )}
      </div>

      {busy && (
        <div className="import-progress" role="status" data-testid="transcription-progress">
          <div className="import-progress-text">
            <strong>{t.status === 'pending' ? 'Waiting…' : `Transcribing… ${Math.round((t.progress ?? 0) * 100)}%`}</strong>
          </div>
          <div className="progress-track" aria-hidden="true">
            <div className="progress-fill" style={{ width: `${Math.round((t.progress ?? 0) * 100)}%` }} />
          </div>
        </div>
      )}
      {t.status === 'error' && t.error && (
        <p className="form-error" role="alert">
          {errorMessage(t.error)}
        </p>
      )}
    </div>
  )
}
