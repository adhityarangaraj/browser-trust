/**
 * BrowserTrust event model. Shared by every collector, observer, rule and UI.
 * It is deliberately independent of any website or demo scenario.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const EVENT_SCHEMA_VERSION = 1 as const;

export const EVENT_CATEGORIES = [
  'page', // navigation, page lifecycle
  'dom', // DOM reads/mutations
  'form', // form interaction and submission
  'storage', // localStorage, sessionStorage, cookies, IndexedDB
  'network', // request metadata
  'capability', // clipboard, geolocation, camera, microphone, etc.
  'extension', // other extensions' observable behavior
  'system', // BrowserTrust's own lifecycle/diagnostics
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** How the evidence was obtained. Documents each event's limits. */
export const EVIDENCE_MECHANISMS = [
  'extension-api', // chrome.* API in the service worker (webRequest, tabs, ...)
  'content-script', // isolated-world content script
  'main-world-hook', // script injected into the page's own JS world
  'derived', // computed from other events, nothing new observed
] as const;
export type EvidenceMechanism = (typeof EVIDENCE_MECHANISMS)[number];

/**
 * observed: the browser/page reported it directly.
 * inferred: a relationship or conclusion derived from other events
 *           (must reference them via relatedEventIds).
 */
export const PROVENANCES = ['observed', 'inferred'] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const SEVERITIES = ['info', 'low', 'medium', 'high'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface EventSource {
  /** Origin of the frame that performed the action, e.g. "https://example.com". */
  origin: string;
  /** Full URL of that frame. Consider stripping query/fragment before storing. */
  url?: string;
  /** Origin of the top-level page, when it differs from `origin`. */
  topLevelOrigin?: string;
  tabId?: number;
  frameId?: number;
}

export interface EventDestination {
  origin?: string;
  host?: string;
  url?: string;
  method?: string;
  resourceType?: string;
  /** True when the destination origin differs from the source origin. */
  isCrossOrigin?: boolean;
  /**
   * True when the destination site differs from the source site. Not populated yet:
   * it needs a public suffix list, so "cross-origin" is what collectors report.
   */
  isThirdParty?: boolean;
}

export interface EventEvidence {
  /** Id of the collector/observer that produced it, e.g. "network.webrequest". */
  collector: string;
  mechanism: EvidenceMechanism;
  /**
   * Small, JSON-safe facts about what was seen (sizes, field types, API names).
   * Never raw secrets: no form values, cookie values, clipboard contents, etc.
   */
  details: { [key: string]: JsonValue };
}

export interface BrowserTrustEvent {
  schemaVersion: typeof EVENT_SCHEMA_VERSION;
  id: string;
  /** Milliseconds since the Unix epoch. */
  timestamp: number;
  category: EventCategory;
  /** Lowercase dotted verb, e.g. "request.sent", "form.submitted". */
  action: string;
  source: EventSource;
  destination?: EventDestination;
  evidence: EventEvidence;
  provenance: Provenance;
  /** 0..1. Mainly meaningful for inferred events. */
  confidence?: number;
  severity?: Severity;
  /** Required and non-empty when provenance is "inferred". */
  relatedEventIds?: string[];
}
