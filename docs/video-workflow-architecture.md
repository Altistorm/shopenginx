# Video Workflow Architecture

## Overview

The video generation workflow is implemented in `shopenginx/src/content.ts` via the `VideoFlowController` class. It automates Google Flow (labs.google/fx/tools/flow) to generate videos from prompts with optional start frame images.

## Key Files

| File | Purpose |
|------|---------|
| `shopenginx/src/content.ts` | `VideoFlowController` class, step functions, execution engine |
| `shopenginx/src/tabs/VideoTab.tsx` | Sidebar UI — photo upload, prompts, settings, progress display |
| `shopenginx/src/background.ts` | Chrome extension background script |

## Core Classes & Interfaces

```
VideoFlowController     — Main workflow controller (content.ts)
VideoSetConfig           — Workflow configuration (image, prompts, aspectRatio, outputCount, autoDownload)
StepRetryConfig          — Per-step retry settings (maxAttempts, retryDelayMs, timeoutMs)
VideoProgressEvent       — Progress reporting (step, attempt, status, promptIndex, etc.)
VideoFlowResult          — Workflow result (success, error, completedPrompts, downloaded)
```

## Communication Flow

```
VideoTab.tsx (Sidebar)
    │
    │  chrome.tabs.sendMessage({ type: 'START_VIDEO_WORKFLOW', image, prompts, ... })
    │
    ▼
content.ts (Content Script)
    │
    │  Receives message → Creates VideoFlowController → executeSet()
    │
    │  Progress events sent back via:
    │  chrome.runtime.sendMessage({ type: 'VIDEO_PROGRESS', step, status, ... })
    │
    ▼
VideoTab.tsx (Sidebar)
    │
    │  useEffect listener receives VIDEO_PROGRESS → updates UI
    │
    ▼
  Result returned via sendResponse()
```

---

## Complete Workflow Steps

```
┌─────────────────────────────────────────────────────────┐
│ Phase 0: Create New Project                             │
│                                                         │
│  createNewProject                                       │
│  ├─ Navigate to https://labs.google/fx/tools/flow       │
│  ├─ Wait for "New project" button                       │
│  ├─ Click "+ New project"                               │
│  ├─ Wait for /project/{uuid} URL                        │
│  └─ Wait for prompt textbox visible                     │
├─────────────────────────────────────────────────────────┤
│ Phase 1: Setup                                          │
│                                                         │
│  ensureVideoMode                                        │
│  └─ Switch to "Frames to Video" mode (if needed)        │
│                                                         │
│  configureSettings                                      │
│  ├─ Open Settings dialog                                │
│  ├─ Set Aspect Ratio (9:16 or 16:9)                     │
│  ├─ Set Output Count (1-4)                              │
│  └─ Close Settings dialog                               │
├─────────────────────────────────────────────────────────┤
│ Phase 2: Upload Image (if provided)                     │
│                                                         │
│  uploadImage                                            │
│  ├─ Click "add" frame button                            │
│  ├─ Upload base64 image via file input                  │
│  ├─ Handle "Notice" dialog (I agree)                    │
│  ├─ Select crop aspect ratio                            │
│  ├─ Click "Crop and Save"                               │
│  └─ Wait for image in frame slot                        │
├─────────────────────────────────────────────────────────┤
│ Phase 3: Initial Generation                             │
│                                                         │
│  fillPrompt          (delay 1s first)                   │
│  ├─ Find textbox                                        │
│  ├─ Set prompt text                                     │
│  └─ Wait for Create button enabled                      │
│                                                         │
│  clickCreate                                            │
│  ├─ Click "Create" button                               │
│  └─ Wait for percentage to appear                       │
│                                                         │
│  waitForInitialComplete                                 │
│  ├─ Wait for percentage to disappear                    │
│  ├─ Delay 1s                                            │
│  └─ Check "Add to scene" button exists (success check)  │
├─────────────────────────────────────────────────────────┤
│ Phase 4: Add to Scene                                   │
│                                                         │
│  clickAddToScene                                        │
│  ├─ Click "Add to scene" button                         │
│  ├─ Wait for URL to contain /scenes/                    │
│  └─ Delay 1s (SceneBuilder loading)                     │
├─────────────────────────────────────────────────────────┤
│ Phase 5: Extensions (loop for each extension prompt)    │
│                                                         │
│  ┌─ FOR i = 1 to N (extension prompts) ──────────────┐  │
│  │                                                    │  │
│  │  enterExtendMode                                   │  │
│  │  ├─ Wait for timeline clips visible                │  │
│  │  ├─ Select last clip                               │  │
│  │  ├─ Wait for "Add clip after last clip" button     │  │
│  │  ├─ Delay 1s (UI readiness)                        │  │
│  │  ├─ Click "+" button                               │  │
│  │  ├─ Wait for "Extend..." menu item                 │  │
│  │  ├─ Click "Extend..."                              │  │
│  │  ├─ Wait for "What happens next?" textbox          │  │
│  │  └─ configureSettings (aspect ratio + output)      │  │
│  │                                                    │  │
│  │  fillExtensionPrompt                               │  │
│  │  ├─ Find "What happens next?" textbox              │  │
│  │  ├─ Set extension prompt text                      │  │
│  │  └─ Wait for Create button enabled                 │  │
│  │                                                    │  │
│  │  clickCreate                                       │  │
│  │  ├─ Click "Create" button                          │  │
│  │  └─ Wait for percentage to appear                  │  │
│  │                                                    │  │
│  │  waitForExtensionComplete                          │  │
│  │  ├─ Wait for percentage to disappear               │  │
│  │  ├─ Delay 1s                                       │  │
│  │  ├─ Check still in /scenes/ URL                    │  │
│  │  └─ Check clip count increased (success check)     │  │
│  │                                                    │  │
│  └────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│ Phase 6: Download (if autoDownload)                     │
│                                                         │
│  downloadVideo                                          │
│  ├─ Click "Download" button                             │
│  └─ Wait for "Video exported!" or button re-enabled     │
└─────────────────────────────────────────────────────────┘
```

---

## Retry Configuration

| Step | Max Attempts | Retry Delay | Timeout |
|------|-------------|-------------|---------|
| createNewProject | 3 | 2s | 30s |
| ensureVideoMode | 3 | 1s | 30s |
| configureSettings | 2 | 1s | 30s |
| uploadImage | 3 | 2s | 60s |
| fillPrompt | 2 | 500ms | 10s |
| clickCreate | 3 | 2s | 30s |
| waitForInitialComplete | 1 | — | 10 min |
| clickAddToScene | 3 | 1s | 30s |
| enterExtendMode | 3 | 1s | 30s |
| fillExtensionPrompt | 2 | 500ms | 10s |
| waitForExtensionComplete | 1 | — | 10 min |
| downloadVideo | 3 | 3s | 2 min |

---

## Execution Engine

The `executeStep()` method (content.ts) wraps each step with:
1. **Retry logic** — loops up to `maxAttempts`, delays between retries
2. **Progress reporting** — sends status (running/success/retrying/failed) per attempt
3. **Abort checking** — checks `this.aborted` flag before each attempt

The `waitFor()` method uses a **MutationObserver** on `document.body` for efficient DOM change detection instead of polling.

---

## Error Detection Patterns

| Phase | Success Indicator | Error Behavior |
|-------|------------------|----------------|
| Initial generation | `findButtonByText('Add to scene')` exists | Throws immediately after % disappears |
| Extension generation | `clipCount >= expectedClipCount` | Throws immediately after % disappears |
| Both | Percentage disappears first, then check | Two-phase: wait for % gone → check success |

---

## Google Flow DOM Selectors

| Element | Selector / Method | Context |
|---------|-------------------|---------|
| "+ New project" button | `findButtonByText('New project')` | Flow homepage |
| Mode dropdown | `[role="combobox"]` with "Frames to Video" | Project editor |
| Settings button | `findButtonByText('Settings')` | Project editor / SceneBuilder |
| Settings dialog | `[role="dialog"]` | After clicking Settings |
| Aspect Ratio combobox | Text "Aspect Ratio" inside dialog | Settings dialog |
| Outputs per prompt | Text "Outputs per prompt" inside dialog | Settings dialog |
| Prompt textbox | `textarea, input[type="text"]` | Project editor |
| Create button | `findButtonByText('Create')` | Project editor / SceneBuilder |
| Add to scene button | `findButtonByText('Add to scene')` | After initial generation |
| Add clip button | `findButtonByText('Add clip after last clip')` | SceneBuilder timeline |
| Extend menu item | `[role="menuitem"]` with "Extend" | After clicking + button |
| Extension textbox | `[placeholder*="What happens next"]` | SceneBuilder extend mode |
| Download button | `findButtonByText('Download')` | SceneBuilder |

---

## Known Issues & Workarounds

### 1. fillPrompt fails on first attempt (React state race)
- **Symptom**: Create button stays disabled after setting prompt text
- **Root cause**: React doesn't detect `textbox.value = ...` + synthetic events
- **Workaround**: 1s delay added before finding textbox; retry covers remaining cases

### 2. enterExtendMode fails on first attempt (UI not ready)
- **Symptom**: "Add clip after last clip" button click doesn't open menu
- **Root cause**: SceneBuilder UI not fully interactive after page transition
- **Workaround**: 1s delay added before clicking the button

### 3. Extension generation "high demand" error
- **Symptom**: Google returns server error, generation fails silently
- **Root cause**: Google Flow rate limiting
- **Fix**: Two-phase error detection (wait for % disappear → check clip count)
- **Not yet fixed**: No retry for generation failures (maxAttempts: 1)

### 4. Content script dies on page navigation
- **Impact**: Cannot loop through multiple images inside content script
- **Solution**: Sidebar extension (VideoTab.tsx) controls the batch loop, sends one workflow per image
