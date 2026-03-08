import { useState, useEffect, useRef, useCallback } from 'react'

// ─── Types ─────────────────────────────────────────────

export interface VideoProgressEvent {
  step: string
  attempt: number
  maxAttempts: number
  status: 'running' | 'success' | 'retrying' | 'failed'
  promptIndex?: number
  totalPrompts?: number
  imageIndex?: number
  totalImages?: number
  error?: string
}

export interface VideoJob {
  image: string | null
  imageUuid?: string       // UUID of gallery image for "Add To Prompt" flow
  prompts: string[]
}

/**
 * Unified scene tracker — carries all data for a single scene through the pipeline.
 * Populated incrementally: AI fills prompts, image gen fills image fields, video gen fills video fields.
 */
export interface SceneData {
  sceneIndex: number
  sceneType: 'hook' | 'story' | 'cta'
  description: string

  // ── Prompts (editable by user) ──
  startFramePrompt: string       // prompt for start frame image generation
  endFramePrompt: string         // prompt for end frame image generation
  videoPrompt: string            // action prompt sent to "Frames to Video"
  script: string                 // Thai narration/dialogue (for TTS / video overlay)

  // ── Original AI-generated prompts (immutable, for reset-to-original) ──
  originalStartFramePrompt?: string
  originalEndFramePrompt?: string
  originalVideoPrompt?: string
  originalScript?: string

  // ── Start frame image ──
  startFrameImage?: string       // base64 or blob URL (thumbnail + character reference)
  startFrameImageUuid?: string   // gallery image UUID (for "Add To Prompt" in video flow)

  // ── End frame image ──
  endFrameImage?: string         // base64 or blob URL
  endFrameImageUuid?: string     // gallery image UUID

  // ── Video ──
  videoUrl?: string              // blob URL for preview

  // ── Status per scene ──
  imageCreated: boolean
  endFrameCreated: boolean
  videoCreated: boolean
  addedToScene: boolean
}

export interface VideoOptions {
  style?: string
  aspectRatio?: '9:16' | '16:9'
  videoCount?: number
  noTextOnVideo?: boolean
  autoDownload?: boolean
  downloadToFolder?: boolean     // If true, save video to ShopEnginX/ subfolder instead of browser default
  continueFromCurrent?: boolean  // If true, skip navigation + new project, use "Add To Prompt" flow
  scenePromptsInOrder?: string[] // (deprecated, UUIDs used instead) Ordered video prompts for legacy matching
}

export interface VideoResult {
  success: boolean
  error?: string
  completedCount: number
  totalCount: number
}

export interface ImageStatus {
  failed: boolean
  url?: string
  completedPrompts?: number
}

// ─── Step display names ────────────────────────────────

const VIDEO_STEP_NAMES: Record<string, string> = {
  createNewProject: 'Creating new project',
  startingImage: 'Starting image',
  ensureVideoMode: 'Setting video mode',
  configureSettings: 'Configuring settings',
  uploadImage: 'Uploading start frame',
  switchToImagesTab: 'Switching to images gallery',
  clickAddToPromptByUuid: 'Adding image to prompt',
  clickRemoveFromPrompt: 'Removing previous image',
  switchToFramesToVideo: 'Switching to Frames to Video',
  fillPrompt: 'Filling prompt',
  clickCreate: 'Starting generation',
  waitForInitialComplete: 'Generating video',
  clickAddToScene: 'Adding to scene',
  enterExtendMode: 'Entering extend mode',
  fillExtensionPrompt: 'Filling extension prompt',
  waitForExtensionComplete: 'Generating extension',
  downloadVideo: 'Downloading video',
  downloadSceneVideo: 'Downloading scene video',
  switchToVideosTab: 'Switching to videos gallery',
  addVideoToSceneByPrompt: 'Adding video to scene',
  addVideoToSceneByUuid: 'Adding video to scene',
  navigateBackToProject: 'Returning to project',
}

export function getVideoStepDisplayName(step: string): string {
  return VIDEO_STEP_NAMES[step] || step
}

// ─── Hook ──────────────────────────────────────────────

export function useVideoWorkflow() {
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<VideoProgressEvent | null>(null)
  const [result, setResult] = useState<VideoResult | null>(null)
  const [currentImageIndex, setCurrentImageIndex] = useState<number | null>(null)
  const [imageStatuses, setImageStatuses] = useState<ImageStatus[]>([])
  const stopRequestedRef = useRef(false)

  // Listen for progress updates from content script
  useEffect(() => {
    const handleMessage = (message: { type: string } & VideoProgressEvent) => {
      if (message.type === 'VIDEO_PROGRESS') {
        setProgress(message)
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)
    return () => chrome.runtime.onMessage.removeListener(handleMessage)
  }, [])

  /**
   * Run video workflow for one or more jobs.
   *
   * Each job = one image + its prompts → one video.
   * Jobs are processed sequentially, navigating to Flow homepage between each.
   */
  const startVideo = useCallback(async (jobs: VideoJob[], options: VideoOptions = {}): Promise<VideoResult> => {
    if (jobs.length === 0) {
      const r: VideoResult = { success: false, error: 'No video jobs provided', completedCount: 0, totalCount: 0 }
      setResult(r)
      return r
    }

    setIsRunning(true)
    setProgress(null)
    setResult(null)
    stopRequestedRef.current = false
    setImageStatuses(jobs.map(() => ({ failed: false })))
    setCurrentImageIndex(null)

    try {
      const results: { success: boolean; error?: string; completedPrompts?: number }[] = []

      for (let jobIndex = 0; jobIndex < jobs.length; jobIndex++) {
        if (stopRequestedRef.current) {
          console.log('[useVideoWorkflow] Stop requested, breaking loop')
          break
        }

        const job = jobs[jobIndex]
        setCurrentImageIndex(jobIndex)

        setProgress({
          step: 'startingImage',
          attempt: 1,
          maxAttempts: 1,
          status: 'running',
          imageIndex: jobIndex,
          totalImages: jobs.length,
        })

        // Get active tab (re-query each iteration — tab may have navigated)
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab?.id) {
          throw new Error('No active tab found')
        }

        // Ensure tab is on Google Flow
        if (!tab.url?.includes('labs.google/fx/tools/flow')) {
          throw new Error('Please navigate to Google Flow first (labs.google/fx/tools/flow)')
        }

        // Navigate to Flow homepage if NOT continuing from current project
        if (!options.continueFromCurrent && !tab.url.match(/\/fx\/tools\/flow\/?$/)) {
          await chrome.tabs.update(tab.id, { url: 'https://labs.google/fx/tools/flow' })
          await new Promise(resolve => setTimeout(resolve, 5000))
        }

        // Send video workflow to content script
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'START_VIDEO_WORKFLOW',
          image: job.image,
          imageUuid: job.imageUuid,
          prompts: job.prompts,
          style: options.style,
          aspectRatio: options.aspectRatio,
          videoCount: options.videoCount,
          noTextOnVideo: options.noTextOnVideo,
          autoDownload: options.autoDownload,
          continueFromCurrent: options.continueFromCurrent,
        })

        results.push(response)

        // Update image status if failed
        if (!response.success) {
          const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true })
          setImageStatuses(prev => {
            const updated = [...prev]
            if (updated[jobIndex]) {
              updated[jobIndex] = {
                failed: true,
                url: currentTab?.url,
                completedPrompts: response.completedPrompts || 0,
              }
            }
            return updated
          })
        }

        // Check if stop was requested or workflow was aborted
        if (stopRequestedRef.current || response.error?.includes('aborted')) {
          console.log('[useVideoWorkflow] Stop requested or workflow aborted, breaking loop')
          break
        }

        // Navigate back to Flow homepage for next job (not after last)
        // Skip navigation when continuing from current project (images are in gallery)
        if (jobIndex < jobs.length - 1 && !options.continueFromCurrent) {
          await chrome.tabs.update(tab.id, { url: 'https://labs.google/fx/tools/flow' })
          await new Promise(resolve => setTimeout(resolve, 5000))
        }
      }

      // Phase: Add all videos to scene in order (Extension OFF + continueFromCurrent only)
      // After all videos generated, we're still on the project page. Now add them to scenebuilder
      // by matching each video's UUID, in scene order.
      const allSucceeded = results.every(r => r.success)
      const isExtensionOff = options.continueFromCurrent && jobs.every(j => j.prompts.length === 1)

      // Collect video UUIDs from each job result (in scene order)
      const videoUuidsInOrder = results
        .filter(r => r.success && r.videoUuids && r.videoUuids.length > 0)
        .map(r => r.videoUuids![0]) // Each Extension OFF job produces 1 video

      if (allSucceeded && isExtensionOff && videoUuidsInOrder.length > 0) {
        console.log(`[useVideoWorkflow] Adding ${videoUuidsInOrder.length} videos to scene by UUID:`, videoUuidsInOrder)

        // Phase: Add videos one-at-a-time from sidebar.
        // Sidebar orchestrates each click because:
        // 1. "Add to scene" button requires hover to appear
        // 2. First click redirects to scenebuilder (/scenes/), destroying content script
        // 3. Subsequent clicks stay on project page
        // Sidebar detects redirect via tab URL and navigates back.

        let addedCount = 0
        const notFoundUuids: string[] = []
        const maxRetries = 3

        // Upfront: ensure viewport is wide enough for scene buttons (>768px innerWidth).
        // The Chrome side panel consumes ~400-500px of window width, so a 1200px window
        // can have only ~750px content viewport. Resize once before the loop.
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          if (tab?.id) {
            const viewportResult = await chrome.tabs.sendMessage(tab.id, { type: 'GET_VIEWPORT_WIDTH' })
            const innerWidth = viewportResult?.innerWidth ?? 0
            if (innerWidth > 0 && innerWidth < 768) {
              const deficit = 768 - innerWidth + 100 // 100px buffer
              const currentWindow = await chrome.windows.getCurrent()
              if (currentWindow?.id) {
                const newWidth = (currentWindow.width || 1200) + deficit
                console.log(`[useVideoWorkflow] Upfront resize: innerWidth=${innerWidth}, deficit=${deficit}, window ${currentWindow.width} → ${newWidth}`)
                await chrome.windows.update(currentWindow.id, { width: newWidth })
                await new Promise(resolve => setTimeout(resolve, 1000))
              }
            }
          }
        } catch (err) {
          console.warn('[useVideoWorkflow] Upfront viewport check failed:', err)
        }

        // Switch to Videos tab
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          if (tab?.id) {
            await chrome.tabs.sendMessage(tab.id, { type: 'SWITCH_TO_VIDEOS_TAB' })
            await new Promise(resolve => setTimeout(resolve, 500))
          }
        } catch (err) {
          console.warn('[useVideoWorkflow] Failed to switch to Videos tab:', err)
        }

        for (let i = 0; i < videoUuidsInOrder.length; i++) {
          const uuid = videoUuidsInOrder[i]
          const isLast = i === videoUuidsInOrder.length - 1

          setProgress({
            step: 'addVideoToSceneByUuid',
            attempt: 1,
            maxAttempts: 1,
            status: 'running',
            imageIndex: i,
            totalImages: videoUuidsInOrder.length,
          })

          let videoAdded = false
          let resizeAttempts = 0

          // Retry loop for this single video (in case of not_found after refresh)
          for (let retry = 0; retry <= maxRetries && !videoAdded; retry++) {
            try {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
              if (!tab?.id) break

              // If retrying, refresh the page and switch to Videos tab
              if (retry > 0) {
                console.log(`[useVideoWorkflow] Video ${i + 1}: retry ${retry}/${maxRetries}, refreshing page`)

                // If on scenebuilder, navigate back first
                if (tab.url?.includes('/scenes/')) {
                  try {
                    await chrome.tabs.sendMessage(tab.id, { type: 'NAVIGATE_BACK_TO_PROJECT' })
                    await new Promise(resolve => setTimeout(resolve, 3000))
                  } catch {
                    // Content script may not be ready, wait and retry
                    await new Promise(resolve => setTimeout(resolve, 3000))
                  }
                }

                await chrome.tabs.reload(tab.id)
                await new Promise(resolve => setTimeout(resolve, 5000))
              }

              // Always ensure Videos tab is active before each attempt
              const [freshTab] = await chrome.tabs.query({ active: true, currentWindow: true })
              if (freshTab?.id) {
                try {
                  await chrome.tabs.sendMessage(freshTab.id, { type: 'SWITCH_TO_VIDEOS_TAB' })
                  await new Promise(resolve => setTimeout(resolve, 500))
                } catch {
                  await new Promise(resolve => setTimeout(resolve, 2000))
                }
              }

              // Send lightweight click message — returns FAST before any redirect
              const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true })
              if (!currentTab?.id) break

              const clickResult = await chrome.tabs.sendMessage(currentTab.id, {
                type: 'CLICK_ADD_VIDEO_TO_SCENE_BY_UUID',
                videoUuid: uuid,
              })

              if (clickResult?.status === 'needs_resize') {
                resizeAttempts++
                if (resizeAttempts > 2) {
                  console.error(`[useVideoWorkflow] Resize failed after ${resizeAttempts} attempts, viewport still too narrow`)
                  break
                }
                // Smart resize: ask content script for actual innerWidth, calculate deficit
                console.log(`[useVideoWorkflow] Viewport too narrow (resize attempt ${resizeAttempts}/2), resizing window`)
                try {
                  const viewportResult = await chrome.tabs.sendMessage(currentTab.id, { type: 'GET_VIEWPORT_WIDTH' })
                  const innerWidth = viewportResult?.innerWidth ?? 0
                  const currentWindow = await chrome.windows.getCurrent()
                  if (currentWindow?.id && innerWidth > 0) {
                    const deficit = 768 - innerWidth + 100
                    const newWidth = (currentWindow.width || 1200) + deficit
                    console.log(`[useVideoWorkflow] innerWidth=${innerWidth}, deficit=${deficit}, window ${currentWindow.width} → ${newWidth}`)
                    await chrome.windows.update(currentWindow.id, { width: newWidth })
                  } else if (currentWindow?.id) {
                    // Fallback: force a large width
                    await chrome.windows.update(currentWindow.id, { width: 1500 })
                  }
                } catch {
                  // Fallback resize
                  const currentWindow = await chrome.windows.getCurrent()
                  if (currentWindow?.id) {
                    await chrome.windows.update(currentWindow.id, { width: 1500 })
                  }
                }
                await new Promise(resolve => setTimeout(resolve, 1000))
                retry-- // Don't count resize as a real retry
                continue
              }

              if (clickResult?.status === 'not_found') {
                console.warn(`[useVideoWorkflow] Video ${i + 1} not found (UUID: ${uuid.substring(0, 8)}...), will retry`)
                continue // retry
              }

              if (clickResult?.status === 'already') {
                console.log(`[useVideoWorkflow] Video ${i + 1} already in scene`)
                addedCount++
                videoAdded = true
                break
              }

              if (clickResult?.status === 'clicked') {
                console.log(`[useVideoWorkflow] Video ${i + 1} "Add to scene" clicked`)
                addedCount++
                videoAdded = true

                // Wait for potential redirect
                await new Promise(resolve => setTimeout(resolve, 3000))

                // Check if page redirected to scenebuilder
                const [afterClickTab] = await chrome.tabs.query({ active: true, currentWindow: true })
                if (afterClickTab?.url?.includes('/scenes/') && !isLast) {
                  // Redirected to scenebuilder — navigate back for remaining videos
                  console.log('[useVideoWorkflow] Redirected to scenebuilder, navigating back for remaining videos')
                  try {
                    await chrome.tabs.sendMessage(afterClickTab.id!, { type: 'NAVIGATE_BACK_TO_PROJECT' })
                    await new Promise(resolve => setTimeout(resolve, 3000))
                    // Switch to Videos tab on project page
                    const [projectTab] = await chrome.tabs.query({ active: true, currentWindow: true })
                    if (projectTab?.id) {
                      await chrome.tabs.sendMessage(projectTab.id, { type: 'SWITCH_TO_VIDEOS_TAB' })
                      await new Promise(resolve => setTimeout(resolve, 500))
                    }
                  } catch (navErr) {
                    console.warn('[useVideoWorkflow] Navigation back failed, will retry:', navErr)
                  }
                }
                break
              }
            } catch (err) {
              // Message channel closed — likely page navigated (redirect to scenebuilder)
              console.warn(`[useVideoWorkflow] Video ${i + 1} message error (likely redirect):`, err)
              addedCount++ // Click happened, redirect killed the response
              videoAdded = true

              // Wait for redirect to settle
              await new Promise(resolve => setTimeout(resolve, 3000))

              // Navigate back if not last video
              if (!isLast) {
                try {
                  const [redirectedTab] = await chrome.tabs.query({ active: true, currentWindow: true })
                  if (redirectedTab?.id && redirectedTab.url?.includes('/scenes/')) {
                    await chrome.tabs.sendMessage(redirectedTab.id, { type: 'NAVIGATE_BACK_TO_PROJECT' })
                    await new Promise(resolve => setTimeout(resolve, 3000))
                    const [projectTab] = await chrome.tabs.query({ active: true, currentWindow: true })
                    if (projectTab?.id) {
                      await chrome.tabs.sendMessage(projectTab.id, { type: 'SWITCH_TO_VIDEOS_TAB' })
                      await new Promise(resolve => setTimeout(resolve, 500))
                    }
                  }
                } catch (navErr) {
                  console.warn('[useVideoWorkflow] Post-redirect navigation failed:', navErr)
                }
              }
              break
            }
          }

          if (!videoAdded) {
            console.warn(`[useVideoWorkflow] Video ${i + 1} not found after ${maxRetries} retries (UUID: ${uuid.substring(0, 8)}...)`)
            notFoundUuids.push(uuid)
          }
        }

        console.log(`[useVideoWorkflow] Add to scene complete: ${addedCount} added, ${notFoundUuids.length} not found`)

        if (notFoundUuids.length > 0) {
          console.warn(`[useVideoWorkflow] Could not find ${notFoundUuids.length} video(s):`, notFoundUuids)
        }

        // After all videos added, navigate to scenebuilder and download
        if (addedCount > 0 && options.autoDownload) {
          console.log('[useVideoWorkflow] All videos added, navigating to scenebuilder to download')
          setProgress({
            step: 'downloadSceneVideo',
            attempt: 1,
            maxAttempts: 1,
            status: 'running',
            imageIndex: 0,
            totalImages: 1,
          })

          try {
            const [downloadTab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (downloadTab?.id) {
              let downloadResult = await chrome.tabs.sendMessage(downloadTab.id, {
                type: 'DOWNLOAD_SCENE_VIDEO',
                downloadToFolder: options.downloadToFolder ?? false,
              })

              // If viewport too narrow for breadcrumb, resize and retry
              if (downloadResult?.needsResize) {
                console.log('[useVideoWorkflow] Viewport too narrow for scenebuilder, resizing')
                const currentWindow = await chrome.windows.getCurrent()
                if (currentWindow?.id) {
                  const newWidth = Math.max(currentWindow.width || 1200, 1200)
                  await chrome.windows.update(currentWindow.id, { width: newWidth })
                  await new Promise(resolve => setTimeout(resolve, 2000))
                }
                // Retry after resize
                const [retryTab] = await chrome.tabs.query({ active: true, currentWindow: true })
                if (retryTab?.id) {
                  downloadResult = await chrome.tabs.sendMessage(retryTab.id, {
                    type: 'DOWNLOAD_SCENE_VIDEO',
                    downloadToFolder: options.downloadToFolder ?? false,
                  })
                }
              }

              if (downloadResult?.success) {
                console.log('[useVideoWorkflow] Scene video downloaded successfully')
              } else {
                console.warn('[useVideoWorkflow] Scene video download failed:', downloadResult?.error)
              }
            }
          } catch (err) {
            console.error('[useVideoWorkflow] Scene video download error:', err)
          }
        }
      }

      // Aggregate results
      const successCount = results.filter(r => r.success).length
      const aggregated: VideoResult = {
        success: results.every(r => r.success),
        completedCount: successCount,
        totalCount: jobs.length,
        error: successCount < results.length
          ? `${successCount}/${results.length} videos completed`
          : undefined,
      }
      setResult(aggregated)
      return aggregated
    } catch (error) {
      const errorResult: VideoResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        completedCount: 0,
        totalCount: jobs.length,
      }
      setResult(errorResult)
      return errorResult
    } finally {
      setIsRunning(false)
      setProgress(null)
      setCurrentImageIndex(null)
    }
  }, [])

  const stopVideo = useCallback(async () => {
    stopRequestedRef.current = true
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: 'STOP_VIDEO_WORKFLOW' })
      }
    } catch (error) {
      console.error('[useVideoWorkflow] Failed to stop workflow:', error)
    }
    setIsRunning(false)
    setProgress(null)
  }, [])

  return {
    startVideo,
    stopVideo,
    isRunning,
    progress,
    result,
    currentImageIndex,
    imageStatuses,
  }
}
