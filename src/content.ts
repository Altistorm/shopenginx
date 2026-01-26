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
  private completionRejecter: ((error: Error) => void) | null = null;
  private completionTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingImagesWithoutSrc: Set<HTMLImageElement> = new Set();
  private detectedNewUUIDs: Set<string> = new Set();
  private lastPercentage: number = 0;
  private isGenerating: boolean = false;
  private generationFailed: boolean = false;

  // Check for error containers - result containers that have no image (generation failed)
  // Returns error text if found, null if no errors
  // 
  // Detection strategy: Check if container has img[src*="storage.googleapis.com"]. If not = error.
  // 
  // DOM Structure Reference:
  // - Success: Container has <img src="storage.googleapis.com/...">
  // - Error: Container has NO image, shows error text instead (e.g., "This generation might violate our policies")
  // 
  // Common error text patterns (for reference):
  // - "Couldn't generate" / "Try again later" - general failure
  // - "violate our policies" / "might violate" - policy violation
  private detectErrorContainers(): string | null {
    // Find all result containers (they have the download/favorite buttons)
    const resultContainers = document.querySelectorAll('[class*="sc-6349d8ef-7"], [class*="result-container"]');
    
    for (const container of resultContainers) {
      // Check if this container has a Flow Image
      const hasImage = container.querySelector('img[alt^="Flow Image:"]');
      
      if (!hasImage) {
        // No image = error. Return whatever text is there for logging
        const textContent = container.textContent?.trim() || 'Unknown error (no image in result container)';
        console.log('[FlowImageTracker] 🔍 Error container detected (no image):', textContent.substring(0, 100));
        return textContent.substring(0, 200);
      }
    }
    
    return null;
  }

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

  // Handle generation error detected from DOM
  private handleGenerationError(errorText: string) {
    if (!this.isGenerating || this.generationFailed) {
      return;
    }

    this.generationFailed = true;
    console.log('[FlowImageTracker] ❌ Generation failed:', errorText);

    // Reject the promise if we have a rejecter
    if (this.completionRejecter) {
      const error = new Error(`Generation failed: ${errorText}`);
      this.completionRejecter(error);
      this.completionRejecter = null;
      this.completionResolver = null;
    }

    // Clear timeout
    if (this.completionTimeout) {
      clearTimeout(this.completionTimeout);
      this.completionTimeout = null;
    }

    this.isGenerating = false;
  }

  // Start waiting for new images (call before clicking Create)
  waitForNewImages(expectedCount: number, timeoutMs: number = 120000): Promise<string[]> {
    return new Promise((resolve, reject) => {
      // Take snapshot before generation
      this.snapshotBeforeGeneration = [...this.orderedIds];
      this.expectedNewImageCount = expectedCount;
      this.detectedNewUUIDs.clear();
      this.pendingImagesWithoutSrc.clear();
      this.isGenerating = true;
      this.generationFailed = false;
      this.lastPercentage = 0;

      console.log('[FlowImageTracker] 🚀 Waiting for', expectedCount, 'new images. Snapshot:', this.snapshotBeforeGeneration.length, 'existing');

      this.completionResolver = resolve;
      this.completionRejecter = reject;

      // Set timeout
      this.completionTimeout = setTimeout(() => {
        console.log('[FlowImageTracker] ⏰ Timeout reached. Detected UUIDs:', Array.from(this.detectedNewUUIDs));
        
        // Check if we got fewer images than expected - might be an error
        const detectedCount = this.detectedNewUUIDs.size;
        if (detectedCount < expectedCount) {
          console.log('[FlowImageTracker] ⚠️ Got fewer images than expected:', detectedCount, '/', expectedCount);
          
          // Check for error containers
          const errorText = this.detectErrorContainers();
          if (errorText) {
            console.log('[FlowImageTracker] ❌ Error detected on timeout:', errorText);
            this.handleGenerationError(errorText);
            return;
          }
          
          // No explicit error found but still missing images - might be partial failure
          if (detectedCount === 0) {
            // Complete failure - no images at all
            console.log('[FlowImageTracker] ❌ Complete generation failure - no images detected');
            this.handleGenerationError('Generation timed out with no images produced');
            return;
          }
        }
        
        // Either got all expected images, or partial success without error
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

        // Check added nodes for error messages
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement || node instanceof Text) {
            const text = node.textContent?.trim() || '';
            // Detect generation failure - error message replaces percentage
            // Common error patterns:
            // - "Couldn't generate" / "Try again later" - general failure
            // - "violate our policies" / "might violate" - policy violation
            if (text.includes("Couldn't generate") || 
                text.includes('Try again later') ||
                text.includes('violate') ||
                text.includes('policies')) {
              console.log('[FlowImageTracker] ❌ Generation error detected:', text.substring(0, 80));
              this.handleGenerationError(text);
            }
          }
        });
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
    this.generationFailed = false;
    this.lastPercentage = 0;

    if (this.completionTimeout) {
      clearTimeout(this.completionTimeout);
      this.completionTimeout = null;
    }
    if (this.completionResolver) {
      this.completionResolver([]);
      this.completionResolver = null;
    }
    this.completionRejecter = null;

    console.log('[FlowImageTracker] Reset');
  }

  // Check if tracking
  isActive(): boolean {
    return this.isTracking;
  }
}

// Global instance
const flowImageTracker = new FlowImageTracker();

// ==================== Video Flow Controller ====================
// Automates video generation workflow on Google Flow

// TypeScript interfaces for video flow configuration
interface VideoSetConfig {
  image?: string;              // Base64 encoded start frame image
  prompts: string[];           // prompts[0] = initial, prompts[1..N] = extensions
  aspectRatio: '9:16' | '16:9';
  outputCount: number;         // Outputs per prompt (1-4)
  autoDownload: boolean;
}

interface StepRetryConfig {
  maxAttempts: number;         // 1 = no retry
  retryDelayMs: number;
  timeoutMs: number;
}

interface VideoProgressEvent {
  step: string;
  attempt: number;
  maxAttempts: number;
  status: 'running' | 'success' | 'retrying' | 'failed';
  promptIndex?: number;        // Which prompt we're on (0 = initial, 1+ = extensions)
  totalPrompts?: number;
  error?: string;
  percent?: number;            // Generation progress percentage
}

interface VideoFlowResult {
  success: boolean;
  error?: string;
  completedPrompts: number;    // How many prompts completed (including initial)
  downloaded: boolean;
}

// Default retry configuration per step
const DEFAULT_VIDEO_STEP_CONFIG: Record<string, StepRetryConfig> = {
  ensureVideoMode:        { maxAttempts: 3, retryDelayMs: 1000, timeoutMs: 30000 },
  configureSettings:      { maxAttempts: 2, retryDelayMs: 1000, timeoutMs: 30000 },
  uploadImage:            { maxAttempts: 3, retryDelayMs: 2000, timeoutMs: 60000 },
  fillPrompt:             { maxAttempts: 2, retryDelayMs: 500,  timeoutMs: 10000 },
  clickCreate:            { maxAttempts: 3, retryDelayMs: 2000, timeoutMs: 30000 },
  waitForInitialComplete: { maxAttempts: 1, retryDelayMs: 0,    timeoutMs: 600000 }, // 10 min for video gen
  clickAddToScene:        { maxAttempts: 3, retryDelayMs: 1000, timeoutMs: 30000 },
  enterExtendMode:        { maxAttempts: 3, retryDelayMs: 1000, timeoutMs: 30000 },
  fillExtensionPrompt:    { maxAttempts: 2, retryDelayMs: 500,  timeoutMs: 10000 },
  waitForExtensionComplete: { maxAttempts: 1, retryDelayMs: 0,  timeoutMs: 600000 },
  downloadVideo:          { maxAttempts: 3, retryDelayMs: 3000, timeoutMs: 120000 }, // 2 min for export
};

// Helper to find elements by text content
const findButtonByText = (text: string, exact: boolean = false): HTMLButtonElement | null => {
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    const btnText = btn.textContent || '';
    if (exact ? btnText.trim() === text : btnText.includes(text)) {
      return btn as HTMLButtonElement;
    }
  }
  return null;
};

const findByText = (selector: string, text: string): HTMLElement | null => {
  const elements = document.querySelectorAll(selector);
  for (const el of elements) {
    if (el.textContent?.includes(text)) {
      return el as HTMLElement;
    }
  }
  return null;
};

class VideoFlowController {
  private observer: MutationObserver | null = null;
  private pendingResolvers: Array<{
    condition: () => boolean;
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    stepName: string;
  }> = [];
  private aborted: boolean = false;
  private progressCallback: ((event: VideoProgressEvent) => void) | null = null;
  private stepConfig: Record<string, StepRetryConfig>;

  constructor(
    stepConfigOverrides?: Partial<Record<string, Partial<StepRetryConfig>>>,
    onProgress?: (event: VideoProgressEvent) => void
  ) {
    // Merge default config with overrides
    this.stepConfig = { ...DEFAULT_VIDEO_STEP_CONFIG };
    if (stepConfigOverrides) {
      for (const [step, override] of Object.entries(stepConfigOverrides)) {
        if (this.stepConfig[step] && override) {
          this.stepConfig[step] = { ...this.stepConfig[step], ...override };
        }
      }
    }
    this.progressCallback = onProgress || null;
  }

  // ==================== MutationObserver Core ====================

  private ensureObserver(): void {
    if (this.observer) return;

    this.observer = new MutationObserver(() => this.onMutation());
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    console.log('[VideoFlowController] Observer started');
  }

  private onMutation(): void {
    // Auto-dismiss "Notice" agreement dialog if it appears
    this.handleNoticeDialog();

    // Check all pending conditions
    for (const resolver of [...this.pendingResolvers]) {
      try {
        if (resolver.condition()) {
          clearTimeout(resolver.timeout);
          this.removeResolver(resolver);
          resolver.resolve();
        }
      } catch (e) {
        // Condition check failed, ignore
      }
    }
  }

  /**
   * Auto-dismiss the "Notice" agreement dialog if it appears during upload
   */
  private handleNoticeDialog(): void {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return;
    
    const dialogText = dialog.textContent || '';
    // Check if this is the Notice/agreement dialog (not settings or other dialogs)
    if (dialogText.includes('Notice') && 
        dialogText.includes('necessary rights') && 
        dialogText.includes('I agree')) {
      console.log('[VideoFlowController] Auto-dismissing Notice dialog');
      const agreeBtn = findButtonByText('I agree');
      if (agreeBtn) {
        agreeBtn.click();
      }
    }
  }

  private removeResolver(resolver: typeof this.pendingResolvers[0]): void {
    const idx = this.pendingResolvers.indexOf(resolver);
    if (idx !== -1) {
      this.pendingResolvers.splice(idx, 1);
    }
  }

  /**
   * Wait for a condition to be true, using MutationObserver for efficient detection
   */
  waitFor(condition: () => boolean, stepName: string, timeoutMs: number): Promise<void> {
    // Check immediately first
    if (condition()) return Promise.resolve();
    if (this.aborted) return Promise.reject(new Error('Workflow aborted'));

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeResolver(resolver);
        reject(new Error(`Timeout waiting for ${stepName} (${timeoutMs}ms)`));
      }, timeoutMs);

      const resolver = { condition, resolve, reject, timeout, stepName };
      this.pendingResolvers.push(resolver);
      this.ensureObserver();
    });
  }

  /**
   * Wait for specified milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Report progress to callback
   */
  private reportProgress(event: VideoProgressEvent): void {
    console.log('[VideoFlowController] Progress:', event);
    if (this.progressCallback) {
      this.progressCallback(event);
    }
  }

  /**
   * Cleanup observer and pending resolvers
   */
  destroy(): void {
    this.aborted = true;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    // Reject all pending resolvers
    for (const resolver of this.pendingResolvers) {
      clearTimeout(resolver.timeout);
      resolver.reject(new Error('Controller destroyed'));
    }
    this.pendingResolvers = [];
    console.log('[VideoFlowController] Destroyed');
  }

  /**
   * Abort the current workflow
   */
  abort(): void {
    this.aborted = true;
    console.log('[VideoFlowController] Aborted');
  }

  // ==================== Step Functions ====================

  /**
   * Step: Ensure we're in "Frames to Video" mode
   */
  async ensureVideoMode(): Promise<void> {
    const config = this.stepConfig['ensureVideoMode'];

    // Check if already in Frames to Video mode
    const modeDropdown = document.querySelector('[role="combobox"]');
    if (modeDropdown?.textContent?.includes('Frames to Video')) {
      console.log('[VideoFlowController] Already in Frames to Video mode');
      return;
    }

    // Click mode dropdown
    const dropdown = findByText('[role="combobox"]', 'arrow_drop_down');
    if (!dropdown) throw new Error('Mode dropdown not found');
    dropdown.click();

    // Wait for listbox to appear
    await this.waitFor(
      () => document.querySelector('[role="listbox"]') !== null,
      'mode listbox',
      config.timeoutMs
    );
    await this.delay(200);

    // Click "Frames to Video" option
    const option = findByText('[role="option"]', 'Frames to Video');
    if (!option) throw new Error('Frames to Video option not found');
    option.click();

    // Wait for mode to change
    await this.waitFor(
      () => {
        const current = document.querySelector('[role="combobox"]');
        return current?.textContent?.includes('Frames to Video') ?? false;
      },
      'mode change to Frames to Video',
      config.timeoutMs
    );
    await this.delay(300);
  }

/**
   * Step: Configure settings (aspect ratio + output count) via Settings dialog
   */
  async configureSettings(aspectRatio: '9:16' | '16:9', outputCount: number): Promise<void> {
    const config = this.stepConfig['configureSettings'];
    const isPortrait = aspectRatio === '9:16';
    const targetAspectText = isPortrait ? 'Portrait' : 'Landscape';

    // Helper to get fresh dialog reference
    const getDialog = () => document.querySelector('[role="dialog"]');

    // Open settings dialog
    const settingsBtn = findButtonByText('Settings');
    if (!settingsBtn) throw new Error('Settings button not found');
    console.log('[VideoFlowController] Clicking Settings button');
    settingsBtn.click();

    // Wait for dialog
    await this.waitFor(
      () => getDialog() !== null,
      'settings dialog',
      config.timeoutMs
    );
    await this.delay(500);
    console.log('[VideoFlowController] Settings dialog opened');

    // ===== Set Aspect Ratio =====
    const aspectCombobox = findByText('[role="combobox"]', 'Aspect Ratio');
    if (aspectCombobox) {
      // Check if already correct
      if (!aspectCombobox.textContent?.includes(targetAspectText)) {
        console.log('[VideoFlowController] Clicking Aspect Ratio combobox');
        aspectCombobox.click();
        await this.delay(300);

        // Wait for options
        await this.waitFor(
          () => document.querySelectorAll('[role="option"]').length > 0,
          'aspect ratio options',
          config.timeoutMs
        );

        const targetOption = Array.from(document.querySelectorAll('[role="option"]'))
          .find(el => el.textContent?.includes(targetAspectText));
        if (targetOption) {
          console.log('[VideoFlowController] Selecting aspect ratio:', targetAspectText);
          (targetOption as HTMLElement).click();
          await this.delay(300);

          // Wait for dropdown to close
          await this.waitFor(
            () => document.querySelectorAll('[role="option"]').length === 0,
            'aspect ratio dropdown close',
            5000
          );
          await this.delay(200);
        }
      } else {
        console.log('[VideoFlowController] Aspect ratio already set to:', targetAspectText);
      }
    }

    // ===== Set Output Count =====
    const outputCombobox = findByText('[role="combobox"]', 'Outputs per prompt');
    if (outputCombobox) {
      // Check if already correct
      const currentCount = outputCombobox.textContent?.match(/\d+/)?.[0];
      if (currentCount !== String(outputCount)) {
        console.log('[VideoFlowController] Clicking Outputs per prompt combobox, current:', currentCount);
        outputCombobox.click();
        await this.delay(300);

        // Wait for options
        await this.waitFor(
          () => document.querySelectorAll('[role="option"]').length > 0,
          'output count options',
          config.timeoutMs
        );

        const allOptions = document.querySelectorAll('[role="option"]');
        console.log('[VideoFlowController] Found options:', allOptions.length);

        const countOption = Array.from(allOptions)
          .find(el => el.textContent?.trim() === String(outputCount));
        if (countOption) {
          console.log('[VideoFlowController] Selecting output count:', outputCount);
          (countOption as HTMLElement).click();
          await this.delay(300);

          // Wait for dropdown to close
          await this.waitFor(
            () => document.querySelectorAll('[role="option"]').length === 0,
            'output count dropdown close',
            5000
          );
          await this.delay(200);
        } else {
          console.log('[VideoFlowController] Option not found for count:', outputCount);
        }
      } else {
        console.log('[VideoFlowController] Output count already set to:', outputCount);
      }
    } else {
      console.log('[VideoFlowController] Outputs per prompt combobox not found');
    }

    // Close dialog with Escape
    console.log('[VideoFlowController] Closing settings dialog');
    const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(escEvent);

    // Wait for dialog to close
    await this.waitFor(
      () => getDialog() === null,
      'settings dialog close',
      config.timeoutMs
    );
    await this.delay(200);
  }

  /**
   * Helper: Select aspect ratio in crop dialog
   * Must be called when crop dialog is visible, before clicking "Crop and Save"
   */
  private async selectCropAspectRatio(aspectRatio: '9:16' | '16:9'): Promise<void> {
    const targetText = aspectRatio === '9:16' ? 'Portrait' : 'Landscape';
    
    // Find the combobox in the crop dialog
    const cropDialog = document.querySelector('[role="dialog"]');
    if (!cropDialog) {
      console.log('[VideoFlowController] No crop dialog found for aspect ratio selection');
      return;
    }
    
    const combobox = cropDialog.querySelector('[role="combobox"]') as HTMLElement;
    if (!combobox) {
      console.log('[VideoFlowController] No combobox found in crop dialog');
      return;
    }
    
    // Check if already set correctly
    if (combobox.textContent?.includes(targetText)) {
      console.log('[VideoFlowController] Crop aspect ratio already set to:', targetText);
      return;
    }
    
    console.log('[VideoFlowController] Setting crop aspect ratio to:', targetText);
    combobox.click();
    await this.delay(300);
    
    // Wait for options to appear
    await this.waitFor(
      () => document.querySelectorAll('[role="option"]').length > 0,
      'crop aspect ratio options',
      5000
    );
    
    // Find and click the target option
    const options = document.querySelectorAll('[role="option"]');
    const targetOption = Array.from(options).find(opt => opt.textContent?.includes(targetText));
    if (targetOption) {
      (targetOption as HTMLElement).click();
      await this.delay(300);
      
      // Wait for dropdown to close
      await this.waitFor(
        () => document.querySelectorAll('[role="option"]').length === 0,
        'crop dropdown close',
        5000
      );
      await this.delay(200);
      console.log('[VideoFlowController] Crop aspect ratio set to:', targetText);
    } else {
      console.log('[VideoFlowController] Could not find option:', targetText);
    }
  }

  /**
   * Step: Upload start frame image
   */
  async uploadImage(base64Image: string, aspectRatio: '9:16' | '16:9'): Promise<void> {
    const config = this.stepConfig['uploadImage'];

    // Convert base64 to File first
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
    const file = new File([u8arr], `frame.${ext}`, { type: mime });

    // Find the first "add" button (for first frame)
    const addButtons = document.querySelectorAll('button');
    let addButton: HTMLButtonElement | null = null;
    for (const btn of addButtons) {
      if (btn.textContent?.trim() === 'add' || btn.textContent?.includes('First Frame')) {
        addButton = btn as HTMLButtonElement;
        break;
      }
    }
    if (!addButton) throw new Error('Add frame button not found');

    // Click to open menu
    console.log('[VideoFlowController] Clicking add button to open menu');
    addButton.click();
    await this.delay(300);

    // Check if file input already exists (some implementations have it ready)
    let fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    
    if (!fileInput) {
      // Need to click Upload button in menu to create file input
      const uploadBtn = findButtonByText('Upload');
      if (!uploadBtn) throw new Error('Upload button not found in menu');
      
      console.log('[VideoFlowController] Creating file input for upload');
      
      // Create a hidden file input
      fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.png,.jpg,.jpeg,.webp,.heic,.avif';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);
      
      // Set files and trigger events
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      
      // Now click the Upload button
      uploadBtn.click();
      await this.delay(100);
      
      // Try to find Google Flow's file input and set our file on it
      const flowFileInput = document.querySelector('input[type="file"]:not([style*="display: none"])') as HTMLInputElement;
      if (flowFileInput && flowFileInput !== fileInput) {
        console.log('[VideoFlowController] Found Flow file input, setting files');
        flowFileInput.files = dataTransfer.files;
        flowFileInput.dispatchEvent(new Event('change', { bubbles: true }));
        flowFileInput.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        // Dispatch on our created input
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      
      // Clean up our temp input
      document.body.removeChild(fileInput);
    } else {
      // File input already exists, use it directly
      console.log('[VideoFlowController] Using existing file input');
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    // Wait for either Notice dialog or Crop dialog to appear
    await this.delay(500);
    
    // Handle Notice dialog if it appears
    let noticeDialog = document.querySelector('[role="dialog"]');
    if (noticeDialog?.textContent?.includes('Notice') && noticeDialog?.textContent?.includes('I agree')) {
      console.log('[VideoFlowController] Notice dialog detected, clicking I agree');
      const agreeBtn = findButtonByText('I agree');
      if (agreeBtn) {
        agreeBtn.click();
        await this.delay(500);
      }
    }
    
    // Wait for crop dialog to appear
    await this.waitFor(
      () => findButtonByText('Crop and Save') !== null,
      'crop dialog',
      config.timeoutMs
    );
    
    // Select aspect ratio in crop dialog BEFORE clicking Crop and Save
    await this.selectCropAspectRatio(aspectRatio);
    
    // Now click Crop and Save
    const cropBtn = findButtonByText('Crop and Save');
    if (cropBtn) {
      console.log('[VideoFlowController] Clicking Crop and Save');
      cropBtn.click();
      await this.delay(500);
    }
    
    // Wait for image to appear in frame slot
    await this.waitFor(
      () => {
        const frameButtons = document.querySelectorAll('button');
        for (const btn of frameButtons) {
          if (btn.textContent?.includes('First Frame') || btn.querySelector('img')) {
            const img = btn.querySelector('img');
            if (img) return true;
          }
        }
        return false;
      },
      'image upload complete',
      config.timeoutMs
    );
    
    await this.delay(300);
    console.log('[VideoFlowController] Image upload complete');
  }

  /**
   * Step: Fill the video prompt
   */
  async fillPrompt(prompt: string): Promise<void> {
    const config = this.stepConfig['fillPrompt'];

    // Find prompt textbox
    const textbox = document.querySelector('textarea, input[type="text"]') as HTMLInputElement | HTMLTextAreaElement;
    if (!textbox) throw new Error('Prompt textbox not found');

    textbox.focus();
    textbox.value = prompt;
    textbox.dispatchEvent(new Event('input', { bubbles: true }));
    textbox.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait for Create button to become enabled
    await this.waitFor(
      () => {
        const createBtn = findButtonByText('Create');
        return createBtn !== null && !createBtn.hasAttribute('disabled');
      },
      'Create button enabled',
      config.timeoutMs
    );
    await this.delay(200);
  }

  /**
   * Step: Click Create button to start generation
   */
  async clickCreate(): Promise<void> {
    const config = this.stepConfig['clickCreate'];

    const createBtn = findButtonByText('Create');
    if (!createBtn || createBtn.hasAttribute('disabled')) {
      throw new Error('Create button not found or disabled');
    }

    createBtn.click();
    console.log('[VideoFlowController] Clicked Create button');

    // Wait for generation to start (percentage appears)
    await this.waitFor(
      () => {
        const allText = document.body.innerText || '';
        return /\d{1,3}%/.test(allText);
      },
      'generation started (percentage)',
      config.timeoutMs
    );
  }

  /**
   * Step: Wait for initial video generation to complete
   */
  async waitForInitialCompletion(): Promise<void> {
    const config = this.stepConfig['waitForInitialComplete'];

    // Wait for "Add to scene" button to appear (indicates completion)
    await this.waitFor(
      () => findButtonByText('Add to scene') !== null,
      'Add to scene button',
      config.timeoutMs
    );
    console.log('[VideoFlowController] Initial generation complete');
  }

  /**
   * Step: Click "Add to scene" to go to scenebuilder
   */
  async clickAddToScene(): Promise<void> {
    const config = this.stepConfig['clickAddToScene'];

    const addBtn = findButtonByText('Add to scene');
    if (!addBtn) throw new Error('Add to scene button not found');

    addBtn.click();
    console.log('[VideoFlowController] Clicked Add to scene');

    // Wait for URL to change to scenebuilder
    await this.waitFor(
      () => window.location.href.includes('/scenes/'),
      'navigate to scenebuilder',
      config.timeoutMs
    );
    await this.delay(1000); // Wait for scenebuilder to load
  }

/**
   * Step: Enter extend mode via "Add clip after last clip" menu
   * @param aspectRatio - Aspect ratio to configure after entering extend mode
   * @param outputCount - Output count to configure after entering extend mode
   */
  async enterExtendMode(aspectRatio?: '9:16' | '16:9', outputCount?: number): Promise<void> {
    const config = this.stepConfig['enterExtendMode'];

    // Click "Add clip after last clip" button
    const addClipBtn = findButtonByText('Add clip after last clip');
    if (!addClipBtn) throw new Error('Add clip button not found');

    addClipBtn.click();
    await this.delay(300);

    // Wait for menu to appear
    await this.waitFor(
      () => findByText('[role="menuitem"]', 'Extend') !== null,
      'extend menu item',
      config.timeoutMs
    );

    // Click "Extend..." menu item
    const extendItem = findByText('[role="menuitem"]', 'Extend');
    if (!extendItem) throw new Error('Extend menu item not found');

    extendItem.click();

    // Wait for extend mode (textbox changes to "What happens next?")
    await this.waitFor(
      () => document.querySelector('[placeholder*="What happens next"]') !== null ||
            findByText('[role="textbox"]', 'What happens next') !== null,
      'extend mode active',
      config.timeoutMs
    );
    await this.delay(300);
    console.log('[VideoFlowController] Entered extend mode');

    // Configure settings in extend mode (same dialog as Project Editor)
    if (aspectRatio && outputCount) {
      await this.configureSettings(aspectRatio, outputCount);
    }
  }

  /**
   * Step: Fill extension prompt
   */
  async fillExtensionPrompt(prompt: string): Promise<void> {
    const config = this.stepConfig['fillExtensionPrompt'];

    // Find the "What happens next?" textbox
    let textbox = document.querySelector('[placeholder*="What happens next"]') as HTMLInputElement | HTMLTextAreaElement;
    if (!textbox) {
      // Try finding by role
      textbox = document.querySelector('textarea, input[type="text"]') as HTMLInputElement | HTMLTextAreaElement;
    }
    if (!textbox) throw new Error('Extension prompt textbox not found');

    textbox.focus();
    textbox.value = prompt;
    textbox.dispatchEvent(new Event('input', { bubbles: true }));
    textbox.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait for Create button to become enabled
    await this.waitFor(
      () => {
        const createBtn = findButtonByText('Create');
        return createBtn !== null && !createBtn.hasAttribute('disabled');
      },
      'Create button enabled for extension',
      config.timeoutMs
    );
    await this.delay(200);
  }

  /**
   * Step: Wait for extension generation to complete
   */
  async waitForExtensionCompletion(): Promise<void> {
    const config = this.stepConfig['waitForExtensionComplete'];

    // In extend mode, completion is when percentage disappears
    // and the timeline shows the extended duration
    await this.waitFor(
      () => {
        // Check no percentage is showing
        const allText = document.body.innerText || '';
        const hasPercentage = /\d{1,3}%/.test(allText);
        if (hasPercentage) return false;

        // Check that we're still in scenebuilder (not error state)
        return window.location.href.includes('/scenes/');
      },
      'extension generation complete',
      config.timeoutMs
    );
    await this.delay(500);
    console.log('[VideoFlowController] Extension complete');
  }

  /**
   * Step: Download the video
   */
  async downloadVideo(): Promise<void> {
    const config = this.stepConfig['downloadVideo'];

    // Find and click download button
    const downloadBtn = findButtonByText('Download');
    if (!downloadBtn) throw new Error('Download button not found');

    downloadBtn.click();
    console.log('[VideoFlowController] Clicked Download button');

    // Wait for download to complete
    // For extended videos, need to wait for "Video exported!" notification
    await this.waitFor(
      () => {
        // Check for "Video exported!" notification
        const exported = findByText('[role="listitem"]', 'Video exported');
        if (exported) return true;

        // Or check if download button is re-enabled (for short videos)
        const btn = findButtonByText('Download');
        return btn !== null && !btn.hasAttribute('disabled') && 
               !btn.textContent?.includes('progress_activity');
      },
      'video download/export complete',
      config.timeoutMs
    );
    console.log('[VideoFlowController] Download complete');
  }

  // ==================== Execution Engine ====================

  /**
   * Execute a step with retry logic
   */
  private async executeStep(
    stepName: string,
    action: () => Promise<void>,
    promptIndex?: number,
    totalPrompts?: number
  ): Promise<void> {
    const config = this.stepConfig[stepName] || { maxAttempts: 1, retryDelayMs: 1000, timeoutMs: 30000 };
    let attempt = 1;

    while (attempt <= config.maxAttempts) {
      if (this.aborted) throw new Error('Workflow aborted');

      this.reportProgress({
        step: stepName,
        attempt,
        maxAttempts: config.maxAttempts,
        status: 'running',
        promptIndex,
        totalPrompts,
      });

      try {
        await action();
        this.reportProgress({
          step: stepName,
          attempt,
          maxAttempts: config.maxAttempts,
          status: 'success',
          promptIndex,
          totalPrompts,
        });
        return;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[VideoFlowController] Step ${stepName} failed (attempt ${attempt}):`, errorMsg);

        if (attempt < config.maxAttempts) {
          this.reportProgress({
            step: stepName,
            attempt,
            maxAttempts: config.maxAttempts,
            status: 'retrying',
            promptIndex,
            totalPrompts,
            error: errorMsg,
          });
          await this.delay(config.retryDelayMs);
          attempt++;
        } else {
          this.reportProgress({
            step: stepName,
            attempt,
            maxAttempts: config.maxAttempts,
            status: 'failed',
            promptIndex,
            totalPrompts,
            error: errorMsg,
          });
          throw error;
        }
      }
    }
  }

  /**
   * Execute the complete video generation workflow
   */
  async executeSet(config: VideoSetConfig): Promise<VideoFlowResult> {
    let completedPrompts = 0;
    let downloaded = false;

    try {
// Phase 1: Setup
      await this.executeStep('ensureVideoMode', () => this.ensureVideoMode());
      await this.executeStep('configureSettings', () => this.configureSettings(config.aspectRatio, config.outputCount));

      // Phase 2: Upload image if provided
      if (config.image) {
        await this.executeStep('uploadImage', () => this.uploadImage(config.image!, config.aspectRatio));
      }

      // Phase 3: Initial generation
      await this.executeStep('fillPrompt', () => this.fillPrompt(config.prompts[0]), 0, config.prompts.length);
      await this.executeStep('clickCreate', () => this.clickCreate(), 0, config.prompts.length);
      await this.executeStep('waitForInitialComplete', () => this.waitForInitialCompletion(), 0, config.prompts.length);
      completedPrompts = 1;

      // Phase 4: Add to scene (transition to scenebuilder)
      await this.executeStep('clickAddToScene', () => this.clickAddToScene());

      // Phase 5: Extensions (if any)
      for (let i = 1; i < config.prompts.length; i++) {
        if (this.aborted) break;

// enterExtendMode also configures settings (aspect ratio) after entering extend mode
        await this.executeStep('enterExtendMode', () => this.enterExtendMode(config.aspectRatio, config.outputCount), i, config.prompts.length);
        await this.executeStep('fillExtensionPrompt', () => this.fillExtensionPrompt(config.prompts[i]), i, config.prompts.length);
        await this.executeStep('clickCreate', () => this.clickCreate(), i, config.prompts.length);
        await this.executeStep('waitForExtensionComplete', () => this.waitForExtensionCompletion(), i, config.prompts.length);
        completedPrompts = i + 1;
      }

      // Phase 6: Download
      if (config.autoDownload) {
        await this.executeStep('downloadVideo', () => this.downloadVideo());
        downloaded = true;
      }

      return { success: true, completedPrompts, downloaded };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[VideoFlowController] Workflow failed:', errorMsg);
      return { success: false, error: errorMsg, completedPrompts, downloaded };
    }
  }
}

// Global instance (created on demand)
let videoFlowController: VideoFlowController | null = null;

// ==================== Image Flow Controller ====================
// Event-driven controller for image generation workflow (sameModel mode)

interface ImageSetConfig {
  modelImage: string;           // Base64 encoded model image (shared across sets)
  productImages: string[];      // Array of base64 product images (one per set)
  style: string;
  productName: string;
  aspectRatio: '9:16' | '16:9';
  imageCount: number;           // Images per generation (1-4)
  noTextOnImage: boolean;
  imageText: string;
  scene: string;
  autoSaveImage: boolean;
  downloadResolution: '1K' | '2K' | '4K';
}

interface ImageStepRetryConfig {
  maxAttempts: number;
  retryDelayMs: number;
  timeoutMs: number;
}

interface ImageProgressEvent {
  step: string;
  attempt: number;
  maxAttempts: number;
  status: 'running' | 'success' | 'retrying' | 'failed';
  setIndex?: number;
  totalSets?: number;
  error?: string;
}

interface ImageFlowResult {
  success: boolean;
  error?: string;
  completedSets: number;
  totalSets: number;
  imagesPerSet?: number[];  // Number of images created per product set
}

// Recovery state for handling generation failures after page refresh
interface ImageFlowRecoveryState {
  initialUUIDs: string[];           // All UUIDs collected at workflow start
  uuidsBeforeFailedSet: string[];   // UUIDs before the failed set started generating
  failedSetIndex: number;           // Which set failed (0-based)
  totalSets: number;
  expectedImageCount: number;       // How many images were expected for the failed set
  config: ImageSetConfig;           // Full config to potentially continue workflow
  timestamp: number;                // When the failure occurred
}

// Result of checking for images after refresh
interface RecoveryCheckResult {
  foundNewImages: boolean;
  newUUIDs: string[];
  failedSetIndex: number;
  expectedCount: number;
  actualCount: number;
}

// Storage key for recovery state
const IMAGE_FLOW_RECOVERY_KEY = 'imageFlowRecovery';

// Default retry configuration per step
const DEFAULT_IMAGE_STEP_CONFIG: Record<string, ImageStepRetryConfig> = {
  ensureCreateImageMode:  { maxAttempts: 3, retryDelayMs: 500,  timeoutMs: 10000 },
  configureSettings:      { maxAttempts: 2, retryDelayMs: 500,  timeoutMs: 15000 },
  openImagePicker:        { maxAttempts: 3, retryDelayMs: 500,  timeoutMs: 10000 },
  uploadImage:            { maxAttempts: 3, retryDelayMs: 1000, timeoutMs: 30000 },
  handleCrop:             { maxAttempts: 2, retryDelayMs: 500,  timeoutMs: 15000 },
  waitAllImagesUploaded:  { maxAttempts: 1, retryDelayMs: 0,    timeoutMs: 60000 },
  fillPrompt:             { maxAttempts: 2, retryDelayMs: 500,  timeoutMs: 10000 },
  clickCreate:            { maxAttempts: 3, retryDelayMs: 1000, timeoutMs: 15000 },
  waitForGeneration:      { maxAttempts: 1, retryDelayMs: 0,    timeoutMs: 300000 }, // 5 min for image gen
  downloadImages:         { maxAttempts: 3, retryDelayMs: 2000, timeoutMs: 60000 },
  clearPromptBox:         { maxAttempts: 2, retryDelayMs: 500,  timeoutMs: 10000 },
};

// Generate prompt based on style and context
function generateImagePrompt(config: ImageSetConfig): string {
  const productText = config.productName ? `This product is ${config.productName}.` : 'This product is as per the attached image.';
  const sceneText = config.scene ? ` Scene: ${config.scene}.` : '';

  // Text on image handling
  let textInstruction = '';
  if (config.noTextOnImage) {
    textInstruction = 'No text on the image.';
  } else if (config.imageText) {
    textInstruction = `Add this text in Thai on the image: "${config.imageText}"`;
  } else {
    textInstruction = 'Add advertising text in Thai on the image but no TikTok UI overlay.';
  }

  // In sameModel mode: first ingredient = model reference, second ingredient = product
  const modelReferenceText = 'Use the first ingredient as model reference.';

  const stylePrompts: Record<string, string> = {
    'tiktok_real': `Create a professional product advertisement image. ${productText}
${modelReferenceText}
TikTok style.
Ordinary person. Product review image in the style of an ordinary person. Don't hold a camera or taking a selfie.
Normal lighting, no lighting, no staging. Normal camera angle. Natural color tone, no photo editing.
Looks like a real ordinary person reviewing the product. Doesn't look like an advertisement. There is a product presenter from the attached image.${sceneText}
${textInstruction}`,

    'review': `Create a professional product review image. ${productText}
${modelReferenceText}
Person holding the product for review. Natural pose, genuine expression.
Good lighting, clean background. Authentic review style.${sceneText}
${textInstruction}`,

    'hands_only': `Create a product image showing only hands. ${productText}
${modelReferenceText}
Only hands visible, holding or presenting the product. Clean, professional look.
Focus on the product with elegant hand positioning.${sceneText}
${textInstruction}`,

    'professional': `Create a professional product advertisement. ${productText}
${modelReferenceText}
High-end professional photography style. Perfect lighting, studio quality.
Model presenting product elegantly.${sceneText}
${textInstruction}`,

    'dramatic': `Create a dramatic product advertisement. ${productText}
${modelReferenceText}
Bold, powerful imagery. Dramatic lighting and angles.
Impactful visual presentation.${sceneText}
${textInstruction}`,

    'minimalist': `Create a minimalist product image. ${productText}
${modelReferenceText}
Clean, simple composition. Minimal elements, maximum impact.
White or neutral background, focus on product.${sceneText}
${textInstruction}`,

    'luxury': `Create a luxury product advertisement. ${productText}
${modelReferenceText}
Premium, high-end aesthetic. Rich textures, elegant presentation.
Sophisticated and luxurious feel.${sceneText}
${textInstruction}`,

    'dance': `Full body shot of an attractive young woman dancing K-pop style in the front of the door of a modern living room, wearing a tight crop top and denim shorts, showing a fit midriff, confident and seductive smile, fluid body movement, sharp focus, trending on social media, realistic photography. ${productText}
${modelReferenceText}${sceneText}
${textInstruction}`,
  };

  return stylePrompts[config.style] || stylePrompts['tiktok_real'];
}

class ImageFlowController {
  private observer: MutationObserver | null = null;
  private debugObserver: MutationObserver | null = null;
  private pendingResolvers: Array<{
    condition: () => boolean;
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    stepName: string;
  }> = [];
  private aborted: boolean = false;
  private progressCallback: ((event: ImageProgressEvent) => void) | null = null;
  private stepConfig: Record<string, ImageStepRetryConfig>;
  
  // For tracking images across workflow (used for failure recovery)
  private initialUUIDs: Set<string> = new Set();
  private currentConfig: ImageSetConfig | null = null;
  
  // Workflow session timestamp (shared across all sets for consistent folder naming)
  private workflowTimestamp: string | null = null;

  constructor(
    stepConfigOverrides?: Partial<Record<string, Partial<ImageStepRetryConfig>>>,
    onProgress?: (event: ImageProgressEvent) => void
  ) {
    this.stepConfig = { ...DEFAULT_IMAGE_STEP_CONFIG };
    if (stepConfigOverrides) {
      for (const [step, override] of Object.entries(stepConfigOverrides)) {
        if (this.stepConfig[step] && override) {
          this.stepConfig[step] = { ...this.stepConfig[step], ...override };
        }
      }
    }
    this.progressCallback = onProgress || null;
    this.startDebugObserver();
  }

  // ==================== Debug MutationObserver ====================

  private startDebugObserver(): void {
    if (this.debugObserver) return;
    
    this.debugObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        // Log added elements
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) {
            const el = node as HTMLElement;
            const role = el.getAttribute('role');
            const tag = el.tagName;
            const text = el.textContent?.substring(0, 60)?.replace(/\s+/g, ' ');
            // Log dialogs, menus, options, buttons, inputs
            if (role === 'dialog' || role === 'menu' || role === 'listbox' || role === 'option' ||
                tag === 'BUTTON' || tag === 'INPUT' ||
                text?.includes('Crop') || text?.includes('Settings') || text?.includes('Outputs')) {
              console.log(`[DOM+] <${tag} role="${role}"> "${text}"`);
            }
          }
        }
        // Log removed dialogs/menus
        for (const node of m.removedNodes) {
          if (node.nodeType === 1) {
            const el = node as HTMLElement;
            const role = el.getAttribute('role');
            if (role === 'dialog' || role === 'menu' || role === 'listbox') {
              console.log(`[DOM-] <${el.tagName} role="${role}"> removed`);
            }
          }
        }
        // Log attribute changes on dialogs
        if (m.type === 'attributes') {
          const target = m.target as HTMLElement;
          const role = target.getAttribute?.('role');
          if (role === 'dialog' || role === 'combobox') {
            console.log(`[DOM~] ${role}.${m.attributeName} changed`);
          }
        }
      }
    });
    
    this.debugObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'aria-expanded', 'style', 'class']
    });
    console.log('[ImageFlowController] Debug observer started');
  }

  private stopDebugObserver(): void {
    if (this.debugObserver) {
      this.debugObserver.disconnect();
      this.debugObserver = null;
    }
  }

  // ==================== MutationObserver Core ====================

  private ensureObserver(): void {
    if (this.observer) return;

    this.observer = new MutationObserver(() => this.onMutation());
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    console.log('[ImageFlowController] Observer started');
  }

  private onMutation(): void {
    // Check all pending conditions
    for (const resolver of [...this.pendingResolvers]) {
      try {
        if (resolver.condition()) {
          clearTimeout(resolver.timeout);
          this.removeResolver(resolver);
          resolver.resolve();
        }
      } catch (e) {
        // Condition check failed, ignore
      }
    }
  }

  private removeResolver(resolver: typeof this.pendingResolvers[0]): void {
    const idx = this.pendingResolvers.indexOf(resolver);
    if (idx !== -1) {
      this.pendingResolvers.splice(idx, 1);
    }
  }

  waitFor(condition: () => boolean, stepName: string, timeoutMs: number): Promise<void> {
    if (condition()) return Promise.resolve();
    if (this.aborted) return Promise.reject(new Error('Workflow aborted'));

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeResolver(resolver);
        reject(new Error(`Timeout waiting for ${stepName} (${timeoutMs}ms)`));
      }, timeoutMs);

      const resolver = { condition, resolve, reject, timeout, stepName };
      this.pendingResolvers.push(resolver);
      this.ensureObserver();
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for DOM mutations to settle (no mutations for specified duration)
   * This ensures the UI has finished updating before we proceed
   */
  private waitForDomSettle(settleMs: number = 500, maxWaitMs: number = 5000): Promise<void> {
    return new Promise((resolve) => {
      let lastMutationTime = Date.now();
      let checkInterval: ReturnType<typeof setInterval>;
      let maxTimeout: ReturnType<typeof setTimeout>;

      const settlementObserver = new MutationObserver(() => {
        lastMutationTime = Date.now();
        console.log('[ImageFlowController] DOM mutation detected, resetting settle timer');
      });

      settlementObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });

      // Check every 100ms if mutations have settled
      checkInterval = setInterval(() => {
        const timeSinceLastMutation = Date.now() - lastMutationTime;
        if (timeSinceLastMutation >= settleMs) {
          console.log(`[ImageFlowController] DOM settled after ${settleMs}ms of no mutations`);
          cleanup();
          resolve();
        }
      }, 100);

      // Max timeout to prevent infinite waiting
      maxTimeout = setTimeout(() => {
        console.log(`[ImageFlowController] DOM settle max timeout (${maxWaitMs}ms), proceeding anyway`);
        cleanup();
        resolve();
      }, maxWaitMs);

      const cleanup = () => {
        settlementObserver.disconnect();
        clearInterval(checkInterval);
        clearTimeout(maxTimeout);
      };
    });
  }

  private reportProgress(event: ImageProgressEvent): void {
    console.log('[ImageFlowController] Progress:', event);
    if (this.progressCallback) {
      this.progressCallback(event);
    }
    // Also send via chrome.runtime for sidepanel
    chrome.runtime.sendMessage({
      type: 'IMAGE_PROGRESS',
      ...event,
    }).catch(() => {}); // Ignore if popup closed
  }

  destroy(): void {
    this.aborted = true;
    this.stopDebugObserver();
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    for (const resolver of this.pendingResolvers) {
      clearTimeout(resolver.timeout);
      resolver.reject(new Error('Controller destroyed'));
    }
    this.pendingResolvers = [];
    console.log('[ImageFlowController] Destroyed');
  }

  abort(): void {
    this.aborted = true;
    console.log('[ImageFlowController] Aborted');
  }

  // ==================== Image UUID Collection & Recovery ====================

  /**
   * Extract UUID from image src URL
   */
  private extractUUIDFromSrc(src: string): string | null {
    // Pattern: https://storage.googleapis.com/ai-sandbox-videofx/image/{uuid}...
    const uuidMatch = src.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
    if (uuidMatch) {
      return uuidMatch[1];
    }
    return null;
  }

  /**
   * Collect all image UUIDs currently visible on the page by scrolling
   */
  async collectAllImageUUIDs(): Promise<string[]> {
    console.log('[ImageFlowController] Collecting all image UUIDs by scrolling...');
    
    // Find the scrollable container
    const scrollContainer = document.querySelector('[class*="sc-c884da2c"]') || 
                           document.querySelector('[role="main"]') ||
                           document.documentElement;
    
    const container = scrollContainer as HTMLElement;
    const originalScrollTop = container.scrollTop;

    // Scroll to bottom to load all lazy-loaded images
    console.log('[ImageFlowController] Scrolling to bottom...');
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    await this.delay(1500);

    // Scroll back to top
    console.log('[ImageFlowController] Scrolling back to top...');
    container.scrollTo({ top: 0, behavior: 'smooth' });
    await this.delay(500);

    // Wait for DOM to settle
    await this.waitForDomSettle(500, 3000);

    // Collect all image UUIDs
    const uuids: string[] = [];
    const images = document.querySelectorAll('img[alt^="Flow Image:"]');
    
    for (const img of images) {
      const src = (img as HTMLImageElement).src;
      const uuid = this.extractUUIDFromSrc(src);
      if (uuid && !uuids.includes(uuid)) {
        uuids.push(uuid);
      }
    }

    console.log('[ImageFlowController] Collected', uuids.length, 'image UUIDs');

    // Restore original scroll position
    container.scrollTo({ top: originalScrollTop, behavior: 'instant' });
    
    return uuids;
  }

  /**
   * Save recovery state to chrome.storage before refreshing
   */
  async saveRecoveryState(
    failedSetIndex: number,
    totalSets: number,
    expectedImageCount: number,
    uuidsBeforeFailedSet: string[]
  ): Promise<void> {
    const recoveryState: ImageFlowRecoveryState = {
      initialUUIDs: Array.from(this.initialUUIDs),
      uuidsBeforeFailedSet,
      failedSetIndex,
      totalSets,
      expectedImageCount,
      config: this.currentConfig!,
      timestamp: Date.now(),
    };

    await chrome.storage.local.set({ [IMAGE_FLOW_RECOVERY_KEY]: recoveryState });
    console.log('[ImageFlowController] Saved recovery state for set', failedSetIndex + 1);
  }

  /**
   * Check for recovery state and process it (called on page load)
   */
  static async checkAndProcessRecovery(): Promise<RecoveryCheckResult | null> {
    const result = await chrome.storage.local.get(IMAGE_FLOW_RECOVERY_KEY);
    const recoveryState = result[IMAGE_FLOW_RECOVERY_KEY] as ImageFlowRecoveryState | undefined;

    if (!recoveryState) {
      return null;
    }

    // Check if recovery state is too old (more than 5 minutes)
    const ageMs = Date.now() - recoveryState.timestamp;
    if (ageMs > 5 * 60 * 1000) {
      console.log('[ImageFlowController] Recovery state too old, clearing');
      await chrome.storage.local.remove(IMAGE_FLOW_RECOVERY_KEY);
      return null;
    }

    console.log('[ImageFlowController] Found recovery state for set', recoveryState.failedSetIndex + 1);

    // Create temporary controller to collect current UUIDs
    const tempController = new ImageFlowController();
    const currentUUIDs = await tempController.collectAllImageUUIDs();
    tempController.destroy();

    // Find new UUIDs (in current but not in uuidsBeforeFailedSet)
    const beforeSet = new Set(recoveryState.uuidsBeforeFailedSet);
    const newUUIDs = currentUUIDs.filter(uuid => !beforeSet.has(uuid));

    const checkResult: RecoveryCheckResult = {
      foundNewImages: newUUIDs.length > 0,
      newUUIDs,
      failedSetIndex: recoveryState.failedSetIndex,
      expectedCount: recoveryState.expectedImageCount,
      actualCount: newUUIDs.length,
    };

    console.log('[ImageFlowController] Recovery check result:', {
      failedSet: recoveryState.failedSetIndex + 1,
      expected: recoveryState.expectedImageCount,
      found: newUUIDs.length,
      newUUIDs: newUUIDs.map(u => u.substring(0, 8)),
    });

    // Clear recovery state
    await chrome.storage.local.remove(IMAGE_FLOW_RECOVERY_KEY);

    return checkResult;
  }

  /**
   * Clear any existing recovery state
   */
  static async clearRecoveryState(): Promise<void> {
    await chrome.storage.local.remove(IMAGE_FLOW_RECOVERY_KEY);
    console.log('[ImageFlowController] Cleared recovery state');
  }

  // ==================== Step Functions ====================

  /**
   * Step: Ensure we're in "Create Image" mode
   */
  async ensureCreateImageMode(): Promise<void> {
    const config = this.stepConfig['ensureCreateImageMode'];

    // Check if already in Create Image mode
    const modeButton = document.querySelector('[role="combobox"]');
    if (modeButton?.textContent?.includes('Create Image')) {
      console.log('[ImageFlowController] Already in Create Image mode');
      return;
    }

    // Click mode dropdown
    const dropdown = Array.from(document.querySelectorAll('button, [role="combobox"]'))
      .find(el => el.textContent?.includes('arrow_drop_down'));
    if (!dropdown) throw new Error('Mode dropdown not found');
    (dropdown as HTMLElement).click();

    // Wait for listbox
    await this.waitFor(
      () => document.querySelector('[role="listbox"]') !== null,
      'mode listbox',
      config.timeoutMs
    );
    await this.delay(200);

    // Click "Create Image" option
    const option = Array.from(document.querySelectorAll('[role="option"]'))
      .find(el => el.textContent?.includes('Create Image'));
    if (!option) throw new Error('Create Image option not found');
    (option as HTMLElement).click();

    // Wait for mode change
    await this.waitFor(
      () => {
        const current = document.querySelector('[role="combobox"]');
        return current?.textContent?.includes('Create Image') ?? false;
      },
      'mode change to Create Image',
      config.timeoutMs
    );
    await this.delay(300);
  }

  /**
   * Step: Configure settings (aspect ratio + output count)
   */
  async configureSettings(aspectRatio: '9:16' | '16:9', imageCount: number): Promise<void> {
    const config = this.stepConfig['configureSettings'];
    const isPortrait = aspectRatio === '9:16';
    const targetText = isPortrait ? 'Portrait' : 'Landscape';

    // Helper to get fresh dialog reference
    const getDialog = () => document.querySelector('[role="dialog"]');
    
    // Helper to find combobox by label text
    const findCombobox = (labelText: string): HTMLElement | null => {
      const dialog = getDialog();
      if (!dialog) return null;
      const comboboxes = dialog.querySelectorAll('[role="combobox"]');
      for (const cb of comboboxes) {
        if (cb.textContent?.includes(labelText)) {
          return cb as HTMLElement;
        }
      }
      return null;
    };

    // Open settings dialog
    const settingsBtn = findButtonByText('Settings');
    if (!settingsBtn) throw new Error('Settings button not found');
    console.log('[ImageFlowController] Clicking Settings button');
    settingsBtn.click();

    // Wait for dialog
    await this.waitFor(
      () => getDialog() !== null,
      'settings dialog',
      config.timeoutMs
    );
    await this.delay(500);
    console.log('[ImageFlowController] Settings dialog opened');

    // ===== Set Aspect Ratio =====
    const aspectCombobox = findCombobox('Aspect Ratio');
    if (aspectCombobox) {
      // Check if already correct
      if (!aspectCombobox.textContent?.includes(targetText)) {
        console.log('[ImageFlowController] Clicking Aspect Ratio combobox');
        aspectCombobox.click();
        await this.delay(300);
        
        // Wait for options
        await this.waitFor(
          () => document.querySelectorAll('[role="option"]').length > 0,
          'aspect ratio options',
          config.timeoutMs
        );
        
        const targetOption = Array.from(document.querySelectorAll('[role="option"]'))
          .find(el => el.textContent?.includes(targetText));
        if (targetOption) {
          console.log('[ImageFlowController] Selecting aspect ratio:', targetText);
          (targetOption as HTMLElement).click();
          await this.delay(300);
          
          // Wait for dropdown to close
          await this.waitFor(
            () => document.querySelectorAll('[role="option"]').length === 0,
            'aspect ratio dropdown close',
            5000
          );
          await this.delay(200);
        }
      } else {
        console.log('[ImageFlowController] Aspect ratio already set to:', targetText);
      }
    }

    // ===== Set Output Count =====
    const outputCombobox = findCombobox('Outputs per prompt');
    if (outputCombobox) {
      // Check if already correct
      const currentCount = outputCombobox.textContent?.match(/\d+/)?.[0];
      if (currentCount !== String(imageCount)) {
        console.log('[ImageFlowController] Clicking Outputs per prompt combobox, current:', currentCount);
        outputCombobox.click();
        await this.delay(300);
        
        // Wait for options
        await this.waitFor(
          () => document.querySelectorAll('[role="option"]').length > 0,
          'output count options',
          config.timeoutMs
        );
        
        const allOptions = document.querySelectorAll('[role="option"]');
        console.log('[ImageFlowController] Found options:', allOptions.length);
        
        const countOption = Array.from(allOptions)
          .find(el => el.textContent?.trim() === String(imageCount));
        if (countOption) {
          console.log('[ImageFlowController] Selecting output count:', imageCount);
          (countOption as HTMLElement).click();
          await this.delay(300);
          
          // Wait for dropdown to close
          await this.waitFor(
            () => document.querySelectorAll('[role="option"]').length === 0,
            'output count dropdown close',
            5000
          );
          await this.delay(200);
        } else {
          console.log('[ImageFlowController] Option not found for count:', imageCount);
        }
      } else {
        console.log('[ImageFlowController] Output count already set to:', imageCount);
      }
    } else {
      console.log('[ImageFlowController] Outputs per prompt combobox not found');
    }

    // Close dialog by clicking outside or pressing Escape
    console.log('[ImageFlowController] Closing settings dialog');
    const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(escEvent);
    
    await this.waitFor(
      () => document.querySelector('[role="dialog"]') === null,
      'settings dialog close',
      config.timeoutMs
    );
    await this.delay(200);
  }

  // Store the click interceptor so we can remove it after upload
  private fileInputClickInterceptor: ((e: Event) => void) | null = null;

  /**
   * Step: Open image picker (click add button)
   * IMPORTANT: We intercept file input clicks BEFORE clicking add button to prevent
   * the native file picker from opening. This prevents duplicate ingredient uploads.
   */
  async openImagePicker(): Promise<void> {
    const config = this.stepConfig['openImagePicker'];

    // Set up a global click interceptor for file inputs BEFORE clicking add button
    // This prevents the native file picker from opening when the add button creates the input
    this.fileInputClickInterceptor = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'file') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        console.log('[ImageFlowController] Intercepted file input click at document level, preventing native picker');
      }
    };
    document.addEventListener('click', this.fileInputClickInterceptor, true);
    console.log('[ImageFlowController] Set up file input click interceptor');

    // Find the add button in prompt area
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

    // Fallback: search all buttons
    if (!addButton) {
      const allButtons = document.querySelectorAll('button');
      for (const btn of allButtons) {
        if (btn.textContent?.trim() === 'add') {
          addButton = btn as HTMLElement;
          break;
        }
      }
    }

    if (!addButton) {
      // Clean up interceptor if we fail
      if (this.fileInputClickInterceptor) {
        document.removeEventListener('click', this.fileInputClickInterceptor, true);
        this.fileInputClickInterceptor = null;
      }
      throw new Error('Add button not found');
    }

    console.log('[ImageFlowController] Found add button, clicking...');
    addButton.click();
    
    // Wait for DOM to settle after clicking add button
    // This ensures any UI updates (menus, dialogs, etc.) have finished
    console.log('[ImageFlowController] Add button clicked, waiting for DOM to settle...');
    await this.waitForDomSettle(500, 3000);
    console.log('[ImageFlowController] DOM settled after add button click');
  }

  /**
   * Step: Upload a single image
   * Waits for file input to appear, then uploads programmatically.
   * The document-level click interceptor was already set up in openImagePicker().
   */
  async uploadImage(base64Image: string): Promise<void> {
    const config = this.stepConfig['uploadImage'];

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

    // Wait for file input to appear (it appears after clicking add button)
    await this.waitFor(
      () => document.querySelector('input[type="file"]') !== null,
      'file input',
      config.timeoutMs
    );

    // Find the file input
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (!fileInput) {
      throw new Error('File input not found after wait');
    }

    console.log('[ImageFlowController] File input found, uploading file programmatically...');
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    console.log('[ImageFlowController] Image uploaded, waiting for crop dialog...');

    // Wait for crop dialog to appear
    await this.waitFor(
      () => {
        const dialog = document.querySelector('[role="dialog"]');
        const hasCropHeading = dialog?.textContent?.includes('Crop your ingredient');
        const hasCropButton = findButtonByText('Crop and Save') !== null;
        return hasCropHeading || hasCropButton;
      },
      'crop dialog',
      config.timeoutMs
    );

    console.log('[ImageFlowController] Crop dialog appeared');
  }

  /**
   * Step: Handle crop dialog (select aspect ratio and confirm)
   */
  async handleCrop(aspectRatio: '9:16' | '16:9'): Promise<void> {
    const config = this.stepConfig['handleCrop'];
    const isPortrait = aspectRatio === '9:16';
    const targetText = isPortrait ? 'Portrait' : 'Landscape';

    // Count current ingredient buttons before crop
    const countIngredients = () => {
      let count = 0;
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent?.includes('This is your ingredient')) {
          count++;
        }
      }
      return count;
    };
    const ingredientsBefore = countIngredients();
    console.log('[ImageFlowController] Ingredients before crop:', ingredientsBefore);

    // Find crop dialog
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) {
      console.log('[ImageFlowController] No dialog found, skipping crop');
      return;
    }
    console.log('[ImageFlowController] Found crop dialog');

    // Find aspect ratio dropdown in crop dialog (contains Portrait/Landscape text)
    const comboboxes = dialog.querySelectorAll('[role="combobox"]');
    for (const el of comboboxes) {
      const text = el.textContent || '';
      console.log('[ImageFlowController] Checking combobox:', text);
      if (text.includes('Landscape') || text.includes('Portrait')) {
        if (!text.includes(targetText)) {
          console.log('[ImageFlowController] Need to change aspect ratio to:', targetText);
          (el as HTMLElement).click();
          await this.delay(300);
          const options = document.querySelectorAll('[role="option"]');
          for (const option of options) {
            if (option.textContent?.includes(targetText)) {
              (option as HTMLElement).click();
              await this.delay(300);
              break;
            }
          }
        } else {
          console.log('[ImageFlowController] Aspect ratio already correct:', targetText);
        }
        break;
      }
    }

    // Wait for image to be fully loaded in crop dialog (look for img element)
    await this.delay(500);
    const img = dialog.querySelector('img');
    if (img && !img.complete) {
      console.log('[ImageFlowController] Waiting for crop image to load...');
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        setTimeout(() => resolve(), 3000); // Max 3s wait
      });
    }
    await this.delay(300);

    // Click "Crop and Save" button inside dialog
    const buttons = dialog.querySelectorAll('button');
    let cropBtn: HTMLElement | null = null;
    for (const btn of buttons) {
      if (btn.textContent?.includes('Crop and Save')) {
        cropBtn = btn as HTMLElement;
        break;
      }
    }
    
    if (!cropBtn) {
      console.log('[ImageFlowController] Crop and Save button not found in dialog');
      throw new Error('Crop and Save button not found');
    }
    
    // Ensure button is not disabled
    if (cropBtn.hasAttribute('disabled')) {
      console.log('[ImageFlowController] Crop and Save button is disabled, waiting...');
      await this.waitFor(
        () => !cropBtn!.hasAttribute('disabled'),
        'crop button enabled',
        5000
      );
    }
    
    cropBtn.click();
    console.log('[ImageFlowController] Clicked Crop and Save');

    // First wait for dialog to close
    await this.waitFor(
      () => {
        const dialogGone = document.querySelector('[role="dialog"]')?.textContent?.includes('Crop your ingredient') !== true;
        console.log('[ImageFlowController] Waiting for dialog to close: dialogGone=', dialogGone);
        return dialogGone;
      },
      'crop dialog close',
      config.timeoutMs
    );
    console.log('[ImageFlowController] Crop dialog closed');

    // Wait for DOM to settle after crop dialog closes
    // This is crucial - the ingredient takes time to appear after dialog closes
    console.log('[ImageFlowController] Waiting for DOM to settle after crop...');
    await this.waitForDomSettle(800, 5000);
    console.log('[ImageFlowController] DOM settled after crop');

    // Now wait for the new ingredient to actually appear
    const expectedIngredients = ingredientsBefore + 1;
    await this.waitFor(
      () => {
        const ingredientsNow = countIngredients();
        console.log('[ImageFlowController] Waiting for ingredient: current=', ingredientsNow, 'expected=', expectedIngredients);
        return ingredientsNow >= expectedIngredients;
      },
      'new ingredient to appear',
      config.timeoutMs
    );
    console.log('[ImageFlowController] New ingredient appeared, total:', countIngredients());

    // Clean up the document-level click interceptor that was set in openImagePicker()
    if (this.fileInputClickInterceptor) {
      document.removeEventListener('click', this.fileInputClickInterceptor, true);
      this.fileInputClickInterceptor = null;
      console.log('[ImageFlowController] Cleaned up document-level file input click interceptor');
    }

    await this.delay(300);
  }

  /**
   * Step: Wait for all images to be uploaded (no spinners, correct count)
   */
  async waitAllImagesUploaded(expectedCount: number): Promise<void> {
    const config = this.stepConfig['waitAllImagesUploaded'];

    await this.waitFor(
      () => {
        // Check for spinner in prompt box
        const promptArea = document.querySelector('[role="presentation"]');
        if (promptArea) {
          const spinnerElements = promptArea.querySelectorAll('span, div');
          for (const el of spinnerElements) {
            if (el.textContent === 'progress_activity') {
              return false; // Still loading
            }
          }
        }

        // Count ingredient buttons
        let imageCount = 0;
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent?.includes('This is your ingredient')) {
            imageCount++;
          }
        }

        return imageCount >= expectedCount;
      },
      `all ${expectedCount} images uploaded`,
      config.timeoutMs
    );
  }

  /**
   * Step: Fill the prompt textbox
   */
  async fillPrompt(prompt: string): Promise<void> {
    const config = this.stepConfig['fillPrompt'];

    const textbox = document.querySelector('textarea, input[type="text"]') as HTMLInputElement | HTMLTextAreaElement;
    if (!textbox) throw new Error('Prompt textbox not found');

    textbox.focus();
    textbox.value = prompt;
    textbox.dispatchEvent(new Event('input', { bubbles: true }));
    textbox.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait for Create button to be enabled
    await this.waitFor(
      () => {
        const createBtn = findButtonByText('Create');
        return createBtn !== null && !createBtn.hasAttribute('disabled');
      },
      'Create button enabled',
      config.timeoutMs
    );
    await this.delay(200);
  }

  /**
   * Step: Click Create button
   */
  async clickCreate(): Promise<void> {
    const config = this.stepConfig['clickCreate'];

    // Start image tracker before clicking Create
    flowImageTracker.start();
    const snapshotBefore = flowImageTracker.getSnapshot();
    console.log('[ImageFlowController] Snapshot before generation:', snapshotBefore.length, 'images');

    const createBtn = Array.from(document.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes('Create') && btn.textContent?.includes('arrow_forward') && !btn.hasAttribute('disabled'));
    
    if (!createBtn) throw new Error('Create button not found or disabled');
    (createBtn as HTMLElement).click();

    // Wait for generation to start (percentage appears)
    await this.waitFor(
      () => {
        const allText = document.body.innerText || '';
        return /\d{1,3}%/.test(allText);
      },
      'generation started (percentage)',
      config.timeoutMs
    );
    console.log('[ImageFlowController] Generation started');
  }

  /**
   * Step: Wait for image generation to complete
   */
  async waitForGeneration(expectedCount: number): Promise<string[]> {
    const config = this.stepConfig['waitForGeneration'];

    console.log('[ImageFlowController] Waiting for', expectedCount, 'images to generate...');

    // Use FlowImageTracker to wait for new images
    const newUUIDs = await flowImageTracker.waitForNewImages(expectedCount, config.timeoutMs);

    console.log('[ImageFlowController] Generation complete, new UUIDs:', newUUIDs);
    return newUUIDs;
  }

  /**
   * Step: Download images by UUID via extension background script
   * Fetches images in content script (to avoid CORS), converts to data URL, 
   * then sends to background script for download
   */
  async downloadImages(uuids: string[], resolution: '1K' | '2K' | '4K'): Promise<number> {
    console.log('[ImageFlowController] Downloading', uuids.length, 'images at', resolution, 'resolution');
    console.log('[ImageFlowController] UUIDs to download:', uuids);

    // Collect image URLs from the DOM
    const imagesToDownload: Array<{ dataUrl: string; filename: string }> = [];
    // Use workflow timestamp for consistent folder naming across all sets
    const timestamp = this.workflowTimestamp || new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

    for (let i = 0; i < uuids.length; i++) {
      const uuid = uuids[i];
      if (this.aborted) break;

      // Find the image element to get its src URL
      // Try multiple selectors since UUID format may vary
      let img = document.querySelector(`img[src*="${uuid}"]`) as HTMLImageElement;
      
      // Also try with just the first 8 chars of UUID
      if (!img && uuid.length > 8) {
        img = document.querySelector(`img[src*="${uuid.substring(0, 8)}"]`) as HTMLImageElement;
      }
      
      if (!img) {
        console.log(`[ImageFlowController] Image not found for UUID: ${uuid}`);
        continue;
      }

      console.log(`[ImageFlowController] Found image for UUID ${uuid.substring(0, 8)}:`, img.src.substring(0, 80));

      // Get the image URL
      let imageUrl = img.src;
      
      // Try to get higher resolution version
      if (resolution === '4K') {
        imageUrl = this.getHighResUrl(imageUrl, 3840);
      } else if (resolution === '2K') {
        imageUrl = this.getHighResUrl(imageUrl, 2048);
      } else {
        imageUrl = this.getHighResUrl(imageUrl, 1024);
      }

      // Fetch the image in content script (has page context, avoids CORS)
      try {
        console.log(`[ImageFlowController] Fetching image: ${imageUrl.substring(0, 80)}...`);
        const response = await fetch(imageUrl);
        if (!response.ok) {
          console.error(`[ImageFlowController] Failed to fetch image: ${response.status}`);
          continue;
        }
        
        const blob = await response.blob();
        const dataUrl = await this.blobToDataUrl(blob);
        
        const filename = `flow_${timestamp}_${i + 1}_${uuid.substring(0, 8)}.png`;
        imagesToDownload.push({ dataUrl, filename });
        console.log(`[ImageFlowController] Image fetched successfully: ${filename}`);
      } catch (fetchError) {
        console.error(`[ImageFlowController] Error fetching image:`, fetchError);
      }
    }

    if (imagesToDownload.length === 0) {
      console.log('[ImageFlowController] No images to download, falling back to UI method');
      return this.downloadImagesViaUI(uuids, resolution);
    }

    // Create subfolder name based on timestamp
    const subfolder = `ShopEnginX/flow_${timestamp}`;

    // Send data URLs to background script for download
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'downloadImagesFromDataUrls',
        images: imagesToDownload,
        subfolder,
      });

      if (response && response.success) {
        console.log('[ImageFlowController] Download complete:', response.successCount, '/', response.totalCount);
        return response.successCount;
      } else {
        console.error('[ImageFlowController] Download failed:', response?.error);
        // Fallback to UI method
        return this.downloadImagesViaUI(uuids, resolution);
      }
    } catch (error) {
      console.error('[ImageFlowController] Failed to send download request:', error);
      
      // Fallback to old UI-based download method
      console.log('[ImageFlowController] Falling back to UI-based download...');
      return this.downloadImagesViaUI(uuids, resolution);
    }
  }

  /**
   * Convert blob to data URL
   */
  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Get high-resolution URL for Google Flow image
   */
  private getHighResUrl(originalUrl: string, targetWidth: number): string {
    // Don't modify signed Google Cloud Storage URLs - they have authentication
    // signatures that break when the URL is modified in any way
    if (originalUrl.includes('GoogleAccessId') || originalUrl.includes('Signature=') || originalUrl.includes('storage.googleapis.com')) {
      console.log('[ImageFlowController] Using original signed URL (no modifications)');
      return originalUrl;
    }
    
    // Google Flow images often have size parameters like =w400 or =s400
    // Try to replace with larger size
    let url = originalUrl;
    
    // Pattern 1: =wXXX or =sXXX at end
    if (/=[ws]\d+$/.test(url)) {
      url = url.replace(/=[ws]\d+$/, `=w${targetWidth}`);
    }
    // Pattern 2: =wXXX-hYYY
    else if (/=[ws]\d+-h\d+/.test(url)) {
      url = url.replace(/=[ws]\d+-h\d+/, `=w${targetWidth}`);
    }
    // Pattern 3: No size parameter, try adding one
    else if (!url.includes('=w') && !url.includes('=s')) {
      url = url + `=w${targetWidth}`;
    }
    
    return url;
  }

  /**
   * Fallback: Download images via UI buttons (old method)
   */
  private async downloadImagesViaUI(uuids: string[], resolution: '1K' | '2K' | '4K'): Promise<number> {
    let downloadedCount = 0;

    for (const uuid of uuids) {
      if (this.aborted) break;

      const img = document.querySelector(`img[src*="${uuid}"]`) as HTMLImageElement;
      if (!img) continue;

      const container = img.parentElement?.parentElement;
      if (!container) continue;

      const downloadBtn = Array.from(container.querySelectorAll('button'))
        .find(btn => btn.textContent?.includes('Download')) as HTMLButtonElement;
      
      if (!downloadBtn) continue;

      downloadBtn.click();
      await this.delay(300);

      // Check for resolution menu
      const menuItem = document.querySelector('div[role="menuitem"]');
      if (menuItem) {
        const targetOption = Array.from(document.querySelectorAll('div[role="menuitem"]'))
          .find(el => el.textContent?.includes(`Download ${resolution}`));
        if (targetOption) {
          (targetOption as HTMLElement).click();
        } else {
          (menuItem as HTMLElement).click();
        }
      }

      downloadedCount++;
      await this.delay(1000);
    }

    return downloadedCount;
  }

  /**
   * Step: Clear images from prompt box (for next set)
   */
  async clearPromptBox(): Promise<void> {
    const config = this.stepConfig['clearPromptBox'];

    // Find all ingredient buttons and remove them
    const ingredientButtons = Array.from(document.querySelectorAll('button'))
      .filter(btn => btn.textContent?.includes('This is your ingredient'));

    for (const btn of ingredientButtons) {
      const parent = btn.parentElement;
      if (parent) {
        const closeBtn = parent.querySelector('button[aria-label*="close"], button[aria-label*="remove"]') as HTMLButtonElement;
        if (closeBtn) {
          closeBtn.click();
          await this.delay(300);
        } else {
          // Try finding close icon
          const closeBtns = Array.from(parent.querySelectorAll('button'))
            .filter(b => b !== btn && (b.textContent?.includes('close') || b.textContent?.includes('cancel')));
          if (closeBtns.length > 0) {
            (closeBtns[0] as HTMLElement).click();
            await this.delay(300);
          }
        }
      }
    }

    // Clear prompt text
    const textbox = document.querySelector('textarea, input[type="text"]') as HTMLInputElement | HTMLTextAreaElement;
    if (textbox) {
      textbox.value = '';
      textbox.dispatchEvent(new Event('input', { bubbles: true }));
    }

    await this.delay(500);
  }

  // ==================== Execution Engine ====================

  private async executeStep(
    stepName: string,
    action: () => Promise<void>,
    setIndex?: number,
    totalSets?: number
  ): Promise<void> {
    const config = this.stepConfig[stepName] || { maxAttempts: 1, retryDelayMs: 1000, timeoutMs: 30000 };
    let attempt = 1;

    while (attempt <= config.maxAttempts) {
      if (this.aborted) throw new Error('Workflow aborted');

      this.reportProgress({
        step: stepName,
        attempt,
        maxAttempts: config.maxAttempts,
        status: 'running',
        setIndex,
        totalSets,
      });

      try {
        await action();
        this.reportProgress({
          step: stepName,
          attempt,
          maxAttempts: config.maxAttempts,
          status: 'success',
          setIndex,
          totalSets,
        });
        return;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[ImageFlowController] Step ${stepName} failed (attempt ${attempt}):`, errorMsg);

        if (attempt < config.maxAttempts) {
          this.reportProgress({
            step: stepName,
            attempt,
            maxAttempts: config.maxAttempts,
            status: 'retrying',
            setIndex,
            totalSets,
            error: errorMsg,
          });
          await this.delay(config.retryDelayMs);
          attempt++;
        } else {
          this.reportProgress({
            step: stepName,
            attempt,
            maxAttempts: config.maxAttempts,
            status: 'failed',
            setIndex,
            totalSets,
            error: errorMsg,
          });
          throw error;
        }
      }
    }
  }

  /**
   * Execute a single set (model + product -> generate -> download)
   * Returns number of images created (0 if failed)
   */
  private async executeSingleSet(
    modelImage: string,
    productImage: string,
    config: ImageSetConfig,
    setIndex: number,
    totalSets: number
  ): Promise<number> {
    // Capture current UUIDs before this set starts (for recovery tracking)
    const uuidsBeforeSet = await this.collectAllImageUUIDs();

    try {
      // Upload model image
      await this.executeStep('openImagePicker', () => this.openImagePicker(), setIndex, totalSets);
      await this.executeStep('uploadImage', () => this.uploadImage(modelImage), setIndex, totalSets);
      await this.executeStep('handleCrop', () => this.handleCrop(config.aspectRatio), setIndex, totalSets);

      // Upload product image
      await this.executeStep('openImagePicker', () => this.openImagePicker(), setIndex, totalSets);
      await this.executeStep('uploadImage', () => this.uploadImage(productImage), setIndex, totalSets);
      await this.executeStep('handleCrop', () => this.handleCrop(config.aspectRatio), setIndex, totalSets);

      // Wait for both images to be in prompt box
      await this.executeStep('waitAllImagesUploaded', () => this.waitAllImagesUploaded(2), setIndex, totalSets);

      // Fill prompt
      const prompt = generateImagePrompt(config);
      await this.executeStep('fillPrompt', () => this.fillPrompt(prompt), setIndex, totalSets);

      // Click Create and wait for generation
      await this.executeStep('clickCreate', () => this.clickCreate(), setIndex, totalSets);
      
      let newUUIDs: string[] = [];
      let generationFailed = false;
      
      try {
        await this.executeStep('waitForGeneration', async () => {
          newUUIDs = await this.waitForGeneration(config.imageCount);
        }, setIndex, totalSets);
      } catch (genError) {
        const errorMsg = genError instanceof Error ? genError.message : String(genError);
        
        // Check if this is a generation failure (not a timeout or other error)
        if (errorMsg.includes('Generation failed') || errorMsg.includes("Couldn't generate")) {
          console.log('[ImageFlowController] Generation failed for set', setIndex + 1);
          generationFailed = true;
        } else {
          // Re-throw non-generation errors
          throw genError;
        }
      }

      // If generation failed, save state and refresh to check if images were actually created
      if (generationFailed) {
        console.log('[ImageFlowController] Saving recovery state and refreshing page...');
        
        // Save recovery state
        await this.saveRecoveryState(
          setIndex,
          totalSets,
          config.imageCount,
          uuidsBeforeSet
        );

        // Report progress that we're refreshing
        this.reportProgress({
          step: 'recoveryRefresh',
          attempt: 1,
          maxAttempts: 1,
          status: 'running',
          setIndex,
          totalSets,
          error: 'Generation failed, refreshing to check for images...',
        });

        // Throw special error to signal recovery mode - this will be caught by the caller
        // and properly respond before the page refreshes
        throw new Error('RECOVERY_REFRESH_PENDING');
      }

      // Update initialUUIDs with newly generated images
      newUUIDs.forEach(uuid => this.initialUUIDs.add(uuid));

      // Download if enabled
      if (config.autoSaveImage && newUUIDs.length > 0) {
        await this.executeStep('downloadImages', async () => {
          await this.downloadImages(newUUIDs, config.downloadResolution);
        }, setIndex, totalSets);
      }

      return newUUIDs.length;
    } catch (error) {
      console.error(`[ImageFlowController] Set ${setIndex + 1} failed:`, error);
      // Re-throw recovery error so it propagates up
      if (error instanceof Error && error.message === 'RECOVERY_REFRESH_PENDING') {
        throw error;
      }
      return 0;
    }
  }

  /**
   * Execute the complete workflow for multiple sets (sameModel mode)
   */
  async executeMultiSet(config: ImageSetConfig): Promise<ImageFlowResult> {
    const totalSets = config.productImages.length;
    let completedSets = 0;
    const imagesPerSet: number[] = [];

    try {
      // Store config for recovery
      this.currentConfig = config;
      
      // Set workflow timestamp once for consistent folder naming across all sets
      this.workflowTimestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      console.log('[ImageFlowController] Workflow timestamp:', this.workflowTimestamp);

      // Collect initial UUIDs by scrolling (baseline for failure recovery)
      console.log('[ImageFlowController] Collecting initial image UUIDs...');
      const initialUUIDsList = await this.collectAllImageUUIDs();
      this.initialUUIDs = new Set(initialUUIDsList);
      console.log('[ImageFlowController] Initial UUIDs collected:', this.initialUUIDs.size);

      // Initial setup (once)
      await this.executeStep('ensureCreateImageMode', () => this.ensureCreateImageMode(), 0, totalSets);
      await this.executeStep('configureSettings', () => this.configureSettings(config.aspectRatio, config.imageCount), 0, totalSets);

      // Loop through each product (วนสร้างทีละชุด)
      for (let i = 0; i < totalSets; i++) {
        if (this.aborted) break;

        console.log(`[ImageFlowController] Starting set ${i + 1}/${totalSets}`);

        const imagesCreated = await this.executeSingleSet(
          config.modelImage,
          config.productImages[i],
          config,
          i,
          totalSets
        );

        imagesPerSet.push(imagesCreated);
        
        if (imagesCreated > 0) {
          completedSets++;
        } else {
          // Set failed normally (not recovery) - continue to next set
          console.log(`[ImageFlowController] Set ${i + 1} failed (0 images)`);
        }

        // Clear prompt box for next set (except last)
        if (i < totalSets - 1 && imagesCreated > 0) {
          await this.executeStep('clearPromptBox', () => this.clearPromptBox(), i, totalSets);
        }
      }

      // Stop tracker
      flowImageTracker.stop();

      const success = completedSets === totalSets;
      const totalImages = imagesPerSet.reduce((sum, n) => sum + n, 0);
      return {
        success,
        completedSets,
        totalSets,
        imagesPerSet,
        error: success ? undefined : `สร้างได้ ${totalImages} รูป (${imagesPerSet.map((n, i) => `ชุด${i+1}:${n}`).join(', ')})`,
      };
    } catch (error) {
      flowImageTracker.stop();
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // Check if this is a recovery refresh signal
      if (errorMsg === 'RECOVERY_REFRESH_PENDING') {
        console.log('[ImageFlowController] Recovery refresh pending, returning special result');
        const totalImages = imagesPerSet.reduce((sum, n) => sum + n, 0);
        return {
          success: false,
          error: 'RECOVERY_REFRESH_PENDING',
          completedSets,
          totalSets,
          imagesPerSet,
        };
      }
      
      console.error('[ImageFlowController] Workflow failed:', errorMsg);
      const totalImages = imagesPerSet.reduce((sum, n) => sum + n, 0);
      return {
        success: false,
        error: totalImages > 0 
          ? `${errorMsg} - สร้างได้ ${totalImages} รูป (${imagesPerSet.map((n, i) => `ชุด${i+1}:${n}`).join(', ')})`
          : errorMsg,
        completedSets,
        totalSets,
        imagesPerSet,
      };
    }
  }
}

// Global instance
let imageFlowController: ImageFlowController | null = null;

const overlay = new WorkflowOverlay();

// Listen for messages from extension
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[ShopEnginX] Received message:', message.type);
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
          const resolution: string = message.resolution || '1K';
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

    // ==================== Video Flow Handlers ====================

    case 'START_VIDEO_WORKFLOW':
      (async () => {
        try {
const videoConfig: VideoSetConfig = {
            image: message.image,
            prompts: message.prompts || [],
            aspectRatio: message.aspectRatio || '9:16',
            outputCount: message.videoCount || 1,
            autoDownload: message.autoDownload ?? true,
          };

          console.log('[START_VIDEO_WORKFLOW] Starting with config:', {
            hasImage: !!videoConfig.image,
            promptCount: videoConfig.prompts.length,
            aspectRatio: videoConfig.aspectRatio,
            outputCount: videoConfig.outputCount,
            autoDownload: videoConfig.autoDownload,
          });

          if (videoConfig.prompts.length === 0) {
            sendResponse({ success: false, error: 'No prompts provided' });
            return;
          }

          // Cleanup existing controller if any
          if (videoFlowController) {
            videoFlowController.destroy();
          }

          // Create new controller with progress reporting
          videoFlowController = new VideoFlowController(
            message.stepConfig,
            (event: VideoProgressEvent) => {
              // Send progress to extension
              chrome.runtime.sendMessage({
                type: 'VIDEO_PROGRESS',
                ...event,
              }).catch(() => {}); // Ignore if popup closed
            }
          );

          // Execute the workflow
          const result = await videoFlowController.executeSet(videoConfig);

          console.log('[START_VIDEO_WORKFLOW] Workflow complete:', result);
          sendResponse(result);

          // Cleanup
          videoFlowController.destroy();
          videoFlowController = null;
        } catch (e) {
          console.log('[START_VIDEO_WORKFLOW] Error:', e);
          sendResponse({ success: false, error: String(e) });
          if (videoFlowController) {
            videoFlowController.destroy();
            videoFlowController = null;
          }
        }
      })();
      return true; // Keep message channel open for async response

    case 'STOP_VIDEO_WORKFLOW':
      try {
        if (videoFlowController) {
          videoFlowController.abort();
          videoFlowController.destroy();
          videoFlowController = null;
          console.log('[STOP_VIDEO_WORKFLOW] Workflow stopped');
          sendResponse({ success: true, stopped: true });
        } else {
          console.log('[STOP_VIDEO_WORKFLOW] No active workflow to stop');
          sendResponse({ success: true, stopped: false });
        }
      } catch (e) {
        console.log('[STOP_VIDEO_WORKFLOW] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'GET_VIDEO_WORKFLOW_STATUS':
      try {
        const isRunning = videoFlowController !== null;
        console.log('[GET_VIDEO_WORKFLOW_STATUS] Running:', isRunning);
        sendResponse({ success: true, isRunning });
      } catch (e) {
        console.log('[GET_VIDEO_WORKFLOW_STATUS] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    // ==================== Image Flow Handlers (Event-Driven) ====================

    case 'START_IMAGE_WORKFLOW':
      (async () => {
        try {
          const imageConfig: ImageSetConfig = {
            modelImage: message.modelImage || '',
            productImages: message.productImages || [],
            style: message.style || 'tiktok_real',
            productName: message.productName || '',
            aspectRatio: message.aspectRatio || '9:16',
            imageCount: message.imageCount || 4,
            noTextOnImage: message.noTextOnImage ?? false,
            imageText: message.imageText || '',
            scene: message.scene || '',
            autoSaveImage: message.autoSaveImage ?? true,
            downloadResolution: message.downloadResolution || '1K',
          };

          console.log('[START_IMAGE_WORKFLOW] Starting with config:', {
            hasModelImage: !!imageConfig.modelImage,
            productCount: imageConfig.productImages.length,
            style: imageConfig.style,
            aspectRatio: imageConfig.aspectRatio,
            imageCount: imageConfig.imageCount,
            autoSaveImage: imageConfig.autoSaveImage,
          });

          if (!imageConfig.modelImage) {
            sendResponse({ success: false, error: 'No model image provided' });
            return;
          }

          if (imageConfig.productImages.length === 0) {
            sendResponse({ success: false, error: 'No product images provided' });
            return;
          }

          // Cleanup existing controller if any
          if (imageFlowController) {
            imageFlowController.destroy();
          }

          // Create new controller with progress reporting
          imageFlowController = new ImageFlowController(
            message.stepConfig,
            (event: ImageProgressEvent) => {
              // Progress is already sent via chrome.runtime.sendMessage in reportProgress
              console.log('[START_IMAGE_WORKFLOW] Progress event:', event);
            }
          );

          // Execute the workflow
          const result = await imageFlowController.executeMultiSet(imageConfig);

          console.log('[START_IMAGE_WORKFLOW] Workflow complete:', result);
          sendResponse(result);

          // Check if we need to reload for recovery
          if (result.error === 'RECOVERY_REFRESH_PENDING') {
            console.log('[START_IMAGE_WORKFLOW] Triggering recovery refresh...');
            // Small delay to ensure sendResponse is processed
            setTimeout(() => {
              location.reload();
            }, 100);
            return;
          }

          // Cleanup
          imageFlowController.destroy();
          imageFlowController = null;
        } catch (e) {
          console.log('[START_IMAGE_WORKFLOW] Error:', e);
          sendResponse({ success: false, error: String(e) });
          if (imageFlowController) {
            imageFlowController.destroy();
            imageFlowController = null;
          }
        }
      })();
      return true; // Keep message channel open for async response

    case 'STOP_IMAGE_WORKFLOW':
      try {
        if (imageFlowController) {
          imageFlowController.abort();
          imageFlowController.destroy();
          imageFlowController = null;
          console.log('[STOP_IMAGE_WORKFLOW] Workflow stopped');
          sendResponse({ success: true, stopped: true });
        } else {
          console.log('[STOP_IMAGE_WORKFLOW] No active workflow to stop');
          sendResponse({ success: true, stopped: false });
        }
      } catch (e) {
        console.log('[STOP_IMAGE_WORKFLOW] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'CHECK_IMAGE_FLOW_RECOVERY':
      // Check if there's a recovery state from a previous generation failure
      (async () => {
        try {
          console.log('[CHECK_IMAGE_FLOW_RECOVERY] Checking for recovery state...');
          const recoveryResult = await ImageFlowController.checkAndProcessRecovery();
          
          if (recoveryResult) {
            console.log('[CHECK_IMAGE_FLOW_RECOVERY] Recovery result:', recoveryResult);
            sendResponse({
              success: true,
              hasRecovery: true,
              ...recoveryResult,
            });
          } else {
            console.log('[CHECK_IMAGE_FLOW_RECOVERY] No recovery state found');
            sendResponse({ success: true, hasRecovery: false });
          }
        } catch (e) {
          console.log('[CHECK_IMAGE_FLOW_RECOVERY] Error:', e);
          sendResponse({ success: false, error: String(e) });
        }
      })();
      return true; // Keep message channel open for async response

    case 'CLEAR_IMAGE_FLOW_RECOVERY':
      // Clear any existing recovery state
      (async () => {
        try {
          await ImageFlowController.clearRecoveryState();
          console.log('[CLEAR_IMAGE_FLOW_RECOVERY] Recovery state cleared');
          sendResponse({ success: true });
        } catch (e) {
          console.log('[CLEAR_IMAGE_FLOW_RECOVERY] Error:', e);
          sendResponse({ success: false, error: String(e) });
        }
      })();
      return true;

    case 'GET_IMAGE_WORKFLOW_STATUS':
      try {
        const imageIsRunning = imageFlowController !== null;
        console.log('[GET_IMAGE_WORKFLOW_STATUS] Running:', imageIsRunning);
        sendResponse({ success: true, isRunning: imageIsRunning });
      } catch (e) {
        console.log('[GET_IMAGE_WORKFLOW_STATUS] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

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
          hasFollowButton: boolean;
          profileUrl: string;
          searchableText: string;
          index: number;
          isNewLayout: boolean;
        }> = [];

        // Try NEW selector first (data-e2e based), fallback to OLD (class based)
        let userContainers = document.querySelectorAll('[data-e2e="search-user-container"]');
        const isNewLayout = userContainers.length > 0;

        if (!isNewLayout) {
          userContainers = document.querySelectorAll('[class*="DivSearchUserItemContainer"]');
        }

        console.log('[TIKTOK_GET_PROFILES] Found', userContainers.length, 'user cards, isNewLayout:', isNewLayout);

        userContainers.forEach((container, index) => {
          try {
            if (isNewLayout) {
              // NEW LAYOUT: Use data-e2e attributes
              const uniqueIdEl = container.querySelector('[data-e2e="search-user-unique-id"]');
              const nicknameEl = container.querySelector('[data-e2e="search-user-nickname"]');
              const followerEl = container.querySelector('[data-e2e="search-follow-count"]');

              const uniqueId = uniqueIdEl?.textContent?.trim() || '';
              const nickname = nicknameEl?.textContent?.trim() || '';
              const followerText = followerEl?.textContent?.trim() || '0';

              // Get bio from innerText (text after follower count line)
              const innerText = (container as HTMLElement).innerText || '';
              const lines = innerText.split('\n').filter(t => t.trim());
              // Lines format: [username, nickname, followers, ...bio lines]
              const bioText = lines.length > 3 ? lines.slice(3).join(' ') : '';

              // Get profile URL from link
              const profileLink = container.querySelector('a');
              const profileUrl = profileLink?.href || '';

              // Combined text for keyword matching (nickname + bio)
              const searchableText = `${nickname} ${bioText}`;

              console.log('[TIKTOK_GET_PROFILES] NEW Card', index, ':', { uniqueId, nickname, followerText, bioText: bioText.substring(0, 50) });

              if (uniqueId) {
                profiles.push({
                  id: `profile_${index}_${uniqueId}`,
                  name: nickname,              // Display name for keyword matching
                  username: uniqueId,          // Unique ID for tracking
                  followerText,
                  isFollowing: false,          // Unknown in new layout - check on profile page
                  hasFollowButton: false,      // No buttons in new layout
                  profileUrl,
                  searchableText,
                  index,
                  isNewLayout: true
                });
              }
            } else {
              // OLD LAYOUT: Keep existing logic for backward compatibility
              const textContent = (container as HTMLElement).innerText || '';
              const parts = textContent.split('\n').filter(t => t.trim());

              const name = parts[0] || '';
              const username = parts[1] || '';
              const followerText = parts[2] || '0';

              // Get button and check its state
              const btn = container.querySelector('button');
              const btnText = btn?.textContent?.trim().toLowerCase() || '';

              // "follow" = not following, "following"/"friends" = already following
              const isFollowing = btnText === 'following' || btnText === 'friends' || btnText === 'requested';
              const hasFollowButton = btnText === 'follow' || isFollowing;

              console.log('[TIKTOK_GET_PROFILES] OLD Card', index, ':', { name, username, followerText, btnText, isFollowing });

              if (hasFollowButton && username) {
                profiles.push({
                  id: `profile_${index}_${username}`,
                  name,
                  username,
                  followerText,
                  isFollowing,
                  hasFollowButton: true,
                  profileUrl: '',
                  searchableText: name,
                  index,
                  isNewLayout: false
                });
              }
            }
          } catch (err) {
            console.warn('[TIKTOK_GET_PROFILES] Error parsing profile:', err);
          }
        });

        console.log('[TIKTOK_GET_PROFILES] Parsed', profiles.length, 'profiles');
        sendResponse({ success: true, profiles, isNewLayout });
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

    case 'TIKTOK_CHECK_PROFILE_PAGE_READY':
      try {
        // Check if profile page is loaded by looking for follow button or user info
        const hasFollowButton = document.querySelector('[data-e2e="follow-button"]') !== null;
        const hasUserInfo = document.querySelector('[data-e2e="user-subtitle"]') !== null ||
                           document.querySelector('[data-e2e="user-bio"]') !== null ||
                           document.querySelector('[data-e2e="followers-count"]') !== null;
        const ready = hasFollowButton || hasUserInfo;

        console.log('[TIKTOK_CHECK_PROFILE_PAGE_READY]', { hasFollowButton, hasUserInfo, ready });
        sendResponse({ success: true, ready, hasFollowButton });
      } catch (e) {
        console.log('[TIKTOK_CHECK_PROFILE_PAGE_READY] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'TIKTOK_PROFILE_CLICK_FOLLOW':
      try {
        // Find follow button on profile page
        const followBtn = document.querySelector('[data-e2e="follow-button"]');

        if (!followBtn) {
          console.log('[TIKTOK_PROFILE_CLICK_FOLLOW] Follow button not found');
          sendResponse({ success: false, error: 'Follow button not found on profile' });
          return;
        }

        const btnText = followBtn.textContent?.trim().toLowerCase() || '';
        console.log('[TIKTOK_PROFILE_CLICK_FOLLOW] Button text:', btnText);

        if (btnText === 'follow') {
          (followBtn as HTMLElement).click();
          console.log('[TIKTOK_PROFILE_CLICK_FOLLOW] Clicked follow button');
          sendResponse({ success: true, action: 'followed' });
        } else if (btnText === 'following' || btnText === 'friends' || btnText === 'requested') {
          console.log('[TIKTOK_PROFILE_CLICK_FOLLOW] Already following/requested:', btnText);
          sendResponse({ success: true, action: 'already_following', status: btnText });
        } else {
          console.log('[TIKTOK_PROFILE_CLICK_FOLLOW] Unknown button state:', btnText);
          sendResponse({ success: false, error: `Unknown button state: ${btnText}` });
        }
      } catch (e) {
        console.log('[TIKTOK_PROFILE_CLICK_FOLLOW] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'TIKTOK_OPEN_FOLLOWING_MODAL':
      try {
        // Click the Following count to open modal
        const followingLink = document.querySelector('[data-e2e="following-count"]');
        if (followingLink) {
          (followingLink as HTMLElement).click();
          console.log('[TIKTOK_OPEN_FOLLOWING_MODAL] Clicked following count');
          sendResponse({ success: true });
        } else {
          console.log('[TIKTOK_OPEN_FOLLOWING_MODAL] Following link not found');
          sendResponse({ success: false, error: 'Following link not found' });
        }
      } catch (e) {
        console.log('[TIKTOK_OPEN_FOLLOWING_MODAL] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'TIKTOK_CHECK_FOLLOWING_MODAL_OPEN':
      try {
        // Check if following modal is open by looking for role="dialog" with user links
        // TikTok uses role="dialog" attribute, not <dialog> HTML tag
        const checkDialogs = document.querySelectorAll('[role="dialog"]');
        let isOpen = false;

        for (const dialog of checkDialogs) {
          // Look for the dialog that contains user profile links (following modal has many)
          if (dialog.querySelectorAll('a[href*="/@"]').length > 10) {
            isOpen = true;
            break;
          }
        }

        console.log('[TIKTOK_CHECK_FOLLOWING_MODAL_OPEN] Modal open:', isOpen);
        sendResponse({ success: true, isOpen });
      } catch (e) {
        console.log('[TIKTOK_CHECK_FOLLOWING_MODAL_OPEN] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    case 'TIKTOK_EXTRACT_FOLLOWING_LIST':
      (async () => {
        try {
          console.log('[TIKTOK_EXTRACT_FOLLOWING_LIST] Starting extraction...');
          const userIdSet = new Set<string>(); // Use Set for faster lookups
          let lastCount = 0;
          let noNewItemsCount = 0;
          const maxNoNewItems = 8; // More attempts for lazy loading

          // Helper to send progress updates to popup
          const sendProgress = (count: number) => {
            chrome.runtime.sendMessage({
              type: 'TIKTOK_FOLLOWING_PROGRESS',
              count
            }).catch(() => {}); // Ignore if popup closed
          };

          // Find the scrollable container directly by class name (more reliable)
          const scrollContainer = document.querySelector('[class*="DivUserListContainer"]') as HTMLElement;

          if (!scrollContainer) {
            // Fallback: find via role="dialog"
            const dialogs = document.querySelectorAll('[role="dialog"]');
            let found = false;
            for (const dialog of dialogs) {
              if (dialog.querySelectorAll('a[href*="/@"]').length > 10) {
                found = true;
                break;
              }
            }
            if (!found) {
              console.log('[TIKTOK_EXTRACT_FOLLOWING_LIST] Modal not found');
              sendResponse({ success: false, error: 'Following modal not found' });
              return;
            }
          }

          console.log('[TIKTOK_EXTRACT_FOLLOWING_LIST] Found scroll container');

          // Extract function - gets user IDs from currently visible items
          const extractVisibleUserIds = (): void => {
            const userLinks = scrollContainer.querySelectorAll('a[href*="/@"]');
            userLinks.forEach((link) => {
              const href = (link as HTMLAnchorElement).href;
              const match = href.match(/@([^/?]+)/);
              if (match && match[1]) {
                userIdSet.add(match[1]);
              }
            });
          };

          // Reset scroll to top
          scrollContainer.scrollTop = 0;
          await new Promise(resolve => setTimeout(resolve, 300));

          // Initial extraction
          extractVisibleUserIds();
          lastCount = userIdSet.size;
          sendProgress(lastCount);
          console.log('[TIKTOK_EXTRACT_FOLLOWING_LIST] Initial count:', lastCount);

          // Scroll incrementally and extract at each step (TikTok uses virtualized list)
          while (noNewItemsCount < maxNoNewItems) {
            // Scroll to bottom to trigger lazy load
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
            await new Promise(resolve => setTimeout(resolve, 600));

            // Extract newly loaded items
            extractVisibleUserIds();

            if (userIdSet.size === lastCount) {
              noNewItemsCount++;
              console.log('[TIKTOK_EXTRACT_FOLLOWING_LIST] No new items, attempt:', noNewItemsCount);
            } else {
              noNewItemsCount = 0;
              lastCount = userIdSet.size;
              sendProgress(lastCount);
              console.log('[TIKTOK_EXTRACT_FOLLOWING_LIST] New count:', lastCount);
            }
          }

          const userIds = Array.from(userIdSet);
          console.log('[TIKTOK_EXTRACT_FOLLOWING_LIST] Extraction complete, total:', userIds.length);
          sendResponse({
            success: true,
            userIds,
            count: userIds.length
          });
        } catch (e) {
          console.log('[TIKTOK_EXTRACT_FOLLOWING_LIST] Error:', e);
          sendResponse({ success: false, error: String(e) });
        }
      })();
      return true; // Keep channel open for async

    case 'TIKTOK_CLOSE_MODAL':
      try {
        // Close any open modal by pressing Escape or clicking backdrop
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        console.log('[TIKTOK_CLOSE_MODAL] Sent Escape key');
        sendResponse({ success: true });
      } catch (e) {
        console.log('[TIKTOK_CLOSE_MODAL] Error:', e);
        sendResponse({ success: false, error: String(e) });
      }
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  return true;
});

console.log('[ShopEnginX] Content script loaded');

// ==================== Auto-check for Recovery State on Page Load ====================
// Check if this page load is after a generation failure refresh
(async () => {
  // Only check on Google Flow pages
  if (!window.location.href.includes('labs.google/fx/tools/flow')) {
    return;
  }

  // Wait for page to be ready
  await new Promise(resolve => setTimeout(resolve, 2000));

  try {
    const recoveryResult = await ImageFlowController.checkAndProcessRecovery();
    
    if (recoveryResult) {
      console.log('[ShopEnginX] Recovery check after page load:', recoveryResult);
      
      // Send message to extension about recovery result
      chrome.runtime.sendMessage({
        type: 'IMAGE_FLOW_RECOVERY_RESULT',
        ...recoveryResult,
      }).catch(() => {
        // Extension popup might not be open, that's ok
        console.log('[ShopEnginX] Could not send recovery result to extension (popup may be closed)');
      });
      
      // Also log to console for visibility
      if (recoveryResult.foundNewImages) {
        console.log(`[ShopEnginX] 🎉 Recovery found ${recoveryResult.actualCount} images created for set ${recoveryResult.failedSetIndex + 1} (expected ${recoveryResult.expectedCount})`);
        console.log('[ShopEnginX] New image UUIDs:', recoveryResult.newUUIDs);
      } else {
        console.log(`[ShopEnginX] ❌ No images found for failed set ${recoveryResult.failedSetIndex + 1}`);
      }
    }
  } catch (e) {
    console.log('[ShopEnginX] Error checking recovery state:', e);
  }
})();
