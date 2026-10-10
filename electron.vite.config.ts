import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // Runtime dependencies (better-sqlite3, zod) stay in node_modules.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // Audio analysis runs in a worker thread (src/main/analysis/run-in-worker.ts).
          'analysis-worker': resolve('src/main/analysis/worker.ts')
        }
      }
    }
  },
  preload: {
    // The preload runs in a sandboxed renderer and cannot require() packages,
    // so everything it uses is bundled. It only imports constants and types.
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: { input: resolve('src/renderer/index.html') }
    }
  }
})
