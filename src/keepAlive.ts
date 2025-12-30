/**
 * KeepAlive - Prevents Chrome from throttling the extension when browser is minimized/unfocused
 *
 * Chrome throttles setTimeout/setInterval in background tabs to ~1 minute intervals.
 * This module provides strategies to keep the extension responsive.
 *
 * Strategies:
 * 1. PortKeepAlive - Maintains a port connection to background service worker
 * 2. AudioKeepAlive - Uses Web Audio API to prevent throttling (future)
 */

// Abstract interface for keep-alive strategies
export interface KeepAliveStrategy {
  start(): void;
  stop(): void;
  isActive(): boolean;
}

/**
 * PortKeepAlive - Uses chrome.runtime.connect to keep service worker alive
 *
 * When a port is connected, Chrome keeps the service worker running.
 * We also send periodic pings to ensure the connection stays active.
 */
export class PortKeepAlive implements KeepAliveStrategy {
  private port: chrome.runtime.Port | null = null;
  private pingInterval: number | null = null;
  private readonly PING_INTERVAL_MS = 20000; // Ping every 20 seconds

  start(): void {
    if (this.port) {
      console.log('[PortKeepAlive] Already active');
      return;
    }

    console.log('[PortKeepAlive] Starting keep-alive connection');
    this.port = chrome.runtime.connect({ name: 'keepalive' });

    this.port.onDisconnect.addListener(() => {
      console.log('[PortKeepAlive] Port disconnected, reconnecting...');
      this.port = null;
      if (this.pingInterval) {
        // Reconnect if we were supposed to stay alive
        setTimeout(() => this.start(), 100);
      }
    });

    // Send periodic pings to keep connection active
    this.pingInterval = window.setInterval(() => {
      if (this.port) {
        this.port.postMessage({ type: 'ping' });
      }
    }, this.PING_INTERVAL_MS);
  }

  stop(): void {
    console.log('[PortKeepAlive] Stopping keep-alive connection');

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.port) {
      this.port.disconnect();
      this.port = null;
    }
  }

  isActive(): boolean {
    return this.port !== null;
  }
}

/**
 * AudioKeepAlive - Uses Web Audio API to prevent throttling
 *
 * Creates an inaudible audio context that prevents Chrome from throttling.
 * This is a backup strategy if PortKeepAlive doesn't work reliably.
 *
 * TODO: Implement when needed
 */
export class AudioKeepAlive implements KeepAliveStrategy {
  private audioContext: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;

  start(): void {
    if (this.audioContext) {
      console.log('[AudioKeepAlive] Already active');
      return;
    }

    console.log('[AudioKeepAlive] Starting audio keep-alive');

    try {
      this.audioContext = new AudioContext();

      // Create an oscillator (generates sound)
      this.oscillator = this.audioContext.createOscillator();
      this.oscillator.frequency.value = 20000; // 20kHz - inaudible to most humans
      this.oscillator.type = 'sine';

      // Create a gain node to control volume (set to 0 = silent)
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 0.00001; // Nearly silent but keeps context active

      // Connect: oscillator -> gain -> destination
      this.oscillator.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      // Start the oscillator
      this.oscillator.start();

      console.log('[AudioKeepAlive] Audio context started');
    } catch (error) {
      console.error('[AudioKeepAlive] Failed to start:', error);
    }
  }

  stop(): void {
    console.log('[AudioKeepAlive] Stopping audio keep-alive');

    if (this.oscillator) {
      this.oscillator.stop();
      this.oscillator.disconnect();
      this.oscillator = null;
    }

    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  isActive(): boolean {
    return this.audioContext !== null && this.audioContext.state === 'running';
  }
}

/**
 * KeepAliveManager - Manages keep-alive strategies with fallback support
 */
export class KeepAliveManager {
  private strategies: KeepAliveStrategy[] = [];
  private activeStrategy: KeepAliveStrategy | null = null;

  constructor(strategies: KeepAliveStrategy[]) {
    this.strategies = strategies;
  }

  start(): void {
    if (this.activeStrategy?.isActive()) {
      console.log('[KeepAliveManager] Already active');
      return;
    }

    // Try strategies in order until one works
    for (const strategy of this.strategies) {
      try {
        strategy.start();
        if (strategy.isActive()) {
          this.activeStrategy = strategy;
          console.log('[KeepAliveManager] Started with strategy:', strategy.constructor.name);
          return;
        }
      } catch (error) {
        console.warn('[KeepAliveManager] Strategy failed:', strategy.constructor.name, error);
      }
    }

    console.error('[KeepAliveManager] All strategies failed');
  }

  stop(): void {
    if (this.activeStrategy) {
      this.activeStrategy.stop();
      this.activeStrategy = null;
    }
  }

  isActive(): boolean {
    return this.activeStrategy?.isActive() ?? false;
  }
}

// Default export: PortKeepAlive with AudioKeepAlive as fallback
export function createKeepAliveManager(): KeepAliveManager {
  return new KeepAliveManager([
    new PortKeepAlive(),
    new AudioKeepAlive(),
  ]);
}

// Singleton instance for easy use
let defaultManager: KeepAliveManager | null = null;

export function getKeepAliveManager(): KeepAliveManager {
  if (!defaultManager) {
    defaultManager = createKeepAliveManager();
  }
  return defaultManager;
}
