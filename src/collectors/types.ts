import type { NewEvent } from '../core/normalize';
import type { EventCategory, EvidenceMechanism } from '../shared/types';

export interface CollectorContext {
  /**
   * Validates, stores and publishes an event. Events are dropped silently while
   * monitoring is off, so collectors do not need to track the switch themselves.
   */
  emit(event: NewEvent): Promise<void>;
}

/**
 * A background (service worker) source of events, built on a chrome.* API such
 * as webRequest. Page-level sources use ContentObserver instead.
 */
export interface Collector {
  /** Stable id, also used as `evidence.collector`, e.g. "network.webrequest". */
  readonly id: string;
  readonly categories: readonly EventCategory[];
  readonly mechanism: EvidenceMechanism;
  /** Optional permissions the user must grant before this collector can work. */
  readonly requiredPermissions?: readonly chrome.runtime.ManifestPermission[];
  /** True when the browser APIs this collector needs are currently available. */
  isAvailable(): boolean;
  /**
   * Registers browser event listeners. Must be synchronous: Chrome only wakes a
   * stopped service worker for listeners added in the first turn of its script.
   * Must be idempotent and a no-op when `isAvailable()` is false.
   */
  attach(context: CollectorContext): void;
}

export type CollectorState = 'active' | 'paused' | 'needs-permission';

export interface CollectorStatus {
  id: string;
  categories: readonly EventCategory[];
  mechanism: EvidenceMechanism;
  state: CollectorState;
  requiredPermissions: readonly chrome.runtime.ManifestPermission[];
}
