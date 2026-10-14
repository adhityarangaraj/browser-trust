import type { BrowserTrustEvent } from '../shared/types';
import { validateEvent } from './normalize';

/** Minimal key-value storage so the store can be tested without a browser. */
export interface StorageAdapter {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export const chromeStorageAdapter: StorageAdapter = {
  async get<T>(key: string) {
    const result = await chrome.storage.local.get(key);
    return result[key] as T | undefined;
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
};

export const EVENTS_KEY = 'bt.events';
/** Local ring buffer size. Oldest events are dropped first. */
export const MAX_EVENTS = 1000;

export class EventStore {
  private queue: Promise<unknown> = Promise.resolve();
  private pending: BrowserTrustEvent[] = [];
  private scheduledFlush: Promise<void> | undefined;

  constructor(
    private readonly adapter: StorageAdapter,
    private readonly maxEvents: number = MAX_EVENTS,
  ) {}

  /** Appends are coalesced: events arriving while a write is queued share one storage write. */
  append(event: BrowserTrustEvent): Promise<void> {
    this.pending.push(event);
    this.scheduledFlush ??= this.enqueue(async () => {
      this.scheduledFlush = undefined;
      const batch = this.pending.splice(0);
      if (batch.length === 0) return;
      const events = await this.read();
      events.push(...batch);
      await this.adapter.set(EVENTS_KEY, events.slice(-this.maxEvents));
    });
    return this.scheduledFlush;
  }

  /** Newest first. */
  async list(limit?: number): Promise<BrowserTrustEvent[]> {
    const events = await this.enqueue(() => this.read());
    const newestFirst = [...events].reverse();
    return limit === undefined ? newestFirst : newestFirst.slice(0, Math.max(0, limit));
  }

  async count(): Promise<number> {
    return (await this.enqueue(() => this.read())).length;
  }

  clear(): Promise<void> {
    return this.enqueue(() => this.adapter.set(EVENTS_KEY, []));
  }

  private async read(): Promise<BrowserTrustEvent[]> {
    const stored = await this.adapter.get<unknown>(EVENTS_KEY);
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((value) => {
      const result = validateEvent(value);
      return result.ok ? [result.event] : [];
    });
  }

  // Serializes read-modify-write cycles; a failed task does not break the chain.
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
