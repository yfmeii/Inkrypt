import { describe, expect, it, vi } from 'vitest'
import type { D1Database } from '../cloudflare'
import { deleteCredentialUnlessLast } from './credentials'
import { updateHandshakeJoin, updateHandshakePayload } from './handshakes'

type PreparedStatementHarness = {
  sql: string
  statements: string[]
  bindings: unknown[]
  allBindings: unknown[][]
  database: D1Database
}

function createPreparedStatementHarness(changes: number): PreparedStatementHarness {
  const harness: PreparedStatementHarness = {
    sql: '',
    statements: [],
    bindings: [],
    allBindings: [],
    database: {} as D1Database,
  }

  const statement = {
    bind: vi.fn((...bindings: unknown[]) => {
      harness.bindings = bindings
      harness.allBindings.push(bindings)
      return statement
    }),
    run: vi.fn(async () => ({ meta: { changes } })),
  }

  harness.database = {
    prepare: vi.fn((sql: string) => {
      harness.sql = sql
      harness.statements.push(sql)
      return statement
    }),
    batch: vi.fn(async (statements: unknown[]) => statements.map(() => ({ meta: { changes } }))),
  } as unknown as D1Database

  return harness
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

describe('atomic repository transitions', () => {
  it('claims a handshake join only while the session is unjoined and active', async () => {
    const harness = createPreparedStatementHarness(1)

    await expect(
      updateHandshakeJoin(harness.database, '123456', 'bob-key', 2_000, 1_000),
    ).resolves.toBe(true)

    const sql = normalizeSql(harness.statements[0] ?? '')
    expect(sql).toContain('bob_public_key IS NULL')
    expect(sql).toContain('encrypted_payload IS NULL')
    expect(sql).toContain('payload_iv IS NULL')
    expect(sql).toContain('expires_at > ?')
    expect(harness.bindings).toEqual(['bob-key', 2_000, '123456', 1_000])
  })

  it('reports a lost handshake join race when no row changes', async () => {
    const harness = createPreparedStatementHarness(0)

    await expect(
      updateHandshakeJoin(harness.database, '123456', 'bob-key', 2_000, 1_000),
    ).resolves.toBe(false)
  })

  it('confirms only the owner joined session with an empty payload', async () => {
    const harness = createPreparedStatementHarness(1)

    await expect(
      updateHandshakePayload(
        harness.database,
        '123456',
        'ciphertext',
        'iv',
        2_000,
        'alice-id',
        1_000,
      ),
    ).resolves.toBe(true)

    const sql = normalizeSql(harness.statements[0] ?? '')
    expect(sql).toContain('user_id = ?')
    expect(sql).toContain('bob_public_key IS NOT NULL')
    expect(sql).toContain('encrypted_payload IS NULL')
    expect(sql).toContain('payload_iv IS NULL')
    expect(sql).toContain('expires_at > ?')
    expect(harness.allBindings[0]).toEqual([
      'ciphertext',
      'iv',
      2_000,
      '123456',
      'alice-id',
      1_000,
    ])
  })

  it('deletes a credential only when another credential still exists', async () => {
    const harness = createPreparedStatementHarness(1)

    await expect(
      deleteCredentialUnlessLast(harness.database, 'user-1', 'credential-1'),
    ).resolves.toBe(true)

    const sql = normalizeSql(harness.sql)
    expect(sql).toContain('revoked_at IS NULL')
    expect(sql).toContain('other.id <> credentials.id')
    expect(harness.bindings.slice(-4)).toEqual([
      expect.any(Number),
      expect.any(Number),
      'credential-1',
      'user-1',
    ])
  })

  it('preserves the credential when it is the last one', async () => {
    const harness = createPreparedStatementHarness(0)

    await expect(
      deleteCredentialUnlessLast(harness.database, 'user-1', 'credential-1'),
    ).resolves.toBe(false)
  })
})
