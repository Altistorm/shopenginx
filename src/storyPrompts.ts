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
  aggressive: 'Aggressive/Intense tone - พูดตรงๆ แรงๆ ไม่อ้อมค้อม ดุดัน กระแทกใจ ท้าทาย',
  grumpy: 'Grumpy/Fierce tone - ตัวละครต้องดุดัน หน้าโหด กล้ามโต ท่าทางข่มขู่ บ่นตลอด แต่ตลก. Visual: GRUMPY fierce intimidating characters, angry expressions, muscular poses, complaining attitude, dramatic lighting, dark vibrant colors, villainous but funny vibe, characters look tough and menacing like Pixar villains',
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
  referenceStyle?: string
  topic?: string
  productName?: string
  scene?: string
}

function buildBatchSystemPrompt(params: BatchGenerateParams): string {
  const styleDesc = IMAGE_STYLES[params.style] || IMAGE_STYLES.pixar_3d
  const moodDesc = MOOD_DESCRIPTIONS[params.mood] || MOOD_DESCRIPTIONS.tough_love

  // Extract English visual description from mood (e.g. "GRUMPY fierce intimidating characters...")
  const moodVisualMatch = moodDesc.match(/Visual:\s*(.+)$/i)
  const moodVisual = moodVisualMatch ? moodVisualMatch[1].trim() : ''

  // For object_talk, use referenceStyle as rendering reference (object_talk is a character type, not a rendering style)
  const renderingRef = params.style === 'object_talk' && params.referenceStyle
    ? (IMAGE_STYLES[params.referenceStyle] || IMAGE_STYLES.pixar_3d)
    : ''

  // Full combined visual direction: rendering reference + style + mood visual
  const imageStyle = [renderingRef, styleDesc, moodVisual].filter(Boolean).join(', ')
  const imageStyleName = (renderingRef || styleDesc).split(',')[0].trim()

  return `คุณคือผู้เชี่ยวชาญสร้าง Storyboard สำหรับวิดีโอสั้น TikTok/Reels แบบ ${params.sceneCount} ฉาก

## สไตล์ภาพ
${imageStyle}

## โทน/Mood
${moodDesc}

## โครงสร้าง Storyboard (ต้องมีครบ ${params.sceneCount} ฉาก)
- ฉากที่ 1 (Hook): เปิดด้วยคำถาม/ปัญหาที่กระแทกใจ ดึงดูดให้ดูต่อ
- ฉากที่ 2 ถึง ${params.sceneCount - 1} (Story): เล่าเนื้อหา พัฒนาเรื่อง ตัวละครเผชิญปัญหา/แก้ปัญหา
- ฉากที่ ${params.sceneCount} (CTA): สรุปประเด็น ชวนติดตาม/แชร์

## กฎสำคัญ
${params.style === 'object_talk' ? `1. **ตัวละครต้องเป็นสิ่งของ/อาหาร/อวัยวะที่มีชีวิต (Anthropomorphized Objects):**
   - ห้ามใช้คนเป็นตัวละครหลัก ยกเว้นหัวข้อระบุชัดว่าต้องการคน
   - ตัวละครต้องเป็นสิ่งของที่มี cute face, arms, legs (anthropomorphized objects)
   - ตัวอย่าง: นมกล่องมีหน้ายิ้ม, ผักมีแขนขา, วิตามินมีตา, ไขมันเป็นตัวร้ายสีเหลือง, เชื้อโรคเป็น blob สีเขียว
   - ถ้าหัวข้อเกี่ยวกับสุขภาพ/โภชนาการ ให้ฉากเกิดขึ้นในร่างกาย (กระเพาะ, ลำไส้, หลอดเลือด)` : `1. ตัวละครต้องหน้าตาเหมือนกันทุกภาพ — ระบุลักษณะเดียวกันทุก prompt`}
2. ทุกฉากต้องมี Image Prompt ภาษาอังกฤษเท่านั้น ที่บอก:
   - สไตล์ภาพ (${imageStyleName})
   - ตัวละคร + อารมณ์ + ท่าทาง (ต้องเหมือนกันทุกฉาก)
   - ⚠️ **ฉาก/Background ต้องต่างกันทุกฉาก!** แต่ละฉากต้องอยู่ในสถานที่/มุมมองที่ไม่ซ้ำกัน (ระบบจะใช้รูปฉากแรกเป็น reference สำหรับ character appearance + art style/tone เท่านั้น — ห้าม copy ฉากหลัง/ท่าทาง/มุมกล้อง จากฉากแรก)
   - มุมกล้อง (ห้ามระบุ aspect ratio เพราะระบบจะตั้งค่าเอง, ห้ามใช้มุมกล้องเดิมซ้ำทุกฉาก)
3. ทุกฉากต้องมี Video Prompt ภาษาอังกฤษที่บอก:
   - **เฉพาะ ACTION เท่านั้น!** ระบุแค่ "ใคร ทำอะไร ที่ไหน" (เช่น "Orange walks and complains")
   - ⚠️ **ห้ามระบุลักษณะตัวละครซ้ำ!** (ห้ามใส่ muscular, fierce, grumpy ฯลฯ เพราะภาพมีมาแล้ว)
   - การเคลื่อนไหว (ต้องมี "subtle movement" หรือ "gentle motion")
   - **ตัวละครพูด**: ต้องมี "speaking" หรือ "talking"
4. ⚠️ **สำคัญมาก - ความยาวบท**: แต่ละฉากต้องมี 15-25 คำเท่านั้น! ห้ามน้อยกว่า 15 คำ และ ห้ามเกิน 25 คำ! นับคำให้ดี บทยาวเกิน = ผิดกฎ!
   - ⚠️ **ห้ามลงท้าย ครับ/ค่ะ ทุกฉาก!** ลงท้าย "ครับ/ค่ะ" **เฉพาะฉากสุดท้าย (CTA) เท่านั้น!**
${params.productName ? `\n## สินค้า\nชื่อสินค้า: ${params.productName} — ต้องมีสินค้าปรากฏในทุกภาพอย่างเป็นธรรมชาติ` : ''}
${params.scene ? `\n## ฉาก/สถานที่\nฉากหลัก: ${params.scene}` : ''}

## ตอบกลับเป็น JSON เท่านั้น:
{
  "title": "ชื่อเรื่อง",
  "characters": [
    {"name": "ชื่อตัวละคร${params.style === 'object_talk' ? ' (เป็นสิ่งของ/อาหาร)' : ''}", "appearance": "${params.style === 'object_talk' ? (moodVisual ? 'anthropomorphized object matching style above - describe color, expression, pose, outfit (EN)' : 'cute anthropomorphized object with face, arms, legs - describe color, expression, outfit (EN)') : 'Detailed English description of character appearance, outfit, colors, features'}"}
  ],
  "scenes": [
    {
      "sceneNumber": 1,
      "sceneType": "hook",
      "description": "คำอธิบายฉากสั้นๆ (TH)",
      "imagePrompt": "${imageStyleName}. ${params.style === 'object_talk' ? (moodVisual ? '[Character name] - a [mood-matching] anthropomorphized [object] with [expression matching tone above], [pose], [color]. Background: [location]. Do NOT include aspect ratio.' : '[Character name] - a cute anthropomorphized [object] with big eyes, small arms and legs, [expression]. Background: [location]. Do NOT include aspect ratio.') : '[Full English image prompt with style, character, emotion, background, camera angle]. Do NOT include aspect ratio.'}",
      "videoPrompt": "ACTION ONLY: [character name] + [action] + [camera]. Example: 'Orange walks forward, talking, camera follows'. NO appearance description!",
      "script": "⚠️ 15-25 คำเท่านั้น! ตัวอย่าง: นี่คือตัวอย่างบทพูดที่มีความยาวพอดี ไม่สั้นไม่ยาวเกินไป"
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
