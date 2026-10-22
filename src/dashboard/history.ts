import { localDayKey, normalizeWebHost } from '../core/activity-time';

export type HistoryPeriod = 'Today' | 'Last 7 days' | 'Last 30 days';

export interface HistoryRange {
  startTime: number;
  endTime: number;
  startDay: string;
  endDay: string;
}

export interface SiteVisitSummary {
  host: string;
  visits: number;
  lastVisitTime: number;
}

export interface HistoryActivityResult {
  sites: SiteVisitSummary[];
  dailyVisits: Map<string, number>;
  totalVisits: number;
  truncated: boolean;
  failedUrlQueries: number;
}

export const MAX_HISTORY_ITEMS = 3000;
const HISTORY_QUERY_CONCURRENCY = 8;

export function getHistoryRange(period: HistoryPeriod, now = Date.now()): HistoryRange {
  const end = new Date(now);
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (period === 'Last 7 days') start.setDate(start.getDate() - 6);
  else if (period === 'Last 30 days') start.setDate(start.getDate() - 29);
  return {
    startTime: start.getTime(),
    endTime: now,
    startDay: localDayKey(start.getTime()),
    endDay: localDayKey(now),
  };
}

/** Query only recent history items; visit records are filtered to the same time range before aggregation. */
export async function querySiteHistory(period: HistoryPeriod, now = Date.now()): Promise<HistoryActivityResult> {
  const range = getHistoryRange(period, now);
  const items = await chrome.history.search({
    text: '',
    startTime: range.startTime,
    endTime: range.endTime,
    maxResults: MAX_HISTORY_ITEMS,
  });

  const urls = new Set<string>();
  const queryItems: { url: string; host: string }[] = [];
  for (const item of items) {
    if (!item.url || item.visitCount === 0 || urls.has(item.url)) continue;
    const host = normalizeWebHost(item.url);
    if (!host) continue;
    urls.add(item.url);
    queryItems.push({ url: item.url, host });
  }

  const visited = new Map<string, number>();
  const lastVisitTimes = new Map<string, number>();
  const dailyVisits = new Map<string, number>();
  let failedUrlQueries = 0;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(HISTORY_QUERY_CONCURRENCY, queryItems.length) }, async () => {
    while (cursor < queryItems.length) {
      const item = queryItems[cursor++];
      if (!item) continue;
      let visits: chrome.history.VisitItem[];
      try {
        visits = await chrome.history.getVisits({ url: item.url });
      } catch {
        failedUrlQueries += 1;
        continue;
      }

      const seenVisitIds = new Set<string>();
      for (const visit of visits) {
        const timestamp = visit.visitTime;
        if (timestamp === undefined || timestamp < range.startTime || timestamp > range.endTime) continue;
        if (visit.isLocal === false || visit.transition.endsWith('_subframe') || seenVisitIds.has(visit.visitId)) continue;
        seenVisitIds.add(visit.visitId);
        const current = visited.get(item.host) ?? 0;
        visited.set(item.host, current + 1);
        lastVisitTimes.set(item.host, Math.max(lastVisitTimes.get(item.host) ?? 0, timestamp));
        const day = localDayKey(timestamp);
        dailyVisits.set(day, (dailyVisits.get(day) ?? 0) + 1);
      }
    }
  });
  await Promise.all(workers);

  // Use filtered visit records rather than HistoryItem.visitCount, which is lifetime-scoped.
  const sites: SiteVisitSummary[] = [...visited].map(([host, visits]) => ({
    host,
    visits,
    lastVisitTime: lastVisitTimes.get(host) ?? 0,
  })).sort((a, b) => b.visits - a.visits || b.lastVisitTime - a.lastVisitTime);
  return {
    sites,
    dailyVisits,
    totalVisits: [...visited.values()].reduce((total, count) => total + count, 0),
    truncated: items.length === MAX_HISTORY_ITEMS,
    failedUrlQueries,
  };
}
