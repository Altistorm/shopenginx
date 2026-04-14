// Content Bridge - ISOLATED world relay between chrome.runtime and window.postMessage
// This file runs in ISOLATED world and has access to chrome.* APIs
// It relays messages between side panel (via chrome.runtime) and content-main.ts (via window.postMessage)

const SHOPENGINX_PREFIX = '__shopEnginX__';

// Relay: chrome.runtime.onMessage (from side panel) --> window.postMessage (to MAIN world)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Wrap and forward to content-main.ts in MAIN world
  window.postMessage(
    {
      [SHOPENGINX_PREFIX]: true,
      source: 'shopenginx-bridge',
      type: 'COMMAND',
      action: message.type,
      payload: message,
      timestamp: Date.now(),
    },
    '*'
  );

  // For sync responses, we'll handle reply via window message listener below
  // For now, return true to keep channel open (content-main will send response back)
  return true;
});

// Relay: window 'message' event (from content-main.ts in MAIN world) --> chrome.runtime.sendMessage (back to side panel)
window.addEventListener('message', (event) => {
  // Only accept messages from our own prefix
  if (!event.data || !event.data[SHOPENGINX_PREFIX]) {
    return;
  }

  // Ignore messages from ourselves
  if (event.data.source === 'shopenginx-bridge') {
    return;
  }

  const { type, action, payload, messageId } = event.data;

  if (type === 'RESPONSE') {
    // Relay response back to side panel via chrome.runtime
    chrome.runtime.sendMessage({
      type: 'CONTENT_RESPONSE',
      originalAction: action,
      payload: payload,
      success: payload?.success,
      error: payload?.error,
    }).catch(() => {
      // Side panel may not be listening, ignore
    });
  } else if (type === 'PROGRESS') {
    // Fire-and-forget progress updates to side panel
    chrome.runtime.sendMessage({
      type: 'CONTENT_PROGRESS',
      action: action,
      payload: payload,
    }).catch(() => {
      // Ignore errors for progress messages
    });
  }
});
