import { isValidElement, memo, useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import mermaid from 'mermaid'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import '../markdown-highlight.css'
import 'katex/dist/katex.min.css'
import { downloadDataUrl, getDataUrlMime } from '../lib/attachments'

interface MarkdownPreviewProps {
  content: string
  attachments?: Record<string, string>
  showOutline?: boolean
}

function parseAttachmentRef(raw: string | undefined): string | null {
  if (!raw) return null
  const prefix = 'attachment:'
  if (!raw.toLowerCase().startsWith(prefix)) return null
  const nameRaw = raw.slice(prefix.length)
  try {
    return decodeURIComponent(nameRaw)
  } catch {
    return nameRaw
  }
}

function isSafeInlineImageDataUrl(dataUrl: string): boolean {
  const mime = getDataUrlMime(dataUrl)
  return Boolean(mime && mime.startsWith('image/') && mime !== 'image/svg+xml')
}

function sanitizeLinkHref(href: string | undefined): string | null {
  if (!href) return null
  const trimmed = href.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('#')) return trimmed
  if (trimmed.startsWith('/')) return trimmed
  if (trimmed.startsWith('./') || trimmed.startsWith('../')) return trimmed
  if (trimmed.startsWith('//')) return null

  try {
    const url = new URL(trimmed)
    const protocol = url.protocol.toLowerCase()
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') return url.toString()
    return null
  } catch {
    return trimmed
  }
}

function sanitizeImageSrc(src: string | undefined): string | null {
  if (!src) return null
  const trimmed = src.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('/')) return trimmed
  if (trimmed.startsWith('./') || trimmed.startsWith('../')) return trimmed
  if (trimmed.startsWith('//')) return null

  if (trimmed.toLowerCase().startsWith('data:')) {
    return isSafeInlineImageDataUrl(trimmed) ? trimmed : null
  }

  try {
    const url = new URL(trimmed)
    return null
  } catch {
    return trimmed
  }
}

const EMPTY_ATTACHMENTS: Record<string, string> = {}

type HeadingItem = { level: number; text: string; id: string }

let mermaidInitialized = false
let mermaidId = 0
let mermaidThemeSignature = ''
let mermaidRenderChain: Promise<void> = Promise.resolve()

function enqueueMermaidRender(task: () => Promise<void>): Promise<void> {
  const next = mermaidRenderChain.then(task, task)
  mermaidRenderChain = next.catch(() => undefined)
  return next
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'undefined') return Promise.resolve()
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function normalizeMermaidSvg(svg: SVGSVGElement): void {
  svg.style.maxWidth = '100%'
  svg.style.height = 'auto'
  svg.style.display = 'block'
}

function isMermaidViewBoxSuspicious(svg: SVGSVGElement): boolean {
  try {
    const vb = svg.viewBox?.baseVal
    if (!vb || vb.width <= 0 || vb.height <= 0) return false
    const bbox = svg.getBBox()
    if (bbox.width <= 0 || bbox.height <= 0) return false
    return vb.width / bbox.width > 3 || vb.height / bbox.height > 3
  } catch {
    return false
  }
}

function tightenMermaidViewBox(svg: SVGSVGElement): void {
  try {
    const bbox = svg.getBBox()
    if (bbox.width <= 0 || bbox.height <= 0) return
    const padding = 16
    const x = bbox.x - padding
    const y = bbox.y - padding
    const width = bbox.width + padding * 2
    const height = bbox.height + padding * 2
    svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`)
    svg.removeAttribute('width')
    svg.removeAttribute('height')
  } catch {
    // Ignore SVG measurement errors
  }
}

function readCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function buildMermaidTheme() {
  if (typeof document === 'undefined') return null
  const surface = readCssVar('--md-sys-color-surface', '#ffffff')
  const surfaceHigh = readCssVar('--md-sys-color-surface-container-high', surface)
  const surfaceHighest = readCssVar('--md-sys-color-surface-container-highest', surfaceHigh)
  const onSurface = readCssVar('--md-sys-color-on-surface', '#111111')
  const outline = readCssVar('--md-sys-color-outline', onSurface)
  const outlineVariant = readCssVar('--md-sys-color-outline-variant', outline)
  const primary = readCssVar('--md-sys-color-primary', onSurface)

  return {
    theme: 'base' as const,
    themeVariables: {
      fontFamily: 'inherit',
      mainBkg: surfaceHighest,
      textColor: onSurface,
      nodeBorder: outline,
      lineColor: onSurface,
      primaryColor: surfaceHigh,
      primaryTextColor: onSurface,
      primaryBorderColor: outline,
      secondaryColor: primary,
      tertiaryColor: primary,
      clusterBkg: surface,
      clusterBorder: outlineVariant,
      edgeLabelBackground: surfaceHigh,
      titleColor: onSurface,
    },
  }
}

function initMermaid(): void {
  const theme = buildMermaidTheme()
  if (!theme) return
  const signature = JSON.stringify(theme)
  if (mermaidInitialized && signature === mermaidThemeSignature) return
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    ...theme,
  })
  mermaidInitialized = true
  mermaidThemeSignature = signature
}

function MermaidBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const idRef = useRef(`mermaid-${mermaidId++}`)

  useEffect(() => {
    initMermaid()
    let cancelled = false

    const renderOnce = async (attempt: number) => {
      const fonts = typeof document !== 'undefined' ? document.fonts : undefined
      const fontsWereLoading = Boolean(fonts && fonts.status === 'loading')

      await nextFrame()
      await nextFrame()

      if (fonts?.ready) {
        await Promise.race([fonts.ready, delay(300)])
      }

      if (cancelled) return

      const { svg, bindFunctions } = await mermaid.render(idRef.current, code)
      if (cancelled) return

      const container = containerRef.current
      if (container) {
        container.innerHTML = svg
        const svgEl = container.querySelector('svg') as SVGSVGElement | null
        if (svgEl) {
          normalizeMermaidSvg(svgEl)
          const suspicious = isMermaidViewBoxSuspicious(svgEl)
          if (suspicious && !fontsWereLoading) {
            tightenMermaidViewBox(svgEl)
          } else if (suspicious && attempt === 0 && fonts?.ready) {
            void fonts.ready.then(() => {
              if (cancelled) return
              void enqueueMermaidRender(() => renderOnce(1)).catch(() => null)
            })
          }
        }

        if (typeof bindFunctions === 'function') {
          try {
            bindFunctions(container)
          } catch {
            // ignore
          }
        }
      }

      setError(null)
    }

    void enqueueMermaidRender(() => renderOnce(0)).catch((err) => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : 'Mermaid 渲染失败')
    })

    return () => {
      cancelled = true
    }
  }, [code])

  if (error) {
    return (
      <div className="mermaidBlock error" role="note">
        <div className="mermaidErrorTitle">Mermaid 渲染失败</div>
        <div className="mermaidErrorMessage">{error}</div>
        <pre className="mermaidErrorSource">{code}</pre>
      </div>
    )
  }

  return <div className="mermaidBlock" ref={containerRef} />
}

function isWhitespaceTextNode(node: any): boolean {
  return node?.type === 'text' && typeof node.value === 'string' && node.value.trim() === ''
}

function trimWhitespacePhrasing(nodes: any[]): any[] {
  let start = 0
  let end = nodes.length
  while (start < end && isWhitespaceTextNode(nodes[start])) start += 1
  while (end > start && isWhitespaceTextNode(nodes[end - 1])) end -= 1
  return nodes.slice(start, end)
}

function isDoubleDollarInlineMath(node: any, source: string): boolean {
  if (!node || node.type !== 'inlineMath') return false
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (typeof start !== 'number' || typeof end !== 'number') return false

  const raw = source.slice(start, end)
  return /^(\${2,})[\s\S]*\1$/.test(raw)
}

function buildMathDisplayNode(value: string): any {
  return {
    type: 'math',
    meta: null,
    value,
    data: {
      hName: 'pre',
      hChildren: [
        {
          type: 'element',
          tagName: 'code',
          properties: { className: ['language-math', 'math-display'] },
          children: [{ type: 'text', value }],
        },
      ],
    },
  }
}

function splitParagraphOnDoubleDollarMath(paragraph: any, source: string): any[] | null {
  const children = paragraph?.children
  if (!Array.isArray(children) || children.length === 0) return null

  let changed = false
  const out: any[] = []
  let buf: any[] = []

  function flush() {
    const trimmed = trimWhitespacePhrasing(buf)
    buf = []
    if (!trimmed.length) return
    out.push({ ...paragraph, type: 'paragraph', children: trimmed })
  }

  for (const child of children) {
    if (isDoubleDollarInlineMath(child, source)) {
      changed = true
      flush()
      out.push(buildMathDisplayNode(String(child.value ?? '')))
      continue
    }
    buf.push(child)
  }

  flush()
  return changed ? out : null
}

const remarkDoubleDollarToDisplay = () => {
  return (tree: any, file: any) => {
    const source = typeof file?.value === 'string' ? file.value : String(file?.value ?? '')

    const walk = (node: any) => {
      if (!node || !Array.isArray(node.children)) return

      for (let i = 0; i < node.children.length; i += 1) {
        const child = node.children[i]
        if (child?.type === 'paragraph') {
          const replacement = splitParagraphOnDoubleDollarMath(child, source)
          if (replacement) {
            node.children.splice(i, 1, ...replacement)
            i += replacement.length - 1
            continue
          }
        }
        walk(child)
      }
    }

    walk(tree)
  }
}

const remarkSoftBreaksToBr = () => {
  return (tree: any) => {
    const walk = (node: any) => {
      if (!node || !Array.isArray(node.children)) return

      for (let i = 0; i < node.children.length; i += 1) {
        const child = node.children[i]
        if (child?.type === 'text' && typeof child.value === 'string' && /[\r\n]/.test(child.value)) {
          const parts = child.value.split(/\r?\n/)
          const replacement: any[] = []
          for (let p = 0; p < parts.length; p += 1) {
            const text = parts[p]
            if (text) replacement.push({ type: 'text', value: text })
            if (p !== parts.length - 1) replacement.push({ type: 'break' })
          }

          node.children.splice(i, 1, ...replacement)
          i += replacement.length - 1
          continue
        }

        walk(child)
      }
    }

    walk(tree)
  }
}

function slugify(text: string): string {
  const base = text
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'section'
}

function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((n) => nodeText(n)).join('')
  if (isValidElement(node)) return nodeText(node.props.children)
  return ''
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(t)
  }, [delayMs, value])
  return debounced
}

export const MarkdownPreview = memo(function MarkdownPreview({ content, attachments, showOutline }: MarkdownPreviewProps) {
  const atts = attachments ?? EMPTY_ATTACHMENTS
  const debouncedContent = useDebouncedValue(content, 120)
  const deferredContent = useDeferredValue(debouncedContent)

  const [headings, setHeadings] = useState<HeadingItem[]>([])
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [fabPortalTarget, setFabPortalTarget] = useState<HTMLElement | null>(null)

  const outlineRef = useRef<HTMLElement | null>(null)
  const markdownBodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = markdownBodyRef.current
    if (!root) return
    const vault = root.closest('.vault')
    if (vault instanceof HTMLElement) setFabPortalTarget(vault)
  }, [])

  function safeDecodeHashId(raw: string): string {
    const trimmed = raw.trim().replace(/^#/, '')
    if (!trimmed) return ''
    try {
      return decodeURIComponent(trimmed)
    } catch {
      return trimmed
    }
  }

  function safeScrollTo(el: HTMLElement, top: number, behavior: ScrollBehavior): void {
    const nextTop = Math.max(0, Math.round(top))
    try {
      el.scrollTo({ top: nextTop, behavior })
      return
    } catch {
      // ignore and try legacy signatures/fallbacks
    }

    try {
      el.scrollTo(0, nextTop)
      return
    } catch {
      // ignore and fall back
    }

    el.scrollTop = nextTop
  }

  function safeWindowScrollTo(top: number, behavior: ScrollBehavior): void {
    const nextTop = Math.max(0, Math.round(top))
    try {
      window.scrollTo({ top: nextTop, behavior })
      return
    } catch {
      // ignore and try legacy signatures/fallbacks
    }

    try {
      window.scrollTo(0, nextTop)
      return
    } catch {
      // ignore and fall back
    }

    const doc = document.scrollingElement
    if (doc instanceof HTMLElement) {
      doc.scrollTop = nextTop
      return
    }

    if (document.documentElement) document.documentElement.scrollTop = nextTop
    if (document.body) document.body.scrollTop = nextTop
  }

  function safeScrollIntoView(el: HTMLElement, behavior: ScrollBehavior): void {
    try {
      el.scrollIntoView({ behavior, block: 'center' })
    } catch {
      try {
        el.scrollIntoView(true)
      } catch {
        // ignore
      }
    }
  }

  function scrollToHeading(rawId: string): void {
    const id = safeDecodeHashId(rawId)
    if (!id) return

    setActiveHeadingId(id)

    const root = markdownBodyRef.current
    const candidate = (() => {
      if (!root) return null
      try {
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
          const el = root.querySelector(`#${CSS.escape(id)}`)
          return el instanceof HTMLElement ? el : null
        }
        const el = root.querySelector(`[id="${id}"]`)
        return el instanceof HTMLElement ? el : null
      } catch {
        return null
      }
    })()

    const target = candidate ?? (document.getElementById(id) as HTMLElement | null)
    if (!target) return

    const prefersReducedMotion = Boolean(
      'matchMedia' in window && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    )
    const behavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth'

    const previewScroller =
      (root?.closest('.previewContainer') as HTMLElement | null) ?? (target.closest('.previewContainer') as HTMLElement | null)
    const docScroller = document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null
    const scroller =
      (previewScroller && previewScroller.scrollHeight > previewScroller.clientHeight + 1 ? previewScroller : null) ??
      (docScroller && docScroller.scrollHeight > docScroller.clientHeight + 1 ? docScroller : null)
    if (!scroller) {
      safeScrollIntoView(target, behavior)
      return
    }

    const listenOnWindow = Boolean(docScroller && scroller === docScroller)
    const scrollerRectTop = listenOnWindow ? 0 : scroller.getBoundingClientRect().top
    const scrollTop = listenOnWindow ? window.scrollY : scroller.scrollTop
    const viewportHeight = listenOnWindow ? window.innerHeight : scroller.clientHeight
    const baseAnchorY = viewportHeight * 0.25
    const anchorY = (() => {
      if (listenOnWindow) return baseAnchorY
      const outlineRect = outlineRef.current?.getBoundingClientRect()
      const topOffset = outlineRect ? Math.max(0, outlineRect.bottom - scrollerRectTop + 12) : 0
      return Math.max(baseAnchorY, topOffset)
    })()

    const targetRect = target.getBoundingClientRect()
    const targetTop = targetRect.top - scrollerRectTop + scrollTop
    const nextTop = targetTop - anchorY
    if (listenOnWindow) safeWindowScrollTo(nextTop, behavior)
    else safeScrollTo(scroller, nextTop, behavior)

    window.requestAnimationFrame(() => {
      try {
        target.focus({ preventScroll: true })
      } catch {
        // ignore
      }
    })
  }

  function scrollToTop(): void {
    const root = markdownBodyRef.current
    const previewScroller = root?.closest('.previewContainer') as HTMLElement | null
    const docScroller = document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null
    const scroller =
      (previewScroller && previewScroller.scrollHeight > previewScroller.clientHeight + 1 ? previewScroller : null) ??
      (docScroller && docScroller.scrollHeight > docScroller.clientHeight + 1 ? docScroller : null)

    const prefersReducedMotion = Boolean(
      'matchMedia' in window && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    )
    const behavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth'

    if (!scroller) {
      safeWindowScrollTo(0, behavior)
      return
    }

    const listenOnWindow = Boolean(docScroller && scroller === docScroller)
    if (listenOnWindow) safeWindowScrollTo(0, behavior)
    else safeScrollTo(scroller, 0, behavior)
  }

  useEffect(() => {
    if (!showOutline) {
      setHeadings([])
      setActiveHeadingId(null)
      return
    }

    const root = markdownBodyRef.current
    if (!root) return

    const nodes = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    const next: HeadingItem[] = []

    for (const node of nodes) {
      const level = Number(node.tagName.slice(1))
      if (!level || level < 1 || level > 6) continue
      const text = (node.textContent ?? '').trim()
      const id = node.id?.trim()
      if (!text || !id) continue
      next.push({ level, text, id })
    }

    setHeadings(next)
  }, [deferredContent, showOutline])

  useEffect(() => {
    const previewScroller = markdownBodyRef.current?.closest('.previewContainer')
    if (!(previewScroller instanceof HTMLElement)) return

    const previewScrollerEl = previewScroller

    function pickActiveId(): string {
      const previewScrollable = previewScrollerEl.scrollHeight > previewScrollerEl.clientHeight + 1
      const scrollerRectTop = previewScrollable ? previewScrollerEl.getBoundingClientRect().top : 0
      const outlineRect = outlineRef.current?.getBoundingClientRect()
      const topOffset = Math.max(0, (outlineRect?.bottom ?? scrollerRectTop) - scrollerRectTop + 12)

      const scrollTop = previewScrollable ? previewScrollerEl.scrollTop : window.scrollY
      const probeY = scrollTop + topOffset

      for (let i = headings.length - 1; i >= 0; i -= 1) {
        const id = headings[i].id
        const el = document.getElementById(id)
        if (!el) continue
        const top = el.getBoundingClientRect().top - scrollerRectTop + scrollTop
        if (top <= probeY) return id
      }

      return headings[0].id
    }

    let rafId = 0
    const onScrollOrResize = () => {
      if (rafId) return
      rafId = window.requestAnimationFrame(() => {
        rafId = 0
        const previewScrollable = previewScrollerEl.scrollHeight > previewScrollerEl.clientHeight + 1
        const scrollTop = previewScrollable ? previewScrollerEl.scrollTop : window.scrollY
        const viewportHeight = previewScrollable ? previewScrollerEl.clientHeight : window.innerHeight

        const outlineEl = outlineRef.current
        const nextShowScrollTop = (() => {
          if (showOutline && headings.length && outlineEl) {
            const outlineRect = outlineEl.getBoundingClientRect()
            const viewportTop = previewScrollable ? previewScrollerEl.getBoundingClientRect().top : 0
            const viewportBottom = previewScrollable ? viewportTop + previewScrollerEl.clientHeight : window.innerHeight
            const visible = outlineRect.bottom > viewportTop + 1 && outlineRect.top < viewportBottom - 1
            return scrollTop > 0 && !visible
          }

          const threshold = Math.max(240, viewportHeight * 0.6)
          return scrollTop > threshold
        })()

        setShowScrollTop((prev) => (prev === nextShowScrollTop ? prev : nextShowScrollTop))

        if (!showOutline || !headings.length) {
          setActiveHeadingId((prev) => (prev === null ? prev : null))
          return
        }

        const nextActiveId = pickActiveId()
        setActiveHeadingId((prev) => (prev === nextActiveId ? prev : nextActiveId))
      })
    }

    onScrollOrResize()
    previewScrollerEl.addEventListener('scroll', onScrollOrResize, { passive: true })
    window.addEventListener('scroll', onScrollOrResize, { passive: true })
    window.addEventListener('resize', onScrollOrResize)

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId)
      previewScrollerEl.removeEventListener('scroll', onScrollOrResize)
      window.removeEventListener('scroll', onScrollOrResize)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [headings, showOutline])

  const components = (() => {
    const used = new Map<string, number>()

    function allocHeadingId(text: string): string {
      const base = slugify(text)
      const n = (used.get(base) ?? 0) + 1
      used.set(base, n)
      return n === 1 ? base : `${base}-${n}`
    }

    function Heading(tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') {
      return ({ node: _node, children, ...props }: any) => {
        const text = nodeText(children).trim()
        const id = allocHeadingId(text)
        const tabIndex = typeof props.tabIndex === 'number' ? props.tabIndex : -1
        const Tag = tag
        return (
          <Tag {...props} id={id} tabIndex={tabIndex}>
            {children}
          </Tag>
        )
      }
    }

    return {
      h1: Heading('h1'),
      h2: Heading('h2'),
      h3: Heading('h3'),
      h4: Heading('h4'),
      h5: Heading('h5'),
      h6: Heading('h6'),
      pre: ({ node: _node, children, ...props }: any) => {
        const child = Array.isArray(children) ? children[0] : children
        if (isValidElement(child)) {
          const childProps: any = child.props
          const className = typeof childProps?.className === 'string' ? childProps.className : ''
          if (className.includes('language-mermaid')) {
            const codeText = nodeText(childProps.children)
            return <MermaidBlock code={codeText} />
          }
        }

        const codeText = nodeText(children)
        return (
          <div className="codeBlock">
            <div className="codeBlockBar">
              <button
                type="button"
                className="codeBlockCopy"
                onClick={() => void navigator.clipboard.writeText(codeText).catch(() => null)}
                aria-label="复制代码"
                title="复制代码"
              >
                复制
              </button>
            </div>
            <pre {...props}>{children}</pre>
          </div>
        )
      },
      img: ({ node: _node, src, alt, ...props }: any) => {
        const name = parseAttachmentRef(src)
        if (name) {
          const dataUrl = atts[name]
          if (dataUrl && isSafeInlineImageDataUrl(dataUrl)) {
            return <img src={dataUrl} alt={alt ?? ''} loading="lazy" {...props} />
          }
          return (
            <div className="imagePlaceholder missing" role="note">
              <div className="imagePlaceholderTitle">附件图片未找到</div>
              <div className="muted small">{name}</div>
              <div className="muted small">请确认附件已添加并上传。</div>
            </div>
          )
        }

        const resolved = sanitizeImageSrc(src)
        if (!resolved) {
          const url = (() => {
            if (!src) return null
            try {
              const u = new URL(src)
              const protocol = u.protocol.toLowerCase()
              if (protocol === 'http:' || protocol === 'https:') return u.toString()
              return null
            } catch {
              return null
            }
          })()

          return (
            <div className="imagePlaceholder" role="note">
              <div className="imagePlaceholderTitle">已阻止外链图片</div>
              <div className="muted small">为保护隐私与安全，Inkrypt 默认不加载外链图片。</div>
              {url ? (
                <div className="imagePlaceholderActions">
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    打开图片链接
                  </a>
                </div>
              ) : null}
            </div>
          )
        }
        return <img src={resolved} alt={alt ?? ''} loading="lazy" {...props} />
      },
      a: ({ node: _node, href, children, ...props }: any) => {
        const name = parseAttachmentRef(href)
        const dataUrl = name ? atts[name] : null
        if (name && dataUrl) {
          return (
            <a
              href="#"
              className="attachmentLink"
              onClick={(e) => {
                e.preventDefault()
                downloadDataUrl(dataUrl, name)
              }}
              title={`下载附件：${name}`}
              {...props}
            >
              <span className="attachmentLinkText">{children}</span>
              <span className="attachmentLinkHint" aria-hidden="true">
                下载
              </span>
            </a>
          )
        }

        const safeHref = sanitizeLinkHref(href)
        if (!safeHref) return <span {...props}>{children}</span>

        if (safeHref.startsWith('#')) {
          return (
            <a
              href={safeHref}
              onClick={(e) => {
                e.preventDefault()
                scrollToHeading(safeHref.slice(1))
              }}
              {...props}
            >
              {children}
            </a>
          )
        }

        const isExternal = /^https?:/i.test(safeHref) || /^mailto:/i.test(safeHref)
        return (
          <a href={safeHref} target={isExternal ? '_blank' : undefined} rel={isExternal ? 'noopener noreferrer' : undefined} {...props}>
            {children}
          </a>
        )
      },
    }
  })()

  const urlTransform = (value: string) => {
    const trimmed = value.trim()
    const lower = trimmed.toLowerCase()
    if (lower.startsWith('attachment:')) return trimmed
    if (lower.startsWith('data:')) return trimmed
    return defaultUrlTransform(trimmed)
  }

  return (
    <div className="markdown-preview">
      {showOutline && headings.length ? (
        <nav className="outline" aria-label="目录" ref={outlineRef}>
          <div className="outlineTitle">
            <strong>目录</strong>
            <span className="muted small">{headings.length}</span>
          </div>
          <ul className="outlineList">
            {headings.map((h) => (
              <li key={h.id} className="outlineItem" style={{ ['--outline-indent' as any]: `${(h.level - 1) * 12}px` }}>
                <a
                  className="outlineLink"
                  href={`#${h.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    scrollToHeading(h.id)
                  }}
                  title={`${h.text} (#${h.id})`}
                  aria-current={activeHeadingId === h.id ? 'location' : undefined}
                >
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <div ref={markdownBodyRef}>
        <ReactMarkdown
          urlTransform={urlTransform}
          remarkPlugins={[remarkMath, remarkGfm, remarkSoftBreaksToBr, remarkDoubleDollarToDisplay]}
          rehypePlugins={[rehypeKatex, rehypeHighlight]}
          components={components}
        >
          {deferredContent}
        </ReactMarkdown>
        <div className="markdownBottomSpacer" aria-hidden="true" />
      </div>
      {showScrollTop ? (
        fabPortalTarget ? (
          createPortal(
            <button className="fab fabScrollTop" onClick={scrollToTop} type="button" title="回到顶部" aria-label="回到顶部">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
              </svg>
            </button>,
            fabPortalTarget,
          )
        ) : null
      ) : null}
    </div>
  )
})
