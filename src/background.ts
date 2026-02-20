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
