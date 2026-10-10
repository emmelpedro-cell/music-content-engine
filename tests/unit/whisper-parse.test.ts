import { describe, expect, it } from 'vitest'
import { parseWhisperJson, transcriptToDocument } from '../../src/main/transcription/parse'
import { lineText } from '../../src/shared/lyrics'

/** Shape of `whisper-cli -ml 1 -sow -ojf` output (v1.8.4), recorded on Windows. */
function segment(text: string, from: number, to: number, p = 0.9) {
  return {
    timestamps: { from: '', to: '' },
    offsets: { from, to },
    text,
    tokens: [{ text: '[_BEG_]', p: 0.98 }, { text, p }]
  }
}
const output = {
  systeminfo: 'CPU',
  result: { language: 'en' },
  transcription: [
    segment('', 0, 120),
    segment(' The', 120, 330),
    segment(' quick', 330, 750),
    segment(' fox', 750, 1220, 0.5),
    segment('.', 1220, 1300),
    segment(' [Music]', 1300, 2000),
    segment(' ♪', 2000, 2100),
    segment(' Music', 4000, 4300),
    segment(' content', 4300, 4700),
    segment(' engine', 6000, 6400)
  ]
}

describe('whisper output', () => {
  it('turns word segments into timed lyric lines', () => {
    const doc = transcriptToDocument(parseWhisperJson(JSON.stringify(output)))
    // Sentence end splits the first line; a long pause splits the last.
    expect(doc.lines.map(lineText)).toEqual(['The quick fox.', 'Music content', 'engine'])
    const [the, quick, fox] = doc.lines[0]!.words
    expect(the).toMatchObject({ text: 'The', start: 0.12, end: 0.33 })
    expect(quick!.start).toBe(0.33)
    // Probability from the word token (the [_BEG_] marker is ignored).
    expect(fox!.confidence).toBe(0.5)
  })

  it('drops non-speech markers', () => {
    const doc = transcriptToDocument(parseWhisperJson(JSON.stringify(output)))
    expect(doc.lines.flatMap((l) => l.words).some((w) => /Music\]|♪/.test(w.text))).toBe(false)
  })

  it('breaks long lines', () => {
    const many = { transcription: Array.from({ length: 25 }, (_, i) => segment(` w${i}`, i * 300, i * 300 + 250)) }
    const doc = transcriptToDocument(parseWhisperJson(JSON.stringify(many)), { maxWordsPerLine: 10 })
    expect(doc.lines.map((l) => l.words.length)).toEqual([10, 10, 5])
  })

  it('tolerates raw control characters in the JSON', () => {
    const raw = JSON.stringify({ transcription: [segment(' ok', 0, 100)] }).replace(' ok', ' o\u0001k')
    expect(transcriptToDocument(parseWhisperJson(raw)).lines[0]!.words[0]!.text).toBe('ok')
  })

  it('rejects output that is not a transcription', () => {
    expect(() => parseWhisperJson('{"hello": 1}')).toThrow()
  })
})
