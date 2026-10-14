import type { EventDestination } from './types';

export interface UrlDescription {
  /** Origin for web URLs; the bare protocol (e.g. "data:") for anything else. */
  origin: string;
  host: string;
  /** Origin + path for web URLs. Query, fragment and credentials are never kept. Non-web URLs keep only the protocol. */
  url: string;
  hasQuery: boolean;
  queryParamCount: number;
}

const WEB_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

/**
 * Describes a URL without retaining anything that could carry secrets
 * (query values, fragments, credentials, data: or blob: payloads).
 */
export function describeUrl(raw: string, base?: string): UrlDescription | undefined {
  let parsed: URL;
  try {
    parsed = new URL(raw, base);
  } catch {
    return undefined;
  }
  if (!WEB_PROTOCOLS.has(parsed.protocol)) {
    return { origin: parsed.protocol, host: '', url: parsed.protocol, hasQuery: false, queryParamCount: 0 };
  }
  let count = 0;
  parsed.searchParams.forEach(() => {
    count += 1;
  });
  return {
    origin: parsed.origin,
    host: parsed.host,
    url: `${parsed.origin}${parsed.pathname}`,
    hasQuery: parsed.search.length > 1,
    queryParamCount: count,
  };
}

export function toDestination(
  description: UrlDescription,
  sourceOrigin: string,
  extra: { method?: string; resourceType?: string } = {},
): EventDestination {
  return {
    origin: description.origin,
    ...(description.host ? { host: description.host } : {}),
    url: description.url,
    ...(extra.method ? { method: extra.method } : {}),
    ...(extra.resourceType ? { resourceType: extra.resourceType } : {}),
    isCrossOrigin: description.origin !== sourceOrigin,
  };
}
