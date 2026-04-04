import { useState, useCallback, useRef } from 'react'
import { queryTargetTab } from '../targetTab'
import { type VideoJob, type VideoOptions, type VideoResult } from './useVideoWorkflow'
import {
  SceneWorker,
  buildRefPayload,
  resolveImageData,
  type SceneWorkerConfig,
  type SceneResult,
  type RefPayloadContext,
} from '../sceneWorker'
import type { SceneData } from './useVideoWorkflow'
import type { StoryCharacter } from '../storyPrompts'

// Re-export for consumers
export type { SceneResult }

// ─── Types ─────────────────────────────────────────────

export interface StoryWorkflowConfig {
  style: string
  aspectRatio: '9:16' | '16:9'
  imageCount: number
  autoSaveImage: boolean
  downloadResolution: '1K' | '2K' | '4K'
  downloadToFolder: boolean
  autoGenerateVideo: boolean
  videoExtensionMode: boolean
  bulkUsePreviewGrid: boolean
}

export interface StoryWorkflowDeps {
  storyCharacters: StoryCharacter[]
  startVideo: (jobs: VideoJob[], options: VideoOptions) => Promise<VideoResult>
  onCheckpoint: (freshScenes?: SceneData[]) => Promise<void>
  onError: (msg: string) => void
}

export interface RunAllResult {
  success: boolean
  completedScenes: number
  totalScenes: number
  completedVideos: number
  totalVideos: number
  error?: string
}

// ─── Hook ──────────────────────────────────────────────

export function useStoryWorkflow(config: StoryWorkflowConfig, deps: StoryWorkflowDeps) {
  // ── State ──
  const [scenes, setScenes] = useState<SceneData[]>([])
  const [storyboardPreviewImage, setStoryboardPreviewImage] = useState<string | null>(null)
  const [storyboardPreviewUuid, setStoryboardPreviewUuid] = useState<string | null>(null)
  const [generatingImage, setGeneratingImage] = useState<string | null>(null)
  const [generatingVideo, setGeneratingVideo] = useState<string | null>(null)
  const [generatingPreview, setGeneratingPreview] = useState(false)
  const [storyCurrentScene, setStoryCurrentScene] = useState<number | null>(null)
  const [storyTotalScenes, setStoryTotalScenes] = useState(0)

  // ── Refs (avoid stale closures in callbacks) ──
  const configRef = useRef(config)
  configRef.current = config
  const depsRef = useRef(deps)
  depsRef.current = deps
  const scenesRef = useRef(scenes)
  scenesRef.current = scenes
  const previewImageRef = useRef(storyboardPreviewImage)
  previewImageRef.current = storyboardPreviewImage
  const previewUuidRef = useRef(storyboardPreviewUuid)
  previewUuidRef.current = storyboardPreviewUuid

  // ── Internal helpers ──

  /** Get active tab, validate it's on Google Flow */
  const getFlowTab = useCallback(async (): Promise<chrome.tabs.Tab> => {
    const [tab] = await queryTargetTab()
    if (!tab?.url?.includes('labs.google/fx/tools/flow')) {
      throw new Error('กรุณาเปิด Google Flow ก่อน (labs.google/fx/tools/flow)')
    }
    return tab
  }, [])

  /** Build SceneWorkerConfig from current hook config */
  const makeWorkerConfig = (): SceneWorkerConfig => ({
    aspectRatio: configRef.current.aspectRatio,
    imageCount: configRef.current.imageCount,
    autoSaveImage: configRef.current.autoSaveImage,
    downloadResolution: configRef.current.downloadResolution,
    downloadToFolder: configRef.current.downloadToFolder,
  })

  /** Build RefPayloadContext from current React state */
  const makeRefContext = (): RefPayloadContext => ({
    style: configRef.current.style,
    bulkUsePreviewGrid: configRef.current.bulkUsePreviewGrid,
    storyCharacters: depsRef.current.storyCharacters,
    storyboardPreviewImage: previewImageRef.current,
    storyboardPreviewUuid: previewUuidRef.current,
    scenes: scenesRef.current,
  })

  // ── Public operations ──

  /** Create a single scene image (start or end frame) */
  const createImage = useCallback(async (sceneIndex: number, type: 'start' | 'end'): Promise<SceneResult> => {
    const sceneItem = scenesRef.current.find(s => s.sceneIndex === sceneIndex)
    if (!sceneItem) return { success: false, error: 'Scene not found' }

    const prompt = type === 'start' ? sceneItem.startFramePrompt : sceneItem.endFramePrompt
    if (!prompt.trim()) {
      depsRef.current.onError(`กรุณาใส่ ${type === 'start' ? 'Start Frame' : 'End Frame'} Prompt ก่อน`)
      return { success: false, error: 'Empty prompt' }
    }

    setGeneratingImage(`${type}-${sceneIndex}`)
    try {
      const tab = await getFlowTab()
      const worker = new SceneWorker(tab.id!, makeWorkerConfig())

      const initResp = await worker.init(1)
      if (!initResp?.success) {
        const err = `Init failed: ${initResp?.error || 'Unknown error'}`
        depsRef.current.onError(err)
        return { success: false, error: err }
      }

      const ref = buildRefPayload(sceneIndex, prompt, makeRefContext())
      const sceneResp = await worker.createImage(ref)

      if (sceneResp?.success) {
        const imageData = resolveImageData(sceneResp.imageBase64, sceneResp.imageUUIDs?.[0])
        setScenes(prev => prev.map(s =>
          s.sceneIndex === sceneIndex
            ? {
                ...s,
                ...(type === 'start'
                  ? { startFrameImage: imageData, startFrameImageUuid: sceneResp.imageUUIDs?.[0], imageCreated: true }
                  : { endFrameImage: imageData, endFrameImageUuid: sceneResp.imageUUIDs?.[0], endFrameCreated: true }
                ),
              }
            : s
        ))
      } else {
        depsRef.current.onError(`Scene ${sceneIndex + 1} ${type} frame failed: ${sceneResp?.error || 'Unknown error'}`)
      }

      return sceneResp
    } catch (err) {
      const errMsg = (err as Error).message
      depsRef.current.onError(errMsg)
      return { success: false, error: errMsg }
    } finally {
      setGeneratingImage(null)
    }
  }, [getFlowTab])

  /** Generate video for a single scene */
  const generateVideo = useCallback(async (sceneIndex: number): Promise<VideoResult> => {
    const sceneItem = scenesRef.current.find(s => s.sceneIndex === sceneIndex)
    if (!sceneItem) return { success: false, error: 'Scene not found', completedCount: 0, totalCount: 0 }

    if (!sceneItem.startFrameImageUuid && !sceneItem.startFrameImage) {
      depsRef.current.onError('กรุณาสร้าง Start Frame ก่อนสร้างวิดีโอ')
      return { success: false, error: 'No start frame', completedCount: 0, totalCount: 0 }
    }

    setGeneratingVideo(`video-${sceneIndex}`)
    try {
      const worker = new SceneWorker(0, makeWorkerConfig()) // tabId unused for generateVideo
      const videoResult = await worker.generateVideo(sceneItem, depsRef.current.startVideo)

      if (videoResult.success) {
        setScenes(prev => prev.map(s =>
          s.sceneIndex === sceneIndex ? { ...s, videoCreated: true } : s
        ))
      } else {
        depsRef.current.onError(`Video generation failed: ${videoResult.error || 'Unknown error'}`)
      }

      return videoResult
    } catch (err) {
      const errMsg = (err as Error).message
      depsRef.current.onError(errMsg)
      return { success: false, error: errMsg, completedCount: 0, totalCount: 0 }
    } finally {
      setGeneratingVideo(null)
    }
  }, [])

  /** Generate storyboard preview grid */
  const generatePreview = useCallback(async (storyboardPrompt: string): Promise<SceneResult> => {
    if (!storyboardPrompt.trim()) {
      depsRef.current.onError('กรุณาสร้าง Storyboard ด้วย AI ก่อน (ต้องมี storyboardPrompt)')
      return { success: false, error: 'Empty prompt' }
    }

    setGeneratingPreview(true)
    try {
      const tab = await getFlowTab()
      const worker = new SceneWorker(tab.id!, makeWorkerConfig())

      const initResp = await worker.init(1)
      if (!initResp?.success) {
        const err = `Init failed: ${initResp?.error || 'Unknown error'}`
        depsRef.current.onError(err)
        return { success: false, error: err }
      }

      const resp = await worker.createImage({ finalPrompt: storyboardPrompt })

      if (resp?.success) {
        setStoryboardPreviewImage(resp.imageBase64 || null)
        setStoryboardPreviewUuid(resp.imageUUIDs?.[0] || null)
      } else {
        depsRef.current.onError('Storyboard preview generation failed')
      }

      return resp
    } catch (err) {
      const errMsg = (err as Error).message
      depsRef.current.onError(errMsg)
      return { success: false, error: errMsg }
    } finally {
      setGeneratingPreview(false)
    }
  }, [getFlowTab])

  /** Run all scenes in bulk (start frames → end frames → videos) */
  const runAll = useCallback(async (): Promise<RunAllResult> => {
    const cfg = configRef.current
    const validScenes = scenesRef.current.filter(s => s.startFramePrompt.trim())
    const total = validScenes.length

    if (total === 0) {
      depsRef.current.onError('กรุณาใส่ Prompt อย่างน้อย 1 รายการ')
      return { success: false, completedScenes: 0, totalScenes: 0, completedVideos: 0, totalVideos: 0 }
    }

    const tab = await getFlowTab()
    const worker = new SceneWorker(tab.id!, makeWorkerConfig())
    setStoryTotalScenes(total)

    // 💾 SAVE #0: Initial checkpoint (marks workflow started)
    console.log('[runAll] 💾 Checkpoint #0: workflow started')
    await depsRef.current.onCheckpoint()

    // Init story mode
    const initResp = await worker.init(total)
    if (!initResp?.success) {
      throw new Error(`Init failed: ${initResp?.error || 'Unknown error'}`)
    }

    let completedScenes = 0
    let autoCharRefUuid: string | null = null
    let autoCharRef: string | null = null

    // Restore charRef from scene 0 if resuming (scene 0 already completed)
    const scene0 = validScenes[0]
    if (scene0?.imageCreated) {
      if (scene0.startFrameImageUuid) autoCharRefUuid = scene0.startFrameImageUuid
      if (scene0.startFrameImage) autoCharRef = scene0.startFrameImage
    }

    // ── PHASE 1: Start Frame Loop ──
    for (let i = 0; i < total; i++) {
      setStoryCurrentScene(i + 1)
      const currentScene = validScenes[i]

      // Skip if already completed (resume logic)
      if (currentScene.imageCreated) {
        completedScenes++
        console.log(`[runAll] Scene ${i + 1}/${total}: start frame already done, skipping`)
        continue
      }

      const shouldCapture = i === 0 || cfg.autoGenerateVideo
      const refContext = makeRefContext()

      const ref = buildRefPayload(
        currentScene.sceneIndex,
        currentScene.startFramePrompt,
        refContext,
        refContext.bulkUsePreviewGrid ? undefined : { autoCharRefUuid, autoCharRef },
      )

      const sceneResp = await worker.createImage(ref, {
        sceneIndex: i,
        totalScenes: total,
        isLast: !cfg.autoGenerateVideo && i === total - 1,
        captureImage: shouldCapture,
      })

      console.log(`[runAll] Scene ${i + 1}/${total} result:`, sceneResp)

      if (sceneResp?.success) {
        completedScenes++
        if (i === 0 && sceneResp.imageUUIDs?.[0]) autoCharRefUuid = sceneResp.imageUUIDs[0]
        if (i === 0 && sceneResp.imageBase64) autoCharRef = sceneResp.imageBase64

        const imageData = resolveImageData(sceneResp.imageBase64, sceneResp.imageUUIDs?.[0])
        const updatedScenes = scenesRef.current.map(s =>
          s.sceneIndex === currentScene.sceneIndex
            ? { ...s, startFrameImage: imageData, startFrameImageUuid: sceneResp.imageUUIDs?.[0], imageCreated: true }
            : s
        )
        scenesRef.current = updatedScenes
        setScenes(updatedScenes)

        // 💾 SAVE only on successful image creation
        console.log(`[runAll] 💾 Checkpoint: start frame scene ${i + 1}/${total} saved`)
        await depsRef.current.onCheckpoint(scenesRef.current)
      }
    }

    setStoryCurrentScene(null)

    // ── PHASE 2: End Frame Loop ──
    const scenesWithEndFrame = validScenes.filter(s => s.endFramePrompt.trim())
    if (scenesWithEndFrame.length > 0) {
      const endInitResp = await worker.init(scenesWithEndFrame.length)

      if (endInitResp?.success) {
        for (let i = 0; i < scenesWithEndFrame.length; i++) {
          setStoryCurrentScene(i + 1)
          const currentScene = scenesWithEndFrame[i]

          // Skip if already completed (resume logic)
          if (currentScene.endFrameCreated) {
            console.log(`[runAll] Scene ${currentScene.sceneIndex + 1}: end frame already done, skipping`)
            continue
          }

          const refContext = makeRefContext()

          const refPayload = buildRefPayload(
            currentScene.sceneIndex,
            currentScene.endFramePrompt,
            refContext,
            refContext.bulkUsePreviewGrid ? undefined : { autoCharRefUuid, autoCharRef },
          )

          const endResp = await worker.createImage(refPayload, {
            sceneIndex: i,
            totalScenes: scenesWithEndFrame.length,
            isLast: i === scenesWithEndFrame.length - 1,
            captureImage: false,
          })

          if (endResp?.success) {
            const endImageData = resolveImageData(endResp.imageBase64, endResp.imageUUIDs?.[0])
            const updatedScenes = scenesRef.current.map(s =>
              s.sceneIndex === currentScene.sceneIndex
                ? { ...s, endFrameImage: endImageData, endFrameImageUuid: endResp.imageUUIDs?.[0], endFrameCreated: true }
                : s
            )
            scenesRef.current = updatedScenes
            setScenes(updatedScenes)

            // 💾 SAVE only on successful end frame creation
            console.log(`[runAll] 💾 Checkpoint: end frame scene ${currentScene.sceneIndex + 1} saved`)
            await depsRef.current.onCheckpoint(scenesRef.current)
          }
        }
        setStoryCurrentScene(null)
      }
    }

    // ── PHASE 3: Auto-generate videos if enabled ──
    let completedVideos = 0
    let videoTotal = 0

    if (cfg.autoGenerateVideo) {
      // Read latest scenes to check videoCreated status
      const latestScenes = scenesRef.current
      const scenesForVideo = validScenes.filter(s => {
        const latest = latestScenes.find(ls => ls.sceneIndex === s.sceneIndex)
        return latest?.imageCreated && !latest?.videoCreated
      })

      if (scenesForVideo.length > 0) {
        const hasUuids = !!autoCharRefUuid

        const videoJobs: VideoJob[] = cfg.videoExtensionMode
          ? [{
              image: hasUuids ? null : autoCharRef,
              imageUuid: autoCharRefUuid || undefined,
              prompts: scenesForVideo.map(s => {
                const vp = s.videoPrompt.trim() || s.startFramePrompt
                return s.script ? `${vp}\n\nScript: "${s.script}"` : vp
              }),
            }]
          : scenesForVideo.map((s, idx) => {
              const vp = s.videoPrompt.trim() || s.startFramePrompt
              const fullPrompt = s.script ? `${vp}\n\nScript: "${s.script}"` : vp
              return {
                image: hasUuids ? null : (idx === 0 ? autoCharRef : null),
                imageUuid: idx === 0 ? autoCharRefUuid || undefined : undefined,
                prompts: [fullPrompt],
              }
            })

        console.log(`[runAll] Video generation: ${cfg.videoExtensionMode ? 'extension' : 'separate'} mode, ${videoJobs.length} job(s)`)

        const videoResult = await depsRef.current.startVideo(videoJobs, {
          aspectRatio: cfg.aspectRatio,
          videoCount: 1,
          autoDownload: cfg.autoSaveImage,
          downloadToFolder: cfg.downloadToFolder,
          continueFromCurrent: hasUuids,
          scenePromptsInOrder: !cfg.videoExtensionMode ? videoJobs.map(j => j.prompts[0]) : undefined,
          // 💾 Checkpoint callback: mark scene videoCreated + save after each video job
          onJobComplete: async (jobIndex: number, success: boolean) => {
            if (success && !cfg.videoExtensionMode) {
              const targetScene = scenesForVideo[jobIndex]
              if (targetScene) {
                setScenes(prev => prev.map(s =>
                  s.sceneIndex === targetScene.sceneIndex
                    ? { ...s, videoCreated: true }
                    : s
                ))
              }
            }
            console.log(`[runAll] 💾 Checkpoint: video job ${jobIndex + 1} completed (success=${success})`)
            await depsRef.current.onCheckpoint(scenesRef.current)
          },
        })

        completedVideos = videoResult.completedCount
        videoTotal = videoResult.totalCount

        // In extension mode, mark all scenes as videoCreated on full success
        if (cfg.videoExtensionMode && videoResult.success) {
          setScenes(prev => prev.map(s => {
            const isTarget = scenesForVideo.some(sv => sv.sceneIndex === s.sceneIndex)
            return isTarget ? { ...s, videoCreated: true } : s
          }))
        }
      }

      // 💾 SAVE after video phase
      console.log('[runAll] 💾 Checkpoint: video phase complete')
      await depsRef.current.onCheckpoint(scenesRef.current)
    }

    const allDone = completedScenes === total && (!cfg.autoGenerateVideo || completedVideos === videoTotal)

    return {
      success: allDone,
      completedScenes,
      totalScenes: total,
      completedVideos,
      totalVideos: videoTotal,
      error: completedScenes < total
        ? `สร้างได้ ${completedScenes}/${total} ภาพ`
        : cfg.autoGenerateVideo && completedVideos < videoTotal
          ? `ภาพครบ ${total}/${total} | วิดีโอ ${completedVideos}/${videoTotal}`
          : undefined,
    }
  }, [getFlowTab])

  /** Add scene to video editor (future — no-op for now) */
  const addToScene = useCallback(async (_sceneIndex: number): Promise<void> => {
    // TODO: Wire up onAddToScene
  }, [])

  return {
    // Data
    scenes, setScenes,
    storyboardPreviewImage, setStoryboardPreviewImage,
    storyboardPreviewUuid, setStoryboardPreviewUuid,

    // Operations
    createImage,
    generateVideo,
    generatePreview,
    runAll,
    addToScene,

    // Status
    generatingImage,
    generatingVideo,
    generatingPreview,
    storyCurrentScene,
    storyTotalScenes,
  }
}
