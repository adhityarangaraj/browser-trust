import type { Settings } from '../config/settings';
import type { CollectorStatus } from '../collectors/types';
import type { BrowserTrustEvent } from './types';
import type { Finding } from '../analysis/types';

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
  'list-events': {
    request: { type: 'list-events'; limit?: number };
    response: BrowserTrustEvent[];
  };
  'list-findings': { request: { type: 'list-findings'; limit?: number }; response: Finding[] };
  'clear-events': { request: { type: 'clear-events' }; response: null };
  /** Content scripts only. The event is untrusted and is validated in the background. */
  'ingest-event': { request: { type: 'ingest-event'; event: unknown }; response: null };
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
