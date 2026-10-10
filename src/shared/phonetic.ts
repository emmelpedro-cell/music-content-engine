/**
 * Rough phonetic keys for matching lyrics across scripts.
 *
 * Whisper sometimes writes sung words in another script than the lyrics (Nepali rap typed in
 * Latin letters comes back in Devanagari, or even in Hangul when it loses track of the
 * language). To line the user's lyrics up with the transcription's timings anyway, both are
 * reduced to a consonant skeleton in Latin letters, with sounds that are easily confused
 * merged (b/v/w, p/f, k/g, t/d, s/sh, r/l…).
 */

const DEVANAGARI_CONSONANTS: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'ng', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v', श: 'sh',
  ष: 'sh', स: 's', ह: 'h', क़: 'q', ख़: 'kh', ग़: 'g', ज़: 'z', ड़: 'r', ढ़: 'rh', फ़: 'f', य़: 'y'
}
const DEVANAGARI_VOWELS: Record<string, string> = {
  अ: 'a', आ: 'aa', इ: 'i', ई: 'ii', उ: 'u', ऊ: 'uu', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au',
  'ा': 'aa', 'ि': 'i', 'ी': 'ii', 'ु': 'u', 'ू': 'uu', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
  'ं': 'n', 'ँ': 'n', 'ः': 'h'
}

function devanagariToLatin(text: string): string {
  let out = ''
  const chars = [...text.normalize('NFC')]
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!
    const consonant = DEVANAGARI_CONSONANTS[c]
    if (consonant) {
      out += consonant
      const next = chars[i + 1]
      // Inherent vowel unless a vowel sign or virama follows.
      if (next !== '्' && !(next && DEVANAGARI_VOWELS[next] && next >= 'ा')) out += 'a'
      continue
    }
    if (c === '्') continue
    out += DEVANAGARI_VOWELS[c] ?? c
  }
  return out
}

const HANGUL_LEAD = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h']
const HANGUL_VOWEL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i']
const HANGUL_TAIL = ['', 'k', 'k', 'ks', 'n', 'nj', 'nh', 't', 'l', 'lk', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'p', 'ps', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't']

function hangulToLatin(text: string): string {
  let out = ''
  for (const c of text) {
    const code = c.codePointAt(0)! - 0xac00
    if (code < 0 || code > 11171) {
      out += c
      continue
    }
    out += HANGUL_LEAD[Math.floor(code / 588)]! + HANGUL_VOWEL[Math.floor((code % 588) / 28)]! + HANGUL_TAIL[code % 28]!
  }
  return out
}

/** Latin transliteration of Devanagari and Hangul; other text passes through. */
export function toLatin(text: string): string {
  return hangulToLatin(devanagariToLatin(text))
}

// Sound classes, longest first. Vowels, h, y and apostrophes are dropped.
const CLASSES: [RegExp, string][] = [
  [/chh|ch|c(?=[^h])|jh|j|z/g, 'J'],
  [/kh|gh|k|g|q|x/g, 'K'],
  [/th|dh|t|d/g, 'T'],
  [/ph|bh|p|b|f|v|w/g, 'P'],
  [/sh|s/g, 'S'],
  [/ng|n|m/g, 'N'],
  [/r|l/g, 'R']
]

/** Consonant skeleton of a word or text, e.g. "Jiwan cha" → "JPNJ", "जिल्बन्छ" → "JRPNJ". */
export function phoneticKey(text: string): string {
  let s = toLatin(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '')
  for (const [re, cls] of CLASSES) s = s.replace(re, cls)
  return s.replace(/[a-z]/g, '')
}
