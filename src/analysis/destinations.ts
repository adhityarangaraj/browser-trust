import type { BrowserTrustEvent } from '../shared/types';

export interface DestinationSummary {
  host: string;
  observationCount: number;
  methods: string[];
  sourceOrigins: string[];
  lastObservedAt: number;
  sources: string[];
  eventIds: string[];
}

/** Groups network observations by hostname without pretending duplicate collectors share request IDs. */
export function summarizeDestinations(events: readonly BrowserTrustEvent[]): DestinationSummary[] {
  const groups = new Map<string, DestinationSummary>();
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
    };
    current.observationCount += 1;
    const method = event.destination?.method?.toUpperCase();
    if (method && !current.methods.includes(method)) {
      current.methods.push(method);
    }
    if (!current.sourceOrigins.includes(event.source.origin)) current.sourceOrigins.push(event.source.origin);
    if (!current.sources.includes(event.evidence.mechanism)) current.sources.push(event.evidence.mechanism);
    current.lastObservedAt = Math.max(current.lastObservedAt, event.timestamp);
    current.eventIds.push(event.id);
    groups.set(host, current);
  }
  return [...groups.values()].sort((a, b) => b.lastObservedAt - a.lastObservedAt);
}
