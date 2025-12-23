import { diffLines } from 'diff'
import { useMemo } from 'react'

type DiffRow =
  | { kind: 'add' | 'del' | 'same'; text: string }
  | { kind: 'skip'; text: string; skipCount: number }

function toLines(value: string): string[] {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function buildRows(a: string, b: string): DiffRow[] {
  const parts = diffLines(a, b, { ignoreWhitespace: false })
  const rows: DiffRow[] = []

  for (const p of parts) {
    const kind: DiffRow['kind'] = p.added ? 'add' : p.removed ? 'del' : 'same'
    const lines = toLines(p.value)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (i === lines.length - 1 && line === '') continue
      rows.push({ kind, text: line })
    }
  }

  return rows
}

function compressUnchanged(rows: DiffRow[], context: number): DiffRow[] {
  const out: DiffRow[] = []
  let i = 0

  while (i < rows.length) {
    if (rows[i].kind !== 'same') {
      out.push(rows[i])
      i += 1
      continue
    }

    let j = i
    while (j < rows.length && rows[j].kind === 'same') j += 1

    const blockLen = j - i
    if (blockLen <= context * 2 + 2) {
      out.push(...rows.slice(i, j))
      i = j
      continue
    }

    out.push(...rows.slice(i, i + context))
    out.push({ kind: 'skip', text: `…已折叠 ${blockLen - context * 2} 行未变化内容…`, skipCount: blockLen - context * 2 })
    out.push(...rows.slice(j - context, j))
    i = j
  }

  return out
}

export function DiffView({
  a,
  b,
  maxLines = 2000,
}: {
  a: string
  b: string
  maxLines?: number
}) {
  const rows = useMemo(() => {
    const raw = buildRows(a, b)
    const compressed = compressUnchanged(raw, 3)
    if (compressed.length <= maxLines) return { rows: compressed, truncated: false }
    return { rows: compressed.slice(0, maxLines), truncated: true }
  }, [a, b, maxLines])

  return (
    <div className="diffBox" role="region" aria-label="差异对比">
      {rows.truncated ? <div className="diffLine skip">…内容过长，已截断显示…</div> : null}
      {(() => {
        let aLine = 1
        let bLine = 1

        return rows.rows.map((r, idx) => {
          if (r.kind === 'skip') {
            aLine += r.skipCount
            bLine += r.skipCount
            return (
              <div key={idx} className="diffLine skip">
                <span className="diffText">{r.text}</span>
              </div>
            )
          }

          const prefix = r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '
          const leftNo = r.kind === 'add' ? '' : String(aLine)
          const rightNo = r.kind === 'del' ? '' : String(bLine)

          if (r.kind === 'same') {
            aLine += 1
            bLine += 1
          } else if (r.kind === 'add') {
            bLine += 1
          } else if (r.kind === 'del') {
            aLine += 1
          }

          const cls = r.kind === 'add' ? 'diffLine added' : r.kind === 'del' ? 'diffLine removed' : 'diffLine'

          return (
            <div key={idx} className={cls}>
              <span className="diffNum" aria-hidden="true">
                {leftNo}
              </span>
              <span className="diffNum" aria-hidden="true">
                {rightNo}
              </span>
              <span className="diffPrefix" aria-hidden="true">
                {prefix}
              </span>
              <span className="diffText">{r.text}</span>
            </div>
          )
        })
      })()}
    </div>
  )
}
