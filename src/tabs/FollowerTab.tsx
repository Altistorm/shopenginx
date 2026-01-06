import { useState, useEffect, useRef, useCallback } from 'react'
import {
  TikTokConfig,
  TikTokState,
  TikTokFollowWorkflow,
  DEFAULT_CONFIG,
  INITIAL_STATE,
  loadConfig,
  saveConfig,
  loadState,
  saveState
} from '../tiktokWorkflow'

interface PlatformConfig {
  enabled: boolean
  username: string
  targetFollowers: number
}

// Keywords Modal Component
function KeywordsModal({
  isOpen,
  keywords,
  onSave,
  onClose
}: {
  isOpen: boolean
  keywords: string[]
  onSave: (keywords: string[]) => void
  onClose: () => void
}) {
  const [localKeywords, setLocalKeywords] = useState<string[]>(keywords)
  const [newKeyword, setNewKeyword] = useState('')

  useEffect(() => {
    setLocalKeywords(keywords)
  }, [keywords, isOpen])

  const addKeyword = () => {
    if (newKeyword.trim() && !localKeywords.includes(newKeyword.trim())) {
      setLocalKeywords([...localKeywords, newKeyword.trim()])
      setNewKeyword('')
    }
  }

  const removeKeyword = (index: number) => {
    setLocalKeywords(localKeywords.filter((_, i) => i !== index))
  }

  if (!isOpen) return null

  return (
    <div className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg mb-4">Filter Keywords</h3>
        <p className="text-sm opacity-70 mb-4">
          Only follow users whose name contains at least one of these keywords
        </p>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Add keyword..."
            className="input input-bordered input-sm flex-1"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
          />
          <button className="btn btn-primary btn-sm" onClick={addKeyword}>
            Add
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-4 max-h-40 overflow-y-auto">
          {localKeywords.map((keyword, index) => (
            <span key={index} className="badge badge-lg gap-1">
              {keyword}
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => removeKeyword(index)}
              >
                ×
              </button>
            </span>
          ))}
          {localKeywords.length === 0 && (
            <span className="text-sm opacity-50">No keywords added</span>
          )}
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onSave(localKeywords)
              onClose()
            }}
          >
            Save
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose}></div>
    </div>
  )
}

// Helper function to safely decode URL for display
function decodeUrlForDisplay(url: string): string {
  try {
    return decodeURIComponent(url)
  } catch {
    return url // Return original if decoding fails
  }
}

// URL List Modal Component
function UrlListModal({
  isOpen,
  urls,
  onSave,
  onClose
}: {
  isOpen: boolean
  urls: string[]
  onSave: (urls: string[]) => void
  onClose: () => void
}) {
  const [localUrls, setLocalUrls] = useState<string[]>(urls)
  const [newUrl, setNewUrl] = useState('')

  useEffect(() => {
    setLocalUrls(urls)
  }, [urls, isOpen])

  const addUrl = () => {
    if (newUrl.trim() && !localUrls.includes(newUrl.trim())) {
      setLocalUrls([...localUrls, newUrl.trim()])
      setNewUrl('')
    }
  }

  const removeUrl = (index: number) => {
    setLocalUrls(localUrls.filter((_, i) => i !== index))
  }

  const moveUp = (index: number) => {
    if (index > 0) {
      const newUrls = [...localUrls]
      ;[newUrls[index - 1], newUrls[index]] = [newUrls[index], newUrls[index - 1]]
      setLocalUrls(newUrls)
    }
  }

  const moveDown = (index: number) => {
    if (index < localUrls.length - 1) {
      const newUrls = [...localUrls]
      ;[newUrls[index], newUrls[index + 1]] = [newUrls[index + 1], newUrls[index]]
      setLocalUrls(newUrls)
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl">
        <h3 className="font-bold text-lg mb-4">Search URLs</h3>
        <p className="text-sm opacity-70 mb-4">
          URLs will be rotated after reaching cycle threshold
        </p>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Add TikTok search URL..."
            className="input input-bordered input-sm flex-1"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addUrl()}
          />
          <button className="btn btn-primary btn-sm" onClick={addUrl}>
            Add
          </button>
        </div>

        <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
          {localUrls.map((url, index) => (
            <div key={index} className="bg-base-200 p-2 rounded">
              <div className="flex items-start gap-2">
                <span className="badge badge-sm flex-shrink-0">{index + 1}</span>
                <span className="text-xs flex-1 break-all select-text">
                  {decodeUrlForDisplay(url)}
                </span>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => moveUp(index)}
                    disabled={index === 0}
                  >
                    ↑
                  </button>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => moveDown(index)}
                    disabled={index === localUrls.length - 1}
                  >
                    ↓
                  </button>
                  <button
                    className="btn btn-ghost btn-xs text-error"
                    onClick={() => removeUrl(index)}
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          ))}
          {localUrls.length === 0 && (
            <span className="text-sm opacity-50">No URLs added</span>
          )}
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onSave(localUrls)
              onClose()
            }}
          >
            Save
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose}></div>
    </div>
  )
}

function FollowerTab() {
  // TikTok state and config
  const [tiktokConfig, setTiktokConfig] = useState<TikTokConfig>(DEFAULT_CONFIG)
  const [tiktokState, setTiktokState] = useState<TikTokState>(INITIAL_STATE)
  const [showKeywordsModal, setShowKeywordsModal] = useState(false)
  const [showUrlsModal, setShowUrlsModal] = useState(false)
  const workflowRef = useRef<TikTokFollowWorkflow | null>(null)

  // Other platforms
  const [facebook, setFacebook] = useState<PlatformConfig>({
    enabled: false,
    username: '',
    targetFollowers: 1000
  })
  const [youtube, setYoutube] = useState<PlatformConfig>({
    enabled: false,
    username: '',
    targetFollowers: 1000
  })

  // Load config and state on mount
  useEffect(() => {
    const loadData = async () => {
      const [config, state] = await Promise.all([loadConfig(), loadState()])
      setTiktokConfig(config)
      setTiktokState(state)
    }
    loadData()
  }, [])

  // Update config handler
  const updateConfig = useCallback((updates: Partial<TikTokConfig>) => {
    setTiktokConfig(prev => {
      const newConfig = { ...prev, ...updates }
      saveConfig(newConfig)
      if (workflowRef.current) {
        workflowRef.current.updateConfig(updates)
      }
      return newConfig
    })
  }, [])

  // Handle state changes from workflow
  const handleStateChange = useCallback((newState: TikTokState) => {
    console.log('[FollowerTab] handleStateChange received:', { skipCount: newState.skipCount, status: newState.status })
    setTiktokState(newState)
  }, [])

  // Start workflow
  const startWorkflow = useCallback(() => {
    if (workflowRef.current?.getState().isRunning) return

    workflowRef.current = new TikTokFollowWorkflow(
      tiktokConfig,
      { ...INITIAL_STATE },
      handleStateChange
    )
    workflowRef.current.start()
  }, [tiktokConfig, handleStateChange])

  // Stop workflow
  const stopWorkflow = useCallback(() => {
    workflowRef.current?.stop()
  }, [])

  // Reset state - also stops workflow if running
  const resetState = useCallback(() => {
    workflowRef.current?.stop()
    workflowRef.current = null
    const newState = { ...INITIAL_STATE }
    setTiktokState(newState)
    saveState(newState)
  }, [])

  // Format remaining time
  const formatRemainingTime = (timestamp: number | null): string => {
    if (!timestamp) return ''
    const remaining = timestamp - Date.now()
    if (remaining <= 0) return 'Resuming...'
    const minutes = Math.floor(remaining / 60000)
    const seconds = Math.floor((remaining % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }

  return (
    <div className="space-y-4">
      {/* TikTok Section */}
      <div className="collapse collapse-arrow bg-base-300 collapse-open">
        <input type="checkbox" defaultChecked />
        <div className="collapse-title font-medium flex items-center gap-2">
          <span className="text-lg">🎵</span>
          <span>TikTok Auto-Follow</span>
          {tiktokState.isRunning && (
            <span className="badge badge-success badge-sm ml-auto mr-4">Running</span>
          )}
          {tiktokState.isPaused && (
            <span className="badge badge-warning badge-sm ml-auto mr-4">Paused</span>
          )}
        </div>
        <div className="collapse-content space-y-4">
          {/* Status Display */}
          {(tiktokState.isRunning || tiktokState.isPaused) && (
            <div className="bg-base-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`badge ${tiktokState.isPaused ? 'badge-warning' : 'badge-success'}`}>
                  {tiktokState.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>Followed: <span className="font-bold text-success">{tiktokState.followCount}</span></div>
                <div>Checked: <span className="font-bold">{tiktokState.profilesChecked}</span></div>
                <div>Skipped: <span className="font-bold text-warning">{tiktokState.skipCount}/{tiktokConfig.skipThreshold}</span></div>
                <div>Cycle: <span className="font-bold">{tiktokState.cycleCount}/{tiktokConfig.cycleThreshold}</span></div>
                <div>URL: <span className="font-bold">{tiktokState.currentUrlIndex + 1}/{tiktokConfig.urls.length}</span></div>
              </div>
              {tiktokState.isPaused && tiktokState.nextResumeTime && (
                <div className="text-sm text-warning">
                  Resume in: {formatRemainingTime(tiktokState.nextResumeTime)}
                </div>
              )}
              {tiktokState.lastError && (
                <div className="text-sm text-error">{tiktokState.lastError}</div>
              )}
            </div>
          )}

          {/* Control Buttons */}
          <div className="flex gap-2">
            {!tiktokState.isRunning ? (
              <button className="btn btn-primary btn-sm flex-1" onClick={startWorkflow}>
                Start Auto-Follow
              </button>
            ) : (
              <button className="btn btn-error btn-sm flex-1" onClick={stopWorkflow}>
                Stop
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={resetState}
            >
              Reset
            </button>
          </div>

          {/* Configuration */}
          <div className="divider text-xs opacity-50">Configuration</div>

          {/* Max Followers */}
          <div className="form-control">
            <label className="label">
              <span className="label-text text-sm">Max Followers</span>
              <span className="label-text-alt">{tiktokConfig.maxFollowers.toLocaleString()}</span>
            </label>
            <input
              type="number"
              className="input input-bordered input-sm"
              value={tiktokConfig.maxFollowers}
              onChange={(e) => updateConfig({ maxFollowers: Number(e.target.value) })}
              disabled={tiktokState.isRunning}
            />
          </div>

          {/* Keywords */}
          <div className="form-control">
            <label className="label">
              <span className="label-text text-sm">Filter Keywords</span>
              <span className="label-text-alt">{tiktokConfig.keywords.length} keywords</span>
            </label>
            <div className="flex flex-wrap gap-1 mb-2">
              {tiktokConfig.keywords.slice(0, 4).map((kw, i) => (
                <span key={i} className="badge badge-sm">{kw}</span>
              ))}
              {tiktokConfig.keywords.length > 4 && (
                <span className="badge badge-sm badge-ghost">+{tiktokConfig.keywords.length - 4} more</span>
              )}
            </div>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setShowKeywordsModal(true)}
              disabled={tiktokState.isRunning}
            >
              Edit Keywords
            </button>
          </div>

          {/* Delay Settings */}
          <div className="grid grid-cols-2 gap-3">
            <div className="form-control">
              <label className="label">
                <span className="label-text text-sm">Min Delay (s)</span>
              </label>
              <input
                type="number"
                step="0.1"
                className="input input-bordered input-sm"
                value={tiktokConfig.minDelay}
                onChange={(e) => updateConfig({ minDelay: Number(e.target.value) })}
                disabled={tiktokState.isRunning}
              />
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text text-sm">Max Delay (s)</span>
              </label>
              <input
                type="number"
                step="0.1"
                className="input input-bordered input-sm"
                value={tiktokConfig.maxDelay}
                onChange={(e) => updateConfig({ maxDelay: Number(e.target.value) })}
                disabled={tiktokState.isRunning}
              />
            </div>
          </div>

          {/* Threshold Settings */}
          <div className="grid grid-cols-2 gap-3">
            <div className="form-control">
              <label className="label">
                <span className="label-text text-sm">Skip Threshold</span>
              </label>
              <input
                type="number"
                className="input input-bordered input-sm"
                value={tiktokConfig.skipThreshold}
                onChange={(e) => updateConfig({ skipThreshold: Number(e.target.value) })}
                disabled={tiktokState.isRunning}
              />
              <label className="label">
                <span className="label-text-alt">Reload page after N skips</span>
              </label>
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text text-sm">Cycle Threshold</span>
              </label>
              <input
                type="number"
                className="input input-bordered input-sm"
                value={tiktokConfig.cycleThreshold}
                onChange={(e) => updateConfig({ cycleThreshold: Number(e.target.value) })}
                disabled={tiktokState.isRunning}
              />
              <label className="label">
                <span className="label-text-alt">Switch URL after N reloads</span>
              </label>
            </div>
          </div>

          {/* Wait Time Settings */}
          <div className="grid grid-cols-2 gap-3">
            <div className="form-control">
              <label className="label">
                <span className="label-text text-sm">Wait Min (min)</span>
              </label>
              <input
                type="number"
                className="input input-bordered input-sm"
                value={tiktokConfig.waitTimeMin}
                onChange={(e) => updateConfig({ waitTimeMin: Number(e.target.value) })}
                disabled={tiktokState.isRunning}
              />
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text text-sm">Wait Max (min)</span>
              </label>
              <input
                type="number"
                className="input input-bordered input-sm"
                value={tiktokConfig.waitTimeMax}
                onChange={(e) => updateConfig({ waitTimeMax: Number(e.target.value) })}
                disabled={tiktokState.isRunning}
              />
            </div>
          </div>

          {/* URL List */}
          <div className="form-control">
            <label className="label">
              <span className="label-text text-sm">Search URLs</span>
              <span className="label-text-alt">{tiktokConfig.urls.length} URLs</span>
            </label>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setShowUrlsModal(true)}
              disabled={tiktokState.isRunning}
            >
              Manage URLs
            </button>
          </div>
        </div>
      </div>

      {/* Facebook Section */}
      <div className="collapse collapse-arrow bg-base-300">
        <input
          type="checkbox"
          checked={facebook.enabled}
          onChange={(e) => setFacebook({ ...facebook, enabled: e.target.checked })}
        />
        <div className="collapse-title font-medium flex items-center gap-2">
          <span className="text-lg">📘</span>
          <span>Facebook</span>
          {facebook.enabled && (
            <span className="badge badge-success badge-sm ml-auto mr-4">Active</span>
          )}
        </div>
        <div className="collapse-content space-y-3">
          <div className="form-control">
            <label className="label">
              <span className="label-text text-sm">Page/Profile URL</span>
            </label>
            <input
              type="text"
              placeholder="https://facebook.com/..."
              className="input input-bordered input-sm"
              value={facebook.username}
              onChange={(e) => setFacebook({ ...facebook, username: e.target.value })}
            />
          </div>
          <div className="form-control">
            <label className="label">
              <span className="label-text text-sm">Target Followers</span>
            </label>
            <input
              type="number"
              placeholder="1000"
              className="input input-bordered input-sm"
              value={facebook.targetFollowers}
              onChange={(e) => setFacebook({ ...facebook, targetFollowers: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>

      {/* YouTube Section */}
      <div className="collapse collapse-arrow bg-base-300">
        <input
          type="checkbox"
          checked={youtube.enabled}
          onChange={(e) => setYoutube({ ...youtube, enabled: e.target.checked })}
        />
        <div className="collapse-title font-medium flex items-center gap-2">
          <span className="text-lg">🎬</span>
          <span>YouTube</span>
          {youtube.enabled && (
            <span className="badge badge-success badge-sm ml-auto mr-4">Active</span>
          )}
        </div>
        <div className="collapse-content space-y-3">
          <div className="form-control">
            <label className="label">
              <span className="label-text text-sm">Channel URL</span>
            </label>
            <input
              type="text"
              placeholder="https://youtube.com/@..."
              className="input input-bordered input-sm"
              value={youtube.username}
              onChange={(e) => setYoutube({ ...youtube, username: e.target.value })}
            />
          </div>
          <div className="form-control">
            <label className="label">
              <span className="label-text text-sm">Target Subscribers</span>
            </label>
            <input
              type="number"
              placeholder="1000"
              className="input input-bordered input-sm"
              value={youtube.targetFollowers}
              onChange={(e) => setYoutube({ ...youtube, targetFollowers: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-base-300 rounded-xl p-3">
        <div className="text-sm font-medium mb-2">Active Platforms</div>
        <div className="flex flex-wrap gap-2">
          {!tiktokState.isRunning && !facebook.enabled && !youtube.enabled && (
            <span className="text-xs opacity-60">No platforms active</span>
          )}
          {tiktokState.isRunning && (
            <span className="badge badge-primary gap-1">
              🎵 TikTok
            </span>
          )}
          {facebook.enabled && (
            <span className="badge badge-primary gap-1">
              📘 Facebook
            </span>
          )}
          {youtube.enabled && (
            <span className="badge badge-primary gap-1">
              🎬 YouTube
            </span>
          )}
        </div>
      </div>

      {/* Modals */}
      <KeywordsModal
        isOpen={showKeywordsModal}
        keywords={tiktokConfig.keywords}
        onSave={(keywords) => updateConfig({ keywords })}
        onClose={() => setShowKeywordsModal(false)}
      />
      <UrlListModal
        isOpen={showUrlsModal}
        urls={tiktokConfig.urls}
        onSave={(urls) => updateConfig({ urls })}
        onClose={() => setShowUrlsModal(false)}
      />
    </div>
  )
}

export default FollowerTab
