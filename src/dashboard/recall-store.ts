/**
 * Recall collections store for Web Recall.
 *
 * Saves individual browser-history results into local Recall collections.
 * Uses chrome.storage.local, following the same patterns as follow-up-store.ts.
 *
 * Saved items contain only necessary metadata — no page contents or credentials.
 */

export const RECALL_KEY = 'bt.recall';
export const RECALL_SCHEMA_VERSION = 1 as const;
export const MAX_RECALL_ITEMS = 500;
export const MAX_RECALL_BYTES = 2 * 1024 * 1024;
export const MAX_RECENT_SEARCHES = 20;
export const RECENT_SEARCHES_KEY = 'bt.recallSearches';

export interface RecallItem {
  id: string;
  url: string;
  title: string;
  hostname: string;
  savedAt: number;
  /** Optional user note. */
  note?: string;
  /** Optional comma-separated tags. */
  tags?: string;
}

export interface RecallLibrary {
  schemaVersion: typeof RECALL_SCHEMA_VERSION;
  items: RecallItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate and normalize a URL. Returns undefined for invalid or non-HTTP(S) URLs. */
export function normalizeRecallUrl(raw: string): string | undefined {
  if (!raw || raw.length > 4096) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** Extract hostname from a URL string, or return undefined. */
export function hostnameFromUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.hostname.toLowerCase().replace(/\.$/, '') || undefined;
  } catch {
    return undefined;
  }
}

function sanitizeString(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function sanitizeRecallItem(value: unknown): RecallItem | undefined {
  if (!isRecord(value)) return undefined;
  const id = sanitizeString(value.id, 100);
  if (!id) return undefined;
  const url = normalizeRecallUrl(typeof value.url === 'string' ? value.url : '');
  if (!url) return undefined;
  const title = sanitizeString(value.title, 500);
  const hostname = hostnameFromUrl(url) ?? '';
  if (!hostname) return undefined;
  const savedAt = value.savedAt;
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt) || savedAt < 0) return undefined;
  const note = typeof value.note === 'string' ? sanitizeString(value.note, 1000) : undefined;
  const tags = typeof value.tags === 'string' ? sanitizeString(value.tags, 500) : undefined;
  return {
    id,
    url,
    title: title || hostname,
    hostname,
    savedAt,
    ...(note ? { note } : {}),
    ...(tags ? { tags } : {}),
  };
}

export function sanitizeRecallLibrary(value: unknown): RecallLibrary {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return { schemaVersion: RECALL_SCHEMA_VERSION, items: [] };
  }
  const ids = new Set<string>();
  const items: RecallItem[] = [];
  for (const raw of value.items) {
    if (items.length >= MAX_RECALL_ITEMS) break;
    const item = sanitizeRecallItem(raw);
    if (!item || ids.has(item.id)) continue;
    // Check size limit
    const candidate = { schemaVersion: RECALL_SCHEMA_VERSION, items: [...items, item] };
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > MAX_RECALL_BYTES) continue;
    ids.add(item.id);
    items.push(item);
  }
  return { schemaVersion: RECALL_SCHEMA_VERSION, items };
}

let mutationQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(task, task);
  mutationQueue = run.catch(() => undefined);
  return run;
}

async function readItems(): Promise<RecallItem[]> {
  const stored = await chrome.storage.local.get(RECALL_KEY);
  const data = sanitizeRecallLibrary(stored[RECALL_KEY]);
  // Auto-repair if stored data was malformed
  if (stored[RECALL_KEY] !== undefined && JSON.stringify(stored[RECALL_KEY]) !== JSON.stringify(data)) {
    await chrome.storage.local.set({ [RECALL_KEY]: data });
  }
  return data.items;
}

async function writeItems(items: RecallItem[]): Promise<RecallItem[]> {
  if (items.length > MAX_RECALL_ITEMS) {
    throw new Error(`Recall is limited to ${MAX_RECALL_ITEMS} saved items.`);
  }
  const data: RecallLibrary = { schemaVersion: RECALL_SCHEMA_VERSION, items };
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_RECALL_BYTES) {
    throw new Error('Recall storage limit reached. Remove some items before saving.');
  }
  await chrome.storage.local.set({ [RECALL_KEY]: data });
  return items;
}

/** List all saved Recall items. */
export function listRecallItems(): Promise<RecallItem[]> {
  return enqueue(readItems);
}

/** Save a history result into the Recall collection. */
export function saveRecallItem(
  input: { url: string; title: string },
  now = Date.now(),
): Promise<RecallItem[]> {
  return enqueue(async () => {
    const url = normalizeRecallUrl(input.url);
    if (!url) throw new Error('Invalid URL.');
    const hostname = hostnameFromUrl(url);
    if (!hostname) throw new Error('Invalid URL hostname.');
    const items = await readItems();
    // Don't duplicate same URL
    if (items.some((i) => i.url === url)) return items;
    if (items.length >= MAX_RECALL_ITEMS) {
      throw new Error(`Recall is limited to ${MAX_RECALL_ITEMS} saved items.`);
    }
    const title = sanitizeString(input.title, 500) || hostname;
    const item: RecallItem = {
      id: crypto.randomUUID(),
      url,
      title,
      hostname,
      savedAt: now,
    };
    return writeItems([...items, item]);
  });
}

/** Remove a saved Recall item by id. Does not delete Chrome history. */
export function deleteRecallItem(id: string): Promise<RecallItem[]> {
  return enqueue(async () => {
    const items = await readItems();
    if (!items.some((i) => i.id === id)) return items;
    return writeItems(items.filter((i) => i.id !== id));
  });
}

/** Remove a saved Recall item by URL. Does not delete Chrome history. */
export function unsaveRecallByUrl(url: string): Promise<RecallItem[]> {
  return enqueue(async () => {
    const normalized = normalizeRecallUrl(url);
    if (!normalized) return readItems();
    const items = await readItems();
    const filtered = items.filter((i) => i.url !== normalized);
    if (filtered.length === items.length) return items;
    return writeItems(filtered);
  });
}

/** Update the note and/or tags on a saved Recall item. */
export function updateRecallItem(
  id: string,
  updates: { note?: string; tags?: string },
  now = Date.now(),
): Promise<RecallItem[]> {
  return enqueue(async () => {
    const items = await readItems();
    const index = items.findIndex((i) => i.id === id);
    if (index < 0) throw new Error('Saved item not found.');
    const item = items[index]!;
    const note = typeof updates.note === 'string' ? sanitizeString(updates.note, 1000) : item.note;
    const tags = typeof updates.tags === 'string' ? sanitizeString(updates.tags, 500) : item.tags;
    const updated: RecallItem = {
      ...item,
      ...(note ? { note } : {}),
      ...(tags ? { tags } : {}),
      savedAt: Math.max(now, item.savedAt),
    };
    const next = [...items];
    next[index] = updated;
    return writeItems(next);
  });
}

/** Search saved Recall items by query (title, URL, note, tags). */
export function searchRecallItems(items: readonly RecallItem[], query: string): RecallItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  const terms = q.split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const haystack = [item.title, item.url, item.hostname, item.note ?? '', item.tags ?? '']
      .join('\n')
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

// --- Recent searches (local, bounded) ---

export async function loadRecentSearches(): Promise<string[]> {
  try {
    const stored = await chrome.storage.local.get(RECENT_SEARCHES_KEY);
    const raw = stored[RECENT_SEARCHES_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.filter((s): s is string => typeof s === 'string' && s.length > 0).slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export async function addRecentSearch(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > 200) return loadRecentSearches();
  const current = await loadRecentSearches();
  const filtered = current.filter((s) => s !== trimmed);
  const updated = [trimmed, ...filtered].slice(0, MAX_RECENT_SEARCHES);
  await chrome.storage.local.set({ [RECENT_SEARCHES_KEY]: updated });
  return updated;
}

export async function clearRecentSearches(): Promise<void> {
  await chrome.storage.local.remove(RECENT_SEARCHES_KEY);
}
