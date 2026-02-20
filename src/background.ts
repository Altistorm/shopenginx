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

  // Intercept video download: run script in page's MAIN world to capture data URI from React onClick,
  // then download to ShopEnginX/ folder via chrome.downloads.
  // This bypasses CSP restrictions that block inline <script> injection from content scripts.
  if (message.action === 'interceptVideoDownload') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'no tab id from sender' });
      return true;
    }

    (async () => {
      try {
        console.log('[Background] Intercepting video download in main world, tabId:', tabId);

        // Execute in the page's MAIN world to access React props
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: () => {
            return new Promise<{ capturedHref: string | null; capturedFilename: string | null; error?: string }>((resolve) => {
              try {
                const toast = document.querySelector('[data-sonner-toast]');
                if (!toast) { resolve({ capturedHref: null, capturedFilename: null, error: 'no toast' }); return; }
                const link = toast.querySelector('a');
                if (!link) { resolve({ capturedHref: null, capturedFilename: null, error: 'no link' }); return; }

                const propsKey = Object.keys(link).find((k) => k.indexOf('__reactProps$') === 0);
                if (!propsKey) { resolve({ capturedHref: null, capturedFilename: null, error: 'no reactProps' }); return; }
                const onClick = (link as Record<string, any>)[propsKey]?.onClick;
                if (!onClick) { resolve({ capturedHref: null, capturedFilename: null, error: 'no onClick' }); return; }

                let capturedHref: string | null = null;
                let capturedFilename: string | null = null;
                const origCreate = document.createElement.bind(document);

                (document as any).createElement = function(tag: string, opts?: ElementCreationOptions) {
                  const el = origCreate(tag, opts);
                  if (tag.toLowerCase() === 'a') {
                    const origClick = el.click.bind(el);
                    el.click = function() {
                      const anchor = el as HTMLAnchorElement;
                      if (anchor.href && anchor.href.indexOf('data:') === 0) {
                        capturedHref = anchor.href;
                        capturedFilename = anchor.download || null;
                        // Block original download
                      } else {
                        origClick();
                      }
                    };
                  }
                  return el;
                };

                onClick();

                setTimeout(() => {
                  (document as any).createElement = origCreate;
                  resolve({ capturedHref, capturedFilename });
                }, 3000);
              } catch (e) {
                resolve({ capturedHref: null, capturedFilename: null, error: String(e) });
              }
            });
          },
        });

        const result = results?.[0]?.result;
        if (!result || result.error || !result.capturedHref || !result.capturedFilename) {
          console.warn('[Background] Main-world intercept failed:', result?.error || 'no data');
          sendResponse({ success: false, error: result?.error || 'no data captured' });
          return;
        }

        console.log(`[Background] Captured: ${result.capturedFilename}, downloading to ShopEnginX/`);

        // Download the data URI directly via chrome.downloads
        const fullFilename = `ShopEnginX/${result.capturedFilename}`;
        const downloadId = await chrome.downloads.download({
          url: result.capturedHref,
          filename: fullFilename,
          saveAs: false,
        });

        console.log('[Background] Video download started:', { downloadId, filename: fullFilename });
        sendResponse({ success: true, downloadId, filename: fullFilename });
      } catch (error) {
        console.error('[Background] Intercept video download error:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();

    return true;
  }
})

console.log('ShopEnginX background service worker loaded')
