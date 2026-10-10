/**
 * Real-input FFT (radix-2, iterative) returning magnitudes. One instance per
 * frame size; buffers and twiddles are reused, so per-frame work allocates nothing.
 */
export class MagnitudeFft {
  private readonly re: Float64Array
  private readonly im: Float64Array
  private readonly cos: Float64Array
  private readonly sin: Float64Array
  private readonly rev: Uint32Array
  readonly window: Float64Array

  constructor(readonly size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two')
    this.re = new Float64Array(size)
    this.im = new Float64Array(size)
    this.cos = new Float64Array(size / 2)
    this.sin = new Float64Array(size / 2)
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size)
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size)
    }
    const bits = Math.log2(size)
    this.rev = new Uint32Array(size)
    for (let i = 0; i < size; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1)
      this.rev[i] = r
    }
    // Periodic Hann window.
    this.window = new Float64Array(size)
    for (let i = 0; i < size; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)
  }

  /**
   * Windowed magnitude spectrum of `input[offset .. offset+size)` (zero-padded
   * past the end), written into `out` (length size/2 + 1).
   */
  magnitudes(input: Float32Array, offset: number, out: Float64Array): void {
    const { size, re, im, rev, window } = this
    for (let i = 0; i < size; i++) {
      const j = offset + i
      re[rev[i]!] = j >= 0 && j < input.length ? input[j]! * window[i]! : 0
      im[rev[i]!] = 0
    }
    for (let len = 2; len <= size; len <<= 1) {
      const half = len >> 1
      const step = size / len
      for (let start = 0; start < size; start += len) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step]!
          const wi = this.sin[k * step]!
          const a = start + k
          const b = a + half
          const tr = re[b]! * wr - im[b]! * wi
          const ti = re[b]! * wi + im[b]! * wr
          re[b] = re[a]! - tr
          im[b] = im[a]! - ti
          re[a] = re[a]! + tr
          im[a] = im[a]! + ti
        }
      }
    }
    for (let k = 0; k <= size / 2; k++) out[k] = Math.hypot(re[k]!, im[k]!)
  }
}
