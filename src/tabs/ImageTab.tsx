import { useState, useEffect, useCallback, useRef } from 'react'
import { queryTargetTab } from '../targetTab'
import { generateAllScenePrompts, generateSinglePrompt, type StoryCharacter, VIDEO_TYPE_GROUPS, IMAGE_STYLES } from '../storyPrompts'
import { useVideoWorkflow, type SceneData } from '../hooks/useVideoWorkflow'
import { useStoryWorkflow } from '../hooks/useStoryWorkflow'
import StoryboardPanel from '../components/StoryboardPanel'
import {
  type WorkflowCheckpoint,
  type WorkflowConfig,
  type WorkflowStory,
  saveToStorage,
  loadFromStorage,
  clearFromStorage,
  hasIncompleteWork,
  getProgressSummary,
  downloadCheckpointFile,
  importCheckpoint,
} from '../checkpoint'

// Progress event type from content script
interface ImageProgressEvent {
  step: string
  attempt: number
  maxAttempts: number
  status: 'running' | 'success' | 'retrying' | 'failed'
  setIndex?: number
  totalSets?: number
  error?: string
}

interface ImageSet {
  id: string
  product: string | null
  model: string | null
  name: string
}

function ImageTab() {
  const [images, setImages] = useState<string[]>([])
  const [style, setStyle] = useState('object_talk')
  const [productName, setProductName] = useState('')
  const [modelType, setModelType] = useState('from_image')
  const [multiSetMode, setMultiSetMode] = useState<'none' | 'story' | 'multi' | 'sameModel'>('story')
  const [setCount, setSetCount] = useState(2)
  const [imageSets, setImageSets] = useState<ImageSet[]>([])
  const [sharedModelImage, setSharedModelImage] = useState<string | null>(null)
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>('9:16')
  const [imageCount, setImageCount] = useState(1)
  const [noTextOnImage, setNoTextOnImage] = useState(false)
  const [autoSaveImage, setAutoSaveImage] = useState(true)
  const [downloadToFolder, setDownloadToFolder] = useState(true)
  const [downloadResolution, setDownloadResolution] = useState<'1K' | '2K' | '4K'>('1K')
  const [autoGenerateVideo, setAutoGenerateVideo] = useState(false)
  const [videoExtensionMode, setVideoExtensionMode] = useState(false)
  const [bulkUsePreviewGrid, setBulkUsePreviewGrid] = useState(true)
  const [imageText, setImageText] = useState('')
  const [scene, setScene] = useState('')
  const [referenceStyle, setReferenceStyle] = useState('pixar_3d')
  const [storyMood, setStoryMood] = useState('grumpy')
  const [videoType, setVideoType] = useState('')
  const [activeVideoTypeGroup, setActiveVideoTypeGroup] = useState('ขาย/โปรโมท')
  const [storySceneCount, setStorySceneCount] = useState(4)
  const [storyTopic, setStoryTopic] = useState('')
  const [storyAutoWording, setStoryAutoWording] = useState(false)
  const [storyTitle, setStoryTitle] = useState('')
  const [storyCharacters, setStoryCharacters] = useState<StoryCharacter[]>([])
  const [storyboardPrompt, setStoryboardPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiLoadingIndex, setAiLoadingIndex] = useState<number | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [configCollapsed, setConfigCollapsed] = useState(false)

  const [validationError, setValidationError] = useState<string | null>(null)
  
  // Progress state for event-driven workflow
  const [progress, setProgress] = useState<ImageProgressEvent | null>(null)
  const [result, setResult] = useState<{ success: boolean; error?: string; completedSets?: number; totalSets?: number } | null>(null)

  // Story mode progress (sidebar-controlled)
  const [showCharacterModal, setShowCharacterModal] = useState(false)

  // Shared video workflow hook (for auto-generate video)
  const {
    startVideo,
    isRunning: videoIsRunning,
    currentImageIndex: videoCurrentIndex,
    imageStatuses: videoImageStatuses,
  } = useVideoWorkflow()

  // ── Refs for cross-hook checkpoint communication ──
  const scenesRef = useRef<SceneData[]>([])
  const storyboardPreviewUuidRef = useRef<string | null>(null)

  // ── Checkpoint & Resume state ──
  const [pendingCheckpoint, setPendingCheckpoint] = useState<WorkflowCheckpoint | null>(null)
  const [showResumeBanner, setShowResumeBanner] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportIncludeImages, setExportIncludeImages] = useState(false)
  const [showJsonModal, setShowJsonModal] = useState(false)

  // ── Checkpoint: collect current state into serializable object ──
  const collectCheckpoint = useCallback((): WorkflowCheckpoint => {
    const config: WorkflowConfig = {
      style, aspectRatio, imageCount, noTextOnImage, autoSaveImage,
      downloadResolution, downloadToFolder, autoGenerateVideo, videoExtensionMode,
      referenceStyle, storyMood, videoType, storySceneCount, storyTopic, productName, scene, bulkUsePreviewGrid,
    }
    const story: WorkflowStory = {
      title: storyTitle,
      characters: storyCharacters,
      storyboardPrompt,
      storyboardPreviewUuid: storyboardPreviewUuidRef.current,
    }
    return {
      version: 1,
      createdAt: pendingCheckpoint?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      config,
      story,
      scenes: scenesRef.current,
    }
  }, [
    style, aspectRatio, imageCount, noTextOnImage, autoSaveImage,
    downloadResolution, downloadToFolder, autoGenerateVideo, videoExtensionMode,
    referenceStyle, storyMood, videoType, storySceneCount, storyTopic, productName, scene, bulkUsePreviewGrid,
    storyTitle, storyCharacters, storyboardPrompt, pendingCheckpoint,
  ])

  // ── Checkpoint: save current state to chrome.storage.local ──
  const saveCurrentCheckpoint = useCallback(async (freshScenes?: SceneData[]) => {
    try {
      const cp = collectCheckpoint()
      // Use fresh scenes from hook if provided (avoids stale React state)
      if (freshScenes) {
        cp.scenes = freshScenes
      }
      await saveToStorage(cp)
    } catch (err) {
      console.warn('[Checkpoint] Save failed:', err)
    }
  }, [collectCheckpoint])

  // ── Story workflow hook (scenes, image/video generation, preview) ──
  const {
    scenes, setScenes,
    storyboardPreviewImage, setStoryboardPreviewImage,
    storyboardPreviewUuid, setStoryboardPreviewUuid,
    generatingImage, generatingVideo, generatingPreview,
    storyCurrentScene, storyTotalScenes,
    createImage, generateVideo, generatePreview, runAll,
  } = useStoryWorkflow(
    {
      style, aspectRatio, imageCount, autoSaveImage,
      downloadResolution, downloadToFolder, autoGenerateVideo,
      videoExtensionMode, bulkUsePreviewGrid,
    },
    {
      storyCharacters,
      startVideo,
      onCheckpoint: saveCurrentCheckpoint,
      onError: (msg) => setValidationError(msg),
    }
  )

  // Update refs after hook call (for checkpoint reads)
  scenesRef.current = scenes
  storyboardPreviewUuidRef.current = storyboardPreviewUuid

  // ── Checkpoint: restore all state from a checkpoint ──
  const restoreCheckpoint = useCallback((cp: WorkflowCheckpoint) => {
    // Config
    setStyle(cp.config.style)
    setAspectRatio(cp.config.aspectRatio)
    setImageCount(cp.config.imageCount)
    setNoTextOnImage(cp.config.noTextOnImage)
    setAutoSaveImage(cp.config.autoSaveImage)
    setDownloadResolution(cp.config.downloadResolution)
    setDownloadToFolder(cp.config.downloadToFolder)
    setAutoGenerateVideo(cp.config.autoGenerateVideo)
    setVideoExtensionMode(cp.config.videoExtensionMode)
    setReferenceStyle(cp.config.referenceStyle)
    setStoryMood(cp.config.storyMood)
    setVideoType(cp.config.videoType)
    setStorySceneCount(cp.config.storySceneCount)
    setStoryTopic(cp.config.storyTopic)
    setProductName(cp.config.productName)
    setScene(cp.config.scene)
    setBulkUsePreviewGrid(cp.config.bulkUsePreviewGrid ?? true)
    // Story
    setStoryTitle(cp.story.title)
    setStoryCharacters(cp.story.characters)
    setStoryboardPrompt(cp.story.storyboardPrompt)
    setStoryboardPreviewUuid(cp.story.storyboardPreviewUuid ?? null)
    // Reconstruct image URLs from UUIDs since base64 is stripped on save
    const IMAGE_URL_PREFIX = 'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name='
    setStoryboardPreviewImage(cp.story.storyboardPreviewUuid ? `${IMAGE_URL_PREFIX}${cp.story.storyboardPreviewUuid}` : null)
    setScenes(cp.scenes.map(s => ({
      ...s,
      startFrameImage: s.startFrameImage ?? (s.startFrameImageUuid ? `${IMAGE_URL_PREFIX}${s.startFrameImageUuid}` : undefined),
      endFrameImage: s.endFrameImage ?? (s.endFrameImageUuid ? `${IMAGE_URL_PREFIX}${s.endFrameImageUuid}` : undefined),
    })))
    // Ensure story mode is selected
    setMultiSetMode('story')
    setPendingCheckpoint(cp)
  }, [setStoryboardPreviewUuid, setScenes])

  // ── Checkpoint: load on mount ──
  useEffect(() => {
    loadFromStorage().then(cp => {
      if (cp && hasIncompleteWork(cp)) {
        setPendingCheckpoint(cp)
        setShowResumeBanner(true)
      }
    }).catch(err => {
      console.warn('[Checkpoint] Load failed:', err)
    })
  }, [])

  // Listen for progress updates from content script
  useEffect(() => {
    const handleMessage = (message: { type: string } & ImageProgressEvent) => {
      if (message.type === 'IMAGE_PROGRESS') {
        setProgress(message)
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)
    return () => chrome.runtime.onMessage.removeListener(handleMessage)
  }, [])

  // Clear result when tab updates (page refresh/navigation)
  useEffect(() => {
    const handleTabUpdate = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      // When page starts loading, clear the result
      if (changeInfo.status === 'loading') {
        setResult(null)
        setProgress(null)
        setIsRunning(false)
      }
    }

    chrome.tabs.onUpdated.addListener(handleTabUpdate)
    return () => chrome.tabs.onUpdated.removeListener(handleTabUpdate)
  }, [])

  // Get display name for step
  const getStepDisplayName = (step: string): string => {
    const names: Record<string, string> = {
      ensureCreateImageMode: 'Setting image mode',
      configureSettings: 'Configuring settings',
      openImagePicker: 'Opening image picker',
      uploadImage: 'Uploading image',
      handleCrop: 'Cropping image',
      waitAllImagesUploaded: 'Waiting for uploads',
      fillPrompt: 'Filling prompt',
      clickCreate: 'Starting generation',
      waitForGeneration: 'Generating images',
      downloadImages: 'Downloading images',
      clearPromptBox: 'Clearing for next set',
    }
    return names[step] || step
  }

  const handleCreate = async () => {
    // Validation
    setValidationError(null)
    setProgress(null)
    setResult(null)

    if (multiSetMode === 'none') {
      // Single mode: require at least one image
      if (images.length === 0) {
        setValidationError('กรุณาเพิ่มรูปสินค้าอย่างน้อย 1 รูป')
        return
      }
    } else if (multiSetMode === 'story') {
      // Story mode: require at least one prompt
      const validScenes = scenes.filter(s => s.startFramePrompt.trim())
      if (validScenes.length === 0) {
        setValidationError('กรุณาใส่ Prompt อย่างน้อย 1 รายการ')
        return
      }
    } else if (multiSetMode === 'sameModel') {
      // sameModel mode: require model image and at least one product (not all slots need to be filled)
      if (!sharedModelImage) {
        setValidationError('กรุณาเพิ่มรูปนางแบบ')
        return
      }
      const filledSets = imageSets.filter(set => set.product !== null)
      if (filledSets.length === 0) {
        setValidationError('กรุณาเพิ่มรูปสินค้าอย่างน้อย 1 รูป')
        return
      }
    } else {
      // multi mode: require at least one product image in each set
      const emptySet = imageSets.find(set => !set.product)
      if (emptySet) {
        setValidationError('กรุณาเพิ่มรูปสินค้าในทุกชุด')
        return
      }
    }

    const [tab] = await queryTargetTab()

    // Check if on Google Flow
    if (!tab?.url?.includes('labs.google/fx/tools/flow')) {
      setValidationError('กรุณาเปิด Google Flow ก่อน (labs.google/fx/tools/flow)')
      return
    }

    setIsRunning(true)
    setConfigCollapsed(true)

    try {
      if (multiSetMode === 'story') {
        // ==================== Story Mode — delegate to workflow hook ====================
        const runResult = await runAll()

        // Clear checkpoint on full success
        if (runResult.success) {
          await clearFromStorage()
          setPendingCheckpoint(null)
          setShowResumeBanner(false)
        }

        setResult({
          success: runResult.success,
          completedSets: runResult.completedScenes,
          totalSets: runResult.totalScenes,
          error: runResult.error,
        })

      } else if (multiSetMode === 'sameModel' && sharedModelImage) {
        // ==================== Event-Driven Workflow (sameModel mode) ====================
        const productImagesArray = imageSets.map(set => set.product).filter((p): p is string => p !== null)

        console.log(`[handleCreate] sameModel mode: ${productImagesArray.length} products, using event-driven workflow`)

        // Send message to content script to start workflow
        const response = await chrome.tabs.sendMessage(tab.id!, {
          type: 'START_IMAGE_WORKFLOW',
          modelImage: sharedModelImage,
          productImages: productImagesArray,
          style,
          productName,
          aspectRatio,
          imageCount,
          noTextOnImage,
          imageText,
          scene,
          autoSaveImage,
          downloadResolution,
        })

        setResult(response)
        console.log('[handleCreate] Workflow result:', response)

      } else {
        // ==================== Legacy: Single mode or multi mode ====================
        // For now, show error - these modes need migration later
        setValidationError('โหมดนี้ยังไม่รองรับ กรุณาใช้โหมด "หลายชุดสินค้า นางแบบเดียว"')
      }

    } catch (error) {
      console.error('Workflow error:', error)
      setResult({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsRunning(false)
      setProgress(null)
    }
  }

  const handleStop = async () => {
    try {
      const [tab] = await queryTargetTab()
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: 'STOP_IMAGE_WORKFLOW' })
      }
    } catch (error) {
      console.error('Failed to stop workflow:', error)
    }
    setIsRunning(false)
    setProgress(null)
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files) {
      Array.from(files).forEach(file => {
        const reader = new FileReader()
        reader.onload = (event) => {
          setImages(prev => [...prev, event.target?.result as string].slice(0, 8))
        }
        reader.readAsDataURL(file)
      })
    }
  }

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index))
  }

  const generateSets = (count: number, sameModel: boolean) => {
    const sets: ImageSet[] = []
    for (let i = 0; i < count; i++) {
      sets.push({
        id: `${Date.now()}-${i}`,
        product: null,
        model: null,
        name: ''
      })
    }
    setImageSets(sets)
  }

  const handleMultiSetChange = (mode: 'none' | 'story' | 'multi' | 'sameModel') => {
    setMultiSetMode(mode)
    if (mode === 'story') {
      // Initialize scenes array to match scene count
      setScenes(prev => {
        const target = storySceneCount
        if (prev.length < target) {
          return [...prev, ...Array(target - prev.length).fill(null).map((_, i) => ({
            sceneIndex: prev.length + i,
            sceneType: (prev.length + i === 0 ? 'hook' : prev.length + i === target - 1 ? 'cta' : 'story') as SceneData['sceneType'],
            description: '',
            startFramePrompt: '',
            endFramePrompt: '',
            videoPrompt: '',
            script: '',
            imageCreated: false,
            endFrameCreated: false,
            videoCreated: false,
            addedToScene: false,
          }))]
        }
        return prev.slice(0, target)
      })
      setImageCount(1)
      setImageSets([])
    } else if (mode === 'multi') {
      generateSets(setCount, false)
    } else if (mode === 'sameModel') {
      // Create 2 empty product sets for sameModel mode
      generateSets(2, true)
      setSharedModelImage(null)
    } else {
      setImageSets([])
    }
  }

  // AI: Generate all scene prompts
  const handleGenerateAll = async () => {
    setAiLoading(true)
    setValidationError(null)
    try {
      const result = await generateAllScenePrompts({
        sceneCount: storySceneCount,
        style,
        mood: storyMood,
        referenceStyle: style === 'object_talk' ? referenceStyle : undefined,
        topic: storyTopic || undefined,
        productName: productName || undefined,
        scene: scene || undefined,
        videoType: videoType || undefined,
      })

      // Store title + characters
      setStoryTitle(result.title)
      setStoryCharacters(result.characters)
      setStoryboardPrompt(result.storyboardPrompt)
      // Clear previous preview since scenes changed
      setStoryboardPreviewImage(null)
      setStoryboardPreviewUuid(null)

      // Build SceneData[] from AI result
      const newScenes: SceneData[] = result.scenes.map((s, i) => ({
        sceneIndex: i,
        sceneType: s.sceneType,
        description: s.description,
        startFramePrompt: s.imagePrompt,
        endFramePrompt: '',
        videoPrompt: s.videoPrompt || '',
        script: s.script || '',
        originalStartFramePrompt: s.imagePrompt,
        originalEndFramePrompt: '',
        originalVideoPrompt: s.videoPrompt || '',
        originalScript: s.script || '',
        imageCreated: false,
        endFrameCreated: false,
        videoCreated: false,
        addedToScene: false,
      }))
      while (newScenes.length < storySceneCount) {
        newScenes.push({
          sceneIndex: newScenes.length,
          sceneType: 'story',
          description: '',
          startFramePrompt: '',
          endFramePrompt: '',
          videoPrompt: '',
          script: '',
          imageCreated: false,
          endFrameCreated: false,
          videoCreated: false,
          addedToScene: false,
        })
      }
      setScenes(newScenes.slice(0, storySceneCount))
    } catch (err) {
      setValidationError((err as Error).message)
    } finally {
      setAiLoading(false)
    }
  }


  // AI: Generate single prompt
  const handleGenerateSingle = async (index: number) => {
    setValidationError(null)
    const currentScene = scenes[index]
    const currentText = currentScene?.startFramePrompt?.trim()
    if (!currentText) {
      setValidationError('กรุณาพิมพ์คำอธิบายสั้นๆ ก่อนกด AI')
      return
    }
    setAiLoadingIndex(index)
    try {
      const isFirst = index === 0
      const isLast = index === scenes.length - 1 && scenes.length > 1
      const sceneType = isFirst ? 'hook' as const : isLast ? 'cta' as const : 'story' as const

      const result = await generateSinglePrompt({
        description: currentText,
        style,
        mood: storyMood,
        sceneType,
      })
      setScenes(prev => prev.map((s, i) => i === index ? { ...s, startFramePrompt: result.trim() } : s))
    } catch (err) {
      setValidationError((err as Error).message)
    } finally {
      setAiLoadingIndex(null)
    }
  }


  return (
    <div className="space-y-2">
      {/* Resume Banner — shown when checkpoint with incomplete work is found */}
      {showResumeBanner && pendingCheckpoint && (() => {
        const summary = getProgressSummary(pendingCheckpoint)
        return (
          <div className="alert alert-warning py-3 shadow-lg">
            <div className="flex-1">
              <div className="font-bold text-sm mb-1">⚠️ พบงานค้าง</div>
              <div className="text-xs space-y-0.5">
                <div>{summary.totalScenes} ฉาก: Start {summary.startFramesDone}/{summary.totalScenes}
                  {summary.scenesWithEndFrame > 0 && ` | End ${summary.endFramesDone}/${summary.scenesWithEndFrame}`}
                  {` | Video ${summary.videosDone}/${summary.totalScenes}`}
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  className="btn btn-sm btn-primary gap-1"
                  onClick={() => {
                    restoreCheckpoint(pendingCheckpoint)
                    setShowResumeBanner(false)
                  }}
                >
                  ▶️ ทำต่อ
                </button>
                <button
                  className="btn btn-sm btn-ghost gap-1"
                  onClick={async () => {
                    await clearFromStorage()
                    setPendingCheckpoint(null)
                    setShowResumeBanner(false)
                  }}
                >
                  🗑️ เริ่มใหม่
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setShowResumeBanner(false)}
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Mode selection (radio buttons) */}
      <div className="space-y-1">
        <label className={`flex items-center gap-2 cursor-pointer px-2 py-1 rounded-lg transition-colors text-sm ${multiSetMode === 'story' ? 'bg-primary/10 border border-primary/30' : 'bg-base-300 hover:bg-base-100'}`}>
          <input
            type="radio"
            name="imageMode"
            className="radio radio-primary radio-sm"
            checked={multiSetMode === 'story'}
            onChange={() => handleMultiSetChange('story')}
          />
          <span className="select-text">📖 Story Mode (ไม่ต้องใช้รูปอ้างอิง)</span>
        </label>

        <label className={`flex items-center gap-2 cursor-pointer px-2 py-1 rounded-lg transition-colors text-sm ${multiSetMode === 'none' ? 'bg-primary/10 border border-primary/30' : 'bg-base-300 hover:bg-base-100'}`}>
          <input
            type="radio"
            name="imageMode"
            className="radio radio-primary radio-sm"
            checked={multiSetMode === 'none'}
            onChange={() => handleMultiSetChange('none')}
          />
          <span className="select-text">🛍️ สินค้าเดียว</span>
        </label>

        {/* Single product image upload - shown under สินค้าเดียว */}
        {multiSetMode === 'none' && (
          <div className="form-control pl-6">
            <label className="label py-1">
              <span className="label-text select-text text-xs">📷 รูปสินค้า <span className="text-error">*</span> <span className="opacity-50">(สูงสุด 8 รูป)</span></span>
            </label>
            <div className="flex flex-wrap gap-2 p-3 border-2 border-dashed border-primary/30 rounded-xl min-h-20">
              {images.map((img, index) => (
                <div key={index} className="relative w-16 h-16">
                  <img src={img} alt="" className="w-full h-full object-cover rounded-lg" />
                  <button
                    className="btn btn-circle btn-xs btn-error absolute -top-1 -right-1"
                    onClick={() => removeImage(index)}
                  >
                    ✕
                  </button>
                  <div className="absolute bottom-0 left-0 bg-primary text-primary-content text-xs w-4 h-4 flex items-center justify-center rounded-full">
                    {index + 1}
                  </div>
                </div>
              ))}
              {images.length < 8 && (
                <div
                  className="w-16 h-16 border-2 border-dashed border-primary/40 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary transition-colors"
                  onClick={() => document.getElementById('imageInput')?.click()}
                >
                  <span className="text-xl">+</span>
                  <span className="text-xs">เพิ่มรูป</span>
                </div>
              )}
            </div>
            <input
              id="imageInput"
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              multiple
              className="hidden"
              onChange={handleImageUpload}
            />
          </div>
        )}

        <label className={`flex items-center gap-2 cursor-pointer px-2 py-1 rounded-lg transition-colors text-sm ${multiSetMode === 'multi' ? 'bg-primary/10 border border-primary/30' : 'bg-base-300 hover:bg-base-100'}`}>
          <input
            type="radio"
            name="imageMode"
            className="radio radio-primary radio-sm"
            checked={multiSetMode === 'multi'}
            onChange={() => handleMultiSetChange('multi')}
          />
          <span className="select-text">📦 หลายชุดสินค้า (วนสร้างทีละชุด)</span>
        </label>

        <label className={`flex items-center gap-2 cursor-pointer px-2 py-1 rounded-lg transition-colors text-sm ${multiSetMode === 'sameModel' ? 'bg-primary/10 border border-primary/30' : 'bg-base-300 hover:bg-base-100'}`}>
          <input
            type="radio"
            name="imageMode"
            className="radio radio-primary radio-sm"
            checked={multiSetMode === 'sameModel'}
            onChange={() => handleMultiSetChange('sameModel')}
          />
          <span className="select-text">👤 หลายชุดสินค้า นางแบบเดียว (วนสร้างทีละชุด)</span>
        </label>
      </div>

      {/* Multi-set area */}
      {(multiSetMode === 'multi' || multiSetMode === 'sameModel') && (
        <div className="bg-base-300 rounded-lg p-2 space-y-2">
          {/* Set count selector - Only for multi mode */}
          {multiSetMode === 'multi' && (
            <div className="flex items-center justify-between">
              <span className="text-sm">📦 จำนวนชุด:</span>
              <select
                className="select select-bordered select-xs"
                value={setCount}
                onChange={(e) => {
                  const count = parseInt(e.target.value)
                  setSetCount(count)
                  generateSets(count, false)
                }}
              >
                {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                  <option key={n} value={n}>{n} ชุด</option>
                ))}
              </select>
            </div>
          )}

          {/* Bulk Upload Input for sameModel mode */}
          {multiSetMode === 'sameModel' && (
            <input
              id="bulkUploadInput"
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files
                if (!files || files.length === 0) return

                const startIndex = parseInt(e.target.dataset.startIndex || '-1')
                const fileArray = Array.from(files)

                // Read all files
                const readPromises = fileArray.map(file => {
                  return new Promise<string>((resolve) => {
                    const reader = new FileReader()
                    reader.onload = (event) => resolve(event.target?.result as string)
                    reader.readAsDataURL(file)
                  })
                })

                Promise.all(readPromises).then((images) => {
                  if (startIndex === -1) {
                    // Clicked on model box: first image = model, rest = products
                    if (images.length > 0) {
                      setSharedModelImage(images[0])
                    }
                    if (images.length > 1) {
                      const productImages = images.slice(1)
                      const productCount = productImages.length
                      // Auto-create sets based on product count
                      const newSets: ImageSet[] = []
                      for (let i = 0; i < productCount; i++) {
                        newSets.push({
                          id: `${Date.now()}-${i}`,
                          product: productImages[i],
                          model: null,
                          name: ''
                        })
                      }
                      setSetCount(productCount)
                      setImageSets(newSets)
                    }
                  } else {
                    // Clicked on product box: all images = products starting from startIndex
                    // Also expand sets if needed
                    const totalNeeded = startIndex + images.length
                    setImageSets(prev => {
                      let newSets = [...prev]
                      // Expand if needed
                      while (newSets.length < totalNeeded) {
                        newSets.push({
                          id: `${Date.now()}-${newSets.length}`,
                          product: null,
                          model: null,
                          name: ''
                        })
                      }
                      // Assign images
                      return newSets.map((set, i) => {
                        const imageIndex = i - startIndex
                        if (imageIndex >= 0 && imageIndex < images.length) {
                          return { ...set, product: images[imageIndex] }
                        }
                        return set
                      })
                    })
                    setSetCount(Math.max(setCount, totalNeeded))
                  }
                })

                // Reset input
                e.target.value = ''
              }}
            />
          )}

          {/* Model Row - Only for sameModel mode */}
          {multiSetMode === 'sameModel' && (
            <div className="flex justify-center py-2">
              {sharedModelImage ? (
                <div className="relative">
                  <img src={sharedModelImage} alt="Model" className="w-20 h-20 object-cover rounded-lg" />
                  <button
                    className="btn btn-circle btn-xs btn-error absolute -top-1 -right-1"
                    onClick={() => setSharedModelImage(null)}
                  >
                    ✕
                  </button>
                  <div className="text-xs text-center mt-1 text-secondary font-medium">👤 นางแบบ</div>
                </div>
              ) : (
                <div
                  className="w-20 h-20 border-2 border-dashed border-secondary rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-secondary/80 hover:bg-secondary/10 transition-colors"
                  onClick={() => {
                    const input = document.getElementById('bulkUploadInput') as HTMLInputElement
                    if (input) {
                      input.dataset.startIndex = '-1'
                      input.click()
                    }
                  }}
                >
                  <span className="text-xl">👤</span>
                  <span className="text-xs">นางแบบ</span>
                </div>
              )}
            </div>
          )}

          {/* Product Grid */}
          {multiSetMode === 'sameModel' && imageSets.length === 0 && (
            <div className="text-center text-xs text-base-content/50 py-2">
              👆 คลิกที่นางแบบเพื่ออัปโหลดรูป (รูปแรก = นางแบบ, รูปถัดไป = สินค้า)
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
            {imageSets.map((set, index) => (
              <div key={set.id} className="bg-base-200 rounded-lg p-2">
                <div className="text-xs font-bold text-primary mb-2">📦 ชุดที่ {index + 1}</div>
                <div className="flex gap-1 mb-2">
                  {/* Product Image */}
                  {set.product ? (
                    <div className={`${multiSetMode === 'sameModel' ? 'w-full' : 'flex-1'} h-16 relative`}>
                      <img src={set.product} alt="" className="w-full h-full object-cover rounded" />
                      <button
                        className="btn btn-circle btn-xs btn-error absolute -top-1 -right-1"
                        onClick={() => {
                          setImageSets(prev => prev.map((s, i) => i === index ? { ...s, product: null } : s))
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div
                      className={`${multiSetMode === 'sameModel' ? 'w-full' : 'flex-1'} h-16 border-2 border-dashed border-primary/30 rounded flex flex-col items-center justify-center text-xs cursor-pointer hover:border-primary/60`}
                      onClick={() => {
                        if (multiSetMode === 'sameModel') {
                          const input = document.getElementById('bulkUploadInput') as HTMLInputElement
                          if (input) {
                            input.dataset.startIndex = index.toString()
                            input.click()
                          }
                        }
                      }}
                    >
                      <span>📷</span>
                      <span>รูปสินค้า</span>
                    </div>
                  )}
                  {multiSetMode === 'multi' && (
                    <div className="flex-1 h-16 border-2 border-dashed border-secondary/30 rounded flex flex-col items-center justify-center text-xs cursor-pointer hover:border-secondary/60">
                      <span>👤</span>
                      <span>นางแบบ</span>
                    </div>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="ชื่อสินค้า"
                  className="input input-bordered input-xs w-full"
                  value={set.name}
                  onChange={(e) => {
                    setImageSets(prev => prev.map((s, i) => i === index ? { ...s, name: e.target.value } : s))
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}



      {/* Collapsible config toggle */}
      <div
        className="flex items-center justify-between cursor-pointer px-2 py-1.5 bg-base-200 rounded-lg hover:bg-base-300 transition-colors select-none"
        onClick={() => setConfigCollapsed(!configCollapsed)}
      >
        <span className="text-xs font-medium text-base-content/60">⚙️ ตั้งค่า (สไตล์, สัดส่วน, Mood)</span>
        <span className="text-[10px] text-base-content/40">{configCollapsed ? '▶' : '▼'}</span>
      </div>

      {!configCollapsed && (<>
      {/* Video Type (story mode only) */}
      {multiSetMode === 'story' && (
        <div className="form-control">
          <label className="label py-1">
            <span className="label-text select-text text-xs">🎬 ประเภทคลิป</span>
          </label>
          <div className="space-y-1">
            {/* Group tabs */}
            <div className="flex bg-base-200 rounded-md p-0.5 gap-0.5">
              <button
                className={`flex-1 px-1 py-0.5 text-[9px] font-medium rounded transition-all ${!videoType ? 'bg-base-100 text-primary shadow-sm' : 'text-base-content/40 hover:text-base-content/60'}`}
                onClick={() => { setVideoType(''); setActiveVideoTypeGroup('ขาย/โปรโมท') }}
              >
                อัตโนมัติ
              </button>
              {Object.entries(VIDEO_TYPE_GROUPS).map(([groupName, group]) => (
                <button
                  key={groupName}
                  className={`flex-1 px-1 py-0.5 text-[9px] font-medium rounded transition-all ${activeVideoTypeGroup === groupName ? 'bg-base-100 text-primary shadow-sm' : 'text-base-content/40 hover:text-base-content/60'}`}
                  onClick={() => setActiveVideoTypeGroup(groupName)}
                >
                  {group.emoji} {groupName.split('/')[0]}
                </button>
              ))}
            </div>
            {/* Type chips within active group */}
            {videoType !== '' || activeVideoTypeGroup ? (
              <div className="flex flex-wrap gap-1">
                {VIDEO_TYPE_GROUPS[activeVideoTypeGroup]?.types.map(typeName => (
                  <button
                    key={typeName}
                    className={`badge badge-sm cursor-pointer select-none ${videoType === typeName ? 'badge-primary' : 'badge-ghost'}`}
                    onClick={() => setVideoType(typeName)}
                  >
                    {typeName}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Style + Product Name */}
      <div className="grid grid-cols-2 gap-2">
        <div className="form-control">
          <label className="label py-1">
            <span className="label-text select-text text-xs">🎨 สไตล์</span>
          </label>
          <select
            className="select select-bordered select-sm"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
          >
            <option value="tiktok_real">TikTok คนธรรมดา (UGC Real)</option>
            <option value="review">ถือสินค้ารีวิว</option>
            <option value="hands_only">เห็นมืออย่างเดียว</option>
            <option value="professional">มืออาชีพ</option>
            <option value="dramatic">อลังการ ดุดัน</option>
            <option value="minimalist">มินิมอล</option>
            <option value="luxury">หรูหรา</option>
            <option value="dance">💃 เต้น K-pop</option>
            <option value="object_talk">🗣️ Object Talk</option>
            <option disabled>──── Story Styles ────</option>
            <option value="pixar_3d">🎬 Pixar 3D</option>
            <option value="anime">🌸 Anime</option>
            <option value="cartoon_2d">✏️ Cartoon 2D</option>
            <option value="watercolor">🎨 Watercolor</option>
            <option value="realistic">📷 Realistic / Cinematic</option>
          </select>
        </div>
        {style === 'object_talk' && (
          <div className="form-control">
            <label className="label py-1">
              <span className="label-text select-text text-xs">🎬 Rendering Style</span>
            </label>
            <select
              className="select select-bordered select-sm"
              value={referenceStyle}
              onChange={(e) => setReferenceStyle(e.target.value)}
            >
              <option value="pixar_3d">🎬 Pixar 3D</option>
              <option value="anime">🌸 Anime</option>
              <option value="cartoon_2d">✏️ Cartoon 2D</option>
              <option value="watercolor">🎨 Watercolor</option>
              <option value="realistic">📷 Realistic / Cinematic</option>
            </select>
          </div>
        )}
        <div className="form-control">
          <label className="label py-1">
            <span className="label-text select-text text-xs">🏷️ ชื่อสินค้า</span>
          </label>
          <input
            type="text"
            placeholder="ไม่บังคับ"
            className="input input-bordered input-sm"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
          />
        </div>
      </div>

      {/* Model */}
      <div className="form-control">
        <label className="label py-1">
          <span className="label-text select-text text-xs">👤 นายแบบ/นางแบบ</span>
        </label>
        <select
          className="select select-bordered select-sm"
          value={modelType}
          onChange={(e) => setModelType(e.target.value)}
        >
          <option value="from_image">ใช้จากรูป</option>
          <option value="female">นางแบบ</option>
          <option value="male">นายแบบ</option>
          <option value="cartoon3d">การ์ตูน 3D</option>
          <option value="3d_pixar">3D Pixar</option>
          <option value="none">ไม่มี</option>
        </select>
      </div>

      {/* Aspect Ratio + Image Count */}
      <div className="grid grid-cols-2 gap-2">
        <div className="form-control">
          <label className="label py-1">
            <span className="label-text select-text text-xs">📐 สัดส่วน</span>
          </label>
          <select
            className="select select-bordered select-sm"
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as '9:16' | '16:9')}
          >
            <option value="9:16">แนวตั้ง 9:16</option>
            <option value="16:9">แนวนอน 16:9</option>
          </select>
        </div>
        <div className="form-control">
          <label className="label py-1">
            <span className="label-text select-text text-xs">🔢 จำนวนภาพ</span>
          </label>
          <select
            className="select select-bordered select-sm"
            value={imageCount}
            onChange={(e) => setImageCount(parseInt(e.target.value))}
          >
            <option value={1}>1 ภาพ</option>
            <option value={2}>2 ภาพ</option>
            <option value={3}>3 ภาพ</option>
            <option value={4}>4 ภาพ</option>
          </select>
        </div>
      </div>
      </>)}
      {/* Story mode settings + prompts */}
      {multiSetMode === 'story' && (
        <div className="space-y-2">
          {!configCollapsed && (<>
          {/* Mood + Scene count row */}
          <div className="grid grid-cols-2 gap-2">
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text select-text text-xs">🎭 โทนเสียง/Mood</span>
              </label>
              <select
                className="select select-bordered select-sm"
                value={storyMood}
                onChange={(e) => setStoryMood(e.target.value)}
              >
                <option disabled>──── ทั่วไป ────</option>
                <option value="tough_love">💪 Tough Love</option>
                <option value="funny">😂 ตลก ขำๆ</option>
                <option value="exciting">🔥 ตื่นเต้น ลุ้น</option>
                <option value="scary">👻 สยองขวัญ ลึกลับ</option>
                <option value="cute">🥰 น่ารัก อบอุ่น</option>
                <option value="serious">📚 จริงจัง ให้ความรู้</option>
                <option value="sarcastic">😏 ประชด เสียดสี</option>
                <option disabled>──── ดุดัน ────</option>
                <option value="aggressive">😤 ดุดัน กระแทกใจ</option>
                <option value="grumpy">👹 หน้าโหด บ่น ตลก (Pixar Grumpy)</option>
                <option value="scolding">👵 บ่น ดุเบาๆ</option>
                <option value="troll">😈 กวนตีน แซวจิกกัด</option>
                <option disabled>──── 18+ ────</option>
                <option value="crude">🤬 หยาบ 18+</option>
                <option disabled>──── ภาษาถิ่น ────</option>
                <option value="isan">🌾 อีสาน</option>
                <option value="isan_crude">🌾🤬 อีสาน หยาบ 18+</option>
                <option value="southern">🌊 ใต้</option>
                <option value="southern_crude">🌊🤬 ใต้ หยาบ 18+</option>
                <option value="northern">🏔️ เหนือ</option>
                <option value="northern_crude">🏔️🤬 เหนือ หยาบ 18+</option>
              </select>
            </div>
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text select-text text-xs">🖼️ จำนวน Scene</span>
              </label>
              <select
                className="select select-bordered select-sm"
                value={storySceneCount}
                onChange={(e) => {
                  const count = parseInt(e.target.value)
                  setStorySceneCount(count)
                  // Resize scenes array to match scene count
                  setScenes(prev => {
                    if (prev.length < count) {
                      return [...prev, ...Array(count - prev.length).fill(null).map((_, i) => ({
                        sceneIndex: prev.length + i,
                        sceneType: (prev.length + i === count - 1 ? 'cta' : 'story') as SceneData['sceneType'],
                        description: '',
                        startFramePrompt: '',
                        endFramePrompt: '',
                        videoPrompt: '',
                        script: '',
                        imageCreated: false,
                        endFrameCreated: false,
                        videoCreated: false,
                        addedToScene: false,
                      }))]
                    }
                    return prev.slice(0, count)
                  })
                }}
              >
                {[2, 3, 4, 5, 6, 7, 8].map(n => (
                  <option key={n} value={n}>{n} ภาพ</option>
                ))}
              </select>
            </div>
          </div>
          </>)}

          {/* Auto wording + AI generate all */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer shrink-0">
              <input
                type="checkbox"
                className="checkbox checkbox-secondary checkbox-sm"
                checked={storyAutoWording}
                onChange={(e) => setStoryAutoWording(e.target.checked)}
              />
              <span className="text-xs select-text">Auto</span>
            </label>
            <button
              className="btn btn-secondary btn-sm gap-1 flex-1"
              onClick={handleGenerateAll}
              disabled={aiLoading}
            >
              {aiLoading && aiLoadingIndex === null ? '⏳ กำลังสร้าง...' : '✨ สร้างทั้งหมดด้วย AI'}
            </button>
          </div>

          {/* Topic */}
          <div className="form-control">
            <label className="label py-1">
              <span className="label-text select-text text-xs">💡 หัวข้อเรื่อง <span className="opacity-50">(ไม่บังคับ)</span></span>
            </label>
            <input
              type="text"
              placeholder="เช่น: ยาสีฟันผู้กล้าปะทะแบคทีเรียฟันผุ"
              className="input input-bordered input-sm"
              value={storyTopic}
              onChange={(e) => setStoryTopic(e.target.value)}
            />
          </div>

          {/* Characters + JSON buttons (shown after AI generates data) */}
          {(storyCharacters.length > 0 || scenes.length > 0) && (
            <div className="flex items-center gap-2 flex-wrap">
              {storyCharacters.length > 0 && (
                <button
                  className="btn btn-ghost btn-xs gap-1"
                  onClick={() => setShowCharacterModal(true)}
                >
                  👥 ตัวละคร ({storyCharacters.length})
                </button>
              )}
              {scenes.length > 0 && (
                <button
                  className="btn btn-ghost btn-xs gap-1"
                  onClick={() => setShowJsonModal(true)}
                  title="ดู JSON ทั้งหมด"
                >
                  {'{ }'}
                </button>
              )}
              {/* Checkpoint Export/Import */}
              {scenes.length > 0 && (
                <button
                  className="btn btn-ghost btn-xs gap-1"
                  onClick={() => setShowExportModal(true)}
                  title="บันทึก Checkpoint"
                >
                  💾 Export
                </button>
              )}
              <button
                className="btn btn-ghost btn-xs gap-1"
                onClick={() => {
                  const input = document.createElement('input')
                  input.type = 'file'
                  input.accept = '.json'
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0]
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = (ev) => {
                      const json = ev.target?.result as string
                      const cp = importCheckpoint(json)
                      if (cp) {
                        restoreCheckpoint(cp)
                        setValidationError(null)
                      } else {
                        setValidationError('ไฟล์ Checkpoint ไม่ถูกต้อง หรือ version ไม่ตรง')
                      }
                    }
                    reader.readAsText(file)
                  }
                  input.click()
                }}
                title="นำเข้า Checkpoint"
              >
                📂 Import
              </button>
            </div>
          )}
          {/* Storyboard Scene Cards */}
          <StoryboardPanel
            scenes={scenes}
            onScenesChange={setScenes}
            onGenerateSingle={handleGenerateSingle}
            onGenerateImage={createImage}
            onGenerateVideo={generateVideo}
            onAddToScene={() => {}}
            onGeneratePreview={() => generatePreview(storyboardPrompt)}
            storyboardPreviewImage={storyboardPreviewImage}
            generatingPreview={generatingPreview}
            generatingImage={generatingImage}
            generatingVideo={generatingVideo}
            isRunning={isRunning || videoIsRunning || !!generatingImage || !!generatingVideo}
            maxScenes={8}
          />
        </div>
      )}

      {/* Story Progress Display */}
      {storyCurrentScene !== null && (
        <div className="alert alert-info py-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="loading loading-spinner loading-sm"></span>
              <span className="font-medium text-sm">📖 กำลังสร้างภาพที่ {storyCurrentScene}/{storyTotalScenes}</span>
            </div>
            <progress className="progress progress-primary w-full mt-1" value={storyCurrentScene - 1} max={storyTotalScenes}></progress>
          </div>
        </div>
      )}

      {/* Video Progress Display (from shared hook) */}
      {videoIsRunning && videoCurrentIndex !== null && (
        <div className="alert alert-info py-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="loading loading-spinner loading-sm"></span>
              <span className="font-medium text-sm">🎬 กำลังสร้างวิดีโอที่ {videoCurrentIndex + 1}/{videoImageStatuses.length || '?'}</span>
            </div>
            <progress className="progress progress-secondary w-full mt-1" value={videoCurrentIndex} max={videoImageStatuses.length || 1}></progress>
          </div>
        </div>
      )}

      {/* Progress Display */}
      {progress && (
        <div className="alert alert-info py-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {progress.status === 'running' && <span className="loading loading-spinner loading-sm"></span>}
              {progress.status === 'success' && <span>✓</span>}
              {progress.status === 'retrying' && <span>⟳</span>}
              {progress.status === 'failed' && <span>✗</span>}
              <span className="font-medium text-sm">{getStepDisplayName(progress.step)}</span>
            </div>
            {progress.totalSets && progress.totalSets > 1 && (
              <div className="text-xs mt-1">
                ชุดที่ {(progress.setIndex ?? 0) + 1} / {progress.totalSets}
              </div>
            )}
            {progress.status === 'retrying' && (
              <div className="text-xs mt-1 text-warning">
                ลองใหม่ครั้งที่ {progress.attempt} / {progress.maxAttempts}
              </div>
            )}
            {progress.error && (
              <div className="text-xs mt-1 text-error">{progress.error}</div>
            )}
          </div>
        </div>
      )}

      {/* Result Display */}
      {result && !isRunning && (
        <div className={`alert ${result.success ? 'alert-success' : 'alert-error'} py-2`}>
          <div className="text-sm">
            {result.success ? (
              <span>สร้างรูปสำเร็จ! ({result.completedSets}/{result.totalSets} ชุด)</span>
            ) : result.error === 'RECOVERY_REFRESH_PENDING' ? (
              <span>กำลังรีเฟรชเพื่อตรวจสอบรูปภาพ...</span>
            ) : (
              <span>ล้มเหลว: {result.error}</span>
            )}
          </div>
        </div>
      )}

      {/* Validation Error */}
      {validationError && (
        <div className="alert alert-error text-sm py-2">
          <span>{validationError}</span>
        </div>
      )}

      {/* Bulk reference mode toggle — only in story mode when preview exists */}
      {multiSetMode === 'story' && (!!storyboardPreviewImage || !!storyboardPreviewUuid) && (
        <label className="flex items-center gap-2 cursor-pointer px-2 py-1 bg-base-200 rounded-lg">
          <input
            type="checkbox"
            className="toggle toggle-sm toggle-primary"
            checked={bulkUsePreviewGrid}
            onChange={(e) => setBulkUsePreviewGrid(e.target.checked)}
          />
          <span className="text-xs">ใช้ Storyboard Preview เป็น Reference (แทน Scene 1)</span>
        </label>
      )}

      {/* Auto generate video toggle — story mode only */}
      {multiSetMode === 'story' && (
        <label className="flex items-center gap-2 cursor-pointer px-2 py-1 bg-base-200 rounded-lg">
          <input
            type="checkbox"
            className="toggle toggle-sm toggle-accent"
            checked={autoGenerateVideo}
            onChange={(e) => setAutoGenerateVideo(e.target.checked)}
          />
          <div className="flex flex-col">
            <span className="text-xs">🎬 สร้างวิดีโออัตโนมัติหลังสร้างภาพเสร็จ</span>
            {autoGenerateVideo && (
              <span className="text-[10px] text-base-content/50">Phase 1: ภาพ → Phase 2: End Frame → Phase 3: วิดีโอ</span>
            )}
          </div>
        </label>
      )}

      {/* Action Buttons */}
      {isRunning ? (
        <button className="btn btn-error w-full" onClick={handleStop}>
          หยุด
        </button>
      ) : (
        <button
          className="btn btn-primary w-full"
          onClick={handleCreate}
          disabled={multiSetMode !== 'sameModel' && multiSetMode !== 'story'}
        >
          🖼️ สร้างรูปภาพ
        </button>
      )}

      {/* Mode hint */}
      {multiSetMode !== 'sameModel' && multiSetMode !== 'story' && (
        <div className="text-center text-xs text-base-content/50">
          กรุณาเลือกโหมด "หลายชุดสินค้า นางแบบเดียว" หรือ "Story Mode" เพื่อใช้งาน
        </div>
      )}

      {/* Character Modal */}
      {showCharacterModal && (
        <div className="modal modal-open" onClick={() => setShowCharacterModal(false)}>
          <div className="modal-box max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-3">👥 ตัวละคร</h3>
            <div className="space-y-2">
              {storyCharacters.map((char, i) => (
                <div key={i} className="bg-base-200 rounded-lg p-3">
                  <div className="font-medium text-sm">{char.name}</div>
                  <div className="text-xs text-base-content/60 mt-1">{char.appearance}</div>
                </div>
              ))}
              {storyCharacters.length === 0 && (
                <div className="text-center text-base-content/50 text-sm py-4">ยังไม่มีข้อมูลตัวละคร</div>
              )}
            </div>
            <div className="modal-action">
              <button className="btn btn-sm" onClick={() => setShowCharacterModal(false)}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* JSON Modal */}
      {showJsonModal && (
        <div className="modal modal-open" onClick={() => setShowJsonModal(false)}>
          <div className="modal-box max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-lg">{'{ }'} Storyboard JSON</h3>
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify({
                    title: storyTitle,
                    characters: storyCharacters,
                    scenes: scenes,
                  }, null, 2))
                }}
                title="Copy JSON"
              >
                📋 Copy
              </button>
            </div>
            <pre className="bg-base-200 rounded-lg p-3 text-xs overflow-auto max-h-96 whitespace-pre-wrap">
              {JSON.stringify({
                title: storyTitle,
                characters: storyCharacters,
                scenes: scenes,
              }, null, 2)}
            </pre>
            <div className="modal-action">
              <button className="btn btn-sm" onClick={() => setShowJsonModal(false)}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* Export Checkpoint Modal */}
      {showExportModal && (
        <div className="modal modal-open" onClick={() => setShowExportModal(false)}>
          <div className="modal-box max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-3">💾 Export Checkpoint</h3>
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={exportIncludeImages}
                  onChange={(e) => setExportIncludeImages(e.target.checked)}
                />
                <span className="text-sm">รวมรูปภาพ (base64) — ไฟล์จะใหญ่ขึ้นมาก</span>
              </label>
              <div className="text-xs text-base-content/50">
                {'ไม่รวมรูป: ~50-100 KB | รวมรูป: 10-80 MB'}
              </div>
            </div>
            <div className="modal-action">
              <button
                className="btn btn-primary btn-sm gap-1"
                onClick={() => {
                  const cp = collectCheckpoint()
                  downloadCheckpointFile(cp, exportIncludeImages)
                  setShowExportModal(false)
                }}
              >
                ⬇️ ดาวน์โหลด
              </button>
              <button
                className="btn btn-sm gap-1"
                onClick={() => {
                  const cp = collectCheckpoint()
                  const json = exportIncludeImages ? JSON.stringify(cp, null, 2) : JSON.stringify(cp.scenes.map(s => ({...s, startFrameImage: undefined, endFrameImage: undefined, videoUrl: undefined})), null, 2)
                  navigator.clipboard.writeText(json)
                  setShowExportModal(false)
                }}
              >
                📋 Copy
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowExportModal(false)}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ImageTab
