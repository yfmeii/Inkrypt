/**
 * Vitest Setup File
 * 
 * Global test setup and configuration
 */

import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Cleanup after each test
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Setup fake-indexeddb for testing
import 'fake-indexeddb/auto'

// Mock zustand store
vi.mock('../state/store', () => ({
  useInkryptStore: vi.fn(() => ({
    mode: 'light',
  })),
}))


