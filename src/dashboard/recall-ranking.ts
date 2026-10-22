/**
 * Deterministic local ranking for Web Recall.
 *
 * Ranks browser-history results by title/URL term matches, domain matches,
 * recency, and visit frequency. Uses only local signals — no AI, embeddings,
 * or external services.
 *
 * All scores are simple additive sums described as "local match ranking".
 */

export interface RankableItem {
  /** Page title (may be empty). */
  title: string;
  /** Full URL. */
  url: string;
  /** Lowercase hostname extracted from the URL. */
  hostname: string;
  /** Last visit timestamp in ms since epoch. */
  lastVisitTime: number;
  /** Visit count (from chrome.history, lifetime-scoped). */
  visitCount: number;
}

export interface RankedItem<T extends RankableItem> {
  item: T;
  /** Simple additive local match ranking (higher = better match). */
  score: number;
}

/** Normalize a string for matching: lowercase, collapse whitespace. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Split a query into non-empty terms. */
function tokenize(query: string): string[] {
  return normalize(query).split(' ').filter(Boolean);
}

/**
 * Score a single item against a search query.
 *
 * Scoring signals (additive):
 *  - Exact title phrase match: +20
 *  - Each title term match: +5
 *  - Exact URL phrase match: +15
 *  - Each URL term match: +3
 *  - Domain term match (hostname includes a query term): +4 per matching term
 *  - Recency bonus: up to +10 (decays linearly over 30 days)
 *  - Visit frequency bonus: +1 per visit, capped at +10
 *
 * Returns 0 when no query terms match title or URL at all.
 */
export function scoreItem(item: RankableItem, query: string, now = Date.now()): number {
  const terms = tokenize(query);
  if (terms.length === 0) {
    // No query — rank by recency + visits only
    return recencyBonus(item.lastVisitTime, now) + visitBonus(item.visitCount);
  }

  const titleLower = normalize(item.title);
  const urlLower = normalize(item.url);
  const hostLower = item.hostname.toLowerCase();
  const queryLower = normalize(query);

  let score = 0;
  let anyMatch = false;

  // Exact phrase match in title
  if (titleLower.includes(queryLower)) {
    score += 20;
    anyMatch = true;
  }

  // Exact phrase match in URL
  if (urlLower.includes(queryLower)) {
    score += 15;
    anyMatch = true;
  }

  // Per-term matches
  for (const term of terms) {
    if (titleLower.includes(term)) {
      score += 5;
      anyMatch = true;
    }
    if (urlLower.includes(term)) {
      score += 3;
      anyMatch = true;
    }
    if (hostLower.includes(term)) {
      score += 4;
      anyMatch = true;
    }
  }

  // If no query term matched anywhere, return 0 to filter out
  if (!anyMatch) return 0;

  // Recency bonus: linear decay over 30 days
  score += recencyBonus(item.lastVisitTime, now);

  // Visit frequency bonus
  score += visitBonus(item.visitCount);

  return score;
}

/** Recency bonus: 10 for right now, decaying linearly to 0 over 30 days. */
function recencyBonus(lastVisitTime: number, now: number): number {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const age = Math.max(0, now - lastVisitTime);
  return Math.max(0, 10 * (1 - age / THIRTY_DAYS_MS));
}

/** Visit frequency bonus: +1 per visit, capped at 10. */
function visitBonus(visitCount: number): number {
  return Math.min(10, Math.max(0, visitCount));
}

/**
 * Rank a list of items by query relevance.
 * Items with score 0 (no match) are excluded.
 * Results are sorted descending by score.
 */
export function rankItems<T extends RankableItem>(
  items: readonly T[],
  query: string,
  now = Date.now(),
): RankedItem<T>[] {
  const ranked: RankedItem<T>[] = [];
  for (const item of items) {
    const score = scoreItem(item, query, now);
    if (score > 0) ranked.push({ item, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}
