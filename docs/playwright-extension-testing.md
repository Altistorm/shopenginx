# Playwright Extension Testing (Two-Tab Strategy)

Automate ShopEnginX side panel + target page testing using Playwright via CDP.

## Architecture

```
Playwright Script (Node.js)
│
├── connectOverCDP("http://localhost:9222")
│
├── Tab 1: Target page (labs.google/fx/tools/flow)
│   └── Content script auto-injects
│
├── Tab 2: chrome-extension://<id>/sidepanel.html?targetTabId=<tabId>
│   └── React app reads targetTabId from URL → queryTargetTab()
│
└── browser.close()  ← disconnects WebSocket only, Chrome stays open
```

## Why CDP?

`launchPersistentContext()` ties the browser lifetime to the Node process — when the script exits, the browser dies.

`connectOverCDP()` connects to an **independently running** Chrome. When the script finishes and calls `browser.close()`, it only disconnects the WebSocket. Chrome keeps running, tabs stay open for manual inspection.

| Method | On script exit |
|---|---|
| `chromium.launchPersistentContext()` | Browser **closes** |
| `chromium.connectOverCDP()` | Browser **stays open** |

## Setup

### 1. Launch Chrome with Extension

Start Playwright's Chromium with remote debugging and the extension loaded:

```powershell
$chromePath = "C:\Users\amorn.t\AppData\Local\ms-playwright\chromium-1217\chrome-win64\chrome.exe"
$extPath = "F:\Repository\ai-automation\shopenginx\dist"

Start-Process -FilePath $chromePath -ArgumentList `
  "--remote-debugging-port=9222", `
  "--disable-extensions-except=$extPath", `
  "--load-extension=$extPath", `
  "--no-first-run", `
  "--no-default-browser-check"
```

> Find `$chromePath` dynamically:
> ```powershell
> node -e "const {chromium} = require('playwright'); console.log(chromium.executablePath())"
> ```

### 2. Run Test Scripts

Scripts connect via CDP, test, disconnect. Run as many as you want — browser persists.

```bash
node tmp/test-image-tab.mjs
node tmp/test-style.mjs
# ... browser stays open between runs
```

### 3. Close Chrome

Close manually, or:

```powershell
Stop-Process -Name "chrome" -Force
```

## Test Script Template

```javascript
// test-example.mjs
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://localhost:9222");
const context = browser.contexts()[0];

// --- Reuse existing tabs or create new ones ---
let panel = context.pages().find(p => p.url().includes("sidepanel.html"));
let page = context.pages().find(p => p.url().includes("labs.google"));

if (!page) {
  // Get extension ID from service worker
  let sw = context.serviceWorkers()[0]
    || await context.waitForEvent("serviceworker", { timeout: 10000 });
  const extId = sw.url().split("/")[2];

  // Open target page
  page = await context.newPage();
  await page.goto("https://labs.google/fx/tools/flow");
  await page.waitForTimeout(3000);

  // Get Chrome tab ID
  const tabId = await sw.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url: url + "*" });
    return tabs.length > 0 ? tabs[0].id : null;
  }, page.url());

  // Open panel with targetTabId
  panel = await context.newPage();
  await panel.goto(
    `chrome-extension://${extId}/src/sidepanel.html?targetTabId=${tabId}`
  );
  await panel.waitForTimeout(3000);
  await panel.waitForLoadState("networkidle");
}

// --- Your test logic here ---
// Example: click Image tab
await panel.locator('a[role="tab"]', { hasText: "Image" }).click();
await panel.waitForTimeout(500);

// Example: change style
await panel.locator("select").first().selectOption("pixar_3d");

// Example: verify on target page
console.log("Target page URL:", page.url());

// Example: screenshot
await panel.screenshot({ path: "tmp/test-result.png" });

// Disconnect — browser stays open
await browser.close();
```

## How targetTabId Works

The `queryTargetTab()` utility in `src/targetTab.ts` checks for a `?targetTabId=<id>` URL parameter:

- **With param** (test mode): returns the explicit tab via `chrome.tabs.get(tabId)`
- **Without param** (production): falls back to `chrome.tabs.query({ active: true, currentWindow: true })`

This replaces all 17 `chrome.tabs.query({ active: true })` calls across the extension, making the two-tab testing strategy work without affecting production behavior.

## Prerequisites

- Vite dev server running (`npm run dev`) — the `dist/` build uses CRXJS dev mode
- Playwright installed (`npx playwright install chromium`)
- Extension ID: `edpgfoopcoplamhdcpkkfdlepikekjan`
