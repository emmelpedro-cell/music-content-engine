import { Worker } from 'node:worker_threads'
import type { MusicAnalysis, Waveform } from '../../shared/analysis'
import { ProcessError } from '../media/run-process'
import type { WorkerRequest } from './worker'

export type AnalysisRunner = (
  input: WorkerRequest,
  signal?: AbortSignal
) => Promise<{ analysis: MusicAnalysis; waveform: Waveform }>

/** Runs one analysis in a fresh worker thread; aborting terminates the thread. */
export function workerRunner(workerPath: string): AnalysisRunner {
  return (input, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new ProcessError('ABORTED', 'Cancelled'))
      const worker = new Worker(workerPath)
      const onAbort = () => {
        void worker.terminate()
        reject(new ProcessError('ABORTED', 'Cancelled'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const done = () => {
        signal?.removeEventListener('abort', onAbort)
        void worker.terminate()
      }
      worker.once('message', (message: { ok: true; analysis: MusicAnalysis; waveform: Waveform } | { ok: false; message: string }) => {
        done()
        if (message.ok) resolve({ analysis: message.analysis, waveform: message.waveform })
        else reject(new Error(message.message))
      })
      worker.once('error', (error) => {
        done()
        reject(error)
      })
      worker.postMessage(input, [input.samples.buffer as ArrayBuffer])
    })
}
