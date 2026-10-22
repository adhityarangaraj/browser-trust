import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHistoryRange, querySiteHistory, type HistoryPeriod } from '../src/dashboard/history';

describe('history range and site summaries', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['Today', 0],
    ['Last 7 days', 6],
    ['Last 30 days', 29],
  ] as const)('uses the selected local calendar range for %s', (period: HistoryPeriod, daysBack) => {
    const now = new Date(2026, 3, 30, 14, 45).getTime();
    const range = getHistoryRange(period, now);
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - daysBack);
    expect(range.startTime).toBe(start.getTime());
    expect(range.endTime).toBe(now);
  });

  it('counts filtered local top-level visit records and groups by normalized hostname', async () => {
    const now = new Date(2026, 3, 30, 14).getTime();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const inside = start.getTime() + 1000;
    const outside = start.getTime() - 1000;
    const urlA = 'https://Example.com/one?token=discarded';
    const urlB = 'https://example.com/two';
    vi.stubGlobal('chrome', {
      history: {
        search: vi.fn(async () => [
          { id: 'a', url: urlA, visitCount: 1 },
          { id: 'b', url: urlB, visitCount: 1 },
          { id: 'internal', url: 'chrome://settings', visitCount: 2 },
          { id: 'file', url: 'file:///private/document', visitCount: 1 },
        ]),
        getVisits: vi.fn(async ({ url }: { url: string }) => {
          if (url === urlA) return [
            { visitId: 'v1', visitTime: inside, transition: 'link', isLocal: true },
            { visitId: 'v-old', visitTime: outside, transition: 'typed', isLocal: true },
            { visitId: 'v-frame', visitTime: inside + 1, transition: 'auto_subframe', isLocal: true },
            { visitId: 'v-sync', visitTime: inside + 2, transition: 'link', isLocal: false },
          ];
          return [{ visitId: 'v2', visitTime: inside + 3, transition: 'typed', isLocal: true }];
        }),
      },
    });

    const result = await querySiteHistory('Today', now);
    expect(result.totalVisits).toBe(2);
    expect(result.sites).toEqual([{ host: 'example.com', visits: 2, lastVisitTime: inside + 3 }]);
    expect([...result.dailyVisits.values()]).toEqual([2]);
  });

  it('reports URL query failures and bounds history item search results', async () => {
    const search = vi.fn(async (_query: chrome.history.HistoryQuery) => [
      { id: 'one', url: 'https://example.com', visitCount: 1 },
    ]);
    vi.stubGlobal('chrome', {
      history: {
        search,
        getVisits: vi.fn(async () => { throw new Error('history API unavailable'); }),
      },
    });
    const result = await querySiteHistory('Last 7 days', 1000 * 60 * 60 * 24 * 20000);
    expect(search.mock.calls[0]?.[0].maxResults).toBe(3000);
    expect(result.failedUrlQueries).toBe(1);
    expect(result.sites).toEqual([]);
  });
});
