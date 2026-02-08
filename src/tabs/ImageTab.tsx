import { useState, useEffect } from 'react'

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
  const [style, setStyle] = useState('tiktok_real')
  const [productName, setProductName] = useState('')
  const [modelType, setModelType] = useState('from_image')
  const [multiSetMode, setMultiSetMode] = useState<'none' | 'story' | 'multi' | 'sameModel'>('none')
  const [setCount, setSetCount] = useState(2)
  const [imageSets, setImageSets] = useState<ImageSet[]>([])
  const [sharedModelImage, setSharedModelImage] = useState<string | null>(null)
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>('9:16')
  const [imageCount, setImageCount] = useState(4)
  const [noTextOnImage, setNoTextOnImage] = useState(false)
  const [autoSaveImage, setAutoSaveImage] = useState(true)
  const [downloadResolution, setDownloadResolution] = useState<'1K' | '2K' | '4K'>('1K')
  const [imageText, setImageText] = useState('')
  const [scene, setScene] = useState('')
  const [storyPrompts, setStoryPrompts] = useState<string[]>([''])
  const [isRunning, setIsRunning] = useState(false)

  const [validationError, setValidationError] = useState<string | null>(null)
  
  // Progress state for event-driven workflow
  const [progress, setProgress] = useState<ImageProgressEvent | null>(null)
  const [result, setResult] = useState<{ success: boolean; error?: string; completedSets?: number; totalSets?: number } | null>(null)

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
      if (multiSetMode === 'sameModel' && sharedModelImage) {
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
    if (mode === 'multi') {
      generateSets(setCount, false)
    } else if (mode === 'sameModel') {
      // Create 2 empty product sets for sameModel mode
      generateSets(2, true)
      setSharedModelImage(null)
    } else {
      setImageSets([])
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
          </select>
        </div>
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
            <span className="label-text select-text text-xs">🔢 จำนวน</span>
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

      {/* Story mode prompts */}
      {multiSetMode === 'story' && (
        <div className="form-control">
          <label className="label py-1">
            <span className="label-text select-text text-xs">📝 Prompt <span className="text-error">*</span></span>
            <span className="label-text-alt text-base-content/50 text-xs">
              {storyPrompts.length > 1 ? `${storyPrompts.length} ภาพ` : '1 ภาพ'}
            </span>
          </label>
          <div className="space-y-2">
            {storyPrompts.map((prompt, index) => (
              <div key={index} className="flex gap-2">
                <div className="flex-1">
                  <div className="text-xs text-base-content/50 mb-1">
                    {index === 0 ? 'ภาพแรก' : `ภาพที่ ${index + 1}`}
                  </div>
                  <textarea
                    className="textarea textarea-bordered w-full text-sm"
                    rows={2}
                    placeholder={index === 0 ? "อธิบายภาพที่ต้องการ..." : `ภาพที่ ${index + 1}: อธิบายฉากถัดไป...`}
                    value={prompt}
                    onChange={(e) => {
                      const newPrompts = [...storyPrompts]
                      newPrompts[index] = e.target.value
                      setStoryPrompts(newPrompts)
                    }}
                  />
                </div>
                {storyPrompts.length > 1 && (
                  <button
                    className="btn btn-ghost btn-sm btn-square text-error"
                    onClick={() => setStoryPrompts(prev => prev.filter((_, i) => i !== index))}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            className="btn btn-ghost btn-sm mt-2"
            onClick={() => setStoryPrompts(prev => [...prev, ''])}
          >
            + เพิ่มภาพ
          </button>
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

      </div>

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
    </div>
  )
}

export default ImageTab
