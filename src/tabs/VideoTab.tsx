import { useState } from 'react'

function VideoTab() {
  const [productImage, setProductImage] = useState<string | null>(null)
  const [style, setStyle] = useState('cgi_style')
  const [productName, setProductName] = useState('')
  const [modelType, setModelType] = useState('from_image')
  const [ctaType, setCtaType] = useState('close_sale')
  const [voiceGender, setVoiceGender] = useState('female')

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        setProductImage(event.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  return (
    <div className="space-y-4">
      {/* Image Upload */}
      <div className="form-control">
        <label className="label">
          <span className="label-text select-text">📷 รูปสินค้า <span className="text-error">*</span></span>
        </label>
        <div
          className="border-2 border-dashed border-primary/30 rounded-xl p-6 text-center cursor-pointer hover:border-primary/60 transition-colors"
          onClick={() => document.getElementById('videoImageInput')?.click()}
        >
          {productImage ? (
            <img src={productImage} alt="Product" className="max-h-32 mx-auto rounded-lg" />
          ) : (
            <div className="text-base-content/50">
              <span className="text-3xl">📷</span>
              <p className="mt-2">คลิกเพื่ออัพโหลดรูปสินค้า</p>
            </div>
          )}
        </div>
        <input
          id="videoImageInput"
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={handleImageUpload}
        />
      </div>

      {/* Style + Product Name */}
      <div className="grid grid-cols-2 gap-3">
        <div className="form-control">
          <label className="label">
            <span className="label-text select-text">🎨 สไตล์</span>
          </label>
          <select
            className="select select-bordered select-sm"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
          >
            <option value="cgi_style">CGI สมจริง</option>
            <option value="ugc">UGC รีวิว</option>
            <option value="hands_only">เห็นมืออย่างเดียว</option>
            <option value="lifestyle">Lifestyle</option>
            <option value="studio">Studio</option>
            <option value="outdoor">Outdoor</option>
          </select>
        </div>
        <div className="form-control">
          <label className="label">
            <span className="label-text select-text">🏷️ ชื่อสินค้า</span>
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

      {/* Model + CTA */}
      <div className="grid grid-cols-2 gap-3">
        <div className="form-control">
          <label className="label">
            <span className="label-text select-text">👤 นายแบบ/นางแบบ</span>
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
        <div className="form-control">
          <label className="label">
            <span className="label-text select-text">📢 CTA</span>
          </label>
          <select
            className="select select-bordered select-sm"
            value={ctaType}
            onChange={(e) => setCtaType(e.target.value)}
          >
            <option value="close_sale">ปิดการขาย</option>
            <option value="add_follower">เพิ่มผู้ติดตาม</option>
          </select>
        </div>
      </div>

      {/* Voice */}
      <div className="form-control">
        <label className="label">
          <span className="label-text select-text">🗣️ เสียงพูด</span>
        </label>
        <select
          className="select select-bordered select-sm"
          value={voiceGender}
          onChange={(e) => setVoiceGender(e.target.value)}
        >
          <option value="female">ผู้หญิง</option>
          <option value="male">ผู้ชาย</option>
          <option value="none">ไม่มีเสียง</option>
        </select>
      </div>

      {/* Create Button */}
      <button className="btn btn-primary w-full">
        🎬 สร้างวิดีโอ
      </button>
    </div>
  )
}

export default VideoTab
