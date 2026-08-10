import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const workerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDirectory = join(workerDirectory, 'migrations')
const temporaryDirectories: string[] = []

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'inkrypt-migration-'))
  temporaryDirectories.push(directory)
  return join(directory, 'database.sqlite')
}

function executeSql(databasePath: string, sql: string, options?: { expectFailure?: boolean }) {
  const result = spawnSync('sqlite3', ['-bail', databasePath], {
    encoding: 'utf8',
    input: `.bail on\n${sql}`,
  })

  if (!options?.expectFailure && result.status !== 0) {
    throw new Error(`SQLite command failed:\n${result.stderr}`)
  }

  return result
}

function queryJson<T>(databasePath: string, sql: string): T[] {
  const result = spawnSync('sqlite3', ['-json', databasePath, sql], {
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`SQLite query failed:\n${result.stderr}`)
  return JSON.parse(result.stdout || '[]') as T[]
}

function applyMigration(databasePath: string, filename: string, options?: { expectFailure?: boolean }) {
  const migrationSql = readFileSync(join(migrationsDirectory, filename), 'utf8')
  return executeSql(
    databasePath,
    `BEGIN IMMEDIATE;\n${migrationSql}\nCOMMIT;\n`,
    options,
  )
}

function preparePopulatedVersionSixDatabase(options?: { includeConflict?: boolean }): string {
  const databasePath = createDatabasePath()
  for (const filename of [
    '0001_init.sql',
    '0002_device_enrollments.sql',
    '0003_handshakes.sql',
    '0004_handshake_session_secret.sql',
    '0005_single_tenant_auth.sql',
    '0006_note_change_seq.sql',
  ]) {
    applyMigration(databasePath, filename)
  }

  executeSql(databasePath, `
    INSERT INTO users (id, username, current_challenge, created_at)
    VALUES ('user-1', 'vault', 'legacy-challenge', 100);

    INSERT INTO notes (
      id,
      user_id,
      version,
      updated_at,
      is_deleted,
      encrypted_data,
      data_iv
    ) VALUES (
      'note-1',
      'user-1',
      3,
      200,
      0,
      'ciphertext',
      'iv'
    );

    INSERT INTO device_enrollments (token, user_id, expires_at, created_at)
    VALUES ('plaintext-token', 'user-1', 1000, 100);

    ${options?.includeConflict ? `
      INSERT INTO note_conflicts (
        id,
        note_id,
        user_id,
        encrypted_data,
        data_iv,
        device_name,
        created_at
      ) VALUES (
        'conflict-1',
        'note-1',
        'user-1',
        'conflict-ciphertext',
        'conflict-iv',
        'Legacy device',
        300
      );
    ` : ''}
  `)

  return databasePath
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('0007_remove_legacy_protocols migration', () => {
  it('upgrades a populated version-six database without unresolved conflicts', () => {
    const databasePath = preparePopulatedVersionSixDatabase()

    applyMigration(databasePath, '0007_remove_legacy_protocols.sql')

    const retiredTables = queryJson<{ name: string }>(databasePath, `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('note_conflicts', 'device_enrollments');
    `)
    const userColumns = queryJson<{ name: string }>(databasePath, 'PRAGMA table_info(users);')
    const notes = queryJson<{ id: string; version: number; change_seq: number }>(databasePath, `
      SELECT id, version, change_seq FROM notes;
    `)

    expect(retiredTables).toEqual([])
    expect(userColumns.some((column) => column.name === 'current_challenge')).toBe(false)
    expect(notes).toEqual([{ id: 'note-1', version: 3, change_seq: 1 }])
  })

  it('fails atomically when unresolved conflict ciphertext still exists', () => {
    const databasePath = preparePopulatedVersionSixDatabase({ includeConflict: true })

    const migrationResult = applyMigration(
      databasePath,
      '0007_remove_legacy_protocols.sql',
      { expectFailure: true },
    )

    const legacyTables = queryJson<{ name: string }>(databasePath, `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('note_conflicts', 'device_enrollments')
      ORDER BY name;
    `)
    const userColumns = queryJson<{ name: string }>(databasePath, 'PRAGMA table_info(users);')
    const conflictCount = queryJson<{ count: number }>(databasePath, `
      SELECT COUNT(*) AS count FROM note_conflicts;
    `)

    expect(migrationResult.status).not.toBe(0)
    expect(migrationResult.stderr).toContain('CHECK constraint failed')
    expect(legacyTables).toEqual([
      { name: 'device_enrollments' },
      { name: 'note_conflicts' },
    ])
    expect(userColumns.some((column) => column.name === 'current_challenge')).toBe(true)
    expect(conflictCount).toEqual([{ count: 1 }])
  })
})
