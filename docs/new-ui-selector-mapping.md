# Google Flow New UI — Complete Selector Mapping

> Generated from Playwright inspection of `https://labs.google/fx/tools/flow` (Feb 2026)
> Maps every broken selector in `content.ts` to the new UI equivalent.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ❌ | Selector is broken / element no longer exists |
| ⚠️ | Selector partially works but behavior changed |
| ✅ | Selector still works (no change needed) |

---

## 1. `ensureCreateImageMode()` — Lines 3217–3257

**Purpose**: Ensure the editor is in "Create Image" mode (vs Edit, Upscale, etc.)

| # | Old Selector / Pattern | Status | New Selector / Pattern | Notes |
|---|------------------------|--------|------------------------|-------|
| 1 | `document.querySelector('[role="combobox"]')` to check mode | ❌ | **No combobox exists.** Mode is now set via **Type tabs** inside the model selector popup. Open the model selector button → look for `tablist` → `tab "image Image"` | The concept of "Create Image" mode no longer exists as a dropdown. Instead, the new UI has Image/Video **tabs** inside the settings popup. |
| 2 | `textContent?.includes('Create Image')` to verify mode | ❌ | Check if the Image tab is selected: `tab[aria-selected="true"]` containing "Image" text | |
| 3 | `button/[role="combobox"]` with `arrow_drop_down` text | ❌ | The model selector button shows text like `"🍌 Nano Banana Pro crop_9_16 x1"` — click this to open settings popup | |
| 4 | `[role="listbox"]` → `[role="option"]` with "Create Image" | ❌ | Inside popup: `tablist` → click `tab` with text "image Image" | |

**New Flow**:
1. Click the model selector button (contains model name + aspect ratio icon + count)
2. In the popup `menu`, find the `tablist` containing Image/Video tabs
3. Click the "image Image" tab if not already selected
4. Close popup (click outside or press Escape)

---

## 2. `configureSettings()` — Lines 3262–3389

**Purpose**: Open settings dialog, set aspect ratio and output count.

| # | Old Selector / Pattern | Status | New Selector / Pattern | Notes |
|---|------------------------|--------|------------------------|-------|
| 1 | `findButtonByText('Settings')` | ❌ | **No Settings button.** Click the **model selector button** (e.g. `"🍌 Nano Banana Pro crop_9_16 x1"`) to open settings popup | Settings are now embedded in the model selector popup |
| 2 | `[role="dialog"]` for settings container | ❌ | `menu` element (the popup that appears) | It's a `menu`, not a `dialog` |
| 3 | `[role="combobox"]` with "Aspect Ratio" | ❌ | **Tabs**: `tablist` → `tab "crop_16_9 Landscape"` / `tab "crop_9_16 Portrait"` | Aspect ratio is now a tab group, not a combobox dropdown |
| 4 | `[role="option"]` with "Landscape"/"Portrait" | ❌ | Click the corresponding `tab` directly | |
| 5 | `[role="combobox"]` with "Outputs per prompt" | ❌ | **Tabs**: `tablist` → `tab "x1"` / `tab "x2"` / `tab "x3"` / `tab "x4"` | Output count is also a tab group now |
| 6 | `[role="option"]` with count number | ❌ | Click the corresponding `tab` (e.g. `tab "x4"`) | |
| 7 | Close dialog with Escape → wait `[role="dialog"]` gone | ❌ | Close popup by clicking outside or Escape → wait for `menu` element to disappear | |

**New Flow**:
1. Click model selector button (the one showing model name/aspect/count)
2. In popup `menu`, find aspect ratio `tablist` → click correct tab (Landscape/Portrait)
3. Find output count `tablist` → click correct tab (x1/x2/x3/x4)
4. Click outside to close popup

---

## 3. `openImagePicker()` — Lines 3583–3642

**Purpose**: Click the "+" button in prompt area to trigger image upload.

| # | Old Selector / Pattern | Status | New Selector / Pattern | Notes |
|---|------------------------|--------|------------------------|-------|
| 1 | `document.querySelector('[role="presentation"]')` for prompt area | ⚠️ | **Needs verification** — the prompt area structure may have changed. The new UI has a contenteditable `textbox` instead. | |
| 2 | Button with `textContent?.trim() === 'add'` | ❌ | **Two "Create" buttons exist now**: `button "add_2 Create"` (opens asset picker) and `button "arrow_forward Create"` (submits prompt). Need to click `"add_2 Create"` | The old `add` icon button is replaced by `add_2 Create` button |
| 3 | `input[type="file"]` appearing after click | ⚠️ | The `add_2 Create` button opens a **dialog** (asset picker) containing `textbox "Search for Assets"` and `button "upload Upload image"`. Must click "Upload image" first, THEN look for file input | Two-step process now: (1) click "add_2 Create", (2) click "upload Upload image" in dialog |

**New Flow**:
1. Click `button "add_2 Create"` (the one with `add_2` icon, NOT `arrow_forward`)
2. Wait for asset picker dialog to appear
3. Click `button "upload Upload image"` inside the dialog
4. Wait for `input[type="file"]` to appear
5. Upload programmatically as before

---

## 4. `uploadImage()` — Lines 3649–3685

**Purpose**: Set file on the file input element.

| # | Old Selector / Pattern | Status | New Selector / Pattern | Notes |
|---|------------------------|--------|------------------------|-------|
| 1 | `document.querySelector('input[type="file"]')` | ⚠️ | Same selector, but it now appears **after** clicking "Upload image" in the asset picker dialog, not immediately after clicking "add" | Timing changed — need to wait for asset picker dialog first |
| 2 | DataTransfer + change/input events | ✅ | Same approach should work | |

---

## 5. `handleCrop()` — Lines 3704–3835

**Purpose**: Select aspect ratio in crop dialog and click "Crop and Save".

| # | Old Selector / Pattern | Status | New Selector / Pattern | Notes |
|---|------------------------|--------|------------------------|-------|
| 1 | `[role="dialog"]` for crop dialog | ⚠️ | **Needs verification** — crop dialog may still use `[role="dialog"]` or may have been replaced | |
| 2 | `[role="combobox"]` with Landscape/Portrait in dialog | ⚠️ | May have changed to tabs like the settings popup | |
| 3 | `[role="option"]` with Landscape/Portrait | ⚠️ | May now be `tab` elements | |
| 4 | Button with "Crop and Save" text | ⚠️ | **Needs verification** — may still exist or may have changed to different text | |
| 5 | `btn.textContent?.includes('This is your ingredient')` for counting ingredients | ⚠️ | **Needs verification** — ingredient buttons may have different text in new UI | |

**Note**: Crop dialog needs re-inspection with Playwright since we didn't go through a full upload flow.

---

## 6. `fillPrompt()` — Lines 3875–3896

**Purpose**: Fill the prompt text input.

| # | Old Selector / Pattern | Status | New Selector / Pattern | Notes |
|---|------------------------|--------|------------------------|-------|
| 1 | `document.querySelector('textarea, input[type="text"]')` | ❌ | `[role="textbox"]` or `[contenteditable="true"]` — the new prompt is a **contenteditable div**, not a textarea/input | |
| 2 | Setting `.value` + dispatching `input`/`change` events | ❌ | For contenteditable: set `.textContent` or `.innerText`, then dispatch `input` event. Or use `document.execCommand('insertText', false, prompt)` for React compatibility | contenteditable elements don't have `.value` |
| 3 | `findButtonByText('Create')` to check if enabled | ⚠️ | Need to check for `button "arrow_forward Create"` (the submit button, NOT `"add_2 Create"`) | Two Create buttons exist now |

**New Flow**:
1. Find `[role="textbox"]` or the contenteditable element with placeholder "What do you want to create?"
2. Focus it
3. Clear existing content
4. Set text via `document.execCommand('insertText', false, prompt)` or programmatic approach
5. Wait for `button "arrow_forward Create"` to become enabled

---

## 7. `clickCreate()` — Lines 3901–3925

**Purpose**: Click the Create button to start generation.

| # | Old Selector / Pattern | Status | New Selector / Pattern | Notes |
|---|------------------------|--------|------------------------|-------|
| 1 | Find button with `Create` AND `arrow_forward` text | ⚠️ | `button "arrow_forward Create"` — same logic but need to be MORE SPECIFIC because `"add_2 Create"` also exists | Must ensure we click the RIGHT Create button |
| 2 | Check `!btn.hasAttribute('disabled')` | ✅ | Same check should work | |

**Key Risk**: The old code searches for buttons containing both "Create" and "arrow_forward". This still works IF the new UI keeps these as text content. But there are now TWO Create buttons:
- `button "add_2 Create"` → Opens asset picker (WRONG)
- `button "arrow_forward Create"` → Submits prompt (CORRECT)

The existing filter `btn.textContent?.includes('Create') && btn.textContent?.includes('arrow_forward')` should correctly match only the submit button. **Likely still works.**

---

## 8. `waitForGeneration()` / Generation Status — Lines 3930–3940, 5510–5556

**Purpose**: Wait for images to generate by watching for percentage indicators and completion.

| # | Old Selector / Pattern | Status | New Selector / Pattern | Notes |
|---|------------------------|--------|------------------------|-------|
| 1 | TreeWalker looking for `\d{1,3}%` text | ⚠️ | **Needs verification** — loading indicators may have changed in new UI | |
| 2 | `div[class*="sc-6349d8ef-5"]` for error containers | ❌ | Styled-component class hashes change between builds. Need structural detection instead | |
| 3 | Text `"Couldn't generate image"` for error detection | ⚠️ | Error text might have changed | |

---

## 9. `collectAllImageUUIDs()` — Lines 3086–3128

**Purpose**: Scroll gallery to collect all image UUIDs for recovery tracking.

| # | Old Selector / Pattern | Status | New Selector / Pattern | Notes |
|---|------------------------|--------|------------------------|-------|
| 1 | `[class*="sc-c884da2c"]` for scroll container | ❌ | Styled-component class hashes change. Need structural detection: find scrollable div containing gallery images | |
| 2 | `[role="main"]` fallback | ⚠️ | May or may not exist in new UI | |
| 3 | `img[alt^="Flow Image:"]` for finding images | ❌ | `img[alt="Generated image"]` — all images now use this generic alt text | Cannot extract UUID from alt text anymore |
| 4 | Extracting UUID from `img.src` | ⚠️ | Image `src` URLs have changed. Old: `/image/{uuid}`. New: links go to `/edit/{mediaId}` pages. Need to check if `src` still contains UUID | |

**Critical**: This is a major change. The old gallery showed `img[alt^="Flow Image:"]` with UUIDs in the `src`. New gallery shows `img[alt="Generated image"]`. Need to verify what identifiers are available in the new `src` URLs.

---

## 10. `clickAddToPromptByImageUuid()` — Lines 3459–3573

**Purpose**: Add a gallery image as ingredient by hovering and clicking "Add To Prompt".

| # | Old Selector / Pattern | Status | New Selector / Pattern | Notes |
|---|------------------------|--------|------------------------|-------|
| 1 | `button[role="radio"]` with "Images" text | ❌ | Sidebar buttons: `button "image View images"` | Gallery filter changed from radio buttons to sidebar buttons |
| 2 | `aria-checked="true"` to verify active tab | ❌ | Need to check active state differently — possibly `aria-selected` or `aria-pressed` | |
| 3 | `img[src*="${imageUuid}"]` to find image | ⚠️ | May still work IF UUID is in the src URL. **Needs verification.** | |
| 4 | Hover → "Add To Prompt" button | ❌ | Hover actions changed to: "Favorite" / "Reuse prompt" / "More" — **"Add To Prompt" no longer exists** | This is a MAJOR breaking change |
| 5 | "Remove From Prompt" for checking if already added | ❌ | No longer exists since "Add To Prompt" was removed | |

**Critical**: The "Add To Prompt" hover action has been completely removed from the gallery. The new hover actions are:
- **Favorite** (heart icon)
- **Reuse prompt**
- **More** (three dots menu)

This means the entire `clickAddToPromptByImageUuid` flow needs to be redesigned. Possible alternatives:
1. Use the new "add_2 Create" asset picker to add existing images
2. Find if there's a drag-and-drop mechanism
3. Check if "More" menu contains an add-to-prompt option

---

## 11. `findImageGalleryScrollContainer()` — Lines 3398–3411

**Purpose**: Find the scrollable gallery container for scrolling to find images.

| # | Old Selector / Pattern | Status | New Selector / Pattern | Notes |
|---|------------------------|--------|------------------------|-------|
| 1 | Structural detection: scrollable div with `img[alt^="Flow Image:"]` | ❌ | Change to: scrollable div with `img[alt="Generated image"]` | |

---

## 12. `clearPromptBox()` — Lines 4129–4163

**Purpose**: Remove all ingredient images from prompt box for next set.

| # | Old Selector / Pattern | Status | New Selector / Pattern | Notes |
|---|------------------------|--------|------------------------|-------|
| 1 | `btn.textContent?.includes('This is your ingredient')` | ⚠️ | **Needs verification** — ingredient label text may have changed | |
| 2 | `button[aria-label*="close"]` / `button[aria-label*="remove"]` | ⚠️ | May still work if close buttons exist | |
| 3 | `textarea, input[type="text"]` for clearing prompt text | ❌ | Same as fillPrompt — now a contenteditable `[role="textbox"]` | |

---

## 13. `downloadImages()` / `downloadImagesViaUI()` — Lines 3947+, 4087+

**Purpose**: Download generated images by UUID.

| # | Old Selector / Pattern | Status | New Selector / Pattern | Notes |
|---|------------------------|--------|------------------------|-------|
| 1 | `img[src*="${uuid}"]` to find image by UUID | ⚠️ | May still work if UUID is in src | |
| 2 | Navigate to parent/grandparent for Download button | ⚠️ | DOM structure may have changed | |
| 3 | `div[role="menuitem"]` for resolution picker | ⚠️ | Resolution menu structure may have changed | |

---

## 14. Message Handlers in `chrome.runtime.onMessage` (Lines 4601–6911)

### 14a. `CHECK_IMAGE_TAB_ACTIVE` / `CLICK_IMAGE_TAB` — Lines 4661–4695

| # | Old Selector | Status | New Selector | Notes |
|---|-------------|--------|-------------|-------|
| 1 | `[role="radio"]` with "Images" text | ❌ | Sidebar button `"image View images"` | No more radio buttons |
| 2 | `aria-checked="true"` for active state | ❌ | Need new active state detection | |

### 14b. `CHECK_CREATE_IMAGE_MODE` / `SELECT_CREATE_IMAGE_MODE` — Lines 4697–4750

| # | Old Selector | Status | New Selector | Notes |
|---|-------------|--------|-------------|-------|
| 1 | Button with `arrow_drop_down` for mode selector | ❌ | Model selector button (e.g. `"🍌 Nano Banana Pro..."`) | |
| 2 | `[role="listbox"]` → `[role="option"]` "Create Image" | ❌ | `tablist` → `tab "image Image"` in popup | |

### 14c. `FILL_PROMPT` — Lines 4752–4783

| # | Old Selector | Status | New Selector | Notes |
|---|-------------|--------|-------------|-------|
| 1 | `textarea, input[type="text"]` | ❌ | `[role="textbox"]` or contenteditable div | |
| 2 | `.value = prompt` | ❌ | `.textContent = prompt` or `execCommand('insertText')` | |

### 14d. `CLICK_CREATE` — Lines 4785–4846

| # | Old Selector | Status | New Selector | Notes |
|---|-------------|--------|-------------|-------|
| 1 | Button with "Create" + "arrow_forward" | ⚠️ | Same, but be careful of `"add_2 Create"` button | Two Create buttons |

### 14e. `OPEN_SETTINGS` / `SET_ASPECT_RATIO` / `SET_OUTPUT_COUNT` / `CLOSE_SETTINGS` — Lines 4848–4959

| # | Old Selector | Status | New Selector | Notes |
|---|-------------|--------|-------------|-------|
| 1 | `findButtonByText('Settings')` | ❌ | Click model selector button | |
| 2 | `[role="dialog"]` | ❌ | `menu` element | |
| 3 | `[role="combobox"]` with "Aspect Ratio" | ❌ | `tablist` → aspect ratio tabs | |
| 4 | `[role="combobox"]` with "Outputs per prompt" | ❌ | `tablist` → output count tabs (x1-x4) | |
| 5 | `[role="option"]` for dropdown items | ❌ | `tab` elements | |
| 6 | Escape to close `[role="dialog"]` | ❌ | Escape to close `menu` | |

### 14f. `CHECK_IMAGE_PICKER_OPEN` / `OPEN_IMAGE_PICKER` — Lines 4961–5005

| # | Old Selector | Status | New Selector | Notes |
|---|-------------|--------|-------------|-------|
| 1 | `input[type="file"]` for picker detection | ⚠️ | Only appears AFTER clicking "Upload image" in dialog | |
| 2 | `[role="presentation"]` → button "add" | ❌ | `button "add_2 Create"` → dialog → `button "upload Upload image"` | Two-step now |

### 14g. `UPLOAD_FILE` — Lines 5007–5053

| # | Old Selector | Status | New Selector | Notes |
|---|-------------|--------|-------------|-------|
| 1 | `input[type="file"]` | ⚠️ | Same, but timing changes (see openImagePicker) | |

### 14h. `CHECK_CROP_DIALOG_OPEN` / `HANDLE_CROP_DIALOG` — Lines 5055–5234

| # | Old Selector | Status | New Selector | Notes |
|---|-------------|--------|-------------|-------|
| 1 | Button with "Crop and Save" text | ⚠️ | **Needs verification** | |
| 2 | `[role="combobox"]` with Landscape/Portrait + `arrow_drop_down` | ⚠️ | May have changed to tabs | |
| 3 | `[role="option"]` for aspect ratio selection | ⚠️ | May now be `tab` elements | |

### 14i. `CHECK_ALL_IMAGES_UPLOADED` — Lines 5074–5140

| # | Old Selector | Status | New Selector | Notes |
|---|-------------|--------|-------------|-------|
| 1 | `[role="presentation"]` for prompt area | ⚠️ | May have changed | |
| 2 | `progress_activity` spinner text | ⚠️ | Spinner detection may have changed | |
| 3 | `'This is your ingredient'` button text | ⚠️ | Label may have changed | |

### 14j. `GET_IMAGE_COUNT` — Lines 5558–5575

| # | Old Selector | Status | New Selector | Notes |
|---|-------------|--------|-------------|-------|
| 1 | `img[alt^="Flow Image:"]` | ❌ | `img[alt="Generated image"]` | |

### 14k. `DOWNLOAD_NEW_IMAGES` — Lines 5674–5730

| # | Old Selector | Status | New Selector | Notes |
|---|-------------|--------|-------------|-------|
| 1 | `img[alt^="Flow Image:"]` | ❌ | `img[alt="Generated image"]` | |

### 14l. `DOWNLOAD_IMAGES_BY_UUID` — Lines 5732–5830

| # | Old Selector | Status | New Selector | Notes |
|---|-------------|--------|-------------|-------|
| 1 | `img[src*="${uuid}"]` | ⚠️ | May still work | |
| 2 | Parent/grandparent navigation for Download button | ⚠️ | DOM hierarchy may have changed | |
| 3 | `div[role="menuitem"]` for resolution | ⚠️ | May have changed | |

### 14m. `CHECK_GENERATION_STATUS` — Lines 5510–5556

| # | Old Selector | Status | New Selector | Notes |
|---|-------------|--------|-------------|-------|
| 1 | `div[class*="sc-6349d8ef-5"]` for error containers | ❌ | Class hash changes per build | |
| 2 | Percentage text regex `\d{1,3}%` | ⚠️ | May still work | |

---

## 15. `FlowImageTracker` (MutationObserver-based)

**Location**: Earlier in content.ts (not in message handlers)

| # | Old Selector | Status | New Selector | Notes |
|---|-------------|--------|-------------|-------|
| 1 | `img[alt^="Flow Image:"]` in MutationObserver | ❌ | `img[alt="Generated image"]` | Used for tracking new images as they appear |
| 2 | UUID extraction from `img.src` | ⚠️ | URL format may have changed | |

---

## Summary: Priority of Changes

### 🔴 Critical (Extension completely broken without these)

1. **Prompt input** — `textarea`/`input[type="text"]` → contenteditable `[role="textbox"]`
2. **Image gallery selector** — `img[alt^="Flow Image:"]` → `img[alt="Generated image"]`
3. **Settings dialog** — `findButtonByText('Settings')` + `[role="dialog"]` + `[role="combobox"]` → model selector button + `menu` + `tab` elements
4. **Mode selection** — `[role="combobox"]` "Create Image" → model selector popup `tab` "Image"
5. **Image upload flow** — single "add" button → two-step: "add_2 Create" dialog → "Upload image"

### 🟡 Major (Core workflows broken)

6. **"Add To Prompt" removed** — Entire `clickAddToPromptByImageUuid()` flow needs redesign
7. **Gallery filter** — `[role="radio"]` "Images"/"Videos" → sidebar buttons
8. **Scroll container** — `[class*="sc-c884da2c"]` → structural detection needed
9. **Error container** — `[class*="sc-6349d8ef-5"]` → structural detection needed

### 🟢 Minor / Needs Verification

10. **Crop dialog** — may or may not have changed (needs live test)
11. **Ingredient labels** — "This is your ingredient" text may have changed
12. **Download UI** — button hierarchy may have changed
13. **Generation percentage** — regex detection may still work

---

## Items Needing Live Playwright Verification

These selectors couldn't be fully verified without going through the complete upload-and-generate workflow:

1. **Crop dialog**: Does it still use `[role="dialog"]`? Does "Crop and Save" text still exist?
2. **Ingredient buttons**: Is the text still "This is your ingredient"?
3. **Generation indicators**: Do percentages still appear as text nodes?
4. **Image src URLs**: Do they still contain UUIDs that can be extracted?
5. **Asset picker dialog**: Exact structure of the "add_2 Create" dialog
6. **"Add To Prompt" replacement**: What's the new way to add gallery images as ingredients?
7. **Model selector button**: Reliable selector to find it (currently matching by emoji/text content)
