import { describe, expect, test } from 'vitest'
import { getFinishPairingError, normalizePairingDeviceName } from './useAuthPairing'

describe('useAuthPairing pure helpers', () => {
  test('requires transferred preparation before finishing pairing', () => {
    expect(getFinishPairingError(null, new Uint8Array(32))).toBe(
      '请先完成"连接旧设备"，并等待密钥传输完成。',
    )
  })

  test('requires the transferred master key after preparation exists', () => {
    expect(getFinishPairingError({ challenge: 'ready' }, null)).toBe(
      '尚未收到主密钥，请稍等或重新开始配对。',
    )
  })

  test('allows finish flow only when both preparation and master key exist', () => {
    expect(getFinishPairingError({ challenge: 'ready' }, new Uint8Array(32))).toBeNull()
  })

  test('normalizes device names by trimming and collapsing blank input to null', () => {
    expect(normalizePairingDeviceName('  My Phone  ')).toBe('My Phone')
    expect(normalizePairingDeviceName('   ')).toBeNull()
  })
})
