import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as FlexSearch from 'flexsearch'
import type { DecryptedNote } from '../../state/store'
import type { NotePayload } from '../../lib/crypto'
import { cancelIdle, scheduleIdle, type IdleDeadlineLike } from '../../lib/idle'
import {
  encodeSearchText,
  escapeRegExp,
  extractPlainText,
  firstNonEmptyLine,
  normalizeSearchText,
  pickSearchPreviewLine,
} from '../../lib/search'

export const SEARCH_PAGE_SIZE = 200

export type SearchHit = 'title' | 'tags' | 'content'

export type SearchQueryState = {
  raw: string
  lower: string
  normalized: string
  useNormalized: boolean
}

export type SearchDialogResult = {
  id: string
  title: string
  preview: string
  date: string
  tags: string[]
}

type SearchIndexBuild = { done: number; total: number }

type SearchIndexResult = {
  indexBuild: SearchIndexBuild | null
  indexError: string | null
  clearIndexError: () => void
  resetSearchState: () => void
  rememberNoteSearchText: (noteId: string, payload: NotePayload) => void
  forgetNoteSearchText: (noteId: string) => void
  searchIndex: unknown
  searchIndexTick: number
}

type UseVaultSearchResultsArgs = {
  notes: DecryptedNote[]
  searchQuery: SearchQueryState
  searchLimit: number
  searchIndexTick: number
  searchIndex: unknown
}

type UseVaultSearchResultsResult = {
  fallbackSearchBusy: boolean
  searchHasMore: boolean
  visibleNotes: DecryptedNote[]
}

const NOTE_INDEX_ERROR = '搜索索引构建失败：部分笔记可能无法被搜索（可尝试刷新页面或重新解锁）。'

export function shouldContinueIdleBatch(processed: number, deadline?: IdleDeadlineLike): boolean {
  if (processed === 0) return true
  if (!deadline || typeof deadline.timeRemaining !== 'function') return true
  return deadline.timeRemaining() > 5
}

export function buildNoteSearchText(payload: NotePayload): string {
  const title = payload.meta.title ?? ''
  const content = payload.content ?? ''
  const tags = payload.meta.tags?.join(' ') ?? ''
  const plainContent = extractPlainText(content)
  return `${title}\n${title}\n${tags}\n${tags}\n${plainContent}`
}

export function createSearchQueryState(input: string): SearchQueryState {
  const raw = input.trim()
  const lower = raw.toLowerCase()
  const normalized = normalizeSearchText(raw)
  return {
    raw,
    lower,
    normalized,
    useNormalized: Boolean(raw) && normalized !== lower,
  }
}

export function renderHighlightedSearchText(text: string, query: string): ReactNode {
  if (!query || !text) return text

  const re = new RegExp(escapeRegExp(query), 'ig')
  const nodes: ReactNode[] = []
  let last = 0

  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0
    if (index > last) nodes.push(text.slice(last, index))
    nodes.push(
      <mark key={`${index}-${match[0]}`} className="hl">
        {match[0]}
      </mark>,
    )
    last = index + match[0].length
    if (nodes.length > 50) break
  }

  if (nodes.length === 0) return text
  if (last < text.length) nodes.push(text.slice(last))
  return <>{nodes}</>
}

export function detectSearchHit(note: DecryptedNote, query: SearchQueryState): SearchHit | null {
  if (!query.raw) return null

  const needle = query.useNormalized ? query.normalized : query.lower
  const normalize = (value: string) => (query.useNormalized ? normalizeSearchText(value) : value.toLowerCase())

  if (normalize(note.payload.meta.title || '').includes(needle)) return 'title'
  if (normalize(note.payload.meta.tags.join(', ')).includes(needle)) return 'tags'
  if (normalize(extractPlainText(note.payload.content || '')).includes(needle)) return 'content'
  return null
}

export function buildNoteSearchPreview(note: DecryptedNote, query: string): string | null {
  const tagsText = note.payload.meta.tags.join(', ')
  if (!query) return null
  return (
    pickSearchPreviewLine(note.payload.content || '', query) ??
    pickSearchPreviewLine(tagsText, query) ??
    firstNonEmptyLine(note.payload.content || '') ??
    tagsText
  )
}

export function searchNotesByContent(notes: DecryptedNote[], query: SearchQueryState): string[] {
  if (!query.raw) return []

  const needle = query.useNormalized ? query.normalized : query.lower
  const normalize = (value: string) => (query.useNormalized ? normalizeSearchText(value) : value.toLowerCase())
  const hits: Array<{ id: string; score: number; updatedAt: number }> = []

  for (const note of notes) {
    const title = normalize(note.payload.meta.title || '')
    let score = 0
    if (title.includes(needle)) score = 3
    else {
      const tags = normalize(note.payload.meta.tags.join(' '))
      if (tags.includes(needle)) score = 2
      else {
        const content = normalize(extractPlainText(note.payload.content || ''))
        if (content.includes(needle)) score = 1
      }
    }

    if (score > 0) hits.push({ id: note.id, score, updatedAt: note.updated_at })
  }

  hits.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
  return hits.map((hit) => hit.id)
}

export function buildSearchDialogResults(notes: DecryptedNote[], query: string): SearchDialogResult[] {
  const searchQuery = createSearchQueryState(query)
  if (!searchQuery.raw) return []

  return notes
    .filter((note) => detectSearchHit(note, searchQuery))
    .slice(0, 10)
    .map((note) => ({
      id: note.id,
      title: note.payload.meta.title || '未命名',
      preview:
        buildNoteSearchPreview(note, searchQuery.raw) ??
        firstNonEmptyLine(note.payload.content || '') ??
        '',
      date: new Date(note.updated_at).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
      tags: note.payload.meta.tags,
    }))
}

export function useVaultSearchIndex(notes: DecryptedNote[], masterKey: Uint8Array | null): SearchIndexResult {
  const indexRef = useRef<any | null>(null)
  const indexedVersionsRef = useRef<Map<string, number>>(new Map())
  const indexTextRef = useRef<Map<string, string>>(new Map())
  const indexIdleHandleRef = useRef<number | null>(null)
  const indexRunIdRef = useRef(0)
  const indexAutoRebuildRef = useRef(0)
  const [indexTick, setIndexTick] = useState(0)
  const [indexBuild, setIndexBuild] = useState<SearchIndexBuild | null>(null)
  const [indexEpoch, setIndexEpoch] = useState(0)
  const [indexError, setIndexError] = useState<string | null>(null)

  const resetIndex = useCallback(() => {
    indexRunIdRef.current += 1
    indexAutoRebuildRef.current = 0

    if (indexIdleHandleRef.current) cancelIdle(indexIdleHandleRef.current)
    indexIdleHandleRef.current = null

    indexedVersionsRef.current.clear()
    indexTextRef.current.clear()
    indexRef.current = null

    setIndexBuild(null)
    setIndexError(null)
    setIndexTick((tick) => tick + 1)
    setIndexEpoch((epoch) => epoch + 1)
  }, [])

  const clearIndexError = useCallback(() => {
    setIndexError(null)
  }, [])

  const rememberNoteSearchText = useCallback((noteId: string, payload: NotePayload) => {
    indexTextRef.current.set(noteId, buildNoteSearchText(payload))
  }, [])

  const forgetNoteSearchText = useCallback((noteId: string) => {
    indexTextRef.current.delete(noteId)
  }, [])

  useEffect(() => {
    if (masterKey) return
    resetIndex()
  }, [masterKey])

  useEffect(() => {
    const Flex: any = (FlexSearch as any).default ?? FlexSearch
    if (!indexRef.current) {
      indexRef.current = new Flex.Index({ tokenize: 'forward', cache: 200, encode: encodeSearchText })
    }

    const idx = indexRef.current
    const indexed = indexedVersionsRef.current
    const indexText = indexTextRef.current

    const currentIds = new Set(notes.map((note) => note.id))
    const toRemove: string[] = []
    for (const id of indexed.keys()) {
      if (!currentIds.has(id)) toRemove.push(id)
    }

    const toUpsert: Array<{ id: string; version: number; text: string }> = []
    for (const note of notes) {
      if (indexed.get(note.id) === note.version) continue
      const text = indexText.get(note.id) ?? `${note.payload.meta.title}\n${note.payload.content}\n${note.payload.meta.tags.join(' ')}`
      toUpsert.push({ id: note.id, version: note.version, text })
    }

    const total = toRemove.length + toUpsert.length
    if (total === 0) {
      setIndexBuild(null)
      return
    }

    const runId = ++indexRunIdRef.current
    let done = 0
    let hadFailures = false
    let requestedRebuild = false

    setIndexBuild({ done: 0, total })
    setIndexError(null)

    if (indexIdleHandleRef.current) cancelIdle(indexIdleHandleRef.current)

    const work = (deadline?: IdleDeadlineLike) => {
      if (indexRunIdRef.current !== runId) return

      let processed = 0
      while ((toRemove.length || toUpsert.length) && shouldContinueIdleBatch(processed, deadline)) {
        if (toRemove.length) {
          const id = toRemove.pop()
          if (id) {
            try {
              idx.remove(id)
            } catch {
              // ignore
            }
            indexed.delete(id)
          }
        } else {
          const note = toUpsert.pop()
          if (note) {
            try {
              if (indexed.has(note.id)) idx.update(note.id, note.text)
              else idx.add(note.id, note.text)
              indexed.set(note.id, note.version)
            } catch {
              hadFailures = true
              if (!requestedRebuild && indexAutoRebuildRef.current < 1) {
                requestedRebuild = true
              }
            }
          }
        }
        done += 1
        processed += 1
      }

      if (indexRunIdRef.current !== runId) return

      setIndexBuild({ done, total })
      setIndexTick((tick) => tick + 1)

      if (toRemove.length || toUpsert.length) {
        indexIdleHandleRef.current = scheduleIdle(work)
        return
      }

      if (requestedRebuild) {
        indexAutoRebuildRef.current += 1
        indexed.clear()
        indexRef.current = null
        setIndexTick((tick) => tick + 1)
        setIndexBuild(null)
        setIndexEpoch((epoch) => epoch + 1)
        return
      }

      if (hadFailures) setIndexError(NOTE_INDEX_ERROR)

      setIndexBuild(null)
    }

    indexIdleHandleRef.current = scheduleIdle(work)

    return () => {
      indexRunIdRef.current += 1
      if (indexIdleHandleRef.current) cancelIdle(indexIdleHandleRef.current)
    }
  }, [indexEpoch, notes])

  return {
    indexBuild,
    indexError,
    clearIndexError,
    resetSearchState: resetIndex,
    rememberNoteSearchText,
    forgetNoteSearchText,
    searchIndex: indexRef.current,
    searchIndexTick: indexTick,
  }
}

export function useVaultSearchResults({
  notes,
  searchQuery,
  searchLimit,
  searchIndexTick,
  searchIndex,
}: UseVaultSearchResultsArgs): UseVaultSearchResultsResult {
  const fallbackSearchRunIdRef = useRef(0)
  const fallbackSearchIdleHandleRef = useRef<number | null>(null)
  const [fallbackSearch, setFallbackSearch] = useState<{ ids: string[]; hasMore: boolean } | null>(null)
  const [fallbackSearchBusy, setFallbackSearchBusy] = useState(false)

  const sortedNotes = useMemo(() => [...notes].sort((a, b) => b.updated_at - a.updated_at), [notes])

  const noteById = useMemo(() => {
    const byId = new Map<string, DecryptedNote>()
    for (const note of sortedNotes) byId.set(note.id, note)
    return byId
  }, [sortedNotes])

  const indexSearch = useMemo(() => {
    if (!searchQuery.raw) return { ids: null as string[] | null, hasMore: false }
    if (!searchIndex) return { ids: [] as string[], hasMore: false }
    try {
      const results = (searchIndex as any).search(searchQuery.raw, { limit: searchLimit + 1, suggest: true }) as string[]
      const hasMore = results.length > searchLimit
      return { ids: hasMore ? results.slice(0, searchLimit) : results, hasMore }
    } catch {
      return { ids: [] as string[], hasMore: false }
    }
  }, [searchIndex, searchIndexTick, searchLimit, searchQuery])

  const activeSearch = indexSearch.ids !== null
  const indexHasResults = Boolean(indexSearch.ids && indexSearch.ids.length > 0)
  const searchIds = indexHasResults ? indexSearch.ids! : fallbackSearch?.ids ?? []
  const searchHasMore = indexHasResults ? indexSearch.hasMore : fallbackSearch?.hasMore ?? false

  useEffect(() => {
    if (!activeSearch || indexHasResults || !searchQuery.raw) {
      setFallbackSearch(null)
      setFallbackSearchBusy(false)
      return
    }

    const runId = ++fallbackSearchRunIdRef.current
    if (fallbackSearchIdleHandleRef.current) cancelIdle(fallbackSearchIdleHandleRef.current)
    fallbackSearchIdleHandleRef.current = null
    setFallbackSearch(null)
    setFallbackSearchBusy(true)

    const total = notes.length
    let done = 0
    const scannedNotes: DecryptedNote[] = []

    const work = (deadline?: IdleDeadlineLike) => {
      if (fallbackSearchRunIdRef.current !== runId) return

      let processed = 0
      while (done < total && shouldContinueIdleBatch(processed, deadline)) {
        const note = notes[done]
        done += 1
        processed += 1
        if (note) scannedNotes.push(note)
      }

      if (fallbackSearchRunIdRef.current !== runId) return

      if (done < total) {
        fallbackSearchIdleHandleRef.current = scheduleIdle(work)
        return
      }

      const ids = searchNotesByContent(scannedNotes, searchQuery)
      const hasMore = ids.length > searchLimit
      setFallbackSearch({ ids: hasMore ? ids.slice(0, searchLimit) : ids, hasMore })
      if (fallbackSearchRunIdRef.current === runId) setFallbackSearchBusy(false)
    }

    fallbackSearchIdleHandleRef.current = scheduleIdle(work)

    return () => {
      if (fallbackSearchIdleHandleRef.current) cancelIdle(fallbackSearchIdleHandleRef.current)
      fallbackSearchIdleHandleRef.current = null
      if (fallbackSearchRunIdRef.current === runId) setFallbackSearchBusy(false)
    }
  }, [activeSearch, indexHasResults, notes, searchLimit, searchQuery])

  const visibleNotes = useMemo(() => {
    if (!activeSearch) return sortedNotes
    const results: DecryptedNote[] = []
    for (const id of searchIds) {
      const note = noteById.get(id)
      if (note) results.push(note)
    }
    return results
  }, [activeSearch, noteById, searchIds, sortedNotes])

  return {
    fallbackSearchBusy,
    searchHasMore,
    visibleNotes,
  }
}
