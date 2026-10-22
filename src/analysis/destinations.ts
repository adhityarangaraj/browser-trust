import type { BrowserTrustEvent } from '../shared/types';

export interface DestinationSummary {
  host: string;
  observationCount: number;
  methods: string[];
  sourceOrigins: string[];
  lastObservedAt: number;
  sources: string[];
  eventIds: string[];
  /** Ascending status codes observed from onCompleted, when any. */
  statusCodes: number[];
  /** Count of request.failed observations for this host, when any. */
  errorCount: number;
  /** True when any `request.sent` event to this host was cross-site. */
  anyThirdParty: boolean;
}

function requestIdOf(event: BrowserTrustEvent): string | undefined {
  const id = event.evidence.details.requestId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Groups network observations by hostname. `request.sent` drives the row;
 * matching `request.completed` / `request.failed` events are merged in by
 * `requestId` so each row carries the status codes and failure counts the
 * browser later reported for that same request. Observation count is still
 * `request.sent` only, so completions never double-count.
 */
export function summarizeDestinations(events: readonly BrowserTrustEvent[]): DestinationSummary[] {
  const groups = new Map<string, DestinationSummary>();
  const sentByRequestId = new Map<string, BrowserTrustEvent>();

  for (const event of events) {
    if (event.category !== 'network' || event.action !== 'request.sent') continue;
    const host = event.destination?.host;
    if (!host) continue;
    const current = groups.get(host) ?? {
      host,
      observationCount: 0,
      methods: [],
      sourceOrigins: [],
      lastObservedAt: 0,
      sources: [],
      eventIds: [],
      statusCodes: [],
      errorCount: 0,
      anyThirdParty: false,
    };
    current.observationCount += 1;
    const method = event.destination?.method?.toUpperCase();
    if (method && !current.methods.includes(method)) current.methods.push(method);
    if (!current.sourceOrigins.includes(event.source.origin)) current.sourceOrigins.push(event.source.origin);
    if (!current.sources.includes(event.evidence.mechanism)) current.sources.push(event.evidence.mechanism);
    if (event.destination?.isThirdParty === true) current.anyThirdParty = true;
    current.lastObservedAt = Math.max(current.lastObservedAt, event.timestamp);
    current.eventIds.push(event.id);
    groups.set(host, current);
    const requestId = requestIdOf(event);
    if (requestId) sentByRequestId.set(requestId, event);
  }

  for (const event of events) {
    if (event.category !== 'network') continue;
    if (event.action !== 'request.completed' && event.action !== 'request.failed') continue;
    const requestId = requestIdOf(event);
    const sent = requestId ? sentByRequestId.get(requestId) : undefined;
    const host = sent?.destination?.host ?? event.destination?.host;
    if (!host) continue;
    const row = groups.get(host);
    if (!row) continue;
    row.lastObservedAt = Math.max(row.lastObservedAt, event.timestamp);
    if (event.action === 'request.completed') {
      const status = event.evidence.details.statusCode;
      if (typeof status === 'number' && Number.isFinite(status) && !row.statusCodes.includes(status)) {
        row.statusCodes.push(status);
        row.statusCodes.sort((a, b) => a - b);
      }
    } else {
      row.errorCount += 1;
    }
  }

  return [...groups.values()].sort((a, b) => b.lastObservedAt - a.lastObservedAt);
}
