import type { ReactNode } from 'react'
import type { DecryptedNote } from '../../state/store'
import { Button } from '../../components/ui/button'
import { ScrollArea } from '../../components/ui/scroll-area'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from '../../components/ui/sidebar'
import { Edit3, Lock, Search, Settings, Star } from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  buildNoteSearchPreview,
  detectSearchHit,
  renderHighlightedSearchText,
  SEARCH_PAGE_SIZE,
  type SearchQueryState,
} from './search'

type VaultNoteListStateProps = {
  notesLoaded: boolean
  busy: boolean
  busyText: string | null
  notesCount: number
  searchRaw: string
  fallbackSearchBusy: boolean
  onClearSearch: () => void
}

type VaultNoteListItemProps = {
  note: DecryptedNote
  searchRaw: string
  searchQuery: SearchQueryState
  selectedNoteId: string | null
  onSelect: (id: string) => void
}

type VaultSidebarProps = {
  isNarrow: boolean
  mobilePane: 'list' | 'editor'
  brandName: string
  searchQuery: SearchQueryState
  notes: DecryptedNote[]
  visibleNotes: DecryptedNote[]
  searchHasMore: boolean
  fallbackSearchBusy: boolean
  indexBuild: { done: number; total: number } | null
  notesLoaded: boolean
  busy: boolean
  busyText: string | null
  selectedNoteId: string | null
  onSelectNote: (id: string) => void
  onOpenSearch: () => void
  onOpenSettings: () => void
  onClearSearch: () => void
  onLoadMore: () => void
  syncButton: ReactNode
}

function renderVaultNoteListState({
  notesLoaded,
  busy,
  busyText,
  notesCount,
  searchRaw,
  fallbackSearchBusy,
  onClearSearch,
}: VaultNoteListStateProps): ReactNode {
  if (!notesLoaded) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-3" />
        <p className="text-sm text-muted-foreground">正在加载…</p>
      </div>
    )
  }

  if (busy && busyText === '正在同步…' && notesCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-3" />
        <p className="text-sm text-muted-foreground">正在同步…</p>
      </div>
    )
  }

  if (searchRaw && fallbackSearchBusy) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-3" />
        <p className="text-sm text-muted-foreground">正在搜索…</p>
      </div>
    )
  }

  if (searchRaw) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <Search className="h-12 w-12 text-muted-foreground/50 mb-3" />
        <p className="font-medium mb-1">未找到匹配结果</p>
        <p className="text-sm text-muted-foreground mb-4">尝试其他关键词</p>
        <Button variant="outline" size="sm" onClick={onClearSearch}>
          清空搜索
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Edit3 className="h-8 w-8 text-muted-foreground" />
      </div>
      <p className="font-medium mb-1">暂无笔记</p>
      <p className="text-sm text-muted-foreground">点击顶栏「新建」开始记录</p>
    </div>
  )
}

function VaultNoteListItem({ note, searchRaw, searchQuery, selectedNoteId, onSelect }: VaultNoteListItemProps) {
  const hit = detectSearchHit(note, searchQuery)
  const hitLabel = hit === 'title' ? '标题' : hit === 'tags' ? '标签' : hit === 'content' ? '内容' : null
  const tagsText = note.payload.meta.tags.join(', ')
  const previewLine = searchRaw ? buildNoteSearchPreview(note, searchRaw) : null
  const isSelected = note.id === selectedNoteId

  return (
    <button
      key={note.id}
      className={cn(
        'w-full text-left p-2.5 rounded-lg transition-colors border',
        isSelected
          ? 'bg-accent text-accent-foreground border-primary/40'
          : 'bg-accent/30 border-border hover:bg-accent/60 hover:border-primary/30',
      )}
      onClick={() => onSelect(note.id)}
      type="button"
      role="option"
      aria-selected={isSelected}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="font-medium text-sm truncate flex-1">
          {renderHighlightedSearchText(note.payload.meta.title || '未命名', searchRaw)}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {hitLabel ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
              {hitLabel}
            </span>
          ) : null}
          {note.payload.meta.is_favorite ? (
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
          ) : null}
        </div>
      </div>
      <div className="text-xs text-muted-foreground truncate">
        {searchRaw ? (
          previewLine ? renderHighlightedSearchText(previewLine, searchRaw) : null
        ) : (
          <span>{new Date(note.updated_at).toLocaleString()}</span>
        )}
      </div>
      {!searchRaw && tagsText ? (
        <div className="text-xs text-muted-foreground/70 truncate mt-0.5">
          {renderHighlightedSearchText(tagsText, searchRaw)}
        </div>
      ) : null}
    </button>
  )
}

export function VaultSidebar({
  isNarrow,
  mobilePane,
  brandName,
  searchQuery,
  notes,
  visibleNotes,
  searchHasMore,
  fallbackSearchBusy,
  indexBuild,
  notesLoaded,
  busy,
  busyText,
  selectedNoteId,
  onSelectNote,
  onOpenSearch,
  onOpenSettings,
  onClearSearch,
  onLoadMore,
  syncButton,
}: VaultSidebarProps) {
  if (isNarrow && mobilePane !== 'list') return null

  return (
    <Sidebar
      collapsible="none"
      className={cn('px-2 relative border-r border-border/40', isNarrow && 'w-full! border-r-0')}
    >
      <SidebarHeader className="h-[--header-height] shrink-0 justify-center px-4! py-2!">
        <div className="flex w-full items-center">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Lock className="h-4 w-4" />
          </div>
          <div className="flex flex-col items-start flex-1 text-left ml-2">
            <span className="text-sm font-medium truncate">{brandName}</span>
            <span className="text-[11px] text-muted-foreground truncate">已端到端加密</span>
          </div>
          {isNarrow ? (
            <div className="flex items-center gap-1 ml-auto">
              <Button
                variant="ghost"
                size="icon"
                className="size-9 text-muted-foreground hover:text-foreground"
                onClick={onOpenSearch}
              >
                <Search className="size-[18px]" />
                <span className="sr-only">搜索</span>
              </Button>
              {syncButton}
              <Button
                variant="ghost"
                size="icon"
                className="size-9 text-muted-foreground hover:text-foreground"
                onClick={onOpenSettings}
              >
                <Settings className="size-[18px]" />
                <span className="sr-only">设置</span>
              </Button>
            </div>
          ) : null}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="py-0">
          <SidebarGroupLabel className="text-xs font-normal text-muted-foreground px-2">
            {searchQuery.raw ? (
              <span>搜索结果 ({searchHasMore ? `${visibleNotes.length}+` : visibleNotes.length}/{notes.length})</span>
            ) : (
              <span>全部笔记 ({notes.length})</span>
            )}
            {searchHasMore ? (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs ml-2"
                onClick={onLoadMore}
                disabled={Boolean(indexBuild) || fallbackSearchBusy}
              >
                加载更多
              </Button>
            ) : null}
          </SidebarGroupLabel>
          <SidebarGroupContent className="py-1">
            <ScrollArea className="flex-1">
              <div className="noteList flex flex-col gap-2 px-2" role="listbox" aria-label="笔记列表">
                {visibleNotes.length === 0 ? (
                  renderVaultNoteListState({
                    notesLoaded,
                    busy,
                    busyText,
                    notesCount: notes.length,
                    searchRaw: searchQuery.raw,
                    fallbackSearchBusy,
                    onClearSearch,
                  })
                ) : (
                  visibleNotes.map((note) => (
                    <VaultNoteListItem
                      key={note.id}
                      note={note}
                      searchRaw={searchQuery.raw}
                      searchQuery={searchQuery}
                      selectedNoteId={selectedNoteId}
                      onSelect={onSelectNote}
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

export { SEARCH_PAGE_SIZE }
