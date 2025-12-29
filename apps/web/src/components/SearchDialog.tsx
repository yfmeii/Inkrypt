"use client"

import * as React from "react"
import { Search, X, FileText } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "./ui/dialog"
import { Input } from "./ui/input"
import { Button } from "./ui/button"
import { ScrollArea } from "./ui/scroll-area"
import { cn } from "@/lib/utils"

interface SearchResult {
  id: string
  title: string
  preview: string
  date: string
  tags: string[]
}

interface SearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSearch: (query: string) => SearchResult[]
  onSelect: (id: string) => void
}

export function SearchDialog({ open, onOpenChange, onSearch, onSelect }: SearchDialogProps) {
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<SearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setQuery("")
      setResults([])
      setSelectedIndex(0)
      // Focus input after dialog animation
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Update results when query changes
  React.useEffect(() => {
    if (query.trim()) {
      const searchResults = onSearch(query)
      setResults(searchResults)
      setSelectedIndex(0)
    } else {
      setResults([])
    }
  }, [query, onSearch])

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
        break
      case "ArrowUp":
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
        break
      case "Enter":
        e.preventDefault()
        if (results[selectedIndex]) {
          onSelect(results[selectedIndex].id)
          onOpenChange(false)
        }
        break
      case "Escape":
        e.preventDefault()
        onOpenChange(false)
        break
    }
  }

  // Global keyboard shortcut
  React.useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        onOpenChange(true)
      }
    }
    document.addEventListener("keydown", handleGlobalKeyDown)
    return () => document.removeEventListener("keydown", handleGlobalKeyDown)
  }, [onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0 overflow-hidden top-[20%] translate-y-0">
        <DialogTitle className="sr-only">搜索笔记</DialogTitle>
        
        {/* Search Input */}
        <div className="flex items-center border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索笔记..."
            className="h-12 border-0 px-3 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {query && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              onClick={() => setQuery("")}
            >
              <X className="size-3" />
            </Button>
          )}
        </div>

        {/* Results */}
        <ScrollArea className="max-h-[300px]">
          {results.length > 0 ? (
            <div className="p-2">
              {results.map((result, index) => (
                <button
                  key={result.id}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                    index === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted"
                  )}
                  onClick={() => {
                    onSelect(result.id)
                    onOpenChange(false)
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{result.title || "未命名"}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{result.date}</span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {result.preview}
                    </div>
                    {result.tags.length > 0 && (
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">
                          {result.tags.slice(0, 2).join(", ")}
                          {result.tags.length > 2 && "..."}
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : query ? (
            <div className="p-8 text-center">
              <Search className="mx-auto size-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">未找到匹配结果</p>
            </div>
          ) : (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">输入关键词开始搜索</p>
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">↑↓</kbd>
              <span>导航</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">↵</kbd>
              <span>选择</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">esc</kbd>
              <span>关闭</span>
            </div>
          </div>
          {query && (
            <span>{results.length} 个结果</span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

