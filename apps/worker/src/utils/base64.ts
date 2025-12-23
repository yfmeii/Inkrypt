export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(value, 'base64')
  const out = new Uint8Array(buf.byteLength)
  out.set(buf)
  return out as Uint8Array<ArrayBuffer>
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(value, 'base64url')
  const out = new Uint8Array(buf.byteLength)
  out.set(buf)
  return out as Uint8Array<ArrayBuffer>
}

export function randomBase64Url(bytesLength = 32): string {
  const bytes = new Uint8Array(bytesLength)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}
