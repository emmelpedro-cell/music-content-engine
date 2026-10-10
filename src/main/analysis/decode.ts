import type { MediaTools } from '../media/binaries'
import { MediaReadError } from '../media/probe'
import { ProcessError, runProcess } from '../media/run-process'
import { ANALYSIS_SAMPLE_RATE } from './analyze'

/** Longest audio the analysis accepts (memory: ~5 MB per minute at 22.05 kHz mono float). */
export const MAX_ANALYSIS_MINUTES = 30

/**
 * Decodes the first audio stream to mono 32-bit float PCM at the analysis
 * sample rate. FFmpeg does the resampling and down-mixing.
 */
export async function decodeForAnalysis(
  tools: MediaTools,
  path: string,
  fileName: string,
  signal?: AbortSignal
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const maxBytes = ANALYSIS_SAMPLE_RATE * 4 * 60 * MAX_ANALYSIS_MINUTES
  try {
    const { stdoutBuffer } = await runProcess(
      tools.ffmpeg,
      ['-v', 'error', '-hide_banner', '-nostdin', '-i', path, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(ANALYSIS_SAMPLE_RATE), '-f', 'f32le', '-'],
      { signal, timeoutMs: 5 * 60_000, maxStdoutBytes: maxBytes }
    )
    // Copy into an aligned buffer (Node may hand back a slice of a shared pool).
    const samples = new Float32Array(Math.floor(stdoutBuffer.length / 4))
    new Uint8Array(samples.buffer).set(stdoutBuffer.subarray(0, samples.length * 4))
    return { samples, sampleRate: ANALYSIS_SAMPLE_RATE }
  } catch (error) {
    if (error instanceof ProcessError && error.code === 'OUTPUT_LIMIT') {
      throw new MediaReadError(`"${fileName}" is longer than ${MAX_ANALYSIS_MINUTES} minutes, which is the limit for analysis.`)
    }
    if (error instanceof ProcessError && error.code === 'EXIT') {
      throw new MediaReadError(`The audio of "${fileName}" could not be decoded.${error.stderrSummary ? ` (${error.stderrSummary})` : ''}`)
    }
    throw error
  }
}
