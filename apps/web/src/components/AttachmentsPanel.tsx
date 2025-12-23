import type { ChangeEvent, DragEvent } from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { estimateDataUrlBytes, formatBytes, getDataUrlMime } from '../lib/attachments'
import { useFocusTrap } from '../lib/focusTrap'
import { useBodyScrollLock } from '../lib/scrollLock'

type AttachmentItem = {
  name: string
  dataUrl: string
  mime: string | null
  bytes: number | null
  isImage: boolean
}

interface AttachmentsPanelProps {
  isOpen: boolean
  onClose: () => void
  attachments: Record<string, string>
  refs?: Record<string, number>
  busy?: boolean
  progress?: { done: number; total: number } | null
  onAddFiles: (files: File[]) => void
  onRemove: (name: string) => void
  onDownload: (name: string) => void
  onCleanupUnused?: (names: string[]) => void
}

function isSafeInlineImageMime(mime: string | null): boolean {
  if (!mime) return false
  if (!mime.startsWith('image/')) return false
  return mime !== 'image/svg+xml'
}

export function AttachmentsPanel({
  isOpen,
  onClose,
  attachments,
  refs,
  busy,
  progress,
  onAddFiles,
  onRemove,
  onDownload,
  onCleanupUnused,
}: AttachmentsPanelProps) {
  const [mounted, setMounted] = useState(isOpen)
  const [active, setActive] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const dragDepthRef = useRef(0)
  const titleId = useId()
  const previewTitleId = useId()
  const isBusy = Boolean(busy)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const previewModalRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (isOpen) {
      setMounted(true)
      const raf = requestAnimationFrame(() => setActive(true))
      return () => cancelAnimationFrame(raf)
    }
    setActive(false)
  }, [isOpen])

  useEffect(() => {
    if (!mounted || isOpen) return
    if (!('matchMedia' in window)) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMounted(false)
    }
  }, [isOpen, mounted])

  useEffect(() => {
    if (!mounted || isOpen) return
    const t = window.setTimeout(() => setMounted(false), 260)
    return () => window.clearTimeout(t)
  }, [isOpen, mounted])

  const items = useMemo(() => {
    return Object.entries(attachments)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, dataUrl]) => {
        const mime = getDataUrlMime(dataUrl)
        const bytes = estimateDataUrlBytes(dataUrl)
        return {
          name,
          dataUrl,
          mime,
          bytes,
          isImage: isSafeInlineImageMime(mime),
        } satisfies AttachmentItem
      })
  }, [attachments])

  const unusedNames = useMemo(() => {
    if (!refs) return []
    return Object.keys(attachments).filter((name) => (refs[name] ?? 0) === 0)
  }, [attachments, refs])

  const [preview, setPreview] = useState<AttachmentItem | null>(null)
  useEffect(() => setPreview(null), [isOpen])

  useFocusTrap(panelRef, Boolean(isOpen) && !preview)
  useFocusTrap(previewModalRef, Boolean(preview))
  useBodyScrollLock(mounted)

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (preview) setPreview(null)
      else onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, preview])

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (isBusy) {
      e.target.value = ''
      return
    }
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    onAddFiles(files)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    dragDepthRef.current = 0
    setDragOver(false)
    if (isBusy) return
    const files = Array.from(e.dataTransfer.files ?? [])
    if (!files.length) return
    onAddFiles(files)
  }

  if (!mounted) return null

  return (
    <div className={active ? 'attachmentsOverlay open' : 'attachmentsOverlay'} onClick={onClose} role="presentation">
      <div
        className="attachmentsPanel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        tabIndex={-1}
        onTransitionEnd={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.propertyName !== 'transform') return
          if (!isOpen) setMounted(false)
        }}
      >
        <div className="attachmentsHeader">
          <strong id={titleId}>附件</strong>
          <div className="row">
            <button
              className="btn fileBtn"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              title="添加附件"
              aria-label="添加附件"
            >
              添加
            </button>
            <input ref={fileInputRef} type="file" multiple onChange={onInputChange} hidden disabled={isBusy} />
            {onCleanupUnused && unusedNames.length ? (
              <button
                className="btn"
                type="button"
                onClick={() => onCleanupUnused(unusedNames)}
                disabled={isBusy}
                title="清理未被正文引用的附件"
              >
                清理未引用附件（{unusedNames.length}）
              </button>
            ) : null}
            <button className="iconBtn" type="button" onClick={onClose} title="关闭" aria-label="关闭附件面板">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
        </div>

        <div
          className={dragOver ? 'attachmentsBody dragOver' : 'attachmentsBody'}
          onDragEnter={(e) => {
            if (isBusy) return
            if (!e.dataTransfer.types.includes('Files')) return
            dragDepthRef.current += 1
            setDragOver(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            if (isBusy) e.dataTransfer.dropEffect = 'none'
          }}
          onDragLeave={(e) => {
            if (!dragDepthRef.current) return
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
            if (dragDepthRef.current === 0) setDragOver(false)
          }}
          onDrop={handleDrop}
          aria-busy={isBusy ? true : undefined}
        >
          {isBusy ? (
            <div className="attachmentsBusyHint muted small">
              {progress
                ? `\u6b63\u5728\u5904\u7406\u9644\u4ef6\u2026\uff08${progress.done}/${progress.total}\uff09`
                : '\u6b63\u5728\u5904\u7406\u9644\u4ef6\u2026'}
            </div>
          ) : null}
          {items.length ? (
            <ul className="attachmentsList">
              {items.map((it) => (
                <li key={it.name} className="attachmentsItem">
                  {it.isImage ? (
                    <button
                      className="attachmentThumbBtn"
                      type="button"
                      onClick={() => setPreview(it)}
                      title="预览"
                      aria-label={`预览 ${it.name}`}
                      disabled={isBusy}
                    >
                      <img className="attachmentThumb" src={it.dataUrl} alt={it.name} />
                    </button>
                  ) : (
                    <div className="attachmentIcon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm1 7V3.5L18.5 9H15z" />
                      </svg>
                    </div>
                  )}

                  <div className="attachmentMeta">
                    <div className="attachmentName" title={it.name}>
                      {it.name}
                    </div>
                    <div className="muted small">
                      {it.mime ?? '—'} · {formatBytes(it.bytes)}
                      {refs ? (
                        <>
                          {' '}
                          · {(refs[it.name] ?? 0) > 0 ? `引用 ${refs[it.name] ?? 0} 次` : '未引用'}
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="attachmentActions">
                    <button className="btn" type="button" onClick={() => onDownload(it.name)} disabled={isBusy}>
                      下载
                    </button>
                    <button className="btn danger" type="button" onClick={() => onRemove(it.name)} disabled={isBusy}>
                      移除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="attachmentsEmpty">
              <div className="attachmentsEmptyIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
                </svg>
              </div>
              <p className="attachmentsEmptyTitle">拖拽文件到此处</p>
              <p className="muted small">或点击上方「添加」按钮选择文件</p>
              <p className="muted small">图片也可以直接拖到正文编辑区，自动插入引用</p>
            </div>
          )}
        </div>
      </div>

      {preview ? (
        <div
          className="modalOverlay"
          role="presentation"
          onClick={(e) => {
            e.stopPropagation()
            setPreview(null)
          }}
        >
          <div
            className="modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby={previewTitleId}
            onClick={(e) => e.stopPropagation()}
            ref={previewModalRef}
            tabIndex={-1}
          >
            <div className="row">
              <strong id={previewTitleId}>预览</strong>
              <button className="btn" type="button" onClick={() => setPreview(null)} aria-label="关闭预览">
                关闭
              </button>
            </div>
            <div className="attachmentPreviewBox">
              <img className="attachmentPreviewImg" src={preview.dataUrl} alt={preview.name} />
            </div>
            <div className="row">
              <span className="attachmentPreviewName muted small" title={preview.name}>
                {preview.name}
              </span>
              <button className="btn primary" type="button" onClick={() => onDownload(preview.name)} disabled={isBusy}>
                下载
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
