export const ACTIVITY_TIME_KEY = 'bt.activityTime';
export const ACTIVITY_TIME_SCHEMA_VERSION = 1 as const;
export const ACTIVITY_TIME_RETENTION_DAYS = 30;
export const ACTIVITY_TIME_MAX_RECORDS = 2000;
export const MAX_ACTIVE_MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ActivityTimeRecord {
  /** Local calendar day in YYYY-MM-DD form. */
  day: string;
  /** Normalized hostname only; no URL, path, query, or fragment is stored. */
  host: string;
  activeMs: number;
}

export interface ActivityTimeSession {
  tabId: number;
  windowId: number;
  host: string;
  lastCheckpointAt: number;
}

export interface ActivityTimeData {
  schemaVersion: typeof ACTIVITY_TIME_SCHEMA_VERSION;
  enabled: boolean;
  records: ActivityTimeRecord[];
  session?: ActivityTimeSession;
}

export type ActivityTimeSnapshot = Omit<ActivityTimeData, 'session'>;

export const EMPTY_ACTIVITY_TIME_DATA: ActivityTimeData = {
  schemaVersion: ACTIVITY_TIME_SCHEMA_VERSION,
  enabled: false,
  records: [],
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeWebHost(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.hostname.toLowerCase().replace(/\.$/, '') || undefined;
  } catch {
    return undefined;
  }
}

export function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dayKeyToTimestamp(day: string): number | undefined {
  if (!DAY_KEY.test(day)) return undefined;
  const [year, month, date] = day.split('-').map(Number);
  const timestamp = new Date(year!, month! - 1, date!).getTime();
  return localDayKey(timestamp) === day ? timestamp : undefined;
}

export function sanitizeActivityTimeData(value: unknown, now = Date.now()): ActivityTimeData {
  if (!isRecord(value)) return { ...EMPTY_ACTIVITY_TIME_DATA, records: [] };
  const oldestAllowed = new Date(now);
  oldestAllowed.setHours(0, 0, 0, 0);
  oldestAllowed.setDate(oldestAllowed.getDate() - (ACTIVITY_TIME_RETENTION_DAYS - 1));
  const oldestDay = localDayKey(oldestAllowed.getTime());
  const newestDay = localDayKey(now);
  const merged = new Map<string, ActivityTimeRecord>();

  if (Array.isArray(value.records)) {
    for (const entry of value.records) {
      if (!isRecord(entry) || typeof entry.day !== 'string' || typeof entry.host !== 'string') continue;
      const timestamp = dayKeyToTimestamp(entry.day);
      const host = normalizeStoredHost(entry.host);
      if (timestamp === undefined || entry.day < oldestDay || entry.day > newestDay || !host) continue;
      if (typeof entry.activeMs !== 'number' || !Number.isFinite(entry.activeMs) || entry.activeMs <= 0) continue;
      const key = `${entry.day}\n${host}`;
      const current = merged.get(key);
      merged.set(key, {
        day: entry.day,
        host,
        activeMs: Math.min(MAX_ACTIVE_MS_PER_DAY, (current?.activeMs ?? 0) + Math.floor(entry.activeMs)),
      });
    }
  }

  const records = [...merged.values()]
    .sort((a, b) => b.day.localeCompare(a.day) || a.host.localeCompare(b.host))
    .slice(0, ACTIVITY_TIME_MAX_RECORDS);

  const session = sanitizeSession(value.session, now);
  return {
    schemaVersion: ACTIVITY_TIME_SCHEMA_VERSION,
    enabled: value.enabled === true,
    records,
    ...(session ? { session } : {}),
  };
}

/** Add a non-overlapping interval, splitting at local midnight and enforcing per-site/day bounds. */
export function addActiveInterval(
  data: ActivityTimeData,
  host: string,
  startAt: number,
  endAt: number,
  now = endAt,
): ActivityTimeData {
  const normalizedHost = normalizeStoredHost(host);
  if (!normalizedHost || !Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
    return sanitizeActivityTimeData(data, now);
  }
  const next = sanitizeActivityTimeData(data, now);
  const earliest = new Date(now);
  earliest.setHours(0, 0, 0, 0);
  earliest.setDate(earliest.getDate() - (ACTIVITY_TIME_RETENTION_DAYS - 1));
  let cursor = Math.max(startAt, earliest.getTime());
  const boundedEnd = Math.min(endAt, now);
  while (cursor < boundedEnd) {
    const day = localDayKey(cursor);
    const date = new Date(cursor);
    const nextMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const segmentEnd = Math.min(boundedEnd, nextMidnight);
    const delta = segmentEnd - cursor;
    const existing = next.records.find((record) => record.day === day && record.host === normalizedHost);
    if (existing) existing.activeMs = Math.min(MAX_ACTIVE_MS_PER_DAY, existing.activeMs + delta);
    else next.records.push({ day, host: normalizedHost, activeMs: Math.min(MAX_ACTIVE_MS_PER_DAY, delta) });
    cursor = segmentEnd;
  }
  next.records.sort((a, b) => b.day.localeCompare(a.day) || a.host.localeCompare(b.host));
  next.records = next.records.slice(0, ACTIVITY_TIME_MAX_RECORDS);
  return next;
}

export function summarizeActiveTime(
  records: readonly ActivityTimeRecord[],
  startDay: string,
  endDay: string,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const record of records) {
    if (record.day < startDay || record.day > endDay) continue;
    totals.set(record.host, (totals.get(record.host) ?? 0) + record.activeMs);
  }
  return totals;
}

function sanitizeSession(value: unknown, now: number): ActivityTimeSession | undefined {
  if (!isRecord(value)) return undefined;
  const host = typeof value.host === 'string' ? normalizeStoredHost(value.host) : undefined;
  if (!host || !isNonNegativeInteger(value.tabId) || !isNonNegativeInteger(value.windowId)) return undefined;
  if (typeof value.lastCheckpointAt !== 'number' || !Number.isFinite(value.lastCheckpointAt)) return undefined;
  if (value.lastCheckpointAt > now || value.lastCheckpointAt < now - DAY_MS) return undefined;
  return { tabId: value.tabId, windowId: value.windowId, host, lastCheckpointAt: value.lastCheckpointAt };
}

function normalizeStoredHost(value: string): string | undefined {
  const host = normalizeWebHost(`https://${value}`);
  if (!host || host !== value.toLowerCase().replace(/\.$/, '')) return undefined;
  return host;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
