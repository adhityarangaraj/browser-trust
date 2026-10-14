/**
 * Pure helpers that turn page-supplied values into small, secret-free facts.
 * They never read the content of bodies, keys or cookies, only shape and size.
 */
import { describeUrl, type UrlDescription } from '../shared/url';

export interface BodyDescription {
  bodyType: string;
  bodySize?: number;
}

export function describeBody(body: unknown): BodyDescription {
  if (body === undefined || body === null) return { bodyType: 'none' };
  if (typeof body === 'string') return { bodyType: 'string', bodySize: body.length };
  const tag = Object.prototype.toString.call(body).slice(8, -1);
  switch (tag) {
    case 'URLSearchParams':
      return { bodyType: 'urlsearchparams', bodySize: String(body).length };
    case 'FormData': {
      let entries = 0;
      (body as { forEach(cb: () => void): void }).forEach(() => {
        entries += 1;
      });
      return { bodyType: 'formdata', bodySize: entries }; // size here is the entry count
    }
    case 'Blob':
    case 'File':
      return { bodyType: 'blob', bodySize: (body as { size: number }).size };
    case 'ArrayBuffer':
      return { bodyType: 'arraybuffer', bodySize: (body as ArrayBuffer).byteLength };
    case 'ReadableStream':
      return { bodyType: 'stream' };
    default:
      if (ArrayBuffer.isView(body)) return { bodyType: 'arraybufferview', bodySize: body.byteLength };
      return { bodyType: tag.toLowerCase() };
  }
}

/** Accepts a string, URL or Request-like object; returns undefined if no URL can be read. */
export function describeRequestTarget(input: unknown, base: string): UrlDescription | undefined {
  if (typeof input === 'string') return describeUrl(input, base);
  const candidate = input as { href?: unknown; url?: unknown } | null;
  const raw = candidate?.href ?? candidate?.url;
  return typeof raw === 'string' ? describeUrl(raw, base) : undefined;
}

const SENSITIVE_KEY = /token|auth|session|passw|secret|jwt|bearer|email|ssn|card|credential|api[-_]?key|\bsid\b/i;

/** Classifies a storage key without recording it. */
export function keyLooksSensitive(key: unknown): boolean {
  return typeof key === 'string' && SENSITIVE_KEY.test(key);
}

const COOKIE_ATTRIBUTES = ['expires', 'max-age', 'domain', 'path', 'secure', 'samesite', 'partitioned'];

/** Attribute names present in a `document.cookie = ...` string. Name and value are never returned. */
export function cookieAttributes(cookie: unknown): string[] {
  if (typeof cookie !== 'string') return [];
  const found = new Set<string>();
  for (const part of cookie.split(';').slice(1)) {
    const name = part.split('=')[0]?.trim().toLowerCase() ?? '';
    if (COOKIE_ATTRIBUTES.includes(name)) found.add(name);
  }
  return [...found].sort();
}

export interface Throttle {
  /** Returns how many calls were suppressed before this one, or undefined if this call should be skipped. */
  take(key: string): number | undefined;
}

/** Lets one call per key through each window and reports how many were folded into it. */
export function createThrottle(windowMs: number, now: () => number = Date.now): Throttle {
  const state = new Map<string, { at: number; suppressed: number }>();
  return {
    take(key) {
      const current = state.get(key);
      const t = now();
      if (!current || t - current.at >= windowMs) {
        state.set(key, { at: t, suppressed: 0 });
        return current?.suppressed ?? 0;
      }
      current.suppressed += 1;
      return undefined;
    },
  };
}
