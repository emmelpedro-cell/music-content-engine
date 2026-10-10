import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  alignToTimings,
  detectFormat,
  documentStats,
  lineRange,
  parseLyrics,
  wordsOf,
  type LyricDocument,
  type LyricSource,
  type LyricsState
} from '../../../shared/lyrics'
import type { SpeechModelInfo, SpeechToolsStatus } from '../../../shared/workspace'
import { api, unwrap } from '../api'
import type { NoticeState } from '../components/Notice'
import {
  addInstrumental,
  addLine,
  deleteLine,
  deleteWord,
  findWord,
  mergeWithNext,
  nextWordId,
  nudgeWord,
  setWordStart,
  setWordText,
  shiftLine,
  splitLineAt
} from '../../../shared/lyric-edits'
import { formatClock, type Selection } from './Timeline'
import { TranscriptionBox } from './TranscriptionBox'

type Props = {
  songId: string
  lyrics: LyricsState
  speech: SpeechToolsStatus | null
  models: SpeechModelInfo[]
  time: number
  playing: boolean
  selection: Selection | null
  selectedWordId: string | null
  onSelectWord: (id: string | null) => void
  onLocalChange: (doc: LyricDocument, offset: number) => void
  onSeek: (t: number) => void
  onPlay: (from: number, until?: number) => void
  onSaved: (state: LyricsState) => void
  onRecheckSpeech: () => void
  onNotice: (n: NoticeState) => void
  onError: (e: unknown) => void
}

type Snapshot = { doc: LyricDocument; offset: number }

export function LyricsPanel(p: Props) {
  const [doc, setDoc] = useState<LyricDocument>(p.lyrics.document)
  const [offset, setOffset] = useState(p.lyrics.offsetSeconds)
  const [source, setSource] = useState<LyricSource>(p.lyrics.source)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [undo, setUndo] = useState<Snapshot[]>([])
  const [redo, setRedo] = useState<Snapshot[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [tapMode, setTapMode] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [newLine, setNewLine] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<number | null>(null)
  const latest = useRef({ doc, offset, source })
  latest.current = { doc, offset, source }

  // Adopt server changes (a finished transcription, another save) when there are no local edits.
  useEffect(() => {
    if (dirty) return
    setDoc(p.lyrics.document)
    setOffset(p.lyrics.offsetSeconds)
    setSource(p.lyrics.source)
  }, [p.lyrics.document, p.lyrics.offsetSeconds, p.lyrics.source, dirty])

  useEffect(() => p.onLocalChange(doc, offset), [doc, offset]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(
    async (confirm: boolean) => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = null
      setSaving(true)
      try {
        const { doc: d, offset: o, source: s } = latest.current
        const state = await unwrap(
          api.workspace.saveLyrics({ songId: p.songId, document: d, offsetSeconds: o, language: p.lyrics.language, source: s, confirm })
        )
        setDirty(false)
        p.onSaved(state)
        if (confirm) p.onNotice({ tone: 'success', text: 'Lyrics marked as checked.' })
      } catch (e) {
        p.onError(e)
      } finally {
        setSaving(false)
      }
    },
    [p]
  )

  // Save pending edits when leaving the song.
  useEffect(
    () => () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current)
        const { doc: d, offset: o, source: s } = latest.current
        void api.workspace.saveLyrics({ songId: p.songId, document: d, offsetSeconds: o, language: p.lyrics.language, source: s, confirm: false })
      }
    },
    [p.songId] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const apply = useCallback(
    (next: LyricDocument, nextOffset = latest.current.offset, nextSource: LyricSource = latest.current.source ?? 'manual') => {
      setUndo((u) => [...u.slice(-99), { doc: latest.current.doc, offset: latest.current.offset }])
      setRedo([])
      setDoc(next)
      setOffset(nextOffset)
      setSource(nextSource)
      setDirty(true)
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => void save(false), 800)
    },
    [save]
  )

  const restore = (from: Snapshot[], to: (s: Snapshot) => void, pop: (s: Snapshot[]) => void) => {
    const last = from[from.length - 1]
    if (!last) return
    to({ doc: latest.current.doc, offset: latest.current.offset })
    pop(from.slice(0, -1))
    setDoc(last.doc)
    setOffset(last.offset)
    setDirty(true)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void save(false), 800)
  }
  const doUndo = () => restore(undo, (s) => setRedo((r) => [...r, s]), setUndo)
  const doRedo = () => restore(redo, (s) => setUndo((u) => [...u, s]), setRedo)

  const selected = p.selectedWordId ? findWord(doc, p.selectedWordId) : null
  const selectedWord = selected ? doc.lines[selected.li]!.words[selected.wi]! : null
  const playhead = p.time - offset // document time at the playhead

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable]')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) doRedo()
        else doUndo()
        return
      }
      if (tapMode && e.key.toLowerCase() === 't') {
        e.preventDefault()
        const id = p.selectedWordId ?? nextWordId(latest.current.doc, null)
        if (!id) return
        apply(setWordStart(latest.current.doc, id, playhead))
        p.onSelectWord(nextWordId(latest.current.doc, id))
        return
      }
      if (!p.selectedWordId) return
      if (e.key.toLowerCase() === 's') apply(setWordStart(latest.current.doc, p.selectedWordId, playhead))
      else if (e.key === '[') apply(nudgeWord(latest.current.doc, p.selectedWordId, -0.05))
      else if (e.key === ']') apply(nudgeWord(latest.current.doc, p.selectedWordId, 0.05))
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        const next = nextWordId(latest.current.doc, p.selectedWordId)
        apply(deleteWord(latest.current.doc, p.selectedWordId))
        p.onSelectWord(next)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const stats = useMemo(() => documentStats(doc), [doc])
  const timedSource = p.lyrics.original ?? (stats.timed > 0 ? doc : null)
  const originalDiffers = p.lyrics.original !== null && JSON.stringify(p.lyrics.original) !== JSON.stringify(doc)

  const importFile = async (file: File) => {
    const text = await file.text()
    const format = detectFormat(file.name, text)
    const parsed = parseLyrics(text, format)
    if (!parsed.lines.length) return p.onNotice({ tone: 'error', text: `No lyrics found in “${file.name}”.` })
    if (format === 'txt' && timedSource && documentStats(timedSource).timed > 0) {
      apply(alignToTimings(text, timedSource), offset, 'import')
      p.onNotice({ tone: 'success', text: `Imported “${file.name}” and placed it on the transcription’s timing. Check the result.` })
    } else {
      apply(parsed, offset, 'import')
      p.onNotice({ tone: 'success', text: `Imported “${file.name}” (${format.toUpperCase()}).` })
    }
  }

  // Words currently sung, for highlighting.
  const activeWordId = useMemo(() => {
    for (const w of wordsOf(doc)) if (w.start !== null && w.start <= playhead && playhead < (w.end ?? w.start + 0.3)) return w.id
    return null
  }, [doc, playhead])

  return (
    <div className="lyrics-panel" data-testid="lyrics-panel">
      <TranscriptionBox songId={p.songId} lyrics={p.lyrics} speech={p.speech} models={p.models} onRecheck={p.onRecheckSpeech} onError={p.onError} />

      <div className="lyrics-toolbar">
        <div className="lyrics-status" data-testid="lyrics-status">
          {p.lyrics.status === 'confirmed' && !dirty ? (
            <span className="tag tag-done">Checked</span>
          ) : (
            <span className="tag tag-pending">{stats.words ? 'Draft' : 'No lyrics'}</span>
          )}
          <span className="muted small">
            {stats.lines} lines · {stats.words} words · {stats.timed} timed
            {saving ? ' · saving…' : dirty ? ' · unsaved' : ''}
          </span>
        </div>
        <div className="row wrap">
          <button type="button" className="btn btn-ghost btn-sm" onClick={doUndo} disabled={!undo.length} title="Ctrl+Z">
            Undo
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={doRedo} disabled={!redo.length} title="Ctrl+Shift+Z">
            Redo
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
            Import file…
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPasteOpen(true)} data-testid="paste-lyrics">
            Paste lyrics…
          </button>
          {originalDiffers && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(p.lyrics.original!, offset, 'transcription')}>
              Use latest transcription
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => save(true)}
            disabled={!stats.words || (p.lyrics.status === 'confirmed' && !dirty)}
            data-testid="confirm-lyrics"
          >
            Mark as checked
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.lrc,.srt,.vtt,text/plain"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void importFile(f)
          }}
          data-testid="lyrics-file"
        />
      </div>

      <div className="lyrics-tools">
        <label className="check">
          <input type="checkbox" checked={tapMode} onChange={(e) => setTapMode(e.target.checked)} />
          Tap to time: press <kbd>T</kbd> on each word while the song plays
        </label>
        <label className="inline-field">
          Offset
          <input
            className="num-input"
            type="number"
            step="0.05"
            value={offset}
            onChange={(e) => apply(doc, Math.max(-60, Math.min(60, Number(e.target.value) || 0)))}
            aria-label="Lyrics offset in seconds"
          />
          s
        </label>
      </div>

      {selectedWord && selected && (
        <div className="word-toolbar" data-testid="word-toolbar">
          <span>
            <strong>“{selectedWord.text}”</strong>{' '}
            <span className="mono small">{selectedWord.start === null ? 'not timed' : formatClock(selectedWord.start + offset, true)}</span>
          </span>
          <div className="row wrap">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(setWordStart(doc, selectedWord.id, playhead))} title="S" data-testid="word-to-playhead">
              Start at playhead (S)
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(nudgeWord(doc, selectedWord.id, -0.05))} title="[">
              −50 ms
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(nudgeWord(doc, selectedWord.id, 0.05))} title="]">
              +50 ms
            </button>
            {selectedWord.start !== null && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => p.onPlay(Math.max(0, selectedWord.start! + offset - 0.5))}>
                Play from here
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(splitLineAt(doc, selectedWord.id))} disabled={selected.wi === 0}>
              New line from here
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-danger-text" onClick={() => apply(deleteWord(doc, selectedWord.id))}>
              Delete word
            </button>
          </div>
        </div>
      )}

      <ol className="lyric-lines" data-testid="lyric-lines">
        {doc.lines.map((line) => {
          const r = lineRange(line)
          return (
            <li key={line.id} className={`lyric-line kind-${line.kind}`}>
              <button
                type="button"
                className="line-time mono"
                onClick={() => r.start !== null && p.onSeek(r.start + offset)}
                disabled={r.start === null}
                title="Move the playhead here"
              >
                {r.start === null ? '—' : formatClock(r.start + offset, true)}
              </button>
              <div className="line-words">
                {line.kind === 'instrumental' ? (
                  <span className="instrumental-label">
                    {line.label || 'Instrumental'}
                    {r.start !== null && r.end !== null && <span className="muted small"> · {Math.round(r.end - r.start)} s</span>}
                  </span>
                ) : (
                  line.words.map((w) =>
                    editingId === w.id ? (
                      <input
                        key={w.id}
                        className="word-input"
                        defaultValue={w.text}
                        autoFocus
                        onBlur={(e) => {
                          setEditingId(null)
                          if (e.target.value.trim() !== w.text) apply(setWordText(doc, w.id, e.target.value))
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        aria-label="Edit word"
                      />
                    ) : (
                      <button
                        key={w.id}
                        type="button"
                        className={`word${w.id === p.selectedWordId ? ' is-selected' : ''}${w.id === activeWordId ? ' is-active' : ''}${w.start === null ? ' is-untimed' : ''}${
                          w.confidence != null && w.confidence < 0.5 && !w.edited ? ' is-doubtful' : ''
                        }`}
                        onClick={() => p.onSelectWord(w.id)}
                        onDoubleClick={() => setEditingId(w.id)}
                        title={w.start === null ? 'Not timed yet' : `${formatClock(w.start + offset, true)}${w.confidence != null ? ` · confidence ${Math.round(w.confidence * 100)}%` : ''}`}
                        data-testid="word"
                      >
                        {w.text}
                      </button>
                    )
                  )
                )}
              </div>
              <div className="line-actions">
                {r.start !== null && (
                  <button type="button" className="icon-btn small" onClick={() => p.onPlay(r.start! + offset, (r.end ?? r.start! + 4) + offset + 0.3)} title="Play this line">
                    ▶
                  </button>
                )}
                <button type="button" className="icon-btn small" onClick={() => apply(shiftLine(doc, line.id, -0.1))} title="Line 100 ms earlier">
                  ‹
                </button>
                <button type="button" className="icon-btn small" onClick={() => apply(shiftLine(doc, line.id, 0.1))} title="Line 100 ms later">
                  ›
                </button>
                <button type="button" className="icon-btn small" onClick={() => apply(mergeWithNext(doc, line.id))} title="Join with the next line">
                  ⤓
                </button>
                <button type="button" className="icon-btn small" onClick={() => apply(deleteLine(doc, line.id))} title="Delete line">
                  ×
                </button>
              </div>
            </li>
          )
        })}
      </ol>

      <form
        className="add-line"
        onSubmit={(e) => {
          e.preventDefault()
          const range = p.selection && p.selection.end - p.selection.start > 0.2 ? { start: p.selection.start - offset, end: p.selection.end - offset } : null
          apply(addLine(doc, newLine, range))
          setNewLine('')
        }}
      >
        <input
          value={newLine}
          onChange={(e) => setNewLine(e.target.value)}
          placeholder={p.selection ? 'Type a line; it will be spread over the selected time range' : 'Type a line to add (select a time range first to time it)'}
          aria-label="New lyric line"
          data-testid="new-line"
        />
        <button type="submit" className="btn btn-ghost btn-sm" disabled={!newLine.trim()}>
          Add line
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            const range = p.selection && p.selection.end - p.selection.start > 0.2 ? p.selection : { start: p.time, end: p.time + 8 }
            apply(addInstrumental(doc, 'Instrumental', { start: range.start - offset, end: range.end - offset }))
          }}
        >
          Mark instrumental
        </button>
      </form>

      {pasteOpen && (
        <PasteDialog
          canAlign={Boolean(timedSource && documentStats(timedSource).timed)}
          onCancel={() => setPasteOpen(false)}
          onApply={(text, align) => {
            setPasteOpen(false)
            apply(align && timedSource ? alignToTimings(text, timedSource) : parseLyrics(text, 'txt'), offset, 'manual')
            p.onNotice({
              tone: 'success',
              text: align ? 'Lyrics placed on the transcription’s timing. Untimed words are marked; check them while listening.' : 'Lyrics added. Time them with tap mode or from the playhead.'
            })
          }}
        />
      )}
    </div>
  )
}

function PasteDialog({ canAlign, onCancel, onApply }: { canAlign: boolean; onCancel: () => void; onApply: (text: string, align: boolean) => void }) {
  const [text, setText] = useState('')
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="dialog dialog-wide"
        onSubmit={(e) => {
          e.preventDefault()
          onApply(text, canAlign)
        }}
      >
        <h2>Paste the correct lyrics</h2>
        <p className="muted">
          {canAlign
            ? 'One line per line of the song. Timing is taken from the transcription wherever the words match; the rest is placed between them.'
            : 'One line per line of the song. There is no transcription to take timing from, so the words start untimed.'}{' '}
          This replaces the current lyrics (you can undo).
        </p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} autoFocus aria-label="Lyrics" data-testid="paste-text" />
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!text.trim()} data-testid="paste-apply">
            {canAlign ? 'Use and align' : 'Use these lyrics'}
          </button>
        </div>
      </form>
    </div>
  )
}
