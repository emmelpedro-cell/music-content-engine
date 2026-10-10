import { useState } from 'react'
import type { BeatMap } from '../../../shared/analysis'
import { HOOK_LENGTH_PRESETS, type Hook } from '../../../shared/hooks'
import { lyricsInRange, type LyricDocument } from '../../../shared/lyrics'
import { api, unwrap } from '../api'
import { formatClock, type Selection } from './Timeline'

type Props = {
  songId: string
  hooks: Hook[]
  duration: number
  beatMap: BeatMap | null
  lyrics: LyricDocument
  lyricsOffset: number
  time: number
  selection: Selection | null
  onChanged: () => Promise<void>
  onSelectRange: (s: Selection) => void
  onPlay: (from: number, until: number) => void
  onError: (e: unknown) => void
}

/** Nearest downbeat to `t`, if bars are known. */
function snapToBar(t: number, beatMap: BeatMap | null): number {
  if (!beatMap?.downbeats.length) return t
  return beatMap.downbeats.reduce((best, d) => (Math.abs(d - t) < Math.abs(best - t) ? d : best), beatMap.downbeats[0]!)
}

export function HooksPanel(p: Props) {
  const [snap, setSnap] = useState(true)
  const [name, setName] = useState('')

  const create = async (start: number, end: number) => {
    const s = Math.max(0, start)
    const e = Math.min(p.duration, end)
    if (e - s < 0.25) return p.onError(new Error('The range is too short for a hook.'))
    try {
      await unwrap(
        api.workspace.createHook({ songId: p.songId, name: name.trim() || `Hook ${p.hooks.length + 1}`, start: round2(s), end: round2(e), tags: [] })
      )
      setName('')
      await p.onChanged()
    } catch (err) {
      p.onError(err)
    }
  }

  const fromPreset = (seconds: number) => {
    const start = snap ? snapToBar(p.time, p.beatMap) : p.time
    const end = snap ? snapToBar(start + seconds, p.beatMap) : start + seconds
    void create(start, end > start ? end : start + seconds)
  }

  return (
    <div className="hooks-panel" data-testid="hooks-panel">
      <div className="hook-create">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Chorus or Main riff" aria-label="Hook name" data-testid="hook-name" />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!p.selection || p.selection.end - p.selection.start < 0.25}
          onClick={() => p.selection && create(p.selection.start, p.selection.end)}
          data-testid="hook-from-selection"
        >
          Save selection as hook
        </button>
        <span className="muted small">or from the playhead ({formatClock(p.time)}):</span>
        {HOOK_LENGTH_PRESETS.map((s) => (
          <button key={s} type="button" className="btn btn-ghost btn-sm" onClick={() => fromPreset(s)} data-testid={`hook-preset-${s}`}>
            {s} s
          </button>
        ))}
        <label className="check">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} disabled={!p.beatMap?.downbeats.length} />
          Snap to bars
        </label>
      </div>

      {p.hooks.length === 0 ? (
        <p className="muted">
          No hooks yet. Drag across the timeline to select a passage, or use a length button. Hooks are the sections that
          videos will be cut from.
        </p>
      ) : (
        <ul className="hook-list" data-testid="hook-list">
          {p.hooks.map((h) => (
            <HookRow key={h.id} hook={h} {...p} />
          ))}
        </ul>
      )}
    </div>
  )
}

function HookRow({ hook, lyrics, lyricsOffset, onChanged, onSelectRange, onPlay, onError }: Props & { hook: Hook }) {
  const [name, setName] = useState(hook.name)
  const [tags, setTags] = useState(hook.tags.join(', '))
  const [notes, setNotes] = useState(hook.notes ?? '')
  const text = lyricsInRange(lyrics, hook.start, hook.end, lyricsOffset)

  const update = async (patch: Parameters<typeof api.workspace.updateHook>[0]) => {
    try {
      await unwrap(api.workspace.updateHook(patch))
      await onChanged()
    } catch (e) {
      onError(e)
    }
  }

  return (
    <li className="hook" data-testid="hook">
      <div className="hook-main">
        <input
          className="hook-title"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== hook.name && update({ id: hook.id, name })}
          aria-label="Hook name"
        />
        <span className="mono small">
          {formatClock(hook.start, true)} – {formatClock(hook.end, true)} · {(hook.end - hook.start).toFixed(1)} s
        </span>
        <div className="row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPlay(hook.start, hook.end)}>
            ▶ Play
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelectRange({ start: hook.start, end: hook.end })}>
            Show
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-danger-text"
            onClick={() =>
              unwrap(api.workspace.deleteHook(hook.id))
                .then(onChanged)
                .catch(onError)
            }
          >
            Delete
          </button>
        </div>
      </div>
      <div className="hook-fields">
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          onBlur={() => {
            const next = tags.split(',').map((t) => t.trim()).filter(Boolean)
            if (next.join(',') !== hook.tags.join(',')) void update({ id: hook.id, tags: next })
          }}
          placeholder="Tags: instrumental, erhu, energetic"
          aria-label="Tags"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (hook.notes ?? '') && update({ id: hook.id, notes: notes || null })}
          placeholder="Notes"
          aria-label="Notes"
        />
      </div>
      {text && <p className="hook-lyrics">{text}</p>}
    </li>
  )
}

const round2 = (v: number) => Math.round(v * 100) / 100
