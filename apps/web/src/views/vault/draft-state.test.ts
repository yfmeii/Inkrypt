import { describe, expect, test } from 'vitest'
import type { NotePayload } from '../../lib/crypto'
import { buildDraftSyncState, isDraftDirty, normalizeDraftTags, parseDraftTags } from './draft-state'

function makeBaseline(overrides: Partial<NotePayload> = {}): NotePayload {
  return {
    meta: {
      title: 'Baseline title',
      created_at: 1712345678,
      tags: ['alpha', 'beta'],
      is_favorite: false,
    },
    content: 'Baseline body',
    attachments: {
      'a.txt': 'data:text/plain;base64,QQ==',
      'b.txt': 'data:text/plain;base64,Qg==',
    },
    ...overrides,
  }
}

describe('draft-state helpers', () => {
  test('normalizes and parses comma-separated tags consistently', () => {
    const rawTags = ' alpha, beta ,, gamma ,  , delta '

    expect(normalizeDraftTags(rawTags)).toBe('alpha, beta, gamma, delta')
    expect(parseDraftTags(rawTags)).toEqual(['alpha', 'beta', 'gamma', 'delta'])
  })

  test('builds sync state with trimmed title fallback and parsed tags', () => {
    expect(
      buildDraftSyncState({
        draftTitle: '   ',
        draftTags: ' one, two ,, three ',
        draftFavorite: true,
        draftAttachments: { 'note.md': 'data:text/plain;base64,SGk=' },
        draftContent: 'Draft body',
        createdAt: 123,
      }),
    ).toEqual({
      title: '未命名',
      tags: ['one', 'two', 'three'],
      is_favorite: true,
      attachments: { 'note.md': 'data:text/plain;base64,SGk=' },
      content: 'Draft body',
      createdAt: 123,
    })
  })

  test('treats missing baseline as not dirty', () => {
    expect(
      isDraftDirty({
        selectedBaseline: null,
        draftTitle: 'Anything',
        draftContent: 'Anything',
        draftFavorite: true,
        draftTags: 'alpha',
        draftAttachments: {},
      }),
    ).toBe(false)
  })

  test('ignores tag spacing and attachment key order when checking dirtiness', () => {
    const baseline = makeBaseline()

    expect(
      isDraftDirty({
        selectedBaseline: baseline,
        draftTitle: baseline.meta.title,
        draftContent: baseline.content,
        draftFavorite: baseline.meta.is_favorite,
        draftTags: ' alpha,  beta ',
        draftAttachments: {
          'b.txt': 'data:text/plain;base64,Qg==',
          'a.txt': 'data:text/plain;base64,QQ==',
        },
      }),
    ).toBe(false)
  })

  test('marks the draft dirty when meaningful fields differ', () => {
    const baseline = makeBaseline()

    expect(
      isDraftDirty({
        selectedBaseline: baseline,
        draftTitle: baseline.meta.title,
        draftContent: baseline.content,
        draftFavorite: baseline.meta.is_favorite,
        draftTags: 'alpha, gamma',
        draftAttachments: baseline.attachments,
      }),
    ).toBe(true)

    expect(
      isDraftDirty({
        selectedBaseline: baseline,
        draftTitle: baseline.meta.title,
        draftContent: baseline.content,
        draftFavorite: true,
        draftTags: 'alpha, beta',
        draftAttachments: baseline.attachments,
      }),
    ).toBe(true)

    expect(
      isDraftDirty({
        selectedBaseline: baseline,
        draftTitle: baseline.meta.title,
        draftContent: baseline.content + ' changed',
        draftFavorite: baseline.meta.is_favorite,
        draftTags: 'alpha, beta',
        draftAttachments: baseline.attachments,
      }),
    ).toBe(true)
  })
})
