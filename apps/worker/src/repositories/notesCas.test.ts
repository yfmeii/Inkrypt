import { describe, expect, it, vi } from 'vitest'
import type { D1Database } from '../cloudflare'
import { saveNoteRecord } from './notes'

function createDatabaseHarness(saved: boolean, changes = saved ? 1 : 0) {
  const sqlStatements: string[] = []
  const statementBindings: unknown[][] = []

  const database = {
    prepare: vi.fn((sql: string) => {
      sqlStatements.push(sql)
      const prepared = {
        sql,
        bindings: [] as unknown[],
        bind(...bindings: unknown[]) {
          prepared.bindings = bindings
          statementBindings.push(bindings)
          return prepared
        },
      }
      return prepared
    }),
    batch: vi.fn(async () => [
      {
        meta: { changes },
        results: saved ? [{ id: 'note-1' }] : [],
      },
      {
        meta: { changes: 0 },
        results: [{
          id: 'note-1', version: saved ? 2 : 1, change_seq: 2, updated_at: 2,
          is_deleted: 0, encrypted_data: 'cipher', data_iv: 'iv',
        }],
      },
    ]),
  } as unknown as D1Database

  return { database, sqlStatements, statementBindings }
}

const commonInput = {
  id: 'note-1',
  userId: 'user-1',
  updatedAt: 2,
  isDeleted: false,
  encryptedData: 'cipher',
  iv: 'iv',
}

describe('note CAS statements', () => {
  it('uses create-only INSERT for base version zero', async () => {
    const harness = createDatabaseHarness(true)
    await expect(saveNoteRecord(harness.database, {
      ...commonInput,
      baseVersion: 0,
    })).resolves.toMatchObject({ saved: true })

    const saveSql = harness.sqlStatements[0].replace(/\s+/g, ' ')
    expect(saveSql).toContain('INSERT INTO notes')
    expect(saveSql).toContain('ON CONFLICT(id) DO NOTHING')
    expect(saveSql).toContain('RETURNING id')
    expect(harness.statementBindings[0]).toEqual([
      'note-1', 'user-1', 2, 0, 'cipher', 'iv',
    ])
  })

  it('uses a user-scoped version-guarded UPDATE for existing notes', async () => {
    const harness = createDatabaseHarness(true)
    await expect(saveNoteRecord(harness.database, {
      ...commonInput,
      baseVersion: 7,
    })).resolves.toMatchObject({ saved: true })

    const saveSql = harness.sqlStatements[0].replace(/\s+/g, ' ')
    expect(saveSql).toContain('UPDATE notes')
    expect(saveSql).toContain('AND user_id = ?')
    expect(saveSql).toContain('AND version = ?')
    expect(saveSql).toContain('RETURNING id')
    expect(harness.statementBindings[0]).toEqual([
      'cipher', 'iv', 0, 2, 'note-1', 'user-1', 7,
    ])
  })

  it('returns the authoritative current record when the CAS changes no row', async () => {
    const harness = createDatabaseHarness(false)
    await expect(saveNoteRecord(harness.database, {
      ...commonInput,
      baseVersion: 7,
    })).resolves.toMatchObject({
      saved: false,
      current: { id: 'note-1', version: 1 },
    })
  })

  it('treats RETURNING as authoritative when triggers increase meta changes', async () => {
    const harness = createDatabaseHarness(true, 3)

    await expect(saveNoteRecord(harness.database, {
      ...commonInput,
      baseVersion: 7,
    })).resolves.toMatchObject({
      saved: true,
      current: { id: 'note-1', version: 2 },
    })
  })
})
