// Background service worker

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error))

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
})

console.log('ShopEnginX background service worker loaded')
