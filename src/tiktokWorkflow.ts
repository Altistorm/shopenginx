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
  maxFollowers: 1300,
  keywords: ['ติดตาม', 'ฟอล', 'แลก', 'ใจกลับ'],
  minDelay: 0.5,
  maxDelay: 1.5,
  skipThreshold: 20,
  cycleThreshold: 5,
  urls: [
    'https://www.tiktok.com/search?q=%E0%B9%81%E0%B8%A5%E0%B8%81%E0%B8%9F%E0%B8%AD%E0%B8%A5&t=1766902207982',
    'https://www.tiktok.com/search/user?q=%E0%B8%9F%E0%B8%AD%E0%B8%A5%E0%B8%81%E0%B8%A5%E0%B8%B1%E0%B8%9A&t=1766902855595'
  ],
  waitTimeMin: 60,  // 1 hour
  waitTimeMax: 90   // 1.5 hours
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

// Load config from localStorage
export function loadConfig(): TikTokConfig {
  try {
    const stored = localStorage.getItem(CONFIG_KEY)
    if (stored) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) }
    }
  } catch (e) {
    console.error('Failed to load TikTok config:', e)
  }
  return { ...DEFAULT_CONFIG }
}

// Save config to localStorage
export function saveConfig(config: TikTokConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  } catch (e) {
    console.error('Failed to save TikTok config:', e)
  }
}

// Load state from localStorage
export function loadState(): TikTokState {
  try {
    const stored = localStorage.getItem(STATE_KEY)
    if (stored) {
      const state = JSON.parse(stored)
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

// Save state to localStorage
export function saveState(state: TikTokState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state))
  } catch (e) {
    console.error('Failed to save TikTok state:', e)
  }
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

// Main workflow class
export class TikTokFollowWorkflow {
  private config: TikTokConfig
  private state: TikTokState
  private tabId: number | null = null
  private onStateChange: ((state: TikTokState) => void) | null = null
  private abortController: AbortController | null = null
  private processedProfiles: Set<string> = new Set()
  private keepAliveManager = getKeepAliveManager()

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
      }
    } finally {
      // Stop keep-alive when workflow ends
      this.keepAliveManager.stop()
      console.log('[TikTok] Keep-alive stopped')
    }
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
      console.log('[TikTok] GET_PROFILES result:', {
        success: profilesResult.success,
        profileCount: profilesResult.profiles?.length || 0,
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
      console.log('[TikTok] Processing', profilesResult.profiles.length, 'profiles')

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
          isFollowing: profile.isFollowing
        })

        this.updateState({
          profilesChecked: this.state.profilesChecked + 1,
          status: `Checking: ${profile.name.substring(0, 20)}...`
        })

        // Check if already following - ONLY this counts towards skipCount threshold
        if (profile.isFollowing) {
          const newSkipCount = this.state.skipCount + 1
          console.log(`[TikTok] SKIP: already following (skipCount: ${newSkipCount}/${this.config.skipThreshold})`)
          this.updateState({
            skipCount: newSkipCount,
            status: `Skipped (already following): ${profile.name.substring(0, 15)}...`
          })
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

        // Check keywords - does NOT count towards skipCount
        if (!nameContainsKeyword(profile.name, this.config.keywords)) {
          console.log('[TikTok] SKIP: no keyword match in name (no threshold count)')
          this.updateState({
            status: `Skipped (no keyword): ${profile.name.substring(0, 15)}...`
          })
          continue
        }

        // All criteria passed - follow!
        console.log('[TikTok] MATCH! Clicking follow for:', profile.name)
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
