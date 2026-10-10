import { describe, expect, it } from 'vitest'
import { LyricDocumentSchema, lineText, type LyricDocument } from '../../src/shared/lyrics'
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
} from '../../src/shared/lyric-edits'

function doc(): LyricDocument {
  return {
    version: 1,
    lines: [
      {
        id: 'l1',
        kind: 'lyric',
        words: [
          { id: 'a', text: 'Rumelaj,', start: 1, end: 1.5 },
          { id: 'b', text: 'rumelaj', start: 1.5, end: 2 },
          { id: 'c', text: 'vem', start: 2, end: 2.4 }
        ]
      },
      {
        id: 'l2',
        kind: 'lyric',
        words: [
          { id: 'd', text: 'Dança', start: 5, end: 5.5 },
          { id: 'e', text: 'comigo', start: null, end: null }
        ]
      }
    ]
  }
}

const texts = (d: LyricDocument) => d.lines.map(lineText)
const valid = (d: LyricDocument) => expect(LyricDocumentSchema.safeParse(d).success).toBe(true)

describe('lyric edit operations', () => {
  it('never mutates the input document', () => {
    const original = doc()
    const snapshot = JSON.stringify(original)
    setWordText(original, 'a', 'Rumelai')
    nudgeWord(original, 'a', 0.1)
    splitLineAt(original, 'b')
    shiftLine(original, 'l1', 1)
    expect(JSON.stringify(original)).toBe(snapshot)
  })

  it('finds words', () => {
    expect(findWord(doc(), 'e')).toEqual({ li: 1, wi: 1 })
    expect(findWord(doc(), 'zz')).toBeNull()
  })

  it('edits a word and marks it as edited', () => {
    const d = setWordText(doc(), 'a', 'Rumelai,')
    expect(d.lines[0]!.words[0]).toMatchObject({ text: 'Rumelai,', start: 1, end: 1.5, edited: true })
    valid(d)
  })

  it('splits a timed word into several, sharing its time span', () => {
    const d = setWordText(doc(), 'c', 'vem cá')
    const w = d.lines[0]!.words
    expect(w.map((x) => x.text)).toEqual(['Rumelaj,', 'rumelaj', 'vem', 'cá'])
    expect(w[2]).toMatchObject({ id: 'c', start: 2, end: 2.2 })
    expect(w[3]!.start).toBeCloseTo(2.2)
    expect(w[3]!.end).toBeCloseTo(2.4)
    valid(d)
  })

  it('deletes a word when its text is cleared, and drops emptied lines', () => {
    let d = setWordText(doc(), 'a', '   ')
    expect(texts(d)[0]).toBe('rumelaj vem')
    d = deleteWord(deleteWord(d, 'b'), 'c')
    expect(d.lines.map((l) => l.id)).toEqual(['l2'])
  })

  it('times a word from the playhead, keeping its length', () => {
    const d = setWordStart(doc(), 'a', 3.2)
    expect(d.lines[0]!.words[0]).toMatchObject({ start: 3.2, end: 3.7, edited: true })
    const untimed = setWordStart(doc(), 'e', 6)
    expect(untimed.lines[1]!.words[1]!.start).toBe(6)
    expect(untimed.lines[1]!.words[1]!.end).toBeCloseTo(6.35)
  })

  it('nudges a word without going below zero; untimed words are untouched', () => {
    expect(nudgeWord(doc(), 'a', -0.05).lines[0]!.words[0]).toMatchObject({ start: 0.95, end: 1.45 })
    expect(nudgeWord(doc(), 'a', -5).lines[0]!.words[0]!.start).toBe(0)
    expect(nudgeWord(doc(), 'e', 1).lines[1]!.words[1]!.start).toBeNull()
  })

  it('splits and merges lines', () => {
    const split = splitLineAt(doc(), 'b')
    expect(texts(split)).toEqual(['Rumelaj,', 'rumelaj vem', 'Dança comigo'])
    expect(splitLineAt(doc(), 'a')).toEqual(doc()) // first word: nothing to split
    const merged = mergeWithNext(split, split.lines[0]!.id)
    expect(texts(merged)).toEqual(['Rumelaj, rumelaj vem', 'Dança comigo'])
    valid(merged)
  })

  it('does not merge into an instrumental line', () => {
    const d = addInstrumental(doc(), 'Solo', { start: 3, end: 4.5 })
    expect(d.lines.map((l) => l.kind)).toEqual(['lyric', 'instrumental', 'lyric'])
    expect(mergeWithNext(d, 'l1')).toEqual(d)
  })

  it('shifts a whole line', () => {
    const d = shiftLine(doc(), 'l1', 0.25)
    expect(d.lines[0]!.words.map((w) => w.start)).toEqual([1.25, 1.75, 2.25])
    expect(d.lines[1]).toEqual(doc().lines[1])
  })

  it('shifts an instrumental section', () => {
    const d = addInstrumental(doc(), '', { start: 3, end: 4 })
    const id = d.lines[1]!.id
    const shifted = shiftLine(d, id, -0.5)
    expect(shifted.lines[1]).toMatchObject({ label: 'Instrumental', start: 2.5, end: 3.5 })
  })

  it('adds a typed line spread over a range, placed by time', () => {
    const d = addLine(doc(), 'O mar inteiro', { start: 3, end: 4.5 })
    expect(texts(d)).toEqual(['Rumelaj, rumelaj vem', 'O mar inteiro', 'Dança comigo'])
    expect(d.lines[1]!.words.map((w) => [w.start, w.end])).toEqual([
      [3, 3.5],
      [3.5, 4],
      [4, 4.5]
    ])
    valid(d)
  })

  it('adds untimed lines at the end, or after a given line', () => {
    expect(texts(addLine(doc(), 'fim', null)).at(-1)).toBe('fim')
    expect(texts(addLine(doc(), 'meio', null, 'l1'))).toEqual(['Rumelaj, rumelaj vem', 'meio', 'Dança comigo'])
    expect(texts(addLine(doc(), 'x', null, 'missing')).at(-1)).toBe('x')
    expect(addLine(doc(), '   ', null)).toEqual(doc())
  })

  it('deletes a line', () => {
    expect(texts(deleteLine(doc(), 'l1'))).toEqual(['Dança comigo'])
  })

  it('walks words in order for tap-to-time', () => {
    expect(nextWordId(doc(), null)).toBe('e') // first untimed word
    expect(nextWordId(doc(), 'c')).toBe('d')
    expect(nextWordId(doc(), 'e')).toBeNull()
  })
})
