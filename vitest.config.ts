import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    // Tests use Node's built-in SQLite driver, not better-sqlite3, because
    // better-sqlite3 is compiled for Electron's ABI after `npm install`.
    pool: 'forks'
  }
})
