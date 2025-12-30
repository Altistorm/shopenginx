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
})

console.log('ShopEnginX background service worker loaded')
