import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_TIME_MAX_RECORDS,
  ACTIVITY_TIME_RETENTION_DAYS,
  MAX_ACTIVE_MS_PER_DAY,
  addActiveInterval,
  localDayKey,
  normalizeWebHost,
  sanitizeActivityTimeData,
  summarizeActiveTime,
} from '../src/core/activity-time';

describe('active browsing time data', () => {
  it('keeps only eligible HTTP and HTTPS hostnames', () => {
    expect(normalizeWebHost('https://User:pass@Example.COM:8443/a?secret=1#fragment')).toBe('example.com');
    expect(normalizeWebHost('chrome://settings')).toBeUndefined();
    expect(normalizeWebHost('file:///private/document')).toBeUndefined();
    expect(normalizeWebHost('not a URL')).toBeUndefined();
  });

  it('splits a session across local midnight without losing time', () => {
    const start = new Date(2026, 3, 10, 23, 59, 30).getTime();
    const end = new Date(2026, 3, 11, 0, 0, 30).getTime();
    const result = addActiveInterval({ schemaVersion: 1, enabled: true, records: [] }, 'example.com', start, end, end);
    expect(result.records).toEqual([
      { day: localDayKey(end), host: 'example.com', activeMs: 30_000 },
      { day: localDayKey(start), host: 'example.com', activeMs: 30_000 },
    ]);
  });

  it('sanitizes malformed data, combines duplicate rows, and caps daily totals', () => {
    const now = new Date(2026, 3, 20, 12).getTime();
    const today = localDayKey(now);
    const result = sanitizeActivityTimeData({
      enabled: true,
      records: [
        { day: today, host: 'EXAMPLE.com', activeMs: MAX_ACTIVE_MS_PER_DAY },
        { day: today, host: 'example.com', activeMs: 5000 },
        { day: today, host: 'chrome-extension://bad', activeMs: 100 },
        { day: today, host: 'bad.example', activeMs: -10 },
        { day: 'not-a-day', host: 'example.org', activeMs: 100 },
      ],
    }, now);
    expect(result.records).toEqual([{ day: today, host: 'example.com', activeMs: MAX_ACTIVE_MS_PER_DAY }]);
  });

  it('drops records older than 30 calendar days and bounds record count', () => {
    const now = new Date(2026, 3, 30, 12).getTime();
    const old = new Date(2026, 2, 30).getTime();
    const data = {
      enabled: false,
      records: [
        { day: localDayKey(old), host: 'old.example', activeMs: 1000 },
        ...Array.from({ length: ACTIVITY_TIME_MAX_RECORDS + 20 }, (_, index) => ({
          day: localDayKey(now),
          host: `site-${index}.example`,
          activeMs: 1000,
        })),
      ],
    };
    const result = sanitizeActivityTimeData(data, now);
    expect(result.records).toHaveLength(ACTIVITY_TIME_MAX_RECORDS);
    expect(result.records.some(({ host }) => host === 'old.example')).toBe(false);
  });

  it('summarizes only records inside the selected local-date range', () => {
    const totals = summarizeActiveTime([
      { day: '2026-04-10', host: 'a.example', activeMs: 3000 },
      { day: '2026-04-11', host: 'a.example', activeMs: 4000 },
      { day: '2026-04-12', host: 'b.example', activeMs: 5000 },
    ], '2026-04-11', '2026-04-12');
    expect([...totals]).toEqual([['a.example', 4000], ['b.example', 5000]]);
  });
});
