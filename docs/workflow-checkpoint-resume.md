# Workflow Checkpoint & Resume

## Overview

The image/video generation pipeline in Story Mode processes scenes sequentially. When a failure occurs mid-pipeline (e.g., scene 3 of 5), all progress is lost — the user must restart from scratch. This design adds checkpoint persistence and resume-from-failure capability by auto-saving to `chrome.storage.local` after every artifact (image, end frame, video) and supporting manual export/import of a unified `WorkflowCheckpoint` JSON.

## Key Files

| File | Purpose |
|------|---------|
| `src/tabs/ImageTab.tsx` | `scenes` state, `handleCreate` batch loop, config state |
| `src/hooks/useVideoWorkflow.ts` | `SceneData` type definition, video pipeline hook |
| `src/storyPrompts.ts` | `StoryCharacter`, `GeneratedScene`, AI generation |

## Current State

### What Already Exists

`SceneData[]` lives in React state (`useState<SceneData[]>([])`) and tracks per-scene progress:

```
SceneData {
  sceneIndex, sceneType, description

  // Prompts (editable)
  startFramePrompt, endFramePrompt, videoPrompt, script

  // Original AI prompts (immutable, for reset)
  originalStartFramePrompt?, originalEndFramePrompt?,
  originalVideoPrompt?, originalScript?

  // Start frame artifacts
  startFrameImage?          (base64)
  startFrameImageUuid?      (Google Flow gallery UUID)

  // End frame artifacts
  endFrameImage?            (base64)
  endFrameImageUuid?        (Google Flow gallery UUID)

  // Status flags
  imageCreated              ✓/✗
  endFrameCreated           ✓/✗
  videoCreated              ✓/✗
  addedToScene              ✓/✗
}
```

Per-scene generation functions already exist and update these flags:
- `handleGenerateSceneImage(sceneIndex, 'start'|'end')` — individual scene image
- `handleGenerateSceneVideo(sceneIndex)` — individual scene video

### What's Missing

1. **No persistence** — `scenes` state lost on page reload or extension restart
2. **No export/import** — no way to save/restore the full workflow state
3. **Batch loop doesn't skip** — `handleCreate` always starts from `i = 0`
4. **Config is scattered** — ~20 `useState` hooks with no unified snapshot
5. **No per-artifact save** — progress only lives in React state, not persisted after each artifact

---

## Pipeline Stages & Save Points

Every `💾` marker is a save point — checkpoint written to `chrome.storage.local` immediately after the artifact succeeds.

```
┌─ handleCreate() Story Mode Pipeline ──────────────────────────────────────┐
│                                                                           │
│  💾 SAVE #0: Initial checkpoint (config + story + scenes with all flags   │
│              set to false). Marks "workflow started".                      │
│                                                                           │
│  INIT_STORY_MODE (once)                                                   │
│       │                                                                   │
│       ▼                                                                   │
│  ┌─ PHASE 1: Start Frame Loop ───────────────────────────────────────┐    │
│  │  for each scene:                                                  │    │
│  │    skip if scene.imageCreated ──── (resume logic)                 │    │
│  │    CREATE_STORY_SCENE(startFramePrompt)                           │    │
│  │      → success:                                                   │    │
│  │          imageCreated = true                                      │    │
│  │          store startFrameImage + startFrameImageUuid              │    │
│  │          💾 SAVE (scene N start frame done)                       │    │
│  │      → fail:                                                      │    │
│  │          imageCreated stays false                                  │    │
│  │          💾 SAVE (preserve progress of scenes 0..N-1)             │    │
│  │          loop continues to next scene                             │    │
│  └───────────────────────────────────────────────────────────────────┘    │
│       │                                                                   │
│       ▼                                                                   │
│  ┌─ PHASE 2: End Frame Loop ─────────────────────────────────────────┐    │
│  │  for each scene with endFramePrompt:                              │    │
│  │    skip if scene.endFrameCreated ── (resume logic)                │    │
│  │    CREATE_STORY_SCENE(endFramePrompt)                             │    │
│  │      → success:                                                   │    │
│  │          endFrameCreated = true                                   │    │
│  │          store endFrameImage + endFrameImageUuid                  │    │
│  │          💾 SAVE (scene N end frame done)                         │    │
│  │      → fail:                                                      │    │
│  │          endFrameCreated stays false                               │    │
│  │          💾 SAVE (preserve progress)                              │    │
│  └───────────────────────────────────────────────────────────────────┘    │
│       │                                                                   │
│       ▼                                                                   │
│  ┌─ PHASE 3: Video Generation (if autoGenerateVideo) ────────────────┐    │
│  │  for each scene where imageCreated && !videoCreated:              │    │
│  │    startVideo(job)                                                │    │
│  │      → success:                                                   │    │
│  │          videoCreated = true                                      │    │
│  │          💾 SAVE (scene N video done)                             │    │
│  │      → fail:                                                      │    │
│  │          videoCreated stays false                                  │    │
│  │          💾 SAVE (preserve progress)                              │    │
│  └───────────────────────────────────────────────────────────────────┘    │
│       │                                                                   │
│       ▼                                                                   │
│  setResult({ success, completedSets, totalSets })                         │
│  💾 SAVE final (all flags reflect final outcome)                          │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

### Save Point Timeline (4-scene example)

```
Time →

Scene 0  Scene 1  Scene 2  Scene 3
─────────────────────────────────────── Phase 1: Start Frames
  img✅     img✅     img❌     (skip)
  💾        💾        💾

─────────────────────────────────────── Phase 2: End Frames
  end✅     end✅     (skip)   (skip)
  💾        💾

─────────────────────────────────────── Phase 3: Videos
  vid✅     vid✅
  💾        💾

Total save points: 8 (every artifact, success or fail)

If crash happens at ⚡ Scene 2 start frame:
  chrome.storage.local has: Scene 0 ✅✅✅, Scene 1 ✅✅✅, Scene 2 ❌❌❌, Scene 3 ❌❌❌
  Resume → skips Scene 0 & 1 entirely, starts at Scene 2 start frame
```

---

## Data Structure

### WorkflowCheckpoint

A serialization wrapper around existing state — no new fields invented.

```typescript
interface WorkflowCheckpoint {
  version: 1
  createdAt: number               // Date.now() when first created
  updatedAt: number               // Date.now() on each save

  // ── Config (all form inputs) ──
  config: {
    style: string
    aspectRatio: '9:16' | '16:9'
    imageCount: number
    noTextOnImage: boolean
    autoSaveImage: boolean
    downloadResolution: '1K' | '2K' | '4K'
    downloadToFolder: boolean
    autoGenerateVideo: boolean
    videoExtensionMode: boolean
    referenceStyle: string
    storyMood: string
    videoType: string
    storySceneCount: number
    storyTopic: string
    productName: string
    scene: string
  }

  // ── Story metadata ──
  story: {
    title: string
    characters: StoryCharacter[]
    storyboardPrompt: string
    // Optional — can be large (base64).
    // Controlled by "include images" toggle on export.
    storyboardPreviewImage?: string
    storyboardPreviewUuid?: string
  }

  // ── Per-scene data — the SceneData[] already in React state ──
  scenes: SceneData[]
}
```

### Where State Lives (before → after)

```
┌─ BEFORE (current) ──────────────────────────────────────────────────┐
│                                                                     │
│  useState hooks (ImageTab.tsx)          Ephemeral. Lost on reload.  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ style ──────────────── string                                │  │
│  │ aspectRatio ────────── '9:16' | '16:9'                       │  │
│  │ storyMood ──────────── string                                │  │
│  │ videoType ──────────── string                                │  │
│  │ ... (16 more config hooks)                                   │  │
│  │                                                              │  │
│  │ storyTitle ─────────── string                                │  │
│  │ storyCharacters ────── StoryCharacter[]                      │  │
│  │ storyboardPrompt ───── string                                │  │
│  │ storyboardPreviewImage string                                │  │
│  │                                                              │  │
│  │ scenes ─────────────── SceneData[]    ← progress lives here  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  No connection between these boxes.                                 │
│  No persistence. No export. No import.                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─ AFTER (proposed) ──────────────────────────────────────────────────┐
│                                                                     │
│  useState hooks (same)       WorkflowCheckpoint (serializable)      │
│  ┌──────────────────┐        ┌─────────────────────────────────┐   │
│  │ style            │───┐    │ {                               │   │
│  │ aspectRatio      │   │    │   version: 1,                   │   │
│  │ storyMood        │   ├──▶ │   config: { style, ... },       │   │
│  │ ...              │   │    │   story: { title, chars, ... },  │   │
│  │                  │   │    │   scenes: SceneData[]            │   │
│  │ storyTitle       │───┤    │ }                               │   │
│  │ storyCharacters  │───┘    └──────┬──────────────────────────┘   │
│  │                  │               │                               │
│  │ scenes[]         │◀──────────────┘  (import restores all)       │
│  └──────────────────┘               │                               │
│                              ┌──────┴──────────────────────┐       │
│                              │  chrome.storage.local       │       │
│                              │  (auto-save per artifact)   │       │
│                              │                             │       │
│                              │  + Export: .json file       │       │
│                              │  + Import: .json file       │       │
│                              └─────────────────────────────┘       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Auto-Save (Per-Artifact)

### Storage Key

```typescript
const CHECKPOINT_KEY = 'shopEnginX_workflow_checkpoint'
```

### Save Function

```typescript
async function saveCheckpoint(): Promise<void> {
  const checkpoint: WorkflowCheckpoint = collectCheckpoint()
  checkpoint.updatedAt = Date.now()

  // Strip base64 images to keep within storage limits
  const lightweight = stripBase64(checkpoint)

  await chrome.storage.local.set({ [CHECKPOINT_KEY]: lightweight })
}
```

### When to Save (every artifact boundary)

```typescript
// In handleCreate — PHASE 1: Start frames
for (let i = 0; i < total; i++) {
  if (currentScene.imageCreated) { /* skip */ continue }

  const result = await createStoryScene(startFramePrompt)

  if (result.success) {
    setScenes(prev => prev.map(s =>
      s.sceneIndex === i ? {
        ...s,
        imageCreated: true,
        startFrameImage: result.imageBase64,
        startFrameImageUuid: result.imageUuid,
      } : s
    ))
  }
  await saveCheckpoint()  // 💾 save after EVERY artifact attempt
}

// In handleCreate — PHASE 2: End frames
for (let i = 0; i < scenesWithEndFrame.length; i++) {
  if (currentScene.endFrameCreated) { /* skip */ continue }

  const result = await createStoryScene(endFramePrompt)

  if (result.success) {
    setScenes(prev => prev.map(s =>
      s.sceneIndex === i ? {
        ...s,
        endFrameCreated: true,
        endFrameImage: result.imageBase64,
        endFrameImageUuid: result.imageUuid,
      } : s
    ))
  }
  await saveCheckpoint()  // 💾 save after EVERY artifact attempt
}

// In handleCreate — PHASE 3: Videos
// (useVideoWorkflow calls saveCheckpoint after each job)
```

### What Gets Saved vs Stripped

```
┌─ Saved to chrome.storage.local (lightweight) ─────────────────────┐
│                                                                    │
│  config:  ✅ all fields (style, mood, videoType, etc.)            │
│  story:   ✅ title, characters, storyboardPrompt                  │
│           ❌ storyboardPreviewImage (stripped — too large)         │
│           ✅ storyboardPreviewUuid                                │
│  scenes:  ✅ all prompts, flags, UUIDs                            │
│           ❌ startFrameImage base64 (stripped)                     │
│           ❌ endFrameImage base64 (stripped)                       │
│           ✅ startFrameImageUuid (kept — small string)            │
│           ✅ endFrameImageUuid (kept — small string)              │
│                                                                    │
│  Total size: ~50-100 KB (safe for chrome.storage.local)           │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

┌─ Saved to .json export (full, optional) ──────────────────────────┐
│                                                                    │
│  Everything above PLUS:                                            │
│  ✅ storyboardPreviewImage (base64)                               │
│  ✅ startFrameImage (base64) per scene                            │
│  ✅ endFrameImage (base64) per scene                              │
│                                                                    │
│  Total size: 10-80 MB depending on scene count                    │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### On Extension Open — Resume Prompt

```
On extension open:
  loadCheckpoint()
    → if checkpoint found with incomplete scenes:

       ┌──────────────────────────────────────────────────┐
       │  พบงานค้าง                                       │
       │  Scene 1 ✅  Scene 2 ✅  Scene 3 ❌  Scene 4 ❌  │
       │  (2/4 start frames, 2/4 end frames, 0/4 videos)  │
       │                                                    │
       │  [ทำต่อ]     [เริ่มใหม่]     [ยกเลิก]            │
       └──────────────────────────────────────────────────┘

       [ทำต่อ]    → restoreCheckpoint() + handleCreate()
       [เริ่มใหม่] → clearCheckpoint()
       [ยกเลิก]   → dismiss, keep checkpoint for later
```

---

## Export / Import Flow

Manual export/import as a complement to auto-save. Useful for sharing, backup, or cross-device resume.

### Export

```
User clicks "💾 Export" button
    │
    ▼
collectCheckpoint(): WorkflowCheckpoint
    │  reads all useState values
    │  builds { version, config, story, scenes }
    │
    ├── "Include images?" checkbox
    │     ☑ → keep base64 fields (large file)
    │     ☐ → strip base64 fields (lightweight)
    │
    ▼
JSON.stringify(checkpoint, null, 2)
    │
    ├─── Option A: Download as .json file
    │      filename: shopEnginX-checkpoint-{timestamp}.json
    │
    └─── Option B: Copy to clipboard
           (for quick share / paste)
```

### Import

```
User clicks "📂 Import" / uploads .json
    │
    ▼
Parse JSON → validate version field
    │
    ▼
restoreCheckpoint(checkpoint)
    │
    ├── setStyle(config.style)
    ├── setAspectRatio(config.aspectRatio)
    ├── ... (all config setters)
    │
    ├── setStoryTitle(story.title)
    ├── setStoryCharacters(story.characters)
    ├── setStoryboardPrompt(story.storyboardPrompt)
    │
    └── setScenes(checkpoint.scenes)     ← restores progress flags + artifacts
```

After import, the UI immediately reflects per-artifact status:

```
Scene 1 (Hook):   ✅ startFrame  ✅ endFrame  ✅ video
Scene 2 (Story):  ✅ startFrame  ✅ endFrame  ❌ video
Scene 3 (Story):  ✅ startFrame  ❌ endFrame  ❌ video
Scene 4 (CTA):    ❌ startFrame  ❌ endFrame  ❌ video   ← resume from here
```

User can then:
- Click "สร้างรูปภาพ" to resume batch (skips completed artifacts)
- Click per-scene buttons to retry individual artifacts manually

---

## Resume Logic

### handleCreate Changes

Current loop always starts from scene 0:

```typescript
// CURRENT
for (let i = 0; i < total; i++) {
  // always runs every scene
}
```

Proposed — skip scenes where the relevant artifact is already done:

```typescript
// PROPOSED — Phase 1: Start frames
for (let i = 0; i < total; i++) {
  const currentScene = validScenes[i]
  if (currentScene.imageCreated) {
    completedScenes++
    // Restore charRef from scene 0 if needed
    if (i === 0 && currentScene.startFrameImageUuid) {
      autoCharRefUuid = currentScene.startFrameImageUuid
    }
    if (i === 0 && currentScene.startFrameImage) {
      autoCharRef = currentScene.startFrameImage
    }
    continue  // skip to next scene
  }
  // ... existing CREATE_STORY_SCENE logic
  await saveCheckpoint()  // 💾
}

// PROPOSED — Phase 2: End frames
for (let i = 0; i < scenesWithEndFrame.length; i++) {
  if (scenesWithEndFrame[i].endFrameCreated) continue
  // ... existing end frame logic
  await saveCheckpoint()  // 💾
}

// PROPOSED — Phase 3: Videos
const scenesForVideo = validScenes
  .filter(s => s.imageCreated && !s.videoCreated)
// ... only generate videos for scenes missing them
// saveCheckpoint() after each video job
```

### UUID Expiry Caveat

Google Flow UUIDs (`startFrameImageUuid`) may expire if the Flow session timed out between export and import. Handling:

```
On resume, if UUID-based reference fails:
  1. Fall back to base64 image (startFrameImage) if available in checkpoint
  2. If no base64 either → re-generate scene 0 first (it's the character reference)
  3. Log warning: "Reference image UUID expired, using base64 fallback"
```

This only matters for scenes after scene 0 that use scene 0's image as character reference.

---

## File Size Considerations

Base64 images in `SceneData` can be large:

| Content | ~Size per scene | 4 scenes | 8 scenes |
|---------|----------------|----------|----------|
| Prompts + metadata only | ~2 KB | ~8 KB | ~16 KB |
| + startFrameImage (base64) | ~2-5 MB | ~8-20 MB | ~16-40 MB |
| + endFrameImage (base64) | ~4-10 MB | ~16-40 MB | ~32-80 MB |
| + storyboardPreviewImage | +2-5 MB | — | — |

### Storage Strategy

| Storage | What's saved | Max size | Base64 images |
|---------|-------------|----------|---------------|
| `chrome.storage.local` (auto) | Config + story + scenes (UUIDs + flags) | ~50-100 KB | ❌ stripped |
| `.json` export (manual) | Full checkpoint, user chooses | 10-80 MB | ✅ optional toggle |

`chrome.storage.local` default limit is 10 MB (unlimited with `unlimitedStorage` permission). Stripping base64 keeps auto-save well within limits regardless.

---

## Implementation Checklist

| # | Task | Effort | Dependencies |
|---|------|--------|-------------|
| 1 | Define `WorkflowCheckpoint` interface | Small | — |
| 2 | `collectCheckpoint()` — read useState → build object | Small | #1 |
| 3 | `restoreCheckpoint()` — parse JSON → call all setters | Small | #1 |
| 4 | `saveCheckpoint()` — strip base64 → chrome.storage.local | Small | #2 |
| 5 | `loadCheckpoint()` — read from chrome.storage.local → validate | Small | #3 |
| 6 | `clearCheckpoint()` — remove from chrome.storage.local | Small | — |
| 7 | Add `saveCheckpoint()` call after every artifact in `handleCreate` | Small | #4 |
| 8 | Add `saveCheckpoint()` call after every video job in `useVideoWorkflow` | Small | #4 |
| 9 | Skip-completed logic in `handleCreate` (per-artifact) | Small | — |
| 10 | Restore `autoCharRefUuid`/`autoCharRef` from scene 0 on resume | Small | #9 |
| 11 | "Resume?" banner on extension open | Medium | #5, #3 |
| 12 | Export button + download/clipboard (with "include images" toggle) | Small | #2 |
| 13 | Import button + file upload + validation | Small | #3 |
