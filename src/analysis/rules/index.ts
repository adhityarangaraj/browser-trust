import type { BrowserTrustEvent } from '../../shared/types';
import type { Finding, Rule } from '../types';

const FORM_NETWORK_WINDOW_MS = 30_000;
const CAPABILITY_NETWORK_WINDOW_MS = 15_000;
const REPEATED_POST_WINDOW_MS = 60_000;
const REPEATED_POST_THRESHOLD = 3;

const NO_PAYLOAD_LIMITATION = 'Request payloads are not collected, so the event does not show what data was sent.';
const TEMPORAL_LIMITATION = 'The events are temporally associated; this does not establish causation or data transmission.';

function finding(args: {
  ruleId: string;
  title: string;
  category: Finding['category'];
  explanation: string;
  severity: Finding['severity'];
  events: readonly BrowserTrustEvent[];
  evidenceStrength: Finding['evidenceStrength'];
  limitations: string[];
  destinationHost?: string;
}): Finding {
  const eventIds = args.events.map((event) => event.id);
  const sourceOrigin = args.events[0]?.source.origin;
  return {
    id: `${args.ruleId}:${eventIds.join(':')}`,
    ruleId: args.ruleId,
    title: args.title,
    category: args.category,
    explanation: args.explanation,
    severity: args.severity,
    eventIds,
    eventTimestamps: args.events.map((event) => event.timestamp),
    ...(sourceOrigin ? { sourceOrigin } : {}),
    ...(args.destinationHost ? { destinationHost: args.destinationHost } : {}),
    evidenceStrength: args.evidenceStrength,
    limitations: args.limitations,
    timestamp: Math.max(...args.events.map((event) => event.timestamp)),
  };
}

function isPageNetworkRequest(event: BrowserTrustEvent): boolean {
  return event.category === 'network' && event.action === 'request.sent' &&
    event.evidence.mechanism === 'extension-api' && event.source.tabId !== undefined;
}

function samePage(a: BrowserTrustEvent, b: BrowserTrustEvent): boolean {
  return a.source.tabId !== undefined && a.source.tabId === b.source.tabId && a.source.origin === b.source.origin;
}

function inWindow(previous: BrowserTrustEvent, current: BrowserTrustEvent, windowMs: number): boolean {
  const elapsed = current.timestamp - previous.timestamp;
  return elapsed >= 0 && elapsed <= windowMs;
}

export const formNetworkRule: Rule = {
  id: 'sequence.form-network',
  description: 'Form activity followed by browser-observed network request within 30 seconds in the same tab and page origin.',
  evaluate(event, history) {
    if (!isPageNetworkRequest(event)) return [];
    const form = [...history].reverse().find((candidate) =>
      candidate.category === 'form' && candidate.action === 'form.submitted' &&
      candidate.evidence.details.isTrusted === true && samePage(candidate, event) &&
      inWindow(candidate, event, FORM_NETWORK_WINDOW_MS) &&
      (!candidate.destination?.host || !event.destination?.host || candidate.destination.host === event.destination.host) &&
      (!candidate.destination?.method || !event.destination?.method ||
        candidate.destination.method.toUpperCase() === event.destination.method.toUpperCase()),
    );
    if (!form) return [];
    const host = event.destination?.host;
    return [finding({
      ruleId: this.id,
      title: 'Form activity followed by a request',
      category: 'communication',
      explanation: `A form submission was followed by a browser-observed ${event.destination?.method ?? 'network'} request${host ? ` to ${host}` : ''} within 30 seconds from the same page context.`,
      severity: 'medium',
      events: [form, event],
      evidenceStrength: 'temporal-association',
      limitations: [NO_PAYLOAD_LIMITATION, TEMPORAL_LIMITATION],
      ...(host ? { destinationHost: host } : {}),
    })];
  },
};

function capabilityName(event: BrowserTrustEvent): string | undefined {
  if (event.category !== 'capability') return undefined;
  if (event.action === 'geolocation.requested') return 'geolocation';
  if (event.action === 'clipboard.read') return 'clipboard read';
  if (event.action === 'media.requested') return 'media capture';
  return undefined;
}

export const sensitiveCapabilityRule: Rule = {
  id: 'capability.sensitive-request',
  description: 'Highlights observed calls to selected sensitive browser APIs.',
  evaluate(event) {
    const capability = capabilityName(event);
    if (!capability) return [];
    const api = event.evidence.details.api;
    return [finding({
      ruleId: this.id,
      title: `Sensitive API call: ${capability}`,
      category: 'capability',
      explanation: `The page called an API associated with ${capability}${typeof api === 'string' ? ` (${api})` : ''}. This records an API invocation only.`,
      severity: 'low',
      events: [event],
      evidenceStrength: 'direct-observation',
      limitations: [
        'The event does not prove the browser granted access or that the capability succeeded.',
        'The page can forge or suppress messages from its MAIN-world hook.',
      ],
    })];
  },
};

export const capabilityNetworkRule: Rule = {
  id: 'sequence.capability-network',
  description: 'Relates selected sensitive API calls to a later browser-observed request in the same page context within 15 seconds.',
  evaluate(event, history) {
    if (!isPageNetworkRequest(event)) return [];
    const capabilityEvent = [...history].reverse().find((candidate) =>
      capabilityName(candidate) !== undefined && samePage(candidate, event) &&
      inWindow(candidate, event, CAPABILITY_NETWORK_WINDOW_MS),
    );
    if (!capabilityEvent) return [];
    const capability = capabilityName(capabilityEvent);
    const host = event.destination?.host;
    return [finding({
      ruleId: this.id,
      title: `Request followed ${capability} activity`,
      category: 'communication',
      explanation: `A ${capability} API call was followed by a browser-observed request${host ? ` to ${host}` : ''} within 15 seconds from the same page context.`,
      severity: 'medium',
      events: [capabilityEvent, event],
      evidenceStrength: 'temporal-association',
      limitations: [NO_PAYLOAD_LIMITATION, TEMPORAL_LIMITATION, 'The capability event was reported through a page-world hook that the page can forge or suppress.'],
      ...(host ? { destinationHost: host } : {}),
    })];
  },
};

export const repeatedExternalPostRule: Rule = {
  id: 'pattern.repeated-cross-origin-post',
  description: 'Highlights three or more browser-observed cross-origin POST requests to the same host in one minute and tab.',
  evaluate(event, history) {
    const host = event.destination?.host;
    if (!isPageNetworkRequest(event) || !host || event.destination?.isCrossOrigin !== true ||
      event.destination.method?.toUpperCase() !== 'POST') return [];
    const matches = [...history, event].filter((candidate) =>
      isPageNetworkRequest(candidate) && candidate.destination?.host === host &&
      candidate.destination.method?.toUpperCase() === 'POST' && candidate.destination.isCrossOrigin === true &&
      samePage(candidate, event) && inWindow(candidate, event, REPEATED_POST_WINDOW_MS),
    );
    if (matches.length < REPEATED_POST_THRESHOLD) return [];
    const evidence = matches.slice(0, REPEATED_POST_THRESHOLD);
    return [finding({
      ruleId: this.id,
      title: 'Repeated cross-origin POST requests',
      category: 'communication',
      explanation: `At least ${REPEATED_POST_THRESHOLD} POST request observations to ${host} occurred within one minute from the same page context. This pattern may merit review.`,
      severity: 'medium',
      events: evidence,
      evidenceStrength: 'repeated-pattern',
      limitations: ['A repeated request pattern does not by itself show malicious intent or reveal request contents.'],
      destinationHost: host,
    })];
  },
};

export const rules: readonly Rule[] = [
  formNetworkRule,
  sensitiveCapabilityRule,
  capabilityNetworkRule,
  repeatedExternalPostRule,
];
