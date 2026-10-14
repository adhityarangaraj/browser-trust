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
      attached = true;
      chrome.webRequest.onBeforeRequest.addListener(
        (details) => {
          const event = buildNetworkEvent(details);
          if (event) context.emit(event).catch((e: unknown) => console.error('BrowserTrust: network event dropped', e));
        },
        { urls: ['<all_urls>'] },
      );
    },
  };
}
