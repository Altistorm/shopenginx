import { useState, useEffect } from 'react'
import { type AISettings, type AIProvider, loadAISettings, saveAISettings } from '../ai'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

const GEMINI_MODELS = [
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (เร็ว)' },
  { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite (เร็วมาก)' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (แม่นยำ)' },
]

const OPENAI_MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini (เร็ว/ถูก)' },
  { value: 'gpt-4o', label: 'GPT-4o (แม่นยำ)' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
]

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<AISettings>({
    geminiApiKey: '',
    geminiModel: 'gemini-2.0-flash',
    openaiApiKey: '',
    openaiModel: 'gpt-4o-mini',
    provider: 'auto',
  })
  const [saving, setSaving] = useState(false)
  const [showGeminiKey, setShowGeminiKey] = useState(false)
  const [showOpenAIKey, setShowOpenAIKey] = useState(false)

  useEffect(() => {
    if (open) {
      loadAISettings().then(setSettings)
    }
  }, [open])

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveAISettings(settings)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-w-md">
        <h3 className="font-bold text-lg mb-4">⚙️ ตั้งค่า AI</h3>

        {/* Provider selector */}
        <div className="form-control mb-4">
          <label className="label py-1">
            <span className="label-text text-sm font-medium">🤖 AI Provider</span>
          </label>
          <select
            className="select select-bordered select-sm"
            value={settings.provider}
            onChange={(e) => setSettings(s => ({ ...s, provider: e.target.value as AIProvider }))}
          >
            <option value="auto">Auto (ใช้ตัวที่มี, fallback อัตโนมัติ)</option>
            <option value="gemini">Gemini เท่านั้น</option>
            <option value="openai">OpenAI เท่านั้น</option>
          </select>
        </div>

        <div className="divider text-xs">Google Gemini</div>

        {/* Gemini API Key */}
        <div className="form-control mb-2">
          <label className="label py-1">
            <span className="label-text text-sm">Gemini API Key</span>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="label-text-alt link link-primary text-xs"
            >
              รับ Key ฟรี
            </a>
          </label>
          <div className="join w-full">
            <input
              type={showGeminiKey ? 'text' : 'password'}
              placeholder="AIza..."
              className="input input-bordered input-sm join-item flex-1"
              value={settings.geminiApiKey}
              onChange={(e) => setSettings(s => ({ ...s, geminiApiKey: e.target.value.trim() }))}
            />
            <button
              className="btn btn-sm join-item btn-ghost"
              onClick={() => setShowGeminiKey(v => !v)}
            >
              {showGeminiKey ? '🙈' : '👁️'}
            </button>
          </div>
        </div>

        {/* Gemini Model */}
        <div className="form-control mb-4">
          <label className="label py-1">
            <span className="label-text text-sm">Gemini Model</span>
          </label>
          <select
            className="select select-bordered select-sm"
            value={settings.geminiModel}
            onChange={(e) => setSettings(s => ({ ...s, geminiModel: e.target.value }))}
          >
            {GEMINI_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        <div className="divider text-xs">OpenAI</div>

        {/* OpenAI API Key */}
        <div className="form-control mb-2">
          <label className="label py-1">
            <span className="label-text text-sm">OpenAI API Key</span>
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="label-text-alt link link-primary text-xs"
            >
              รับ Key
            </a>
          </label>
          <div className="join w-full">
            <input
              type={showOpenAIKey ? 'text' : 'password'}
              placeholder="sk-..."
              className="input input-bordered input-sm join-item flex-1"
              value={settings.openaiApiKey}
              onChange={(e) => setSettings(s => ({ ...s, openaiApiKey: e.target.value.trim() }))}
            />
            <button
              className="btn btn-sm join-item btn-ghost"
              onClick={() => setShowOpenAIKey(v => !v)}
            >
              {showOpenAIKey ? '🙈' : '👁️'}
            </button>
          </div>
        </div>

        {/* OpenAI Model */}
        <div className="form-control mb-4">
          <label className="label py-1">
            <span className="label-text text-sm">OpenAI Model</span>
          </label>
          <select
            className="select select-bordered select-sm"
            value={settings.openaiModel}
            onChange={(e) => setSettings(s => ({ ...s, openaiModel: e.target.value }))}
          >
            {OPENAI_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Status indicator */}
        <div className="bg-base-300 rounded-lg p-3 mb-4 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className={settings.geminiApiKey ? 'text-success' : 'text-error'}>
              {settings.geminiApiKey ? '✅' : '❌'}
            </span>
            <span>Gemini: {settings.geminiApiKey ? `${settings.geminiApiKey.slice(0, 8)}...` : 'ยังไม่ได้ตั้งค่า'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={settings.openaiApiKey ? 'text-success' : 'text-error'}>
              {settings.openaiApiKey ? '✅' : '❌'}
            </span>
            <span>OpenAI: {settings.openaiApiKey ? `${settings.openaiApiKey.slice(0, 8)}...` : 'ยังไม่ได้ตั้งค่า'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span>🔄</span>
            <span>โหมด: {settings.provider === 'auto' ? 'Auto Fallback' : settings.provider === 'gemini' ? 'Gemini Only' : 'OpenAI Only'}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="modal-action">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? '⏳ กำลังบันทึก...' : '💾 บันทึก'}
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  )
}
