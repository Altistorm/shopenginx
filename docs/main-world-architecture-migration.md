# Architecture Migration: MAIN World Content Script

## Problem Statement

The current architecture uses an **isolated world** content script that cannot natively interact
with React/Radix UI components. This forces a fragile **mouse event simulation** pattern
(5-step PointerEvent/MouseEvent sequence) instead of simple `.click()` calls.

Additionally, all workflow state lives in the content script, which **dies on page refresh**.

### Current Pain Points

```
1. Mouse event simulation is fragile
   - 5 events per click: pointerdown → mousedown → pointerup → mouseup → click
   - Requires getBoundingClientRect() coordinate calculation
   - Breaks if Radix changes which events it listens to

2. Content script state dies on page refresh
   - FlowGenerationTracker (MutationObserver, timers, UUID sets)
   - VideoFlowController (observer, debug state)
   - All in-progress workflow data lost

3. SLATE_INSERT_TEXT still routes through background
   - content.ts → sendMessage → background.ts → executeScript(MAIN) → React fiber
   - Subject to the same sendMessage channel-close bug

4. Dead code in background.ts
   - CONFIGURE_FLOW_SETTINGS handler (~180 lines, nobody calls it)
   - Was replaced by content script mouse events, but never removed
```

---

## Architecture Comparison

### CURRENT: Isolated World + Mouse Events

```
┌────────────────────────────────────────────────────────────────────────┐
│                         CURRENT ARCHITECTURE                           │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  SIDE PANEL (React UI)                                                 │
│  ├── Workflow state (useVideoWorkflow, useStoryWorkflow)               │
│  ├── chrome.tabs.sendMessage(tabId, { type: ... })                     │
│  │                                                                     │
│  │         67 message types                                            │
│  │              │                                                      │
│  │              ▼                                                      │
│  │   CONTENT SCRIPT (ISOLATED WORLD) ── content.ts (7310 lines)       │
│  │   ├── chrome.runtime.onMessage listener (67 cases)                  │
│  │   ├── FlowGenerationTracker + MutationObserver                      │
│  │   ├── VideoFlowController + MutationObserver                        │
│  │   ├── configureFlowSettings() ← MOUSE EVENTS (fragile)             │
│  │   ├── All DOM interaction logic                                     │
│  │   │                                                                 │
│  │   │   For Radix UI interaction:                                     │
│  │   │   el.dispatchEvent(new PointerEvent('pointerdown', {x,y}))      │
│  │   │   el.dispatchEvent(new MouseEvent('mousedown', {x,y}))          │
│  │   │   el.dispatchEvent(new PointerEvent('pointerup', {x,y}))        │
│  │   │   el.dispatchEvent(new MouseEvent('mouseup', {x,y}))            │
│  │   │   el.click()                                                    │
│  │   │   ^^^ 5 steps per click, fragile                               │
│  │   │                                                                 │
│  │   │   For Slate editor (needs React fiber):                         │
│  │   ├── chrome.runtime.sendMessage('SLATE_INSERT_TEXT') ──────────┐   │
│  │   │                                                              │   │
│  │   │                                                              ▼   │
│  │   │                                                  BACKGROUND      │
│  │   │                                                  (623 lines)     │
│  │   │                                                  ├── SLATE:      │
│  │   │                                                  │   executeScript│
│  │   │                                                  │   (MAIN world)│
│  │   │                                                  ├── Downloads   │
│  │   │                                                  ├── Polling     │
│  │   │                                                  ├── sidePanel   │
│  │   │                                                  └── 💀 DEAD:    │
│  │   │                                                      CONFIGURE_  │
│  │   │                                                      FLOW (180L) │
│  │   │                                                                 │
│  │   ▼                                                                 │
│  │   GOOGLE FLOW PAGE (Radix UI + React + Slate)                       │
│  │                                                                     │
│  │   ⚠️  Content script is in ISOLATED world:                          │
│  │   ✅  Can see DOM (querySelector, textContent, MutationObserver)     │
│  │   ❌  Cannot see page JavaScript (React, Radix internals, Slate)     │
│  │   ❌  .click() ignored by Radix (different JS context)               │
│  │   ❌  State dies on page refresh                                     │
│  │                                                                     │
└────────────────────────────────────────────────────────────────────────┘
```

### PROPOSED: MAIN World Content Script + Isolated Bridge

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PROPOSED ARCHITECTURE                           │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  SIDE PANEL (React UI) ── STATE OWNER, survives page refresh           │
│  ├── Workflow state (useVideoWorkflow, useStoryWorkflow)               │
│  ├── Polling timers (moved from background)                            │
│  ├── chrome.storage.local (moved from background)                      │
│  ├── chrome.downloads.download (moved from background)                 │
│  ├── chrome.tabs.sendMessage(tabId, { type: ... })                     │
│  │                                                                     │
│  │         67 message types                                            │
│  │              │                                                      │
│  │              ▼                                                      │
│  │   CONTENT BRIDGE (ISOLATED WORLD) ── content-bridge.ts (~50 lines)  │
│  │   ├── chrome.runtime.onMessage → window.postMessage (relay TO main) │
│  │   ├── window.addEventListener → chrome.runtime.sendMessage (relay   │
│  │   │   FROM main back to side panel)                                 │
│  │   ├── No logic, pure relay                                          │
│  │   │                                                                 │
│  │   │         window.postMessage                                      │
│  │   │              │                                                  │
│  │   │              ▼                                                  │
│  │   │   CONTENT MAIN (MAIN WORLD) ── content-main.ts (all logic)     │
│  │   │   ├── window.addEventListener('message') (receives commands)     │
│  │   │   ├── FlowGenerationTracker + MutationObserver                  │
│  │   │   ├── VideoFlowController + MutationObserver                    │
│  │   │   ├── configureFlowSettings() ← SIMPLE .click() now works!     │
│  │   │   ├── Slate editor ← direct React fiber access, no background  │
│  │   │   ├── All 67 message handlers (DOM interaction)                 │
│  │   │   │                                                             │
│  │   │   │   For Radix UI interaction (MAIN world):                    │
│  │   │   │   button.click()  ← JUST THIS. React sees it natively.     │
│  │   │   │                                                             │
│  │   │   │   For Slate editor (MAIN world):                            │
│  │   │   │   fiber = el.__reactFiber$...                               │
│  │   │   │   slateEditor.insertText(text)  ← direct, no background    │
│  │   │   │                                                             │
│  │   │   ▼                                                             │
│  │   │   GOOGLE FLOW PAGE (Radix UI + React + Slate)                   │
│  │   │                                                                 │
│  │   │   ✅  MAIN world = same JS context as the page                  │
│  │   │   ✅  .click() works on Radix (React event delegation sees it)  │
│  │   │   ✅  Direct React fiber access (Slate, state inspection)       │
│  │   │   ✅  Simple DOM selectors for everything                       │
│  │   │   ❌  No chrome.* APIs (bridge handles that)                    │
│  │   │   ❌  State still dies on refresh (but that's OK — side panel   │
│  │   │       owns state now)                                           │
│  │   │                                                                 │
│  │                                                                     │
│  │   BACKGROUND (MINIMAL) ── background.ts (~15 lines)                 │
│  │   ├── chrome.sidePanel.setPanelBehavior (background-only API)       │
│  │   └── chrome.downloads.onDeterminingFilename (background-only API)  │
│  │       └── Redirect .mp4 downloads to ShopEnginX/ folder            │
│  │                                                                     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Message Flow Comparison

### Configuring Radix Settings (e.g., switch to video mode)

```
CURRENT (mouse events, fragile):

Side panel                    Content (ISOLATED)              Google Flow
    │                              │                              │
    │ sendMessage                  │                              │
    │ {type:'START_VIDEO_FLOW'}    │                              │
    ├─────────────────────────────►│                              │
    │                              │  configureFlowSettings()     │
    │                              │  querySelector('button')─────┤
    │                              │  getBoundingClientRect()◄────┤
    │                              │  PointerEvent(x,y)──────────►│
    │                              │  wait(50ms)                  │
    │                              │  MouseEvent(x,y)────────────►│
    │                              │  wait(50ms)                  │
    │                              │  PointerEvent(x,y)──────────►│
    │                              │  wait(50ms)                  │
    │                              │  MouseEvent(x,y)────────────►│
    │                              │  wait(50ms)                  │
    │                              │  .click()───────────────────►│ Radix maybe opens
    │                              │                              │
    │                              │  Total: 5 events + 200ms     │
    │                              │  per single click             │


PROPOSED (simple .click(), reliable):

Side panel                Bridge (ISOLATED)    Content (MAIN)      Google Flow
    │                         │                     │                  │
    │ tabs.sendMessage        │                     │                  │
    │ {type:'START_VIDEO'}    │                     │                  │
    ├────────────────────────►│                     │                  │
    │                         │ postMessage         │                  │
    │                         ├────────────────────►│                  │
    │                         │                     │ querySelector()  │
    │                         │                     │ button.click()───►│ Radix opens ✅
    │                         │                     │                  │
    │                         │                     │ Total: 1 call    │
```

### Inserting Text into Slate Editor

```
CURRENT (3-hop roundtrip through background):

Content (ISOLATED)           Background                    Google Flow (MAIN)
    │                            │                              │
    │ sendMessage                │                              │
    │ {action:'SLATE_INSERT'}    │                              │
    ├───────────────────────────►│                              │
    │                            │ executeScript(MAIN)          │
    │  ⚠️ sendMessage broadcast   ├─────────────────────────────►│
    │  ⚠️ channel may close       │                              │ find __reactFiber$
    │                            │                              │ traverse fiber tree
    │                            │          result              │ slateEditor.insertText()
    │                            │◄─────────────────────────────┤
    │         sendResponse       │                              │
    │◄───────────────────────────┤                              │
    │  ⚠️ may be undefined        │                              │


PROPOSED (direct, no background):

Side panel          Bridge (ISOLATED)    Content (MAIN)         Google Flow
    │                    │                    │                      │
    │ tabs.sendMessage   │                    │                      │
    │ {type:'SLATE'}     │                    │                      │
    ├───────────────────►│                    │                      │
    │                    │ postMessage        │                      │
    │                    ├───────────────────►│                      │
    │                    │                    │ el.__reactFiber$ ────┤
    │                    │                    │ slateEditor found    │
    │                    │                    │ .insertText(text) ──►│ ✅
    │                    │ postMessage        │                      │
    │                    │◄───────────────────┤                      │
    │ sendResponse       │                    │                      │
    │◄───────────────────┤                    │                      │
    │ { success: true }  │                    │                      │

    No background. No broadcast. No channel-close bug.
```

### Progress Reporting (MutationObserver → Side Panel)

```
CURRENT:

Content (ISOLATED)                                   Side panel
    │                                                    │
    │  MutationObserver fires                            │
    │  chrome.runtime.sendMessage({                      │
    │    action: 'generationProgress', ...               │
    │  }) ──────────────────────────────────────────────►│
    │                                                    │  onMessage listener
    │  ⚠️ broadcast to ALL listeners                      │
    │  ⚠️ background also receives (ignores)              │


PROPOSED:

Content (MAIN)              Bridge (ISOLATED)            Side panel
    │                           │                            │
    │  MutationObserver fires   │                            │
    │  window.postMessage({     │                            │
    │    type: 'PROGRESS', ...  │                            │
    │  })                       │                            │
    ├──────────────────────────►│                            │
    │                           │  chrome.runtime            │
    │                           │  .sendMessage({            │
    │                           │    action: 'progress'      │
    │                           │  }) ──────────────────────►│
    │                           │                            │  onMessage listener

    Same broadcast issue exists for progress messages.
    BUT: progress messages are fire-and-forget (no response needed).
    The channel-close bug only affects request/response patterns.
```

---

## File Changes

### New Files

```
src/content-main.ts      ← ALL logic from current content.ts
                            Runs in MAIN world (manifest registered)
                            Receives commands via window.addEventListener('message')
                            Sends results via window.postMessage

src/content-bridge.ts    ← Thin relay (~50 lines)
                            Runs in ISOLATED world (has chrome.* APIs)
                            Relays: chrome.runtime.onMessage → window.postMessage
                            Relays: window 'message' event → chrome.runtime.sendMessage
```

### Modified Files

```
src/background.ts        ← Shrink from 623 lines to ~15 lines
                            KEEP:  chrome.sidePanel.setPanelBehavior
                            KEEP:  chrome.downloads.onDeterminingFilename
                            MOVE TO SIDE PANEL:  getData / saveData (chrome.storage)
                            MOVE TO SIDE PANEL:  polling sessions
                            MOVE TO SIDE PANEL:  downloadImage / downloadImages / downloadImagesFromDataUrls
                            DELETE: CONFIGURE_FLOW_SETTINGS (dead code)
                            DELETE: SLATE_INSERT_TEXT (content-main.ts handles directly)
                            DELETE: keepAlive ports (no longer needed)

manifest.json            ← Register two content scripts
                            {
                              "content_scripts": [
                                {
                                  "matches": ["*://labs.google/*", ...],
                                  "js": ["src/content-bridge.ts"],
                                  "world": "ISOLATED"
                                },
                                {
                                  "matches": ["*://labs.google/*", ...],
                                  "js": ["src/content-main.ts"],
                                  "world": "MAIN"
                                }
                              ]
                            }

src/hooks/useVideoWorkflow.ts    ← Move polling logic here (from background)
src/hooks/useStoryWorkflow.ts    ← No change (already uses chrome.tabs.sendMessage)
src/tabs/ImageTab.tsx             ← No change (already uses chrome.tabs.sendMessage)
```

### Deleted Files

```
(none — content.ts becomes content-main.ts, content-bridge.ts is new)
```

---

## Migration Plan

### Phase 1: Create Bridge + Move Content to MAIN World

**Goal**: Get the two-script architecture working without changing any logic.

```
Step 1.1  Create content-bridge.ts (relay)
          - chrome.runtime.onMessage → window.postMessage
          - window 'message' → sendResponse (back to side panel)

Step 1.2  Copy content.ts → content-main.ts
          - Replace chrome.runtime.onMessage with window.addEventListener('message')
          - Replace chrome.runtime.sendMessage with window.postMessage
          - Remove all chrome.* API calls (bridge handles them)

Step 1.3  Update manifest.json
          - Register both content scripts with correct worlds
          - Remove old content.ts registration

Step 1.4  Verify all 67 message types still work
          - Side panel sends → bridge relays → main handles → bridge relays back
```

### Phase 2: Simplify Radix Interaction

**Goal**: Replace mouse event hacks with simple .click() calls.

```
Step 2.1  Replace configureFlowSettings() mouse event logic
          - Remove PointerEvent/MouseEvent simulation
          - Use button.click() directly (works in MAIN world)

Step 2.2  Remove clickRadixTrigger / clickRadixTab helpers
          - These exist only because isolated world needed event simulation

Step 2.3  Simplify SLATE_INSERT_TEXT
          - Direct React fiber access in content-main.ts
          - Remove the background.ts SLATE handler entirely
          - Remove the sendMessage roundtrip from content
```

### Phase 3: Slim Down Background

**Goal**: Move everything possible out of background.ts.

```
Step 3.1  Move download logic to side panel
          - chrome.downloads.download is available in side panel
          - Move downloadImage, downloadImages, downloadImagesFromDataUrls

Step 3.2  Move polling to side panel
          - startPolling / stopPolling / pollingSessions
          - Side panel already has timers and survives refresh

Step 3.3  Move storage to side panel
          - getData / saveData (chrome.storage.local)
          - Side panel already has chrome.storage

Step 3.4  Delete dead code from background.ts
          - CONFIGURE_FLOW_SETTINGS handler (180 lines, dead)
          - keepAlive ports (no longer needed without long background tasks)

Step 3.5  Final background.ts (~15 lines):
          chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
          chrome.downloads.onDeterminingFilename.addListener(...)
```

### Phase 4: Verify & Clean Up

```
Step 4.1  Test all workflows end-to-end
          - Image generation flow
          - Video generation flow
          - Story mode pipeline
          - TikTok follower flow
          - Download flows

Step 4.2  Test page refresh resilience
          - Start workflow → refresh Google Flow → side panel retains state
          - Content scripts re-inject automatically via manifest

Step 4.3  Remove old content.ts
          - content-main.ts is the replacement
          - Verify no imports reference the old file
```

---

## Risk Assessment

```
RISK                              SEVERITY   MITIGATION
────                              ────────   ──────────
MAIN world content script         HIGH       Test early in Phase 1.
not auto-injecting on all                    Verify manifest match patterns.
target pages                                 Check CRXJS Vite plugin support.

window.postMessage security       MEDIUM     Use a unique message prefix/type
(any page JS can send messages)              (e.g., { __shopEnginX: true }).
                                             Validate origin in bridge.

CRXJS Vite plugin may not         MEDIUM     Test with dev build first.
support world: 'MAIN' in                     May need to use
manifest content_scripts                     chrome.scripting.registerContentScripts
                                             from background as fallback.

67 message types to migrate       LOW        Mechanical change. Each case statement
                                             stays identical, only the transport changes.

MutationObserver behavior         LOW        MAIN world observers work identically
difference in MAIN world                     to isolated world for DOM mutations.
```

---

## Key Insight: Why This Works

```
ISOLATED WORLD                              MAIN WORLD
══════════════                              ══════════

button.click()                              button.click()
    │                                           │
    ▼                                           ▼
DOM Event fires                             DOM Event fires
    │                                           │
    ▼                                           ▼
Bubbles to document root                    Bubbles to document root
    │                                           │
    ▼                                           ▼
React root listener?                        React root listener ✅
❌ Different JS context                      Same JS context
   React doesn't process it                  React routes to Radix handler
   Radix state doesn't change                Dropdown opens, tab switches ✅

The event is identical. The difference is which JS context it originates from.
MAIN world events are "trusted" by React's event delegation because they share
the same window object and event system.
```
