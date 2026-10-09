import { createHash } from 'node:crypto'
import { transaction, type SqlDriver } from './driver'

export type Migration = {
  /** Strictly increasing, never reused. */
  version: number
  name: string
  sql: string
}

/**
 * Append-only list. Never edit a migration that has shipped: add a new one.
 * The runner stores a checksum and refuses to start if an applied migration
 * was changed, so accidental edits are caught instead of silently diverging.
 *
 * Phase 0 only creates what Phase 0 uses. Media, analysis, lyrics, hooks,
 * presets, edits, batches and render jobs arrive with the phases that need them.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'songs_and_settings',
    sql: `
      CREATE TABLE songs (
        id                TEXT PRIMARY KEY NOT NULL,
        title             TEXT NOT NULL CHECK (length(trim(title)) > 0),
        artist            TEXT,
        source_audio_path TEXT,
        duration_seconds  REAL CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE INDEX idx_songs_updated_at ON songs (updated_at DESC);

      CREATE TABLE app_settings (
        key        TEXT PRIMARY KEY NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  }
]

export class MigrationError extends Error {
  override name = 'MigrationError'
}

type AppliedRow = { version: number; name: string; checksum: string }

export function checksum(migration: Migration): string {
  return createHash('sha256').update(migration.sql.trim()).digest('hex')
}

export function latestVersion(migrations: readonly Migration[] = MIGRATIONS): number {
  return migrations.reduce((max, m) => Math.max(max, m.version), 0)
}

function ensureMigrationsTable(db: SqlDriver): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY NOT NULL,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
}

export function getAppliedMigrations(db: SqlDriver): AppliedRow[] {
  ensureMigrationsTable(db)
  return db
    .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
    .all() as AppliedRow[]
}

export function currentSchemaVersion(db: SqlDriver): number {
  const rows = getAppliedMigrations(db)
  return rows.length ? Math.max(...rows.map((r) => Number(r.version))) : 0
}

function validateList(migrations: readonly Migration[]): void {
  let previous = 0
  for (const m of migrations) {
    if (!Number.isInteger(m.version) || m.version <= previous) {
      throw new MigrationError(
        `Migration list is invalid: version ${m.version} (${m.name}) must be an integer greater than ${previous}.`
      )
    }
    previous = m.version
  }
}

/** Returns migrations that still have to run, after verifying the applied ones. */
export function pendingMigrations(
  db: SqlDriver,
  migrations: readonly Migration[] = MIGRATIONS
): Migration[] {
  validateList(migrations)
  const applied = getAppliedMigrations(db)
  const known = new Map(migrations.map((m) => [m.version, m]))
  const latestKnown = latestVersion(migrations)

  for (const row of applied) {
    const version = Number(row.version)
    if (version > latestKnown) {
      throw new MigrationError(
        `The database was created by a newer version of the app (schema v${version}, this build supports up to v${latestKnown}). ` +
          'Update the app, or restore a database backup from the "backups" folder.'
      )
    }
    const migration = known.get(version)
    if (!migration) {
      throw new MigrationError(`Applied migration v${version} (${row.name}) is missing from this build.`)
    }
    if (checksum(migration) !== row.checksum) {
      throw new MigrationError(
        `Migration v${version} (${row.name}) was modified after it was applied. Shipped migrations must never change; add a new migration instead.`
      )
    }
  }

  const appliedVersions = new Set(applied.map((r) => Number(r.version)))
  return migrations.filter((m) => !appliedVersions.has(m.version))
}

/**
 * Applies pending migrations, each in its own transaction, so a failure
 * leaves the database at the last fully applied version.
 */
export function runMigrations(
  db: SqlDriver,
  migrations: readonly Migration[] = MIGRATIONS,
  now: () => string = () => new Date().toISOString()
): { from: number; to: number; applied: number[] } {
  const from = currentSchemaVersion(db)
  const pending = pendingMigrations(db, migrations)
  const applied: number[] = []

  for (const migration of pending) {
    try {
      transaction(db, () => {
        db.exec(migration.sql)
        db.prepare(
          'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)'
        ).run(migration.version, migration.name, checksum(migration), now())
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new MigrationError(
        `Migration v${migration.version} (${migration.name}) failed and was rolled back: ${reason}`
      )
    }
    applied.push(migration.version)
  }

  return { from, to: currentSchemaVersion(db), applied }
}
