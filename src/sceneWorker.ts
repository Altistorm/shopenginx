import { type SceneData, type VideoJob, type VideoOptions, type VideoResult } from './hooks/useVideoWorkflow'
import { type StoryCharacter, IMAGE_STYLES } from './storyPrompts'

// ─── Types ─────────────────────────────────────────────

export interface SceneWorkerConfig {
  aspectRatio: string
  imageCount: number
  autoSaveImage: boolean
  downloadResolution: string
  downloadToFolder: boolean
}

export interface InitResult {
  success: boolean
  error?: string
}

export interface SceneResult {
  success?: boolean
  imagesCreated?: number
  error?: string
  imageBase64?: string
  imageUUIDs?: string[]
}

export interface CreateImageOpts {
  sceneIndex?: number      // message sceneIndex (default 0)
  totalScenes?: number     // message totalScenes (default 1)
  isLast?: boolean         // default true
  captureImage?: boolean   // default true
}

export interface RefPayloadContext {
  style: string
  bulkUsePreviewGrid: boolean
  storyCharacters: StoryCharacter[]
  storyboardPreviewImage: string | null
  storyboardPreviewUuid: string | null
  scenes: SceneData[]
}

const IMAGE_URL_PREFIX = 'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name='

// ─── Utilities ─────────────────────────────────────────

/** Resolve image data: prefer base64, fallback to URL from UUID */
export function resolveImageData(base64?: string, uuid?: string): string | undefined {
  return base64 || (uuid ? `${IMAGE_URL_PREFIX}${uuid}` : undefined)
}

/** Build prompt + reference payload for a scene (pure function — no React) */
export function buildRefPayload(
  sceneIndex: number,
  prompt: string,
  context: RefPayloadContext,
  opts?: { autoCharRefUuid?: string | null; autoCharRef?: string | null }
): { finalPrompt: string; refUuid?: string; refImage?: string } {
  const hasPreviewGrid = !!context.storyboardPreviewImage || !!context.storyboardPreviewUuid

  if (hasPreviewGrid && context.bulkUsePreviewGrid) {
    // GRID MODE: use storyboard preview as reference + "find SCENE N" prompt
    const sceneNum = sceneIndex + 1
    const styleDesc = IMAGE_STYLES[context.style]?.split(',')[0] || 'Pixar 3D'
    const finalPrompt = `${styleDesc} style.\n\nThe attached image is a STORYBOARD with multiple scene panels.\nFind and recreate SCENE ${sceneNum} as a single full-frame image.\n\nSCENE ${sceneNum} DESCRIPTION:\n${prompt}\n\nINSTRUCTIONS:\n- Look for the panel labeled "SCENE ${sceneNum}" in the storyboard grid\n- Recreate ONLY that specific panel as a full detailed image\n- Match exactly: character design, pose, expression, background from that panel\n- Output: ONE full image, no grid, no panels, no text labels\n- Single continuous image only, no collage, no multiple frames\n- Fill the ENTIRE frame edge-to-edge, NO black bars, NO letterboxing\n- Do NOT include aspect ratio`
    return {
      finalPrompt,
      refUuid: context.storyboardPreviewUuid || undefined,
      refImage: !context.storyboardPreviewUuid ? (context.storyboardPreviewImage || undefined) : undefined,
    }
  }

  // FALLBACK: character reference from scene 0
  let charRefText = ''
  if (context.storyCharacters.length > 0) {
    const charDesc = context.storyCharacters.map(c => `${c.name}: ${c.appearance}`).join('; ')
    charRefText = `\n\n[Character Reference: ${charDesc}]`
  }
  const ingredientInstruction = sceneIndex > 0
    ? `\n\n[IMPORTANT: The ingredient image is ONLY a reference for character appearance and art style/tone consistency. Do NOT copy its background, composition, camera angle, or pose. Generate a completely NEW scene with a DIFFERENT background and setting as described in this prompt. Match the characters and visual tone only.]`
    : ''
  const finalPrompt = prompt + charRefText + ingredientInstruction

  const refUuid = opts?.autoCharRefUuid
    ?? (sceneIndex > 0 ? context.scenes.find(s => s.sceneIndex === 0)?.startFrameImageUuid : undefined)
  const refImage = sceneIndex > 0 && !refUuid
    ? (opts?.autoCharRef ?? context.scenes.find(s => s.sceneIndex === 0)?.startFrameImage ?? undefined)
    : undefined

  return { finalPrompt, refUuid: refUuid || undefined, refImage: refImage || undefined }
}

// ─── SceneWorker ───────────────────────────────────────

/**
 * Pure message sender — no React, no state.
 * Sends chrome extension messages to Google Flow content script.
 * Created per operation (per-scene button) or per bulk run.
 */
export class SceneWorker {
  constructor(
    private tabId: number,
    private config: SceneWorkerConfig,
  ) {}

  /** Send INIT_STORY_MODE to content script */
  async init(totalScenes: number): Promise<InitResult> {
    return chrome.tabs.sendMessage(this.tabId, {
      type: 'INIT_STORY_MODE',
      aspectRatio: this.config.aspectRatio,
      imageCount: this.config.imageCount,
      totalScenes,
    })
  }

  /** Send CREATE_STORY_SCENE — start OR end frame */
  async createImage(
    refPayload: { finalPrompt: string; refUuid?: string; refImage?: string },
    opts?: CreateImageOpts,
  ): Promise<SceneResult> {
    return chrome.tabs.sendMessage(this.tabId, {
      type: 'CREATE_STORY_SCENE',
      prompt: refPayload.finalPrompt,
      sceneIndex: opts?.sceneIndex ?? 0,
      totalScenes: opts?.totalScenes ?? 1,
      imageCount: this.config.imageCount,
      autoSaveImage: this.config.autoSaveImage,
      downloadResolution: this.config.downloadResolution,
      isLast: opts?.isLast ?? true,
      captureImage: opts?.captureImage ?? true,
      referenceImageUuid: refPayload.refUuid,
      referenceImage: refPayload.refImage,
    })
  }

  /** Generate video for a single scene */
  async generateVideo(
    scene: SceneData,
    startVideoFn: (jobs: VideoJob[], options: VideoOptions) => Promise<VideoResult>,
  ): Promise<VideoResult> {
    const vp = scene.videoPrompt.trim() || scene.startFramePrompt
    const fullPrompt = scene.script ? `${vp}\n\nScript: "${scene.script}"` : vp

    const job: VideoJob = {
      image: scene.startFrameImageUuid ? null : (scene.startFrameImage || null),
      imageUuid: scene.startFrameImageUuid,
      prompts: [fullPrompt],
    }

    return startVideoFn([job], {
      aspectRatio: this.config.aspectRatio,
      videoCount: 1,
      autoDownload: this.config.autoSaveImage,
      downloadToFolder: this.config.downloadToFolder,
      continueFromCurrent: !!scene.startFrameImageUuid,
    })
  }

  /** Add scene to video editor (future — no-op) */
  async addToScene(_scene: SceneData): Promise<void> {
    // TODO: Wire up onAddToScene
  }
}
