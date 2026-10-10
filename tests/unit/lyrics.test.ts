import { describe, expect, it } from 'vitest'
import {
  LyricDocumentSchema,
  alignToTimings,
  detectFormat,
  documentStats,
  interpolateLine,
  lineRange,
  lineText,
  lyricsInRange,
  parseLyrics,
  parseTimestamp,
  type LyricDocument
} from '../../src/shared/lyrics'

const texts = (doc: LyricDocument) => doc.lines.map(lineText)

describe('parseTimestamp', () => {
  it('parses SRT, VTT and LRC times', () => {
    expect(parseTimestamp('00:01:02,345')).toBeCloseTo(62.345)
    expect(parseTimestamp('01:02.5')).toBeCloseTo(62.5)
    expect(parseTimestamp('1:02:03.004')).toBeCloseTo(3723.004)
    expect(parseTimestamp('nope')).toBeNull()
  })
})

describe('parseLyrics', () => {
  it('reads plain text, with instrumental markers', () => {
    const doc = parseLyrics('﻿Rumelaj, rumelaj\r\n\r\n[Instrumental]\nOutra linha aqui\n(solo)\n', 'txt')
    expect(texts(doc)).toEqual(['Rumelaj, rumelaj', '[Instrumental]', 'Outra linha aqui', '[solo]'])
    expect(doc.lines[1]!.kind).toBe('instrumental')
    expect(documentStats(doc)).toEqual({ lines: 2, words: 5, timed: 0 })
    expect(LyricDocumentSchema.safeParse(doc).success).toBe(true)
  })

  it('reads SRT and spreads words across each cue', () => {
    const srt = `1\n00:00:01,000 --> 00:00:03,000\nfirst line here\n\n2\n00:00:04,500 --> 00:00:05,500\n<i>second</i> line\n`
    const doc = parseLyrics(srt, 'srt')
    expect(texts(doc)).toEqual(['first line here', 'second line'])
    const w = doc.lines[0]!.words
    expect(w[0]!.start).toBe(1)
    expect(w[1]!.start).toBeCloseTo(1.667, 2)
    expect(w[2]!.end).toBe(3)
    expect(lineRange(doc.lines[1]!)).toEqual({ start: 4.5, end: 5.5 })
  })

  it('reads WebVTT', () => {
    const vtt = `WEBVTT\n\n00:00.500 --> 00:02.000 align:start\nhello world\n`
    const doc = parseLyrics(vtt, 'vtt')
    expect(texts(doc)).toEqual(['hello world'])
    expect(doc.lines[0]!.words[0]!.start).toBe(0.5)
  })

  it('reads LRC line timing and enhanced word timing', () => {
    const lrc = `[ar:Luneta]\n[00:12.00]line one goes\n[00:15.50]<00:15.50>word <00:16.00>by <00:16.40>word\n[00:20.00]\n`
    const doc = parseLyrics(lrc, 'lrc')
    expect(texts(doc)).toEqual(['line one goes', 'word by word'])
    expect(doc.lines[0]!.words[0]!.start).toBe(12)
    expect(doc.lines[1]!.words.map((w) => w.start)).toEqual([15.5, 16, 16.4])
    expect(doc.lines[1]!.words[2]!.end).toBe(20)
  })

  it('detects the format from name or content', () => {
    expect(detectFormat('song.lrc', '')).toBe('lrc')
    expect(detectFormat('x.txt', 'WEBVTT\n')).toBe('vtt')
    expect(detectFormat('x', '[00:01.00] hi')).toBe('lrc')
    expect(detectFormat('x', '1\n00:00:01,000 --> 00:00:02,000\nhi')).toBe('srt')
    expect(detectFormat('notes', 'just words')).toBe('txt')
  })
})

describe('alignToTimings', () => {
  const transcript: LyricDocument = {
    version: 1,
    lines: [
      {
        id: 'l1',
        kind: 'lyric',
        words: [
          { id: 'a', text: 'Rumelai', start: 10, end: 10.5, confidence: 0.4 },
          { id: 'b', text: 'come', start: 10.6, end: 10.9 },
          { id: 'c', text: 'dance', start: 11, end: 11.4 },
          { id: 'd', text: 'with', start: 11.5, end: 11.7 },
          { id: 'e', text: 'me', start: 11.8, end: 12.2 },
          { id: 'f', text: 'tonight', start: 13, end: 13.6 }
        ]
      }
    ]
  }

  it('moves timings from a transcription onto corrected text', () => {
    const doc = alignToTimings('Rumelaj, come and dance with me\nTonight!', transcript)
    expect(texts(doc)).toEqual(['Rumelaj, come and dance with me', 'Tonight!'])
    const [w0, w1, w2, w3] = doc.lines[0]!.words
    expect(w0!.start).toBe(10) // "Rumelaj," matched "Rumelai" (similar)
    expect(w1!.start).toBe(10.6)
    expect(w3!.start).toBe(11) // "dance"
    // "and" wasn't in the transcription: placed between its neighbours.
    expect(w2!.start).toBeGreaterThan(10.6)
    expect(w2!.start).toBeLessThan(11)
    expect(doc.lines[1]!.words[0]!.start).toBe(13)
  })

  it('times unmatched words at the start or end of a line next to its matched words', () => {
    // Real case: Whisper heard "Trilhinho" where the singer sang "Treinei de fininho".
    const doc = alignToTimings('Treinei de fininho dance with me\nTonight oh yeah', transcript)
    const [l1, l2] = doc.lines
    expect(doc.lines.flatMap((l) => l.words).every((w) => w.start !== null)).toBe(true)
    // Leading words sit just before "dance" (11 s), at most ~0.35 s each, after time 0.
    const lead = l1!.words.slice(0, 3).map((w) => w.start!)
    expect(lead[0]).toBeGreaterThanOrEqual(11 - 3 * 0.35 - 1e-9)
    expect(lead[2]).toBeLessThan(11)
    expect([...lead].sort((x, y) => x - y)).toEqual(lead)
    // Trailing words follow "Tonight" (13 s) in order.
    const tail = l2!.words.map((w) => w.start!)
    expect(tail[0]).toBe(13)
    expect(tail[1]).toBeGreaterThan(13)
    expect(tail[2]).toBeGreaterThan(tail[1]!)
  })

  it('aligns lyrics in scripts with vowel signs (Nepali, Devanagari)', () => {
    const nepali: LyricDocument = {
      version: 1,
      lines: [
        {
          id: 'n',
          kind: 'lyric',
          words: [
            { id: '1', text: 'म', start: 1, end: 1.2 },
            { id: '2', text: 'गीत', start: 1.2, end: 1.6 },
            { id: '3', text: 'गाउँछु', start: 1.6, end: 2.2 }
          ]
        }
      ]
    }
    // Vowel signs (matras) are combining marks; they must survive normalisation.
    const doc = alignToTimings('म गीत गाउँछु', nepali)
    expect(doc.lines[0]!.words.map((w) => w.start)).toEqual([1, 1.2, 1.6])
  })

  it('leaves text untimed when there is nothing to align with', () => {
    const doc = alignToTimings('only text', { version: 1, lines: [] })
    expect(doc.lines[0]!.words.every((w) => w.start === null)).toBe(true)
  })
})

describe('helpers', () => {
  it('interpolates untimed words between timed ones', () => {
    const line = interpolateLine({
      id: 'l',
      kind: 'lyric',
      words: [
        { id: '1', text: 'a', start: 1, end: null },
        { id: '2', text: 'b', start: null, end: null },
        { id: '3', text: 'c', start: 2, end: 2.5 }
      ]
    })
    expect(line.words.map((w) => w.start)).toEqual([1, 1.5, 2])
    expect(line.words[0]!.end).toBe(1.5)
  })

  it('returns the lyrics sung inside a time range', () => {
    const doc = parseLyrics('[00:01.00]one two\n[00:05.00]three four\n[00:09.00]five', 'lrc')
    expect(lyricsInRange(doc, 4, 9)).toBe('three four')
    expect(lyricsInRange(doc, 0, 100)).toBe('one two\nthree four\nfive')
    expect(lyricsInRange(doc, 4, 9, -4)).toBe('five')
  })
})
