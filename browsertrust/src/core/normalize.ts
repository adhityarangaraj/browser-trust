import {
  EVENT_CATEGORIES,
  EVENT_SCHEMA_VERSION,
  EVIDENCE_MECHANISMS,
  PROVENANCES,
  SEVERITIES,
  type BrowserTrustEvent,
  type EventDestination,
  type EventEvidence,
  type EventSource,
  type JsonValue,
} from '../shared/types';

/** What a producer supplies; id, timestamp and schemaVersion are added here. */
export type NewEvent = Omit<BrowserTrustEvent, 'schemaVersion' | 'id' | 'timestamp'>;

/** What a content-level observer supplies; the source is derived from the message sender. */
export type ContentEventInput = Omit<NewEvent, 'source'>;

export interface NormalizeDeps {
  now?: () => number;
  newId?: () => string;
}

export type ValidationResult =
  | { ok: true; event: BrowserTrustEvent }
  | { ok: false; errors: string[] };

export class EventValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Invalid event: ${errors.join('; ')}`);
    this.name = 'EventValidationError';
  }
}

export const MAX_EVIDENCE_BYTES = 8192;
const ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const MAX_JSON_DEPTH = 8;

export function createEvent(input: NewEvent, deps: NormalizeDeps = {}): BrowserTrustEvent {
  const candidate = {
    ...input,
    schemaVersion: EVENT_SCHEMA_VERSION,
    id: (deps.newId ?? (() => globalThis.crypto.randomUUID()))(),
    timestamp: (deps.now ?? Date.now)(),
  };
  const result = validateEvent(candidate);
  if (!result.ok) throw new EventValidationError(result.errors);
  return result.event;
}

export function validateEvent(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(value)) return { ok: false, errors: ['event must be an object'] };

  if (value.schemaVersion !== EVENT_SCHEMA_VERSION) errors.push('unsupported schemaVersion');
  if (!isNonEmptyString(value.id)) errors.push('id must be a non-empty string');
  if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp) || value.timestamp < 0) {
    errors.push('timestamp must be a non-negative number');
  }
  if (!includes(EVENT_CATEGORIES, value.category)) errors.push('unknown category');
  if (typeof value.action !== 'string' || !ACTION_PATTERN.test(value.action)) {
    errors.push('action must be lowercase dotted words, e.g. "request.sent"');
  }
  if (!includes(PROVENANCES, value.provenance)) errors.push('unknown provenance');

  const source = readSource(value.source, errors);
  const destination = readDestination(value.destination, errors);
  const evidence = readEvidence(value.evidence, errors);

  if (value.confidence !== undefined) {
    if (typeof value.confidence !== 'number' || !(value.confidence >= 0 && value.confidence <= 1)) {
      errors.push('confidence must be a number between 0 and 1');
    }
  }
  if (value.severity !== undefined && !includes(SEVERITIES, value.severity)) {
    errors.push('unknown severity');
  }

  let relatedEventIds: string[] | undefined;
  if (value.relatedEventIds !== undefined) {
    if (Array.isArray(value.relatedEventIds) && value.relatedEventIds.every(isNonEmptyString)) {
      relatedEventIds = [...value.relatedEventIds];
    } else {
      errors.push('relatedEventIds must be an array of non-empty strings');
    }
  }
  if (value.provenance === 'inferred' && (relatedEventIds?.length ?? 0) === 0) {
    errors.push('inferred events must reference relatedEventIds');
  }

  if (errors.length > 0 || !source || !evidence) return { ok: false, errors };

  const event: BrowserTrustEvent = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    id: value.id as string,
    timestamp: value.timestamp as number,
    category: value.category as BrowserTrustEvent['category'],
    action: value.action as string,
    source,
    evidence,
    provenance: value.provenance as BrowserTrustEvent['provenance'],
    ...(destination ? { destination } : {}),
    ...(value.confidence !== undefined ? { confidence: value.confidence as number } : {}),
    ...(value.severity !== undefined ? { severity: value.severity as BrowserTrustEvent['severity'] } : {}),
    ...(relatedEventIds ? { relatedEventIds } : {}),
  };
  return { ok: true, event };
}

function readSource(value: unknown, errors: string[]): EventSource | undefined {
  if (!isPlainObject(value) || !isNonEmptyString(value.origin)) {
    errors.push('source.origin must be a non-empty string');
    return undefined;
  }
  const source: EventSource = { origin: value.origin };
  copyOptionalString(value, source, 'url', errors, 'source');
  copyOptionalString(value, source, 'topLevelOrigin', errors, 'source');
  copyOptionalNumber(value, source, 'tabId', errors, 'source');
  copyOptionalNumber(value, source, 'frameId', errors, 'source');
  return source;
}

function readDestination(value: unknown, errors: string[]): EventDestination | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    errors.push('destination must be an object');
    return undefined;
  }
  const destination: EventDestination = {};
  for (const key of ['origin', 'host', 'url', 'method', 'resourceType'] as const) {
    copyOptionalString(value, destination, key, errors, 'destination');
  }
  for (const key of ['isCrossOrigin', 'isThirdParty'] as const) {
    const flag = value[key];
    if (flag === undefined) continue;
    if (typeof flag === 'boolean') destination[key] = flag;
    else errors.push(`destination.${key} must be a boolean`);
  }
  return destination;
}

function readEvidence(value: unknown, errors: string[]): EventEvidence | undefined {
  if (!isPlainObject(value)) {
    errors.push('evidence must be an object');
    return undefined;
  }
  let ok = true;
  if (!isNonEmptyString(value.collector)) {
    errors.push('evidence.collector must be a non-empty string');
    ok = false;
  }
  if (!includes(EVIDENCE_MECHANISMS, value.mechanism)) {
    errors.push('unknown evidence.mechanism');
    ok = false;
  }
  if (!isPlainObject(value.details) || !isJsonValue(value.details, 0)) {
    errors.push('evidence.details must be a JSON-safe object');
    ok = false;
  } else if (JSON.stringify(value.details).length > MAX_EVIDENCE_BYTES) {
    errors.push(`evidence.details exceeds ${MAX_EVIDENCE_BYTES} characters`);
    ok = false;
  }
  if (!ok) return undefined;
  return {
    collector: value.collector as string,
    mechanism: value.mechanism as EventEvidence['mechanism'],
    details: value.details as { [key: string]: JsonValue },
  };
}

function copyOptionalString<T extends object>(
  from: Record<string, unknown>,
  to: T,
  key: keyof T & string,
  errors: string[],
  label: string,
): void {
  const v = from[key];
  if (v === undefined) return;
  if (typeof v === 'string') (to as Record<string, unknown>)[key] = v;
  else errors.push(`${label}.${key} must be a string`);
}

function copyOptionalNumber<T extends object>(
  from: Record<string, unknown>,
  to: T,
  key: keyof T & string,
  errors: string[],
  label: string,
): void {
  const v = from[key];
  if (v === undefined) return;
  if (typeof v === 'number' && Number.isFinite(v)) (to as Record<string, unknown>)[key] = v;
  else errors.push(`${label}.${key} must be a finite number`);
}

function isJsonValue(value: unknown, depth: number): value is JsonValue {
  if (depth > MAX_JSON_DEPTH) return false;
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      if (Array.isArray(value)) return value.every((v) => isJsonValue(v, depth + 1));
      return isPlainObject(value) && Object.values(value).every((v) => isJsonValue(v, depth + 1));
    default:
      return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function includes<T extends readonly string[]>(list: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}
