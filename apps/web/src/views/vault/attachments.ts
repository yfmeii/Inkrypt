import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import {
  compressImageToDataUrl,
  downloadDataUrl,
  fileToDataUrl,
  sanitizeAttachmentName,
  uniqueAttachmentName,
} from '../../lib/attachments'
import { formatErrorZh } from '../../lib/errors'
import { escapeRegExp } from '../../lib/search'

export function countAttachmentRefs(markdown: string, name: string): number {
  const encoded = encodeURIComponent(name)
  const patterns = new Set([encoded, name])
  let count = 0
  for (const pattern of patterns) {
    const re = new RegExp(`attachment:${escapeRegExp(pattern)}`, 'g')
    count += markdown.match(re)?.length ?? 0
  }
  return count
}

async function optimizeImageAttachment(file: File): Promise<{ dataUrl: string; filename: string; bytes: number }> {
  const res = await compressImageToDataUrl(file, { maxBytes: 1_000_000 })
  return { dataUrl: res.dataUrl, filename: res.filename, bytes: res.bytes }
}

export function useVaultAttachments({
  selected,
  draftAttachments,
  draftContent,
  setDraftAttachments,
  setError,
}: {
  selected: { id: string } | null
  draftAttachments: Record<string, string>
  draftContent: string
  setDraftAttachments: Dispatch<SetStateAction<Record<string, string>>>
  setError: (value: string | null) => void
}) {
  const [showAttachments, setShowAttachments] = useState(false)
  const [attachmentsBusy, setAttachmentsBusy] = useState(false)
  const [attachmentsProgress, setAttachmentsProgress] = useState<{ done: number; total: number } | null>(null)
  const [confirmRemoveAttachment, setConfirmRemoveAttachment] = useState<{ name: string; refs: number } | null>(null)
  const [confirmCleanupUnusedAttachments, setConfirmCleanupUnusedAttachments] = useState<string[] | null>(null)

  const attachmentRefs = useMemo(() => {
    const out: Record<string, number> = {}
    const names = Object.keys(draftAttachments)
    if (!names.length) return out
    for (const name of names) out[name] = countAttachmentRefs(draftContent, name)
    return out
  }, [draftAttachments, draftContent])

  const resetAttachmentUi = useCallback((): void => {
    setShowAttachments(false)
  }, [])

  async function addAttachments(files: File[]): Promise<Array<{ name: string; isImage: boolean }>> {
    if (!selected) return []
    if (attachmentsBusy) return []
    setError(null)
    setAttachmentsBusy(true)
    setAttachmentsProgress({ done: 0, total: files.length })
    try {
      const next: Record<string, string> = { ...draftAttachments }
      const existing = new Set(Object.keys(next))
      const added: Array<{ name: string; isImage: boolean }> = []
      const failures: Array<{ file: string; message: string }> = []
      const total = files.length
      let done = 0

      for (const file of files) {
        const label = file.name || 'attachment'
        try {
          if (file.type.startsWith('image/')) {
            if (file.type === 'image/svg+xml') throw new Error('不支持 SVG 图片，请转换为 PNG/JPG/WebP 后重试')
            const optimized = await optimizeImageAttachment(file)
            if (!Number.isFinite(optimized.bytes) || optimized.bytes <= 0) throw new Error('图片压缩失败，请更换图片或降低分辨率后重试')
            if (optimized.bytes > 1_000_000) throw new Error('图片压缩后仍然超过 1MB，请裁剪/降低分辨率后重试')
            const name = uniqueAttachmentName(optimized.filename, existing)
            existing.add(name)
            next[name] = optimized.dataUrl
            added.push({ name, isImage: true })
          } else {
            if (file.size > 1_000_000) throw new Error('附件过大（建议单个文件 < 1MB）')
            const dataUrl = await fileToDataUrl(file)
            const desired = file.name ? sanitizeAttachmentName(file.name) : 'attachment'
            const name = uniqueAttachmentName(desired, existing)
            existing.add(name)
            next[name] = dataUrl
            added.push({ name, isImage: false })
          }
        } catch (err) {
          failures.push({ file: label, message: formatErrorZh(err) })
        } finally {
          done += 1
          setAttachmentsProgress({ done, total })
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        }
      }

      setDraftAttachments(next)
      if (failures.length) {
        const preview = failures.slice(0, 3).map((failure) => `${failure.file}：${failure.message}`).join('\n')
        const more = failures.length > 3 ? `\n…以及另外 ${failures.length - 3} 个文件` : ''
        setError(`部分附件添加失败：\n${preview}${more}`)
      }
      return added
    } finally {
      setAttachmentsBusy(false)
      setAttachmentsProgress(null)
    }
  }

  function actuallyRemoveAttachment(name: string): void {
    setDraftAttachments((prev) => {
      const next = { ...prev }
      delete next[name]
      return next
    })
  }

  function removeAttachment(name: string): void {
    const refs = countAttachmentRefs(draftContent, name)
    if (refs > 0) {
      setConfirmRemoveAttachment({ name, refs })
      return
    }
    actuallyRemoveAttachment(name)
  }

  function downloadAttachment(name: string): void {
    const dataUrl = draftAttachments[name]
    if (!dataUrl) return
    downloadDataUrl(dataUrl, name)
  }

  async function handleBlockNoteAddAttachment(file: File): Promise<string> {
    const added = await addAttachments([file])
    if (added.length > 0) return `attachment:${encodeURIComponent(added[0].name)}`
    throw new Error('Failed to add attachment')
  }

  function handleBlockNoteFiles(files: File[]): void {
    void addAttachments(files)
  }

  return {
    showAttachments,
    setShowAttachments,
    attachmentsBusy,
    attachmentsProgress,
    confirmRemoveAttachment,
    setConfirmRemoveAttachment,
    confirmCleanupUnusedAttachments,
    setConfirmCleanupUnusedAttachments,
    attachmentRefs,
    resetAttachmentUi,
    addAttachments,
    actuallyRemoveAttachment,
    removeAttachment,
    downloadAttachment,
    handleBlockNoteAddAttachment,
    handleBlockNoteFiles,
  }
}
