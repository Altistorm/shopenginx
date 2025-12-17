// Overlay module - sends messages to content script to display status

export const overlay = {
  async show(tabId: number, text: string): Promise<void> {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'OVERLAY_SHOW',
        text
      });
    } catch (e) {
      // Content script may not be ready
    }
  },

  async update(tabId: number, text: string): Promise<void> {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'OVERLAY_UPDATE',
        text
      });
    } catch (e) {
      // Content script may not be ready
    }
  },

  async hide(tabId: number): Promise<void> {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'OVERLAY_HIDE'
      });
    } catch (e) {
      // Content script may not be ready
    }
  },

  // Specific for node name display with optional state
  async showNodeName(tabId: number, nodeName: string, state?: Record<string, unknown>): Promise<void> {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'OVERLAY_NODE_NAME',
        text: nodeName,
        state
      });
    } catch (e) {
      // Content script may not be ready
    }
  }
};
