import type { BrowserTrustEvent } from '../../shared/types';
import type { Finding, Rule } from '../types';

const FORM_NETWORK_WINDOW_MS = 30_000;
const CAPABILITY_NETWORK_WINDOW_MS = 15_000;
const REPEATED_POST_WINDOW_MS = 60_000;
const REPEATED_POST_THRESHOLD = 3;
/** Twice the base threshold inside the same minute escalates the finding to high severity. */
const REPEATED_POST_HIGH_THRESHOLD = 6;

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
  description: 'Relates selected sensitive API calls to a later browser-observed request in the same page context within 15 seconds. Escalates to high severity when the request is a cross-origin POST.',
  evaluate(event, history) {
    if (!isPageNetworkRequest(event)) return [];
    const capabilityEvent = [...history].reverse().find((candidate) =>
      capabilityName(candidate) !== undefined && samePage(candidate, event) &&
      inWindow(candidate, event, CAPABILITY_NETWORK_WINDOW_MS),
    );
    if (!capabilityEvent) return [];
    const capability = capabilityName(capabilityEvent);
    const host = event.destination?.host;
    const method = event.destination?.method?.toUpperCase();
    const isCrossOriginPost = method === 'POST' && event.destination?.isCrossOrigin === true;
    const severity: Finding['severity'] = isCrossOriginPost ? 'high' : 'medium';
    const title = isCrossOriginPost
      ? `${capability} activity followed by a cross-origin POST`
      : `Request followed ${capability} activity`;
    const explanation = isCrossOriginPost
      ? `A ${capability} API call was followed by a cross-origin POST${host ? ` to ${host}` : ''} within 15 seconds from the same page context. A sensitive capability feeding into a cross-origin POST warrants closer review; the request body is not collected so this does not prove the capability's data was transmitted.`
      : `A ${capability} API call was followed by a browser-observed request${host ? ` to ${host}` : ''} within 15 seconds from the same page context.`;
    return [finding({
      ruleId: this.id,
      title,
      category: 'communication',
      explanation,
      severity,
      events: [capabilityEvent, event],
      evidenceStrength: 'temporal-association',
      limitations: [NO_PAYLOAD_LIMITATION, TEMPORAL_LIMITATION, 'The capability event was reported through a page-world hook that the page can forge or suppress.'],
      ...(host ? { destinationHost: host } : {}),
    })];
  },
};

export const repeatedExternalPostRule: Rule = {
  id: 'pattern.repeated-cross-origin-post',
  description: 'Highlights three or more browser-observed cross-origin POST requests to the same host in one minute and tab. A sustained pattern of six or more escalates to high severity.',
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
    const findings: Finding[] = [];
    findings.push(finding({
      ruleId: this.id,
      title: 'Repeated cross-origin POST requests',
      category: 'communication',
      explanation: `At least ${REPEATED_POST_THRESHOLD} POST request observations to ${host} occurred within one minute from the same page context. This pattern may merit review.`,
      severity: 'medium',
      events: matches.slice(0, REPEATED_POST_THRESHOLD),
      evidenceStrength: 'repeated-pattern',
      limitations: ['A repeated request pattern does not by itself show malicious intent or reveal request contents.'],
      destinationHost: host,
    }));
    if (matches.length >= REPEATED_POST_HIGH_THRESHOLD) {
      findings.push(finding({
        ruleId: this.id,
        title: 'Sustained repeated cross-origin POST requests',
        category: 'communication',
        explanation: `At least ${REPEATED_POST_HIGH_THRESHOLD} POST request observations to ${host} occurred within one minute from the same page context. A sustained burst of this size warrants closer review; the request bodies are not collected so this does not establish what was sent.`,
        severity: 'high',
        events: matches.slice(0, REPEATED_POST_HIGH_THRESHOLD),
        evidenceStrength: 'repeated-pattern',
        limitations: ['A repeated request pattern does not by itself show malicious intent or reveal request contents.'],
        destinationHost: host,
      }));
    }
    return findings;
  },
};

export const hiddenCrossOriginIframeRule: Rule = {
  id: 'dom.hidden-cross-origin-iframe',
  description: 'Flags iframes added to the page that are both cross-origin and hidden via attributes or inline style.',
  evaluate(event) {
    if (event.category !== 'dom' || event.action !== 'element.added') return [];
    if (event.evidence.details.tag !== 'iframe') return [];
    if (event.evidence.details.hiddenHint !== true) return [];
    const host = event.destination?.host;
    if (!host) return [];
    if (event.destination?.isCrossOrigin !== true) return [];
    return [finding({
      ruleId: this.id,
      title: 'Hidden cross-origin iframe added',
      category: 'communication',
      explanation: `A hidden or zero-size iframe pointing to ${host} was added to the page. Hidden embeds from another origin can be used for silent tracking or beacons and warrant review.`,
      severity: 'medium',
      events: [event],
      evidenceStrength: 'direct-observation',
      limitations: [
        'The hidden hint is derived from attributes and inline style only; computed CSS could still make the iframe visible, and attribute-hidden iframes have legitimate uses too.',
        'A cross-origin iframe alone does not demonstrate malicious intent.',
      ],
      destinationHost: host,
    })];
  },
};

export const dynamicThirdPartyScriptRule: Rule = {
  id: 'dom.dynamic-third-party-script',
  description: 'Flags scripts injected after the initial page scan whose destination is on a different registrable domain than the page.',
  evaluate(event) {
    if (event.category !== 'dom' || event.action !== 'element.added') return [];
    if (event.evidence.details.tag !== 'script') return [];
    if (event.evidence.details.initial === true) return [];
    const host = event.destination?.host;
    if (!host) return [];
    if (event.destination?.isThirdParty !== true) return [];
    return [finding({
      ruleId: this.id,
      title: 'Script injected dynamically from a different site',
      category: 'communication',
      explanation: `A script element pointing to ${host} was added to the page after load. Dynamically injected cross-site scripts run with the page's privileges and may merit a closer look.`,
      severity: 'low',
      events: [event],
      evidenceStrength: 'direct-observation',
      limitations: [
        'Many legitimate integrations load scripts from other sites; this rule does not establish malicious intent.',
        'The script source was not fetched or inspected; only its injection is recorded.',
      ],
      destinationHost: host,
    })];
  },
};

export const scriptedFormNetworkRule: Rule = {
  id: 'sequence.scripted-form-network',
  description: 'Relates a scripted form.submit() call to a later browser-observed request within the same tab and page origin.',
  evaluate(event, history) {
    if (!isPageNetworkRequest(event)) return [];
    const form = [...history].reverse().find((candidate) =>
      candidate.category === 'form' && candidate.action === 'form.submit_called' &&
      samePage(candidate, event) && inWindow(candidate, event, FORM_NETWORK_WINDOW_MS),
    );
    if (!form) return [];
    const host = event.destination?.host;
    return [finding({
      ruleId: this.id,
      title: 'Scripted form submission followed by a request',
      category: 'communication',
      explanation: `A page script called form.submit() and was followed by a browser-observed ${event.destination?.method ?? 'network'} request${host ? ` to ${host}` : ''} within 30 seconds from the same page context.`,
      severity: 'low',
      events: [form, event],
      evidenceStrength: 'temporal-association',
      limitations: [
        NO_PAYLOAD_LIMITATION,
        TEMPORAL_LIMITATION,
        'The form submission was reported through a page-world hook that the page can forge or suppress.',
      ],
      ...(host ? { destinationHost: host } : {}),
    })];
  },
};

export const rules: readonly Rule[] = [
  formNetworkRule,
  scriptedFormNetworkRule,
  sensitiveCapabilityRule,
  capabilityNetworkRule,
  repeatedExternalPostRule,
  hiddenCrossOriginIframeRule,
  dynamicThirdPartyScriptRule,
];
