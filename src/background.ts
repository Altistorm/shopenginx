// Background service worker

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error))

// Keep-alive port connections
const keepAlivePorts = new Set<chrome.runtime.Port>();

// Active polling sessions
interface PollingSession {
  tabId: number;
  intervalId: ReturnType<typeof setInterval>;
  expectedImages: number;
  generationStarted: boolean;
  pollCount: number;
  onComplete: (success: boolean) => void;
}

const pollingSessions = new Map<number, PollingSession>();

// Handle port connections for keep-alive
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'keepalive') {
    console.log('[Background] Keep-alive port connected');
    keepAlivePorts.add(port);

    port.onMessage.addListener((message) => {
      if (message.type === 'ping') {
        // Respond to ping to confirm connection is alive
        port.postMessage({ type: 'pong', timestamp: Date.now() });
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('[Background] Keep-alive port disconnected');
      keepAlivePorts.delete(port);
    });
  }
});

// Poll content script for generation status
async function pollGenerationStatus(tabId: number): Promise<{
  percentageCount: number;
  hasPercentage: boolean;
  error?: string;
}> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'CHECK_GENERATION_STATUS'
    });
    return response || { percentageCount: 0, hasPercentage: false };
  } catch (error) {
    console.error('[Background] Failed to poll status:', error);
    return { percentageCount: 0, hasPercentage: false, error: String(error) };
  }
}

// Start polling for a tab
function startPolling(
  tabId: number,
  expectedImages: number,
  pollIntervalMs: number,
  onProgress: (data: { percentageCount: number; pollCount: number; generationStarted: boolean }) => void,
  onComplete: (success: boolean) => void
): void {
  // Stop any existing polling for this tab
  stopPolling(tabId);

  console.log(`[Background] Starting polling for tab ${tabId}, expected ${expectedImages} images`);

  const session: PollingSession = {
    tabId,
    expectedImages,
    generationStarted: false,
    pollCount: 0,
    onComplete,
    intervalId: setInterval(async () => {
      session.pollCount++;
      const status = await pollGenerationStatus(tabId);

      console.log(`[Background] Poll #${session.pollCount}: percentageCount=${status.percentageCount}, hasPercentage=${status.hasPercentage}`);

      // Track if generation started
      if (status.percentageCount >= expectedImages || status.percentageCount > 0) {
        session.generationStarted = true;
      }

      // Send progress update
      onProgress({
        percentageCount: status.percentageCount,
        pollCount: session.pollCount,
        generationStarted: session.generationStarted
      });

      // Check completion conditions
      const completedBeforePolling = session.pollCount >= 3 && !status.hasPercentage && !session.generationStarted;
      const generationCompleted = session.generationStarted && !status.hasPercentage;

      if (generationCompleted || completedBeforePolling) {
        console.log(`[Background] Generation complete for tab ${tabId}`);
        stopPolling(tabId);
        onComplete(true);
      }
    }, pollIntervalMs)
  };

  pollingSessions.set(tabId, session);
}

// Stop polling for a tab
function stopPolling(tabId: number): void {
  const session = pollingSessions.get(tabId);
  if (session) {
    clearInterval(session.intervalId);
    pollingSessions.delete(tabId);
    console.log(`[Background] Stopped polling for tab ${tabId}`);
  }
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getData') {
    chrome.storage.local.get(['folderData'], (result) => {
      sendResponse(result.folderData || null)
    })
    return true
  }

  if (message.action === 'saveData') {
    chrome.storage.local.set({ folderData: message.data }, () => {
      sendResponse({ success: true })
    })
    return true
  }

  // Start background polling for generation status
  if (message.action === 'startBackgroundPolling') {
    const { tabId, expectedImages, pollIntervalMs } = message;

    startPolling(
      tabId,
      expectedImages,
      pollIntervalMs || 3000,
      (progressData) => {
        // Send progress updates back to the caller
        chrome.runtime.sendMessage({
          action: 'pollingProgress',
          tabId,
          ...progressData
        }).catch(() => {
          // Ignore errors if no listener
        });
      },
      (success) => {
        // Send completion notification
        chrome.runtime.sendMessage({
          action: 'pollingComplete',
          tabId,
          success
        }).catch(() => {
          // Ignore errors if no listener
        });
      }
    );

    sendResponse({ started: true });
    return true;
  }

  // Stop background polling
  if (message.action === 'stopBackgroundPolling') {
    const { tabId } = message;
    stopPolling(tabId);
    sendResponse({ stopped: true });
    return true;
  }

  // Check if polling is active
  if (message.action === 'isPollingActive') {
    const { tabId } = message;
    sendResponse({ active: pollingSessions.has(tabId) });
    return true;
  }

  // Download image from URL
  if (message.action === 'downloadImage') {
    const { url, filename, subfolder } = message;
    
    (async () => {
      try {
        console.log('[Background] Downloading image:', { url: url.substring(0, 60), filename, subfolder });
        
        // Fetch the image
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`);
        }
        
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        
        // Build filename with optional subfolder
        const fullFilename = subfolder ? `${subfolder}/${filename}` : filename;
        
        // Download using chrome.downloads API
        const downloadId = await chrome.downloads.download({
          url: blobUrl,
          filename: fullFilename,
          saveAs: false, // Don't show save dialog
        });
        
        console.log('[Background] Download started:', { downloadId, filename: fullFilename });
        
        // Clean up blob URL after download starts
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        
        sendResponse({ success: true, downloadId });
      } catch (error) {
        console.error('[Background] Download error:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();
    
    return true; // Keep message channel open for async response
  }

  // Configure Google Flow settings via Main World (Radix UI tabs don't respond to content script clicks)
  if (message.action === 'CONFIGURE_FLOW_SETTINGS') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab id' });
      return true;
    }
    const { mode, aspectRatio, imageCount } = message as {
      mode?: 'image' | 'videocam';
      aspectRatio?: '9:16' | '16:9';
      imageCount?: number;
    };
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (mode: string | undefined, aspectRatio: string | undefined, imageCount: number | undefined) => {
        const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
        const log = (msg: string) => console.log(`[CONFIGURE_FLOW_SETTINGS] ${msg}`);

        async function run() {
          try {
          // Find the config trigger button
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

          // Click using pointer events (required for Radix)
          const clickElement = async (el: HTMLElement) => {
            const rect = el.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', clientX: x, clientY: y, isPrimary: true }));
            await wait(50);
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
            await wait(50);
            el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse', clientX: x, clientY: y, isPrimary: true }));
            await wait(50);
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
            await wait(50);
            el.click();
          };

          // Open config popper
          const trigger = findTrigger();
          if (!trigger) {
            log('Trigger NOT found. Buttons scanned: ' + document.querySelectorAll('button[aria-haspopup="menu"]').length);
            return { ok: false, err: 'Config trigger button not found' };
          }
          log('Trigger found: ' + (trigger.textContent || '').trim().substring(0, 50));

          const wasExpanded = trigger.getAttribute('aria-expanded') === 'true' || trigger.getAttribute('data-state') === 'open';
          if (!wasExpanded) {
            log('Opening popper (trigger not expanded)');
            await clickElement(trigger);
            await wait(800);
          } else {
            log('Popper already expanded');
          }

          const getPopper = () =>
            document.querySelector('[data-radix-menu-content][data-state="open"]') as HTMLElement ||
            document.querySelector('[role="menu"][data-state="open"]') as HTMLElement;

          let popper = getPopper();
          if (!popper) {
            // Try clicking overlay
            const overlay = trigger.querySelector('[data-type="button-overlay"]') as HTMLElement;
            if (overlay) { await clickElement(overlay); await wait(800); }
            popper = getPopper();
          }
          if (!popper) { log('Popper did NOT open after both attempts'); return { ok: false, err: 'Config popper did not open' }; }

          // Helper: find and click a tab
          const clickTab = async (iconMatch: string | null, textMatch: string | null): Promise<boolean> => {
            const currentPopper = getPopper() || popper;
            const tabs = currentPopper.querySelectorAll('button[role="tab"]');
            log(`clickTab(icon=${iconMatch}, text=${textMatch}): ${tabs.length} tabs found`);
            for (const tab of tabs) {
              if (iconMatch) {
                const icon = tab.querySelector('i');
                if (!icon || (icon.textContent || '').trim().toLowerCase() !== iconMatch) continue;
              } else if (textMatch) {
                const txt = (tab.textContent || '').trim().toLowerCase();
                if (txt !== textMatch && txt !== textMatch.replace('x', '')) continue;
              }
              if (tab.getAttribute('data-state') === 'active' || tab.getAttribute('aria-selected') === 'true') {
                log(`  Tab '${iconMatch || textMatch}' already active`);
                return true;
              }
              log(`  Clicking tab '${iconMatch || textMatch}'...`);
              await clickElement(tab as HTMLElement);
              await wait(600);
              // Re-check with fresh reference
              const freshPopper = getPopper() || popper;
              const freshTabs = freshPopper.querySelectorAll('button[role="tab"]');
              log(`  Re-check: ${freshTabs.length} tabs in ${freshPopper === currentPopper ? 'same' : 'NEW'} popper`);
              for (const ft of freshTabs) {
                if (iconMatch) {
                  const fi = ft.querySelector('i');
                  if (!fi || (fi.textContent || '').trim().toLowerCase() !== iconMatch) continue;
                } else if (textMatch) {
                  const txt = (ft.textContent || '').trim().toLowerCase();
                  if (txt !== textMatch && txt !== textMatch.replace('x', '')) continue;
                }
                const isActive = ft.getAttribute('data-state') === 'active' || ft.getAttribute('aria-selected') === 'true';
                log(`  Tab '${iconMatch || textMatch}' re-check: state=${ft.getAttribute('data-state')} selected=${ft.getAttribute('aria-selected')} => ${isActive}`);
                return isActive;
              }
              log(`  Tab '${iconMatch || textMatch}' LOST after click (not found in fresh popper)`);
              return false;
            }
            log(`  No tab matched '${iconMatch || textMatch}'`);
            return false;
          };

          const results: Record<string, boolean> = {};

          // 1. Select mode tab
          if (mode) {
            results.mode = await clickTab(mode, null);
            log(`Mode ${mode}: ${results.mode ? 'ok' : 'FAILED'}`);
            await wait(300);
          }

          // 2. Select aspect ratio tab
          if (aspectRatio) {
            const isPortrait = aspectRatio === '9:16';
            const icon = isPortrait ? 'crop_9_16' : 'crop_16_9';
            results.ratio = await clickTab(icon, null);
            log(`Ratio ${aspectRatio}: ${results.ratio ? 'ok' : 'FAILED'}`);
            await wait(300);
          }

          // 3. Select output count tab
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

          return { ok: true, results };
          } catch (e: any) {
            log(`UNCAUGHT ERROR: ${e?.message || e}`);
            return { ok: false, err: `Uncaught: ${e?.message || e}` };
          }
        }

        log(`Starting: mode=${mode}, aspectRatio=${aspectRatio}, imageCount=${imageCount}`);
        return run();
      },
      args: [mode, aspectRatio, imageCount],
    }).then(results => {
      const result = results?.[0]?.result as { ok: boolean; err?: string; results?: Record<string, boolean> } | undefined;
      if (result?.ok) {
        sendResponse({ success: true, results: result.results });
      } else {
        console.error('[Background] CONFIGURE_FLOW_SETTINGS failed:', result?.err);
        sendResponse({ success: false, error: result?.err || 'unknown' });
      }
    }).catch(err => {
      console.error('[Background] CONFIGURE_FLOW_SETTINGS error:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  // Slate editor text insertion via Main World (content scripts can't access Slate's React state)
  if (message.action === 'SLATE_INSERT_TEXT') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab id' });
      return true;
    }
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (text: string) => {
        try {
          const el = document.querySelector('[data-slate-editor="true"]');
          if (!el) return { ok: false, err: 'no editor element' };
          const fiberKey = Object.keys(el).find(
            k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
          );
          if (!fiberKey) return { ok: false, err: 'no react fiber' };
          let slateEditor: any = null;
          let fiber = (el as any)[fiberKey];
          for (let i = 0; i < 50 && fiber; i++) {
            if (fiber.memoizedProps) {
              for (const val of Object.values(fiber.memoizedProps)) {
                if (
                  val && typeof val === 'object' && !Array.isArray(val) &&
                  typeof (val as any).insertText === 'function' &&
                  typeof (val as any).deleteBackward === 'function' &&
                  Array.isArray((val as any).children)
                ) {
                  slateEditor = val;
                  break;
                }
              }
            }
            if (slateEditor) break;
            fiber = fiber.return;
          }
          if (!slateEditor) return { ok: false, err: 'no slate editor instance' };
          el.focus();
          // Select all existing content and delete it
          if (slateEditor.children && slateEditor.children.length > 0) {
            const lastBlockIdx = slateEditor.children.length - 1;
            const lastBlock = slateEditor.children[lastBlockIdx];
            const lastInlineIdx = (lastBlock.children || []).length - 1;
            const lastInline = (lastBlock.children || [])[Math.max(0, lastInlineIdx)];
            const endOffset = (lastInline?.text || '').length;
            slateEditor.selection = {
              anchor: { path: [0, 0], offset: 0 },
              focus: { path: [lastBlockIdx, Math.max(0, lastInlineIdx)], offset: endOffset },
            };
            if (endOffset > 0 || slateEditor.children.length > 1) {
              slateEditor.deleteFragment();
            }
          }
          slateEditor.insertText(text);
          return { ok: true };
        } catch (e: any) {
          return { ok: false, err: e.message };
        }
      },
      args: [message.text],
    }).then(results => {
      const result = results?.[0]?.result as { ok: boolean; err?: string } | undefined;
      if (result?.ok) {
        sendResponse({ success: true });
      } else {
        console.error('[Background] SLATE_INSERT_TEXT failed:', result?.err);
        sendResponse({ success: false, error: result?.err || 'unknown' });
      }
    }).catch(err => {
      console.error('[Background] SLATE_INSERT_TEXT error:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  // Batch download multiple images
  if (message.action === 'downloadImages') {
    const { images, subfolder } = message as { 
      images: Array<{ url: string; filename: string }>; 
      subfolder?: string;
    };
    
    (async () => {
      try {
        console.log('[Background] Batch downloading', images.length, 'images');
        
        const results: Array<{ filename: string; success: boolean; error?: string; downloadId?: number }> = [];
        
        for (const img of images) {
          try {
            const response = await fetch(img.url);
            if (!response.ok) {
              results.push({ filename: img.filename, success: false, error: `HTTP ${response.status}` });
              continue;
            }
            
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            
            const fullFilename = subfolder ? `${subfolder}/${img.filename}` : img.filename;
            
            const downloadId = await chrome.downloads.download({
              url: blobUrl,
              filename: fullFilename,
              saveAs: false,
            });
            
            // Clean up blob URL
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
            
            results.push({ filename: img.filename, success: true, downloadId });
            
            // Small delay between downloads to avoid overwhelming
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (err) {
            results.push({ filename: img.filename, success: false, error: String(err) });
          }
        }
        
        const successCount = results.filter(r => r.success).length;
        console.log('[Background] Batch download complete:', successCount, '/', images.length, 'succeeded');
        
        sendResponse({ success: true, results, successCount, totalCount: images.length });
      } catch (error) {
        console.error('[Background] Batch download error:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();
    
    return true;
  }

  // Batch download images from data URLs (content script already fetched the images)
  if (message.action === 'downloadImagesFromDataUrls') {
    const { images, subfolder } = message as { 
      images: Array<{ dataUrl: string; filename: string }>; 
      subfolder?: string;
    };
    
    (async () => {
      try {
        console.log('[Background] Downloading', images.length, 'images from data URLs');
        
        const results: Array<{ filename: string; success: boolean; error?: string; downloadId?: number }> = [];
        
        for (const img of images) {
          try {
            const fullFilename = subfolder ? `${subfolder}/${img.filename}` : img.filename;
            
            // Data URLs can be used directly with chrome.downloads
            const downloadId = await chrome.downloads.download({
              url: img.dataUrl,
              filename: fullFilename,
              saveAs: false,
            });
            
            console.log('[Background] Download started:', { downloadId, filename: fullFilename });
            results.push({ filename: img.filename, success: true, downloadId });
            
            // Small delay between downloads
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (err) {
            console.error('[Background] Download error for', img.filename, ':', err);
            results.push({ filename: img.filename, success: false, error: String(err) });
          }
        }
        
        const successCount = results.filter(r => r.success).length;
        console.log('[Background] Batch download complete:', successCount, '/', images.length, 'succeeded');
        
        sendResponse({ success: true, results, successCount, totalCount: images.length });
      } catch (error) {
        console.error('[Background] Batch download error:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();
    
    return true;
  }

  // Arm the download-to-folder redirect: the next .mp4 download will be saved to ShopEnginX/ subfolder
  // via the onDeterminingFilename listener below. Content script sends this before clicking the download link.
  if (message.action === 'armDownloadToFolder') {
    downloadToFolderArmed = true;
    // Auto-disarm after 60 seconds (safety net)
    if (downloadToFolderTimer) clearTimeout(downloadToFolderTimer);
    downloadToFolderTimer = setTimeout(() => { downloadToFolderArmed = false; }, 60000);
    console.log('[Background] Download-to-folder armed (next .mp4 will go to ShopEnginX/)');
    sendResponse({ success: true });
    return false;
  }
})

// ─── Download-to-folder: redirect .mp4 downloads to ShopEnginX/ subfolder ───
// When armed by the content script, the next video download gets its filename
// prefixed with "ShopEnginX/" so it lands in that subfolder under Downloads.
let downloadToFolderArmed = false;
let downloadToFolderTimer: ReturnType<typeof setTimeout> | null = null;

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  if (downloadToFolderArmed && downloadItem.filename.endsWith('.mp4')) {
    downloadToFolderArmed = false;
    if (downloadToFolderTimer) { clearTimeout(downloadToFolderTimer); downloadToFolderTimer = null; }
    const redirected = `ShopEnginX/${downloadItem.filename}`;
    console.log(`[Background] Redirecting download to: ${redirected}`);
    suggest({ filename: redirected, conflictAction: 'uniquify' });
  } else {
    suggest();
  }
});

console.log('ShopEnginX background service worker loaded')
