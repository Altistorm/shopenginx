import { useState, useEffect } from 'react'
import { generateAllScenePrompts, generateSinglePrompt, type StoryCharacter, type GeneratedScene } from '../storyPrompts'
import { useVideoWorkflow, type SceneData } from '../hooks/useVideoWorkflow'

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
  const [videoPrompts, setVideoPrompts] = useState<string[]>([])
  const [videoScripts, setVideoScripts] = useState<string[]>([])
  const [imageText, setImageText] = useState('')
  const [scene, setScene] = useState('')
  const [storyPrompts, setStoryPrompts] = useState<string[]>([''])
  const [referenceStyle, setReferenceStyle] = useState('pixar_3d')
  const [storyMood, setStoryMood] = useState('grumpy')
  const [storySceneCount, setStorySceneCount] = useState(4)
  const [storyTopic, setStoryTopic] = useState('')
  const [storyAutoWording, setStoryAutoWording] = useState(false)
  const [storyTitle, setStoryTitle] = useState('')
  const [storyCharacters, setStoryCharacters] = useState<StoryCharacter[]>([])
  const [storySceneData, setStorySceneData] = useState<GeneratedScene[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiLoadingIndex, setAiLoadingIndex] = useState<number | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const [validationError, setValidationError] = useState<string | null>(null)
  
  // Progress state for event-driven workflow
  const [progress, setProgress] = useState<ImageProgressEvent | null>(null)
  const [result, setResult] = useState<{ success: boolean; error?: string; completedSets?: number; totalSets?: number } | null>(null)

  // Story mode progress (sidebar-controlled)
  const [storyCurrentScene, setStoryCurrentScene] = useState<number | null>(null)
  const [storyTotalScenes, setStoryTotalScenes] = useState(0)
  const [showCharacterModal, setShowCharacterModal] = useState(false)

  // Shared video workflow hook (for auto-generate video)
  const {
    startVideo,
    isRunning: videoIsRunning,
    currentImageIndex: videoCurrentIndex,
    imageStatuses: videoImageStatuses,
  } = useVideoWorkflow()
  const [showJsonModal, setShowJsonModal] = useState(false)

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
      const validPrompts = storyPrompts.filter(p => p.trim())
      if (validPrompts.length === 0) {
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

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

    // Check if on Google Flow
    if (!tab?.url?.includes('labs.google/fx/tools/flow')) {
      setValidationError('กรุณาเปิด Google Flow ก่อน (labs.google/fx/tools/flow)')
      return
    }

    setIsRunning(true)

    try {
      if (multiSetMode === 'story') {
        // ==================== Story Mode — Sidebar-Controlled ====================
        const validPrompts = storyPrompts.filter(p => p.trim())
        const total = validPrompts.length

        console.log(`[handleCreate] Story mode: ${total} scenes, sidebar-controlled`)
        setStoryTotalScenes(total)

        // Step 1: Init story mode (once)
        const initResp = await chrome.tabs.sendMessage(tab.id!, {
          type: 'INIT_STORY_MODE',
          aspectRatio,
          imageCount,
          totalScenes: total,
        })

        if (!initResp?.success) {
          setValidationError(`Init failed: ${initResp?.error || 'Unknown error'}`)
          setIsRunning(false)
          return
        }

         // Build character reference text (appended to every prompt)
        let charRefText = ''
        if (storyCharacters.length > 0) {
          const charDesc = storyCharacters.map(c => `${c.name}: ${c.appearance}`).join('; ')
          charRefText = `\n\n[Character Reference: ${charDesc}]`
        }

        // Instruction for scenes 2+ when a reference image ingredient is uploaded.
        // Without this, Google Flow copies the entire scene 1 (background, composition, pose)
        // instead of only matching the character appearance.
        const ingredientInstruction = `\n\n[IMPORTANT: The ingredient image is ONLY a reference for character appearance and art style/tone consistency. Do NOT copy its background, composition, camera angle, or pose. Generate a completely NEW scene with a DIFFERENT background and setting as described in this prompt. Match the characters and visual tone only.]`

        // Step 2: Loop through scenes one at a time
        let completedScenes = 0
        let autoCharRefUuid: string | null = null  // scene 1's image UUID for "Add To Prompt" reference
        let autoCharRef: string | null = null      // scene 1's image base64 (legacy fallback)
        const scenes: SceneData[] = []

        for (let i = 0; i < total; i++) {
          setStoryCurrentScene(i + 1)

          // Capture scene 1 always (for char ref), capture all if autoGenerateVideo
          const shouldCapture = i === 0 || autoGenerateVideo

          const sceneResp: { success?: boolean; imagesCreated?: number; error?: string; imageBase64?: string; imageUUIDs?: string[] } =
            await chrome.tabs.sendMessage(tab.id!, {
              type: 'CREATE_STORY_SCENE',
              prompt: validPrompts[i] + charRefText + (i > 0 ? ingredientInstruction : ''),
              sceneIndex: i,
              totalScenes: total,
              imageCount,
              autoSaveImage,
              downloadResolution,
              isLast: !autoGenerateVideo && i === total - 1,  // if video follows, don't cleanup on last image scene
              referenceImageUuid: i > 0 ? autoCharRefUuid : undefined,
              referenceImage: i > 0 && !autoCharRefUuid ? autoCharRef : undefined,  // legacy fallback
              captureImage: shouldCapture,
            })

          console.log(`[handleCreate] Scene ${i + 1}/${total} result:`, sceneResp)

          if (sceneResp?.success) {
            completedScenes++
            // Prefer UUID for "Add To Prompt" (no upload needed), fall back to base64
            if (i === 0 && sceneResp.imageUUIDs?.[0]) {
              autoCharRefUuid = sceneResp.imageUUIDs[0]
              console.log(`[handleCreate] Saved scene 1 image UUID for reference: ${autoCharRefUuid}`)
            }
            if (i === 0 && sceneResp.imageBase64) {
              autoCharRef = sceneResp.imageBase64
              console.log(`[handleCreate] Saved scene 1 base64 as fallback reference (${Math.round(autoCharRef!.length / 1024)}KB)`)
            }
            // Collect scene data for video generation
            if (autoGenerateVideo && sceneResp.imageBase64) {
              const vp = videoPrompts[i]?.trim() || storySceneData[i]?.videoPrompt || validPrompts[i]
              const script = videoScripts[i]?.trim() || storySceneData[i]?.script || ''
              const fullVideoPrompt = script ? `${vp}\n\nScript: "${script}"` : vp
              scenes.push({
                sceneIndex: i,
                imagePrompt: validPrompts[i],
                imageUuid: sceneResp.imageUUIDs?.[0],
                imageBase64: sceneResp.imageBase64,
                videoPrompt: fullVideoPrompt,
                script,
                imageCreated: true,
                videoCreated: false,
                addedToScene: false,
              })
            }
          }
        }

        setStoryCurrentScene(null)

        // Step 3: Auto-generate videos if enabled (using shared hook)
        let completedVideos = 0
        let videoTotal = 0
        if (autoGenerateVideo && scenes.length > 0) {
          // Use "Add To Prompt" flow if UUIDs are available (same project, no upload needed)
          const hasUuids = scenes.some(s => s.imageUuid)

          const videoJobs = videoExtensionMode
            ? [{
                // Extension mode: 1 video, all prompts as extensions (~8s + 7s per extension)
                image: hasUuids ? null : (scenes[0].imageBase64 as string | null),
                imageUuid: scenes[0].imageUuid,
                prompts: scenes.map(s => s.videoPrompt),
              }]
            : scenes.map(s => ({
                // Normal mode: separate video per scene (~8s each)
                image: hasUuids ? null : (s.imageBase64 as string | null),
                imageUuid: s.imageUuid,
                prompts: [s.videoPrompt],
              }))

          console.log(`[handleCreate] Video generation: ${videoExtensionMode ? 'extension' : 'separate'} mode, ${videoJobs.length} job(s) via useVideoWorkflow, continueFromCurrent=${hasUuids}`)

          const videoResult = await startVideo(videoJobs, {
            aspectRatio,
            videoCount: 1,
            autoDownload: autoSaveImage,
            downloadToFolder,
            continueFromCurrent: hasUuids,
            // Pass ordered prompts so "add to scene" can match videos by prompt text
            scenePromptsInOrder: !videoExtensionMode ? scenes.map(s => s.videoPrompt) : undefined,
          })

          completedVideos = videoResult.completedCount
          videoTotal = videoResult.totalCount
        }

        setResult({
          success: completedScenes === total && (!autoGenerateVideo || completedVideos === videoTotal),
          completedSets: completedScenes,
          totalSets: total,
          error: completedScenes < total
            ? `สร้างได้ ${completedScenes}/${total} ภาพ`
            : autoGenerateVideo && completedVideos < videoTotal
              ? `ภาพครบ ${total}/${total} | วิดีโอ ${completedVideos}/${videoTotal}`
              : undefined,
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
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
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
      // Initialize prompts to match scene count, default 1 image per scene
      setStoryPrompts(prev => {
        if (prev.length < storySceneCount) {
          return [...prev, ...Array(storySceneCount - prev.length).fill('')]
        }
        return prev.slice(0, storySceneCount)
      })
      // Initialize video prompts/scripts to match scene count
      setVideoPrompts(prev => {
        if (prev.length < storySceneCount) return [...prev, ...Array(storySceneCount - prev.length).fill('')]
        return prev.slice(0, storySceneCount)
      })
      setVideoScripts(prev => {
        if (prev.length < storySceneCount) return [...prev, ...Array(storySceneCount - prev.length).fill('')]
        return prev.slice(0, storySceneCount)
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
      })

      // Store full storyboard data
      setStoryTitle(result.title)
      setStoryCharacters(result.characters)
      setStorySceneData(result.scenes)

      // Extract imagePrompts into the prompts array for editing
      const newPrompts = result.scenes.map(s => s.imagePrompt)
      // Pad or trim to match scene count
      while (newPrompts.length < storySceneCount) newPrompts.push('')
      setStoryPrompts(newPrompts.slice(0, storySceneCount))

      // Pre-fill video prompts and scripts from AI
      const newVideoPrompts = result.scenes.map(s => s.videoPrompt || '')
      while (newVideoPrompts.length < storySceneCount) newVideoPrompts.push('')
      setVideoPrompts(newVideoPrompts.slice(0, storySceneCount))

      const newVideoScripts = result.scenes.map(s => s.script || '')
      while (newVideoScripts.length < storySceneCount) newVideoScripts.push('')
      setVideoScripts(newVideoScripts.slice(0, storySceneCount))
    } catch (err) {
      setValidationError((err as Error).message)
    } finally {
      setAiLoading(false)
    }
  }

  // AI: Generate single prompt
  const handleGenerateSingle = async (index: number) => {
    setValidationError(null)
    const currentText = storyPrompts[index]?.trim()
    if (!currentText) {
      setValidationError('กรุณาพิมพ์คำอธิบายสั้นๆ ก่อนกด AI')
      return
    }
    setAiLoadingIndex(index)
    try {
      const isFirst = index === 0
      const isLast = index === storyPrompts.length - 1 && storyPrompts.length > 1
      const sceneType = isFirst ? 'hook' as const : isLast ? 'cta' as const : 'story' as const

      const result = await generateSinglePrompt({
        description: currentText,
        style,
        mood: storyMood,
        sceneType,
      })
      const newPrompts = [...storyPrompts]
      newPrompts[index] = result.trim()
      setStoryPrompts(newPrompts)
    } catch (err) {
      setValidationError((err as Error).message)
    } finally {
      setAiLoadingIndex(null)
    }
  }

  return (
    <div className="space-y-2">
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

      {/* Story mode settings + prompts */}
      {multiSetMode === 'story' && (
        <div className="space-y-2">
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
                  // Resize prompts array to match scene count
                  setStoryPrompts(prev => {
                    if (prev.length < count) {
                      return [...prev, ...Array(count - prev.length).fill('')]
                    }
                    return prev.slice(0, count)
                  })
                  // Resize video prompts/scripts to match
                  setVideoPrompts(prev => {
                    if (prev.length < count) return [...prev, ...Array(count - prev.length).fill('')]
                    return prev.slice(0, count)
                  })
                  setVideoScripts(prev => {
                    if (prev.length < count) return [...prev, ...Array(count - prev.length).fill('')]
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

          {/* Characters + JSON buttons (shown after AI generates data) */}
          {(storyCharacters.length > 0 || storySceneData.length > 0) && (
            <div className="flex items-center gap-2">
              {storyCharacters.length > 0 && (
                <button
                  className="btn btn-ghost btn-xs gap-1"
                  onClick={() => setShowCharacterModal(true)}
                >
                  👥 ตัวละคร ({storyCharacters.length})
                </button>
              )}
              {storySceneData.length > 0 && (
                <button
                  className="btn btn-ghost btn-xs gap-1"
                  onClick={() => setShowJsonModal(true)}
                  title="ดู JSON ทั้งหมด"
                >
                  {'{ }'}
                </button>
              )}
            </div>
          )}

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

          {/* Prompt textareas */}
          <div className="collapse collapse-arrow bg-base-300 rounded-lg">
            <input type="checkbox" defaultChecked />
            <div className="collapse-title py-2 min-h-0">
              <span className="label-text select-text text-xs">📝 Prompt <span className="text-error">*</span></span>
              <span className="text-base-content/50 text-xs ml-2">
                {storyPrompts.length} ภาพ
              </span>
            </div>
            <div className="collapse-content space-y-2">
              {storyPrompts.map((prompt, index) => {
                const isFirst = index === 0
                const isLast = index === storyPrompts.length - 1 && storyPrompts.length > 1
                const sceneType = isFirst ? 'Hook' : isLast ? 'CTA' : 'Story'
                const sceneLabel = isFirst
                  ? `ภาพที่ 1 (${sceneType})`
                  : isLast
                    ? `ภาพที่ ${index + 1} (${sceneType})`
                    : `ภาพที่ ${index + 1} (${sceneType})`
                const placeholder = isFirst
                  ? 'ฉากเปิด ดึงดูดสายตา เช่น ตัวละครแสดงอารมณ์ชัดเจน'
                  : isLast
                    ? 'ปิดเรื่อง เช่น สรุป/ชวนติดตาม'
                    : 'เล่าเรื่องต่อ เช่น ตัวละครเจอปัญหา/แก้ปัญหา'

                return (
                  <div key={index} className="flex gap-2">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-medium ${isFirst ? 'text-warning' : isLast ? 'text-success' : 'text-base-content/50'}`}>
                          {sceneLabel}
                        </span>
                        <button
                          className="btn btn-ghost btn-xs gap-1 text-secondary"
                          title="สร้าง Prompt ด้วย AI"
                          onClick={() => handleGenerateSingle(index)}
                          disabled={aiLoadingIndex === index}
                        >
                          {aiLoadingIndex === index ? '⏳' : '✨'}
                        </button>
                      </div>
                      {storySceneData[index]?.description && (
                        <div className="text-xs text-base-content/40 mb-1 pl-1">{storySceneData[index].description}</div>
                      )}
                      <textarea
                        className="textarea textarea-bordered w-full text-sm"
                        rows={8}
                        placeholder={placeholder}
                        value={prompt}
                        onChange={(e) => {
                          const newPrompts = [...storyPrompts]
                          newPrompts[index] = e.target.value
                          setStoryPrompts(newPrompts)
                        }}
                      />
                    </div>
                    {storyPrompts.length > 2 && (
                      <button
                        className="btn btn-ghost btn-sm btn-square text-error self-end mb-1"
                        onClick={() => setStoryPrompts(prev => prev.filter((_, i) => i !== index))}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )
              })}
              {storyPrompts.length < 8 && (
                <button
                  className="btn btn-ghost btn-sm mt-2"
                  onClick={() => setStoryPrompts(prev => [...prev, ''])}
                >
                  + เพิ่มภาพ
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scene */}
      <div className="form-control">
        <label className="label py-1">
          <span className="label-text select-text text-xs">🎬 ฉาก/สถานที่ <span className="opacity-50">(ไม่บังคับ)</span></span>
        </label>
        <input
          type="text"
          placeholder="เช่น: ในห้องนอน, ริมทะเล, ในสตูดิโอ"
          className="input input-bordered input-sm"
          value={scene}
          onChange={(e) => setScene(e.target.value)}
        />
      </div>

      {/* Options */}
      <div className="space-y-1">
        <label className="flex items-center gap-2 cursor-pointer px-2 py-1 rounded bg-base-300 hover:bg-base-100 transition-colors text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-primary checkbox-xs"
            checked={noTextOnImage}
            onChange={(e) => setNoTextOnImage(e.target.checked)}
          />
          <span className="select-text">🚫 ไม่ต้องมีข้อความบนภาพ</span>
        </label>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer px-2 py-1 rounded bg-base-300 hover:bg-base-100 transition-colors text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-primary checkbox-xs"
              checked={autoSaveImage}
              onChange={(e) => setAutoSaveImage(e.target.checked)}
            />
            <span className="select-text">💾 Auto Save รูปลงเครื่อง</span>
          </label>
          {autoSaveImage && (
            <select
              className="select select-bordered select-xs"
              value={downloadResolution}
              onChange={(e) => setDownloadResolution(e.target.value as '1K' | '2K' | '4K')}
            >
              <option value="1K">1K</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
          )}
        </div>

        <label className="flex items-center gap-2 cursor-pointer px-2 py-1 rounded bg-base-300 hover:bg-base-100 transition-colors text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-primary checkbox-xs"
            checked={downloadToFolder}
            onChange={(e) => setDownloadToFolder(e.target.checked)}
            disabled={!autoSaveImage}
          />
          <span className={`select-text ${!autoSaveImage ? 'opacity-50' : ''}`}>📁 Save to ShopEnginX folder</span>
        </label>

        {multiSetMode === 'story' && (
          <label className="flex items-center gap-2 cursor-pointer px-2 py-1 rounded bg-base-300 hover:bg-base-100 transition-colors text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-primary checkbox-xs"
              checked={autoGenerateVideo}
              onChange={(e) => setAutoGenerateVideo(e.target.checked)}
            />
            <span className="select-text">🎬 สร้างวิดีโอต่ออัตโนมัติ</span>
          </label>
        )}

        {multiSetMode === 'story' && autoGenerateVideo && (
          <label className="flex items-center gap-2 cursor-pointer px-2 py-1 rounded bg-base-300 hover:bg-base-100 transition-colors text-sm ml-6">
            <input
              type="checkbox"
              className="checkbox checkbox-secondary checkbox-xs"
              checked={videoExtensionMode}
              onChange={(e) => setVideoExtensionMode(e.target.checked)}
              disabled={isRunning}
            />
            <span className="select-text">🔗 Extension Mode (ต่อเป็นวิดีโอเดียว)</span>
          </label>
        )}

      </div>

      {/* Video Prompts + Scripts per Scene (shown when auto-generate video is checked) */}
      {multiSetMode === 'story' && autoGenerateVideo && (
        <div className="collapse collapse-arrow bg-base-300 rounded-lg">
          <input type="checkbox" defaultChecked />
          <div className="collapse-title py-2 min-h-0">
            <span className="label-text select-text text-xs">🎬 Video Prompt & Script per Scene</span>
          </div>
          <div className="collapse-content space-y-2">
            {storyPrompts.map((_, index) => {
              const isFirst = index === 0
              const isLast = index === storyPrompts.length - 1 && storyPrompts.length > 1
              const sceneType = isFirst ? 'Hook' : isLast ? 'CTA' : 'Story'

              return (
                <div key={index} className="bg-base-200 rounded-lg p-3 space-y-2">
                  <div className={`text-xs font-medium ${isFirst ? 'text-warning' : isLast ? 'text-success' : 'text-base-content/50'}`}>
                    🎬 Scene {index + 1} ({sceneType})
                  </div>

                  {/* Video Prompt */}
                  <div>
                    <div className="text-xs text-base-content/40 mb-1">Video Prompt</div>
                    <textarea
                      className="textarea textarea-bordered w-full text-sm"
                      rows={4}
                      placeholder={`Video action prompt for scene ${index + 1}...`}
                      value={videoPrompts[index] || ''}
                      onChange={(e) => {
                        const updated = [...videoPrompts]
                        while (updated.length <= index) updated.push('')
                        updated[index] = e.target.value
                        setVideoPrompts(updated)
                      }}
                      disabled={isRunning}
                    />
                  </div>

                  {/* Script */}
                  <div>
                    <div className="text-xs text-base-content/40 mb-1">📝 Script</div>
                    <textarea
                      className="textarea textarea-bordered w-full text-sm"
                      rows={4}
                      placeholder={`บทพูด/narration สำหรับ scene ${index + 1}...`}
                      value={videoScripts[index] || ''}
                      onChange={(e) => {
                        const updated = [...videoScripts]
                        while (updated.length <= index) updated.push('')
                        updated[index] = e.target.value
                        setVideoScripts(updated)
                      }}
                      disabled={isRunning}
                    />
                  </div>
                </div>
              )
            })}
          </div>
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
                    scenes: storySceneData,
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
                scenes: storySceneData,
              }, null, 2)}
            </pre>
            <div className="modal-action">
              <button className="btn btn-sm" onClick={() => setShowJsonModal(false)}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ImageTab
