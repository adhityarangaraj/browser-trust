import type { NewEvent } from '../core/normalize';
import { describeUrl, toDestination } from '../shared/url';
import type { Collector } from './types';

export const NETWORK_COLLECTOR_ID = 'network.webrequest';

/** The subset of chrome.webRequest details this collector reads. */
export interface RequestDetails {
  url: string;
  method: string;
  type: string;
  tabId: number;
  frameId: number;
  initiator?: string;
  documentUrl?: string;
  requestId?: string;
}

/** What onCompleted gives us: identity, status, final URL. */
export interface CompletedDetails {
  url: string;
  method: string;
  type: string;
  tabId: number;
  frameId: number;
  statusCode: number;
  initiator?: string;
  documentUrl?: string;
  requestId?: string;
  fromCache?: boolean;
}

/** What onErrorOccurred gives us: identity and error description. */
export interface ErrorDetails {
  url: string;
  method: string;
  type: string;
  tabId: number;
  frameId: number;
  error: string;
  initiator?: string;
  documentUrl?: string;
  requestId?: string;
}

/**
 * Converts a webRequest record to an event. Metadata only: URLs lose their
 * query and fragment, and no headers or bodies are read.
 * Returns undefined for traffic that is not page behavior (extensions, tab-less requests).
 */
export function buildNetworkEvent(details: RequestDetails): NewEvent | undefined {
  if (details.tabId < 0) return undefined; // service workers, other extensions, browser internals
  if (details.initiator?.startsWith('chrome-extension://')) return undefined;

  const destination = describeUrl(details.url);
  if (!destination) return undefined;

  const initiator = details.initiator ?? details.documentUrl;
  const initiatorDescription = initiator ? describeUrl(initiator) : undefined;
  const initiatorKnown = initiatorDescription !== undefined;
  // Top-level navigations have no initiator; the page itself is the source.
  const sourceOrigin = initiatorDescription?.origin ?? destination.origin;

  return {
    category: 'network',
    action: 'request.sent',
    source: {
      origin: sourceOrigin,
      ...(initiatorDescription ? { url: initiatorDescription.url } : {}),
      tabId: details.tabId,
      frameId: details.frameId,
    },
    destination: toDestination(destination, sourceOrigin, {
      method: details.method,
      resourceType: details.type,
    }),
    evidence: {
      collector: NETWORK_COLLECTOR_ID,
      mechanism: 'extension-api',
      details: {
        resourceType: details.type,
        hasQuery: destination.hasQuery,
        queryParamCount: destination.queryParamCount,
        initiatorKnown,
        ...(details.requestId ? { requestId: details.requestId } : {}),
      },
    },
    provenance: 'observed',
  };
}

/**
 * Converts an onCompleted record to a `request.completed` event. The same
 * requestId appears on the corresponding `request.sent` event so views can
 * merge them.
 */
export function buildCompletedEvent(details: CompletedDetails): NewEvent | undefined {
  if (details.tabId < 0) return undefined;
  if (details.initiator?.startsWith('chrome-extension://')) return undefined;
  const destination = describeUrl(details.url);
  if (!destination) return undefined;
  const initiator = details.initiator ?? details.documentUrl;
  const initiatorDescription = initiator ? describeUrl(initiator) : undefined;
  const sourceOrigin = initiatorDescription?.origin ?? destination.origin;
  return {
    category: 'network',
    action: 'request.completed',
    source: {
      origin: sourceOrigin,
      ...(initiatorDescription ? { url: initiatorDescription.url } : {}),
      tabId: details.tabId,
      frameId: details.frameId,
    },
    destination: toDestination(destination, sourceOrigin, {
      method: details.method,
      resourceType: details.type,
    }),
    evidence: {
      collector: NETWORK_COLLECTOR_ID,
      mechanism: 'extension-api',
      details: {
        statusCode: details.statusCode,
        resourceType: details.type,
        ...(details.fromCache !== undefined ? { fromCache: details.fromCache } : {}),
        ...(details.requestId ? { requestId: details.requestId } : {}),
      },
    },
    provenance: 'observed',
  };
}

/** Converts an onErrorOccurred record to a `request.failed` event. */
export function buildErrorEvent(details: ErrorDetails): NewEvent | undefined {
  if (details.tabId < 0) return undefined;
  if (details.initiator?.startsWith('chrome-extension://')) return undefined;
  const destination = describeUrl(details.url);
  if (!destination) return undefined;
  const initiator = details.initiator ?? details.documentUrl;
  const initiatorDescription = initiator ? describeUrl(initiator) : undefined;
  const sourceOrigin = initiatorDescription?.origin ?? destination.origin;
  return {
    category: 'network',
    action: 'request.failed',
    source: {
      origin: sourceOrigin,
      ...(initiatorDescription ? { url: initiatorDescription.url } : {}),
      tabId: details.tabId,
      frameId: details.frameId,
    },
    destination: toDestination(destination, sourceOrigin, {
      method: details.method,
      resourceType: details.type,
    }),
    evidence: {
      collector: NETWORK_COLLECTOR_ID,
      mechanism: 'extension-api',
      details: {
        error: details.error,
        resourceType: details.type,
        ...(details.requestId ? { requestId: details.requestId } : {}),
      },
    },
    provenance: 'observed',
  };
}

/**
 * Network request metadata via chrome.webRequest (optional permission).
 * Chrome only delivers requests to URLs covered by granted host permissions,
 * so per-site grants do not reveal requests to other hosts.
 */
export function createNetworkCollector(): Collector {
  let attached = false;
  const isAvailable = () =>
    typeof chrome !== 'undefined' && typeof chrome.webRequest?.onBeforeRequest?.addListener === 'function';

  return {
    id: NETWORK_COLLECTOR_ID,
    categories: ['network'],
    mechanism: 'extension-api',
    requiredPermissions: ['webRequest'],
    isAvailable,
    attach(context) {
      if (attached || !isAvailable()) return;
      const filter: chrome.webRequest.RequestFilter = { urls: ['<all_urls>'] };
      chrome.webRequest.onBeforeRequest.addListener((details) => {
        const event = buildNetworkEvent(details);
        if (event) context.emit(event).catch((e: unknown) => console.error('BrowserTrust: network event dropped', e));
      }, filter);
      // onCompleted / onErrorOccurred emit optional listeners too; if either
      // throws (older Chrome shapes), fall through without blocking the
      // base listener we already installed.
      if (typeof chrome.webRequest.onCompleted?.addListener === 'function') {
        try {
          chrome.webRequest.onCompleted.addListener((details) => {
            const event = buildCompletedEvent(details);
            if (event) context.emit(event).catch((e: unknown) => console.error('BrowserTrust: completed event dropped', e));
          }, filter);
        } catch (error) {
          console.error('BrowserTrust: onCompleted registration failed', error);
        }
      }
      if (typeof chrome.webRequest.onErrorOccurred?.addListener === 'function') {
        try {
          chrome.webRequest.onErrorOccurred.addListener((details) => {
            const event = buildErrorEvent(details);
            if (event) context.emit(event).catch((e: unknown) => console.error('BrowserTrust: error event dropped', e));
          }, filter);
        } catch (error) {
          console.error('BrowserTrust: onErrorOccurred registration failed', error);
        }
      }
      // Mark only after registration succeeds. With an ungranted optional
      // permission Chrome may throw; a later permission grant must retry.
      attached = true;
    },
  };
}
