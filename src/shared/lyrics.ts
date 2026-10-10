import { phoneticKey } from './phonetic'
import { z } from 'zod'

/* ------------------------------------------------------------------ */
/* Document model                                                     */
/* ------------------------------------------------------------------ */

const time = z.number().min(0).max(24 * 3600).nullable()

export const LyricWordSchema = z
  .object({
    id: z.string().min(1).max(64),
    text: z.string().min(1).max(200),
    /** Seconds from the start of the song audio; null = not timed yet. */
    start: time,
    end: time,
    /** Transcription confidence 0..1, if any. */
    confidence: z.number().min(0).max(1).nullable().optional(),
    /** Changed by the user (text or timing) after transcription/import. */
    edited: z.boolean().optional()
  })
  .strict()
export type LyricWord = z.infer<typeof LyricWordSchema>

export const LyricLineSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: z.enum(['lyric', 'instrumental']),
    words: z.array(LyricWordSchema).max(500),
    /** Instrumental passages: a label and an explicit time range. */
    label: z.string().max(200).optional(),
    start: time.optional(),
    end: time.optional()
  })
  .strict()
export type LyricLine = z.infer<typeof LyricLineSchema>

export const LyricDocumentSchema = z
  .object({ version: z.literal(1), lines: z.array(LyricLineSchema).max(3000) })
  .strict()
export type LyricDocument = z.infer<typeof LyricDocumentSchema>

export const EMPTY_LYRICS: LyricDocument = { version: 1, lines: [] }

export type LyricStatus = 'empty' | 'draft' | 'confirmed'
export type LyricSource = 'transcription' | 'import' | 'manual' | null

export type TranscriptionStatus = 'none' | 'pending' | 'processing' | 'ready' | 'error'

export type LyricsState = {
  songId: string
  status: LyricStatus
  source: LyricSource
  language: string | null
  /** The user's version. */
  document: LyricDocument
  /** The last automatic transcription, kept unchanged for reference and re-alignment. */
  original: LyricDocument | null
  /** Shifts every timing (seconds), e.g. when the audio was re-exported with a different start. */
  offsetSeconds: number
  transcription: {
    status: TranscriptionStatus
    /** 0..1 while processing. */
    progress: number | null
    error: string | null
    model: string | null
  }
  updatedAt: string | null
}

export const SaveLyricsInputSchema = z
  .object({
    songId: z.string().uuid(),
    document: LyricDocumentSchema,
    offsetSeconds: z.number().min(-60).max(60),
    language: z.string().min(2).max(12).nullable(),
    source: z.enum(['transcription', 'import', 'manual']).nullable(),
    /** True when the user marks the lyrics as checked. Any other save is a draft. */
    confirm: z.boolean()
  })
  .strict()
export type SaveLyricsInput = z.infer<typeof SaveLyricsInputSchema>

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

let counter = 0
/** Ids only need to be unique within a document. */
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function wordsOf(doc: LyricDocument): LyricWord[] {
  return doc.lines.flatMap((l) => l.words)
}

export function lineText(line: LyricLine): string {
  return line.kind === 'instrumental' ? `[${line.label || 'Instrumental'}]` : line.words.map((w) => w.text).join(' ')
}

export function lineRange(line: LyricLine): { start: number | null; end: number | null } {
  if (line.kind === 'instrumental') return { start: line.start ?? null, end: line.end ?? null }
  const starts = line.words.map((w) => w.start).filter((t): t is number => t !== null)
  const ends = line.words.map((w) => w.end ?? w.start).filter((t): t is number => t !== null)
  return { start: starts.length ? Math.min(...starts) : null, end: ends.length ? Math.max(...ends) : null }
}

export function documentStats(doc: LyricDocument): { lines: number; words: number; timed: number } {
  const words = wordsOf(doc)
  return { lines: doc.lines.filter((l) => l.kind === 'lyric').length, words: words.length, timed: words.filter((w) => w.start !== null).length }
}

/** Plain text of the lyrics sung inside [start, end) (used for hooks). */
export function lyricsInRange(doc: LyricDocument, start: number, end: number, offset = 0): string {
  const lines: string[] = []
  for (const line of doc.lines) {
    if (line.kind !== 'lyric') continue
    const words = line.words.filter((w) => w.start !== null && w.start + offset >= start && w.start + offset < end)
    if (words.length) lines.push(words.map((w) => w.text).join(' '))
  }
  return lines.join('\n')
}

/** Spreads untimed words of a line evenly between known neighbours (or a given range). */
export function interpolateLine(line: LyricLine, fallback?: { start: number; end: number }): LyricLine {
  const words = line.words.map((w) => ({ ...w }))
  const known = words.map((w, i) => ({ i, t: w.start })).filter((k): k is { i: number; t: number } => k.t !== null)
  if (!known.length && fallback) {
    const step = (fallback.end - fallback.start) / Math.max(1, words.length)
    words.forEach((w, i) => {
      w.start = round3(fallback.start + i * step)
      w.end = round3(fallback.start + (i + 1) * step)
    })
    return { ...line, words }
  }
  for (let k = 0; k < known.length - 1; k++) {
    const a = known[k]!
    const b = known[k + 1]!
    for (let i = a.i + 1; i < b.i; i++) {
      words[i]!.start = round3(a.t + ((b.t - a.t) * (i - a.i)) / (b.i - a.i))
    }
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    if (w.start !== null && w.end === null) {
      const next = words.slice(i + 1).find((n) => n.start !== null)
      w.end = round3(next?.start ?? w.start + 0.4)
    }
  }
  return { ...line, words }
}

/* ------------------------------------------------------------------ */
/* Parsing files                                                      */
/* ------------------------------------------------------------------ */

export type LyricFormat = 'txt' | 'srt' | 'vtt' | 'lrc'

export function detectFormat(fileName: string, text: string): LyricFormat {
  const ext = fileName.toLowerCase().split('.').pop()
  if (ext === 'srt' || ext === 'vtt' || ext === 'lrc') return ext
  if (/^WEBVTT/.test(text.trimStart())) return 'vtt'
  if (/^\s*\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/m.test(text)) return 'lrc'
  if (/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(text)) return 'srt'
  return 'txt'
}

const tokenize = (text: string) => text.split(/\s+/).map((t) => t.trim()).filter(Boolean)

function textLine(text: string, range?: { start: number; end: number }): LyricLine {
  const line: LyricLine = {
    id: newId('l'),
    kind: 'lyric',
    words: tokenize(text).map((t) => ({ id: newId('w'), text: t.slice(0, 200), start: null, end: null }))
  }
  return range ? interpolateLine(line, range) : line
}

/** "00:01:02,345", "01:02.345", "1:02" → seconds. */
export function parseTimestamp(value: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(value.trim())
  if (!m) return null
  const [, h, min, s, frac] = m
  const fraction = frac ? Number(frac.padEnd(3, '0')) / 1000 : 0
  return (h ? Number(h) * 3600 : 0) + Number(min) * 60 + Number(s) + fraction
}

/**
 * Parses lyrics files into a document.
 * - TXT: one line per line, untimed. Lines like "[Instrumental]" or "(solo)" become instrumental markers.
 * - SRT / VTT: cue timing per line; words spread evenly inside each cue.
 * - LRC: [mm:ss.xx] line timing; enhanced LRC <mm:ss.xx> word timing is used when present.
 */
export function parseLyrics(text: string, format: LyricFormat): LyricDocument {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const lines: LyricLine[] = []

  if (format === 'txt') {
    for (const raw of clean.split('\n')) {
      const t = raw.trim()
      if (!t) continue
      const marker = /^[[(]\s*(instrumental|solo|intro|outro|interlude|break|drop|ponte|refrão|instrumental\s.*)\s*[\])]$/i.exec(t)
      if (marker) lines.push({ id: newId('l'), kind: 'instrumental', words: [], label: marker[1], start: null, end: null })
      else lines.push(textLine(t))
    }
    return { version: 1, lines }
  }

  if (format === 'srt' || format === 'vtt') {
    for (const block of clean.split(/\n{2,}/)) {
      const rows = block.split('\n').map((r) => r.trim()).filter(Boolean)
      const timing = rows.findIndex((r) => r.includes('-->'))
      if (timing < 0) continue
      const [a, b] = rows[timing]!.split('-->').map((p) => p.trim().split(/\s+/)[0]!)
      const start = parseTimestamp(a!)
      const end = parseTimestamp(b!)
      const body = rows.slice(timing + 1).join(' ').replace(/<[^>]+>/g, '').trim()
      if (start === null || end === null || !body) continue
      lines.push(textLine(body, { start, end: Math.max(end, start + 0.1) }))
    }
    return { version: 1, lines }
  }

  // LRC
  const entries: { time: number; body: string }[] = []
  for (const raw of clean.split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]/g)]
    if (!stamps.length) continue
    const body = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const s of stamps) {
      // "[mm:ss.xx]", or the "[mm:ss:xx]" variant some editors write.
      const t = parseTimestamp(s[1]!.replace(/^(\d{1,2}:\d{2}):(\d{1,3})$/, '$1.$2'))
      if (t !== null) entries.push({ time: t, body })
    }
  }
  entries.sort((a, b) => a.time - b.time)
  entries.forEach((entry, i) => {
    if (!entry.body) return
    const nextTime = entries[i + 1]?.time ?? entry.time + 4
    if (/<\d{1,2}:\d{2}(?:\.\d{1,3})?>/.test(entry.body)) {
      // Enhanced LRC: "<00:12.10> word <00:12.50> word".
      const parts = [...entry.body.matchAll(/<(\d{1,2}:\d{2}(?:\.\d{1,3})?)>\s*([^<]*)/g)]
      const words: LyricWord[] = []
      parts.forEach((p, k) => {
        const start = parseTimestamp(p[1]!)
        const next = parts[k + 1] ? parseTimestamp(parts[k + 1]![1]!) : nextTime
        for (const token of tokenize(p[2] ?? '')) words.push({ id: newId('w'), text: token, start, end: next })
      })
      if (words.length) lines.push(interpolateLine({ id: newId('l'), kind: 'lyric', words }))
    } else {
      lines.push(textLine(entry.body, { start: entry.time, end: Math.max(nextTime, entry.time + 0.5) }))
    }
  })
  return { version: 1, lines }
}

/* ------------------------------------------------------------------ */
/* Aligning corrected text to transcription timings                   */
/* ------------------------------------------------------------------ */

const normalizeToken = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    // Drop Latin accents (so "dança" matches "danca"), but keep the vowel signs of scripts such
    // as Devanagari (Nepali, Hindi), which are part of the letters.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}']/gu, '')

/**
 * Takes lyrics typed or pasted by the user (correct text, no timing) and
 * transfers timings from a transcription (timed, but with recognition errors).
 * Words are matched with an edit-distance alignment; unmatched words get
 * times interpolated from their matched neighbours.
 */
export function alignToTimings(text: string, timed: LyricDocument): LyricDocument {
  const target = parseLyrics(text, 'txt')
  const source = wordsOf(timed).filter((w) => w.start !== null)
  const words = target.lines.flatMap((l) => l.words)
  if (!source.length || !words.length) return target

  const a = words.map((w) => normalizeToken(w.text))
  const b = source.map((w) => normalizeToken(w.text))
  const n = a.length
  const m = b.length
  // DP over (n+1)×(m+1); costs: match 0, substitution 1 (0.5 if similar), insert/delete 1.
  const cost = new Float32Array((n + 1) * (m + 1))
  const idx = (i: number, j: number) => i * (m + 1) + j
  for (let i = 0; i <= n; i++) cost[idx(i, 0)] = i
  for (let j = 0; j <= m; j++) cost[idx(0, j)] = j
  const sub = (x: string, y: string) => (x === y ? 0 : similar(x, y) ? 0.5 : 1)
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cost[idx(i, j)] = Math.min(
        cost[idx(i - 1, j - 1)]! + sub(a[i - 1]!, b[j - 1]!),
        cost[idx(i - 1, j)]! + 1,
        cost[idx(i, j - 1)]! + 1
      )
    }
  }
  // Backtrack: pair words matched (exactly or similar) with source timings.
  let timing = new Map<number, Timing>()
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const here = cost[idx(i, j)]!
    const s = sub(a[i - 1]!, b[j - 1]!)
    if (here === cost[idx(i - 1, j - 1)]! + s) {
      if (s < 1) timing.set(i - 1, source[j - 1]!)
      i--
      j--
    } else if (here === cost[idx(i - 1, j)]! + 1) i--
    else j--
  }

  // Few words in common (the transcription is in another script, or badly misheard, e.g.
  // Nepali rap typed in Latin letters vs. Whisper's Devanagari): match by sound instead.
  if (timing.size < words.length * PHONETIC_FALLBACK_BELOW) {
    const phonetic = alignPhonetic(words, source)
    if (phonetic.size > timing.size) timing = phonetic
  }

  let k = 0
  const lines = target.lines.map((line) => {
    if (line.kind !== 'lyric') return line
    const aligned: LyricLine = {
      ...line,
      words: line.words.map((w) => {
        const src = timing.get(k++)
        return src ? { ...w, start: src.start, end: src.end, confidence: src.confidence ?? null } : w
      })
    }
    return interpolateLine(aligned)
  })
  // Lines with no matched word at all: place them between neighbouring lines.
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!
    if (line.kind !== 'lyric' || line.words.some((w) => w.start !== null)) continue
    const prevEnd = lines.slice(0, li).map((l) => lineRange(l).end).filter((t): t is number => t !== null).pop()
    const nextStart = lines.slice(li + 1).map((l) => lineRange(l).start).find((t): t is number => t !== null)
    if (prevEnd !== undefined && nextStart !== undefined && nextStart > prevEnd) {
      lines[li] = interpolateLine(line, { start: prevEnd, end: nextStart })
    }
  }
  fillLineEdges(lines)
  return { version: 1, lines }
}

type Timing = { start: number | null; end: number | null; confidence?: number | null }

/** Below this share of words matched by spelling, also try matching by sound. */
const PHONETIC_FALLBACK_BELOW = 0.5

/**
 * Word-level alignment by sound (see phonetic.ts): two words match when their consonant
 * skeletons are close. Works across scripts; short words that sound alike are common, so
 * a match only counts when the skeletons are long enough to mean something.
 */
function alignPhonetic(words: LyricWord[], source: LyricWord[]): Map<number, Timing> {
  const a = words.map((w) => phoneticKey(w.text))
  const b = source.map((w) => phoneticKey(w.text))
  const n = a.length
  const m = b.length
  const result = new Map<number, Timing>()
  if (!n || !m) return result
  const distance = (x: string, y: string) => {
    if (!x || !y) return 1
    const dp = Array.from({ length: y.length + 1 }, (_, j) => j)
    for (let i = 1; i <= x.length; i++) {
      let prev = dp[0]!
      dp[0] = i
      for (let j = 1; j <= y.length; j++) {
        const tmp = dp[j]!
        dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1))
        prev = tmp
      }
    }
    return dp[y.length]! / Math.max(x.length, y.length)
  }
  // A word pair counts as the same word when at most a third of the sounds differ and
  // there are at least two sounds to compare.
  const same = (x: string, y: string) => Math.min(x.length, y.length) >= 2 && distance(x, y) <= 1 / 3
  const SKIP_TARGET = 1
  const SKIP_SOURCE = 0.5
  const cost = new Float32Array((n + 1) * (m + 1))
  const idx = (i: number, j: number) => i * (m + 1) + j
  for (let i = 1; i <= n; i++) cost[idx(i, 0)] = i * SKIP_TARGET
  // Free to skip transcription before and after the lyrics (intro, outro, partial lyrics).
  for (let j = 1; j <= m; j++) cost[idx(0, j)] = 0
  const matchCost = (i: number, j: number) => (same(a[i]!, b[j]!) ? 0 : 2)
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cost[idx(i, j)] = Math.min(
        cost[idx(i - 1, j - 1)]! + matchCost(i - 1, j - 1),
        cost[idx(i - 1, j)]! + SKIP_TARGET,
        cost[idx(i, j - 1)]! + SKIP_SOURCE
      )
    }
  }
  let i = n
  let j = 0
  for (let jj = 0; jj <= m; jj++) if (cost[idx(n, jj)]! < cost[idx(n, j)]! || (cost[idx(n, jj)] === cost[idx(n, j)] && jj > j)) j = jj
  while (i > 0 && j > 0) {
    const here = cost[idx(i, j)]!
    if (here === cost[idx(i - 1, j - 1)]! + matchCost(i - 1, j - 1)) {
      if (matchCost(i - 1, j - 1) === 0) result.set(i - 1, { start: source[j - 1]!.start, end: source[j - 1]!.end, confidence: null })
      i--
      j--
    } else if (here === cost[idx(i - 1, j)]! + SKIP_TARGET) i--
    else j--
  }
  return result
}

/** Typical length of one sung word, used to place unmatched words at the edges of a line. */
const WORD_SECONDS = 0.35

/**
 * Words before the first matched word of a line (or after the last) have nothing to
 * interpolate between. Place them just before / after their line's timed words, without
 * crossing into the neighbouring lines.
 */
function fillLineEdges(lines: LyricLine[]): void {
  let prevEnd = 0
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!
    if (line.kind !== 'lyric') {
      if (line.end != null) prevEnd = line.end
      continue
    }
    const words = line.words.map((w) => ({ ...w }))
    const first = words.findIndex((w) => w.start !== null)
    if (first < 0) continue
    if (first > 0) {
      const anchor = words[first]!.start!
      const from = Math.max(prevEnd, anchor - first * WORD_SECONDS)
      const step = (anchor - from) / first
      for (let i = 0; i < first; i++) {
        words[i]!.start = round3(from + i * step)
        words[i]!.end = round3(from + (i + 1) * step)
      }
    }
    let last = words.length - 1
    while (words[last]!.start === null) last--
    const trailing = words.length - 1 - last
    if (trailing > 0) {
      const nextStart = lines
        .slice(li + 1)
        .map((l) => lineRange(l).start)
        .find((t): t is number => t !== null)
      const from = words[last]!.end ?? words[last]!.start!
      const to = Math.min(nextStart ?? Infinity, from + trailing * WORD_SECONDS)
      const step = Math.max(0, to - from) / trailing
      for (let i = 1; i <= trailing; i++) {
        words[last + i]!.start = round3(from + (i - 1) * step)
        words[last + i]!.end = round3(from + i * step)
      }
    }
    lines[li] = { ...line, words }
    prevEnd = lineRange(lines[li]!).end ?? prevEnd
  }
}

function similar(x: string, y: string): boolean {
  if (!x || !y) return false
  if (x.startsWith(y) || y.startsWith(x)) return Math.min(x.length, y.length) >= 3
  // Levenshtein ≤ 1/3 of the longer word.
  const dp = Array.from({ length: x.length + 1 }, (_, i) => i)
  for (let j = 1; j <= y.length; j++) {
    let prev = dp[0]!
    dp[0] = j
    for (let i = 1; i <= x.length; i++) {
      const tmp = dp[i]!
      dp[i] = Math.min(dp[i]! + 1, dp[i - 1]! + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[x.length]! <= Math.max(x.length, y.length) / 3
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
