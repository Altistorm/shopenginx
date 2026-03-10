import { type SceneData } from './hooks/useVideoWorkflow'
import { type StoryCharacter } from './storyPrompts'

// ─── Types ─────────────────────────────────────────────

export interface WorkflowConfig {
  style: string
  aspectRatio: '9:16' | '16:9'
  imageCount: number
  noTextOnImage: boolean
  autoSaveImage: boolean
  downloadResolution: '1K' | '2K' | '4K'
  downloadToFolder: boolean
  autoGenerateVideo: boolean
  videoExtensionMode: boolean
  referenceStyle: string
  storyMood: string
  videoType: string
  storySceneCount: number
  storyTopic: string
  productName: string
  scene: string
  bulkUsePreviewGrid: boolean
}

export interface WorkflowStory {
  title: string
  characters: StoryCharacter[]
  storyboardPrompt: string
  storyboardPreviewUuid?: string | null
}

export interface WorkflowCheckpoint {
  version: 1
  createdAt: number
  updatedAt: number
  config: WorkflowConfig
  story: WorkflowStory
  scenes: SceneData[]
}

// ─── Constants ─────────────────────────────────────────

const CHECKPOINT_KEY = 'shopEnginX_workflow_checkpoint'

// ─── Utilities ─────────────────────────────────────────

/** Strip base64 image data from checkpoint to keep within chrome.storage.local limits (~50-100 KB). */
export function stripBase64(checkpoint: WorkflowCheckpoint): WorkflowCheckpoint {
  return {
    ...checkpoint,
    story: {
      ...checkpoint.story,
      // storyboardPreviewImage is not in WorkflowStory (only UUID kept)
    },
    scenes: checkpoint.scenes.map(s => ({
      ...s,
      startFrameImage: undefined,
      endFrameImage: undefined,
      videoUrl: undefined,
    })),
  }
}

/** Validate raw data as a WorkflowCheckpoint. Returns null if invalid. */
export function validateCheckpoint(data: unknown): WorkflowCheckpoint | null {
  if (!data || typeof data !== 'object') return null
  const cp = data as Record<string, unknown>
  if (cp.version !== 1) return null
  if (!cp.config || typeof cp.config !== 'object') return null
  if (!cp.story || typeof cp.story !== 'object') return null
  if (!Array.isArray(cp.scenes)) return null
  if (cp.scenes.length === 0) return null
  return data as WorkflowCheckpoint
}

/** Check if checkpoint has any incomplete artifacts. */
export function hasIncompleteWork(checkpoint: WorkflowCheckpoint): boolean {
  return checkpoint.scenes.some(s =>
    !s.imageCreated || !s.videoCreated
    // endFrameCreated is optional — only count if scene has an endFramePrompt
  )
}

/** Get human-readable progress summary. */
export function getProgressSummary(checkpoint: WorkflowCheckpoint): {
  totalScenes: number
  startFramesDone: number
  endFramesDone: number
  videosDone: number
  scenesWithEndFrame: number
} {
  const scenes = checkpoint.scenes
  return {
    totalScenes: scenes.length,
    startFramesDone: scenes.filter(s => s.imageCreated).length,
    endFramesDone: scenes.filter(s => s.endFrameCreated).length,
    videosDone: scenes.filter(s => s.videoCreated).length,
    scenesWithEndFrame: scenes.filter(s => s.endFramePrompt?.trim()).length,
  }
}

// ─── Storage Operations ────────────────────────────────

/** Save checkpoint to chrome.storage.local (strips base64 automatically). */
export async function saveToStorage(checkpoint: WorkflowCheckpoint): Promise<void> {
  const lightweight = stripBase64(checkpoint)
  lightweight.updatedAt = Date.now()
  await chrome.storage.local.set({ [CHECKPOINT_KEY]: lightweight })
}

/** Load checkpoint from chrome.storage.local. Returns null if not found or invalid. */
export async function loadFromStorage(): Promise<WorkflowCheckpoint | null> {
  const result = await chrome.storage.local.get(CHECKPOINT_KEY)
  const data = result[CHECKPOINT_KEY]
  if (!data) return null
  return validateCheckpoint(data)
}

/** Remove checkpoint from chrome.storage.local. */
export async function clearFromStorage(): Promise<void> {
  await chrome.storage.local.remove(CHECKPOINT_KEY)
}

// ─── Export / Import ───────────────────────────────────

/** Serialize checkpoint to JSON string. Optionally includes base64 images. */
export function exportCheckpoint(checkpoint: WorkflowCheckpoint, includeImages: boolean): string {
  const data = includeImages ? checkpoint : stripBase64(checkpoint)
  return JSON.stringify(data, null, 2)
}

/** Parse and validate imported JSON string. Returns null if invalid. */
export function importCheckpoint(json: string): WorkflowCheckpoint | null {
  try {
    const data = JSON.parse(json)
    return validateCheckpoint(data)
  } catch {
    return null
  }
}

/** Download checkpoint as a .json file. */
export function downloadCheckpointFile(checkpoint: WorkflowCheckpoint, includeImages: boolean): void {
  const json = exportCheckpoint(checkpoint, includeImages)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const a = document.createElement('a')
  a.href = url
  a.download = `shopEnginX-checkpoint-${timestamp}.json`
  a.click()
  URL.revokeObjectURL(url)
}
