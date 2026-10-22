import type { Settings } from '../config/settings';
import type { CollectorStatus } from '../collectors/types';
import type { BrowserTrustEvent, Severity } from './types';
import type { Finding } from '../analysis/types';
import type { ActivityTimeSnapshot } from '../core/activity-time';

export interface StateSnapshot {
  settings: Settings;
  eventCount: number;
  collectors: CollectorStatus[];
  /** Web origin patterns the user has granted, e.g. "https://example.com/*". */
  grantedOrigins: string[];
  contentScriptRegistered: boolean;
}

/** Requests and their response payloads. */
export interface MessageMap {
  /** Extension pages only. */
  'get-state': { request: { type: 'get-state' }; response: StateSnapshot };
  'set-monitoring': {
    request: { type: 'set-monitoring'; enabled: boolean };
    response: StateSnapshot;
  };
  'set-site-ignored': {
    request: { type: 'set-site-ignored'; origin: string; ignored: boolean };
    response: StateSnapshot;
  };
  'list-events': {
    request: { type: 'list-events'; limit?: number };
    response: BrowserTrustEvent[];
  };
  'list-findings': { request: { type: 'list-findings'; limit?: number }; response: Finding[] };
  'clear-events': { request: { type: 'clear-events' }; response: null };
  /** Dashboard-only local active-time controls and summary. */
  'get-activity-time': { request: { type: 'get-activity-time' }; response: ActivityTimeSnapshot };
  'set-activity-time-tracking': {
    request: { type: 'set-activity-time-tracking'; enabled: boolean };
    response: ActivityTimeSnapshot;
  };
  'clear-activity-time': { request: { type: 'clear-activity-time' }; response: ActivityTimeSnapshot };
  /** Content scripts only. The event is untrusted and is validated in the background. */
  'ingest-event': { request: { type: 'ingest-event'; event: unknown }; response: null };
}

/**
 * Display-only summary of a finding, pushed from the background
 * to the top frame of the triggering tab so the content script can show an
 * in-page alert dialog. It carries finding metadata only — never page data.
 */
export interface AlertPayload {
  findingId: string;
  title: string;
  explanation: string;
  severity: Severity;
  /** Human-readable evidence strength, e.g. "temporal association". */
  evidenceStrength: string;
  /** Destination host or source origin, when known. */
  where?: string;
  /** What the evidence cannot establish. */
  limitations: string[];
  timestamp: number;
}

/** Background → content script push (sent with `chrome.tabs.sendMessage`). */
export interface ShowAlertMessage {
  type: 'show-alert';
  alert: AlertPayload;
}

export type MessageType = keyof MessageMap;
export type Request = MessageMap[MessageType]['request'];
export type Response<T> = { ok: true; data: T } | { ok: false; error: string };

export async function sendRequest<K extends MessageType>(
  request: MessageMap[K]['request'],
): Promise<MessageMap[K]['response']> {
  const response = (await chrome.runtime.sendMessage(request)) as
    | Response<MessageMap[K]['response']>
    | undefined;
  if (!response) throw new Error('No response from the BrowserTrust background worker');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}
