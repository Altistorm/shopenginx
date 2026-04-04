/**
 * Target tab resolution utility.
 *
 * In production (real side panel) this queries Chrome for the active tab.
 * In test mode (side panel HTML opened as a regular tab with ?targetTabId=<id>)
 * it returns the explicit tab, so Playwright can drive the extension UI
 * while the target page sits in a separate tab.
 *
 * Usage — drop-in replacement:
 *   // Before:  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
 *   // After:   const [tab] = await queryTargetTab()
 */
export async function queryTargetTab(): Promise<chrome.tabs.Tab[]> {
  const params = new URLSearchParams(window.location.search)
  const testTabId = params.get('targetTabId')

  if (testTabId) {
    const tabId = parseInt(testTabId, 10)
    if (!isNaN(tabId)) {
      const tab = await chrome.tabs.get(tabId)
      return [tab]
    }
  }

  return chrome.tabs.query({ active: true, currentWindow: true })
}
