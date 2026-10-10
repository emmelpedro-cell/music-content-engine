import { useCallback, useEffect, useRef, useState } from 'react'

export type Player = {
  audioRef: React.RefObject<HTMLAudioElement | null>
  time: number
  playing: boolean
  duration: number
  play: (from?: number, until?: number) => void
  pause: () => void
  toggle: () => void
  seek: (t: number) => void
  clickTrack: boolean
  setClickTrack: (on: boolean) => void
}

/**
 * Wraps the workspace's <audio> element: playhead time at display rate,
 * optional stop point (for playing a hook), and an optional click on every
 * beat so markers can be checked by ear.
 */
export function usePlayer(beats: number[], downbeats: number[]): Player {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [clickTrack, setClickTrack] = useState(false)
  const stopAt = useRef<number | null>(null)
  const lastTime = useRef(0)
  const ctx = useRef<AudioContext | null>(null)
  const beatsRef = useRef(beats)
  const downRef = useRef(new Set(downbeats))
  const clickRef = useRef(clickTrack)
  beatsRef.current = beats
  downRef.current = new Set(downbeats)
  clickRef.current = clickTrack

  const click = useCallback((accent: boolean) => {
    ctx.current ??= new AudioContext()
    const ac = ctx.current
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.frequency.value = accent ? 1760 : 1100
    gain.gain.setValueAtTime(accent ? 0.5 : 0.3, ac.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.05)
    osc.connect(gain).connect(ac.destination)
    osc.start()
    osc.stop(ac.currentTime + 0.06)
  }, [])

  useEffect(() => {
    let frame = 0
    const loop = () => {
      const audio = audioRef.current
      if (audio) {
        const t = audio.currentTime
        if (!audio.paused) {
          if (clickRef.current) {
            for (const b of beatsRef.current) {
              if (b > lastTime.current && b <= t) click(downRef.current.has(b))
            }
          }
          if (stopAt.current !== null && t >= stopAt.current) {
            audio.pause()
            stopAt.current = null
          }
        }
        lastTime.current = t
        setTime(t)
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [click])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onPause)
    audio.addEventListener('loadedmetadata', onMeta)
    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onPause)
      audio.removeEventListener('loadedmetadata', onMeta)
    }
  })

  useEffect(() => () => void ctx.current?.close(), [])

  const seek = useCallback((t: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, t)
    lastTime.current = audio.currentTime
    setTime(audio.currentTime)
  }, [])

  const play = useCallback(
    (from?: number, until?: number) => {
      const audio = audioRef.current
      if (!audio) return
      if (from !== undefined) seek(from)
      stopAt.current = until ?? null
      void audio.play().catch(() => undefined)
    },
    [seek]
  )

  const pause = useCallback(() => audioRef.current?.pause(), [])
  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) play()
    else audio.pause()
  }, [play])

  return { audioRef, time, playing, duration, play, pause, toggle, seek, clickTrack, setClickTrack }
}
