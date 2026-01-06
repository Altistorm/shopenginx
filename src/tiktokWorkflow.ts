// TikTok Auto-Follow Workflow
import { getKeepAliveManager } from './keepAlive';

export interface TikTokConfig {
  maxFollowers: number
  keywords: string[]
  minDelay: number
  maxDelay: number
  skipThreshold: number
  cycleThreshold: number
  urls: string[]
  waitTimeMin: number  // Rate limit wait time in minutes
  waitTimeMax: number
}

// Following list data for pre-check optimization
export interface FollowingListData {
  userIds: string[]       // List of followed user IDs
  lastUpdated: number     // Timestamp of last fetch
  count: number           // Total count
  fetchedBy: string       // Username who fetched (for multi-account support)
}

export interface TikTokState {
  isRunning: boolean
  isPaused: boolean
  currentUrlIndex: number
  skipCount: number
  cycleCount: number
  followCount: number
  profilesChecked: number
  status: string
  nextResumeTime: number | null  // Timestamp
  lastError: string | null
}

export interface TikTokProfile {
  element: Element
  name: string
  followerCount: number
  followerText: string
  isFollowing: boolean
  buttonElement: Element | null
}

export const DEFAULT_CONFIG: TikTokConfig = {
  maxFollowers: 2000,
  keywords: ['ติดตาม', 'ฟอล', 'แลก', 'ใจกลับ', 'ตามกลับ', 'ตาม กลับ', 'ใจ กลับ', 'เพิ่มเพื่อน'],
  minDelay: 1.2,
  maxDelay: 1.8,
  skipThreshold: 40,
  cycleThreshold: 3,
  urls: [
    'https://www.tiktok.com/search/user?q=%E0%B9%81%E0%B8%A5%E0%B8%81%E0%B8%9F%E0%B8%AD%E0%B8%A5&t=1766902207982',
    'https://www.tiktok.com/search/user?q=%E0%B8%9F%E0%B8%AD%E0%B8%A5%E0%B8%81%E0%B8%A5%E0%B8%B1%E0%B8%9A&t=1766902855595',
    'https://www.tiktok.com/search/user?q=%E0%B9%83%E0%B8%88%E0%B8%81%E0%B8%A5%E0%B8%B1%E0%B8%9A&t=1766979267915',
    'https://www.tiktok.com/search/user?q=%E0%B8%95%E0%B8%B2%E0%B8%A1%E0%B8%81%E0%B8%A5%E0%B8%B1%E0%B8%9A&t=1767004816761',
    'https://www.tiktok.com/search/user?q=%E0%B9%80%E0%B8%9E%E0%B8%B4%E0%B9%88%E0%B8%A1%E0%B9%80%E0%B8%9E%E0%B8%B7%E0%B9%88%E0%B8%AD%E0%B8%99&t=1767067767041',
    'https://www.tiktok.com/search/user?q=%E0%B9%81%E0%B8%A5%E0%B8%81%E0%B9%80%E0%B8%9E%E0%B8%B7%E0%B9%88%E0%B8%AD%E0%B8%99&t=1767067826560',
    'https://www.tiktok.com/search/user?q=%E0%B9%81%E0%B8%A5%E0%B8%81%E0%B8%9C%E0%B8%B9%E0%B9%89%E0%B8%95%E0%B8%B4%E0%B8%94%E0%B8%95%E0%B8%B2%E0%B8%A1&t=1767069176479',
    'https://www.tiktok.com/search/user?q=%E0%B9%80%E0%B8%9E%E0%B8%B4%E0%B9%88%E0%B8%A1%E0%B8%9C%E0%B8%B9%E0%B9%89%E0%B8%95%E0%B8%B4%E0%B8%94%E0%B8%95%E0%B8%B2%E0%B8%A1&t=1767069130615'
  ],
  waitTimeMin: 65,
  waitTimeMax: 75
}

export const INITIAL_STATE: TikTokState = {
  isRunning: false,
  isPaused: false,
  currentUrlIndex: 0,
  skipCount: 0,
  cycleCount: 0,
  followCount: 0,
  profilesChecked: 0,
  status: 'Idle',
  nextResumeTime: null,
  lastError: null
}

// Storage keys
const CONFIG_KEY = 'tiktok_follow_config'
const STATE_KEY = 'tiktok_follow_state'
const FOLLOWING_LIST_KEY = 'tiktok_following_list'

// Default empty following list
export const EMPTY_FOLLOWING_LIST: FollowingListData = {
  userIds: [],
  lastUpdated: 0,
  count: 0,
  fetchedBy: ''
}

// Load config from chrome.storage.local
export async function loadConfig(): Promise<TikTokConfig> {
  try {
    const result = await chrome.storage.local.get(CONFIG_KEY)
    if (result[CONFIG_KEY]) {
      return { ...DEFAULT_CONFIG, ...result[CONFIG_KEY] }
    }
  } catch (e) {
    console.error('Failed to load TikTok config:', e)
  }
  return { ...DEFAULT_CONFIG }
}

// Save config to chrome.storage.local
export function saveConfig(config: TikTokConfig): void {
  chrome.storage.local.set({ [CONFIG_KEY]: config }).catch(e => {
    console.error('Failed to save TikTok config:', e)
  })
}

// Load state from chrome.storage.local
export async function loadState(): Promise<TikTokState> {
  try {
    const result = await chrome.storage.local.get(STATE_KEY)
    if (result[STATE_KEY]) {
      const state = result[STATE_KEY]
      // Check if we were paused and should resume
      if (state.isPaused && state.nextResumeTime) {
        if (Date.now() >= state.nextResumeTime) {
          // Time to resume - reset state
          return { ...INITIAL_STATE }
        }
      }
      return { ...INITIAL_STATE, ...state }
    }
  } catch (e) {
    console.error('Failed to load TikTok state:', e)
  }
  return { ...INITIAL_STATE }
}

// Save state to chrome.storage.local
export function saveState(state: TikTokState): void {
  chrome.storage.local.set({ [STATE_KEY]: state }).catch(e => {
    console.error('Failed to save TikTok state:', e)
  })
}

// Load following list from chrome.storage.local
export async function loadFollowingList(): Promise<FollowingListData> {
  try {
    const result = await chrome.storage.local.get(FOLLOWING_LIST_KEY)
    if (result[FOLLOWING_LIST_KEY]) {
      return { ...EMPTY_FOLLOWING_LIST, ...result[FOLLOWING_LIST_KEY] }
    }
  } catch (e) {
    console.error('Failed to load following list:', e)
  }
  return { ...EMPTY_FOLLOWING_LIST }
}

// Save following list to chrome.storage.local
export function saveFollowingList(data: FollowingListData): void {
  chrome.storage.local.set({ [FOLLOWING_LIST_KEY]: data }).catch(e => {
    console.error('Failed to save following list:', e)
  })
}

// Add a single user ID to the following list (for auto-add on follow)
export async function addToFollowingList(userId: string): Promise<void> {
  try {
    const current = await loadFollowingList()
    if (!current.userIds.includes(userId)) {
      current.userIds.push(userId)
      current.count = current.userIds.length
      current.lastUpdated = Date.now()
      saveFollowingList(current)
      console.log('[TikTok] Added user to following list:', userId, 'Total:', current.count)

      // Send real-time update to UI
      chrome.runtime.sendMessage({
        type: 'TIKTOK_FOLLOWING_LIST_UPDATED',
        count: current.count
      }).catch(() => {}) // Ignore if popup closed
    }
  } catch (e) {
    console.error('Failed to add to following list:', e)
  }
}

// Clear following list
export function clearFollowingList(): void {
  saveFollowingList({ ...EMPTY_FOLLOWING_LIST })
  console.log('[TikTok] Following list cleared')
}

// Random delay helper
export function randomDelay(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

// Sleep helper
export function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
}

// Parse follower count from text (handles K, M suffixes)
export function parseFollowerCount(text: string): number {
  const cleaned = text.replace(/[,\s]/g, '').toLowerCase()
  const match = cleaned.match(/([\d.]+)([km]?)/)
  if (!match) return 0

  let num = parseFloat(match[1])
  const suffix = match[2]

  if (suffix === 'k') num *= 1000
  if (suffix === 'm') num *= 1000000

  return Math.floor(num)
}

// Check if name contains any of the keywords
export function nameContainsKeyword(name: string, keywords: string[]): boolean {
  const lowerName = name.toLowerCase()
  return keywords.some(keyword => lowerName.includes(keyword.toLowerCase()))
}

// Message sender helper for content script communication
export async function sendToContent(tabId: number, message: any): Promise<any> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message })
      } else {
        resolve(response || { success: false, error: 'No response' })
      }
    })
  })
}

// Find or create TikTok tab
export async function findOrCreateTikTokTab(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: 'https://www.tiktok.com/*' }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id) {
        // Update existing tab with new URL
        chrome.tabs.update(tabs[0].id, { url, active: true }, () => {
          resolve(tabs[0].id!)
        })
      } else {
        // Create new tab
        chrome.tabs.create({ url, active: true }, (tab) => {
          resolve(tab.id || null)
        })
      }
    })
  })
}

// Wait for page to be ready
export async function waitForPageReady(tabId: number, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await sendToContent(tabId, { type: 'TIKTOK_CHECK_PAGE_READY' })
    if (response.success && response.ready) {
      return true
    }
    await sleep(1)
  }
  return false
}

// Wait for profile page to be ready (NEW layout)
export async function waitForProfilePageReady(tabId: number, maxAttempts = 15): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await sendToContent(tabId, { type: 'TIKTOK_CHECK_PROFILE_PAGE_READY' })
    if (response.success && response.ready) {
      return true
    }
    await sleep(0.5)
  }
  return false
}

// Follow user via profile page navigation (NEW layout workflow)
// Opens profile in NEW TAB, follows, closes tab, returns to search tab
export async function followViaProfilePage(
  tabId: number,
  profileUrl: string,
  _searchUrl: string
): Promise<{ success: boolean; action?: string; error?: string }> {
  let profileTabId: number | null = null

  try {
    console.log('[TikTok] followViaProfilePage - Opening profile in new tab:', profileUrl)

    // Create new tab for profile - MUST be active for content script to run properly
    const profileTab = await chrome.tabs.create({
      url: profileUrl,
      active: true
    })
    profileTabId = profileTab.id || null

    if (!profileTabId) {
      return { success: false, error: 'Failed to create profile tab' }
    }

    console.log('[TikTok] followViaProfilePage - Created profile tab:', profileTabId)

    // Wait for tab to complete loading
    await new Promise<void>((resolve) => {
      const checkTab = setInterval(async () => {
        try {
          const tab = await chrome.tabs.get(profileTabId!)
          if (tab.status === 'complete') {
            clearInterval(checkTab)
            resolve()
          }
        } catch {
          clearInterval(checkTab)
          resolve()
        }
      }, 500)
      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(checkTab)
        resolve()
      }, 10000)
    })

    // Additional wait for content script injection and DOM rendering
    await sleep(2)

    // Wait for profile page to be ready with follow button (with retries)
    let ready = await waitForProfilePageReady(profileTabId)
    console.log('[TikTok] followViaProfilePage - Profile page ready (attempt 1):', ready)

    if (!ready) {
      console.log('[TikTok] followViaProfilePage - Retrying...')
      await sleep(2)
      ready = await waitForProfilePageReady(profileTabId)
      console.log('[TikTok] followViaProfilePage - Profile page ready (attempt 2):', ready)
    }

    if (!ready) {
      console.log('[TikTok] followViaProfilePage - Profile page did not load after retries')
      await chrome.tabs.remove(profileTabId)
      return { success: false, error: 'Profile page did not load' }
    }

    // Click follow button on profile tab
    const result = await sendToContent(profileTabId, { type: 'TIKTOK_PROFILE_CLICK_FOLLOW' })
    console.log('[TikTok] followViaProfilePage - Follow result:', result)

    // Wait for action to register
    await sleep(1)

    // Close the profile tab
    console.log('[TikTok] followViaProfilePage - Closing profile tab')
    await chrome.tabs.remove(profileTabId)
    profileTabId = null

    // Focus back on search tab
    await chrome.tabs.update(tabId, { active: true })

    return result
  } catch (e) {
    console.log('[TikTok] followViaProfilePage - Error:', e)

    // Clean up: close profile tab if still open
    if (profileTabId) {
      try {
        await chrome.tabs.remove(profileTabId)
      } catch {
        // Tab might already be closed
      }
    }

    // Focus back on search tab
    try {
      await chrome.tabs.update(tabId, { active: true })
    } catch {
      // Ignore
    }

    return { success: false, error: String(e) }
  }
}

// Main workflow class
export class TikTokFollowWorkflow {
  private config: TikTokConfig
  private state: TikTokState
  private tabId: number | null = null
  private onStateChange: ((state: TikTokState) => void) | null = null
  private abortController: AbortController | null = null
  private processedProfiles: Set<string> = new Set()
  private followingUserIds: Set<string> = new Set()  // Pre-loaded following list for skip check
  private keepAliveManager = getKeepAliveManager()
  private consecutiveNoResults: number = 0

  constructor(
    config: TikTokConfig,
    state: TikTokState,
    onStateChange?: (state: TikTokState) => void
  ) {
    this.config = config
    this.state = { ...state }
    this.onStateChange = onStateChange || null
  }

  private updateState(updates: Partial<TikTokState>) {
    const prevSkipCount = this.state.skipCount
    this.state = { ...this.state, ...updates }
    saveState(this.state)
    console.log('[TikTok] updateState - skipCount:', prevSkipCount, '->', this.state.skipCount, 'onStateChange exists:', !!this.onStateChange)
    if (this.onStateChange) {
      console.log('[TikTok] Calling onStateChange with state:', JSON.stringify({ skipCount: this.state.skipCount, status: this.state.status }))
      this.onStateChange(this.state)
    }
  }

  async start() {
    if (this.state.isRunning) return

    this.abortController = new AbortController()
    this.processedProfiles.clear()

    // Load following list for pre-skip check
    const followingListData = await loadFollowingList()
    this.followingUserIds = new Set(followingListData.userIds)
    console.log('[TikTok] Loaded following list:', this.followingUserIds.size, 'users')

    this.updateState({
      isRunning: true,
      isPaused: false,
      status: 'Starting...',
      lastError: null
    })

    // Start keep-alive to prevent throttling when browser is minimized
    this.keepAliveManager.start()
    console.log('[TikTok] Keep-alive started')

    try {
      await this.runWorkflow()
    } catch (error) {
      if ((error as Error).message !== 'ABORTED') {
        this.updateState({
          isRunning: false,
          status: 'Error',
          lastError: String(error)
        })
        // Only stop keep-alive on error (not on rate limit which calls runWorkflow recursively)
        this.keepAliveManager.stop()
        console.log('[TikTok] Keep-alive stopped (error)')
      }
    }
    // Note: keep-alive is stopped in stop() method, not here
    // This allows handleRateLimit() to recursively call runWorkflow() without stopping keep-alive
  }

  stop() {
    this.abortController?.abort()
    // Stop rate limit observer
    if (this.tabId) {
      sendToContent(this.tabId, { type: 'TIKTOK_STOP_RATE_LIMIT_OBSERVER' })
    }
    // Stop keep-alive
    this.keepAliveManager.stop()
    console.log('[TikTok] Keep-alive stopped (via stop())')

    this.updateState({
      isRunning: false,
      isPaused: false,
      status: 'Stopped',
      nextResumeTime: null
    })
  }

  private checkAborted() {
    if (this.abortController?.signal.aborted) {
      throw new Error('ABORTED')
    }
  }

  private async runWorkflow() {
    console.log('[TikTok] === runWorkflow() START ===')

    // Step 1: Open TikTok URL
    this.updateState({ status: 'Opening TikTok...' })
    const url = this.config.urls[this.state.currentUrlIndex]
    console.log('[TikTok] Opening URL:', url)
    this.tabId = await findOrCreateTikTokTab(url)
    console.log('[TikTok] Tab ID:', this.tabId)

    if (!this.tabId) {
      throw new Error('Failed to create TikTok tab')
    }

    // Wait for page to load
    this.updateState({ status: 'Waiting for page...' })
    await sleep(3)
    this.checkAborted()

    const pageReady = await waitForPageReady(this.tabId)
    console.log('[TikTok] Page ready:', pageReady)
    if (!pageReady) {
      throw new Error('Page did not load in time')
    }

    // Start rate limit observer (watches for toast notifications)
    this.updateState({ status: 'Starting rate limit observer...' })
    const observerResult = await sendToContent(this.tabId, { type: 'TIKTOK_START_RATE_LIMIT_OBSERVER' })
    console.log('[TikTok] Rate limit observer started:', observerResult)

    // Step 2: Click Users tab
    this.updateState({ status: 'Clicking Users tab...' })
    await sleep(1)
    const usersTabResult = await sendToContent(this.tabId, { type: 'TIKTOK_CLICK_USERS_TAB' })
    console.log('[TikTok] Users tab click result:', usersTabResult)
    if (!usersTabResult.success) {
      console.warn('[TikTok] Failed to click Users tab:', usersTabResult.error)
      // Continue anyway - might already be on Users tab
    }
    await sleep(2)
    this.checkAborted()

    // Step 2.5: Check for "No results found" - if detected, switch to next URL
    const noResultsCheck = await sendToContent(this.tabId, { type: 'TIKTOK_CHECK_NO_RESULTS' })
    console.log('[TikTok] No results check:', noResultsCheck)
    if (noResultsCheck.success && noResultsCheck.noResults) {
      this.consecutiveNoResults++
      console.log('[TikTok] No results found for current URL. Consecutive:', this.consecutiveNoResults, '/', this.config.urls.length)

      // If all URLs have no results, trigger rate limit wait
      if (this.consecutiveNoResults >= this.config.urls.length) {
        console.log('[TikTok] All URLs returned no results - triggering rate limit wait...')
        this.updateState({ status: 'All URLs empty - waiting...' })
        this.consecutiveNoResults = 0
        await this.handleRateLimit()
        return
      }

      // Switch to next URL
      this.updateState({
        currentUrlIndex: (this.state.currentUrlIndex + 1) % this.config.urls.length,
        status: 'No results - switching URL...'
      })
      this.processedProfiles.clear()
      // Restart with new URL
      await this.runWorkflow()
      return
    }

    // Reset counter when results are found
    this.consecutiveNoResults = 0

    console.log('[TikTok] === Entering profileLoop() ===')
    // Step 3: Main loop - scan and follow profiles
    await this.profileLoop()
  }

  private async profileLoop() {
    console.log('[TikTok] profileLoop() started')
    console.log('[TikTok] Config:', {
      skipThreshold: this.config.skipThreshold,
      cycleThreshold: this.config.cycleThreshold,
      maxFollowers: this.config.maxFollowers,
      keywords: this.config.keywords
    })

    while (this.state.isRunning && !this.abortController?.signal.aborted) {
      this.checkAborted()

      console.log('[TikTok] Loop iteration - State:', {
        skipCount: this.state.skipCount,
        cycleCount: this.state.cycleCount,
        followCount: this.state.followCount,
        profilesChecked: this.state.profilesChecked
      })

      // Check if we need to switch URLs
      if (this.state.cycleCount >= this.config.cycleThreshold) {
        console.log('[TikTok] TRIGGER: cycleCount >= cycleThreshold, switching URL')
        this.updateState({
          cycleCount: 0,
          currentUrlIndex: (this.state.currentUrlIndex + 1) % this.config.urls.length,
          status: 'Switching to next URL...'
        })
        this.processedProfiles.clear()
        // Restart with new URL
        await this.runWorkflow()
        return
      }

      // Check if we need to reload URL
      console.log('[TikTok] Skip check:', this.state.skipCount, '>=', this.config.skipThreshold, '?', this.state.skipCount >= this.config.skipThreshold, 'types:', typeof this.state.skipCount, typeof this.config.skipThreshold)
      if (this.state.skipCount >= this.config.skipThreshold) {
        console.log('[TikTok] TRIGGER: skipCount >= skipThreshold, reloading page')
        this.updateState({
          skipCount: 0,
          cycleCount: this.state.cycleCount + 1,
          status: 'Reloading page...'
        })
        this.processedProfiles.clear()
        // Reload same URL
        const url = this.config.urls[this.state.currentUrlIndex]
        await findOrCreateTikTokTab(url)
        await sleep(3)

        // Click Users tab again
        if (this.tabId) {
          await sendToContent(this.tabId, { type: 'TIKTOK_CLICK_USERS_TAB' })
          await sleep(2)
        }
        continue
      }

      // Get profiles from page
      this.updateState({ status: 'Scanning profiles...' })
      const profilesResult = await sendToContent(this.tabId!, { type: 'TIKTOK_GET_PROFILES' })
      const isNewLayout = profilesResult.isNewLayout || false
      const searchUrl = this.config.urls[this.state.currentUrlIndex]

      console.log('[TikTok] GET_PROFILES result:', {
        success: profilesResult.success,
        profileCount: profilesResult.profiles?.length || 0,
        isNewLayout,
        error: profilesResult.error
      })

      if (!profilesResult.success || !profilesResult.profiles?.length) {
        // Scroll to load more
        console.log('[TikTok] No profiles found, scrolling...')
        this.updateState({ status: 'Scrolling for more...' })
        await sendToContent(this.tabId!, { type: 'TIKTOK_SCROLL_FOR_MORE' })
        await sleep(2)
        continue
      }

      // Process each profile
      let foundNewProfile = false
      console.log('[TikTok] Processing', profilesResult.profiles.length, 'profiles, isNewLayout:', isNewLayout)

      for (const profile of profilesResult.profiles) {
        this.checkAborted()

        // Skip already processed - use username as unique key (not index-based ID)
        if (this.processedProfiles.has(profile.username)) {
          continue
        }
        this.processedProfiles.add(profile.username)
        foundNewProfile = true

        console.log('[TikTok] Checking profile:', {
          id: profile.id,
          name: profile.name,
          followerText: profile.followerText,
          isFollowing: profile.isFollowing,
          isNewLayout: profile.isNewLayout,
          profileUrl: profile.profileUrl?.substring(0, 50)
        })

        this.updateState({
          profilesChecked: this.state.profilesChecked + 1,
          status: `Checking: ${profile.name.substring(0, 20)}...`
        })

        // Check if already following - ONLY for OLD layout (new layout can't determine from search)
        if (!isNewLayout && profile.isFollowing) {
          const newSkipCount = this.state.skipCount + 1
          console.log(`[TikTok] SKIP: already following (skipCount: ${newSkipCount}/${this.config.skipThreshold})`)
          this.updateState({
            skipCount: newSkipCount,
            status: `Skipped (already following): ${profile.name.substring(0, 15)}...`
          })
          // Break out of for loop if threshold reached - let while loop handle reload
          if (newSkipCount >= this.config.skipThreshold) {
            console.log('[TikTok] Skip threshold reached inside for loop, breaking out')
            break
          }
          continue
        }

        // Check follower count - does NOT count towards skipCount
        const followers = parseFollowerCount(profile.followerText)
        console.log('[TikTok] Parsed follower count:', followers, 'from text:', profile.followerText)
        if (followers >= this.config.maxFollowers) {
          console.log('[TikTok] SKIP: too many followers', followers, '>=', this.config.maxFollowers, '(no threshold count)')
          this.updateState({
            status: `Skipped (${followers} followers): ${profile.name.substring(0, 15)}...`
          })
          continue
        }

        // Check keywords - use searchableText (nickname + bio) for new layout
        const textToCheck = profile.searchableText || profile.name
        if (!nameContainsKeyword(textToCheck, this.config.keywords)) {
          console.log('[TikTok] SKIP: no keyword match in searchableText (no threshold count)')
          this.updateState({
            status: `Skipped (no keyword): ${profile.name.substring(0, 15)}...`
          })
          continue
        }

        // Check following list (pre-skip optimization) - AFTER keyword check
        // Use username as user ID since it's the unique identifier we can access
        if (this.followingUserIds.has(profile.username)) {
          const newSkipCount = this.state.skipCount + 1
          console.log(`[TikTok] PRE-SKIP: in following list (skipCount: ${newSkipCount}/${this.config.skipThreshold})`)
          this.updateState({
            skipCount: newSkipCount,
            status: `Pre-skipped (following): ${profile.name.substring(0, 15)}...`
          })
          // Break out of for loop if threshold reached - let while loop handle reload
          if (newSkipCount >= this.config.skipThreshold) {
            console.log('[TikTok] Skip threshold reached from pre-skip, breaking out')
            break
          }
          continue
        }

        // All criteria passed - follow!
        console.log('[TikTok] MATCH! Following:', profile.name, 'isNewLayout:', isNewLayout)

        if (isNewLayout && profile.profileUrl) {
          // NEW LAYOUT: Navigate to profile page to follow
          this.updateState({ status: `Opening: ${profile.name.substring(0, 15)}...` })

          const followResult = await followViaProfilePage(this.tabId!, profile.profileUrl, searchUrl)
          console.log('[TikTok] Profile page follow result:', followResult)

          if (followResult.action === 'already_following') {
            // Discovered already following on profile page - add to following list for future pre-skip
            this.followingUserIds.add(profile.username)
            addToFollowingList(profile.username)

            const newSkipCount = this.state.skipCount + 1
            console.log(`[TikTok] Already following (discovered on profile) - added to list, skipCount: ${newSkipCount}/${this.config.skipThreshold}`)
            this.updateState({
              skipCount: newSkipCount,
              status: `Already following: ${profile.name.substring(0, 15)}...`
            })
            // Break out of for loop if threshold reached - let while loop handle reload
            if (newSkipCount >= this.config.skipThreshold) {
              console.log('[TikTok] Skip threshold reached inside for loop, breaking out')
              break
            }
          } else if (followResult.success && followResult.action === 'followed') {
            this.updateState({
              followCount: this.state.followCount + 1,
              status: `Followed: ${profile.name.substring(0, 20)}`
            })

            // Auto-add to following list for future pre-skip
            this.followingUserIds.add(profile.username)
            addToFollowingList(profile.username)

            // Check for rate limit after follow
            await sleep(0.5)
            const rateLimitResult = await sendToContent(this.tabId!, { type: 'TIKTOK_CHECK_RATE_LIMIT' })
            if (rateLimitResult.rateLimited) {
              await this.handleRateLimit()
              return
            }

            // Random delay after follow
            const delay = randomDelay(this.config.minDelay, this.config.maxDelay)
            this.updateState({ status: `Waiting ${delay.toFixed(1)}s...` })
            await sleep(delay)
          } else {
            console.warn('[TikTok] Failed to follow via profile:', followResult.error)
          }
        } else {
          // OLD LAYOUT: Click follow directly on search page
          this.updateState({ status: `Following: ${profile.name.substring(0, 20)}...` })
          const followResult = await sendToContent(this.tabId!, {
            type: 'TIKTOK_CLICK_FOLLOW',
            profileId: profile.id
          })
          console.log('[TikTok] Follow click result:', followResult)

          if (followResult.success) {
            this.updateState({
              followCount: this.state.followCount + 1,
              status: `Followed: ${profile.name.substring(0, 20)}`
            })

            // Auto-add to following list for future pre-skip
            this.followingUserIds.add(profile.username)
            addToFollowingList(profile.username)

            // Wait a moment for any toast notification to appear
            await sleep(0.5)

            // Check for rate limit message
            const rateLimitResult = await sendToContent(this.tabId!, { type: 'TIKTOK_CHECK_RATE_LIMIT' })
            if (rateLimitResult.rateLimited) {
              await this.handleRateLimit()
              return
            }

            // Random delay after follow
            const delay = randomDelay(this.config.minDelay, this.config.maxDelay)
            this.updateState({ status: `Waiting ${delay.toFixed(1)}s...` })
            await sleep(delay)
          } else {
            console.warn('Failed to follow:', followResult.error)
          }
        }
      }

      // If no new profiles found, scroll for more
      if (!foundNewProfile) {
        console.log('[TikTok] No new profiles in current batch, scrolling...')
        console.log('[TikTok] Already processed:', this.processedProfiles.size, 'usernames')
        this.updateState({ status: 'Scrolling for more profiles...' })
        await sendToContent(this.tabId!, { type: 'TIKTOK_SCROLL_FOR_MORE' })
        await sleep(3) // Wait longer for new profiles to load
      }
    }
  }

  private async handleRateLimit() {
    const waitMinutes = randomDelay(this.config.waitTimeMin, this.config.waitTimeMax)
    const resumeTime = Date.now() + waitMinutes * 60 * 1000

    this.updateState({
      isPaused: true,
      status: `Rate limited - waiting ${Math.round(waitMinutes)} minutes...`,
      nextResumeTime: resumeTime
    })

    // Wait in 1-minute intervals to allow stopping
    const targetTime = Date.now() + waitMinutes * 60 * 1000
    while (Date.now() < targetTime) {
      this.checkAborted()
      const remaining = Math.ceil((targetTime - Date.now()) / 60000)
      this.updateState({
        status: `Rate limited - ${remaining} minutes remaining...`
      })
      await sleep(60)
    }

    // Reset and restart
    this.updateState({
      isPaused: false,
      skipCount: 0,
      cycleCount: 0,
      currentUrlIndex: 0,
      nextResumeTime: null,
      status: 'Resuming...'
    })
    this.processedProfiles.clear()

    // Restart workflow
    await this.runWorkflow()
  }

  getState(): TikTokState {
    return { ...this.state }
  }

  getConfig(): TikTokConfig {
    return { ...this.config }
  }

  updateConfig(config: Partial<TikTokConfig>) {
    this.config = { ...this.config, ...config }
    saveConfig(this.config)
  }
}
