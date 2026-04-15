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

// ==================== Flow Generation Tracker ====================
// Uses MutationObserver to track generation UUIDs dynamically without scrolling
// Generalized for both image and video completion detection

interface GenerationTrackerConfig {
  /** Display name for logging, e.g. 'Image' or 'Video' */
  name: string;
  /** CSS selector for completed item elements, e.g. 'img[alt="Generated image"]' */
  itemSelector: string;
  /** Extract UUID from a matched element */
  extractUUID: (el: HTMLElement) => string | null;
  /** Given an added DOM node, return matched item elements within it (or [node] if node itself matches) */
  matchNewItems: (node: HTMLElement) => HTMLElement[];
  /** Check if a specific element is a tracked item */
  isTrackedElement: (el: HTMLElement) => boolean;
  /** Detect generation errors in the DOM. Return error text or null */
  detectError: () => string | null;
  /** Text patterns in added nodes that indicate generation failure */
  errorTextPatterns: string[];
  /** Get the MutationObserver container element */
  getContainer: () => HTMLElement;
  /** Attributes to watch for changes (e.g. ['src'] for images, ['src'] for videos) */
  watchAttributes: string[];
  /** Handle attribute change on a tracked element. Return UUID if relevant, null otherwise */
  handleAttributeChange?: (target: HTMLElement, attributeName: string) => string | null;
}

class FlowGenerationTracker {
  private orderedIds: string[] = [];
  private observer: MutationObserver | null = null;
  private isTracking: boolean = false;

  // Completion detection state
  private snapshotBeforeGeneration: string[] = [];
  private expectedNewItemCount: number = 0;
  private completionResolver: ((newUUIDs: string[]) => void) | null = null;
  private completionRejecter: ((error: Error) => void) | null = null;
  private completionTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingItemsWithoutId: Set<HTMLElement> = new Set();
  private detectedNewUUIDs: Set<string> = new Set();
  private lastPercentage: number = 0;
  private isGenerating: boolean = false;
  private generationFailed: boolean = false;
  private activePercentageNodes: Set<Node> = new Set();
  private percentageGraceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private config: GenerationTrackerConfig) {}

  // Check for error containers using config delegate
  private detectErrorContainers(): string | null {
    return this.config.detectError();
  }

  // Update the ordered list based on current DOM state
  private updateItemOrder() {
    const items = document.querySelectorAll(this.config.itemSelector);
    const visibleIds: string[] = [];
    const rawInfo: string[] = [];

    items.forEach((el) => {
      const htmlEl = el as HTMLElement;
      const src = htmlEl.getAttribute('src') || htmlEl.getAttribute('href') || '';
      rawInfo.push(src.substring(0, 60));
      const uuid = this.config.extractUUID(htmlEl);
      if (uuid) {
        visibleIds.push(uuid);
      }
    });

    console.log(`[Flow${this.config.name}Tracker] updateItemOrder triggered, items found:`, items.length, 'with UUID:', visibleIds.length);
    console.log(`[Flow${this.config.name}Tracker] Raw info:`, rawInfo);
    console.log(`[Flow${this.config.name}Tracker] Extracted UUIDs:`, visibleIds);

    // Merge visible IDs with existing order
    this.mergeItemOrder(visibleIds);
    console.log(`[Flow${this.config.name}Tracker] Updated order, total tracked:`, this.orderedIds.length, this.orderedIds);
  }

  // Merge newly visible IDs into the ordered list
  private mergeItemOrder(visibleIds: string[]) {
    const existingSet = new Set(this.orderedIds);
    const newIds = visibleIds.filter(id => !existingSet.has(id));

    if (newIds.length === 0 && visibleIds.length === 0) return;

    // If we have new IDs, we need to insert them in correct position
    if (newIds.length > 0) {
      console.log(`[Flow${this.config.name}Tracker] New items detected:`, newIds);

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

  // Track an item that appeared but has no valid UUID yet
  private trackPendingItem(el: HTMLElement) {
    const uuid = this.config.extractUUID(el);
    if (!uuid) {
      // No UUID yet - add to pending
      if (!this.pendingItemsWithoutId.has(el)) {
        this.pendingItemsWithoutId.add(el);
        console.log(`[Flow${this.config.name}Tracker] 📥 Pending item added (no UUID yet), total pending:`, this.pendingItemsWithoutId.size);
      }
    } else {
      // Already has UUID - handle immediately
      this.handleNewUUID(uuid, el);
    }
  }

  // Handle when an item gets a valid UUID (either from attribute change or initial load)
  private handleNewUUID(uuid: string, el: HTMLElement) {
    // Remove from pending if it was there
    this.pendingItemsWithoutId.delete(el);

    // Check if this is a new UUID (not in snapshot before generation)
    const isNew = !this.snapshotBeforeGeneration.includes(uuid);

    if (isNew && !this.detectedNewUUIDs.has(uuid)) {
      this.detectedNewUUIDs.add(uuid);
      console.log(`[Flow${this.config.name}Tracker] ✨ New UUID detected:`, uuid.substring(0, 8), 'total new:', this.detectedNewUUIDs.size, '/', this.expectedNewItemCount);

      // Check completion immediately - MutationObserver gives us exact timing
      this.checkCompletion();
    }
  }

  // Handle attribute change on an item
  private handleAttributeChangeOnItem(el: HTMLElement, attrName: string) {
    let uuid: string | null = null;
    if (this.config.handleAttributeChange) {
      uuid = this.config.handleAttributeChange(el, attrName);
    } else {
      uuid = this.config.extractUUID(el);
    }
    if (uuid) {
      this.handleNewUUID(uuid, el);
    }
  }

  // Check if generation is complete
  private checkCompletion() {
    if (!this.isGenerating || !this.completionResolver) {
      return;
    }

    const newUUIDCount = this.detectedNewUUIDs.size;
    const pendingCount = this.pendingItemsWithoutId.size;

    console.log(`[Flow${this.config.name}Tracker] 🔍 Completion check:`, {
      newUUIDs: newUUIDCount,
      expected: this.expectedNewItemCount,
      pending: pendingCount
    });

    // Complete if we have expected count and no pending items
    if (newUUIDCount >= this.expectedNewItemCount && pendingCount === 0) {
      console.log(`[Flow${this.config.name}Tracker] ✅ Generation complete! New UUIDs:`, Array.from(this.detectedNewUUIDs));
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

    if (this.percentageGraceTimer) {
      clearTimeout(this.percentageGraceTimer);
      this.percentageGraceTimer = null;
    }

    this.isGenerating = false;
  }

  // Handle percentage update from characterData mutation
  private handlePercentageUpdate(percentage: number) {
    if (percentage !== this.lastPercentage) {
      console.log(`[Flow${this.config.name}Tracker] 📊 Percentage update:`, this.lastPercentage, '->', percentage);
      this.lastPercentage = percentage;
    }
  }

  // Layer 2: Start grace timer when a percentage node changes to non-percentage text
  // Waits 5 seconds for a success signal (new UUID or play_circle) before declaring failure
  private startPercentageGraceTimer() {
    // Don't start multiple grace timers
    if (this.percentageGraceTimer) return;

    console.log(`[Flow${this.config.name}Tracker] ⏳ Starting percentage-gone grace timer (5s)`);
    this.percentageGraceTimer = setTimeout(() => {
      this.percentageGraceTimer = null;
      if (!this.isGenerating || this.generationFailed) return;

      // Check if a new UUID arrived (success signal)
      if (this.detectedNewUUIDs.size > 0) {
        console.log(`[Flow${this.config.name}Tracker] Grace timer: new UUIDs detected, not an error`);
        return;
      }

      // Check for error containers
      const errorText = this.detectErrorContainers();
      if (errorText) {
        console.log(`[Flow${this.config.name}Tracker] ❌ Grace timer: error detected:`, errorText);
        this.handleGenerationError(errorText);
        return;
      }

      // No success signal and no explicit error found after grace period
      console.log(`[Flow${this.config.name}Tracker] ❌ Grace timer: percentage disappeared with no success signal`);
      this.handleGenerationError('Generation failed: progress indicator disappeared without producing results');
    }, 5000);
  }

  // Handle generation error detected from DOM
  private handleGenerationError(errorText: string) {
    if (!this.isGenerating || this.generationFailed) {
      return;
    }

    this.generationFailed = true;
    console.log(`[Flow${this.config.name}Tracker] ❌ Generation failed:`, errorText);

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

  // Start waiting for new items (call before clicking Create)
  waitForNewImages(expectedCount: number, timeoutMs: number = 120000): Promise<string[]> {
    return new Promise((resolve, reject) => {
      // Take snapshot before generation
      this.snapshotBeforeGeneration = [...this.orderedIds];
      this.expectedNewItemCount = expectedCount;
      this.detectedNewUUIDs.clear();
      this.pendingItemsWithoutId.clear();
      this.isGenerating = true;
      this.generationFailed = false;
      this.lastPercentage = 0;

      console.log(`[Flow${this.config.name}Tracker] 🚀 Waiting for`, expectedCount, `new ${this.config.name.toLowerCase()}s. Snapshot:`, this.snapshotBeforeGeneration.length, 'existing');

      this.completionResolver = resolve;
      this.completionRejecter = reject;

      // Set timeout
      this.completionTimeout = setTimeout(() => {
        console.log(`[Flow${this.config.name}Tracker] ⏰ Timeout reached. Detected UUIDs:`, Array.from(this.detectedNewUUIDs));
        
        // Check if we got fewer items than expected - might be an error
        const detectedCount = this.detectedNewUUIDs.size;
        if (detectedCount < expectedCount) {
          console.log(`[Flow${this.config.name}Tracker] ⚠️ Got fewer items than expected:`, detectedCount, '/', expectedCount);
          
          // Check for error containers
          const errorText = this.detectErrorContainers();
          if (errorText) {
            console.log(`[Flow${this.config.name}Tracker] ❌ Error detected on timeout:`, errorText);
            this.handleGenerationError(errorText);
            return;
          }
          
          // No explicit error found but still missing items - might be partial failure
          if (detectedCount === 0) {
            // Complete failure - no items at all
            console.log(`[Flow${this.config.name}Tracker] ❌ Complete generation failure - no items detected`);
            this.handleGenerationError(`Generation timed out with no ${this.config.name.toLowerCase()}s produced`);
            return;
          }
        }
        
        // Either got all expected items, or partial success without error
        this.resolveCompletion();
      }, timeoutMs);
    });
  }

  // Cancel waiting for new items
  cancelWait() {
    if (this.completionResolver) {
      console.log(`[Flow${this.config.name}Tracker] ❌ Wait cancelled`);
      this.resolveCompletion();
    }
  }

  // Start tracking items
  start() {
    if (this.isTracking) {
      console.log(`[Flow${this.config.name}Tracker] Already tracking`);
      return;
    }

    // Initial scan
    this.updateItemOrder();

    // Set up MutationObserver
    const onMutation = (mutations: MutationRecord[]) => {
      let hasRelevantChanges = false;

      // Log all mutations for debugging
      console.log(`[Flow${this.config.name}Tracker-MutationObserver] Triggered, mutations:`, mutations.length);

      for (const mutation of mutations) {
        // Log ALL mutations without filtering
        const targetEl = mutation.target as HTMLElement;
        const targetInfo = targetEl.tagName ?
          `${targetEl.tagName}${targetEl.className ? '.' + String(targetEl.className).substring(0, 40) : ''}` :
          (mutation.target instanceof Text ? `TEXT:"${mutation.target.textContent?.substring(0, 30)}"` : 'unknown');

        console.log(`[Flow${this.config.name}Tracker-MutationObserver]`, JSON.stringify({
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

            // Use config to match new items
            const matchedItems = this.config.matchNewItems(node);
            if (matchedItems.length > 0) {
              console.log(`[Flow${this.config.name}Tracker] 🖼️ ${this.config.name} item(s) added:`, nodeInfo, 'count:', matchedItems.length);
              hasRelevantChanges = true;
              // Track each item for completion detection
              if (this.isGenerating) {
                matchedItems.forEach((item) => {
                  this.trackPendingItem(item);
                });
              }
            }

            // Log any text content that might contain percentages
            const textContent = node.textContent?.trim();
            if (textContent && /\d{1,3}%/.test(textContent)) {
              console.log(`[Flow${this.config.name}Tracker] 📊 Percentage text detected in added node:`, nodeInfo, 'text:', textContent.substring(0, 50));
            }
          } else if (node instanceof Text) {
            const textContent = node.textContent?.trim();
            if (textContent && /\d{1,3}%/.test(textContent)) {
              console.log(`[Flow${this.config.name}Tracker] 📊 Percentage text node added:`, textContent);
            }
          }
        });

        // Check for attribute changes on tracked items
        if (mutation.type === 'attributes' && mutation.attributeName) {
          const target = mutation.target as HTMLElement;
          if (this.config.isTrackedElement(target)) {
            console.log(`[Flow${this.config.name}Tracker] 🔄 ${this.config.name} attribute changed:`, mutation.attributeName, 'on', target.tagName);
            hasRelevantChanges = true;
            // Handle attribute change for completion detection
            if (this.isGenerating) {
              this.handleAttributeChangeOnItem(target, mutation.attributeName);
            }
          }
        }

        // Log characterData changes (text content updates) - percentage tracking + error detection
        if (mutation.type === 'characterData') {
          const textContent = (mutation.target as Text).textContent?.trim();
          if (textContent) {
            const isPercentage = /^\d{1,3}%?$/.test(textContent);

            if (isPercentage) {
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
                console.log(`[Flow${this.config.name}Tracker] 📊 Text content changed to percentage:`, textContent);
              }
              // Layer 2: Track this node as showing a percentage
              if (this.isGenerating) {
                this.activePercentageNodes.add(mutation.target);
              }
            } else {
              // Layer 1: Non-percentage text in characterData - check for error patterns
              if (this.isGenerating) {
                for (const pattern of this.config.errorTextPatterns) {
                  if (textContent.includes(pattern)) {
                    console.log(`[Flow${this.config.name}Tracker] ❌ Error detected in characterData:`, textContent.substring(0, 80));
                    this.handleGenerationError(textContent);
                    break;
                  }
                }
              }
              // Layer 2: If this node was tracking a percentage, it changed to non-percentage
              if (this.isGenerating && this.activePercentageNodes.has(mutation.target)) {
                this.activePercentageNodes.delete(mutation.target);
                console.log(`[Flow${this.config.name}Tracker] ⚠️ Percentage node changed to non-percentage:`, textContent.substring(0, 50));
                this.startPercentageGraceTimer();
              }
            }
          }
        }

        // Check added nodes for error messages
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement || node instanceof Text) {
            const text = node.textContent?.trim() || '';
            // Detect generation failure using config error patterns
            for (const pattern of this.config.errorTextPatterns) {
              if (text.includes(pattern)) {
                console.log(`[Flow${this.config.name}Tracker] ❌ Generation error detected:`, text.substring(0, 80));
                this.handleGenerationError(text);
                break;
              }
            }
          }
        });
      }

      if (hasRelevantChanges) {
        console.log(`[Flow${this.config.name}Tracker] ✅ Relevant changes detected, updating item order...`);
        // Debounce updates
        setTimeout(() => this.updateItemOrder(), 100);
      }

      // Layer 3: Proactive error detection after relevant DOM changes
      if (this.isGenerating && hasRelevantChanges) {
        const err = this.detectErrorContainers();
        if (err) {
          console.log(`[Flow${this.config.name}Tracker] ❌ Proactive error detection:`, err);
          this.handleGenerationError(err);
        }
      }
    };

    this.observer = new MutationObserver(onMutation);

    // Find the container via config
    const container = this.config.getContainer();

    this.observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: this.config.watchAttributes,
      characterData: true,
      characterDataOldValue: true
    });

    console.log(`[Flow${this.config.name}Tracker] Observer attached to:`, container.tagName, (container.className || '').substring(0, 50));

    this.isTracking = true;
    console.log(`[Flow${this.config.name}Tracker] Started tracking`);
  }

  // Stop tracking
  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.percentageGraceTimer) {
      clearTimeout(this.percentageGraceTimer);
      this.percentageGraceTimer = null;
    }
    this.isTracking = false;
    console.log(`[Flow${this.config.name}Tracker] Stopped tracking`);
  }

  // Get current snapshot of ordered IDs
  getSnapshot(): string[] {
    // Update before returning to ensure we have latest visible items
    this.updateItemOrder();
    return [...this.orderedIds];
  }

  // Get new items compared to a previous snapshot
  getNewImages(previousSnapshot: string[]): string[] {
    const previousSet = new Set(previousSnapshot);
    // Update to get any new items
    this.updateItemOrder();
    return this.orderedIds.filter(id => !previousSet.has(id));
  }

  // Get total count
  getCount(): number {
    this.updateItemOrder();
    return this.orderedIds.length;
  }

  // Reset tracker
  reset() {
    this.orderedIds = [];
    this.snapshotBeforeGeneration = [];
    this.expectedNewItemCount = 0;
    this.detectedNewUUIDs.clear();
    this.pendingItemsWithoutId.clear();
    this.isGenerating = false;
    this.generationFailed = false;
    this.lastPercentage = 0;
    this.activePercentageNodes.clear();

    if (this.percentageGraceTimer) {
      clearTimeout(this.percentageGraceTimer);
      this.percentageGraceTimer = null;
    }
    if (this.completionTimeout) {
      clearTimeout(this.completionTimeout);
      this.completionTimeout = null;
    }
    if (this.completionResolver) {
      this.completionResolver([]);
      this.completionResolver = null;
    }
    this.completionRejecter = null;

    console.log(`[Flow${this.config.name}Tracker] Reset`);
  }

  // Check if tracking
  isActive(): boolean {
    return this.isTracking;
  }
}

// ==================== Tracker Configs ====================

const IMAGE_TRACKER_CONFIG: GenerationTrackerConfig = {
  name: 'Image',
  itemSelector: 'img[alt="Generated image"]',
  extractUUID: (el: HTMLElement) => {
    const src = (el as HTMLImageElement).src || el.getAttribute('src') || '';
    const match = src.match(/(?:image\/|[?&]name=)([a-f0-9-]+)/);
    return match ? match[1] : null;
  },
  matchNewItems: (node: HTMLElement) => {
    if (node.matches && node.matches('img[alt="Generated image"]')) {
      return [node];
    }
    if (node.querySelectorAll) {
      return Array.from(node.querySelectorAll('img[alt="Generated image"]')) as HTMLElement[];
    }
    return [];
  },
  isTrackedElement: (el: HTMLElement) => {
    return !!(el.matches && el.matches('img[alt="Generated image"]'));
  },
  detectError: () => {
    const resultContainers = document.querySelectorAll('[class*="sc-6349d8ef-7"], [class*="result-container"]');
    for (const container of resultContainers) {
      const hasImage = container.querySelector('img[alt="Generated image"]');
      if (!hasImage) {
        const textContent = container.textContent?.trim() || 'Unknown error (no image in result container)';
        console.log('[FlowImageTracker] Error container detected (no image):', textContent.substring(0, 100));
        return textContent.substring(0, 200);
      }
    }
    return null;
  },
  errorTextPatterns: ["Couldn't generate", 'Try again later', 'violate', 'policies'],
  getContainer: () => {
    return (document.querySelector('[data-testid="virtuoso-item-list"]') || document.body) as HTMLElement;
  },
  watchAttributes: ['src'],
  handleAttributeChange: (target: HTMLElement, attributeName: string) => {
    if (attributeName === 'src') {
      const src = (target as HTMLImageElement).src || '';
      const match = src.match(/(?:image\/|[?&]name=)([a-f0-9-]+)/);
      return match ? match[1] : null;
    }
    return null;
  },
};

const VIDEO_TRACKER_CONFIG: GenerationTrackerConfig = {
  name: 'Video',
  itemSelector: 'video[src]',
  extractUUID: (el: HTMLElement) => {
    // Try video src first
    const src = (el as HTMLVideoElement).src || el.getAttribute('src') || '';
    const videoMatch = src.match(/(?:video\/|[?&]name=)([a-f0-9-]{36})/);
    if (videoMatch) return videoMatch[1];
    // Try parent/ancestor <a href="/edit/UUID">
    const anchor = el.closest('a[href*="/edit/"]');
    if (anchor) {
      const hrefMatch = anchor.getAttribute('href')?.match(/\/edit\/([a-f0-9-]{36})/);
      if (hrefMatch) return hrefMatch[1];
    }
    return null;
  },
  matchNewItems: (node: HTMLElement) => {
    const items: HTMLElement[] = [];
    // Match video elements
    if (node.matches && node.matches('video[src]')) {
      items.push(node);
    }
    if (node.querySelectorAll) {
      items.push(...Array.from(node.querySelectorAll('video[src]')) as HTMLElement[]);
    }
    // Also match completed video tiles: <a href="/edit/..."> links that contain play_circle
    // but NOT percentage text (which means still generating)
    if (node.matches && node.matches('a[href*="/edit/"]')) {
      const text = node.textContent || '';
      if (text.includes('play_circle') && !/\d{1,3}%/.test(text)) {
        items.push(node);
      }
    }
    if (node.querySelectorAll) {
      const links = node.querySelectorAll('a[href*="/edit/"]');
      for (const link of links) {
        const text = link.textContent || '';
        if (text.includes('play_circle') && !/\d{1,3}%/.test(text)) {
          items.push(link as HTMLElement);
        }
      }
    }
    return items;
  },
  isTrackedElement: (el: HTMLElement) => {
    if (el.matches && el.matches('video[src]')) return true;
    if (el.matches && el.matches('a[href*="/edit/"]')) {
      const text = el.textContent || '';
      return text.includes('play_circle') && !/\d{1,3}%/.test(text);
    }
    return false;
  },
  detectError: () => {
    // Look for tiles with Failed/warning text and Retry/Delete buttons
    const allLinks = document.querySelectorAll('a[href*="/edit/"]');
    for (const link of allLinks) {
      const text = link.textContent || '';
      if (text.includes('warning') && (text.includes('Failed') || text.includes('Retry') || text.includes('Delete'))) {
        console.log('[FlowVideoTracker] Error tile detected:', text.substring(0, 100));
        return text.substring(0, 200);
      }
    }
    return null;
  },
  errorTextPatterns: ['Failed', 'interests of third-party', "can't generate", 'warning'],
  getContainer: () => {
    return (document.querySelector('[data-testid="virtuoso-item-list"]') || document.body) as HTMLElement;
  },
  watchAttributes: ['src'],
  handleAttributeChange: (target: HTMLElement, attributeName: string) => {
    if (attributeName === 'src') {
      const src = (target as HTMLVideoElement).src || '';
      const match = src.match(/(?:video\/|[?&]name=)([a-f0-9-]{36})/);
      return match ? match[1] : null;
    }
    return null;
  },
};

// Global instances
const flowImageTracker = new FlowGenerationTracker(IMAGE_TRACKER_CONFIG);
const flowVideoTracker = new FlowGenerationTracker(VIDEO_TRACKER_CONFIG);

// ==================== Video Flow Controller ====================
// Automates video generation workflow on Google Flow

// TypeScript interfaces for video flow configuration
interface VideoSetConfig {
  image?: string;              // Base64 encoded start frame image (legacy upload flow)
  imageUuid?: string;          // UUID of gallery image for "Add To Prompt" flow
  prompts: string[];           // prompts[0] = initial, prompts[1..N] = extensions
  aspectRatio: '9:16' | '16:9';
  outputCount: number;         // Outputs per prompt (1-4)
  autoDownload: boolean;
  continueFromCurrent?: boolean; // If true, skip createNewProject, use "Add To Prompt" flow
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
  videoUuids?: string[];       // UUIDs of generated videos (extracted from <video src> after generation)
}

// Default retry configuration per step
const DEFAULT_VIDEO_STEP_CONFIG: Record<string, StepRetryConfig> = {
  createNewProject:       { maxAttempts: 3, retryDelayMs: 2000, timeoutMs: 30000 },
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
  // "Add To Prompt" flow steps
  switchToImagesTab:       { maxAttempts: 3, retryDelayMs: 1000, timeoutMs: 15000 },
  clickAddToPromptByUuid:  { maxAttempts: 5, retryDelayMs: 2000, timeoutMs: 30000 },
  clickRemoveFromPrompt:   { maxAttempts: 3, retryDelayMs: 1000, timeoutMs: 15000 },
  switchToFramesToVideo:   { maxAttempts: 3, retryDelayMs: 1000, timeoutMs: 15000 },
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

// ─── Slate editor helper (MAIN world direct access) ───

/**
 * Insert text into the Slate editor by traversing React's internal fiber tree.
 * content-main.ts now runs in MAIN world, so we can access __reactFiber$ properties directly.
 * Returns true on success, false on failure.
 */
const insertTextViaSlateFiber = (text: string): boolean => {
  try {
    // Find all elements with React fiber keys
    const allElements = document.querySelectorAll('*');
    let slateEditor: any = null;

    for (const el of allElements) {
      // React stores fiber on the DOM element as __reactFiber$ + random suffix
      const keys = Object.keys(el);
      for (const key of keys) {
        if (!key.startsWith('__reactFiber$')) continue;
        const fiber: any = (el as any)[key];
        if (!fiber) continue;

        // Walk the fiber tree looking for Slate's insertText method
        let current: any = fiber;
        const visited = new WeakSet();
        const maxDepth = 30;
        let depth = 0;

        while (current && depth < maxDepth && !visited.has(current)) {
          visited.add(current);

          // Check if this fiber node has slate editor methods
          if (
            current.stateNode &&
            typeof current.stateNode.insertText === 'function' &&
            typeof current.stateNode.children !== 'undefined'
          ) {
            slateEditor = current.stateNode;
            break;
          }

          // Also check the return/alternate fiber (React uses this for double-buffering)
          if (current.alternate && !visited.has(current.alternate)) {
            current = current.alternate;
            depth++;
            continue;
          }

          current = current.return;
          depth++;
        }

        if (slateEditor) break;
      }
      if (slateEditor) break;
    }

    if (!slateEditor) {
      console.warn('[SlateHelper] No Slate editor instance found via fiber traversal');
      return false;
    }

    // Position cursor at end of existing content
    const children = slateEditor.children;
    if (children && children.length > 0) {
      slateEditor.selection = {
        anchor: { path: [children.length - 1, 0], offset: 0 },
        focus: { path: [children.length - 1, 0], offset: 0 },
      };
      slateEditor.deleteBackward(1000); // Clear existing text
    }

    // Insert the new text
    slateEditor.insertText(text);
    return true;
  } catch (e) {
    console.warn('[SlateHelper] Direct fiber insertion failed:', e);
    return false;
  }
};

/**
 * Fill the prompt using direct Slate fiber access in MAIN world.
 * Falls back to standard DOM input if Slate insertion fails.
 */
const fillPromptViaSlateFiber = (prompt: string): boolean => {
  // First try direct Slate fiber insertion (Phase 2 — MAIN world)
  if (insertTextViaSlateFiber(prompt)) {
    return true;
  }

  // Fallback: standard DOM textbox input
  const textbox = document.querySelector('textarea, input[type="text"]') as HTMLTextAreaElement | HTMLInputElement | null;
  if (textbox) {
    textbox.focus();
    textbox.value = prompt;
    textbox.dispatchEvent(new Event('input', { bubbles: true }));
    textbox.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  return false;
};

// ─── Radix UI helpers (adapted from KubdeeAutogen's working Google Flow selectors) ───

/** Find the config trigger button using Radix UI patterns (replaces old combobox approach) */
const findConfigTriggerButton = (): HTMLElement | null => {
  const buttons = document.querySelectorAll('button[aria-haspopup="menu"]');
  for (const btn of buttons) {
    if (!(btn as HTMLElement).offsetParent) continue; // not visible
    if (btn.closest('[data-radix-popper-content-wrapper]')) continue; // inside a popper
    if (btn.closest('[role="menu"]')) continue; // inside a menu
    if (!btn.querySelector('[data-type="button-overlay"]')) continue; // no overlay
    const icons = btn.querySelectorAll('i');
    for (const icon of icons) {
      if ((icon.textContent || '').trim().toLowerCase().includes('crop_')) return btn as HTMLElement;
    }
  }
  return null;
};



/**
 * Check current settings from the trigger button (without opening popper).
 * Reads aspect ratio from icon and output count from button text.
 */
const checkCurrentSettings = (aspectRatio?: string, outputCount?: number): { ratioOk: boolean; countOk: boolean } => {
  const result = { ratioOk: !aspectRatio, countOk: !outputCount };
  const triggerBtn = findConfigTriggerButton();
  if (!triggerBtn) return result;
  if (aspectRatio) {
    const isPortrait = aspectRatio === '9:16';
    const targetIconText = isPortrait ? 'crop_9_16' : 'crop_16_9';
    const icons = triggerBtn.querySelectorAll('i');
    for (const icon of icons) {
      if ((icon.textContent || '').trim().toLowerCase().includes(targetIconText)) {
        result.ratioOk = true;
        break;
      }
    }
  }
  if (outputCount) {
    const btnText = (triggerBtn.textContent || '').trim().toLowerCase();
    if (btnText.includes(`x${outputCount}`)) result.countOk = true;
  }
  return result;
};

/**
 * Configure Google Flow settings (mode, aspect ratio, image count) by directly
 * manipulating the Radix config popper from the content script.
 * Previously routed through background.ts + chrome.scripting.executeScript({ world: 'MAIN' }),
 * but chrome.runtime.sendMessage is unreliable when side panel onMessage listeners
 * close the response channel before the background's async sendResponse fires.
 * DOM events (pointer/mouse/click) work from the content script's isolated world.
 */
async function configureFlowSettings(
  payload: { mode?: string; aspectRatio?: string; imageCount?: number },
  tag: string = 'Flow',
): Promise<{ success: boolean; results?: Record<string, boolean>; error?: string }> {
  const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
  const log = (msg: string) => console.log(`[${tag}:CONFIGURE] ${msg}`);

  const clickElement = async (el: HTMLElement) => {
    el.click();
  };

  try {
    const { mode, aspectRatio, imageCount } = payload;
    log(`Starting: mode=${mode}, aspectRatio=${aspectRatio}, imageCount=${imageCount}`);

    // Find config trigger button
    const findTrigger = (): HTMLElement | null => {
      const buttons = document.querySelectorAll('button[aria-haspopup="menu"]');
      for (const btn of buttons) {
        if (!(btn as HTMLElement).offsetParent) continue;
        if (btn.closest('[data-radix-popper-content-wrapper]')) continue;
        if (btn.closest('[role="menu"]')) continue;
        if (!btn.querySelector('[data-type="button-overlay"]')) continue;
        const icons = btn.querySelectorAll('i');
        for (const icon of icons) {
          if ((icon.textContent || '').trim().toLowerCase().includes('crop_')) return btn as HTMLElement;
        }
      }
      return null;
    };

    const trigger = findTrigger();
    if (!trigger) {
      log('Trigger NOT found');
      return { success: false, error: 'Config trigger button not found' };
    }
    log('Trigger found: ' + (trigger.textContent || '').trim().substring(0, 50));

    // Open config popper
    if (trigger.getAttribute('aria-expanded') !== 'true' && trigger.getAttribute('data-state') !== 'open') {
      log('Opening popper');
      await clickElement(trigger);
      await wait(800);
    }

    const getPopper = () =>
      document.querySelector('[data-radix-menu-content][data-state="open"]') as HTMLElement ||
      document.querySelector('[role="menu"][data-state="open"]') as HTMLElement;

    let popper = getPopper();
    if (!popper) {
      const overlay = trigger.querySelector('[data-type="button-overlay"]') as HTMLElement;
      if (overlay) { await clickElement(overlay); await wait(800); }
      popper = getPopper();
    }
    if (!popper) {
      log('Popper did NOT open');
      return { success: false, error: 'Config popper did not open' };
    }

    // Helper: find and click a tab
    const clickTab = async (iconMatch: string | null, textMatch: string | null): Promise<boolean> => {
      const currentPopper = getPopper() || popper;
      const tabs = currentPopper.querySelectorAll('button[role="tab"]');
      log(`clickTab(icon=${iconMatch}, text=${textMatch}): ${tabs.length} tabs`);
      for (const tab of tabs) {
        if (iconMatch) {
          const icon = tab.querySelector('i');
          if (!icon || (icon.textContent || '').trim().toLowerCase() !== iconMatch) continue;
        } else if (textMatch) {
          const txt = (tab.textContent || '').trim().toLowerCase();
          if (txt !== textMatch && txt !== textMatch.replace('x', '')) continue;
        }
        if (tab.getAttribute('data-state') === 'active' || tab.getAttribute('aria-selected') === 'true') {
          log(`  '${iconMatch || textMatch}' already active`);
          return true;
        }
        log(`  Clicking '${iconMatch || textMatch}'...`);
        await clickElement(tab as HTMLElement);
        await wait(600);
        // Re-check with fresh reference
        const freshPopper = getPopper() || popper;
        const freshTabs = freshPopper.querySelectorAll('button[role="tab"]');
        for (const ft of freshTabs) {
          if (iconMatch) {
            const fi = ft.querySelector('i');
            if (!fi || (fi.textContent || '').trim().toLowerCase() !== iconMatch) continue;
          } else if (textMatch) {
            const txt = (ft.textContent || '').trim().toLowerCase();
            if (txt !== textMatch && txt !== textMatch.replace('x', '')) continue;
          }
          const isActive = ft.getAttribute('data-state') === 'active' || ft.getAttribute('aria-selected') === 'true';
          log(`  '${iconMatch || textMatch}' re-check: ${isActive}`);
          return isActive;
        }
        log(`  '${iconMatch || textMatch}' lost after click`);
        return false;
      }
      log(`  No tab matched '${iconMatch || textMatch}'`);
      return false;
    };

    const results: Record<string, boolean> = {};

    if (mode) {
      results.mode = await clickTab(mode, null);
      log(`Mode ${mode}: ${results.mode ? 'ok' : 'FAILED'}`);
      await wait(300);
    }
    if (aspectRatio) {
      const icon = aspectRatio === '9:16' ? 'crop_9_16' : 'crop_16_9';
      results.ratio = await clickTab(icon, null);
      log(`Ratio ${aspectRatio}: ${results.ratio ? 'ok' : 'FAILED'}`);
      await wait(300);
    }
    if (imageCount) {
      results.count = await clickTab(null, `x${imageCount}`);
      log(`Count ${imageCount}: ${results.count ? 'ok' : 'FAILED'}`);
      await wait(300);
    }

    // Close popper
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await wait(200);
    document.body.click();
    await wait(300);

    return { success: true, results };
  } catch (e: any) {
    log(`UNCAUGHT ERROR: ${e?.message || e}`);
    return { success: false, error: `Uncaught: ${e?.message || e}` };
  }
}

const FlowUIActions = {
  /**
   * Click an element using simple .click().
   * content-main.ts now runs in the MAIN world, so .click() works natively.
   */
  dispatchSyntheticClick(el: HTMLElement): void {
    el.click();
  },

  /** Find the gallery scroll container by detecting overflow:auto div with generated images. */
  findGalleryScrollContainer(): HTMLElement | null {
    const allDivs = document.querySelectorAll('div');
    for (const el of allDivs) {
      const style = getComputedStyle(el);
      const isScrollable = style.overflow === 'auto' || style.overflow === 'scroll' ||
                            style.overflowY === 'auto' || style.overflowY === 'scroll';
      if (isScrollable && el.scrollHeight > el.clientHeight + 100 && (el as HTMLElement).clientHeight > 200) {
        if (el.querySelectorAll('img[alt="Generated image"]').length > 0) {
          return el as HTMLElement;
        }
      }
    }
    return null;
  },

  /** Find gallery image by UUID using incremental scroll (handles virtualized galleries). */
  async scrollToFindImage(
    imageUuid: string,
    delayFn: (ms: number) => Promise<void>,
    tag: string = 'FlowUI',
  ): Promise<HTMLElement | null> {
    const container = FlowUIActions.findGalleryScrollContainer();
    if (!container) {
      console.warn(`[${tag}] Gallery scroll container not found`);
      return document.querySelector(`img[src*="${imageUuid}"]`) as HTMLElement | null;
    }

    const clientHeight = container.clientHeight;
    const stepSize = Math.floor(clientHeight * 0.7);
    const maxSteps = Math.ceil(container.scrollHeight / stepSize) + 2;

    container.scrollTop = 0;
    await delayFn(300);

    for (let step = 0; step < maxSteps; step++) {
      const imgEl = document.querySelector(`img[src*="${imageUuid}"]`) as HTMLElement | null;
      if (imgEl) {
        console.log(`[${tag}] Found image UUID ${imageUuid.substring(0, 8)}... at scroll step ${step}`);
        return imgEl;
      }

      container.scrollTop += stepSize;
      await delayFn(500);

      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 10) {
        const lastCheck = document.querySelector(`img[src*="${imageUuid}"]`) as HTMLElement | null;
        if (lastCheck) return lastCheck;
        break;
      }
    }

    console.log(`[${tag}] Image UUID ${imageUuid.substring(0, 8)}... not found after scrolling`);
    return null;
  },

  /** Hover over ancestor elements to reveal toolbar overlay on a gallery tile. */
  hoverAncestors(el: HTMLElement, levels: number = 5): void {
    const targets: HTMLElement[] = [];
    let current: HTMLElement | null = el;
    for (let i = 0; i < levels && current; i++) {
      current = current.parentElement;
      if (current) targets.push(current);
    }
    for (const target of targets) {
      target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    }
  },

  /** Find the "More" (more_vert) toolbar button near an image element. */
  findMoreButton(img: HTMLElement): HTMLButtonElement | null {
    // Primary: find in [role="toolbar"]
    let searchRoot: Element | null = img;
    for (let i = 0; i < 6 && searchRoot; i++) {
      searchRoot = searchRoot.parentElement;
      if (searchRoot) {
        const toolbar = searchRoot.querySelector('[role="toolbar"]');
        if (toolbar) {
          const buttons = toolbar.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent?.includes('more_vert')) {
              return btn as HTMLButtonElement;
            }
          }
        }
      }
    }
    // Fallback: search without toolbar constraint
    searchRoot = img;
    for (let i = 0; i < 8 && searchRoot; i++) {
      searchRoot = searchRoot.parentElement;
      if (searchRoot) {
        const buttons = searchRoot.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent?.includes('more_vert') && btn.textContent?.includes('More')) {
            return btn as HTMLButtonElement;
          }
        }
      }
    }
    return null;
  },

  /** Check if an image UUID is already added as an ingredient (chip in prompt bar). */
  isImageAlreadyAdded(uuid: string): boolean {
    return !!document.querySelector(`button img[alt*="piece of media"][src*="${uuid}"]`);
  },

  /**
   * Full "Add to Prompt" flow: find image → hover → More button → menu → Add to Prompt.
   * Shared by both VideoFlowController and ImageFlowController.
   */
  async addImageToPrompt(
    imageUuid: string,
    waitForFn: (condition: () => boolean, name: string, timeoutMs: number) => Promise<void>,
    delayFn: (ms: number) => Promise<void>,
    confirmTimeoutMs: number = 10000,
    tag: string = 'FlowUI',
  ): Promise<void> {
    console.log(`[${tag}] Adding image ${imageUuid.substring(0, 8)}... to prompt via gallery`);
    await delayFn(300);

    // Find image (scroll if virtualized)
    const img = await FlowUIActions.scrollToFindImage(imageUuid, delayFn, tag);
    if (!img) throw new Error(`Gallery image not found for UUID: ${imageUuid}`);

    // Skip if already added
    if (FlowUIActions.isImageAlreadyAdded(imageUuid)) {
      console.log(`[${tag}] Image ${imageUuid.substring(0, 8)}... already added as ingredient, skipping`);
      return;
    }

    // Hover to reveal toolbar
    FlowUIActions.hoverAncestors(img);
    await delayFn(300);

    // Find and click "More" button
    const moreBtn = FlowUIActions.findMoreButton(img);
    if (!moreBtn) throw new Error(`"More" button not found in toolbar for image UUID: ${imageUuid}`);

    FlowUIActions.dispatchSyntheticClick(moreBtn);
    console.log(`[${tag}] Clicked More button for image ${imageUuid.substring(0, 8)}...`);

    // Wait for dropdown menu with "Add to Prompt" menuitem
    let addMenuItem: HTMLElement | null = null;
    await waitForFn(
      () => {
        const menuItems = document.querySelectorAll('[role="menuitem"]');
        for (const item of menuItems) {
          if (item.textContent?.includes('Add to Prompt')) {
            addMenuItem = item as HTMLElement;
            return true;
          }
        }
        return false;
      },
      `"Add to Prompt" menuitem for image ${imageUuid.substring(0, 8)}`,
      5000
    );

    if (!addMenuItem) throw new Error(`"Add to Prompt" menuitem not found for image UUID: ${imageUuid}`);

    // Click the menuitem
    FlowUIActions.dispatchSyntheticClick(addMenuItem);
    console.log(`[${tag}] Clicked "Add to Prompt" for image ${imageUuid.substring(0, 8)}...`);

    // Wait for confirmation (ingredient chip appears in prompt bar)
    await waitForFn(
      () => FlowUIActions.isImageAlreadyAdded(imageUuid),
      `ingredient chip for image ${imageUuid.substring(0, 8)}`,
      confirmTimeoutMs,
    );
    await delayFn(500);
    console.log(`[${tag}] Added image ${imageUuid.substring(0, 8)} to prompt`);
  },
};

class VideoFlowController {
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
  private progressCallback: ((event: VideoProgressEvent) => void) | null = null;
  private stepConfig: Record<string, StepRetryConfig>;

  /**
   * When true, video downloads are intercepted and saved to the ShopEnginX/ subfolder
   * via chrome.downloads API instead of using the browser's default download location.
   * Default: false (existing behavior unchanged).
   */
  public downloadToFolder: boolean = false;

  // Generation retry configuration
  private static readonly GENERATION_MAX_RETRIES = 5; // 6 total attempts
  private static readonly GENERATION_RETRY_DELAY_MS = 5000; // 5 seconds

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
    this.startDebugObserver();
  }

  // ==================== Debug MutationObserver ====================

  private startDebugObserver(): void {
    if (this.debugObserver) return;

    this.debugObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        // Log added elements — video-specific focus
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) {
            const el = node as HTMLElement;
            const tag = el.tagName;
            const role = el.getAttribute('role');
            const text = el.textContent?.substring(0, 80)?.replace(/\s+/g, ' ');

            // Video elements appearing (new video rendered)
            if (tag === 'VIDEO') {
              const src = el.getAttribute('src')?.substring(0, 50);
              console.log(`[Video-DOM+] <VIDEO> src="${src}"`);
              continue;
            }

            // Video tile links with progress (e.g. "videocam 7% prompt text")
            if (tag === 'A' && text && (text.includes('videocam') || text.match(/\d{1,3}%/))) {
              console.log(`[Video-DOM+] <A> "${text}"`);
              continue;
            }

            // Generation failure / success indicators
            if (text && (
              text.includes('Failed') || text.includes('warning') ||
              text.includes('Retry') || text.includes('Reuse Prompt') ||
              text.includes('Add to scene') || text.includes('play_circle') ||
              text.includes('Extend') || text.includes('Generating')
            )) {
              console.log(`[Video-DOM+] <${tag} role="${role}"> "${text}"`);
              continue;
            }

            // Dialogs (Notice, agreement, etc.)
            if (role === 'dialog' || role === 'menu') {
              console.log(`[Video-DOM+] <${tag} role="${role}"> "${text}"`);
            }
          }
        }

        // Log removed video elements
        for (const node of m.removedNodes) {
          if (node.nodeType === 1) {
            const el = node as HTMLElement;
            const tag = el.tagName;
            const role = el.getAttribute('role');
            if (tag === 'VIDEO') {
              console.log(`[Video-DOM-] <VIDEO> removed`);
            } else if (role === 'dialog' || role === 'menu') {
              console.log(`[Video-DOM-] <${tag} role="${role}"> removed`);
            }
          }
        }

        // Track characterData changes — percentage progress updates
        if (m.type === 'characterData') {
          const text = m.target.textContent?.trim() || '';
          if (text.match(/^\d{1,3}$/) || text.match(/^\d{1,3}%$/)) {
            console.log(`[Video-DOM~] Percentage: ${text}`);
          }
        }
      }
    });

    this.debugObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: ['data-state', 'aria-expanded']
    });
    console.log('[VideoFlowController] Debug observer started');
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
   * Report generation retry progress
   */
  private reportGenerationRetry(phase: 'initial' | 'extension', attempt: number, maxAttempts: number, error: string): void {
    this.reportProgress({
      step: phase === 'initial' ? 'waitForInitialComplete' : 'waitForExtensionComplete',
      attempt,
      maxAttempts,
      status: 'retrying',
      error: `Generation failed, retrying (${attempt}/${maxAttempts}): ${error}`
    });
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
    this.stopDebugObserver();
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
   * Step: Create a new project by clicking "+ New project" button
   * Must be on the Flow homepage (https://labs.google/fx/tools/flow)
   */
  async createNewProject(): Promise<void> {
    const config = this.stepConfig['createNewProject'];

    // Sidebar navigates to Flow homepage via chrome.tabs.update() before sending message.
    // Content script must NOT use window.location.href — it kills the script.

    // Wait for the Flow homepage to load (New project button appears)
    await this.waitFor(
      () => findButtonByText('New project') !== null,
      'Flow homepage loaded',
      config.timeoutMs
    );
    await this.delay(1000);

    // Find the "+ New project" button (contains "New project" text)
    const newProjectBtn = findButtonByText('New project');
    if (!newProjectBtn) throw new Error('New project button not found');

    newProjectBtn.click();
    console.log('[VideoFlowController] Clicked New project button');

    // Wait for navigation to new project page (URL changes to /project/{uuid})
    await this.waitFor(
      () => /\/project\/[0-9a-f-]+$/.test(window.location.pathname),
      'new project page loaded',
      config.timeoutMs
    );

    // Wait for the prompt textbox to appear (page fully loaded)
    await this.waitFor(
      () => document.querySelector('textarea, input[type="text"]') !== null,
      'prompt textbox visible',
      config.timeoutMs
    );

    await this.delay(1000); // Let UI settle
    console.log('[VideoFlowController] New project created:', window.location.href);
  }

  /**
   * Step: Ensure we're in "Frames to Video" mode
   */
  async ensureVideoMode(): Promise<void> {
    const result = await configureFlowSettings({ mode: 'videocam' }, 'VideoFlow');
    if (!result?.success) {
      throw new Error(`Switch to video mode failed: ${result?.error || 'unknown'}`);
    }
    if (result.results?.mode === false) {
      throw new Error('Switch to video mode: tab click did not activate videocam mode');
    }
    console.log('[VideoFlowController] Switched to Frames to Video mode via Main World');
    await this.delay(300);
  }

  /**
   * Step: Configure settings (aspect ratio + output count) via Radix config popper
   */
  async configureSettings(aspectRatio: '9:16' | '16:9', outputCount: number): Promise<void> {
    const result = await configureFlowSettings({ aspectRatio, imageCount: outputCount }, 'VideoFlow');
    if (!result?.success) {
      throw new Error(`Configure video settings failed: ${result?.error || 'unknown'}`);
    }
    const r = result.results || {};
    if (r.ratio === false || r.count === false) {
      throw new Error(`Configure video settings: partial failure (ratio=${r.ratio}, count=${r.count})`);
    }
    console.log('[VideoFlowController] Settings configured via Main World:', result.results);
    await this.delay(300);
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

  // ─── "Add To Prompt" flow methods ──────────────────────

  /**
   * Step: Switch to Images tab in the gallery
   */
  async switchToImagesTab(): Promise<void> {
    // Check if already on Images tab (aria-checked="true")
    const alreadyActive = document.querySelector('button[role="radio"][aria-checked="true"]');
    if (alreadyActive?.textContent?.includes('Images')) {
      console.log('[VideoFlowController] Images tab already active, skipping');
      return;
    }

    // Check if Images radio exists at all — Flow UI may not have tabs in some views
    const imagesRadio = findByText('[role="radio"]', 'Images');
    if (!imagesRadio) {
      console.log('[VideoFlowController] Images tab radio not found, assuming images already visible');
      return;
    }

    imagesRadio.click();

    // Wait for the tab to become active (short timeout — it's just a UI toggle)
    try {
      await this.waitFor(
        () => {
          const active = document.querySelector('button[role="radio"][aria-checked="true"]');
          return active?.textContent?.includes('Images') ?? false;
        },
        'Images tab active',
        5000
      );
    } catch {
      console.log('[VideoFlowController] Images tab activation timed out, continuing anyway');
    }
    await this.delay(500);
    console.log('[VideoFlowController] Switched to Images tab');
  }

  /**
   * Step: Find gallery image by UUID and click "Add To Prompt"
   */
  async clickAddToPromptByUuid(uuid: string): Promise<void> {
    const config = this.stepConfig['clickAddToPromptByUuid'];
    await FlowUIActions.addImageToPrompt(
      uuid,
      (condition, name, timeout) => this.waitFor(condition, name, timeout),
      (ms) => this.delay(ms),
      config.timeoutMs,
      'VideoFlowController',
    );
  }

  /**
   * Step: Remove current ingredient from prompt
   */
  async clickRemoveFromPrompt(): Promise<void> {
    const config = this.stepConfig['clickRemoveFromPrompt'];

    // Wait for "Remove From Prompt" button to appear
    await this.waitFor(
      () => findButtonByText('Remove From Prompt') !== null,
      'Remove From Prompt button visible',
      config.timeoutMs
    );

    const removeBtn = findButtonByText('Remove From Prompt');
    if (!removeBtn) throw new Error('"Remove From Prompt" button not found');
    removeBtn.click();

    // Wait for the button to revert to "Add To Prompt" (confirms removal)
    await this.waitFor(
      () => findButtonByText('Remove From Prompt') === null,
      'ingredient removed',
      config.timeoutMs
    );
    await this.delay(500);
    console.log('[VideoFlowController] Removed image from prompt');
  }

  /**
   * Step: Switch the mode dropdown to "Frames to Video"
   */
  async switchToFramesToVideo(): Promise<void> {
    const result = await configureFlowSettings({ mode: 'videocam' }, 'VideoFlow');
    if (!result?.success) {
      throw new Error(`Switch to Frames to Video failed: ${result?.error || 'unknown'}`);
    }
    if (result.results?.mode === false) {
      throw new Error('Switch to Frames to Video: tab click did not activate videocam mode');
    }
    console.log('[VideoFlowController] Switched to Frames to Video mode via Main World');
    await this.delay(300);
  }

  /**
   * Switch to Videos tab in the gallery (the radio with "Videos" text)
   */
  async switchToVideosTab(): Promise<void> {
    // Old UI used [role="radio"] tabs for Images/Videos switching — those are gone.
    // New UI may use gallery filter buttons (e.g. "videocam View videos").
    // Try the new pattern first, fall back to old pattern, then soft-fail.

    // Try new gallery filter button pattern
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      const text = (btn.textContent || '').toLowerCase();
      if ((text.includes('video') && (text.includes('view') || text.includes('filter'))) ||
          text === 'videocam' || text.includes('view videos')) {
        (btn as HTMLElement).click();
        await this.delay(500);
        console.log('[VideoFlowController] Switched to Videos view via gallery filter button');
        return;
      }
    }

    // Try legacy [role="radio"] pattern
    const videosRadio = findByText('[role="radio"]', 'Videos');
    if (videosRadio) {
      videosRadio.click();
      await this.delay(500);
      console.log('[VideoFlowController] Switched to Videos tab via radio button');
      return;
    }

    // Soft-fail: UI may not have a separate Videos tab anymore
    console.log('[VideoFlowController] Videos tab/filter not found — continuing without switching (UI may have changed)');
  }

  /**
   * Find the gallery scroll container by structural properties.
   * The gallery uses a virtualized list inside a div with overflow:auto
   * that contains <video> elements. We detect it structurally to avoid
   * relying on styled-components class hashes that may change between builds.
   */
  private findGalleryScrollContainer(): HTMLElement | null {
    const allDivs = document.querySelectorAll('div');
    for (const el of allDivs) {
      const style = getComputedStyle(el);
      const isScrollable = style.overflow === 'auto' || style.overflow === 'scroll' ||
                            style.overflowY === 'auto' || style.overflowY === 'scroll';
      if (isScrollable && el.scrollHeight > el.clientHeight + 100 && (el as HTMLElement).clientHeight > 200) {
        if (el.querySelectorAll('video').length > 0) {
          return el as HTMLElement;
        }
      }
    }
    return null;
  }

  /**
   * Scroll the gallery incrementally to find a specific video UUID.
   * The gallery is virtualized — only 2-3 <video> elements exist in DOM at a time.
   * We scroll step-by-step (70% of viewport per step) and check at each position.
   * Returns the found <video> element or null.
   */
  private async scrollToFindVideoByUuid(videoUuid: string): Promise<HTMLElement | null> {
    const container = this.findGalleryScrollContainer();
    if (!container) {
      console.warn('[VideoFlowController] Gallery scroll container not found');
      return null;
    }

    const clientHeight = container.clientHeight;
    const stepSize = Math.floor(clientHeight * 0.7);
    const maxSteps = Math.ceil(container.scrollHeight / stepSize) + 2;

    // Start from top
    container.scrollTop = 0;
    await this.delay(300);

    for (let step = 0; step < maxSteps; step++) {
      const videoEl = document.querySelector(`video[src*="${videoUuid}"]`) as HTMLElement | null;
      if (videoEl) {
        console.log(`[VideoFlowController] Found video UUID ${videoUuid.substring(0, 8)}... at scroll step ${step} (scrollTop: ${Math.round(container.scrollTop)})`);
        return videoEl;
      }

      // Not found at this position — scroll down
      container.scrollTop += stepSize;
      await this.delay(500);

      // Check if we've reached the bottom
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 10) {
        // One final check at bottom position
        const lastCheck = document.querySelector(`video[src*="${videoUuid}"]`) as HTMLElement | null;
        if (lastCheck) {
          console.log(`[VideoFlowController] Found video UUID ${videoUuid.substring(0, 8)}... at bottom`);
          return lastCheck;
        }
        break;
      }
    }

    console.log(`[VideoFlowController] Video UUID ${videoUuid.substring(0, 8)}... not found after scrolling entire gallery`);
    return null;
  }

  /**
   * Search the DOM for a video clip matching the prompt snippet.
   * Returns the found prompt element or null.
   */
  private findVideoPromptElement(promptSnippet: string): HTMLElement | null {
    const allElements = document.querySelectorAll('button, div, span, p');
    for (const el of allElements) {
      const t = (el.textContent || '').trim();
      if (t.length > 40 && t.length < 600 && t.includes(promptSnippet)) {
        return el as HTMLElement;
      }
    }
    return null;
  }

  /**
   * Find a video clip in the gallery by its UUID, then click "Add to scene".
   * The gallery is virtualized — only 2-3 videos exist in DOM at a time —
   * so we incrementally scroll to find the target video element.
   * Returns: 'redirected' | 'added' | 'already' | 'not_found'
   */
  async addVideoToSceneByUuid(videoUuid: string): Promise<'redirected' | 'added' | 'already' | 'not_found' | 'needs_resize'> {
    console.log(`[VideoFlowController] Looking for video with UUID: ${videoUuid.substring(0, 8)}...`);

    // At <768px, scene buttons are hidden via CSS media query
    if (window.innerWidth < 768) {
      console.log(`[VideoFlowController] Viewport too narrow (${window.innerWidth}px), requesting resize.`);
      return 'needs_resize';
    }

    // Incrementally scroll the virtualized gallery to find the video
    const videoEl = await this.scrollToFindVideoByUuid(videoUuid);

    if (!videoEl) {
      console.log(`[VideoFlowController] Video element not found for UUID: ${videoUuid}`);
      return 'not_found';
    }

    // Find "Add to scene" / "Remove from scene" button near this video
    let addBtn: HTMLButtonElement | null = null;
    let alreadyAdded = false;

    let searchRoot: Element | null = videoEl;
    for (let depth = 0; depth < 15 && searchRoot; depth++) {
      searchRoot = searchRoot.parentElement;
      if (searchRoot) {
        const btns = searchRoot.querySelectorAll('button');
        for (const btn of btns) {
          const btnText = btn.textContent || '';
          if (btnText.includes('Remove from scene')) {
            alreadyAdded = true;
            break;
          }
          if (btnText.includes('Add to scene')) {
            if (!addBtn || btn.classList.contains('sc-19ee82ba-2')) {
              addBtn = btn as HTMLButtonElement;
            }
          }
        }
        if (alreadyAdded || addBtn) break;
      }
    }

    if (alreadyAdded) {
      console.log('[VideoFlowController] Video already in scene, skipping');
      return 'already';
    }

    if (!addBtn) {
      console.warn(`[VideoFlowController] Found video element but no "Add to scene" button`);
      return 'not_found';
    }

    // Use CSS override + synthetic events (validated via Playwright)
    this.simulateRealClick(addBtn);
    console.log('[VideoFlowController] Clicked "Add to scene" for video', videoUuid.substring(0, 8));

    // Wait to see if page redirects to scenebuilder (first add) or stays (subsequent adds)
    await this.delay(2000);

    if (window.location.href.includes('/scenes/')) {
      await this.delay(1000);
      console.log('[VideoFlowController] Redirected to scenebuilder');
      return 'redirected';
    } else {
      // Subsequent add — stayed on project page
      await this.delay(1000);
      console.log('[VideoFlowController] Added to scene (stayed on project page)');
      return 'added';
    }
  }

  /**
   * Navigate back from scenebuilder to the project page (for adding more clips).
   * Uses breadcrumb click: Flow > [Project Name] > Scenebuilder
   * We click the project name button (middle breadcrumb item).
   */
  async navigateBackToProject(): Promise<void> {
    if (!window.location.href.includes('/scenes/')) {
      console.log('[VideoFlowController] Already on project page');
      return;
    }

    // Find breadcrumb list and click the project name button (not "Flow", not "Scenebuilder")
    const breadcrumbButtons = Array.from(document.querySelectorAll('li button, [role="listitem"] button'));
    let projectBtn: HTMLButtonElement | null = null;
    for (const btn of breadcrumbButtons) {
      const text = (btn.textContent || '').trim();
      // Project name button contains a date pattern or is between Flow and Scenebuilder
      if (text && !text.includes('Scenebuilder') && !text.includes('Flow') && !text.includes('Edit project') && !text.includes('Delete')) {
        projectBtn = btn as HTMLButtonElement;
        break;
      }
    }

    if (!projectBtn) {
      // Fallback: use URL manipulation
      console.log('[VideoFlowController] Breadcrumb not found, falling back to URL navigation');
      const projectUrl = window.location.href.replace(/\/scenes\/.*$/, '');
      window.location.href = projectUrl;
    } else {
      console.log(`[VideoFlowController] Clicking breadcrumb: "${projectBtn.textContent?.trim()}"`);
      projectBtn.click();
    }

    // Wait for project page to load (URL no longer has /scenes/)
    await this.waitFor(
      () => !window.location.href.includes('/scenes/'),
      'project page loaded',
      15000
    );
    await this.delay(2000);
    console.log('[VideoFlowController] Back on project page');
  }

  /**
   * Click a button using simple .click().
   * content-main.ts now runs in the MAIN world, so .click() works natively.
   */
  private simulateRealClick(button: HTMLButtonElement): void {
    button.click();
  }

  /**
   * Lightweight version: find video by UUID, click "Add to scene" using synthetic events.
   * Returns: { status: 'clicked' | 'already' | 'not_found' | 'needs_resize' }
   *
   * If viewport < 768px, scene buttons are hidden via CSS media query and cannot be
   * made functional. Returns 'needs_resize' so the sidebar can widen the window.
   */
  async clickAddToSceneByUuid(videoUuid: string): Promise<{ status: 'clicked' | 'already' | 'not_found' | 'needs_resize' }> {
    console.log(`[VideoFlowController] clickAddToSceneByUuid: looking for ${videoUuid.substring(0, 8)}...`);

    // Check if viewport is wide enough for scene buttons to work.
    // At <768px, @media (max-width: 768px) sets display:none on scene buttons
    // AND hides the "Scenebuilder" breadcrumb. Sidebar must resize window first.
    if (window.innerWidth < 768) {
      console.log(`[VideoFlowController] Viewport too narrow (${window.innerWidth}px < 768px), scene buttons hidden. Requesting resize.`);
      return { status: 'needs_resize' };
    }

    // Incrementally scroll to find the video
    const videoEl = await this.scrollToFindVideoByUuid(videoUuid);
    if (!videoEl) {
      console.log(`[VideoFlowController] Video not found: ${videoUuid.substring(0, 8)}...`);
      return { status: 'not_found' };
    }

    // Find "Add to scene" / "Remove from scene" button near this video.
    // Walk up the DOM from the video element to find the card container, then search buttons.
    let addBtn: HTMLButtonElement | null = null;
    let alreadyAdded = false;

    // Search upward from video element to find the card and its buttons
    let searchRoot: Element | null = videoEl;
    for (let depth = 0; depth < 15 && searchRoot; depth++) {
      searchRoot = searchRoot.parentElement;
      if (searchRoot) {
        const btns = searchRoot.querySelectorAll('button');
        for (const btn of btns) {
          const btnText = btn.textContent || '';
          if (btnText.includes('Remove from scene')) {
            alreadyAdded = true;
            break;
          }
          if (btnText.includes('Add to scene')) {
            // Prefer the Type-2 (round) button — it becomes visible at >768px viewport.
            // Type-1 (pill) stays display:none even at 1024px.
            if (!addBtn || btn.classList.contains('sc-19ee82ba-2')) {
              addBtn = btn as HTMLButtonElement;
            }
          }
        }
        if (alreadyAdded || addBtn) break;
      }
    }

    if (alreadyAdded) {
      console.log(`[VideoFlowController] Video ${videoUuid.substring(0, 8)}... already in scene`);
      return { status: 'already' };
    }

    if (!addBtn) {
      console.warn(`[VideoFlowController] Found video but no "Add to scene" button for ${videoUuid.substring(0, 8)}...`);
      return { status: 'not_found' };
    }

    // Use CSS override + synthetic events to click the button
    this.simulateRealClick(addBtn);
    console.log(`[VideoFlowController] Clicked "Add to scene" for ${videoUuid.substring(0, 8)}... via synthetic events`);

    // Brief wait then verify the button changed to "Remove from scene"
    await this.delay(2000);
    const btnTextAfter = addBtn.textContent || '';
    if (btnTextAfter.includes('Remove from scene')) {
      console.log(`[VideoFlowController] Confirmed: button changed to "Remove from scene"`);
    } else {
      console.warn(`[VideoFlowController] Button text after click: "${btnTextAfter}" — may not have registered`);
    }

    return { status: 'clicked' };
  }

  /**
   * Navigate TO scenebuilder from the project page.
   * Looks for "Scenebuilder" button/link in breadcrumb or page, then waits for URL.
   * If already on scenebuilder, returns immediately.
   * Throws 'NEEDS_RESIZE' if viewport <768px (breadcrumb hidden by media query).
   */
  async navigateToScenebuilder(): Promise<void> {
    if (window.location.href.includes('/scenes/')) {
      console.log('[VideoFlowController] Already on scenebuilder page');
      return;
    }

    // At <768px, "Scenebuilder" breadcrumb is hidden by CSS media query
    if (window.innerWidth < 768) {
      throw new Error('NEEDS_RESIZE');
    }

    // Look for "Scenebuilder" text in buttons or links on the page
    const allClickables = Array.from(document.querySelectorAll('button, a, [role="tab"], [role="link"], li button, [role="listitem"] button'));
    let scenebuilderEl: HTMLElement | null = null;
    for (const el of allClickables) {
      const text = (el.textContent || '').trim();
      if (text === 'Scenebuilder' || text === 'Scene builder') {
        scenebuilderEl = el as HTMLElement;
        break;
      }
    }

    if (scenebuilderEl) {
      console.log(`[VideoFlowController] Clicking Scenebuilder element: "${scenebuilderEl.textContent?.trim()}"`);
      scenebuilderEl.click();
    } else {
      // Fallback: look for any link/anchor with href containing /scenes/
      const sceneLink = document.querySelector('a[href*="/scenes/"]') as HTMLAnchorElement | null;
      if (sceneLink) {
        console.log(`[VideoFlowController] Clicking scene link: ${sceneLink.href}`);
        sceneLink.click();
      } else {
        throw new Error('Cannot find Scenebuilder navigation element on project page');
      }
    }

    // Wait for URL to contain /scenes/
    await this.waitFor(
      () => window.location.href.includes('/scenes/'),
      'navigate to scenebuilder',
      15000
    );
    await this.delay(2000); // Wait for scenebuilder to fully load
    console.log('[VideoFlowController] Navigated to scenebuilder');
  }

  /**
   * Navigate to scenebuilder and download the scene video.
   * Used after all videos have been added to scene.
   * Returns { success, needsResize, error } so sidebar can resize window if needed.
   *
   * Flow:
   *  1. Navigate to scenebuilder (click breadcrumb)
   *  2. Click toolbar "Download" button → triggers video export
   *  3. Wait for "Video exported!" notification toast
   *  4. Click the <a>Download</a> link inside the notification → actual file download
   */
  async navigateAndDownloadSceneVideo(): Promise<{ success: boolean; needsResize?: boolean; error?: string }> {
    try {
      // Step 1: Ensure we're on the scenebuilder page
      await this.navigateToScenebuilder();

      // Step 2: Wait for scenebuilder to fully load (download button to appear)
      await this.delay(3000);

      // Step 3: Find and click the toolbar Download button (triggers export)
      const downloadBtn = Array.from(document.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('Download') && !btn.textContent?.includes('Flip')
      ) as HTMLButtonElement | undefined;

      if (!downloadBtn) {
        console.warn('[VideoFlowController] Download button not found in scenebuilder');
        return { success: false, error: 'Download button not found in scenebuilder' };
      }

      console.log('[VideoFlowController] Clicking Download button in scenebuilder (triggers export)');
      downloadBtn.click();

      // Step 4: Wait for "Video exported!" notification toast (can take up to 2 min)
      const exportTimeout = this.stepConfig['downloadVideo']?.timeoutMs ?? 120000;
      console.log(`[VideoFlowController] Waiting for "Video exported!" notification (timeout: ${exportTimeout}ms)`);
      await this.waitFor(
        () => findByText('[data-sonner-toast]', 'Video exported') !== null,
        'Video exported notification',
        exportTimeout
      );
      console.log('[VideoFlowController] Export complete, notification appeared');

      // Step 5: Download the video from the notification
      const notification = findByText('[data-sonner-toast]', 'Video exported');
      if (notification) {
        const downloadLink = notification.querySelector('a') as HTMLAnchorElement | null;
        if (downloadLink) {
          if (this.downloadToFolder) {
            // Arm background to redirect next .mp4 download to ShopEnginX/, then click
            console.log('[VideoFlowController] Arming download redirect to ShopEnginX/');
            await this.armAndClickDownload(downloadLink);
          } else {
            // Default: just click (downloads to browser default location)
            console.log('[VideoFlowController] Clicking Download link in export notification');
            downloadLink.click();
          }
          await this.delay(3000);
        } else {
          console.warn('[VideoFlowController] No download link found in export notification');
        }

        // Dismiss the notification
        const dismissBtn = notification.querySelector('button');
        if (dismissBtn) {
          dismissBtn.click();
          console.log('[VideoFlowController] Dismissed export notification');
        }
      }

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg === 'NEEDS_RESIZE') {
        console.log('[VideoFlowController] Viewport too narrow for scenebuilder navigation');
        return { success: false, needsResize: true };
      }
      console.error('[VideoFlowController] Navigate and download scene video failed:', errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Add all generated videos to scenebuilder in scene order.
   * Matches each video by its UUID (from <video src>) and clicks "Add to scene".
   * Returns notFoundUuids so the sidebar can refresh the page and retry.
   */
  async addAllVideosToSceneInOrder(videoUuidsInOrder: string[]): Promise<{ success: boolean; addedCount: number; skipped: number; notFoundUuids: string[]; error?: string }> {
    let addedCount = 0;
    let skipped = 0;
    const notFoundUuids: string[] = [];

    try {
      // Switch to Videos tab to see generated videos
      await this.switchToVideosTab();

      for (let i = 0; i < videoUuidsInOrder.length; i++) {
        const uuid = videoUuidsInOrder[i];

        console.log(`[VideoFlowController] Adding video ${i + 1}/${videoUuidsInOrder.length} to scene (UUID: ${uuid.substring(0, 8)}...)`);

        this.reportProgress({
          step: 'addVideoToSceneByUuid',
          attempt: 1,
          maxAttempts: 1,
          status: 'running',
          promptIndex: i,
          totalPrompts: videoUuidsInOrder.length,
        });

        try {
          const result = await this.addVideoToSceneByUuid(uuid);

          if (result === 'not_found') {
            console.warn(`[VideoFlowController] Video ${i + 1} not found in DOM (UUID: ${uuid.substring(0, 8)}...)`);
            notFoundUuids.push(uuid);
            skipped++;
          } else if (result === 'already') {
            console.log(`[VideoFlowController] Video ${i + 1} already in scene`);
            addedCount++;
          } else {
            addedCount++;

            // Navigate back if we were redirected to scenebuilder (first add)
            if (result === 'redirected' && i < videoUuidsInOrder.length - 1) {
              await this.navigateBackToProject();
              // After navigating back, switch to videos tab (addVideoToSceneByUuid handles its own scrolling)
              await this.switchToVideosTab();
            }
            // If 'added' (stayed on project page), no navigation needed
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[VideoFlowController] Error adding video ${i + 1}: ${msg}`);
          notFoundUuids.push(uuid);
          skipped++;
          // If we ended up in scenebuilder, navigate back
          if (window.location.href.includes('/scenes/') && i < videoUuidsInOrder.length - 1) {
            await this.navigateBackToProject();
            await this.switchToVideosTab();
          }
        }
      }

      console.log(`[VideoFlowController] Done: ${addedCount} added, ${skipped} skipped, ${notFoundUuids.length} not found out of ${videoUuidsInOrder.length}`);
      return { success: addedCount > 0, addedCount, skipped, notFoundUuids };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[VideoFlowController] Add videos to scene failed after ${addedCount}/${videoUuidsInOrder.length}:`, errorMsg);
      return { success: false, addedCount, skipped, notFoundUuids, error: errorMsg };
    }
  }

  /**
   * Step: Fill the video prompt
   */
  async fillPrompt(prompt: string): Promise<void> {
    const config = this.stepConfig['fillPrompt'];

    // Wait for UI to be fully ready before interacting with prompt
    await this.delay(1000);

    // Fill the Slate editor directly (MAIN world — Phase 2)
    fillPromptViaSlateFiber(prompt);
    await this.delay(500);

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
   * Capture video UUIDs from <video> elements currently in the DOM.
   * Video src pattern: https://storage.googleapis.com/ai-sandbox-videofx/video/{UUID}?...
   */
  captureVideoUuids(): string[] {
    const videos = document.querySelectorAll('video[src]');
    const uuids: string[] = [];
    const uuidRegex = /video\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;

    for (const v of videos) {
      const src = v.getAttribute('src') || '';
      const match = src.match(uuidRegex);
      if (match) {
        uuids.push(match[1]);
      }
    }

    console.log(`[VideoFlowController] Captured ${uuids.length} video UUID(s):`, uuids);
    return uuids;
  }

  /**
   * Step: Wait for initial video generation to complete
   */
  async waitForInitialCompletion(): Promise<void> {
    const config = this.stepConfig['waitForInitialComplete'];

    // Use flowVideoTracker for reliable MutationObserver-based completion detection
    // Start tracker if not already active
    if (!flowVideoTracker.isActive()) {
      flowVideoTracker.start();
    }

    // Wait for video completion using the generalized tracker
    // expectedCount = 1 for initial generation (single video)
    try {
      const newUUIDs = await flowVideoTracker.waitForNewImages(1, config.timeoutMs);
      console.log('[VideoFlowController] Initial generation complete, new video UUIDs:', newUUIDs);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log('[VideoFlowController] waitForInitialCompletion failed:', errorMsg);
      throw new Error(`Generation failed: ${errorMsg}`);
    }
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
   * Helper: Get timeline clips without relying on class names
   * Uses semantic anchor (button) and structural filtering
   */
  private getTimelineClips(): HTMLElement[] {
    // 1. Find semantic anchor
    const addClipBtn = findButtonByText('Add clip after last clip');
    if (!addClipBtn) return [];

    // 2. Navigate to timeline container (sibling of button)
    const timelineContainer = addClipBtn.parentElement?.children[0] as HTMLElement;
    if (!timelineContainer) return [];

    // 3. Filter clips: DIV children without slider
    return Array.from(timelineContainer.children).filter(child => {
      return child.tagName === 'DIV' && !child.querySelector('[role="slider"]');
    }) as HTMLElement[];
  }

  /**
   * Step: Enter extend mode via "Add clip after last clip" menu
   * @param aspectRatio - Aspect ratio to configure after entering extend mode
   * @param outputCount - Output count to configure after entering extend mode
   */
  async enterExtendMode(aspectRatio?: '9:16' | '16:9', outputCount?: number): Promise<void> {
    const config = this.stepConfig['enterExtendMode'];

    // Wait for timeline clips to be visible
    await this.waitFor(
      () => this.getTimelineClips().length > 0,
      'timeline clips visible',
      config.timeoutMs
    );

    // Select the last clip
    const clips = this.getTimelineClips();
    if (clips.length > 0) {
      const lastClip = clips[clips.length - 1];
      lastClip.click();
      console.log(`[VideoFlowController] Selected last clip (${clips.length} total)`);
      await this.delay(300);
    }

    // Wait for "Add clip after last clip" button to be available
    await this.waitFor(
      () => findButtonByText('Add clip after last clip') !== null,
      'Add clip button visible',
      config.timeoutMs
    );

    // Click "Add clip after last clip" button
    const addClipBtn = findButtonByText('Add clip after last clip');
    if (!addClipBtn) throw new Error('Add clip button not found');

    await this.delay(1000); // Wait for SceneBuilder UI to be fully interactive
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
   * @param expectedClipCount - Expected number of clips after generation completes
   */
  async waitForExtensionCompletion(expectedClipCount?: number): Promise<void> {
    const config = this.stepConfig['waitForExtensionComplete'];

    // Step 1: Wait for percentage to disappear (generation finished or failed)
    await this.waitFor(
      () => {
        const allText = document.body.innerText || '';
        const hasPercentage = /\d{1,3}%/.test(allText);
        return !hasPercentage;
      },
      'generation percentage to disappear',
      config.timeoutMs
    );

    // Step 2: Delay to let UI render result
    await this.delay(1000);

    // Step 3: Check we're still in scenebuilder (not error state)
    if (!window.location.href.includes('/scenes/')) {
      throw new Error('Extension generation failed - navigated away from scenebuilder');
    }

    // Step 4: Check for success indicator - clip count must have increased
    if (expectedClipCount !== undefined) {
      const currentClips = this.getTimelineClips().length;
      if (currentClips < expectedClipCount) {
        throw new Error(`Extension generation failed - expected ${expectedClipCount} clips but found ${currentClips}`);
      }
    }

    const finalClipCount = this.getTimelineClips().length;
    console.log(`[VideoFlowController] Extension complete (${finalClipCount} clips)`);
  }

  /**
   * Arm the background script to redirect the next .mp4 download to ShopEnginX/ subfolder,
   * then click the download link. The background's onDeterminingFilename listener handles
   * the actual filename redirect — no need to capture data URIs or use MAIN world scripts.
   */
  private async armAndClickDownload(downloadLink: HTMLAnchorElement): Promise<void> {
    try {
      // Arm handled via bridge — send progress via postMessage instead
      window.postMessage({
        __shopEnginX__: true,
        source: 'shopenginx-main',
        type: 'PROGRESS',
        action: 'armDownloadToFolder',
        payload: {},
      }, '*');
      await new Promise(resolve => setTimeout(resolve, 100));
      console.log('[VideoFlowController] Background armed, clicking download link');
    } catch (error) {
      console.warn('[VideoFlowController] Failed to arm background, downloading to default location:', error);
    }
    downloadLink.click();
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

    // Wait for "Video exported!" notification
    await this.waitFor(
      () => findByText('[data-sonner-toast]', 'Video exported') !== null,
      'Video exported notification',
      config.timeoutMs
    );
    console.log('[VideoFlowController] Export complete');

    // Find the Download link inside the notification
    const notification = findByText('[data-sonner-toast]', 'Video exported');
    if (notification) {
      const downloadLink = notification.querySelector('a') as HTMLAnchorElement | null;
      if (downloadLink) {
        const hasRealHref = downloadLink.href && downloadLink.href !== window.location.href && !downloadLink.href.endsWith('#');

        if (hasRealHref) {
          // Has a real href — use chrome.downloads API directly
          const now = new Date();
          const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const filename = `video_${timestamp}.mp4`;

          try {
            const response = await new Promise<{ success: boolean; error?: string }>((resolve) => {
              // Send download request via postMessage
              window.postMessage({
                __shopEnginX__: true,
                source: 'shopenginx-main',
                type: 'REQUEST',
                action: 'downloadImage',
                payload: {
                  url: downloadLink.href,
                  filename: filename,
                  subfolder: 'ShopEnginX'
                },
              }, '*');
              // No-op response since we handle via bridge
              resolve({ success: false, error: 'deprecated' });
            });

            if (response?.success) {
              console.log(`[VideoFlowController] Video download started: ShopEnginX/${filename}`);
            } else {
              console.error('[VideoFlowController] Download API failed:', response?.error);
              downloadLink.click();
            }
          } catch (error) {
            console.error('[VideoFlowController] Download API error, falling back to click:', error);
            downloadLink.click();
          }
        } else if (this.downloadToFolder) {
          // No href + downloadToFolder flag — arm background to redirect to ShopEnginX/
          console.log('[VideoFlowController] Arming download redirect to ShopEnginX/');
          await this.armAndClickDownload(downloadLink);
        } else {
          // No href, no flag — just click (downloads to browser default location)
          console.log('[VideoFlowController] Clicking Download link in notification (onclick handler)');
          downloadLink.click();
        }
        await this.delay(3000); // Wait for download to start
      } else {
        console.warn('[VideoFlowController] No download link found in export notification');
      }

      // Dismiss the notification
      const dismissBtn = notification.querySelector('button');
      if (dismissBtn) {
        (dismissBtn as HTMLElement).click();
        console.log('[VideoFlowController] Dismissed notification');
      }
    }
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
    const videoUuids: string[] = [];

    try {
      if (config.continueFromCurrent && config.imageUuid) {
        // ─── "Add To Prompt" flow: stay in same project, use gallery image ───
        // Remove any existing ingredient first (handles Extension OFF job 2+)
        try {
          await this.clickRemoveFromPrompt();
          await this.delay(500);
        } catch { /* ignore if nothing to remove — first job */ }

        await this.executeStep('switchToImagesTab', () => this.switchToImagesTab());
        await this.executeStep('clickAddToPromptByUuid', () => this.clickAddToPromptByUuid(config.imageUuid!));
        await this.executeStep('switchToFramesToVideo', () => this.switchToFramesToVideo());
        await this.executeStep('configureSettings', () => this.configureSettings(config.aspectRatio, config.outputCount));
      } else {
        // ─── Legacy flow: create new project + upload image ───
        await this.executeStep('createNewProject', () => this.createNewProject());
        await this.executeStep('ensureVideoMode', () => this.ensureVideoMode());
        await this.executeStep('configureSettings', () => this.configureSettings(config.aspectRatio, config.outputCount));
      }

      // Phase 2-3: Upload (legacy) and Initial generation (with retry)
      let initialGenAttempt = 0;
      while (initialGenAttempt <= VideoFlowController.GENERATION_MAX_RETRIES) {
        try {
          // Phase 2: Upload image if provided (legacy flow only)
          if (!config.continueFromCurrent && config.image) {
            await this.executeStep('uploadImage', () => this.uploadImage(config.image!, config.aspectRatio));
          }

          // Phase 3: Initial generation
          // Start video tracker and snapshot before generation
          if (!flowVideoTracker.isActive()) {
            flowVideoTracker.start();
          }
          const snapshotBefore = flowVideoTracker.getSnapshot();

          await this.executeStep('fillPrompt', () => this.fillPrompt(config.prompts[0]), 0, config.prompts.length);
          await this.executeStep('clickCreate', () => this.clickCreate(), 0, config.prompts.length);
          await this.executeStep('waitForInitialComplete', () => this.waitForInitialCompletion(), 0, config.prompts.length);

          // Get newly generated video UUID(s) from tracker
          const newVideoUuids = flowVideoTracker.getNewImages(snapshotBefore);
          if (newVideoUuids.length > 0) {
            videoUuids.push(...newVideoUuids);
            console.log(`[VideoFlowController] New video UUID(s) from tracker:`, newVideoUuids);
          } else {
            // Fallback: try captureVideoUuids() if tracker didn't pick up (e.g., lazy video element loading)
            const fallbackUuids = this.captureVideoUuids();
            if (fallbackUuids.length > 0) {
              videoUuids.push(fallbackUuids[fallbackUuids.length - 1]);
              console.log(`[VideoFlowController] Fallback: using last video UUID:`, fallbackUuids[fallbackUuids.length - 1]);
            }
          }

          completedPrompts = 1;
          break; // Success - exit retry loop
        } catch (error) {
          initialGenAttempt++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          
          if (initialGenAttempt > VideoFlowController.GENERATION_MAX_RETRIES) {
            throw error; // Max retries exceeded, propagate error
          }
          
          this.reportGenerationRetry('initial', initialGenAttempt, VideoFlowController.GENERATION_MAX_RETRIES + 1, errorMsg);
          console.log(`[VideoFlowController] Initial generation failed, retrying (${initialGenAttempt}/${VideoFlowController.GENERATION_MAX_RETRIES + 1}): ${errorMsg}`);
          await this.delay(VideoFlowController.GENERATION_RETRY_DELAY_MS);

          if (config.continueFromCurrent) {
            // "Add To Prompt" flow retry: remove and re-add ingredient
            try {
              await this.clickRemoveFromPrompt();
            } catch { /* ignore if nothing to remove */ }
            await this.delay(1000);
            if (config.imageUuid) {
              await this.executeStep('switchToImagesTab', () => this.switchToImagesTab());
              await this.executeStep('clickAddToPromptByUuid', () => this.clickAddToPromptByUuid(config.imageUuid!));
              await this.executeStep('switchToFramesToVideo', () => this.switchToFramesToVideo());
            }
          } else {
            // Legacy flow: navigate back and create new project
            window.location.href = 'https://labs.google/fx/tools/flow';
            await this.delay(3000); // Wait for page load
            await this.executeStep('createNewProject', () => this.createNewProject());
          }
        }
      }

      // Phase 4: Add to scene (transition to scenebuilder)
      // Skip for "Add To Prompt" flow WITHOUT extensions — video stays in project, no scenebuilder needed.
      // Extension ON (multiple prompts) still needs scenebuilder for "Extend" clips.
      if (!config.continueFromCurrent || config.prompts.length > 1) {
        await this.executeStep('clickAddToScene', () => this.clickAddToScene());
      }

      // Phase 5: Extensions (if any)
      for (let i = 1; i < config.prompts.length; i++) {
        if (this.aborted) break;

        // Expected clip count: initial (1) + extensions completed so far (i-1) + this extension (1) = i + 1
        const expectedClipCount = i + 1;
        let extensionAttempt = 0;

        while (extensionAttempt <= VideoFlowController.GENERATION_MAX_RETRIES) {
          try {
            // enterExtendMode also configures settings (aspect ratio) after entering extend mode
            await this.executeStep('enterExtendMode', () => this.enterExtendMode(config.aspectRatio, config.outputCount), i, config.prompts.length);
            await this.executeStep('fillExtensionPrompt', () => this.fillExtensionPrompt(config.prompts[i]), i, config.prompts.length);
            await this.executeStep('clickCreate', () => this.clickCreate(), i, config.prompts.length);
            await this.executeStep('waitForExtensionComplete', () => this.waitForExtensionCompletion(expectedClipCount), i, config.prompts.length);
            completedPrompts = i + 1;
            break; // Success - exit retry loop
          } catch (error) {
            extensionAttempt++;
            const errorMsg = error instanceof Error ? error.message : String(error);
            
            if (extensionAttempt > VideoFlowController.GENERATION_MAX_RETRIES) {
              throw error; // Max retries exceeded, propagate error
            }
            
            this.reportGenerationRetry('extension', extensionAttempt, VideoFlowController.GENERATION_MAX_RETRIES + 1, errorMsg);
            console.log(`[VideoFlowController] Extension ${i} generation failed, retrying (${extensionAttempt}/${VideoFlowController.GENERATION_MAX_RETRIES + 1}): ${errorMsg}`);
            await this.delay(VideoFlowController.GENERATION_RETRY_DELAY_MS);
            // No navigation needed - already in scenebuilder, enterExtendMode will re-select clip
          }
        }
      }

      // Phase 6: Download (scenebuilder export — only when we entered scenebuilder)
      const enteredScenebuilder = !config.continueFromCurrent || config.prompts.length > 1;
      if (config.autoDownload && enteredScenebuilder) {
        await this.executeStep('downloadVideo', () => this.downloadVideo());
        downloaded = true;
      }

      // Stop video tracker
      flowVideoTracker.stop();

      return { success: true, completedPrompts, downloaded, videoUuids };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[VideoFlowController] Workflow failed:', errorMsg);
      flowVideoTracker.stop();
      return { success: false, error: errorMsg, completedPrompts, downloaded, videoUuids };
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
  addToPromptByUuid:      { maxAttempts: 3, retryDelayMs: 2000, timeoutMs: 30000 },
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
  
  // Story mode: remember aspect ratio from init for handleCrop during reference upload
  private storyAspectRatio: '9:16' | '16:9' = '9:16';

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
    window.postMessage({
      __shopEnginX__: true,
      source: 'shopenginx-main',
      type: 'PROGRESS',
      action: 'IMAGE_PROGRESS',
      payload: event,
    }, '*');
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
    const images = document.querySelectorAll('img[alt="Generated image"]');
    
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
    const result = await configureFlowSettings({ mode: 'image' }, 'ImageFlow');
    if (!result?.success) {
      throw new Error(`Switch to image mode failed: ${result?.error || 'unknown'}`);
    }
    if (result.results?.mode === false) {
      throw new Error('Switch to image mode: tab click did not activate image mode');
    }
    console.log('[ImageFlowController] Switched to Create Image mode via Main World');
    await new Promise(r => setTimeout(r, 300));
  }

  /**
   * Step: Configure settings (aspect ratio + output count) via Radix config popper
   */
  async configureSettings(aspectRatio: '9:16' | '16:9', imageCount: number): Promise<void> {
    const result = await configureFlowSettings({ aspectRatio, imageCount }, 'ImageFlow');
    if (!result?.success) {
      throw new Error(`Configure image settings failed: ${result?.error || 'unknown'}`);
    }
    const r = result.results || {};
    if (r.ratio === false || r.count === false) {
      throw new Error(`Configure image settings: partial failure (ratio=${r.ratio}, count=${r.count})`);
    }
    console.log('[ImageFlowController] Settings configured via Main World:', result.results);
    await new Promise(r => setTimeout(r, 300));
  }

  // ─── "Add To Prompt" by UUID (for reference images already in gallery) ───

  /**
   * Click "Add To Prompt" on an image in the gallery by its UUID.
   * This adds the image as an ingredient/reference for the next generation,
   * replacing the old upload→crop→save flow.
   */
  async clickAddToPromptByImageUuid(imageUuid: string): Promise<void> {
    await FlowUIActions.addImageToPrompt(
      imageUuid,
      (condition, name, timeout) => this.waitFor(condition, name, timeout),
      (ms) => this.delay(ms),
      10000,
      'ImageFlowController',
    );
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

    // Fill the Slate editor directly (MAIN world — Phase 2)
    fillPromptViaSlateFiber(prompt);
    await this.delay(500);

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
      // Send via bridge - but since this is within the class, we'll use a different approach
      // For now, let it be handled by the bridge with postMessage
      const response = { success: false }; // placeholder - actual download handled by bridge

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
    if (originalUrl.includes('GoogleAccessId') || originalUrl.includes('Signature=') || originalUrl.includes('storage.googleapis.com') || originalUrl.includes('getMediaUrlRedirect')) {
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

  /**
   * Initialize story mode — called once before the first scene.
   * Sets up create image mode and configures aspect ratio / image count.
   */
  async initStoryMode(aspectRatio: '9:16' | '16:9', imageCount: number, totalScenes: number): Promise<void> {
    this.workflowTimestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    this.storyAspectRatio = aspectRatio;
    console.log('[ImageFlowController] Story mode init, timestamp:', this.workflowTimestamp);

    const initialUUIDsList = await this.collectAllImageUUIDs();
    this.initialUUIDs = new Set(initialUUIDsList);
    console.log('[ImageFlowController] Initial UUIDs collected:', this.initialUUIDs.size);

    // Configure mode + settings via Main World (Radix tabs don't respond to content script clicks).
    // background.ts runs the entire popper interaction in chrome.scripting.executeScript({ world: 'MAIN' }).
    const result = await configureFlowSettings({ mode: 'image', aspectRatio, imageCount }, 'ImageFlow');
    if (!result?.success) {
      throw new Error(`Configure story settings failed: ${result?.error || 'unknown'}`);
    }
    const r = result.results || {};
    if (r.mode === false || r.ratio === false || r.count === false) {
      throw new Error(`Configure story settings: partial failure (mode=${r.mode}, ratio=${r.ratio}, count=${r.count})`);
    }
    console.log('[ImageFlowController] Settings configured via Main World:', result.results);
    await this.delay(500);
  }

  /**
   * Capture a generated image by UUID — fetches it from the DOM and returns as base64 data URL.
   * Used for auto-character reference: scene 1's image is sent as reference for scenes 2+.
   */
  private async captureGeneratedImage(uuid: string): Promise<string | null> {
    try {
      console.log(`[captureGeneratedImage] Looking for img[src*="${uuid}"]`);
      let img = document.querySelector(`img[src*="${uuid}"]`) as HTMLImageElement;
      if (!img && uuid.length > 8) {
        console.log(`[captureGeneratedImage] Full UUID not found, trying short: ${uuid.substring(0, 8)}`);
        img = document.querySelector(`img[src*="${uuid.substring(0, 8)}"]`) as HTMLImageElement;
      }
      if (!img) {
        // Log all img[alt="Generated image"] srcs to help debug
        const allImgs = document.querySelectorAll('img[alt="Generated image"]');
        console.warn(`[captureGeneratedImage] NOT FOUND. UUID: ${uuid}. Total Generated images in DOM: ${allImgs.length}`);
        allImgs.forEach((el, i) => console.log(`  [${i}] src: ${(el as HTMLImageElement).src?.substring(0, 100)}`));
        return null;
      }

      console.log(`[captureGeneratedImage] Found img, src: ${img.src?.substring(0, 100)}`);
      const imageUrl = this.getHighResUrl(img.src, 1024);
      console.log(`[captureGeneratedImage] Fetching: ${imageUrl.substring(0, 120)}`);

      const response = await fetch(imageUrl);
      if (!response.ok) {
        console.error(`[captureGeneratedImage] Fetch failed: ${response.status} ${response.statusText}`);
        return null;
      }

      const blob = await response.blob();
      console.log(`[captureGeneratedImage] Blob size: ${blob.size} bytes, type: ${blob.type}`);
      const dataUrl = await this.blobToDataUrl(blob);
      console.log(`[captureGeneratedImage] Success: ${Math.round(dataUrl.length / 1024)}KB`);
      return dataUrl;
    } catch (error) {
      console.error('[captureGeneratedImage] Exception:', error);
      return null;
    }
  }

  /**
   * Execute a single story scene — sidebar calls this once per prompt.
   * 
   * @param referenceImageUuid - UUID of scene 1's image in the gallery (provided for scenes 2+).
   *                             Clicks "Add To Prompt" on the gallery image instead of uploading.
   * @param referenceImage - (Legacy fallback) Base64 data URL of scene 1's image.
   *                         Only used if referenceImageUuid is not available.
   * @param captureImage   - If true, capture the first generated image as base64 (scene 1 only).
   *                         The captured image is returned in `imageBase64` for subsequent scenes.
   */
  async executeStoryScene(
    prompt: string,
    sceneIndex: number,
    totalScenes: number,
    imageCount: number,
    autoSaveImage: boolean,
    downloadResolution: '1K' | '2K' | '4K',
    isLast: boolean,
    referenceImageUuid?: string,
    referenceImage?: string,
    captureImage?: boolean,
  ): Promise<{ success: boolean; imagesCreated: number; error?: string; imageBase64?: string; imageUUIDs?: string[] }> {
    console.log(`[ImageFlowController] Story scene ${sceneIndex + 1}/${totalScenes}`, {
      hasReferenceImageUuid: !!referenceImageUuid,
      hasReferenceImage: !!referenceImage,
      captureImage: !!captureImage,
    });

    try {
      // If reference image UUID provided (scenes 2+), use "Add To Prompt" on the gallery image
      if (referenceImageUuid) {
        console.log(`[ImageFlowController] Adding reference image ${referenceImageUuid.substring(0, 8)}... via "Add To Prompt"`);
        await this.executeStep('addToPromptByUuid', () => this.clickAddToPromptByImageUuid(referenceImageUuid), sceneIndex, totalScenes);
        console.log('[ImageFlowController] Reference image added to prompt successfully');
      } else if (referenceImage) {
        // Legacy fallback: upload base64 image
        console.log('[ImageFlowController] Uploading reference image for character consistency (legacy fallback)...');
        await this.executeStep('openImagePicker', () => this.openImagePicker(), sceneIndex, totalScenes);
        await this.executeStep('uploadImage', () => this.uploadImage(referenceImage), sceneIndex, totalScenes);
        await this.executeStep('handleCrop', () => this.handleCrop(this.storyAspectRatio), sceneIndex, totalScenes);
        await this.executeStep('waitAllImagesUploaded', () => this.waitAllImagesUploaded(1), sceneIndex, totalScenes);
        console.log('[ImageFlowController] Reference image uploaded successfully');
      }

      // Fill prompt text
      await this.executeStep('fillPrompt', () => this.fillPrompt(prompt), sceneIndex, totalScenes);

      // Click Create and wait for generation
      await this.executeStep('clickCreate', () => this.clickCreate(), sceneIndex, totalScenes);

      let newUUIDs: string[] = [];
      await this.executeStep('waitForGeneration', async () => {
        newUUIDs = await this.waitForGeneration(imageCount);
      }, sceneIndex, totalScenes);

      // Track new UUIDs
      newUUIDs.forEach(uuid => this.initialUUIDs.add(uuid));

      // Capture generated image as base64 (for thumbnail + auto-character reference)
      let imageBase64: string | undefined;
      console.log('[ImageFlowController] captureImage flag:', captureImage, ', newUUIDs:', newUUIDs.length, newUUIDs);
      if (captureImage && newUUIDs.length > 0) {
        console.log(`[ImageFlowController] Attempting captureGeneratedImage for UUID: ${newUUIDs[0]}`);
        const captured = await this.captureGeneratedImage(newUUIDs[0]);
        console.log(`[ImageFlowController] captureGeneratedImage result: ${captured ? `${Math.round(captured.length / 1024)}KB` : 'null'}`);
        if (captured) {
          imageBase64 = captured;
        } else {
          console.warn('[ImageFlowController] captureGeneratedImage returned null — thumbnail will be missing');
        }
      } else {
        console.log(`[ImageFlowController] Skipping capture: captureImage=${captureImage}, newUUIDs.length=${newUUIDs.length}`);
      }

      // Download if enabled
      if (autoSaveImage && newUUIDs.length > 0) {
        await this.executeStep('downloadImages', async () => {
          await this.downloadImages(newUUIDs, downloadResolution);
        }, sceneIndex, totalScenes);
      }

      // Clear prompt box for next scene (not last)
      if (!isLast) {
        await this.executeStep('clearPromptBox', () => this.clearPromptBox(), sceneIndex, totalScenes);
      }

      // Stop tracker on last scene
      if (isLast) {
        flowImageTracker.stop();
      }

      return { success: true, imagesCreated: newUUIDs.length, imageBase64, imageUUIDs: newUUIDs };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ImageFlowController] Story scene ${sceneIndex + 1} failed:`, errorMsg);

      // Clear prompt box so next scene can start fresh (if not last)
      if (!isLast) {
        try {
          await this.executeStep('clearPromptBox', () => this.clearPromptBox(), sceneIndex, totalScenes);
        } catch { /* ignore cleanup error */ }
      }

      if (isLast) {
        flowImageTracker.stop();
      }

      return { success: false, imagesCreated: 0, error: errorMsg, imageUUIDs: [] };
    }
  }
}

// Global instance
let imageFlowController: ImageFlowController | null = null;

const overlay = new WorkflowOverlay();

// Listen for messages from extension
// Listen for messages from bridge (ISOLATED world) via window.postMessage
window.addEventListener('message', (event) => {
  // Only accept messages from our own prefix
  if (!event.data || !event.data['__shopEnginX__']) return;
  if (event.data.source !== 'shopenginx-bridge') return;
  
  const message = event.data.payload; // original message from side panel
  console.log('[ShopEnginX-MAIN] Received message:', message.type);

  // Wrap sendResponse to send back via window.postMessage
  const originalAction = event.data.action;
  const messageId = event.data.messageId || Date.now();

  const sendResponse = (responseData: any) => {
    window.postMessage({
      __shopEnginX__: true,
      source: 'shopenginx-main',
      type: 'RESPONSE',
      action: originalAction,
      messageId: messageId,
      payload: responseData,
    }, '*');
  };

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
          const flowImages = document.querySelectorAll('img[alt="Generated image"]');
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
        const allFlowImages = document.querySelectorAll('img[alt="Generated image"]');
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
      
    // ==================== Video Flow Handlers ====================

    case 'START_VIDEO_WORKFLOW':
      (async () => {
        try {
const videoConfig: VideoSetConfig = {
            image: message.image,
            imageUuid: message.imageUuid,
            prompts: message.prompts || [],
            aspectRatio: message.aspectRatio || '9:16',
            outputCount: message.videoCount || 1,
            autoDownload: message.autoDownload ?? true,
            continueFromCurrent: message.continueFromCurrent ?? false,
          };

          console.log('[START_VIDEO_WORKFLOW] Starting with config:', {
            hasImage: !!videoConfig.image,
            imageUuid: videoConfig.imageUuid?.substring(0, 8),
            continueFromCurrent: videoConfig.continueFromCurrent,
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
              window.postMessage({
                __shopEnginX__: true,
                source: 'shopenginx-main',
                type: 'PROGRESS',
                action: 'VIDEO_PROGRESS',
                payload: event,
              }, '*');
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
      
    case 'CLICK_ADD_VIDEO_TO_SCENE_BY_UUID':
      // Lightweight handler: find video, hover, click "Add to scene", return FAST.
      // Sidebar handles redirect detection and navigation.
      (async () => {
        try {
          const { videoUuid } = message;
          let controller = videoFlowController;
          let createdTemp = false;
          if (!controller) {
            controller = new VideoFlowController(
              {},
              (event: VideoProgressEvent) => {
                window.postMessage({
                  __shopEnginX__: true,
                  source: 'shopenginx-main',
                  type: 'PROGRESS',
                  action: 'VIDEO_PROGRESS',
                  payload: event,
                }, '*');
              }
            );
            createdTemp = true;
          }

          const result = await controller.clickAddToSceneByUuid(videoUuid);
          console.log('[CLICK_ADD_VIDEO_TO_SCENE_BY_UUID] Result:', result);
          sendResponse(result);

          if (createdTemp) {
            controller.destroy();
          }
        } catch (e) {
          console.error('[CLICK_ADD_VIDEO_TO_SCENE_BY_UUID] Error:', e);
          sendResponse({ status: 'not_found', error: String(e) });
        }
      })();
      

    case 'NAVIGATE_BACK_TO_PROJECT':
      // Navigate from scenebuilder back to project page via breadcrumb
      (async () => {
        try {
          let controller = videoFlowController;
          let createdTemp = false;
          if (!controller) {
            controller = new VideoFlowController(
              {},
              (event: VideoProgressEvent) => {
                window.postMessage({
                  __shopEnginX__: true,
                  source: 'shopenginx-main',
                  type: 'PROGRESS',
                  action: 'VIDEO_PROGRESS',
                  payload: event,
                }, '*');
              }
            );
            createdTemp = true;
          }

          await controller.navigateBackToProject();
          sendResponse({ success: true });

          if (createdTemp) {
            controller.destroy();
          }
        } catch (e) {
          console.error('[NAVIGATE_BACK_TO_PROJECT] Error:', e);
          sendResponse({ success: false, error: String(e) });
        }
      })();
      

    case 'GET_VIEWPORT_WIDTH':
      // Return the content area's actual innerWidth so the sidebar can calculate resize
      sendResponse({ innerWidth: window.innerWidth });
      return false;

    case 'SWITCH_TO_VIDEOS_TAB':
      // Ensure the Videos tab is active on the project page
      (async () => {
        try {
          let controller = videoFlowController;
          let createdTemp = false;
          if (!controller) {
            controller = new VideoFlowController(
              {},
              (event: VideoProgressEvent) => {
                window.postMessage({
                  __shopEnginX__: true,
                  source: 'shopenginx-main',
                  type: 'PROGRESS',
                  action: 'VIDEO_PROGRESS',
                  payload: event,
                }, '*');
              }
            );
            createdTemp = true;
          }

          await controller.switchToVideosTab();
          sendResponse({ success: true });

          if (createdTemp) {
            controller.destroy();
          }
        } catch (e) {
          console.error('[SWITCH_TO_VIDEOS_TAB] Error:', e);
          sendResponse({ success: false, error: String(e) });
        }
      })();
      

    case 'DOWNLOAD_SCENE_VIDEO':
      (async () => {
        try {
          // Create a temp controller if needed (page may have reloaded since add-to-scene)
          let controller = videoFlowController;
          let createdTemp = false;
          if (!controller) {
            controller = new VideoFlowController(
              {},
              (event: VideoProgressEvent) => {
                window.postMessage({
                  __shopEnginX__: true,
                  source: 'shopenginx-main',
                  type: 'PROGRESS',
                  action: 'VIDEO_PROGRESS',
                  payload: event,
                }, '*');
              }
            );
            createdTemp = true;
          }

          // Optional flag: save to ShopEnginX/ folder instead of browser default
          if (message.downloadToFolder) {
            controller.downloadToFolder = true;
          }

          const result = await controller.navigateAndDownloadSceneVideo();
          console.log('[DOWNLOAD_SCENE_VIDEO] Result:', result);
          sendResponse(result);

          if (createdTemp) {
            controller.destroy();
          }
        } catch (e) {
          console.error('[DOWNLOAD_SCENE_VIDEO] Error:', e);
          sendResponse({ success: false, error: String(e) });
        }
      })();
      
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

    case 'ADD_VIDEOS_TO_SCENE_IN_ORDER':
      (async () => {
        try {
          const videoUuidsInOrder: string[] = message.videoUuidsInOrder || [];
          console.log('[ADD_VIDEOS_TO_SCENE_IN_ORDER] Starting with', videoUuidsInOrder.length, 'video UUIDs');

          if (videoUuidsInOrder.length === 0) {
            sendResponse({ success: false, addedCount: 0, notFoundUuids: [], error: 'No video UUIDs provided' });
            return;
          }

          // Create a temporary controller if none exists (workflow may have been cleaned up after generation)
          let controller = videoFlowController;
          let createdTemp = false;
          if (!controller) {
            controller = new VideoFlowController(
              message.stepConfig || {},
              (event: VideoProgressEvent) => {
                window.postMessage({
                  __shopEnginX__: true,
                  source: 'shopenginx-main',
                  type: 'PROGRESS',
                  action: 'VIDEO_PROGRESS',
                  payload: event,
                }, '*');
              }
            );
            createdTemp = true;
          }

          const result = await controller.addAllVideosToSceneInOrder(videoUuidsInOrder);
          console.log('[ADD_VIDEOS_TO_SCENE_IN_ORDER] Result:', result);
          sendResponse(result);

          // Cleanup temp controller
          if (createdTemp) {
            controller.destroy();
          }
        } catch (e) {
          console.error('[ADD_VIDEOS_TO_SCENE_IN_ORDER] Error:', e);
          sendResponse({ success: false, addedCount: 0, notFoundUuids: [], error: String(e) });
        }
      })();
      
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
      
    case 'INIT_STORY_MODE':
      // Called once before the first scene — creates controller, sets up Google Flow
      (async () => {
        try {
          const aspectRatio = message.aspectRatio || '9:16';
          const imageCount = message.imageCount || 4;
          const totalScenes = message.totalScenes || 1;

          console.log('[INIT_STORY_MODE] Initializing:', { aspectRatio, imageCount, totalScenes });

          // Cleanup existing controller if any
          if (imageFlowController) {
            imageFlowController.destroy();
          }

          imageFlowController = new ImageFlowController(
            message.stepConfig,
            (event: ImageProgressEvent) => {
              console.log('[INIT_STORY_MODE] Progress:', event);
            }
          );

          await imageFlowController.initStoryMode(aspectRatio, imageCount, totalScenes);
          console.log('[INIT_STORY_MODE] Ready');
          sendResponse({ success: true });
        } catch (e) {
          console.log('[INIT_STORY_MODE] Error:', e);
          sendResponse({ success: false, error: String(e) });
          if (imageFlowController) {
            imageFlowController.destroy();
            imageFlowController = null;
          }
        }
      })();
      

    case 'CREATE_STORY_SCENE':
      // Called once per scene — fills prompt, generates, downloads, clears for next
      (async () => {
        try {
          if (!imageFlowController) {
            sendResponse({ success: false, error: 'No active story controller. Call INIT_STORY_MODE first.' });
            return;
          }

          const prompt = message.prompt || '';
          const sceneIndex = message.sceneIndex ?? 0;
          const totalScenes = message.totalScenes ?? 1;
          const imageCount = message.imageCount ?? 4;
          const autoSaveImage = message.autoSaveImage ?? true;
          const downloadResolution = message.downloadResolution || '1K';
          const isLast = message.isLast ?? false;
          const referenceImageUuid: string | undefined = message.referenceImageUuid;
          const referenceImage: string | undefined = message.referenceImage;
          const captureImage: boolean = message.captureImage ?? false;

          console.log(`[CREATE_STORY_SCENE] Scene ${sceneIndex + 1}/${totalScenes}, isLast=${isLast}, hasRefUuid=${!!referenceImageUuid}, hasRef=${!!referenceImage}, capture=${captureImage}`);

          const result = await imageFlowController.executeStoryScene(
            prompt, sceneIndex, totalScenes, imageCount, autoSaveImage, downloadResolution, isLast,
            referenceImageUuid, referenceImage, captureImage
          );

          console.log(`[CREATE_STORY_SCENE] Scene ${sceneIndex + 1} result:`, result);

          // Cleanup controller after last scene
          if (isLast) {
            imageFlowController.destroy();
            imageFlowController = null;
          }

          sendResponse(result);
        } catch (e) {
          console.log('[CREATE_STORY_SCENE] Error:', e);
          sendResponse({ success: false, imagesCreated: 0, error: String(e) });
        }
      })();
      

    // Note: STOP_IMAGE_WORKFLOW also stops story workflows since both use the same imageFlowController
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
            window.postMessage({
              __shopEnginX__: true,
              source: 'shopenginx-main',
              type: 'PROGRESS',
              action: 'TIKTOK_FOLLOWING_PROGRESS',
              payload: { count },
            }, '*');
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
  } // end switch
}); // end window.addEventListener('message')

console.log('[ShopEnginX-MAIN] Content script loaded');

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
      
      // Send message to extension about recovery result via bridge
      window.postMessage({
        __shopEnginX__: true,
        source: 'shopenginx-main',
        type: 'RESPONSE',
        action: 'IMAGE_FLOW_RECOVERY_RESULT',
        payload: recoveryResult,
      }, '*');
      
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
