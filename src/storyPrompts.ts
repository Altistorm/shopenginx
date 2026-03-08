// Story mode prompt templates for AI generation

import { callAI } from './ai'

// ─── Style & Mood maps ────────────────────────────────

export const IMAGE_STYLES: Record<string, string> = {
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

// ─── Story Frameworks ─────────────────────────────────

export interface StoryFrameworkConfig {
  label: string
  description: string
  prompt: string
  structure: { hook: string; story: string; cta: string }
}

export const STORY_FRAMEWORKS: Record<string, StoryFrameworkConfig> = {
  AIDA: {
    label: 'AIDA',
    description: 'ดึงดูด → สนใจ → อยากได้ → ลงมือทำ',
    prompt: 'AIDA Framework: Start with attention-grabbing hook, build interest with benefits, create desire through emotional appeal, end with clear call-to-action.',
    structure: {
      hook: 'Attention - ดึงดูดความสนใจทันที ใช้คำถาม/ปัญหา/ความตกใจ',
      story: 'Interest & Desire - สร้างความสนใจด้วย benefits, กระตุ้นความต้องการด้วยอารมณ์',
      cta: 'Action - บอกให้ทำอะไรชัดเจน กระตุ้นให้ลงมือทำทันที',
    },
  },
  PAS: {
    label: 'PAS',
    description: 'ปัญหา → ขยายความ → ทางออก',
    prompt: 'PAS Framework: Present a relatable problem, agitate by showing consequences/pain points, then introduce the solution as the hero.',
    structure: {
      hook: 'Problem - นำเสนอปัญหาที่คนดูเข้าใจและรู้สึกร่วม',
      story: 'Agitate - ขยายความเจ็บปวด แสดงผลกระทบ ทำให้รู้สึกว่าต้องแก้',
      cta: 'Solution - นำเสนอทางออก (สินค้า/บริการ) เป็นฮีโร่ที่ช่วยแก้ปัญหา',
    },
  },
  'Before-After': {
    label: 'Before-After',
    description: 'ก่อน → หลัง → ทางเชื่อม',
    prompt: 'Before-After-Bridge Framework: Show the before state (problem), the after state (success), and bridge with how to get there.',
    structure: {
      hook: 'Before - แสดงสถานะก่อนใช้/ก่อนเปลี่ยนแปลง (ปัญหา ความทุกข์)',
      story: 'After - แสดงผลลัพธ์หลังใช้/หลังเปลี่ยนแปลง (สำเร็จ มีความสุข)',
      cta: 'Bridge - บอกวิธีที่จะไปถึง After (สินค้า/บริการคือทางเชื่อม)',
    },
  },
  'Hero Journey': {
    label: 'Hero Journey',
    description: 'ปัญหา → ค้นพบ → เปลี่ยนแปลง',
    prompt: 'Hero Journey Framework: Character faces a challenge, discovers solution/mentor, transforms and achieves success.',
    structure: {
      hook: 'Challenge - ตัวละครเจอปัญหา/ความท้าทาย รู้สึกหมดหวัง',
      story: 'Discovery & Transformation - ค้นพบทางออก (สินค้า) เริ่มเปลี่ยนแปลง เห็นผลลัพธ์',
      cta: 'Success - ประสบความสำเร็จ ชวนให้คนดูเริ่มต้นการเดินทางเดียวกัน',
    },
  },
  'Problem-Solution': {
    label: 'Problem-Solution',
    description: 'ปัญหา → วิธีแก้ → ผลลัพธ์',
    prompt: 'Problem-Solution Framework: Clearly present problem, explain the solution step-by-step, show results and benefits.',
    structure: {
      hook: 'Problem - นำเสนอปัญหาที่พบบ่อย ทำให้คนดูพยักหน้า',
      story: 'Solution - อธิบายวิธีแก้อย่างชัดเจน แสดงขั้นตอน/วิธีใช้',
      cta: 'Results - แสดงผลลัพธ์ที่ได้ ชวนให้ลองทำตาม',
    },
  },
  'Hook-Punchline': {
    label: 'Hook-Punchline',
    description: 'ดึงดูด → สร้างความสนใจ → ตบมุก',
    prompt: 'Hook-Punchline Framework: Start with intriguing hook, build anticipation, deliver satisfying punchline or reveal.',
    structure: {
      hook: 'Hook - เปิดด้วยอะไรที่น่าสนใจ ทำให้อยากดูต่อ',
      story: 'Build-up - สร้างความคาดหวัง เพิ่มความตื่นเต้น',
      cta: 'Punchline - ตบมุก/เฉลย ที่ทำให้จำได้ + CTA ที่เข้ากัน',
    },
  },
}

// ─── Video Types ──────────────────────────────────────

export interface VideoTypeConfig {
  description: string
  voiceStyle: string
  scriptLength: number
  storyFramework: string
  prompt: string
}

export const VIDEO_TYPES: Record<string, VideoTypeConfig> = {
  // ── ขาย/โปรโมท ──
  'โฆษณาขายของ': {
    description: 'โปรโมทสินค้า/บริการ กระตุ้นยอดขาย',
    voiceStyle: 'excited, energetic, persuasive, fast-paced delivery with emphasis on benefits',
    scriptLength: 16,
    storyFramework: 'AIDA',
    prompt: 'Product Advertisement video - showcase product benefits, features, compelling reasons to buy. Create desire and urgency. Fast-paced editing, punchy visuals.',
  },
  'รีวิวสินค้า': {
    description: 'รีวิวประสบการณ์ใช้จริง สร้างความน่าเชื่อถือ',
    voiceStyle: 'casual, friendly, honest, conversational like talking to a friend',
    scriptLength: 16,
    storyFramework: 'Before-After',
    prompt: 'Product Review video - authentic experience sharing, honest opinions, showing real usage and results. Build trust through genuine storytelling.',
  },
  'ก่อน-หลัง': {
    description: 'แสดงการเปลี่ยนแปลง Transformation',
    voiceStyle: 'building anticipation, then excited reveal, amazed reaction',
    scriptLength: 14,
    storyFramework: 'Before-After',
    prompt: 'Before/After transformation video - dramatic contrast showing change, improvement, or results. Visual proof of effectiveness. Build anticipation then reveal.',
  },
  'รีวิวลูกค้า': {
    description: 'Testimonial เสียงจากผู้ใช้จริง Social Proof',
    voiceStyle: 'genuine, relatable, emotional connection, real person vibes',
    scriptLength: 16,
    storyFramework: 'Problem-Solution',
    prompt: 'Testimonial video - customer stories, real experiences, social proof that builds credibility and trust through authentic voices.',
  },
  'สุขภาพความงาม': {
    description: 'Health & Beauty สกินแคร์ ความงาม สุขภาพ',
    voiceStyle: 'soft, soothing, ASMR-like, gentle whispers, self-care vibes',
    scriptLength: 12,
    storyFramework: 'Before-After',
    prompt: 'Health and Beauty video - skincare routine, beauty tips, product showcase with glowing results, before/after transformation, self-care moments, wellness lifestyle. ASMR-friendly.',
  },
  // ── ให้ความรู้/สอน ──
  'ให้ความรู้': {
    description: 'Educational ให้ข้อมูลความรู้ น่าเชื่อถือ',
    voiceStyle: 'confident, authoritative, informative, slightly urgent "did you know" energy',
    scriptLength: 19,
    storyFramework: 'Problem-Solution',
    prompt: 'Educational video - informative content that teaches something new, presents facts, delivers value through knowledge sharing. Confident, authoritative tone.',
  },
  'สอนวิธีทำ': {
    description: 'Tutorial สอนวิธีใช้หรือทำอะไรบางอย่าง',
    voiceStyle: 'clear, patient, instructional, step-by-step with pauses for understanding',
    scriptLength: 16,
    storyFramework: 'Problem-Solution',
    prompt: 'Tutorial/How-to video - step-by-step instructions, clear demonstrations, educational content that provides value and solves problems. Patient, clear explanations.',
  },
  // ── เล่าเรื่อง/บันเทิง ──
  'เล่าเรื่อง': {
    description: 'Storytelling เล่าเรื่องราวที่น่าสนใจ ดึงอารมณ์',
    voiceStyle: 'emotional, dramatic, varying pace - slow for tension, fast for excitement',
    scriptLength: 16,
    storyFramework: 'Hero Journey',
    prompt: 'Storytelling video - narrative-driven content with emotional arc, character development, and engaging plot. Dramatic pacing.',
  },
  'ความบันเทิง': {
    description: 'Entertainment สนุก ตลก viral',
    voiceStyle: 'fun, energetic, comedic timing, playful, upbeat',
    scriptLength: 19,
    storyFramework: 'Hook-Punchline',
    prompt: 'Entertainment video - fun, engaging, potentially viral content that entertains first while subtly incorporating the message. High energy, comedic timing.',
  },
  'ซีรีส์สั้น': {
    description: '📚 Micro-Series 3-5 ตอน Algorithm ชอบ!',
    voiceStyle: 'consistent energy across episodes, cliffhanger delivery, "follow for part 2" hooks, serialized storytelling',
    scriptLength: 16,
    storyFramework: 'Problem-Solution',
    prompt: 'Educational Micro-Series format - numbered episode series for binge-watching. TikTok algorithm rewards this. Each episode: clear number, consistent intro/outro, cliffhanger for next episode.',
  },
  'กอดอดีต': {
    description: '🤗 Viral - AI Hug กอดตัวเองในอดีต/คนที่จากไป',
    voiceStyle: 'soft whisper, emotional, gentle, tearful, nostalgic, heartfelt',
    scriptLength: 12,
    storyFramework: 'Hero Journey',
    prompt: 'AI Hug emotional trend - heartwarming scene of present self hugging younger self or loved ones who have passed. Cinematic, emotional, touching moments.',
  },
  'มุมมองตัวเอง': {
    description: '🎭 Viral - POV Skit ดราม่าตลก มุมมองบุคคลที่ 1',
    voiceStyle: 'over-dramatic, exaggerated emotions, soap opera delivery, comedic timing, direct address to camera',
    scriptLength: 22,
    storyFramework: 'Hook-Punchline',
    prompt: 'POV Skit viral format - first-person perspective storytelling. Format: "POV: [situation]" then act out scene directly to camera. Exaggerated reactions, soap opera drama.',
  },
  'ชื่นชมความไม่สมบูรณ์': {
    description: '🍃 Viral - Wabi Sabi ชื่นชมข้อบกพร่อง',
    voiceStyle: 'soft, appreciative, warm, accepting, gentle observations, cozy vibes',
    scriptLength: 12,
    storyFramework: 'Hook-Punchline',
    prompt: 'Wabi Sabi appreciation trend - celebrating imperfections, flaws, quirky details. Japanese aesthetic of finding beauty in imperfect things. Close-up shots, gentle appreciation, cozy aesthetic.',
  },
  'เศรษฐีจำลอง': {
    description: '💰 Viral - Hella Money มั่นใจเวอร์ ได้เงินนิดเดียว',
    voiceStyle: 'extremely confident, flexing energy, millionaire attitude, comedic contrast when revealing small amount',
    scriptLength: 19,
    storyFramework: 'Hook-Punchline',
    prompt: 'Hella Money Energy viral trend - extreme confidence and millionaire energy over tiny financial wins. Self-deprecating humor, exaggerated flex poses, dramatic reveal of small amount.',
  },
  // ── Viral Trends ──
  'ของดุ': {
    description: '🔥 Viral - สิ่งของ/อาหารดุๆ ตะโกนสอน',
    voiceStyle: 'LOUD, YELLING, aggressive, frustrated, scolding, fast angry speech, comedic anger',
    scriptLength: 25,
    storyFramework: 'PAS',
    prompt: 'Angry Objects viral trend - anthropomorphized food/objects with angry faces YELLING at viewer, scolding for improper usage. Teaches correct methods through comedic anger. Close-up shots, dramatic lighting, fast cuts, LOUD audio.',
  },
  'ผลไม้มีหน้า': {
    description: '🍎 Viral - FruitTok ผลไม้มีหน้า กินตัวเอง ASMR',
    voiceStyle: 'ASMR whispers, chewing sounds, satisfying crunch, minimal speech, surreal narration',
    scriptLength: 10,
    storyFramework: 'Hook-Punchline',
    prompt: 'AI Fruit Face / FruitTok viral trend - fruits with realistic human faces eating each other. Satisfying ASMR sounds, chewing sounds, surreal storytelling. Cute yet oddly satisfying.',
  },
  'สัตว์อิตาลีบ้าๆ': {
    description: '🇮🇹 Viral - Italian Brainrot สัตว์ผสมชื่ออิตาลี',
    voiceStyle: 'fake Italian accent, nonsense rhyming words, sing-song chanting, absurd narration, repetitive catchphrases',
    scriptLength: 16,
    storyFramework: 'Hook-Punchline',
    prompt: 'Italian Brainrot viral trend - surrealist AI creatures with pseudo-Italian rhyming names. Absurd designs, nonsense names, catchy repetitive sounds, comedic battles.',
  },
  'อวัยวะเล่าโรค': {
    description: '🏥 ตัวละครอวัยวะน่ารักให้ความรู้เรื่องโรค/สุขภาพ',
    voiceStyle: 'cute character voices, friendly, educational but fun, easy to understand, engaging for all ages',
    scriptLength: 19,
    storyFramework: 'Problem-Solution',
    prompt: 'Cute Organ Characters educational health video - anthropomorphized body organs with cute faces explaining diseases. 3D Pixar-style. Educational but entertaining.',
  },
}

export const VIDEO_TYPE_GROUPS: Record<string, { emoji: string; types: string[] }> = {
  'ขาย/โปรโมท': {
    emoji: '📦',
    types: ['โฆษณาขายของ', 'รีวิวสินค้า', 'รีวิวลูกค้า', 'ก่อน-หลัง', 'สุขภาพความงาม'],
  },
  'ให้ความรู้/สอน': {
    emoji: '📚',
    types: ['ให้ความรู้', 'สอนวิธีทำ'],
  },
  'เล่าเรื่อง/บันเทิง': {
    emoji: '🎬',
    types: ['เล่าเรื่อง', 'ความบันเทิง', 'ซีรีส์สั้น', 'กอดอดีต', 'มุมมองตัวเอง', 'ชื่นชมความไม่สมบูรณ์', 'เศรษฐีจำลอง'],
  },
  'Viral Trends': {
    emoji: '🔥',
    types: ['ของดุ', 'ผลไม้มีหน้า', 'สัตว์อิตาลีบ้าๆ', 'อวัยวะเล่าโรค'],
  },
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
  videoType?: string
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

  // ── Resolve videoType → voiceStyle, scriptLength, storyFramework ──
  const videoTypeConfig = params.videoType ? VIDEO_TYPES[params.videoType] : null
  const voiceStyle = videoTypeConfig?.voiceStyle || ''
  const scriptLength = videoTypeConfig?.scriptLength || 16
  const scriptMin = Math.max(5, scriptLength - 5)
  const frameworkKey = videoTypeConfig?.storyFramework || ''
  const framework = frameworkKey ? STORY_FRAMEWORKS[frameworkKey] : null
  const videoTypePrompt = videoTypeConfig?.prompt || ''

  // ── Build structure section (framework-aware or default) ──
  let structureSection: string
  if (framework) {
    structureSection = `## โครงสร้าง Storyboard — ${framework.label} (${framework.description})
${framework.prompt}

- ฉากที่ 1 (Hook): ${framework.structure.hook}
- ฉากที่ 2 ถึง ${params.sceneCount - 1} (Story): ${framework.structure.story}
- ฉากที่ ${params.sceneCount} (CTA): ${framework.structure.cta}`
  } else {
    structureSection = `## โครงสร้าง Storyboard (ต้องมีครบ ${params.sceneCount} ฉาก)
- ฉากที่ 1 (Hook): เปิดด้วยคำถาม/ปัญหาที่กระแทกใจ ดึงดูดให้ดูต่อ
- ฉากที่ 2 ถึง ${params.sceneCount - 1} (Story): เล่าเนื้อหา พัฒนาเรื่อง ตัวละครเผชิญปัญหา/แก้ปัญหา
- ฉากที่ ${params.sceneCount} (CTA): สรุปประเด็น ชวนติดตาม/แชร์`
  }

  return `คุณคือผู้เชี่ยวชาญสร้าง Storyboard สำหรับวิดีโอสั้น TikTok/Reels แบบ ${params.sceneCount} ฉาก
${videoTypePrompt ? `\n## ประเภทคลิป\n${videoTypePrompt}\n` : ''}
## สไตล์ภาพ
${imageStyle}

## โทน/Mood
${moodDesc}
${voiceStyle ? `\n## Voice Style\n${voiceStyle}` : ''}

${structureSection}

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
4. ⚠️ **สำคัญมาก - ความยาวบท**: แต่ละฉากต้องมี ${scriptMin}-${scriptLength} คำเท่านั้น! ห้ามน้อยกว่า ${scriptMin} คำ และ ห้ามเกิน ${scriptLength} คำ! นับคำให้ดี บทยาวเกิน = ผิดกฎ!
   - ⚠️ **ห้ามลงท้าย ครับ/ค่ะ ทุกฉาก!** ลงท้าย "ครับ/ค่ะ" **เฉพาะฉากสุดท้าย (CTA) เท่านั้น!**
${params.productName ? `\n## สินค้า\nชื่อสินค้า: ${params.productName} — ต้องมีสินค้าปรากฏในทุกภาพอย่างเป็นธรรมชาติ` : ''}
${params.scene ? `\n## ฉาก/สถานที่\nฉากหลัก: ${params.scene}` : ''}

## ตอบกลับเป็น JSON เท่านั้น:
{
  "title": "ชื่อเรื่อง",
  "storyboardPrompt": "Create a storyboard with ${params.sceneCount} scenes in grid layout. ${imageStyleName} style. IMPORTANT: Each scene MUST have a visible text label. Scene 1 labeled 'SCENE 1': [full description with character appearance, pose, emotion, background, camera angle]. Scene 2 labeled 'SCENE 2': [same character with IDENTICAL face/hair/body, different pose/background]. ... CRITICAL: Character face, hair, height IDENTICAL across ALL scenes. ${params.productName ? `Product (${params.productName}) IDENTICAL in scenes where it appears.` : ''}",
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
      "script": "⚠️ ${scriptMin}-${scriptLength} คำเท่านั้น! ตัวอย่าง: นี่คือตัวอย่างบทพูดที่มีความยาวพอดี ไม่สั้นไม่ยาวเกินไป"
    }
  ]
}

## storyboardPrompt กฎ:
- ต้องเป็นภาษาอังกฤษ 1 prompt ที่รวมทุกฉากเข้าด้วยกัน
- แต่ละฉากต้องมี label "SCENE 1", "SCENE 2" ฯลฯ
- ตัวละครต้องระบุ appearance เหมือนกันทุกฉาก (face, hair, height, body type IDENTICAL)
- แต่ละฉากระบุ: character pose, expression, background, camera angle
- ห้ามใส่ aspect ratio ใน storyboardPrompt

## sceneType ต้องเป็น:
- "hook" สำหรับฉากแรก
- "story" สำหรับฉากกลาง
- "cta" สำหรับฉากสุดท้าย`
}

function buildBatchUserPrompt(params: BatchGenerateParams): string {
  const parts: string[] = [`สร้าง ${params.sceneCount} ภาพ`]
  if (params.videoType) {
    parts.push(`ประเภท: ${params.videoType}`)
  }
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
  storyboardPrompt: string
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
    storyboardPrompt: parsed.storyboardPrompt || '',
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
