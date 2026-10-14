import type { BrowserTrustEvent } from '../shared/types';
import { createEvent, type NewEvent, type NormalizeDeps } from './normalize';
import type { EventStore } from './store';

export interface SenderInfo {
  url?: string;
  tabId?: number;
  frameId?: number;
}

export type EventListener = (event: BrowserTrustEvent) => unknown | Promise<unknown>;

/**
 * The single path every event takes: validate/normalize, store, notify.
 * Later phases subscribe analysis here; collectors never write to storage directly.
 */
export class EventPipeline {
  private readonly listeners = new Set<EventListener>();

  constructor(
    private readonly store: EventStore,
    private readonly deps: NormalizeDeps = {},
  ) {}

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async emit(input: NewEvent): Promise<BrowserTrustEvent> {
    const event = createEvent(input, this.deps);
    await this.store.append(event);
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (error) {
        console.error('BrowserTrust: event listener failed', error);
      }
    }
    return event;
  }

  /**
   * Ingests an event reported by a content-level observer. The page-controlled
   * context cannot choose its own source: it is rebuilt from the message sender.
   */
  async ingestFromContent(raw: unknown, sender: SenderInfo): Promise<BrowserTrustEvent> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('content event must be an object');
    }
    if (!sender.url) throw new Error('content event has no sender URL');
    const url = new URL(sender.url);
    const source = {
      origin: url.origin,
      url: `${url.origin}${url.pathname}`, // query and fragment dropped on purpose
      ...(sender.tabId !== undefined ? { tabId: sender.tabId } : {}),
      ...(sender.frameId !== undefined ? { frameId: sender.frameId } : {}),
    };
    return this.emit({ ...(raw as Omit<NewEvent, 'source'>), source });
  }
}
