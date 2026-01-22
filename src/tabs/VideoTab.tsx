import { useState, useEffect } from 'react'

interface VideoProgressEvent {
  step: string;
  attempt: number;
  maxAttempts: number;
  status: 'running' | 'success' | 'retrying' | 'failed';
  promptIndex?: number;
  totalPrompts?: number;
  error?: string;
}

function VideoTab() {
  // Form state
  const [startFrameImage, setStartFrameImage] = useState<string | null>(null)
  const [prompts, setPrompts] = useState<string[]>([''])
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>('9:16')
  const [autoDownload, setAutoDownload] = useState(true)

  // Workflow state
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<VideoProgressEvent | null>(null)
  const [result, setResult] = useState<{ success: boolean; error?: string; completedPrompts?: number } | null>(null)

  // Listen for progress updates
  useEffect(() => {
    const handleMessage = (message: { type: string } & VideoProgressEvent) => {
      if (message.type === 'VIDEO_PROGRESS') {
        setProgress(message)
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)
    return () => chrome.runtime.onMessage.removeListener(handleMessage)
  }, [])

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        setStartFrameImage(event.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handlePromptChange = (index: number, value: string) => {
    const newPrompts = [...prompts]
    newPrompts[index] = value
    setPrompts(newPrompts)
  }

  const addExtensionPrompt = () => {
    setPrompts([...prompts, ''])
  }

  const removePrompt = (index: number) => {
    if (prompts.length > 1) {
      const newPrompts = prompts.filter((_, i) => i !== index)
      setPrompts(newPrompts)
    }
  }

  const handleStart = async () => {
    // Validate
    const validPrompts = prompts.filter(p => p.trim())
    if (validPrompts.length === 0) {
      alert('Please enter at least one prompt')
      return
    }

    setIsRunning(true)
    setProgress(null)
    setResult(null)

    try {
      // Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) {
        throw new Error('No active tab found')
      }

      // Check if on Google Flow
      if (!tab.url?.includes('labs.google/fx/tools/flow')) {
        throw new Error('Please navigate to Google Flow first (labs.google/fx/tools/flow)')
      }

      // Send message to content script
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'START_VIDEO_WORKFLOW',
        image: startFrameImage,
        prompts: validPrompts,
        aspectRatio,
        autoDownload,
      })

      setResult(response)
    } catch (error) {
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
        await chrome.tabs.sendMessage(tab.id, { type: 'STOP_VIDEO_WORKFLOW' })
      }
    } catch (error) {
      console.error('Failed to stop workflow:', error)
    }
    setIsRunning(false)
    setProgress(null)
  }

  const getStepDisplayName = (step: string): string => {
    const names: Record<string, string> = {
      ensureVideoMode: 'Setting video mode',
      configureSettings: 'Configuring settings',
      uploadImage: 'Uploading start frame',
      fillPrompt: 'Filling prompt',
      clickCreate: 'Starting generation',
      waitForInitialComplete: 'Generating video',
      clickAddToScene: 'Adding to scene',
      enterExtendMode: 'Entering extend mode',
      fillExtensionPrompt: 'Filling extension prompt',
      waitForExtensionComplete: 'Generating extension',
      downloadVideo: 'Downloading video',
    }
    return names[step] || step
  }

  return (
    <div className="space-y-4">
      {/* Start Frame Image */}
      <div className="form-control">
        <label className="label">
          <span className="label-text select-text">Start Frame (Optional)</span>
        </label>
        <div
          className="border-2 border-dashed border-primary/30 rounded-xl p-4 text-center cursor-pointer hover:border-primary/60 transition-colors"
          onClick={() => document.getElementById('videoStartFrameInput')?.click()}
        >
          {startFrameImage ? (
            <div className="relative">
              <img src={startFrameImage} alt="Start Frame" className="max-h-24 mx-auto rounded-lg" />
              <button
                className="btn btn-xs btn-circle btn-error absolute top-0 right-0 -mt-2 -mr-2"
                onClick={(e) => {
                  e.stopPropagation()
                  setStartFrameImage(null)
                }}
              >
                x
              </button>
            </div>
          ) : (
            <div className="text-base-content/50">
              <span className="text-2xl">🖼️</span>
              <p className="mt-1 text-sm">Click to upload start frame</p>
            </div>
          )}
        </div>
        <input
          id="videoStartFrameInput"
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={handleImageUpload}
          disabled={isRunning}
        />
      </div>

      {/* Prompts */}
      <div className="form-control">
        <label className="label">
          <span className="label-text select-text">Prompts <span className="text-error">*</span></span>
          <span className="label-text-alt text-base-content/50">
            {prompts.length > 1 ? `${prompts.length} clips` : '1 clip'}
          </span>
        </label>
        <div className="space-y-2">
          {prompts.map((prompt, index) => (
            <div key={index} className="flex gap-2">
              <div className="flex-1">
                <textarea
                  className="textarea textarea-bordered w-full text-sm"
                  rows={2}
                  placeholder={index === 0 ? "Initial video prompt..." : `Extension ${index}: What happens next?`}
                  value={prompt}
                  onChange={(e) => handlePromptChange(index, e.target.value)}
                  disabled={isRunning}
                />
                {index === 0 && (
                  <div className="text-xs text-base-content/50 mt-1">
                    Initial generation (~8s video)
                  </div>
                )}
                {index > 0 && (
                  <div className="text-xs text-base-content/50 mt-1">
                    Extension {index} (+7s each)
                  </div>
                )}
              </div>
              {prompts.length > 1 && (
                <button
                  className="btn btn-ghost btn-sm btn-square text-error"
                  onClick={() => removePrompt(index)}
                  disabled={isRunning}
                >
                  x
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          className="btn btn-ghost btn-sm mt-2"
          onClick={addExtensionPrompt}
          disabled={isRunning}
        >
          + Add Extension
        </button>
      </div>

      {/* Settings Row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="form-control">
          <label className="label">
            <span className="label-text select-text">Aspect Ratio</span>
          </label>
          <select
            className="select select-bordered select-sm"
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as '9:16' | '16:9')}
            disabled={isRunning}
          >
            <option value="9:16">Portrait (9:16)</option>
            <option value="16:9">Landscape (16:9)</option>
          </select>
        </div>
        <div className="form-control">
          <label className="label cursor-pointer">
            <span className="label-text select-text">Auto Download</span>
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-sm"
              checked={autoDownload}
              onChange={(e) => setAutoDownload(e.target.checked)}
              disabled={isRunning}
            />
          </label>
        </div>
      </div>

      {/* Progress Display */}
      {progress && (
        <div className="alert alert-info">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {progress.status === 'running' && <span className="loading loading-spinner loading-sm"></span>}
              {progress.status === 'success' && <span>✓</span>}
              {progress.status === 'retrying' && <span>⟳</span>}
              {progress.status === 'failed' && <span>✗</span>}
              <span className="font-medium">{getStepDisplayName(progress.step)}</span>
            </div>
            {progress.totalPrompts && progress.totalPrompts > 1 && (
              <div className="text-sm mt-1">
                Clip {(progress.promptIndex ?? 0) + 1} of {progress.totalPrompts}
              </div>
            )}
            {progress.status === 'retrying' && (
              <div className="text-sm mt-1 text-warning">
                Attempt {progress.attempt} of {progress.maxAttempts}
              </div>
            )}
            {progress.error && (
              <div className="text-sm mt-1 text-error">{progress.error}</div>
            )}
          </div>
        </div>
      )}

      {/* Result Display */}
      {result && !isRunning && (
        <div className={`alert ${result.success ? 'alert-success' : 'alert-error'}`}>
          <div>
            {result.success ? (
              <span>Video created successfully! ({result.completedPrompts} clips)</span>
            ) : (
              <span>Failed: {result.error}</span>
            )}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {isRunning ? (
        <button className="btn btn-error w-full" onClick={handleStop}>
          Stop
        </button>
      ) : (
        <button
          className="btn btn-primary w-full"
          onClick={handleStart}
          disabled={prompts.every(p => !p.trim())}
        >
          Create Video
        </button>
      )}

      {/* Duration Estimate */}
      {!isRunning && prompts.filter(p => p.trim()).length > 0 && (
        <div className="text-center text-sm text-base-content/50">
          Estimated duration: ~{8 + (prompts.filter(p => p.trim()).length - 1) * 7}s
        </div>
      )}
    </div>
  )
}

export default VideoTab
