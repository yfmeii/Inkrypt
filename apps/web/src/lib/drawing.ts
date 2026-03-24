import { dataUrlToBlob } from './attachments'
import type { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'

const DRAWING_SCENE_PREFIX = 'drawing-'
const DRAWING_SCENE_SUFFIX = '.excalidraw.json'
const DRAWING_PREVIEW_SUFFIX = '.png'

export const MAX_DRAWING_SCENE_BYTES = 3_000_000
export const MAX_DRAWING_PREVIEW_BYTES = 1_500_000

export type DrawingAttachmentNames = {
  scene: string
  preview: string
}

export type DrawingInitialData = ExcalidrawInitialDataState

export function createDrawingId(): string {
  return crypto.randomUUID()
}

export function getDrawingAttachmentNames(drawingId: string): DrawingAttachmentNames {
  const base = `${DRAWING_SCENE_PREFIX}${drawingId}`
  return {
    scene: `${base}${DRAWING_SCENE_SUFFIX}`,
    preview: `${base}${DRAWING_PREVIEW_SUFFIX}`,
  }
}

export function isDrawingSceneAttachment(name: string): boolean {
  return name.startsWith(DRAWING_SCENE_PREFIX) && name.endsWith(DRAWING_SCENE_SUFFIX)
}

export function getDrawingIdFromAttachment(name: string): string | null {
  if (!isDrawingSceneAttachment(name)) return null
  return name.slice(DRAWING_SCENE_PREFIX.length, -DRAWING_SCENE_SUFFIX.length) || null
}

export function toDrawingPreviewUrl(filename: string): string {
  return `attachment:${encodeURIComponent(filename)}`
}

export function toDrawingSceneUrl(filename: string): string {
  return `attachment:${encodeURIComponent(filename)}`
}

export function getAttachmentNameFromUrl(url: string): string | null {
  if (!url.startsWith('attachment:')) return null
  const name = url.slice('attachment:'.length)
  try {
    return decodeURIComponent(name)
  } catch {
    return name || null
  }
}

export function sceneJsonToDataUrl(sceneJson: string): string {
  const bytes = new TextEncoder().encode(sceneJson)
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return `data:application/json;base64,${btoa(binary)}`
}

export async function parseDrawingSceneData(dataUrl: string): Promise<DrawingInitialData> {
  const { blob } = dataUrlToBlob(dataUrl)
  const text = await blob.text()
  const parsed = JSON.parse(text) as ExcalidrawInitialDataState
  return {
    elements: Array.isArray(parsed.elements) ? parsed.elements : [],
    appState: parsed.appState && typeof parsed.appState === 'object' ? parsed.appState : {},
    files: parsed.files && typeof parsed.files === 'object' ? parsed.files : {},
  }
}
