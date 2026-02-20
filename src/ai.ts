// AI Provider utilities — Gemini + OpenAI with auto-fallback

export type AIProvider = 'gemini' | 'openai' | 'auto'

export interface AISettings {
  geminiApiKey: string
  geminiModel: string
  openaiApiKey: string
  openaiModel: string
  provider: AIProvider
}

const DEFAULT_SETTINGS: AISettings = {
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini',
  provider: 'auto',
}

const STORAGE_KEY = 'shopenginx_ai_settings'

// ─── Storage ───────────────────────────────────────────

export async function loadAISettings(): Promise<AISettings> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY)
    if (result[STORAGE_KEY]) {
      return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEY] }
    }
  } catch {
    // Fallback for non-extension context (dev mode)
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  }
  return DEFAULT_SETTINGS
}

export async function saveAISettings(settings: AISettings): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: settings })
  } catch {
    // Fallback for non-extension context
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }
}

// ─── Gemini ────────────────────────────────────────────

async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userPrompt }] }],
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Gemini API Error (${res.status}): ${errText}`)
  }

  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

// ─── OpenAI ────────────────────────────────────────────

async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const url = 'https://api.openai.com/v1/chat/completions'

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 4096,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`OpenAI API Error (${res.status}): ${errText}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

// ─── Unified caller with auto-fallback ─────────────────

export async function callAI(
  systemPrompt: string,
  userPrompt: string,
  settings?: AISettings,
): Promise<string> {
  const s = settings || (await loadAISettings())

  const hasGemini = !!s.geminiApiKey
  const hasOpenAI = !!s.openaiApiKey

  if (!hasGemini && !hasOpenAI) {
    throw new Error('ไม่พบ API Key — กรุณาตั้งค่า Gemini หรือ OpenAI API Key ในการตั้งค่า ⚙️')
  }

  // Determine order based on provider preference
  type Caller = () => Promise<string>
  const callers: { name: string; fn: Caller }[] = []

  if (s.provider === 'gemini' || s.provider === 'auto') {
    if (hasGemini) {
      callers.push({
        name: 'Gemini',
        fn: () => callGemini(s.geminiApiKey, s.geminiModel, systemPrompt, userPrompt),
      })
    }
  }

  if (s.provider === 'openai' || s.provider === 'auto') {
    if (hasOpenAI) {
      callers.push({
        name: 'OpenAI',
        fn: () => callOpenAI(s.openaiApiKey, s.openaiModel, systemPrompt, userPrompt),
      })
    }
  }

  // If provider is specifically set but key is missing, try the other
  if (callers.length === 0) {
    if (hasGemini) {
      callers.push({
        name: 'Gemini (fallback)',
        fn: () => callGemini(s.geminiApiKey, s.geminiModel, systemPrompt, userPrompt),
      })
    }
    if (hasOpenAI) {
      callers.push({
        name: 'OpenAI (fallback)',
        fn: () => callOpenAI(s.openaiApiKey, s.openaiModel, systemPrompt, userPrompt),
      })
    }
  }

  // Try each caller with fallback
  let lastError: Error | null = null
  for (const caller of callers) {
    try {
      console.log(`[AI] Calling ${caller.name}...`)
      const result = await caller.fn()
      console.log(`[AI] ${caller.name} success`)
      return result
    } catch (err) {
      lastError = err as Error
      console.warn(`[AI] ${caller.name} failed:`, lastError.message)
    }
  }

  throw lastError || new Error('AI call failed')
}
