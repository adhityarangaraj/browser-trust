import type { NewEvent } from '../core/normalize';
import type { EventCategory, EvidenceMechanism } from '../shared/types';

export interface CollectorContext {
  /** Validates, stores and publishes an event. */
  emit(event: NewEvent): Promise<void>;
}

/**
 * A background-side (service worker) source of events, typically built on a
 * chrome.* API such as webRequest. Content-level sources use ContentObserver instead.
 */
export interface Collector {
  /** Stable id, also used as `evidence.collector`, e.g. "network.webrequest". */
  readonly id: string;
  readonly categories: readonly EventCategory[];
  readonly mechanism: EvidenceMechanism;
  /** Optional permissions this collector needs beyond the granted site access. */
  readonly requiredPermissions?: readonly chrome.runtime.ManifestPermission[];
  start(context: CollectorContext): Promise<void>;
  stop(): Promise<void>;
}

export interface CollectorStatus {
  id: string;
  categories: readonly EventCategory[];
  mechanism: EvidenceMechanism;
  running: boolean;
}
