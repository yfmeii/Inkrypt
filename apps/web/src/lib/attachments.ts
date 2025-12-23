export function sanitizeAttachmentName(name: string): string {
  const base = name.split(/[\\\/]/).pop() ?? name
  const normalized = base
    .replace(/[\\\/:*?"<>|\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  const noDots = normalized.replace(/^\.+/, '')
  return (noDots || 'attachment').slice(0, 120)
}

export function uniqueAttachmentName(desiredName: string, existing: Set<string>): string {
  const clean = sanitizeAttachmentName(desiredName)
  if (!existing.has(clean)) return clean

  const dot = clean.lastIndexOf('.')
  const hasExt = dot > 0 && dot < clean.length - 1
  const base = hasExt ? clean.slice(0, dot) : clean
  const ext = hasExt ? clean.slice(dot) : ''

  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base} (${i})${ext}`
    if (!existing.has(candidate)) return candidate
  }
  return `${base} (${crypto.randomUUID().slice(0, 8)})${ext}`
}

export async function fileToDataUrl(file: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取文件失败，请重试'))
    reader.readAsDataURL(file)
  })
}

function stripExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return name
  return name.slice(0, idx)
}

async function loadImageElement(
  file: File,
): Promise<{ img: HTMLImageElement; revoke: () => void; width: number; height: number }> {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.decoding = 'async'
  img.src = url

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片解码失败，请尝试转换格式或更换图片后重试'))
  })

  const width = img.naturalWidth || img.width
  const height = img.naturalHeight || img.height
  return { img, revoke: () => URL.revokeObjectURL(url), width, height }
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return await new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

export async function compressImageToDataUrl(
  file: File,
  opts?: { maxBytes?: number },
): Promise<{ dataUrl: string; filename: string; bytes: number; mime: string }> {
  const maxBytes = opts?.maxBytes ?? 1_000_000
  if (!file.type.startsWith('image/')) throw new Error('仅支持图片文件（PNG/JPG/WebP 等）')
  if (file.type === 'image/svg+xml') throw new Error('不支持 SVG 图片，请转换为 PNG/JPG/WebP 后重试')

  // If the original is already small enough, keep it as-is (still E2EE).
  if (file.size > 0 && file.size <= maxBytes) {
    const dataUrl = await fileToDataUrl(file)
    const filename = sanitizeAttachmentName(file.name || 'image')
    return { dataUrl, filename, bytes: file.size, mime: file.type || 'application/octet-stream' }
  }

  const base = stripExtension(sanitizeAttachmentName(file.name || 'image')) || 'image'
  const dims = [2048, 1600, 1280, 1024, 800, 640, 480, 360, 320]
  const qualities = [0.86, 0.82, 0.8, 0.78, 0.75, 0.72, 0.7, 0.66, 0.62, 0.58, 0.54]

  const decoded = await loadImageElement(file)
  try {
    const srcW = decoded.width
    const srcH = decoded.height
    if (!srcW || !srcH) throw new Error('图片尺寸异常，请更换图片后重试')

    let best: { blob: Blob; mime: string } | null = null

    for (const maxDim of dims) {
      const scale = Math.min(1, maxDim / Math.max(srcW, srcH))
      const w = Math.max(1, Math.round(srcW * scale))
      const h = Math.max(1, Math.round(srcH * scale))

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { alpha: true })
      if (!ctx) throw new Error('浏览器不支持图片压缩（Canvas 不可用），请更新或更换浏览器后重试')
      ctx.imageSmoothingEnabled = true
      ;(ctx as any).imageSmoothingQuality = 'high'
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(decoded.img, 0, 0, w, h)

      for (const q of qualities) {
        let blob = await canvasToBlob(canvas, 'image/webp', q)
        let mime = 'image/webp'

        if (!blob) {
          // Safari/old browsers fallback
          ctx.fillStyle = '#fff'
          ctx.fillRect(0, 0, w, h)
          ctx.drawImage(decoded.img, 0, 0, w, h)
          blob = await canvasToBlob(canvas, 'image/jpeg', q)
          mime = 'image/jpeg'
        }

        if (!blob) continue
        if (!best || blob.size < best.blob.size) best = { blob, mime }
        if (blob.size <= maxBytes) {
          const dataUrl = await fileToDataUrl(blob)
          const ext = mime === 'image/jpeg' ? 'jpg' : 'webp'
          const filename = sanitizeAttachmentName(`${base}.${ext}`)
          return { dataUrl, filename, bytes: blob.size, mime }
        }
      }
    }

    if (!best) throw new Error('图片压缩失败，请更换图片或降低分辨率后重试')
    throw new Error('图片压缩后仍然超过 1MB，请裁剪/降低分辨率后重试')
  } finally {
    decoded.revoke()
  }
}

export function getDataUrlMime(dataUrl: string): string | null {
  const m = /^data:([^;,]+)(?:;[^,]*)?,/i.exec(dataUrl)
  return m?.[1]?.toLowerCase() ?? null
}

export function estimateDataUrlBytes(dataUrl: string): number | null {
  const idx = dataUrl.indexOf(',')
  if (idx < 0) return null
  const meta = dataUrl.slice(0, idx)
  if (!/;base64$/i.test(meta)) return null
  const b64 = dataUrl.slice(idx + 1).trim()
  if (!b64) return 0
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - padding
}

export function dataUrlToBlob(dataUrl: string): { blob: Blob; mime: string } {
  const idx = dataUrl.indexOf(',')
  if (idx < 0) throw new Error('附件数据无效（Data URL 格式错误）')

  const header = dataUrl.slice(0, idx)
  const payload = dataUrl.slice(idx + 1)

  const mime = getDataUrlMime(dataUrl) ?? 'application/octet-stream'
  const isBase64 = /;base64$/i.test(header)
  if (!isBase64) {
    return { blob: new Blob([decodeURIComponent(payload)], { type: mime }), mime }
  }

  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { blob: new Blob([bytes], { type: mime }), mime }
}

export function formatBytes(bytes: number | null): string {
  if (!bytes || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const { blob } = dataUrlToBlob(dataUrl)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000)
}
