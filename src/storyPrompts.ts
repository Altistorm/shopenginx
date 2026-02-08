// Story mode prompt templates for AI generation

import { callAI } from './ai'

// ─── Style & Mood maps ────────────────────────────────

const IMAGE_STYLES: Record<string, string> = {
  // Product styles
  tiktok_real: 'TikTok UGC realistic style, casual authentic feel, natural lighting',
  review: 'Product review style, person holding product, close-up showcase',
  hands_only: 'Hands-only product showcase, clean background, detailed close-up',
  professional: 'Professional product photography, studio lighting, clean composition',
  dramatic: 'Dramatic cinematic style, bold lighting, intense atmosphere',
  minimalist: 'Minimalist style, clean background, warm tones, focused on subject',
  luxury: 'Luxury elegant style, marble background, soft golden lighting',
  dance: 'K-pop dance style, dynamic pose, vibrant stage lighting, energetic',
  object_talk: 'Anthropomorphized object with cute face, arms, legs, expressive character',
  // Story styles
  pixar_3d: 'Pixar 3D Animation style, vibrant colors, expressive characters, smooth rendering, Disney-quality lighting',
  anime: 'Japanese Anime style, dynamic expressions, vivid colors, anime-style shading',
  cartoon_2d: '2D Cartoon style, bold outlines, bright colors, playful design',
  watercolor: 'Watercolor painting style, soft colors, artistic brush strokes, dreamy atmosphere',
  realistic: 'Photorealistic cinematic style, natural lighting, high detail skin texture, realistic proportions, 8K quality',
}

const MOOD_DESCRIPTIONS: Record<string, string> = {
  tough_love: 'Tough Love tone - firm but caring, direct criticism with good intentions',
  funny: 'Funny/Comedic tone - playful humor, jokes, light-hearted delivery',
  exciting: 'Exciting/Thrilling tone - high energy, tension, dramatic reveals',
  scary: 'Scary/Horror tone - suspenseful, creepy atmosphere, unexpected twists',
  cute: 'Cute/Warm tone - adorable characters, heartwarming moments',
  serious: 'Serious/Educational tone - informative, factual, straightforward',
  sarcastic: 'Sarcastic tone - witty commentary, ironic observations',
  aggressive: 'Aggressive/Intense tone - direct, bold, challenging',
  scolding: 'Scolding/Nagging tone - complaining, lecturing, like a strict parent',
  troll: 'Trolling/Teasing tone - playful mockery, poking fun',
  crude: 'Crude/Raw 18+ tone - harsh, vulgar, street language',
  isan: 'Isan dialect tone - northeastern Thai, warm, folksy',
  isan_crude: 'Isan Crude 18+ tone - northeastern Thai + vulgar',
  southern: 'Southern Thai dialect tone - fast-paced, direct, passionate',
  southern_crude: 'Southern Crude 18+ tone - southern Thai + vulgar',
  northern: 'Northern Thai/Kam Muang dialect tone - gentle, soft-spoken, polite',
  northern_crude: 'Northern Crude 18+ tone - northern Thai + vulgar',
}

// ─── Batch generation (all scenes at once) ─────────────

interface BatchGenerateParams {
  sceneCount: number
  style: string
  mood: string
  topic?: string
  productName?: string
  scene?: string
}

function buildBatchSystemPrompt(params: BatchGenerateParams): string {
  const styleDesc = IMAGE_STYLES[params.style] || IMAGE_STYLES.pixar_3d
  const moodDesc = MOOD_DESCRIPTIONS[params.mood] || MOOD_DESCRIPTIONS.tough_love

  return `คุณคือผู้เชี่ยวชาญสร้าง Image Prompt สำหรับ AI Image Generator (Google Flow)

สร้าง ${params.sceneCount} ภาพที่เล่าเรื่องต่อเนื่องกัน โดยมีโครงสร้าง:
- ภาพที่ 1 (Hook): เปิดด้วยฉากดึงดูดสายตา ตัวละครแสดงอารมณ์ชัดเจน
- ภาพที่ 2-${params.sceneCount - 1} (Story): พัฒนาเรื่อง ตัวละครเผชิญปัญหา/แก้ปัญหา
- ภาพที่ ${params.sceneCount} (CTA): สรุป/ปิดเรื่อง

## สไตล์ภาพ
${styleDesc}

## โทน/Mood
${moodDesc}

## กฎสำคัญ
1. ตัวละครต้องหน้าตาเหมือนกันทุกภาพ — ระบุลักษณะเดียวกันทุก prompt
2. ทุก prompt ต้องเป็นภาษาอังกฤษ
3. ทุก prompt ต้องระบุ: สไตล์ภาพ, ตัวละคร+อารมณ์+ท่าทาง, ฉาก/Background, มุมกล้อง
4. ห้ามระบุ aspect ratio (ระบบตั้งค่าเอง)
5. ต้องลงท้ายทุก prompt ด้วย "single image, no collage, no multiple panels"
${params.productName ? `\n## สินค้า\nชื่อสินค้า: ${params.productName} — ต้องมีสินค้าปรากฏในทุกภาพอย่างเป็นธรรมชาติ` : ''}
${params.scene ? `\n## ฉาก/สถานที่\nฉากหลัก: ${params.scene}` : ''}

## ตอบกลับเป็น JSON เท่านั้น:
{
  "title": "ชื่อเรื่อง (สั้นกระชับ ภาษาไทย)",
  "characters": [
    {
      "name": "ชื่อตัวละคร",
      "appearance": "Detailed English description of character appearance, outfit, colors, features"
    }
  ],
  "scenes": [
    {
      "sceneNumber": 1,
      "sceneType": "hook",
      "description": "คำอธิบายสั้นๆ ภาษาไทย",
      "imagePrompt": "Full English image prompt...",
      "videoPrompt": "ACTION ONLY in English: [character] + [action] + [camera movement]. No appearance description.",
      "script": "บทพูด/บรรยาย 15-25 คำ ภาษาไทย"
    }
  ]
}

## sceneType ต้องเป็น:
- "hook" สำหรับฉากแรก
- "story" สำหรับฉากกลาง
- "cta" สำหรับฉากสุดท้าย`
}

function buildBatchUserPrompt(params: BatchGenerateParams): string {
  const parts: string[] = [`สร้าง ${params.sceneCount} ภาพ`]
  if (params.topic) {
    parts.push(`เรื่อง: ${params.topic}`)
  }
  if (params.productName) {
    parts.push(`สินค้า: ${params.productName}`)
  }
  if (!params.topic) {
    parts.push(`สไตล์ ${IMAGE_STYLES[params.style]?.split(',')[0] || 'Pixar 3D'}`)
  }
  return parts.join(' ')
}

export interface StoryCharacter {
  name: string
  appearance: string
}

export interface GeneratedScene {
  sceneNumber: number
  sceneType: 'hook' | 'story' | 'cta'
  description: string
  imagePrompt: string
  videoPrompt: string
  script: string
}

export interface StoryboardResult {
  title: string
  characters: StoryCharacter[]
  scenes: GeneratedScene[]
}

export async function generateAllScenePrompts(params: BatchGenerateParams): Promise<StoryboardResult> {
  const systemPrompt = buildBatchSystemPrompt(params)
  const userPrompt = buildBatchUserPrompt(params)

  const response = await callAI(systemPrompt, userPrompt)

  // Parse JSON from response
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('AI ไม่ตอบกลับ JSON ที่ถูกต้อง')
  }

  let cleaned = jsonMatch[0]
  // Fix trailing commas
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1')

  const parsed = JSON.parse(cleaned)

  return {
    title: parsed.title || '',
    characters: parsed.characters || [],
    scenes: (parsed.scenes || []).map((s: Record<string, unknown>, i: number) => ({
      sceneNumber: s.sceneNumber ?? i + 1,
      sceneType: s.sceneType || (i === 0 ? 'hook' : i === (parsed.scenes?.length ?? 1) - 1 ? 'cta' : 'story'),
      description: s.description || '',
      imagePrompt: s.imagePrompt || '',
      videoPrompt: s.videoPrompt || '',
      script: s.script || '',
    })),
  }
}

// ─── Single prompt generation ──────────────────────────

interface SingleGenerateParams {
  description: string
  style: string
  mood: string
  sceneType: 'hook' | 'story' | 'cta'
}

export async function generateSinglePrompt(params: SingleGenerateParams): Promise<string> {
  const styleDesc = IMAGE_STYLES[params.style] || IMAGE_STYLES.pixar_3d

  const sceneTypeGuide = {
    hook: 'ฉากเปิด (Hook) — ดึงดูดสายตา ตัวละครแสดงอารมณ์ชัดเจน',
    story: 'ฉากเล่าเรื่อง (Story) — พัฒนาเรื่อง ตัวละครเผชิญปัญหา/แก้ปัญหา',
    cta: 'ฉากปิด (CTA) — สรุป/ปิดเรื่อง ชวนติดตาม',
  }

  const systemPrompt = `คุณคือผู้เชี่ยวชาญเขียน Image Prompt สำหรับ AI Image Generator
สไตล์: ${styleDesc}
ประเภทฉาก: ${sceneTypeGuide[params.sceneType]}

แปลงคำอธิบายสั้นเป็น prompt ภาษาอังกฤษที่ละเอียด ระบุ สไตล์ ตัวละคร อารมณ์ ท่าทาง ฉาก มุมกล้อง
ลงท้ายด้วย "single image, no collage, no multiple panels"
ตอบแค่ prompt เดียว ไม่ต้อง JSON ไม่ต้องอธิบายเพิ่ม`

  const userPrompt = params.description

  return await callAI(systemPrompt, userPrompt)
}
