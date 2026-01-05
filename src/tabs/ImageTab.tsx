import { useState } from 'react'
import { workflowManager } from '../workflow'
import { ImageFlowContext } from '../flowWorkflow'
import '../flowWorkflow' // Register workflow

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
  const [multiSetMode, setMultiSetMode] = useState<'none' | 'multi' | 'sameModel'>('none')
  const [setCount, setSetCount] = useState(2)
  const [imageSets, setImageSets] = useState<ImageSet[]>([])
  const [sharedModelImage, setSharedModelImage] = useState<string | null>(null)
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [imageCount, setImageCount] = useState(4)
  const [noTextOnImage, setNoTextOnImage] = useState(false)
  const [autoSaveImage, setAutoSaveImage] = useState(true)
  const [downloadResolution, setDownloadResolution] = useState<'1K' | '2K' | '4K'>('2K')
  const [enableLoop, setEnableLoop] = useState(false)
  const [loopCount, setLoopCount] = useState(5)
  const [autoRunWorkflow, setAutoRunWorkflow] = useState(true)
  const [imageText, setImageText] = useState('')
  const [scene, setScene] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isSettingsConfigured, setIsSettingsConfigured] = useState(false)
  const [isImageUploaded, setIsImageUploaded] = useState(false)
  const [isPromptFilled, setIsPromptFilled] = useState(false)
  const [isCreateClicked, setIsCreateClicked] = useState(false)

  const [validationError, setValidationError] = useState<string | null>(null)

  const handleCreate = async () => {
    // Validation
    setValidationError(null)

    if (multiSetMode === 'none') {
      // Single mode: require at least one image
      if (images.length === 0) {
        setValidationError('กรุณาเพิ่มรูปสินค้าอย่างน้อย 1 รูป')
        return
      }
    } else {
      // Multi-set mode: require at least one product image in each set
      const emptySet = imageSets.find(set => !set.product)
      if (emptySet) {
        setValidationError('กรุณาเพิ่มรูปสินค้าในทุกชุด')
        return
      }
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

    // Prepare images based on mode
    let workflowImages: string[] = []
    let productImagesArray: string[] = []

    if (multiSetMode === 'sameModel' && sharedModelImage) {
      // sameModel mode: collect all product images, workflow will iterate through sets
      productImagesArray = imageSets.map(set => set.product).filter((p): p is string => p !== null)
      // First round: sharedModel + first product
      workflowImages = [sharedModelImage, productImagesArray[0]].filter((img): img is string => img !== undefined)
      console.log(`[handleCreate] sameModel mode: ${productImagesArray.length} products, starting with set 0`)
    } else if (multiSetMode === 'none') {
      workflowImages = images
    } else {
      // multi mode (different model per set) - flatten all images
      imageSets.forEach(set => {
        if (set.model) workflowImages.push(set.model)
        if (set.product) workflowImages.push(set.product)
      })
    }

    // Create context from current state
    const context: ImageFlowContext = {
      images: workflowImages,
      style,
      productName,
      modelType,
      aspectRatio,
      imageCount,
      noTextOnImage,
      imageText,
      scene,
      currentImageIndex,
      isSettingsConfigured,
      isImageUploaded,
      isPromptFilled,
      isCreateClicked,
      autoSaveImage,
      downloadResolution,
      // Multi-set mode fields
      multiSetMode,
      currentSetIndex: 0,
      totalSets: multiSetMode === 'sameModel' ? productImagesArray.length : undefined,
      sharedModelImage: multiSetMode === 'sameModel' ? sharedModelImage : undefined,
      productImages: multiSetMode === 'sameModel' ? productImagesArray : undefined,
    }

    // Set tab ID if we are on Flow
    if (tab?.url?.startsWith('https://labs.google')) {
      context.tabId = tab.id
    }

    setIsRunning(true)
    try {
      // Get current node based on browser state
      let currentNode = await workflowManager.getCurrentNode('image')

      if (!currentNode) {
        throw new Error('Could not determine current workflow state')
      }

      console.log('Current node:', currentNode.id)
      console.log('Auto Run Workflow:', autoRunWorkflow)

      // Helper function to get action name
      const getActionName = async (node: typeof currentNode, ctx: typeof context): Promise<string | null> => {
        // Try to get action from node's ActionResolver (for nodes with dynamic actions)
        let actionName = await node.determineAction(ctx)

        // Fallback to switch-case for nodes without ActionResolver
        if (!actionName) {
          switch (node.id) {
            case 'browser':
              actionName = 'openFlow'
              break
            case 'flowHomePage':
              actionName = 'ensureImageTabAndClickNewProject'
              break
            case 'projectEditorWithImages':
              actionName = 'configureSettings'
              break
            case 'projectEditorConfigured':
              actionName = 'generate'
              break
            case 'generating':
              actionName = 'waitForResult'
              break
            default:
              console.warn(`No automatic action for node: ${node.id}`)
              return null
          }
        }
        return actionName
      }

      if (autoRunWorkflow) {
        // Auto Run: Loop until workflow is complete
        let actionName = await getActionName(currentNode, context)
        let iterationCount = 0
        const MAX_ITERATIONS = 100 // Safety limit

        while (actionName && iterationCount < MAX_ITERATIONS) {
          iterationCount++
          console.log(`[Auto Run] Iteration ${iterationCount}: Running action "${actionName}" on node "${currentNode.id}"`)

          const nextNodeId = await currentNode.runAction(actionName, context)

          // Use nextNodeId if action specifies a transition, otherwise re-detect by URL
          if (nextNodeId) {
            console.log(`[Auto Run] Action returned nextNodeId: "${nextNodeId}"`)
            const nextNode = workflowManager.getNodeById('image', nextNodeId)
            if (nextNode) {
              currentNode = nextNode
            } else {
              console.warn(`[Auto Run] Node "${nextNodeId}" not found, re-detecting...`)
              currentNode = await workflowManager.getCurrentNode('image')
            }
          } else {
            // No nextNodeId means workflow complete or re-detect needed
            console.log('[Auto Run] No nextNodeId, re-detecting current node...')
            currentNode = await workflowManager.getCurrentNode('image')
          }

          if (!currentNode) {
            console.log('[Auto Run] No current node detected, workflow may be complete')
            break
          }

          // Get next action
          actionName = await getActionName(currentNode, context)

          // Small delay between actions to prevent overwhelming the browser
          await new Promise(resolve => setTimeout(resolve, 500))
        }

        if (iterationCount >= MAX_ITERATIONS) {
          console.warn('[Auto Run] Reached maximum iterations, stopping')
        }

        console.log(`[Auto Run] Workflow completed after ${iterationCount} iterations`)

      } else {
        // Single Step: Run one action only
        const actionName = await getActionName(currentNode, context)

        if (!actionName) {
          setIsRunning(false)
          return
        }

        console.log('Running action:', actionName)
        await currentNode.runAction(actionName, context)
      }

      // Sync state back to React
      if (context.currentImageIndex !== undefined) {
        setCurrentImageIndex(context.currentImageIndex)
      }
      if (context.isSettingsConfigured) {
        setIsSettingsConfigured(true)
      }
      if (context.isImageUploaded) {
        setIsImageUploaded(true)
      }
      if (context.isPromptFilled) {
        setIsPromptFilled(true)
      }
      if (context.isCreateClicked) {
        // Reset all state after Create is clicked for next run
        setCurrentImageIndex(0)
        setIsSettingsConfigured(false)
        setIsImageUploaded(false)
        setIsPromptFilled(false)
        setIsCreateClicked(false)
      }

    } catch (error) {
      console.error('Workflow error:', error)
      setValidationError(error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการทำงาน')
    } finally {
      setIsRunning(false)
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files) {
      // Reset state when new images are uploaded
      setCurrentImageIndex(0)
      setIsSettingsConfigured(false)
      setIsImageUploaded(false)
      setIsPromptFilled(false)
      setIsCreateClicked(false)
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

  const handleMultiSetChange = (mode: 'none' | 'multi' | 'sameModel') => {
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
      {/* Multi-set checkboxes */}
      <div className="space-y-1">
        <label className="flex items-center gap-2 cursor-pointer px-2 py-1 rounded-lg bg-base-300 hover:bg-base-100 transition-colors text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-primary checkbox-sm"
            checked={multiSetMode === 'multi'}
            onChange={() => handleMultiSetChange(multiSetMode === 'multi' ? 'none' : 'multi')}
          />
          <span className="select-text">📦 หลายชุดสินค้า (วนสร้างทีละชุด)</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer px-2 py-1 rounded-lg bg-base-300 hover:bg-base-100 transition-colors text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-primary checkbox-sm"
            checked={multiSetMode === 'sameModel'}
            onChange={() => handleMultiSetChange(multiSetMode === 'sameModel' ? 'none' : 'sameModel')}
          />
          <span className="select-text">👤 หลายชุดสินค้า นางแบบเดียว (วนสร้างทีละชุด)</span>
        </label>
      </div>

      {/* Multi-set area */}
      {multiSetMode !== 'none' && (
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

      {/* Single image upload (hidden when multi-set) */}
      {multiSetMode === 'none' && (
        <div className="form-control">
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
            onChange={(e) => setAspectRatio(e.target.value)}
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

      {/* Image Text */}
      <div className="form-control">
        <label className="label py-1">
          <span className="label-text select-text text-xs">🏷️ ข้อความบนภาพ <span className="opacity-50">(ถ้าเว้นไว้ AI จะคิดให้เอง)</span></span>
        </label>
        <textarea
          placeholder="พิมพ์ข้อความเอง หรือกด AI วิเคราะห์"
          className="textarea textarea-bordered textarea-sm h-16"
          value={imageText}
          onChange={(e) => setImageText(e.target.value)}
        />
        <button className="btn btn-secondary btn-sm mt-1">
          ✨ วิเคราะห์ข้อความด้วย AI
        </button>
      </div>

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
            checked={enableLoop}
            onChange={(e) => setEnableLoop(e.target.checked)}
          />
          <span className="select-text">🔄 วนลูปสร้างรูป</span>
        </label>

        {enableLoop && (
          <div className="ml-6 flex items-center gap-2 text-sm">
            <span>จำนวนรอบ:</span>
            <input
              type="number"
              min={2}
              max={50}
              className="input input-bordered input-xs w-16"
              value={loopCount}
              onChange={(e) => setLoopCount(parseInt(e.target.value) || 5)}
            />
            <span className="text-xs opacity-50">(สูงสุด 50)</span>
          </div>
        )}

        <label className="flex items-center gap-2 cursor-pointer px-2 py-1 rounded bg-base-300 hover:bg-base-100 transition-colors text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-success checkbox-xs"
            checked={autoRunWorkflow}
            onChange={(e) => setAutoRunWorkflow(e.target.checked)}
          />
          <span className="select-text">⚡ Auto Run Workflow (รันทั้งหมดอัตโนมัติ)</span>
        </label>
      </div>

      {/* Validation Error */}
      {validationError && (
        <div className="alert alert-error text-sm py-2">
          <span>{validationError}</span>
        </div>
      )}

      {/* Create Button */}
      <button
        className="btn btn-primary w-full"
        onClick={handleCreate}
        disabled={isRunning}
      >
        {isRunning ? (
          <>
            <span className="loading loading-spinner loading-sm"></span>
            กำลังสร้าง...
          </>
        ) : (
          '🖼️ สร้างรูปภาพ'
        )}
      </button>
    </div>
  )
}

export default ImageTab
