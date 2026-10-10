import { useCallback, useEffect, useRef, useState } from 'react'
import type { BeatMap, Waveform } from '../../../shared/analysis'
import type { Hook } from '../../../shared/hooks'
import type { LyricDocument } from '../../../shared/lyrics'

export type Selection = { start: number; end: number }

type Props = {
  duration: number
  waveform: Waveform | null
  beatMap: BeatMap | null
  energy: number[] | null
  energyRate: number
  hooks: Hook[]
  lyrics: LyricDocument | null
  lyricsOffset: number
  selectedWordId: string | null
  time: number
  playing: boolean
  selection: Selection | null
  onSeek: (t: number) => void
  onSelect: (s: Selection | null) => void
}

const HEIGHT = 206
const RULER = 30
const WAVE_TOP = RULER
const WAVE_H = 96
const HOOKS_TOP = WAVE_TOP + WAVE_H + 6
const HOOKS_H = 22
const LYRICS_TOP = HOOKS_TOP + HOOKS_H + 6
const LYRICS_H = HEIGHT - LYRICS_TOP - 4
const MIN_ZOOM = 4
const MAX_ZOOM = 800

function css(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

export function formatClock(t: number, precise = false): string {
  if (!Number.isFinite(t)) return '–'
  const sign = t < 0 ? '-' : ''
  const a = Math.abs(t)
  const m = Math.floor(a / 60)
  const s = a - m * 60
  return `${sign}${m}:${precise ? s.toFixed(2).padStart(5, '0') : String(Math.floor(s)).padStart(2, '0')}`
}

/**
 * Canvas timeline: ruler with bar numbers, waveform with energy curve and beat
 * grid, hooks lane, lyrics lane, selection and playhead. Only the visible part
 * is drawn; a native scrollbar handles horizontal scrolling.
 */
export function Timeline(p: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState<number | null>(null) // px per second; null = fit
  const [width, setWidth] = useState(800)
  const [scroll, setScroll] = useState(0)
  const [follow, setFollow] = useState(true)
  const drag = useRef<{ x0: number; t0: number; moved: boolean } | null>(null)

  const fit = width / Math.max(1, p.duration)
  const pps = Math.min(MAX_ZOOM, Math.max(Math.min(fit, MIN_ZOOM), zoom ?? fit))
  const total = Math.max(width, p.duration * pps)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !p.playing || !follow) return
    const x = p.time * pps
    if (x < el.scrollLeft || x > el.scrollLeft + width - 40) el.scrollLeft = Math.max(0, x - width * 0.2)
  }, [p.time, p.playing, follow, pps, width])

  const timeAt = useCallback(
    (clientX: number) => {
      const el = scrollRef.current!
      const rect = el.getBoundingClientRect()
      return Math.min(p.duration, Math.max(0, (clientX - rect.left + el.scrollLeft) / pps))
    },
    [pps, p.duration]
  )

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(HEIGHT * dpr)
    const g = canvas.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, HEIGHT)

    const accent = css('--accent', '#e8a33d')
    const text = css('--text', '#ecebe7')
    const muted = css('--text-muted', '#8f8e95')
    const faint = css('--text-faint', '#5f5e66')
    const line = css('--line', '#2a2b31')
    const t0 = scroll / pps
    const t1 = (scroll + width) / pps
    const X = (t: number) => t * pps - scroll

    g.fillStyle = '#111215'
    g.fillRect(0, WAVE_TOP, width, WAVE_H)

    // Selection behind everything.
    if (p.selection) {
      g.fillStyle = 'rgba(255,255,255,0.08)'
      g.fillRect(X(p.selection.start), RULER, (p.selection.end - p.selection.start) * pps, HEIGHT - RULER)
    }

    // Waveform.
    if (p.waveform) {
      const peaks = new Int8Array(p.waveform.peaks.buffer, p.waveform.peaks.byteOffset, p.waveform.peaks.byteLength)
      const count = peaks.length / 2
      const mid = WAVE_TOP + WAVE_H / 2
      g.fillStyle = 'rgba(236,235,231,0.42)'
      for (let x = 0; x < width; x++) {
        const a = Math.floor(((x + scroll) / pps) * p.waveform.rate)
        const b = Math.max(a + 1, Math.floor(((x + 1 + scroll) / pps) * p.waveform.rate))
        if (a >= count) break
        let lo = 0
        let hi = 0
        for (let i = Math.max(0, a); i < Math.min(count, b); i++) {
          lo = Math.min(lo, peaks[i * 2]!)
          hi = Math.max(hi, peaks[i * 2 + 1]!)
        }
        const y1 = mid - (hi / 127) * (WAVE_H / 2 - 2)
        const y2 = mid - (lo / 127) * (WAVE_H / 2 - 2)
        g.fillRect(x, y1, 1, Math.max(1, y2 - y1))
      }
    }

    // Energy curve.
    if (p.energy?.length) {
      g.strokeStyle = 'rgba(79,179,138,0.75)'
      g.lineWidth = 1.25
      g.beginPath()
      const start = Math.max(0, Math.floor(t0 * p.energyRate) - 1)
      const end = Math.min(p.energy.length - 1, Math.ceil(t1 * p.energyRate) + 1)
      for (let i = start; i <= end; i++) {
        const x = X(i / p.energyRate)
        const y = WAVE_TOP + WAVE_H - 3 - p.energy[i]! * (WAVE_H - 8)
        if (i === start) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
    }

    // Beat grid and bar numbers.
    if (p.beatMap) {
      const downs = new Set(p.beatMap.downbeats)
      const showBeats = pps * (60 / (p.beatMap.bpm || 120)) > 5
      let bar = 0
      g.font = '10px "Cascadia Mono", Consolas, monospace'
      for (const b of p.beatMap.beats) {
        const isDown = downs.has(b)
        if (isDown) bar++
        if (b < t0 - 1 || b > t1 + 1) continue
        if (!isDown && !showBeats) continue
        const x = Math.round(X(b)) + 0.5
        g.strokeStyle = isDown ? accent : 'rgba(232,163,61,0.35)'
        g.globalAlpha = isDown ? 0.9 : 1
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(x, isDown ? RULER - 13 : WAVE_TOP)
        g.lineTo(x, WAVE_TOP + WAVE_H)
        g.stroke()
        g.globalAlpha = 1
        if (isDown && (pps * (60 / (p.beatMap.bpm || 120)) * p.beatMap.beatsPerBar > 26 || bar % 4 === 1)) {
          g.fillStyle = accent
          g.fillText(String(bar), x + 3, RULER - 4)
        }
      }
    }

    // Time ruler.
    g.fillStyle = muted
    g.font = '10px "Cascadia Mono", Consolas, monospace'
    const step = [1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * pps >= 70) ?? 300
    for (let t = Math.floor(t0 / step) * step; t <= t1; t += step) {
      const x = Math.round(X(t)) + 0.5
      g.strokeStyle = line
      g.beginPath()
      g.moveTo(x, 2)
      g.lineTo(x, 12)
      g.stroke()
      g.fillText(formatClock(t), x + 3, 11)
    }
    g.strokeStyle = line
    g.beginPath()
    g.moveTo(0, RULER + 0.5)
    g.lineTo(width, RULER + 0.5)
    g.stroke()

    // Hooks lane.
    g.font = '11px "Segoe UI", system-ui, sans-serif'
    for (const h of p.hooks) {
      if (h.end < t0 || h.start > t1) continue
      const x = X(h.start)
      const w = (h.end - h.start) * pps
      g.fillStyle = 'rgba(76,155,232,0.22)'
      g.fillRect(x, HOOKS_TOP, w, HOOKS_H)
      g.fillStyle = 'rgba(76,155,232,0.9)'
      g.fillRect(x, HOOKS_TOP, 2, HOOKS_H)
      g.fillStyle = text
      g.save()
      g.beginPath()
      g.rect(x, HOOKS_TOP, w, HOOKS_H)
      g.clip()
      g.fillText(h.name, x + 6, HOOKS_TOP + 15)
      g.restore()
    }

    // Lyrics lane.
    if (p.lyrics) {
      for (const l of p.lyrics.lines) {
        if (l.kind === 'instrumental') {
          if (l.start == null || l.end == null) continue
          const x = X(l.start + p.lyricsOffset)
          g.fillStyle = 'rgba(167,123,224,0.18)'
          g.fillRect(x, LYRICS_TOP, (l.end - l.start) * pps, LYRICS_H)
          g.fillStyle = muted
          g.fillText(l.label || 'Instrumental', x + 4, LYRICS_TOP + 15)
          continue
        }
        for (const w of l.words) {
          if (w.start == null) continue
          const s = w.start + p.lyricsOffset
          const e = (w.end ?? w.start + 0.3) + p.lyricsOffset
          if (e < t0 || s > t1) continue
          const x = X(s)
          const wpx = Math.max(2, (e - s) * pps - 1)
          const selected = w.id === p.selectedWordId
          g.fillStyle = selected ? accent : w.edited ? 'rgba(236,235,231,0.24)' : 'rgba(236,235,231,0.14)'
          g.fillRect(x, LYRICS_TOP, wpx, LYRICS_H)
          if (wpx > 14) {
            g.fillStyle = selected ? '#141414' : text
            g.save()
            g.beginPath()
            g.rect(x, LYRICS_TOP, wpx, LYRICS_H)
            g.clip()
            g.fillText(w.text, x + 3, LYRICS_TOP + 16)
            g.restore()
          }
        }
      }
    }

    // Lane labels.
    g.fillStyle = faint
    g.font = '9px "Cascadia Mono", Consolas, monospace'
    g.fillText('HOOKS', 4, HOOKS_TOP - 1)
    g.fillText('LYRICS', 4, LYRICS_TOP - 1)

    // Playhead.
    const px = Math.round(X(p.time)) + 0.5
    if (px >= 0 && px <= width) {
      g.strokeStyle = '#ffffff'
      g.lineWidth = 1.5
      g.beginPath()
      g.moveTo(px, 0)
      g.lineTo(px, HEIGHT)
      g.stroke()
    }
  }, [p, width, scroll, pps])

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const el = scrollRef.current!
    const cursorT = timeAt(e.clientX)
    const next = Math.min(MAX_ZOOM, Math.max(Math.min(fit, MIN_ZOOM), pps * (e.deltaY < 0 ? 1.25 : 0.8)))
    setZoom(next)
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, cursorT * next - (e.clientX - el.getBoundingClientRect().left))
    })
  }

  const zoomBy = (factor: number) => {
    const el = scrollRef.current!
    const centerT = (el.scrollLeft + width / 2) / pps
    const next = Math.min(MAX_ZOOM, Math.max(Math.min(fit, MIN_ZOOM), pps * factor))
    setZoom(next)
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, centerT * next - width / 2)
    })
  }

  return (
    <div className="timeline" data-testid="timeline">
      <div
        ref={scrollRef}
        className="timeline-scroll"
        onScroll={(e) => setScroll(e.currentTarget.scrollLeft)}
        onWheel={onWheel}
        onPointerDown={(e) => {
          if (e.button !== 0 || e.clientY - e.currentTarget.getBoundingClientRect().top > HEIGHT) return
          ;(e.target as Element).setPointerCapture(e.pointerId)
          drag.current = { x0: e.clientX, t0: timeAt(e.clientX), moved: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          if (Math.abs(e.clientX - d.x0) > 4) d.moved = true
          if (d.moved) {
            const t = timeAt(e.clientX)
            p.onSelect({ start: Math.min(d.t0, t), end: Math.max(d.t0, t) })
          }
        }}
        onPointerUp={(e) => {
          const d = drag.current
          drag.current = null
          if (!d) return
          if (!d.moved) {
            p.onSelect(null)
            p.onSeek(timeAt(e.clientX))
          }
        }}
      >
        <div style={{ width: total, height: HEIGHT }} />
        <canvas
          ref={canvasRef}
          className="timeline-canvas"
          style={{ width, height: HEIGHT, left: scroll }}
          aria-label="Song timeline: waveform, beats, hooks and lyrics"
          role="img"
        />
      </div>
      <div className="timeline-tools">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => zoomBy(0.66)} aria-label="Zoom out">
          −
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setZoom(null)}>
          Fit
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => zoomBy(1.5)} aria-label="Zoom in">
          +
        </button>
        <label className="check">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow playhead
        </label>
        <span className="muted small">Click to move the playhead · drag to select · Ctrl + wheel to zoom</span>
      </div>
    </div>
  )
}
