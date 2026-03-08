import { useState } from 'react'
import { type SceneData } from '../hooks/useVideoWorkflow'
import SceneCard from './SceneCard'

interface StoryboardPanelProps {
  scenes: SceneData[]
  onScenesChange: (scenes: SceneData[]) => void
  onGenerateSingle: (sceneIndex: number) => void
  onGenerateImage: (sceneIndex: number, type: 'start' | 'end') => void
  onGenerateVideo: (sceneIndex: number) => void
  onAddToScene: (sceneIndex: number) => void
  onGeneratePreview: () => void
  storyboardPreviewImage?: string | null
  generatingPreview?: boolean
  generatingImage?: string | null
  generatingVideo?: string | null
  isRunning?: boolean
  maxScenes?: number
}

function StoryboardPanel({
  scenes,
  onScenesChange,
  onGenerateSingle,
  onGenerateImage,
  onGenerateVideo,
  onAddToScene,
  onGeneratePreview,
  storyboardPreviewImage,
  generatingPreview,
  generatingImage,
  generatingVideo,
  isRunning,
  maxScenes = 8,
}: StoryboardPanelProps) {
  const [previewModal, setPreviewModal] = useState<{
    isOpen: boolean
    type: 'image' | 'video'
    url: string
    title: string
  } | null>(null)

  const updateScene = (sceneIndex: number, updates: Partial<SceneData>) => {
    onScenesChange(
      scenes.map(s => s.sceneIndex === sceneIndex ? { ...s, ...updates } : s)
    )
  }

  const resetField = (sceneIndex: number, field: 'startFramePrompt' | 'endFramePrompt' | 'videoPrompt' | 'script') => {
    const originalKeyMap: Record<string, keyof SceneData> = {
      startFramePrompt: 'originalStartFramePrompt',
      endFramePrompt: 'originalEndFramePrompt',
      videoPrompt: 'originalVideoPrompt',
      script: 'originalScript',
    }
    const originalKey = originalKeyMap[field]
    const scene = scenes.find(s => s.sceneIndex === sceneIndex)
    if (scene && scene[originalKey] !== undefined) {
      updateScene(sceneIndex, { [field]: scene[originalKey] })
    }
  }

  const addScene = () => {
    if (scenes.length >= maxScenes) return
    const newScene: SceneData = {
      sceneIndex: scenes.length,
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
    }
    onScenesChange([...scenes, newScene])
  }

  const removeScene = (sceneIndex: number) => {
    if (scenes.length <= 2) return
    const filtered = scenes.filter(s => s.sceneIndex !== sceneIndex)
    const reindexed = filtered.map((s, i) => ({ ...s, sceneIndex: i }))
    onScenesChange(reindexed)
  }

  const handleClickThumbnail = (sceneIndex: number, type: 'startFrame' | 'endFrame' | 'video') => {
    const scene = scenes.find(s => s.sceneIndex === sceneIndex)
    if (!scene) return
    if (type === 'startFrame' && scene.startFrameImage) {
      setPreviewModal({ isOpen: true, type: 'image', url: scene.startFrameImage, title: `Scene ${sceneIndex + 1} - Start Frame` })
    } else if (type === 'endFrame' && scene.endFrameImage) {
      setPreviewModal({ isOpen: true, type: 'image', url: scene.endFrameImage, title: `Scene ${sceneIndex + 1} - End Frame` })
    } else if (type === 'video' && scene.videoUrl) {
      setPreviewModal({ isOpen: true, type: 'video', url: scene.videoUrl, title: `Scene ${sceneIndex + 1} - Video` })
    }
  }

  return (
    <div className="space-y-3">
      {/* Storyboard Preview Grid */}
      <div className="flex items-center gap-2">
        <button
          className="btn btn-warning btn-sm gap-1 flex-1"
          onClick={onGeneratePreview}
          disabled={generatingPreview || isRunning}
        >
          {generatingPreview ? '⏳ กำลังสร้าง...' : '🎬 สร้างภาพ Storyboard'}
        </button>
        {storyboardPreviewImage && (
          <div
            className="w-16 h-10 rounded border-2 border-warning cursor-pointer overflow-hidden shrink-0"
            onClick={() => setPreviewModal({ isOpen: true, type: 'image', url: storyboardPreviewImage, title: 'Storyboard Preview' })}
            title="คลิกดูภาพใหญ่"
          >
            <img src={storyboardPreviewImage} alt="Preview" className="w-full h-full object-cover" />
          </div>
        )}
      </div>
      {storyboardPreviewImage && (
        <div className="text-[10px] text-success opacity-70 -mt-2">✅ ใช้ภาพ Storyboard เป็น reference สำหรับทุกฉาก</div>
      )}
      {/* Scene Cards */}
      {scenes.map((scene) => (
        <div key={scene.sceneIndex} className="relative">
          <SceneCard
            scene={scene}
            onUpdate={updateScene}
            onReset={resetField}
            onGenerateSingle={onGenerateSingle}
            onGenerateImage={onGenerateImage}
            onGenerateVideo={onGenerateVideo}
            onAddToScene={onAddToScene}
            onClickThumbnail={handleClickThumbnail}
            generatingImage={generatingImage}
            generatingVideo={generatingVideo}
            isRunning={isRunning}
          />
          {/* Remove button */}
          {scenes.length > 2 && !isRunning && (
            <button
              className="btn btn-ghost btn-xs btn-square text-error absolute -top-1 -right-1 bg-base-100 rounded-full"
              onClick={() => removeScene(scene.sceneIndex)}
              title="ลบฉาก"
            >
              ✕
            </button>
          )}
        </div>
      ))}

      {/* Add Scene Button */}
      {scenes.length < maxScenes && !isRunning && (
        <button className="btn btn-ghost btn-sm w-full" onClick={addScene}>
          + เพิ่มฉาก
        </button>
      )}

      {/* Preview Modal */}
      {previewModal?.isOpen && (
        <div className="modal modal-open" onClick={() => setPreviewModal(null)}>
          <div className="modal-box max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-3">{previewModal.title}</h3>
            {previewModal.type === 'image' ? (
              <img src={previewModal.url} alt="" className="w-full rounded-lg" />
            ) : (
              <video src={previewModal.url} controls autoPlay className="w-full rounded-lg" />
            )}
            <div className="modal-action">
              <button className="btn btn-sm" onClick={() => setPreviewModal(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default StoryboardPanel
