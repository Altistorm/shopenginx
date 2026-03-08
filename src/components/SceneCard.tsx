import { useState } from 'react'
import { type SceneData } from '../hooks/useVideoWorkflow'

interface SceneCardProps {
  scene: SceneData
  onUpdate: (sceneIndex: number, updates: Partial<SceneData>) => void
  onReset: (sceneIndex: number, field: 'startFramePrompt' | 'endFramePrompt' | 'videoPrompt' | 'script') => void
  onGenerateSingle: (sceneIndex: number) => void
  onGenerateImage: (sceneIndex: number, type: 'start' | 'end') => void
  onGenerateVideo: (sceneIndex: number) => void
  onAddToScene: (sceneIndex: number) => void
  onClickThumbnail: (sceneIndex: number, type: 'startFrame' | 'endFrame' | 'video') => void
  generatingImage?: string | null
  generatingVideo?: string | null
  isRunning?: boolean
}

const SCENE_TYPE_CONFIG = {
  hook: { icon: '🎣', label: 'Hook', badgeClass: 'badge-error' },
  story: { icon: '📖', label: 'Story', badgeClass: 'badge-warning' },
  cta: { icon: '📢', label: 'CTA', badgeClass: 'badge-success' },
} as const

interface PromptFieldConfig {
  key: 'startFramePrompt' | 'endFramePrompt' | 'videoPrompt' | 'script'
  originalKey: 'originalStartFramePrompt' | 'originalEndFramePrompt' | 'originalVideoPrompt' | 'originalScript'
  icon: string
  label: string
  colorClass: string
  bgClass: string
  borderClass: string
  rows: number
  placeholder: string
}

const PROMPT_FIELDS: PromptFieldConfig[] = [
  {
    key: 'startFramePrompt',
    originalKey: 'originalStartFramePrompt',
    icon: '🟢',
    label: 'Start Frame',
    colorClass: 'text-success',
    bgClass: 'bg-success/5',
    borderClass: 'border-success',
    rows: 3,
    placeholder: 'Start frame image prompt...',
  },
  {
    key: 'endFramePrompt',
    originalKey: 'originalEndFramePrompt',
    icon: '🔵',
    label: 'End Frame',
    colorClass: 'text-info',
    bgClass: 'bg-info/5',
    borderClass: 'border-info',
    rows: 3,
    placeholder: 'End frame image prompt...',
  },
  {
    key: 'videoPrompt',
    originalKey: 'originalVideoPrompt',
    icon: '🟣',
    label: 'Video Prompt',
    colorClass: 'text-secondary',
    bgClass: 'bg-secondary/5',
    borderClass: 'border-secondary',
    rows: 3,
    placeholder: 'Video action prompt...',
  },
  {
    key: 'script',
    originalKey: 'originalScript',
    icon: '📝',
    label: 'Script',
    colorClass: 'text-base-content/70',
    bgClass: 'bg-base-300',
    borderClass: '',
    rows: 3,
    placeholder: 'บทพูด/narration...',
  },
]

function SceneCard({
  scene,
  onUpdate,
  onReset,
  onGenerateSingle,
  onGenerateImage,
  onGenerateVideo,
  onAddToScene,
  onClickThumbnail,
  generatingImage,
  generatingVideo,
  isRunning,
}: SceneCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [modalField, setModalField] = useState<string | null>(null)
  const typeConfig = SCENE_TYPE_CONFIG[scene.sceneType] || SCENE_TYPE_CONFIG.story

  const isFieldEdited = (field: PromptFieldConfig): boolean => {
    const original = scene[field.originalKey]
    if (original === undefined) return false
    return scene[field.key] !== original
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  // Thumbnail slot component
  const ThumbnailSlot = ({
    type,
    image,
    label,
    colorBorder,
    colorBtn,
    colorSpinner,
    isGenerating,
    isReady,
    onGenerate,
    onClick,
  }: {
    type: 'startFrame' | 'endFrame' | 'video'
    image?: string
    label: string
    colorBorder: string
    colorBtn: string
    colorSpinner: string
    isGenerating: boolean
    isReady: boolean
    onGenerate: () => void
    onClick: () => void
  }) => {
    const hasContent = !!image

    return (
      <div
        className={`relative w-12 h-16 rounded flex items-center justify-center overflow-hidden ${
          hasContent
            ? `border ${colorBorder} cursor-pointer hover:opacity-80`
            : isGenerating
              ? `border ${colorBorder}`
              : 'border border-dashed border-base-content/20'
        }`}
        onClick={() => hasContent ? onClick() : undefined}
      >
        {hasContent ? (
          type === 'video' ? (
            // Video: show play icon only, no inline <video>
            <svg className="w-4 h-4 text-error" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21" />
            </svg>
          ) : (
            <img src={image} alt="" className="w-full h-full object-cover" />
          )
        ) : isGenerating ? (
          <span className={`loading loading-spinner loading-sm ${colorSpinner}`} />
        ) : isReady ? (
          <button
            className={`btn btn-circle btn-xs ${colorBtn}`}
            onClick={(e) => { e.stopPropagation(); onGenerate() }}
            disabled={isRunning}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="white">
              <polygon points="5 3 19 12 5 21" />
            </svg>
          </button>
        ) : (
          <svg className="w-3 h-3 text-base-content/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect width="18" height="11" x="3" y="11" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        )}
        <span className="absolute bottom-0 left-0 right-0 text-[6px] bg-black/50 text-white text-center">
          {label}
        </span>
      </div>
    )
  }

  return (
    <div className="bg-base-200 rounded-xl p-3 space-y-2">
      {/* Top section: thumbnails + metadata */}
      <div className="flex gap-2">
        {/* Thumbnail slots */}
        <div className="flex gap-1 flex-shrink-0">
          <ThumbnailSlot
            type="startFrame"
            image={scene.startFrameImage}
            label="Start"
            colorBorder="border-success"
            colorBtn="btn-success"
            colorSpinner="text-success"
            isGenerating={generatingImage === `start-${scene.sceneIndex}`}
            isReady={true}
            onGenerate={() => onGenerateImage(scene.sceneIndex, 'start')}
            onClick={() => onClickThumbnail(scene.sceneIndex, 'startFrame')}
          />
          {(scene.endFramePrompt?.trim() || scene.endFrameImage) && (
            <ThumbnailSlot
              type="endFrame"
              image={scene.endFrameImage}
              label="End"
              colorBorder="border-info"
              colorBtn="btn-info"
              colorSpinner="text-info"
              isGenerating={generatingImage === `end-${scene.sceneIndex}`}
              isReady={scene.imageCreated}
              onGenerate={() => onGenerateImage(scene.sceneIndex, 'end')}
              onClick={() => onClickThumbnail(scene.sceneIndex, 'endFrame')}
            />
          )}
          <div className="relative">
            <ThumbnailSlot
              type="video"
              image={scene.videoUrl}
              label="Video"
              colorBorder="border-error"
              colorBtn="btn-error"
              colorSpinner="text-error"
              isGenerating={generatingVideo === `video-${scene.sceneIndex}`}
              isReady={scene.imageCreated}
              onGenerate={() => onGenerateVideo(scene.sceneIndex)}
              onClick={() => onClickThumbnail(scene.sceneIndex, 'video')}
            />
            {/* Add to Scene overlay — shown when video exists */}
            {scene.videoCreated && (
              <button
                className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px] transition-colors ${
                  scene.addedToScene
                    ? 'bg-success text-success-content cursor-default'
                    : 'bg-base-300 text-base-content/60 hover:bg-primary hover:text-primary-content cursor-pointer'
                }`}
                onClick={(e) => { e.stopPropagation(); if (!scene.addedToScene) onAddToScene(scene.sceneIndex) }}
                title={scene.addedToScene ? 'Added to Scene' : 'Add to Scene'}
                disabled={isRunning}
              >
                {scene.addedToScene ? '✓' : '🎞️'}
              </button>
            )}
          </div>
        </div>

        {/* Metadata */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-1">
            <span className={`badge badge-sm ${typeConfig.badgeClass}`}>
              {typeConfig.icon} {typeConfig.label}
            </span>
            <span className="text-[10px] text-base-content/40">Scene {scene.sceneIndex + 1}</span>
            <button
              className="btn btn-ghost btn-xs text-secondary ml-auto"
              onClick={() => onGenerateSingle(scene.sceneIndex)}
              disabled={isRunning}
              title="สร้าง Prompt ด้วย AI"
            >
              ✨
            </button>
          </div>
          {scene.description && (
            <p className="text-xs text-base-content/40 leading-tight line-clamp-2">
              {scene.description}
            </p>
          )}
        </div>
      </div>

      {/* Collapsible prompts toggle */}
      <div className="flex items-center gap-1">
        <button
          className="btn btn-ghost btn-xs justify-start gap-1 text-base-content/50"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
          <span className="text-xs">Prompts</span>
        </button>
        {!expanded && (
          <div className="flex items-center gap-0.5">
            {PROMPT_FIELDS.map((field) => {
              const hasData = !!(scene[field.key] as string)?.trim()
              if (!hasData) return null
              return (
                <button
                  key={field.key}
                  className={`btn btn-ghost btn-xs px-1 min-h-0 h-5 ${field.colorClass}`}
                  onClick={() => setModalField(field.key)}
                  title={field.label}
                >
                  {field.icon}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Expanded prompts */}
      {expanded && (
        <div className="space-y-3">
          {PROMPT_FIELDS.map((field) => {
            const value = scene[field.key] as string
            const edited = isFieldEdited(field)

            return (
              <div key={field.key} className={`rounded-lg p-2 ${field.bgClass}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-bold flex items-center gap-1 ${field.colorClass}`}>
                    {field.icon} {field.label}
                    {edited && <span className="badge badge-warning badge-xs">แก้ไขแล้ว</span>}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => copyToClipboard(value)}
                      title="Copy"
                    >
                      📋
                    </button>
                    {edited && (
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => onReset(scene.sceneIndex, field.key)}
                        title="Reset to original"
                      >
                        ↺
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  className={`textarea textarea-bordered w-full text-sm ${field.borderClass}`}
                  rows={value?.trim() ? field.rows * 2 : field.rows}
                  placeholder={field.placeholder}
                  value={value}
                  onChange={(e) => onUpdate(scene.sceneIndex, { [field.key]: e.target.value })}
                  disabled={isRunning}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Prompt edit modal — opened by clicking icon in collapsed state */}
      {modalField && (() => {
        const field = PROMPT_FIELDS.find(f => f.key === modalField)
        if (!field) return null
        const value = scene[field.key] as string
        const edited = isFieldEdited(field)
        return (
          <div className="modal modal-open" onClick={() => setModalField(null)}>
            <div className="modal-box max-w-lg" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <span className={`text-sm font-bold flex items-center gap-1 ${field.colorClass}`}>
                  {field.icon} {field.label} — Scene {scene.sceneIndex + 1}
                  {edited && <span className="badge badge-warning badge-xs ml-1">แก้ไขแล้ว</span>}
                </span>
                <div className="flex items-center gap-1">
                  <button className="btn btn-ghost btn-xs" onClick={() => copyToClipboard(value)} title="Copy">
                    📋
                  </button>
                  {edited && (
                    <button className="btn btn-ghost btn-xs" onClick={() => onReset(scene.sceneIndex, field.key)} title="Reset">
                      ↺
                    </button>
                  )}
                </div>
              </div>
              <textarea
                className={`textarea textarea-bordered w-full text-sm ${field.borderClass}`}
                rows={8}
                placeholder={field.placeholder}
                value={value}
                onChange={e => onUpdate(scene.sceneIndex, { [field.key]: e.target.value })}
                disabled={isRunning}
                autoFocus
              />
              <div className="modal-action">
                <button className="btn btn-sm" onClick={() => setModalField(null)}>ปิด</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default SceneCard
