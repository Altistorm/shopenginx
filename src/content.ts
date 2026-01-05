// Content script - displays workflow status overlay on the page

class WorkflowOverlay {
  private container: HTMLDivElement | null = null;
  private textElement: HTMLSpanElement | null = null;
  private stateElement: HTMLDivElement | null = null;

  create() {
    if (this.container) return;

    this.container = document.createElement('div');
    this.container.id = 'shopenginx-overlay';
    this.container.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 16px;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      z-index: 999999;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: all 0.3s ease;
      opacity: 0;
      transform: translateY(-10px);
      max-width: 320px;
    `;

    // Header with spinner and node name
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
    `;

    // Spinner
    const spinner = document.createElement('div');
    spinner.style.cssText = `
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: shopenginx-spin 0.8s linear infinite;
      flex-shrink: 0;
    `;

    // Add keyframes
    const style = document.createElement('style');
    style.textContent = `
      @keyframes shopenginx-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);

    // Text element (node name)
    this.textElement = document.createElement('span');
    this.textElement.style.cssText = `font-weight: 600; font-size: 14px;`;
    this.textElement.textContent = 'Starting...';

    header.appendChild(spinner);
    header.appendChild(this.textElement);

    // State element (context state display)
    this.stateElement = document.createElement('div');
    this.stateElement.style.cssText = `
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 11px;
      font-family: 'Monaco', 'Menlo', monospace;
      line-height: 1.5;
      display: none;
    `;

    this.container.appendChild(header);
    this.container.appendChild(this.stateElement);
    document.body.appendChild(this.container);

    // Animate in
    requestAnimationFrame(() => {
      if (this.container) {
        this.container.style.opacity = '1';
        this.container.style.transform = 'translateY(0)';
      }
    });
  }

  setText(text: string) {
    if (!this.container) {
      this.create();
    }
    if (this.textElement) {
      this.textElement.textContent = text;
    }
  }

  setNodeName(nodeName: string, state?: Record<string, unknown>) {
    if (!this.container) {
      this.create();
    }
    if (this.textElement) {
      this.textElement.textContent = `Node: ${nodeName}`;
    }
    if (this.stateElement && state) {
      const lines: string[] = [];

      // Show images count if available
      const images = state.images as string[] | undefined;
      if (images) {
        lines.push(`images: ${images.length}`);
      }

      // Show current image index
      if (state.currentImageIndex !== undefined) {
        lines.push(`ImageIndex: ${state.currentImageIndex}`);
      }

      // Boolean state flags
      const boolKeys = [
        'isSettingsConfigured',
        'isImageUploaded',
        'isPromptFilled',
        'isCreateClicked',
        'isCreateImageModeSelected',
        'isImagePickerOpen',
        'isCropDialogOpen'
      ];

      boolKeys.forEach(key => {
        if (state[key] !== undefined) {
          const icon = state[key] === true ? '✓' : '✗';
          const shortKey = key.replace(/^is/, '');
          lines.push(`${shortKey}: ${icon}`);
        }
      });

      if (lines.length > 0) {
        this.stateElement.innerHTML = lines.join('<br>');
        this.stateElement.style.display = 'block';
      } else {
        this.stateElement.style.display = 'none';
      }
    } else if (this.stateElement) {
      this.stateElement.style.display = 'none';
    }
  }

  hide() {
    if (this.container) {
      this.container.style.opacity = '0';
      this.container.style.transform = 'translateY(-10px)';
      setTimeout(() => {
        this.container?.remove();
        this.container = null;
        this.textElement = null;
      }, 300);
    }
  }
}

// ==================== Flow Image Tracker ====================
// Uses MutationObserver to track image UUIDs dynamically without scrolling

class FlowImageTracker {
  private orderedIds: string[] = [];
  private observer: MutationObserver | null = null;
  private isTracking: boolean = false;

  // Completion detection state
  private snapshotBeforeGeneration: string[] = [];
  private expectedNewImageCount: number = 0;
  private completionResolver: ((newUUIDs: string[]) => void) | null = null;
  private completionTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingImagesWithoutSrc: Set<HTMLImageElement> = new Set();
  private detectedNewUUIDs: Set<string> = new Set();
  private lastPercentage: number = 0;
  private isGenerating: boolean = false;

  // Extract UUID from image src URL
  private extractUUID(src: string): string | null {
    const match = src.match(/image\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }

  // Update the ordered list based on current DOM state
  private updateImageOrder() {
    const images = document.querySelectorAll('img[alt^="Flow Image:"]');
    const visibleIds: string[] = [];
    const rawSrcs: string[] = [];

    images.forEach((img) => {
      const src = (img as HTMLImageElement).src;
      rawSrcs.push(src.substring(0, 60));
      const uuid = this.extractUUID(src);
      if (uuid) {
        visibleIds.push(uuid);
      }
    });

    console.log('[FlowImageTracker] updateImageOrder triggered, images found:', images.length, 'with UUID:', visibleIds.length);
    console.log('[FlowImageTracker] Raw src URLs:', rawSrcs);
    console.log('[FlowImageTracker] Extracted UUIDs:', visibleIds);

    // Merge visible IDs with existing order
    this.mergeImageOrder(visibleIds);
    console.log('[FlowImageTracker] Updated order, total tracked:', this.orderedIds.length, this.orderedIds);
  }

  // Merge newly visible IDs into the ordered list
  private mergeImageOrder(visibleIds: string[]) {
    const existingSet = new Set(this.orderedIds);
    const newIds = visibleIds.filter(id => !existingSet.has(id));

    if (newIds.length === 0 && visibleIds.length === 0) return;

    // If we have new IDs, we need to insert them in correct position
    if (newIds.length > 0) {
      console.log('[FlowImageTracker] New images detected:', newIds);

      // Build result maintaining DOM order for visible items
      // and keeping track of items that scrolled out
      const result: string[] = [];
      const addedFromVisible = new Set<string>();

      // Add visible IDs in their DOM order
      for (const visibleId of visibleIds) {
        result.push(visibleId);
        addedFromVisible.add(visibleId);
      }

      // Append any existing IDs that are not currently visible (scrolled out)
      for (const existingId of this.orderedIds) {
        if (!addedFromVisible.has(existingId)) {
          result.push(existingId);
        }
      }

      this.orderedIds = result;
    } else if (visibleIds.length > 0) {
      // No new IDs, but update order based on visibility
      // Keep existing order, just verify visible ones are tracked
      const existingInOrder = new Set(this.orderedIds);
      for (const id of visibleIds) {
        if (!existingInOrder.has(id)) {
          this.orderedIds.push(id);
        }
      }
    }
  }

  // Track an image that has alt="Flow Image:..." but no valid UUID src yet
  private trackPendingImage(img: HTMLImageElement) {
    const uuid = this.extractUUID(img.src);
    if (!uuid) {
      // No UUID yet - add to pending
      if (!this.pendingImagesWithoutSrc.has(img)) {
        this.pendingImagesWithoutSrc.add(img);
        console.log('[FlowImageTracker] 📥 Pending image added (no UUID yet), total pending:', this.pendingImagesWithoutSrc.size);
      }
    } else {
      // Already has UUID - handle immediately
      this.handleNewUUID(uuid, img);
    }
  }

  // Handle when an image gets a valid UUID (either from src change or initial load)
  private handleNewUUID(uuid: string, img: HTMLImageElement) {
    // Remove from pending if it was there
    this.pendingImagesWithoutSrc.delete(img);

    // Check if this is a new UUID (not in snapshot before generation)
    const isNew = !this.snapshotBeforeGeneration.includes(uuid);

    if (isNew && !this.detectedNewUUIDs.has(uuid)) {
      this.detectedNewUUIDs.add(uuid);
      console.log('[FlowImageTracker] ✨ New UUID detected:', uuid.substring(0, 8), 'total new:', this.detectedNewUUIDs.size, '/', this.expectedNewImageCount);

      // Check completion immediately - MutationObserver gives us exact timing
      this.checkCompletion();
    }
  }

  // Handle src attribute change on an image
  private handleSrcChange(img: HTMLImageElement) {
    const uuid = this.extractUUID(img.src);
    if (uuid) {
      this.handleNewUUID(uuid, img);
    }
  }

  // Check if generation is complete
  private checkCompletion() {
    if (!this.isGenerating || !this.completionResolver) {
      return;
    }

    const newUUIDCount = this.detectedNewUUIDs.size;
    const pendingCount = this.pendingImagesWithoutSrc.size;

    console.log('[FlowImageTracker] 🔍 Completion check:', {
      newUUIDs: newUUIDCount,
      expected: this.expectedNewImageCount,
      pending: pendingCount
    });

    // Complete if we have expected count and no pending images
    if (newUUIDCount >= this.expectedNewImageCount && pendingCount === 0) {
      console.log('[FlowImageTracker] ✅ Generation complete! New UUIDs:', Array.from(this.detectedNewUUIDs));
      this.resolveCompletion();
    }
  }

  // Resolve the completion promise
  private resolveCompletion() {
    if (this.completionResolver) {
      const newUUIDs = Array.from(this.detectedNewUUIDs);
      this.completionResolver(newUUIDs);
      this.completionResolver = null;
    }

    if (this.completionTimeout) {
      clearTimeout(this.completionTimeout);
      this.completionTimeout = null;
    }

    this.isGenerating = false;
  }

  // Handle percentage update from characterData mutation
  private handlePercentageUpdate(percentage: number) {
    if (percentage !== this.lastPercentage) {
      console.log('[FlowImageTracker] 📊 Percentage update:', this.lastPercentage, '->', percentage);
      this.lastPercentage = percentage;
    }
  }

  // Start waiting for new images (call before clicking Create)
  waitForNewImages(expectedCount: number, timeoutMs: number = 120000): Promise<string[]> {
    return new Promise((resolve) => {
      // Take snapshot before generation
      this.snapshotBeforeGeneration = [...this.orderedIds];
      this.expectedNewImageCount = expectedCount;
      this.detectedNewUUIDs.clear();
      this.pendingImagesWithoutSrc.clear();
      this.isGenerating = true;
      this.lastPercentage = 0;

      console.log('[FlowImageTracker] 🚀 Waiting for', expectedCount, 'new images. Snapshot:', this.snapshotBeforeGeneration.length, 'existing');

      this.completionResolver = resolve;

      // Set timeout
      this.completionTimeout = setTimeout(() => {
        console.log('[FlowImageTracker] ⏰ Timeout reached. Returning detected UUIDs:', Array.from(this.detectedNewUUIDs));
        this.resolveCompletion();
      }, timeoutMs);
    });
  }

  // Cancel waiting for new images
  cancelWait() {
    if (this.completionResolver) {
      console.log('[FlowImageTracker] ❌ Wait cancelled');
      this.resolveCompletion();
    }
  }

  // Start tracking images
  start() {
    if (this.isTracking) {
      console.log('[FlowImageTracker] Already tracking');
      return;
    }

    // Initial scan
    this.updateImageOrder();

    // Set up MutationObserver
    const onMutation = (mutations: MutationRecord[]) => {
      let hasRelevantChanges = false;

      // Log all mutations for debugging
      console.log('[MutationObserver] Triggered, mutations:', mutations.length);

      for (const mutation of mutations) {
        // Log ALL mutations without filtering
        const targetEl = mutation.target as HTMLElement;
        const targetInfo = targetEl.tagName ?
          `${targetEl.tagName}${targetEl.className ? '.' + String(targetEl.className).substring(0, 40) : ''}` :
          (mutation.target instanceof Text ? `TEXT:"${mutation.target.textContent?.substring(0, 30)}"` : 'unknown');

        console.log('[MutationObserver]', JSON.stringify({
          type: mutation.type,
          target: targetInfo,
          addedNodes: mutation.addedNodes.length,
          removedNodes: mutation.removedNodes.length,
          attributeName: mutation.attributeName,
          oldValue: mutation.oldValue?.substring(0, 30)
        }));

        // Check added nodes
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            const nodeInfo = node.tagName + (node.className ? '.' + String(node.className).substring(0, 30) : '');

            // Check if it's an image or contains images
            if (node.matches && node.matches('img[alt^="Flow Image:"]')) {
              console.log('[FlowImageTracker] 🖼️ Flow Image added directly:', nodeInfo, (node as HTMLImageElement).src?.substring(0, 60));
              hasRelevantChanges = true;
              // Track this image for completion detection
              if (this.isGenerating) {
                this.trackPendingImage(node as HTMLImageElement);
              }
            } else if (node.querySelectorAll) {
              const imgs = node.querySelectorAll('img[alt^="Flow Image:"]');
              if (imgs.length > 0) {
                console.log('[FlowImageTracker] 🖼️ Container with Flow Images added:', nodeInfo, 'images:', imgs.length);
                hasRelevantChanges = true;
                // Track each image for completion detection
                if (this.isGenerating) {
                  imgs.forEach((img) => {
                    this.trackPendingImage(img as HTMLImageElement);
                  });
                }
              }
            }

            // Log any text content that might contain percentages
            const textContent = node.textContent?.trim();
            if (textContent && /\d{1,3}%/.test(textContent)) {
              console.log('[FlowImageTracker] 📊 Percentage text detected in added node:', nodeInfo, 'text:', textContent.substring(0, 50));
            }
          } else if (node instanceof Text) {
            const textContent = node.textContent?.trim();
            if (textContent && /\d{1,3}%/.test(textContent)) {
              console.log('[FlowImageTracker] 📊 Percentage text node added:', textContent);
            }
          }
        });

        // Check for attribute changes on images (src changes)
        if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
          const target = mutation.target as HTMLElement;
          if (target.matches && target.matches('img[alt^="Flow Image:"]')) {
            console.log('[FlowImageTracker] 🔄 Image src changed:', (target as HTMLImageElement).src?.substring(0, 60));
            hasRelevantChanges = true;
            // Handle src change for completion detection
            if (this.isGenerating) {
              this.handleSrcChange(target as HTMLImageElement);
            }
          }
        }

        // Log characterData changes (text content updates) - percentage tracking
        if (mutation.type === 'characterData') {
          const textContent = (mutation.target as Text).textContent?.trim();
          if (textContent) {
            // Check if it's a percentage number (just digits, no % symbol)
            const percentMatch = textContent.match(/^(\d{1,3})$/);
            if (percentMatch) {
              const percentage = parseInt(percentMatch[1], 10);
              if (percentage >= 0 && percentage <= 100) {
                this.handlePercentageUpdate(percentage);
              }
            }
            // Also check for XX% format
            if (/^\d{1,3}%$/.test(textContent)) {
              console.log('[FlowImageTracker] 📊 Text content changed to percentage:', textContent);
            }
          }
        }
      }

      if (hasRelevantChanges) {
        console.log('[FlowImageTracker] ✅ Relevant changes detected, updating image order...');
        // Debounce updates
        setTimeout(() => this.updateImageOrder(), 100);
      }
    };

    this.observer = new MutationObserver(onMutation);

    // Find the scroll container or use body
    const container = document.querySelector('[class*="sc-c884da2c"]') || document.body;

    this.observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
      characterData: true,
      characterDataOldValue: true
    });

    console.log('[FlowImageTracker] Observer attached to:', container.tagName, container.className?.substring(0, 50));

    this.isTracking = true;
    console.log('[FlowImageTracker] Started tracking');
  }

  // Stop tracking
  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.isTracking = false;
    console.log('[FlowImageTracker] Stopped tracking');
  }

  // Get current snapshot of ordered IDs
  getSnapshot(): string[] {
    // Update before returning to ensure we have latest visible images
    this.updateImageOrder();
    return [...this.orderedIds];
  }

  // Get new images compared to a previous snapshot
  getNewImages(previousSnapshot: string[]): string[] {
    const previousSet = new Set(previousSnapshot);
    // Update to get any new images
    this.updateImageOrder();
    return this.orderedIds.filter(id => !previousSet.has(id));
  }

  // Get total count
  getCount(): number {
    this.updateImageOrder();
    return this.orderedIds.length;
  }

  // Reset tracker
  reset() {
    this.orderedIds = [];
    this.snapshotBeforeGeneration = [];
    this.expectedNewImageCount = 0;
    this.detectedNewUUIDs.clear();
    this.pendingImagesWithoutSrc.clear();
    this.isGenerating = false;
    this.lastPercentage = 0;

    if (this.completionTimeout) {
      clearTimeout(this.completionTimeout);
      this.completionTimeout = null;
    }
    if (this.completionResolver) {
      this.completionResolver([]);
      this.completionResolver = null;
    }

    console.log('[FlowImageTracker] Reset');
  }

  // Check if tracking
  isActive(): boolean {
    return this.isTracking;
  }
}

// Global instance
const flowImageTracker = new FlowImageTracker();

const overlay = new WorkflowOverlay();

// Listen for messages from extension
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'OVERLAY_SHOW':
      overlay.create();
      overlay.setText(message.text);
      sendResponse({ success: true });
      break;

    case 'OVERLAY_UPDATE':
      overlay.setText(message.text);
      sendResponse({ success: true });
      break;

    case 'OVERLAY_HIDE':
      overlay.hide();
      sendResponse({ success: true });
      break;

    case 'OVERLAY_NODE_NAME':
      overlay.create();
      overlay.setNodeName(message.text, message.state);
      sendResponse({ success: true });
      break;

    case 'PING':
      sendResponse({ ready: true });
      break;

    case 'CLICK_ELEMENT':
      try {
        let element: HTMLElement | null = null;

        // If selector provided, try it first
        if (message.selector) {
          element = document.querySelector(message.selector);
        }

        // If text provided, find element by text content
        if (!element && message.text) {
          const elements = document.querySelectorAll('button, a, [role="button"], [role="radio"]');
          for (const el of elements) {
            if (el.textContent?.includes(message.text)) {
              element = el as HTMLElement;
              break;
            }
          }
        }

        if (element) {
          element.click();
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Element not found' });
        }
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'CHECK_IMAGE_TAB_ACTIVE':
      try {
        // Find the Images radio button and check if it's active
        const radios = document.querySelectorAll('[role="radio"]');
        let isImageTabActive = false;
        for (const radio of radios) {
          if (radio.textContent?.includes('Images')) {
            isImageTabActive = radio.getAttribute('aria-checked') === 'true' ||
              radio.classList.contains('active') ||
              radio.hasAttribute('checked');
            break;
          }
        }
        sendResponse({ success: true, isActive: isImageTabActive });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'CLICK_IMAGE_TAB':
      try {
        const radios = document.querySelectorAll('[role="radio"]');
        let clicked = false;
        for (const radio of radios) {
          if (radio.textContent?.includes('Images')) {
            (radio as HTMLElement).click();
            clicked = true;
            break;
          }
        }
        sendResponse({ success: clicked });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'SELECT_CREATE_IMAGE_MODE':
      try {
        // Find the mode selector button with arrow_drop_down
        let modeSelector: HTMLElement | null = null;
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent?.includes('arrow_drop_down')) {
            modeSelector = btn as HTMLElement;
            break;
          }
        }

        if (modeSelector) {
          modeSelector.click();

          // Wait for dropdown (listbox) to appear and click "Create Image" option
          setTimeout(() => {
            const listbox = document.querySelector('[role="listbox"]');
            if (listbox) {
              const options = listbox.querySelectorAll('[role="option"]');
              for (const option of options) {
                if (option.textContent?.includes('Create Image')) {
                  (option as HTMLElement).click();
                  sendResponse({ success: true });
                  return;
                }
              }
            }
            sendResponse({ success: false, error: 'Create Image option not found in listbox' });
          }, 300);
        } else {
          sendResponse({ success: false, error: 'Mode selector button not found' });
        }
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
      return true; // Keep channel open for async response

    case 'CHECK_CREATE_IMAGE_MODE':
      try {
        // Check if mode selector button shows "Create Image"
        let isCreateImage = false;
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent?.includes('arrow_drop_down')) {
            isCreateImage = btn.textContent?.includes('Create Image') ?? false;
            break;
          }
        }
        sendResponse({ success: true, isCreateImage });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'FILL_PROMPT':
      try {
        const prompt = message.prompt || '';
        // Find the prompt textbox
        const textbox = document.querySelector('textarea, input[type="text"]') as HTMLInputElement | HTMLTextAreaElement;

        // Also try finding by placeholder
        let promptInput = textbox;
        if (!promptInput) {
          const inputs = document.querySelectorAll('input, textarea');
          for (const input of inputs) {
            const placeholder = (input as HTMLInputElement).placeholder || '';
            if (placeholder.includes('Generate') || placeholder.includes('prompt')) {
              promptInput = input as HTMLInputElement;
              break;
            }
          }
        }

        if (promptInput) {
          promptInput.focus();
          promptInput.value = prompt;
          promptInput.dispatchEvent(new Event('input', { bubbles: true }));
          promptInput.dispatchEvent(new Event('change', { bubbles: true }));
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Prompt textbox not found' });
        }
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'CLICK_CREATE':
      try {
        // Find and click the Create button (has arrow_forward icon)
        const buttons = document.querySelectorAll('button');
        console.log('[CLICK_CREATE] Total buttons on page:', buttons.length);

        // Log all buttons that contain "Create" or "arrow_forward"
        console.log('[CLICK_CREATE] Buttons containing "Create" or "arrow_forward":');
        for (const btn of buttons) {
          const text = btn.textContent || '';
          if (text.includes('Create') || text.includes('arrow_forward')) {
            const rect = btn.getBoundingClientRect();
            console.log('[CLICK_CREATE] Button:', {
              text: text.replace(/\s+/g, ' ').substring(0, 80),
              hasCreate: text.includes('Create'),
              hasArrow: text.includes('arrow_forward'),
              disabled: btn.hasAttribute('disabled'),
              visible: rect.width > 0 && rect.height > 0,
              position: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
            });
          }
        }

        // Check if image picker is open
        const fileInput = document.querySelector('input[type="file"]');
        console.log('[CLICK_CREATE] File input (picker) exists:', fileInput !== null);

        // Check prompt box state
        const promptArea = document.querySelector('[role="presentation"]');
        if (promptArea) {
          const ingredientBtns = promptArea.querySelectorAll('button');
          let imageCount = 0;
          for (const btn of ingredientBtns) {
            if (btn.textContent?.includes('This is your ingredient')) imageCount++;
          }
          console.log('[CLICK_CREATE] Images in prompt box:', imageCount);
        }

        // Find and click the Create button
        for (const btn of buttons) {
          if (btn.textContent?.includes('Create') && btn.textContent?.includes('arrow_forward') && !btn.hasAttribute('disabled')) {
            console.log('[CLICK_CREATE] Clicking Create button now...');
            (btn as HTMLElement).click();
            console.log('[CLICK_CREATE] Create button clicked!');

            // Check state after click
            setTimeout(() => {
              const fileInputAfter = document.querySelector('input[type="file"]');
              console.log('[CLICK_CREATE] After click - File input exists:', fileInputAfter !== null);
            }, 500);

            sendResponse({ success: true });
            return;
          }
        }
        console.log('[CLICK_CREATE] No matching Create button found!');
        sendResponse({ success: false, error: 'Create button not found or disabled' });
      } catch (e) {
        console.log('[CLICK_CREATE] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'OPEN_SETTINGS':
      try {
        // Click the Settings button to open settings dialog
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent?.includes('Settings')) {
            btn.click();
            sendResponse({ success: true });
            return;
          }
        }
        sendResponse({ success: false, error: 'Settings button not found' });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'SET_ASPECT_RATIO':
      try {
        // Find and click Aspect Ratio combobox in dialog
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) {
          sendResponse({ success: false, error: 'Settings dialog not open' });
          return;
        }

        const comboboxes = dialog.querySelectorAll('[role="combobox"]');
        let aspectCombobox: HTMLElement | null = null;
        for (const cb of comboboxes) {
          if (cb.textContent?.includes('Aspect Ratio')) {
            aspectCombobox = cb as HTMLElement;
            break;
          }
        }

        if (!aspectCombobox) {
          sendResponse({ success: false, error: 'Aspect Ratio combobox not found' });
          return;
        }

        aspectCombobox.click();

        // Wait for dropdown and select option
        setTimeout(() => {
          const options = document.querySelectorAll('[role="option"]');
          const targetRatio = message.ratio === '16:9' ? 'Landscape' : 'Portrait';
          for (const option of options) {
            if (option.textContent?.includes(targetRatio)) {
              (option as HTMLElement).click();
              sendResponse({ success: true });
              return;
            }
          }
          sendResponse({ success: false, error: 'Aspect ratio option not found' });
        }, 300);
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
      return true;

    case 'SET_OUTPUT_COUNT':
      try {
        // Find and click Outputs per prompt combobox in dialog
        const dialog2 = document.querySelector('[role="dialog"]');
        if (!dialog2) {
          sendResponse({ success: false, error: 'Settings dialog not open' });
          return;
        }

        const comboboxes2 = dialog2.querySelectorAll('[role="combobox"]');
        let outputCombobox: HTMLElement | null = null;
        for (const cb of comboboxes2) {
          if (cb.textContent?.includes('Outputs per prompt')) {
            outputCombobox = cb as HTMLElement;
            break;
          }
        }

        if (!outputCombobox) {
          sendResponse({ success: false, error: 'Outputs combobox not found' });
          return;
        }

        outputCombobox.click();

        // Wait for dropdown and select option
        setTimeout(() => {
          const options = document.querySelectorAll('[role="option"]');
          const targetCount = String(message.count);
          for (const option of options) {
            if (option.textContent?.trim() === targetCount) {
              (option as HTMLElement).click();
              sendResponse({ success: true });
              return;
            }
          }
          sendResponse({ success: false, error: 'Output count option not found' });
        }, 300);
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
      return true;

    case 'CLOSE_SETTINGS':
      try {
        // Press Escape to close dialog
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'CHECK_IMAGE_PICKER_OPEN':
      try {
        // Check if file input exists on the page
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        const isOpen = fileInput !== null;
        console.log('[CHECK_IMAGE_PICKER_OPEN] File input exists:', isOpen);
        sendResponse({ success: true, isOpen });
      } catch (e) {
        console.log('[CHECK_IMAGE_PICKER_OPEN] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'OPEN_IMAGE_PICKER':
      try {
        console.log('[OPEN_IMAGE_PICKER] Finding add button in prompt area...');
        // Find the add button in the prompt area using role="presentation"
        const promptArea = document.querySelector('[role="presentation"]');
        let addButton: HTMLElement | null = null;

        if (promptArea) {
          const buttons = promptArea.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent?.trim() === 'add') {
              addButton = btn as HTMLElement;
              break;
            }
          }
        }

        if (addButton) {
          const rect = addButton.getBoundingClientRect();
          console.log('[OPEN_IMAGE_PICKER] Add button found at x:', rect.x, 'y:', rect.y);
          addButton.click();
          console.log('[OPEN_IMAGE_PICKER] Add button clicked');
          sendResponse({ success: true });
        } else {
          console.log('[OPEN_IMAGE_PICKER] Add button NOT found in prompt area');
          sendResponse({ success: false, error: 'Add button not found in prompt area' });
        }
      } catch (e) {
        console.log('[OPEN_IMAGE_PICKER] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'UPLOAD_FILE':
      try {
        console.log('[UPLOAD_FILE] Starting upload...');
        const base64Image: string = message.image || '';
        if (!base64Image) {
          console.log('[UPLOAD_FILE] No image provided');
          sendResponse({ success: false, error: 'No image provided' });
          return;
        }

        console.log('[UPLOAD_FILE] Image data length:', base64Image.length);

        // Convert base64 to File
        const arr = base64Image.split(',');
        const mimeMatch = arr[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') ? 'jpg' : 'webp';
        const file = new File([u8arr], `image.${ext}`, { type: mime });
        console.log('[UPLOAD_FILE] File created:', file.name, file.size, 'bytes');

        // Find file input and upload
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        console.log('[UPLOAD_FILE] File input found:', !!fileInput);
        if (fileInput) {
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          fileInput.files = dataTransfer.files;
          console.log('[UPLOAD_FILE] Dispatching change event...');
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          fileInput.dispatchEvent(new Event('input', { bubbles: true }));
          console.log('[UPLOAD_FILE] Upload complete');
          sendResponse({ success: true });
        } else {
          console.log('[UPLOAD_FILE] File input NOT found');
          sendResponse({ success: false, error: 'File input not found' });
        }
      } catch (e) {
        console.log('[UPLOAD_FILE] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'CHECK_CROP_DIALOG_OPEN':
      try {
        // Check if crop dialog is visible (has "Crop and Save" button)
        const buttons = document.querySelectorAll('button');
        let isOpen = false;
        for (const btn of buttons) {
          if (btn.textContent?.includes('Crop and Save')) {
            isOpen = true;
            break;
          }
        }
        console.log('[CHECK_CROP_DIALOG_OPEN] Crop dialog open:', isOpen);
        sendResponse({ success: true, isOpen });
      } catch (e) {
        console.log('[CHECK_CROP_DIALOG_OPEN] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'CHECK_ALL_IMAGES_UPLOADED':
      try {
        const expectedCount: number = message.expectedCount || 0;
        console.log('[CHECK_ALL_IMAGES_UPLOADED] Expected count:', expectedCount);

        // Check 1: Look for spinner (progress_activity) in prompt box area
        let hasSpinnerInPromptBox = false;
        const promptArea = document.querySelector('[role="presentation"]');
        if (promptArea) {
          const spinnerElements = promptArea.querySelectorAll('span, div');
          for (const el of spinnerElements) {
            if (el.textContent === 'progress_activity') {
              hasSpinnerInPromptBox = true;
              break;
            }
          }
        }
        console.log('[CHECK_ALL_IMAGES_UPLOADED] Has spinner in prompt box:', hasSpinnerInPromptBox);

        // Check 2: Count images in prompt box (buttons with "ingredient" text)
        let promptBoxImageCount = 0;
        const ingredientButtons = document.querySelectorAll('button');
        for (const btn of ingredientButtons) {
          const text = btn.textContent || '';
          if (text.includes('This is your ingredient')) {
            promptBoxImageCount++;
          }
        }
        console.log('[CHECK_ALL_IMAGES_UPLOADED] Prompt box image count:', promptBoxImageCount);

        // Check 3: Look for disabled button slots in prompt area (uploading in progress)
        let hasDisabledSlot = false;
        if (promptArea) {
          const disabledButtons = promptArea.querySelectorAll('button[disabled]');
          for (const btn of disabledButtons) {
            const text = btn.textContent || '';
            // Exclude Create button and other non-image buttons
            if (!text.includes('Create') && !text.includes('Nano') && !text.includes('add')) {
              hasDisabledSlot = true;
              break;
            }
          }
        }
        console.log('[CHECK_ALL_IMAGES_UPLOADED] Has disabled slot:', hasDisabledSlot);

        // Determine if all images are uploaded
        const isComplete = !hasSpinnerInPromptBox &&
                          !hasDisabledSlot &&
                          promptBoxImageCount >= expectedCount &&
                          expectedCount > 0;

        console.log('[CHECK_ALL_IMAGES_UPLOADED] Is complete:', isComplete);

        sendResponse({
          success: true,
          isComplete,
          hasSpinnerInPromptBox,
          hasDisabledSlot,
          promptBoxImageCount,
          expectedCount,
          imagesRemaining: expectedCount - promptBoxImageCount
        });
      } catch (e) {
        console.log('[CHECK_ALL_IMAGES_UPLOADED] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'CLEAR_PROMPT_BOX_IMAGES':
      (async () => {
        try {
          console.log('[CLEAR_PROMPT_BOX_IMAGES] Clearing all images from prompt box...');

          // Find all ingredient buttons (images in prompt box)
          const ingredientButtons = document.querySelectorAll('button');
          let removedCount = 0;

          for (const btn of ingredientButtons) {
            const text = btn.textContent || '';
            if (text.includes('This is your ingredient')) {
              // Find the close/remove button within or near this button
              // Usually it's a button with "close" or "x" icon inside the parent container
              const parent = btn.parentElement;
              if (parent) {
                const closeBtn = parent.querySelector('button[aria-label*="close"], button[aria-label*="remove"], button[aria-label*="delete"]') as HTMLButtonElement;
                if (closeBtn) {
                  closeBtn.click();
                  removedCount++;
                  await new Promise(resolve => setTimeout(resolve, 300));
                } else {
                  // Try finding a button with close icon (material icon)
                  const allBtns = parent.querySelectorAll('button');
                  for (const b of allBtns) {
                    if (b !== btn && (b.textContent?.includes('close') || b.textContent?.includes('cancel'))) {
                      (b as HTMLButtonElement).click();
                      removedCount++;
                      await new Promise(resolve => setTimeout(resolve, 300));
                      break;
                    }
                  }
                }
              }
            }
          }

          console.log(`[CLEAR_PROMPT_BOX_IMAGES] Removed ${removedCount} images`);

          // Wait a bit for UI to update
          await new Promise(resolve => setTimeout(resolve, 500));

          sendResponse({ success: true, removedCount });
        } catch (e) {
          console.log('[CLEAR_PROMPT_BOX_IMAGES] Error:', e);
          sendResponse({ success: false, error: String(e) });
        }
      })();
      return true;

    case 'HANDLE_CROP_DIALOG':
      (async () => {
        try {
          const aspectRatio: string = message.aspectRatio || '9:16';
          const isPortrait = aspectRatio === '9:16';
          const targetText = isPortrait ? 'Portrait' : 'Landscape';

          // Find and click aspect ratio dropdown if needed
          const comboboxes = document.querySelectorAll('[role="combobox"], button');
          for (const el of comboboxes) {
            const text = el.textContent || '';
            if ((text.includes('Landscape') || text.includes('Portrait')) && text.includes('arrow_drop_down')) {
              if (!text.includes(targetText)) {
                (el as HTMLElement).click();
                await new Promise(resolve => setTimeout(resolve, 300));
                const options = document.querySelectorAll('[role="option"]');
                for (const option of options) {
                  if (option.textContent?.includes(targetText)) {
                    (option as HTMLElement).click();
                    await new Promise(resolve => setTimeout(resolve, 300));
                    break;
                  }
                }
              }
              break;
            }
          }

          // Click "Crop and Save"
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent?.includes('Crop and Save')) {
              (btn as HTMLElement).click();
              sendResponse({ success: true });
              return;
            }
          }
          sendResponse({ success: false, error: 'Crop and Save button not found' });
        } catch (e) {
          sendResponse({ success: false, error: String(e) });
        }
      })();
      return true; // Keep channel open for async

    case 'UPLOAD_IMAGES':
      try {
        const base64Images: string[] = message.images || [];
        const aspectRatio: string = message.aspectRatio || '9:16'; // Default to Portrait

        if (base64Images.length === 0) {
          sendResponse({ success: false, error: 'No images provided' });
          return;
        }

        // Helper function to convert base64 to File
        const base64ToFile = (base64: string, filename: string): File => {
          const arr = base64.split(',');
          const mimeMatch = arr[0].match(/:(.*?);/);
          const mime = mimeMatch ? mimeMatch[1] : 'image/png';
          const bstr = atob(arr[1]);
          let n = bstr.length;
          const u8arr = new Uint8Array(n);
          while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
          }
          return new File([u8arr], filename, { type: mime });
        };

        // Helper: delay function
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        // Upload to file input element
        const uploadToFileInput = async (fileInput: HTMLInputElement, file: File): Promise<void> => {
          console.log('[ShopEnginX] Uploading to file input...');

          // Create DataTransfer and add file
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);

          // Set files on the input element
          fileInput.files = dataTransfer.files;

          // Dispatch change event
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));

          // Dispatch input event
          fileInput.dispatchEvent(new Event('input', { bubbles: true }));

          console.log('[ShopEnginX] File upload events dispatched');
        };

        // Find the + button in prompt area
        const findAddButton = (): HTMLElement | null => {
          // Look for button with "add" text
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            const text = btn.textContent?.trim();
            if (text === 'add') {
              console.log('[ShopEnginX] Found + button');
              return btn as HTMLElement;
            }
          }
          return null;
        };

        // Select aspect ratio in crop dialog
        const selectAspectRatio = async (ratio: string): Promise<boolean> => {
          // ratio is '9:16' (Portrait) or '16:9' (Landscape)
          const isPortrait = ratio === '9:16';
          const targetText = isPortrait ? 'Portrait' : 'Landscape';

          console.log(`[ShopEnginX] Selecting aspect ratio: ${targetText}`);

          // Find the aspect ratio dropdown (combobox)
          const comboboxes = document.querySelectorAll('[role="combobox"], button');
          let dropdownButton: HTMLElement | null = null;

          for (const el of comboboxes) {
            const text = el.textContent || '';
            // Look for button containing "Landscape" or "Portrait" with arrow_drop_down
            if ((text.includes('Landscape') || text.includes('Portrait')) && text.includes('arrow_drop_down')) {
              dropdownButton = el as HTMLElement;
              break;
            }
            // Also check for crop_16_9 or crop_9_16 icons
            if (text.includes('crop_16_9') || text.includes('crop_9_16')) {
              dropdownButton = el as HTMLElement;
              break;
            }
          }

          if (!dropdownButton) {
            console.log('[ShopEnginX] Aspect ratio dropdown not found');
            return false;
          }

          // Check if we need to change it (if current selection doesn't match target)
          const currentText = dropdownButton.textContent || '';
          if (currentText.includes(targetText)) {
            console.log(`[ShopEnginX] Aspect ratio already set to ${targetText}`);
            return true;
          }

          // Click to open dropdown
          console.log('[ShopEnginX] Opening aspect ratio dropdown...');
          dropdownButton.click();
          await delay(300);

          // Find and click the target option
          const options = document.querySelectorAll('[role="option"]');
          for (const option of options) {
            const optionText = option.textContent || '';
            if (optionText.includes(targetText)) {
              console.log(`[ShopEnginX] Clicking ${targetText} option`);
              (option as HTMLElement).click();
              await delay(300);
              return true;
            }
          }

          console.log(`[ShopEnginX] ${targetText} option not found`);
          return false;
        };

        // Wait for crop dialog and click "Crop and Save"
        const handleCropDialog = async (ratio: string): Promise<boolean> => {
          // Wait for crop dialog to appear (max 5 seconds)
          for (let i = 0; i < 10; i++) {
            await delay(500);

            // Look for "Crop and Save" button to confirm dialog is open
            const buttons = document.querySelectorAll('button');
            let cropAndSaveBtn: HTMLElement | null = null;

            for (const btn of buttons) {
              if (btn.textContent?.includes('Crop and Save')) {
                cropAndSaveBtn = btn as HTMLElement;
                break;
              }
            }

            if (cropAndSaveBtn) {
              console.log('[ShopEnginX] Crop dialog found');

              // Select aspect ratio first
              await selectAspectRatio(ratio);
              await delay(300);

              // Then click Crop and Save
              console.log('[ShopEnginX] Clicking Crop and Save button...');
              cropAndSaveBtn.click();
              return true;
            }

            console.log(`[ShopEnginX] Waiting for crop dialog... (${i + 1}/10)`);
          }
          console.log('[ShopEnginX] Crop dialog not found after waiting');
          return false;
        };

        // Convert first image to File
        const ext = base64Images[0].includes('image/png') ? 'png' :
          base64Images[0].includes('image/jpeg') ? 'jpg' :
            base64Images[0].includes('image/webp') ? 'webp' : 'png';
        const file = base64ToFile(base64Images[0], `image_1.${ext}`);

        (async () => {
          // Step 1: Find and click the + button to open menu
          const addButton = findAddButton();
          if (!addButton) {
            console.log('[ShopEnginX] Add button not found');
            sendResponse({ success: false, error: 'Add button not found' });
            return;
          }

          // Click the + button
          console.log('[ShopEnginX] Clicking + button to open image picker');
          addButton.click();

          // Step 2: Wait a bit for menu to open and file input to be available
          await delay(300);

          // Look for file input (it should exist on the page)
          let fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

          if (!fileInput) {
            console.log('[ShopEnginX] File input not found immediately, waiting...');
            await delay(500);
            fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
          }

          if (fileInput) {
            console.log('[ShopEnginX] Found file input, uploading...');
            await uploadToFileInput(fileInput, file);

            // Step 3: Wait for and handle crop dialog (with aspect ratio selection)
            console.log('[ShopEnginX] Waiting for crop dialog...');
            const cropHandled = await handleCropDialog(aspectRatio);

            if (cropHandled) {
              // Wait a moment for the image to be processed
              await delay(1000);
              console.log('[ShopEnginX] Image uploaded successfully');
              sendResponse({ success: true });
            } else {
              // Crop dialog didn't appear - image might have been uploaded directly
              console.log('[ShopEnginX] Crop dialog not found, checking if upload succeeded...');
              sendResponse({ success: true });
            }
          } else {
            // File input not found, try clicking Upload button in menu
            console.log('[ShopEnginX] File input not found, looking for Upload button in menu...');
            const menuButtons = document.querySelectorAll('button');
            let uploadButton: HTMLElement | null = null;

            for (const btn of menuButtons) {
              if (btn.textContent?.includes('Upload') && btn.textContent?.includes('.png')) {
                uploadButton = btn as HTMLElement;
                break;
              }
            }

            if (uploadButton) {
              console.log('[ShopEnginX] Found Upload button, clicking...');
              uploadButton.click();

              await delay(300);
              fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

              if (fileInput) {
                console.log('[ShopEnginX] Found file input after clicking Upload');
                await uploadToFileInput(fileInput, file);

                // Handle crop dialog (with aspect ratio selection)
                const cropHandled = await handleCropDialog(aspectRatio);
                if (cropHandled) {
                  await delay(1000);
                }
                sendResponse({ success: true });
              } else {
                console.log('[ShopEnginX] File input still not found');
                sendResponse({ success: false, error: 'File input not found' });
              }
            } else {
              console.log('[ShopEnginX] Upload button not found in menu');
              sendResponse({ success: false, error: 'Upload button not found' });
            }
          }
        })();

      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
      return true; // Keep channel open for async response

    case 'GENERATE_IMAGES':
      try {
        // Find and click the Create button
        const createButtons = document.querySelectorAll('button');
        let createButton: HTMLElement | null = null;
        for (const btn of createButtons) {
          if (btn.textContent?.includes('Create') && !btn.hasAttribute('disabled')) {
            createButton = btn as HTMLElement;
            break;
          }
        }

        if (createButton) {
          createButton.click();
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Create button not found or disabled' });
        }
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'CHECK_GENERATION_STATUS':
      try {
        // Detection logic for Google Flow image generation status:
        // Count percentage text (XX%) - this is the reliable loading indicator
        // Note: Create button disabled state is NOT reliable because it stays disabled
        // when prompt is empty (which happens after generation completes)

        // Count percentage indicators (loading)
        let percentageCount = 0;
        const textWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (textWalker.nextNode()) {
          const text = textWalker.currentNode.textContent?.trim() || '';
          if (/^\d{1,3}%$/.test(text)) {
            percentageCount++;
          }
        }

        // Count failed images (error message: "Couldn't generate image. Try again later.")
        const allImageContainers = document.querySelectorAll('div[class*="sc-6349d8ef-5"]');
        let errorCount = 0;
        allImageContainers.forEach((container) => {
          if (container.textContent?.includes("Couldn't generate image")) {
            errorCount++;
          }
        });

        const hasPercentage = percentageCount > 0;
        const hasError = errorCount > 0;
        const isLoading = hasPercentage;
        const isComplete = !isLoading;

        console.log('[CHECK_GENERATION_STATUS] Status:', { hasPercentage, percentageCount, hasError, errorCount, isLoading, isComplete });

        sendResponse({
          success: true,
          complete: isComplete,
          isLoading,
          hasPercentage,
          percentageCount,
          hasError,
          errorCount
        });
      } catch (e) {
        console.log('[CHECK_GENERATION_STATUS] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'GET_IMAGE_COUNT':
      try {
        // If tracker is active, use tracked count (more accurate with lazy loading)
        if (flowImageTracker.isActive()) {
          const trackedCount = flowImageTracker.getCount();
          console.log('[GET_IMAGE_COUNT] Using tracker, found', trackedCount, 'images');
          sendResponse({ success: true, count: trackedCount, source: 'tracker' });
        } else {
          // Fallback: Count visible images (may be inaccurate with lazy loading)
          const flowImages = document.querySelectorAll('img[alt^="Flow Image:"]');
          console.log('[GET_IMAGE_COUNT] Found', flowImages.length, 'images (DOM only)');
          sendResponse({ success: true, count: flowImages.length, source: 'dom' });
        }
      } catch (e) {
        console.log('[GET_IMAGE_COUNT] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    // ==================== Flow Image Tracker Handlers ====================

    case 'START_FLOW_IMAGE_TRACKER':
      try {
        flowImageTracker.start();
        const initialSnapshot = flowImageTracker.getSnapshot();
        console.log('[START_FLOW_IMAGE_TRACKER] Started, initial count:', initialSnapshot.length);
        sendResponse({
          success: true,
          count: initialSnapshot.length,
          snapshot: initialSnapshot
        });
      } catch (e) {
        console.log('[START_FLOW_IMAGE_TRACKER] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'STOP_FLOW_IMAGE_TRACKER':
      try {
        flowImageTracker.stop();
        console.log('[STOP_FLOW_IMAGE_TRACKER] Stopped');
        sendResponse({ success: true });
      } catch (e) {
        console.log('[STOP_FLOW_IMAGE_TRACKER] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'GET_FLOW_IMAGE_SNAPSHOT':
      try {
        const snapshot = flowImageTracker.getSnapshot();
        console.log('[GET_FLOW_IMAGE_SNAPSHOT] Snapshot count:', snapshot.length);
        sendResponse({
          success: true,
          snapshot: snapshot,
          count: snapshot.length
        });
      } catch (e) {
        console.log('[GET_FLOW_IMAGE_SNAPSHOT] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'RESET_FLOW_IMAGE_TRACKER':
      try {
        flowImageTracker.reset();
        console.log('[RESET_FLOW_IMAGE_TRACKER] Tracker reset');
        sendResponse({ success: true });
      } catch (e) {
        console.log('[RESET_FLOW_IMAGE_TRACKER] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'WAIT_FOR_NEW_IMAGES':
      (async () => {
        try {
          const expectedCount: number = message.expectedCount || 4;
          const timeoutMs: number = message.timeoutMs || 120000;

          console.log('[WAIT_FOR_NEW_IMAGES] Starting wait for', expectedCount, 'images, timeout:', timeoutMs);

          // Start the tracker if not already running
          if (!flowImageTracker.isActive()) {
            flowImageTracker.start();
          }

          // Wait for new images using MutationObserver-based detection
          const newUUIDs = await flowImageTracker.waitForNewImages(expectedCount, timeoutMs);

          console.log('[WAIT_FOR_NEW_IMAGES] Completed with', newUUIDs.length, 'new UUIDs:', newUUIDs);

          sendResponse({
            success: true,
            complete: newUUIDs.length >= expectedCount,
            newUUIDs: newUUIDs,
            count: newUUIDs.length
          });
        } catch (e) {
          console.log('[WAIT_FOR_NEW_IMAGES] Error:', e);
          sendResponse({ success: false, error: String(e) });
        }
      })();
      return true; // Keep message channel open for async response

    case 'CANCEL_WAIT_FOR_IMAGES':
      try {
        flowImageTracker.cancelWait();
        console.log('[CANCEL_WAIT_FOR_IMAGES] Wait cancelled');
        sendResponse({ success: true });
      } catch (e) {
        console.log('[CANCEL_WAIT_FOR_IMAGES] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'DOWNLOAD_NEW_IMAGES':
      try {
        const previousCount: number = message.previousCount || 0;
        const newImageCount: number = message.newImageCount || 4;

        console.log('[DOWNLOAD_NEW_IMAGES] Previous count:', previousCount, 'New images to download:', newImageCount);

        // Get all completed images
        const allFlowImages = document.querySelectorAll('img[alt^="Flow Image:"]');
        const totalImages = allFlowImages.length;

        console.log('[DOWNLOAD_NEW_IMAGES] Total images found:', totalImages);

        // New images are at the top (first N images where N = totalImages - previousCount)
        const newImagesCount = Math.min(newImageCount, totalImages - previousCount);

        if (newImagesCount <= 0) {
          console.log('[DOWNLOAD_NEW_IMAGES] No new images to download');
          sendResponse({ success: true, downloaded: 0 });
          return;
        }

        // Get the new images (they appear at the top/beginning)
        const newImages = Array.from(allFlowImages).slice(0, newImagesCount);

        console.log('[DOWNLOAD_NEW_IMAGES] Downloading', newImages.length, 'new images');

        // Download each new image
        let downloadedCount = 0;
        newImages.forEach((img, index) => {
          const imgElement = img as HTMLImageElement;
          const src = imgElement.src;

          if (src && src.startsWith('https://')) {
            // Create a download link
            const link = document.createElement('a');
            link.href = src;
            link.download = `flow_image_${Date.now()}_${index + 1}.png`;
            link.target = '_blank';

            // Trigger download
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            downloadedCount++;
            console.log(`[DOWNLOAD_NEW_IMAGES] Downloaded image ${index + 1}:`, link.download);
          }
        });

        console.log('[DOWNLOAD_NEW_IMAGES] Successfully downloaded', downloadedCount, 'images');
        sendResponse({ success: true, downloaded: downloadedCount });
      } catch (e) {
        console.log('[DOWNLOAD_NEW_IMAGES] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'DOWNLOAD_IMAGES_BY_UUID':
      (async () => {
        try {
          const uuids: string[] = message.uuids || [];
          const resolution: string = message.resolution || '2K';
          console.log('[DOWNLOAD_IMAGES_BY_UUID] Downloading images with UUIDs:', uuids, 'Resolution:', resolution);

          if (uuids.length === 0) {
            sendResponse({ success: true, downloaded: 0 });
            return;
          }

          let downloadedCount = 0;

          for (const uuid of uuids) {
            // Find the image element with this UUID in its src
            const img = document.querySelector(`img[src*="${uuid}"]`) as HTMLImageElement;

            if (!img) {
              console.log(`[DOWNLOAD_IMAGES_BY_UUID] Image not found for UUID: ${uuid}`);
              continue;
            }

            // Go to grandparent container where buttons are located
            // Structure: img -> parent (sc-6349d8ef-7) -> grandparent (sc-6349d8ef-5) which has buttons
            const container = img.parentElement?.parentElement;

            if (!container) {
              console.log(`[DOWNLOAD_IMAGES_BY_UUID] Container not found for UUID: ${uuid}`);
              continue;
            }

            const buttons = container.querySelectorAll('button');

            // Find the download button (has 'Download' in textContent)
            let downloadBtn: HTMLButtonElement | null = null;
            for (let i = 0; i < buttons.length; i++) {
              const text = buttons[i].textContent || '';
              if (text.includes('Download')) {
                downloadBtn = buttons[i] as HTMLButtonElement;
                break;
              }
            }

            if (!downloadBtn) {
              console.log(`[DOWNLOAD_IMAGES_BY_UUID] Download button not found for UUID: ${uuid}`);
              continue;
            }

            // Click download button - may show resolution menu (Pro) or download directly (non-Pro)
            downloadBtn.click();
            console.log(`[DOWNLOAD_IMAGES_BY_UUID] Clicked download button for UUID: ${uuid}`);

            // Wait for resolution menu to appear (Pro subscription feature)
            await new Promise(resolve => setTimeout(resolve, 300));

            // Check if resolution menu appeared (Pro subscription active)
            const resolutionMenu = document.querySelector('div[role="menuitem"]');
            if (resolutionMenu) {
              // Find the target resolution option
              const menuItems = document.querySelectorAll('div[role="menuitem"]');
              let targetOption: HTMLElement | null = null;
              const targetResolution = `Download ${resolution}`;

              for (const item of menuItems) {
                const text = item.textContent || '';
                if (text.includes(targetResolution)) {
                  targetOption = item as HTMLElement;
                  break;
                }
              }

              if (targetOption) {
                console.log(`[DOWNLOAD_IMAGES_BY_UUID] Selecting resolution: ${targetOption.textContent?.trim()}`);
                targetOption.click();
              } else {
                // Fallback: click first available option if target not found
                console.log(`[DOWNLOAD_IMAGES_BY_UUID] Target resolution ${resolution} not found, clicking first option`);
                (menuItems[0] as HTMLElement)?.click();
              }
            } else {
              // No resolution menu - direct download (non-Pro or old UI)
              console.log(`[DOWNLOAD_IMAGES_BY_UUID] No resolution menu, direct download for UUID: ${uuid}`);
            }

            downloadedCount++;

            // Wait between downloads to avoid issues
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          console.log('[DOWNLOAD_IMAGES_BY_UUID] Successfully downloaded', downloadedCount, 'images');
          sendResponse({ success: true, downloaded: downloadedCount });
        } catch (e) {
          console.log('[DOWNLOAD_IMAGES_BY_UUID] Error:', e);
          sendResponse({ success: false, error: String(e) });
        }
      })();
      return true; // Keep message channel open for async response

    // ==================== TikTok Handlers ====================

    case 'TIKTOK_CHECK_PAGE_READY':
      try {
        // Check if TikTok page is loaded by looking for user cards or search results
        const hasUserCards = document.querySelector('[data-e2e="search-user-container"]') !== null ||
                            document.querySelector('[class*="UserCard"]') !== null ||
                            document.querySelector('[class*="user-card"]') !== null;
        const hasSearchResults = document.querySelector('[data-e2e="search-common-link"]') !== null ||
                                document.querySelectorAll('a[href*="/@"]').length > 0;
        const ready = hasUserCards || hasSearchResults;
        console.log('[TIKTOK_CHECK_PAGE_READY]', { hasUserCards, hasSearchResults, ready });
        sendResponse({ success: true, ready });
      } catch (e) {
        console.log('[TIKTOK_CHECK_PAGE_READY] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'TIKTOK_CLICK_USERS_TAB':
      try {
        console.log('[TIKTOK_CLICK_USERS_TAB] Looking for Users tab...');

        // Method 1: Look for tab with "Users" text
        const tabs = document.querySelectorAll('[role="tab"], [data-e2e*="tab"], a[href*="/user"], button');
        let clicked = false;

        for (const tab of tabs) {
          const text = tab.textContent?.trim().toLowerCase() || '';
          if (text === 'users' || text === 'accounts' || text.includes('users')) {
            console.log('[TIKTOK_CLICK_USERS_TAB] Found Users tab:', text);
            (tab as HTMLElement).click();
            clicked = true;
            break;
          }
        }

        // Method 2: Look for link that leads to /search/user
        if (!clicked) {
          const userLinks = document.querySelectorAll('a[href*="/search/user"]');
          if (userLinks.length > 0) {
            console.log('[TIKTOK_CLICK_USERS_TAB] Found user search link');
            (userLinks[0] as HTMLElement).click();
            clicked = true;
          }
        }

        // Method 3: Look for specific TikTok tab element
        if (!clicked) {
          const allElements = document.querySelectorAll('*');
          for (const el of allElements) {
            if (el.getAttribute('data-e2e')?.includes('user') &&
                (el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'tab')) {
              console.log('[TIKTOK_CLICK_USERS_TAB] Found element with user data-e2e');
              (el as HTMLElement).click();
              clicked = true;
              break;
            }
          }
        }

        sendResponse({ success: clicked, error: clicked ? undefined : 'Users tab not found' });
      } catch (e) {
        console.log('[TIKTOK_CLICK_USERS_TAB] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'TIKTOK_CHECK_NO_RESULTS':
      try {
        // Check if "No results found for" message is displayed
        // Element: h2[data-e2e="search-error-title"] with text "No results found for ..."
        const noResultsHeading = document.querySelector('[data-e2e="search-error-title"]');
        const hasNoResults = noResultsHeading !== null &&
                            noResultsHeading.textContent?.includes('No results found for');

        console.log('[TIKTOK_CHECK_NO_RESULTS]', {
          hasNoResults,
          text: noResultsHeading?.textContent?.substring(0, 50)
        });

        sendResponse({ success: true, noResults: hasNoResults });
      } catch (e) {
        console.log('[TIKTOK_CHECK_NO_RESULTS] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'TIKTOK_GET_PROFILES':
      try {
        console.log('[TIKTOK_GET_PROFILES] Scanning for user profiles...');

        const profiles: Array<{
          id: string;
          name: string;
          username: string;
          followerText: string;
          isFollowing: boolean;
          index: number;
        }> = [];

        // Find user cards - TikTok search uses DivSearchUserItemContainer
        const userContainers = document.querySelectorAll('[class*="DivSearchUserItemContainer"]');

        console.log('[TIKTOK_GET_PROFILES] Found', userContainers.length, 'user cards');

        userContainers.forEach((container, index) => {
          try {
            // Parse text content - format: "displayName\n\nusername\n\nXXX\n\nFollowers..."
            const textContent = (container as HTMLElement).innerText || '';
            const parts = textContent.split('\n').filter(t => t.trim());

            // parts[0] = display name, parts[1] = username, parts[2] = follower count
            const name = parts[0] || '';
            const username = parts[1] || '';
            const followerText = parts[2] || '0';

            // Get button and check its state
            const btn = container.querySelector('button');
            const btnText = btn?.textContent?.trim().toLowerCase() || '';

            // "follow" = not following, "following"/"friends" = already following
            const isFollowing = btnText === 'following' || btnText === 'friends' || btnText === 'requested';
            const hasFollowButton = btnText === 'follow' || isFollowing;

            console.log('[TIKTOK_GET_PROFILES] Card', index, ':', { name, username, followerText, btnText, isFollowing });

            if (hasFollowButton && username) {
              profiles.push({
                id: `profile_${index}_${username}`,
                name,
                username,
                followerText,
                isFollowing,
                index
              });
            }
          } catch (err) {
            console.warn('[TIKTOK_GET_PROFILES] Error parsing profile:', err);
          }
        });

        console.log('[TIKTOK_GET_PROFILES] Parsed', profiles.length, 'profiles');
        sendResponse({ success: true, profiles });
      } catch (e) {
        console.log('[TIKTOK_GET_PROFILES] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'TIKTOK_CLICK_FOLLOW':
      try {
        const profileId: string = message.profileId || '';
        const profileIndex = parseInt(profileId.split('_')[1] || '0');

        console.log('[TIKTOK_CLICK_FOLLOW] Looking for follow button at index:', profileIndex);

        // Find user containers - same selector as GET_PROFILES
        const containers = document.querySelectorAll('[class*="DivSearchUserItemContainer"]');

        console.log('[TIKTOK_CLICK_FOLLOW] Total containers found:', containers.length);

        if (profileIndex >= containers.length) {
          sendResponse({ success: false, error: `Profile index ${profileIndex} >= containers ${containers.length}` });
          return;
        }

        const container = containers[profileIndex];
        const btn = container.querySelector('button');
        const btnText = btn?.textContent?.trim().toLowerCase() || '';

        console.log('[TIKTOK_CLICK_FOLLOW] Button text:', btnText);

        // Only click if it says "follow" (not "following")
        if (btn && btnText === 'follow') {
          console.log('[TIKTOK_CLICK_FOLLOW] Clicking follow button');
          (btn as HTMLElement).click();
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: `Button text is "${btnText}", not "follow"` });
        }
      } catch (e) {
        console.log('[TIKTOK_CLICK_FOLLOW] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'TIKTOK_START_RATE_LIMIT_OBSERVER':
      try {
        // Reset state
        (window as any).__tiktokRateLimited = false;
        (window as any).__tiktokRateLimitMessage = '';

        // Disconnect existing observer if any
        if ((window as any).__tiktokRateLimitObserver) {
          (window as any).__tiktokRateLimitObserver.disconnect();
        }

        // Rate limit detection callback (shared logic)
        const onMutation = (mutations: MutationRecord[]) => {
          mutations.forEach(m => {
            m.addedNodes.forEach(node => {
              if (node.nodeType === 1) {
                const text = ((node as HTMLElement).innerText || '').toLowerCase();
                // Check for rate limit messages (curly apostrophe \u2019 or regular)
                if (text.includes("couldn\u2019t follow") ||
                    text.includes("couldn't follow") ||
                    text.includes('too many requests') ||
                    text.includes('try again later')) {
                  (window as any).__tiktokRateLimited = true;
                  (window as any).__tiktokRateLimitMessage = text.substring(0, 100);
                  console.log('[TIKTOK] Rate limit detected:', text);
                }
              }
            });
          });
        };

        // Option 1: Observe PREFIX_CLASS container (TikTok's toast container)
        const prefixContainer = document.querySelector('[class*="PREFIX_CLASS"]');

        // Option 2: Observe document.body (fallback, catches everything)
        // const observeTarget = document.body;

        const observeTarget = prefixContainer || document.body;

        if (!observeTarget) {
          console.log('[TIKTOK_START_RATE_LIMIT_OBSERVER] No observe target found');
          sendResponse({ success: false, error: 'Observe target not found' });
          return;
        }

        const rateLimitObserver = new MutationObserver(onMutation);
        rateLimitObserver.observe(observeTarget, { childList: true, subtree: true });
        (window as any).__tiktokRateLimitObserver = rateLimitObserver;

        console.log('[TIKTOK_START_RATE_LIMIT_OBSERVER] Observer started on:', observeTarget === document.body ? 'document.body' : 'PREFIX_CLASS');
        sendResponse({ success: true });
      } catch (e) {
        console.log('[TIKTOK_START_RATE_LIMIT_OBSERVER] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'TIKTOK_STOP_RATE_LIMIT_OBSERVER':
      try {
        if ((window as any).__tiktokRateLimitObserver) {
          (window as any).__tiktokRateLimitObserver.disconnect();
          (window as any).__tiktokRateLimitObserver = null;
        }
        (window as any).__tiktokRateLimited = false;
        (window as any).__tiktokRateLimitMessage = '';
        console.log('[TIKTOK_STOP_RATE_LIMIT_OBSERVER] Observer stopped');
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'TIKTOK_CHECK_RATE_LIMIT':
      try {
        // Check if the observer detected a rate limit
        const rateLimited = (window as any).__tiktokRateLimited || false;
        const matchedPhrase = (window as any).__tiktokRateLimitMessage || '';

        console.log('[TIKTOK_CHECK_RATE_LIMIT] Observer state:', { rateLimited, matchedPhrase });
        sendResponse({ success: true, rateLimited, matchedPhrase });
      } catch (e) {
        console.log('[TIKTOK_CHECK_RATE_LIMIT] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'TIKTOK_SCROLL_FOR_MORE':
      try {
        console.log('[TIKTOK_SCROLL_FOR_MORE] Scrolling to load more profiles...');

        // TikTok uses MAIN element with SearchGridLayoutContainer as scrollable container
        const mainContainer = document.querySelector('main[class*="SearchGridLayoutContainer"]');

        if (mainContainer) {
          console.log('[TIKTOK_SCROLL_FOR_MORE] Found main container, scrolling...');
          mainContainer.scrollBy({
            top: 800,
            behavior: 'smooth'
          });
        } else {
          // Fallback to window scroll
          console.log('[TIKTOK_SCROLL_FOR_MORE] Using window scroll fallback');
          window.scrollBy({
            top: 800,
            behavior: 'smooth'
          });
        }

        sendResponse({ success: true });
      } catch (e) {
        console.log('[TIKTOK_SCROLL_FOR_MORE] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'TIKTOK_UPDATE_RATE_LIMIT_PHRASES':
      try {
        // Store custom rate limit phrases for checking
        const phrases: string[] = message.phrases || [];
        (window as any).__tiktokRateLimitPhrases = phrases;
        console.log('[TIKTOK_UPDATE_RATE_LIMIT_PHRASES] Updated phrases:', phrases);
        sendResponse({ success: true });
      } catch (e) {
        console.log('[TIKTOK_UPDATE_RATE_LIMIT_PHRASES] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  return true;
});

console.log('[ShopEnginX] Content script loaded');
