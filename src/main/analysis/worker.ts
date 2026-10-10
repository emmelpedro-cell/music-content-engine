import { parentPort } from 'node:worker_threads'
import { analyzeSamples, waveformPeaks } from './analyze'

/**
 * Worker thread entry: the DSP is CPU-bound (a few seconds per song), so it
 * runs off the main process thread. One message in, one message out.
 */
export type WorkerRequest = { samples: Float32Array; sampleRate: number; beatsPerBar: number }

parentPort?.on('message', (request: WorkerRequest) => {
  try {
    const analysis = analyzeSamples({ samples: request.samples, sampleRate: request.sampleRate }, { beatsPerBar: request.beatsPerBar })
    const waveform = waveformPeaks({ samples: request.samples, sampleRate: request.sampleRate })
    parentPort!.postMessage({ ok: true, analysis, waveform }, [waveform.peaks.buffer as ArrayBuffer])
  } catch (error) {
    parentPort!.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) })
  }
})
