import { interpolateLine, newId, type LyricDocument, type LyricLine, type LyricWord } from '../../../shared/lyrics'

/** Pure edit operations on a lyric document; each returns a new document. */

const round3 = (v: number) => Math.round(v * 1000) / 1000

export function findWord(doc: LyricDocument, wordId: string): { li: number; wi: number } | null {
  for (let li = 0; li < doc.lines.length; li++) {
    const wi = doc.lines[li]!.words.findIndex((w) => w.id === wordId)
    if (wi >= 0) return { li, wi }
  }
  return null
}

function mapWord(doc: LyricDocument, wordId: string, fn: (w: LyricWord) => LyricWord): LyricDocument {
  return {
    ...doc,
    lines: doc.lines.map((l) => (l.words.some((w) => w.id === wordId) ? { ...l, words: l.words.map((w) => (w.id === wordId ? fn(w) : w)) } : l))
  }
}

export function setWordText(doc: LyricDocument, wordId: string, text: string): LyricDocument {
  const parts = text.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return deleteWord(doc, wordId)
  if (parts.length === 1) return mapWord(doc, wordId, (w) => ({ ...w, text: parts[0]!.slice(0, 200), edited: true }))
  // Typing several words splits the word; a timed word's span is shared between the parts.
  const pos = findWord(doc, wordId)
  if (!pos) return doc
  const line = doc.lines[pos.li]!
  const original = line.words[pos.wi]!
  const { start, end } = original
  const step = start !== null && end !== null ? (end - start) / parts.length : null
  const replacement: LyricWord[] = parts.map((t, i) => ({
    id: i === 0 ? original.id : newId('w'),
    text: t.slice(0, 200),
    start: step !== null ? round3(start! + i * step) : i === 0 ? start : null,
    end: step !== null ? round3(start! + (i + 1) * step) : null,
    edited: true
  }))
  const words = [...line.words.slice(0, pos.wi), ...replacement, ...line.words.slice(pos.wi + 1)]
  const lines = doc.lines.slice()
  lines[pos.li] = step !== null ? { ...line, words } : interpolateLine({ ...line, words })
  return { ...doc, lines }
}

export function setWordStart(doc: LyricDocument, wordId: string, start: number): LyricDocument {
  return mapWord(doc, wordId, (w) => {
    const s = Math.max(0, round3(start))
    const length = w.start !== null && w.end !== null ? w.end - w.start : 0.35
    return { ...w, start: s, end: round3(s + Math.max(0.05, length)), edited: true }
  })
}

export function nudgeWord(doc: LyricDocument, wordId: string, delta: number): LyricDocument {
  return mapWord(doc, wordId, (w) =>
    w.start === null ? w : { ...w, start: Math.max(0, round3(w.start + delta)), end: w.end === null ? null : Math.max(0, round3(w.end + delta)), edited: true }
  )
}

export function deleteWord(doc: LyricDocument, wordId: string): LyricDocument {
  return {
    ...doc,
    lines: doc.lines.map((l) => ({ ...l, words: l.words.filter((w) => w.id !== wordId) })).filter((l) => l.kind === 'instrumental' || l.words.length > 0)
  }
}

/** Splits the line so that `wordId` starts a new line. */
export function splitLineAt(doc: LyricDocument, wordId: string): LyricDocument {
  const pos = findWord(doc, wordId)
  if (!pos || pos.wi === 0) return doc
  const line = doc.lines[pos.li]!
  const first: LyricLine = { ...line, words: line.words.slice(0, pos.wi) }
  const second: LyricLine = { id: newId('l'), kind: 'lyric', words: line.words.slice(pos.wi) }
  const lines = doc.lines.slice()
  lines.splice(pos.li, 1, first, second)
  return { ...doc, lines }
}

export function mergeWithNext(doc: LyricDocument, lineId: string): LyricDocument {
  const li = doc.lines.findIndex((l) => l.id === lineId)
  const a = doc.lines[li]
  const b = doc.lines[li + 1]
  if (!a || !b || a.kind !== 'lyric' || b.kind !== 'lyric') return doc
  const lines = doc.lines.slice()
  lines.splice(li, 2, { ...a, words: [...a.words, ...b.words] })
  return { ...doc, lines }
}

export function shiftLine(doc: LyricDocument, lineId: string, delta: number): LyricDocument {
  return {
    ...doc,
    lines: doc.lines.map((l) =>
      l.id !== lineId
        ? l
        : l.kind === 'instrumental'
          ? { ...l, start: l.start == null ? l.start : Math.max(0, round3(l.start + delta)), end: l.end == null ? l.end : Math.max(0, round3(l.end + delta)) }
          : {
              ...l,
              words: l.words.map((w) =>
                w.start === null ? w : { ...w, start: Math.max(0, round3(w.start + delta)), end: w.end === null ? null : Math.max(0, round3(w.end + delta)), edited: true }
              )
            }
    )
  }
}

export function deleteLine(doc: LyricDocument, lineId: string): LyricDocument {
  return { ...doc, lines: doc.lines.filter((l) => l.id !== lineId) }
}

/** Adds a typed line; with a time range, its words are spread across it. */
export function addLine(doc: LyricDocument, text: string, range: { start: number; end: number } | null, afterLineId?: string): LyricDocument {
  const words: LyricWord[] = text
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ({ id: newId('w'), text: t.slice(0, 200), start: null, end: null, edited: true }))
  if (!words.length) return doc
  let line: LyricLine = { id: newId('l'), kind: 'lyric', words }
  if (range) line = interpolateLine(line, range)
  return insertLine(doc, line, afterLineId)
}

export function addInstrumental(doc: LyricDocument, label: string, range: { start: number; end: number }, afterLineId?: string): LyricDocument {
  return insertLine(doc, { id: newId('l'), kind: 'instrumental', words: [], label: label.slice(0, 200) || 'Instrumental', start: round3(range.start), end: round3(range.end) }, afterLineId)
}

function insertLine(doc: LyricDocument, line: LyricLine, afterLineId?: string): LyricDocument {
  const lines = doc.lines.slice()
  if (afterLineId) {
    const i = lines.findIndex((l) => l.id === afterLineId)
    lines.splice(i < 0 ? lines.length : i + 1, 0, line)
    return { ...doc, lines }
  }
  // Without an anchor, place it by time.
  const start = line.kind === 'instrumental' ? line.start ?? null : line.words[0]?.start ?? null
  if (start === null) return { ...doc, lines: [...lines, line] }
  const index = lines.findIndex((l) => {
    const s = l.kind === 'instrumental' ? l.start ?? null : l.words.find((w) => w.start !== null)?.start ?? null
    return s !== null && s > start
  })
  lines.splice(index < 0 ? lines.length : index, 0, line)
  return { ...doc, lines }
}

/** The next word (in document order) after `wordId`, or the first untimed word when null. */
export function nextWordId(doc: LyricDocument, wordId: string | null): string | null {
  const all = doc.lines.flatMap((l) => l.words)
  if (wordId === null) return (all.find((w) => w.start === null) ?? all[0])?.id ?? null
  const i = all.findIndex((w) => w.id === wordId)
  return all[i + 1]?.id ?? null
}
