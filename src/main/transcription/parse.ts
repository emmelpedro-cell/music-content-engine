import { z } from 'zod'
import { newId, type LyricDocument, type LyricLine, type LyricWord } from '../../shared/lyrics'

/**
 * whisper-cli `-ml 1 -sow -ojf` output: one segment per word, with offsets in
 * milliseconds and per-token probabilities. Only the fields used are declared.
 */
const TokenSchema = z.object({ text: z.string(), p: z.number().optional() }).passthrough()
const SegmentSchema = z
  .object({
    offsets: z.object({ from: z.number(), to: z.number() }),
    text: z.string(),
    tokens: z.array(TokenSchema).optional()
  })
  .passthrough()
export const WhisperOutputSchema = z
  .object({
    result: z.object({ language: z.string().optional() }).passthrough().optional(),
    transcription: z.array(SegmentSchema)
  })
  .passthrough()
export type WhisperOutput = z.infer<typeof WhisperOutputSchema>

/** whisper.cpp can emit raw control bytes inside strings; drop them so JSON.parse succeeds. */
export function parseWhisperJson(raw: Buffer | string): WhisperOutput {
  const text = (typeof raw === 'string' ? raw : raw.toString('utf8')).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  return WhisperOutputSchema.parse(JSON.parse(text))
}

const SPECIAL = /^\[_[A-Z]+_?\d*\]$|^\[[^\]]*\]$|^\([^)]*\)$|^[♪♫#*\s]+$/u
const PUNCTUATION_ONLY = /^[\p{P}\p{S}]+$/u
const SENTENCE_END = /[.!?…]["'”’)]*$/u

export type TranscriptToDocumentOptions = {
  /** Start a new line after a pause this long (seconds). */
  pause?: number
  /** Start a new line after this many words. */
  maxWordsPerLine?: number
}

/**
 * Turns word segments into lyric lines. A new line starts after sentence
 * punctuation, after a pause, where Whisper started a new phrase (it capitalises
 * the first word of each phrase; rap and fast singing often have no pauses), or
 * when a line gets long. Non-speech markers
 * such as "[Music]" or "♪" are dropped; lone punctuation joins the previous word.
 */
export function transcriptToDocument(output: WhisperOutput, options: TranscriptToDocumentOptions = {}): LyricDocument {
  const pause = options.pause ?? 0.8
  const maxWords = options.maxWordsPerLine ?? 12
  const words: LyricWord[] = []

  for (const segment of output.transcription) {
    const text = segment.text.trim()
    if (!text || SPECIAL.test(text)) continue
    if (PUNCTUATION_ONLY.test(text)) {
      const prev = words[words.length - 1]
      if (prev) prev.text = `${prev.text}${text}`
      continue
    }
    const probs = (segment.tokens ?? []).filter((t) => !t.text.startsWith('[_')).map((t) => t.p).filter((p): p is number => typeof p === 'number')
    const start = segment.offsets.from / 1000
    const end = Math.max(start, segment.offsets.to / 1000)
    words.push({
      id: newId('w'),
      text: text.slice(0, 200),
      start: round3(start),
      end: round3(end),
      confidence: probs.length ? round3(probs.reduce((a, b) => a + b, 0) / probs.length) : null
    })
  }

  const lines: LyricLine[] = []
  let current: LyricWord[] = []
  const flush = () => {
    if (current.length) lines.push({ id: newId('l'), kind: 'lyric', words: current })
    current = []
  }
  for (const word of words) {
    const prev = current[current.length - 1]
    const newPhrase = current.length >= 2 && PHRASE_START.test(word.text) && !ENGLISH_I.test(word.text)
    if (prev && ((word.start ?? 0) - (prev.end ?? 0) > pause || SENTENCE_END.test(prev.text) || newPhrase || current.length >= maxWords)) flush()
    current.push(word)
  }
  flush()
  return { version: 1, lines: collapseRepetitionLoops(lines) }
}

/** Whisper sometimes gets stuck repeating one phrase when the voice stops (a "repetition loop"). */
export const LOOP_MIN_REPEATS = 6
export const LOOP_LABEL = 'Repeated phrase removed (probably a transcription error) – check this part'

/**
 * Collapses a run of at least LOOP_MIN_REPEATS identical consecutive lines: the first
 * two are kept and the rest becomes a marked section, so the user can check it by ear.
 * Real choruses rarely repeat one line six times in a row; if they do, the marker says so.
 */
export function collapseRepetitionLoops(lines: LyricLine[]): LyricLine[] {
  const key = (l: LyricLine) => l.words.map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')).join(' ')
  const out: LyricLine[] = []
  let i = 0
  while (i < lines.length) {
    let j = i + 1
    const k = key(lines[i]!)
    while (k && j < lines.length && key(lines[j]!) === k) j++
    if (j - i >= LOOP_MIN_REPEATS) {
      // A loop often wobbles ("… ela se sobe" → "Pero que ela se sobe"): absorb near-copies too.
      while (j < lines.length && (key(lines[j]!) === k || overlap(key(lines[j]!), k) >= 0.6)) j++
      out.push(lines[i]!, lines[i + 1]!)
      const removed = lines.slice(i + 2, j)
      const start = removed[0]!.words[0]?.start ?? null
      const lastWords = removed[removed.length - 1]!.words
      const end = lastWords[lastWords.length - 1]?.end ?? null
      out.push({ id: newId('l'), kind: 'instrumental', words: [], label: LOOP_LABEL, start, end })
    } else {
      out.push(...lines.slice(i, j))
    }
    i = j
  }
  return out
}

/** Share of the words of `a` that also occur in `b`. */
function overlap(a: string, b: string): number {
  const wa = a.split(' ').filter(Boolean)
  if (!wa.length) return 0
  const wb = new Set(b.split(' '))
  return wa.filter((w) => wb.has(w)).length / wa.length
}

const PHRASE_START = /^["'¿¡(]?\p{Lu}(?:\p{Ll}|$)/u
const ENGLISH_I = /^I(?:'|’|$)/

const round3 = (v: number) => Math.round(v * 1000) / 1000
