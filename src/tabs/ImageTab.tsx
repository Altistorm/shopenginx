import { useState } from 'react'

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
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [imageCount, setImageCount] = useState(4)
  const [noTextOnImage, setNoTextOnImage] = useState(false)
  const [autoSaveImage, setAutoSaveImage] = useState(false)
  const [enableLoop, setEnableLoop] = useState(false)
  const [loopCount, setLoopCount] = useState(5)
  const [imageText, setImageText] = useState('')
  const [scene, setScene] = useState('')

  const handleCreate = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

    if (tab?.url?.startsWith('https://labs.google')) {
      // Already on labs.google - proceed with creation
      console.log('Ready to create on labs.google')
      // TODO: Add your creation logic here
    } else {
      // Open new tab with labs.google
      chrome.tabs.create({
        url: 'https://labs.google/fx/tools/flow',
        active: true
      })
    }
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

  const handleMultiSetChange = (mode: 'none' | 'multi' | 'sameModel') => {
    setMultiSetMode(mode)
    if (mode !== 'none') {
      generateSets(setCount, mode === 'sameModel')
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
          <div className="flex items-center justify-between">
            <span className="text-sm">📦 จำนวนชุด:</span>
            <select
              className="select select-bordered select-xs"
              value={setCount}
              onChange={(e) => {
                const count = parseInt(e.target.value)
                setSetCount(count)
                generateSets(count, multiSetMode === 'sameModel')
              }}
            >
              {[2,3,4,5,6,7,8,9,10].map(n => (
                <option key={n} value={n}>{n} ชุด</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
            {imageSets.map((set, index) => (
              <div key={set.id} className="bg-base-200 rounded-lg p-2">
                <div className="text-xs font-bold text-primary mb-2">📦 ชุดที่ {index + 1}</div>
                <div className="flex gap-1 mb-2">
                  <div className="flex-1 h-16 border-2 border-dashed border-primary/30 rounded flex flex-col items-center justify-center text-xs cursor-pointer hover:border-primary/60">
                    <span>📷</span>
                    <span>รูปสินค้า</span>
                  </div>
                  {(multiSetMode === 'multi' || index === 0) && (
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

        <label className="flex items-center gap-2 cursor-pointer px-2 py-1 rounded bg-base-300 hover:bg-base-100 transition-colors text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-primary checkbox-xs"
            checked={autoSaveImage}
            onChange={(e) => setAutoSaveImage(e.target.checked)}
          />
          <span className="select-text">💾 Auto Save รูปลงเครื่อง</span>
        </label>

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
      </div>

      {/* Create Button */}
      <button className="btn btn-primary w-full" onClick={handleCreate}>
        🖼️ สร้างรูปภาพ
      </button>
    </div>
  )
}

export default ImageTab
