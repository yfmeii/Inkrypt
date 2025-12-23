import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export function QrCode(props: { text: string; size?: number; className?: string; alt?: string }) {
  const { text, size = 220, className, alt = '二维码' } = props
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setDataUrl(null)
    void QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!alive) return
        setDataUrl(url)
      })
      .catch(() => {
        if (!alive) return
        setDataUrl(null)
      })
    return () => {
      alive = false
    }
  }, [size, text])

  if (!dataUrl) {
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 12,
          border: '1px solid var(--md-sys-color-outline-variant)',
          background: 'var(--md-sys-color-surface-container)',
          color: 'var(--md-sys-color-on-surface-variant)',
          fontSize: 12,
        }}
      >
        正在生成二维码…
      </div>
    )
  }

  return <img className={className} src={dataUrl} width={size} height={size} alt={alt} />
}

