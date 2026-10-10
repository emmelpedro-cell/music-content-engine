import { describe, expect, it } from 'vitest'
import { phoneticKey, toLatin } from '../../src/shared/phonetic'

describe('phonetic keys', () => {
  it('transliterates Devanagari and Hangul', () => {
    expect(toLatin('सत्तेको')).toBe('satteko')
    expect(toLatin('जारिछ')).toBe('jaarichha')
    expect(toLatin('지번차')).toBe('jibeoncha')
  })

  it('gives the same skeleton to the same sounds in different scripts', () => {
    // Whisper heard "sangarsa jari cha" and wrote it in Devanagari.
    expect(phoneticKey('संगर से जारिछ')).toBe(phoneticKey('Sangarsa jari cha'))
    expect(phoneticKey('Satya ko khoji ko')).toBe('STKKJK')
    // b/v/w, p/f and r/l are merged; vowels don't count.
    expect(phoneticKey('jiwan')).toBe(phoneticKey('jiban'))
    expect(phoneticKey('falana')).toBe(phoneticKey('palana'))
  })
})
