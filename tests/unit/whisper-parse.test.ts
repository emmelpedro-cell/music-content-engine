import { describe, expect, it } from 'vitest'
import { LOOP_LABEL, parseWhisperJson, transcriptToDocument } from '../../src/main/transcription/parse'
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

  it('starts a new line where Whisper starts a new phrase, even without a pause (rap)', () => {
    // Recorded from a real Portuguese rap verse: no gaps between words, phrases capitalised.
    const words = 'Pergunta onde eu vou Onde que eu tô Se o tempo acabou E tudo muda se só mudo o nome I know'.split(' ')
    const rap = { transcription: words.map((w, i) => segment(` ${w}`, i * 250, i * 250 + 250)) }
    expect(transcriptToDocument(parseWhisperJson(JSON.stringify(rap))).lines.map(lineText)).toEqual([
      'Pergunta onde eu vou',
      'Onde que eu tô',
      'Se o tempo acabou',
      'E tudo muda se só mudo o nome I know'
    ])
  })

  it('collapses a Whisper repetition loop into a marked section', () => {
    // Real case: after the last verse Whisper wrote one phrase 25 times while only the beat played.
    const phrase = 'Tipo quando ela se sobe'.split(' ')
    const segments = [segment(' É', 0, 200), segment(' difícil', 200, 600), segment(' ter', 600, 800), segment(' volta', 800, 1200)]
    for (let r = 0; r < 25; r++) {
      // One repetition drifts, as in the real output.
      const words = r === 19 ? ['Pero', 'que', 'ela', 'se', 'sobe'] : phrase
      words.forEach((w, i) => segments.push(segment(` ${w}`, 2000 + r * 1000 + i * 200, 2000 + r * 1000 + i * 200 + 200)))
    }
    const doc = transcriptToDocument(parseWhisperJson(JSON.stringify({ transcription: segments })))
    expect(doc.lines.map(lineText)).toEqual([
      'É difícil ter volta',
      'Tipo quando ela se sobe',
      'Tipo quando ela se sobe',
      `[${LOOP_LABEL}]`
    ])
    expect(doc.lines[3]).toMatchObject({ kind: 'instrumental', start: 4, end: 27 })
  })

  it('collapses one word repeated in a loop inside a line', () => {
    // Real case (Nepali): "फालाना थालाना थालाना थालाना …" twenty times in a row.
    const segments = [segment(' फालाना', 0, 500)]
    for (let r = 0; r < 20; r++) segments.push(segment(' थालाना', 500 + r * 100, 600 + r * 100))
    segments.push(segment(' अच्छ', 3000, 3400))
    const doc = transcriptToDocument(parseWhisperJson(JSON.stringify({ transcription: segments })))
    expect(doc.lines.map(lineText)).toEqual(['फालाना थालाना थालाना', `[${LOOP_LABEL}]`, 'अच्छ'])
  })

  it('keeps a line repeated a few times, like a real chorus', () => {
    const phrase = 'Tipo quando ela rebola'.split(' ')
    const segments: ReturnType<typeof segment>[] = []
    for (let r = 0; r < 4; r++) phrase.forEach((w, i) => segments.push(segment(` ${w}`, r * 1000 + i * 200, r * 1000 + i * 200 + 200)))
    expect(transcriptToDocument(parseWhisperJson(JSON.stringify({ transcription: segments }))).lines).toHaveLength(4)
  })

  it('tolerates raw control characters in the JSON', () => {
    const raw = JSON.stringify({ transcription: [segment(' ok', 0, 100)] }).replace(' ok', ' o\u0001k')
    expect(transcriptToDocument(parseWhisperJson(raw)).lines[0]!.words[0]!.text).toBe('ok')
  })

  it('rejects output that is not a transcription', () => {
    expect(() => parseWhisperJson('{"hello": 1}')).toThrow()
  })
})
