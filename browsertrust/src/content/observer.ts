import type { ContentEventInput } from '../core/normalize';

export interface ObserverContext {
  /** Sends an event to the background pipeline. The source is attached there. */
  emit(event: ContentEventInput): void;
}

/**
 * A page-level source of events running in the content script's isolated world.
 *
 * Limits to keep in mind when writing one:
 * - It sees the DOM, but not the page's JavaScript objects or functions.
 *   Hooking page APIs (fetch, localStorage, clipboard, geolocation, ...)
 *   needs a separate script injected into the MAIN world.
 * - The page can tamper with the DOM it shares with this script.
 */
export interface ContentObserver {
  readonly id: string;
  start(context: ObserverContext): void;
  stop(): void;
}
