# Action Resolver - Flow Workflow

The Action Resolver is the decision engine that determines which action to execute on each cycle of the workflow.

## Execution Modes

### 1. Auto Run Workflow (Default: ON)
When **⚡ Auto Run Workflow** checkbox is enabled:
- Runs all actions automatically in a loop
- Continues until workflow is complete or max iterations (100) reached
- 500ms delay between actions to prevent browser overload

### 2. Single Step Mode
When **⚡ Auto Run Workflow** checkbox is disabled:
- Runs only ONE action per button click
- User must click button multiple times to progress through workflow
- Useful for debugging or step-by-step execution

## Overview

The Action Resolver follows a **decision tree pattern**, not a linear sequence. On each cycle, it evaluates the current state and decides the next action.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Action Resolver (each cycle)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ Show Overlay    │
                    └────────┬────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │ Is Create Image mode set?    │──No──▶ selectCreateImageMode
              └──────────────┬───────────────┘
                             │ Yes
                             ▼
              ┌──────────────────────────────┐
              │ Are settings configured?     │──No──▶ configureSettings
              └──────────────┬───────────────┘
                             │ Yes
                             ▼
              ┌──────────────────────────────┐
              │ checkAllImagesUploaded()     │
              │ Sets ctx.isImageUploaded     │
              └──────────────┬───────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │ All images uploaded?         │──Yes─┬─▶ fillPrompt (if not filled)
              └──────────────┬───────────────┘      ├─▶ clickCreate (if filled)
                             │ No                   └─▶ null (if create clicked)
                             ▼
              ┌──────────────────────────────┐
              │ Is crop dialog open?         │──Yes──▶ confirmCrop
              └──────────────┬───────────────┘
                             │ No
                             ▼
              ┌──────────────────────────────┐
              │ Is image picker open?        │──Yes──▶ uploadImage
              └──────────────┬───────────────┘
                             │ No
                             ▼
                      openImagePicker
```

## Step-by-Step Breakdown

### Step 1: Show Overlay
```typescript
await node.runAction('showNodeOverlay', ctx);
```
Displays the workflow status overlay on the page showing current node and state.

---

### Step 2: Check Create Image Mode
```typescript
await node.runAction('checkCreateImageMode', ctx);
if (!ctx.isCreateImageModeSelected) {
  return 'selectCreateImageMode';
}
```
- **Check**: Verifies if "Create Image" mode is selected in the dropdown
- **Action**: `selectCreateImageMode` - Opens dropdown and selects "Create Image"

---

### Step 3: Configure Settings
```typescript
if (!ctx.isSettingsConfigured) {
  return 'configureSettings';
}
```
- **Check**: `ctx.isSettingsConfigured` flag
- **Action**: `configureSettings` - Opens settings dialog, sets aspect ratio and output count

---

### Step 4: Check All Images Uploaded
```typescript
await node.runAction('checkAllImagesUploaded', ctx);
```
This action sends `CHECK_ALL_IMAGES_UPLOADED` message to content script and checks:

| Check | Description |
|-------|-------------|
| `hasSpinnerInPromptBox` | Looks for `progress_activity` text in prompt area |
| `hasDisabledSlot` | Checks for disabled buttons (upload in progress) |
| `promptBoxImageCount` | Counts buttons with "This is your ingredient" text |

**Completion Criteria**:
```typescript
isComplete = !hasSpinnerInPromptBox &&
             !hasDisabledSlot &&
             promptBoxImageCount >= expectedCount
```

---

### Step 5: Fill Prompt (if images uploaded)
```typescript
if (ctx.isImageUploaded && !ctx.isPromptFilled) {
  return 'fillPrompt';
}
```
- **Condition**: All images uploaded AND prompt not yet filled
- **Action**: `fillPrompt` - Generates and fills the prompt based on style settings

---

### Step 6: Click Create (if prompt filled)
```typescript
if (ctx.isImageUploaded && ctx.isPromptFilled && !ctx.isCreateClicked) {
  return 'clickCreate';
}
```
- **Condition**: All images uploaded AND prompt filled AND create not clicked
- **Action**: `clickCreate` - Clicks Create button and waits for generation to complete

---

### Step 7: Workflow Complete
```typescript
if (ctx.isCreateClicked) {
  return null; // Move to next node
}
```
- **Condition**: Create has been clicked
- **Result**: Returns `null` to signal workflow completion

---

### Step 8: Check Crop Dialog
```typescript
await node.runAction('checkCropDialogOpen', ctx);
if (ctx.isCropDialogOpen) {
  return 'confirmCrop';
}
```
- **Check**: Looks for "Crop and Save" button on page
- **Action**: `confirmCrop` - Selects aspect ratio and clicks "Crop and Save"

---

### Step 9: Check Image Picker
```typescript
await node.runAction('checkImagePickerOpen', ctx);
if (ctx.isImagePickerOpen) {
  const currentIndex = ctx.currentImageIndex ?? 0;
  if (currentIndex < ctx.images.length) {
    return 'uploadImage';
  }
}
```
- **Check**: Looks for file input element on page
- **Action**: `uploadImage` - Uploads the next image from the queue

---

### Step 10: Open Image Picker
```typescript
return 'openImagePicker';
```
- **Default Action**: Opens the image picker by clicking the "add" button

---

## Context State Flags

| Flag | Type | Description |
|------|------|-------------|
| `isCreateImageModeSelected` | boolean | Create Image mode is selected |
| `isSettingsConfigured` | boolean | Aspect ratio and output count configured |
| `isImageUploaded` | boolean | All images uploaded to prompt box |
| `isPromptFilled` | boolean | Prompt text has been filled |
| `isCreateClicked` | boolean | Create button has been clicked |
| `isImagePickerOpen` | boolean | Image picker menu is open |
| `isCropDialogOpen` | boolean | Crop dialog is visible |
| `currentImageIndex` | number | Index of current image being uploaded |

---

## Upload Flow Detail

The image upload process follows this sub-flow:

```
openImagePicker ──▶ uploadImage ──▶ confirmCrop ──▶ (repeat)
      │                  │               │
      │                  │               └── Increments currentImageIndex
      │                  │
      │                  └── Uploads image[currentImageIndex]
      │
      └── Clicks "add" button, opens file picker menu
```

After all images are uploaded, `checkAllImagesUploaded` returns `true` and the flow proceeds to `fillPrompt`.

---

## Message Types (Content Script)

| Message Type | Purpose |
|--------------|---------|
| `CHECK_CREATE_IMAGE_MODE` | Check if Create Image is selected |
| `SELECT_CREATE_IMAGE_MODE` | Select Create Image from dropdown |
| `CHECK_IMAGE_PICKER_OPEN` | Check if file input exists |
| `OPEN_IMAGE_PICKER` | Click add button to open picker |
| `UPLOAD_FILE` | Upload image to file input |
| `CHECK_CROP_DIALOG_OPEN` | Check if crop dialog is visible |
| `HANDLE_CROP_DIALOG` | Select aspect ratio and confirm crop |
| `CHECK_ALL_IMAGES_UPLOADED` | Verify all images in prompt box |
| `FILL_PROMPT` | Fill the prompt textbox |
| `CLICK_CREATE` | Click the Create button |

---

## File Locations

- **Workflow Definition**: `src/flowWorkflow.ts`
- **Content Script**: `src/content.ts`
- **Overlay**: `src/overlay.ts`
