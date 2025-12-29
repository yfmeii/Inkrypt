import { describe, test, expect, beforeEach, vi } from 'vitest'
import * as Y from 'yjs'
import { YjsDocManager } from './docManager'
import { encodeYDoc } from './serializer'

describe('YjsDocManager', () => {
  let manager: YjsDocManager

  beforeEach(() => {
    manager = new YjsDocManager()
  })

  describe('initialization', () => {
    test('initializes with empty Y.Doc when no snapshot provided', async () => {
      const doc = await manager.initialize('note-1')

      expect(doc).toBeInstanceOf(Y.Doc)
      expect(manager.getDoc()).toBe(doc)
      expect(manager.isDirty()).toBe(false)
      
      const state = manager.getState()
      expect(state).not.toBeNull()
      expect(state?.noteId).toBe('note-1')
      expect(state?.lastSyncedSnapshot).toBeNull()
    })

    test('initializes from base64 snapshot', async () => {
      // Create a Y.Doc with some content
      const originalDoc = new Y.Doc()
      const text = originalDoc.getText('content')
      text.insert(0, 'Hello World')
      const snapshot = encodeYDoc(originalDoc)

      // Initialize manager with snapshot
      const doc = await manager.initialize('note-2', snapshot)

      expect(doc).toBeInstanceOf(Y.Doc)
      expect(doc.getText('content').toString()).toBe('Hello World')
      expect(manager.isDirty()).toBe(false)
      
      const state = manager.getState()
      expect(state?.noteId).toBe('note-2')
      expect(state?.lastSyncedSnapshot).toBe(snapshot)
    })

    test('cleans up old listeners when re-initializing', async () => {
      // First initialization
      const doc1 = await manager.initialize('note-1')
      const text1 = doc1.getText('content')
      text1.insert(0, 'first')
      
      expect(manager.isDirty()).toBe(true)

      // Second initialization should clean up old listeners
      const doc2 = await manager.initialize('note-2')
      
      // Modifying old doc should not affect manager state
      text1.insert(0, 'more')
      
      const state = manager.getState()
      expect(state?.noteId).toBe('note-2')
      expect(state?.doc).toBe(doc2)
    })
  })

  describe('dirty state tracking', () => {
    test('marks document as dirty when content changes', async () => {
      const doc = await manager.initialize('note-1')
      
      expect(manager.isDirty()).toBe(false)

      // Make a change
      const text = doc.getText('content')
      text.insert(0, 'test')

      expect(manager.isDirty()).toBe(true)
    })

    test('tracks dirty state across multiple edits', async () => {
      const doc = await manager.initialize('note-1')
      const text = doc.getText('content')

      expect(manager.isDirty()).toBe(false)

      text.insert(0, 'first')
      expect(manager.isDirty()).toBe(true)

      text.insert(5, ' second')
      expect(manager.isDirty()).toBe(true)
    })

    test('markSynced clears dirty flag', async () => {
      const doc = await manager.initialize('note-1')
      const text = doc.getText('content')
      
      text.insert(0, 'content')
      expect(manager.isDirty()).toBe(true)

      const snapshot = encodeYDoc(doc)
      manager.markSynced(snapshot)

      expect(manager.isDirty()).toBe(false)
      
      const state = manager.getState()
      expect(state?.lastSyncedSnapshot).toBe(snapshot)
    })

    test('becomes dirty again after markSynced if new edits occur', async () => {
      const doc = await manager.initialize('note-1')
      const text = doc.getText('content')
      
      text.insert(0, 'first')
      const snapshot = encodeYDoc(doc)
      manager.markSynced(snapshot)
      
      expect(manager.isDirty()).toBe(false)

      text.insert(5, ' second')
      expect(manager.isDirty()).toBe(true)
    })
  })

  describe('onChange callbacks', () => {
    test('notifies subscribers when document changes', async () => {
      const doc = await manager.initialize('note-1')
      const callback = vi.fn()
      
      manager.onChange(callback)

      const text = doc.getText('content')
      text.insert(0, 'test')

      expect(callback).toHaveBeenCalled()
    })

    test('notifies subscribers when markSynced is called', async () => {
      const doc = await manager.initialize('note-1')
      const text = doc.getText('content')
      text.insert(0, 'content')
      
      const callback = vi.fn()
      manager.onChange(callback)

      const snapshot = encodeYDoc(doc)
      manager.markSynced(snapshot)

      expect(callback).toHaveBeenCalled()
    })

    test('supports multiple subscribers', async () => {
      const doc = await manager.initialize('note-1')
      const callback1 = vi.fn()
      const callback2 = vi.fn()
      
      manager.onChange(callback1)
      manager.onChange(callback2)

      const text = doc.getText('content')
      text.insert(0, 'test')

      expect(callback1).toHaveBeenCalled()
      expect(callback2).toHaveBeenCalled()
    })

    test('unsubscribe function removes callback', async () => {
      const doc = await manager.initialize('note-1')
      const callback = vi.fn()
      
      const unsubscribe = manager.onChange(callback)
      unsubscribe()

      const text = doc.getText('content')
      text.insert(0, 'test')

      expect(callback).not.toHaveBeenCalled()
    })

    test('multiple edits trigger multiple notifications', async () => {
      const doc = await manager.initialize('note-1')
      const callback = vi.fn()
      
      manager.onChange(callback)

      const text = doc.getText('content')
      text.insert(0, 'first')
      text.insert(5, ' second')
      text.insert(12, ' third')

      expect(callback).toHaveBeenCalledTimes(3)
    })
  })

  describe('getDoc and getState', () => {
    test('getDoc returns null before initialization', () => {
      expect(manager.getDoc()).toBeNull()
    })

    test('getState returns null before initialization', () => {
      expect(manager.getState()).toBeNull()
    })

    test('getDoc returns initialized document', async () => {
      const doc = await manager.initialize('note-1')
      expect(manager.getDoc()).toBe(doc)
    })

    test('getState returns complete state', async () => {
      const originalDoc = new Y.Doc()
      originalDoc.getText('content').insert(0, 'test')
      const snapshot = encodeYDoc(originalDoc)

      await manager.initialize('note-1', snapshot)

      const state = manager.getState()
      expect(state).not.toBeNull()
      expect(state?.noteId).toBe('note-1')
      expect(state?.dirty).toBe(false)
      expect(state?.lastSyncedSnapshot).toBe(snapshot)
      expect(state?.doc).toBeInstanceOf(Y.Doc)
    })
  })

  describe('destroy', () => {
    test('cleans up resources', async () => {
      const doc = await manager.initialize('note-1')
      const callback = vi.fn()
      manager.onChange(callback)

      manager.destroy()

      expect(manager.getDoc()).toBeNull()
      expect(manager.getState()).toBeNull()

      // Modifying doc after destroy should not trigger callback
      const text = doc.getText('content')
      text.insert(0, 'test')
      expect(callback).not.toHaveBeenCalled()
    })

    test('can be called multiple times safely', async () => {
      await manager.initialize('note-1')
      
      manager.destroy()
      manager.destroy()
      
      expect(manager.getDoc()).toBeNull()
    })

    test('can be called before initialization', () => {
      expect(() => manager.destroy()).not.toThrow()
    })
  })
})
