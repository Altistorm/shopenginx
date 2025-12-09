import { useState } from 'react'

interface ProductSet {
  id: string
  productImage: string | null
  modelImage: string | null
  productName: string
}

function AutoTab() {
  const [sets, setSets] = useState<ProductSet[]>([
    { id: '1', productImage: null, modelImage: null, productName: '' }
  ])
  const [isRunning, setIsRunning] = useState(false)

  const addSet = () => {
    if (sets.length < 10) {
      setSets([...sets, {
        id: Date.now().toString(),
        productImage: null,
        modelImage: null,
        productName: ''
      }])
    }
  }

  const removeSet = (id: string) => {
    if (sets.length > 1) {
      setSets(sets.filter(s => s.id !== id))
    }
  }

  return (
    <div className="space-y-4">
      {/* Collapsible sections */}
      <div className="collapse collapse-arrow bg-base-300">
        <input type="checkbox" defaultChecked />
        <div className="collapse-title font-medium">
          ⚙️ ตั้งค่าพื้นฐาน
        </div>
        <div className="collapse-content space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="form-control">
              <label className="label">
                <span className="label-text text-sm">🖼️ จำนวนภาพ</span>
              </label>
              <select className="select select-bordered select-sm">
                <option value="1">1 ภาพ</option>
                <option value="2">2 ภาพ</option>
                <option value="3">3 ภาพ</option>
                <option value="4">4 ภาพ ⭐</option>
              </select>
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text text-sm">👤 นายแบบ/นางแบบ</span>
              </label>
              <select className="select select-bordered select-sm">
                <option value="from_image">ใช้จากรูป</option>
                <option value="female">นางแบบ</option>
                <option value="male">นายแบบ</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Product Sets */}
      <div className="bg-base-300 rounded-xl p-3">
        <div className="flex items-center justify-between mb-3">
          <span className="font-medium">📦 ชุดสินค้า ({sets.length}/10)</span>
          <button
            className="btn btn-primary btn-xs"
            onClick={addSet}
            disabled={sets.length >= 10}
          >
            + เพิ่มชุด
          </button>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {sets.map((set, index) => (
            <div key={set.id} className="bg-base-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-primary">📦 ชุดที่ {index + 1}</span>
                {sets.length > 1 && (
                  <button
                    className="btn btn-ghost btn-xs text-error"
                    onClick={() => removeSet(set.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="flex gap-2 mb-2">
                <div className="flex-1 h-16 border-2 border-dashed border-primary/30 rounded flex flex-col items-center justify-center text-xs cursor-pointer hover:border-primary/60">
                  <span>📷</span>
                  <span>สินค้า</span>
                </div>
                <div className="flex-1 h-16 border-2 border-dashed border-secondary/30 rounded flex flex-col items-center justify-center text-xs cursor-pointer hover:border-secondary/60">
                  <span>👤</span>
                  <span>นางแบบ</span>
                </div>
              </div>
              <input
                type="text"
                placeholder="ชื่อสินค้า (ไม่บังคับ)"
                className="input input-bordered input-xs w-full"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Start Button */}
      <button
        className={`btn w-full ${isRunning ? 'btn-warning' : 'btn-success'}`}
        onClick={() => setIsRunning(!isRunning)}
      >
        {isRunning ? (
          <>
            <span className="loading loading-spinner loading-sm"></span>
            กำลังทำงาน... กดเพื่อหยุด
          </>
        ) : (
          <>🚀 เริ่ม Auto</>
        )}
      </button>

      {/* Status Log */}
      {isRunning && (
        <div className="bg-base-300 rounded-xl p-3">
          <div className="text-sm font-medium mb-2">📋 Activity Log</div>
          <div className="text-xs space-y-1 max-h-32 overflow-y-auto font-mono">
            <div className="text-warning">⏳ กำลังประมวลผลชุดที่ 1...</div>
            <div className="text-info">📤 อัพโหลดรูปสินค้า</div>
            <div className="text-success">✅ สร้างภาพสำเร็จ</div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AutoTab
