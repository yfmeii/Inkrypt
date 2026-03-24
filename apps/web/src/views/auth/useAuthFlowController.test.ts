import { describe, expect, test } from 'vitest'
import { normalizeAuthDeviceName } from './useAuthFlowController'

describe('useAuthFlowController pure helpers', () => {
  test('normalizes auth device names by trimming and collapsing blank input to null', () => {
    expect(normalizeAuthDeviceName('  My Laptop  ')).toBe('My Laptop')
    expect(normalizeAuthDeviceName('   ')).toBeNull()
  })
})
