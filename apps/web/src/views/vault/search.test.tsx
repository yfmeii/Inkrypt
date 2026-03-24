import { afterEach, describe, expect, test, vi } from 'vitest'
import type { NotePayload } from '../../lib/crypto'
import type { DecryptedNote } from '../../state/types'
import {
  buildNoteSearchPreview,
  buildNoteSearchText,
  buildSearchDialogResults,
  createSearchQueryState,
  detectSearchHit,
  searchNotesByContent,
  shouldContinueIdleBatch,
} from './search'

function makePayload(overrides: Partial<NotePayload> = {}): NotePayload {
  return {
    meta: {
      title: 'Untitled note',
      created_at: 1712345678,
      tags: [],
      is_favorite: false,
    },
    content: '',
    attachments: {},
    ...overrides,
  }
}

function makeNote(args: {
  id: string
  updatedAt?: number
  version?: number
  title?: string
  tags?: string[]
  content?: string
}): DecryptedNote {
  return {
    id: args.id,
    version: args.version ?? 1,
    updated_at: args.updatedAt ?? 100,
    is_deleted: 0,
    payload: makePayload({
      meta: {
        title: args.title ?? 'Untitled note',
        created_at: 1712345678,
        tags: args.tags ?? [],
        is_favorite: false,
      },
      content: args.content ?? '',
      attachments: {},
    }),
  }
}

describe('vault search helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('builds weighted search text from title, tags, and extracted content', () => {
    const payload = makePayload({
      meta: {
        title: 'Roadmap',
        created_at: 1712345678,
        tags: ['planning', 'q2'],
        is_favorite: false,
      },
      content: '# Heading\n**Ship** the feature',
    })

    expect(buildNoteSearchText(payload)).toBe('Roadmap\nRoadmap\nplanning q2\nplanning q2\nHeading\nShip the feature')
  })

  test('normalizes search queries only when normalization changes matching semantics', () => {
    expect(createSearchQueryState('  Alpha  ')).toEqual({
      raw: 'Alpha',
      lower: 'alpha',
      normalized: 'alpha',
      useNormalized: false,
    })

    expect(createSearchQueryState(' ＡＢＣ ')).toEqual({
      raw: 'ＡＢＣ',
      lower: 'ａｂｃ',
      normalized: 'abc',
      useNormalized: true,
    })
  })

  test('detects hits in title, then tags, then content with normalization support', () => {
    const titleNote = makeNote({
      id: 'title',
      title: 'Project Alpha',
      tags: ['alpha-tag'],
      content: 'alpha body',
    })
    const tagsNote = makeNote({ id: 'tags', title: 'Project', tags: ['ops', 'alpha-tag'], content: 'body only' })
    const contentNote = makeNote({ id: 'content', title: 'Project', tags: ['ops'], content: 'Nested alpha body' })
    const normalizedNote = makeNote({ id: 'normalized', title: 'ＡＢＣ plan', tags: [], content: '' })

    expect(detectSearchHit(titleNote, createSearchQueryState('alpha'))).toBe('title')
    expect(detectSearchHit(tagsNote, createSearchQueryState('alpha'))).toBe('tags')
    expect(detectSearchHit(contentNote, createSearchQueryState('alpha'))).toBe('content')
    expect(detectSearchHit(normalizedNote, createSearchQueryState('ＡＢＣ'))).toBe('title')
    expect(detectSearchHit(contentNote, createSearchQueryState('missing'))).toBeNull()
  })

  test('prefers preview text from content match, then tags, then fallback content line, then tag list', () => {
    expect(
      buildNoteSearchPreview(
        makeNote({
          id: 'content-preview',
          tags: ['ops', 'archive'],
          content: 'First line\nSecond line has Needle here\nThird line',
        }),
        'Needle',
      ),
    ).toContain('Needle')

    expect(
      buildNoteSearchPreview(
        makeNote({ id: 'tag-preview', tags: ['ops', 'Needle'], content: 'No matching body here' }),
        'Needle',
      ),
    ).toBe('ops, Needle')

    expect(
      buildNoteSearchPreview(
        makeNote({ id: 'line-fallback', tags: [], content: 'First useful line\nSecond line' }),
        'missing',
      ),
    ).toBe('First useful line')

    expect(buildNoteSearchPreview(makeNote({ id: 'tags-fallback', tags: ['ops', 'archive'], content: '' }), 'missing')).toBe(
      'ops, archive',
    )
  })

  test('orders content search results by hit priority and recency', () => {
    const notes = [
      makeNote({ id: 'content-newer', updatedAt: 400, title: 'Gamma', tags: ['ops'], content: 'alpha in body' }),
      makeNote({ id: 'title-older', updatedAt: 100, title: 'Alpha title', tags: ['ops'], content: 'body' }),
      makeNote({ id: 'tags-newest', updatedAt: 500, title: 'Gamma', tags: ['alpha'], content: 'body' }),
      makeNote({ id: 'title-newer', updatedAt: 300, title: 'Alpha latest', tags: ['ops'], content: 'body' }),
      makeNote({ id: 'content-older', updatedAt: 50, title: 'Gamma', tags: ['ops'], content: 'alpha older body' }),
    ]

    expect(searchNotesByContent(notes, createSearchQueryState('alpha'))).toEqual([
      'title-newer',
      'title-older',
      'tags-newest',
      'content-newer',
      'content-older',
    ])
  })

  test('processes at least one item per idle batch without budget', () => {
    expect(shouldContinueIdleBatch(0, { didTimeout: false, timeRemaining: () => 0 })).toBe(true)
    expect(shouldContinueIdleBatch(1, { didTimeout: false, timeRemaining: () => 0 })).toBe(false)
    expect(shouldContinueIdleBatch(1, undefined)).toBe(true)
  })

  test('shapes dialog results with filtering, preview fallback, title fallback, tags, and result cap', () => {
    vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('2026/03/21 09:30')

    const notes = [
      makeNote({ id: 'note-1', updatedAt: 101, title: '', tags: ['needle'], content: 'First useful line' }),
      makeNote({ id: 'note-2', updatedAt: 102, title: 'Needle heading', tags: ['ops'], content: 'First useful line' }),
      ...Array.from({ length: 9 }, (_, index) =>
        makeNote({
          id: `note-${index + 3}`,
          updatedAt: 103 + index,
          title: `Needle note ${index + 3}`,
          tags: ['needle'],
          content: `Body with needle ${index + 3}`,
        }),
      ),
    ]
    const results = buildSearchDialogResults(notes, 'needle')

    expect(results).toHaveLength(10)
    expect(results[0]).toEqual({
      id: 'note-1',
      title: '未命名',
      preview: 'needle',
      date: '2026/03/21 09:30',
      tags: ['needle'],
    })
    expect(results[1]).toEqual({
      id: 'note-2',
      title: 'Needle heading',
      preview: 'First useful line',
      date: '2026/03/21 09:30',
      tags: ['ops'],
    })
    expect(results.every((result) => result.id !== 'note-11')).toBe(true)
  })
})
