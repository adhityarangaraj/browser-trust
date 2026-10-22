import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sanitizeRecallLibrary,
  normalizeRecallUrl,
  hostnameFromUrl,
  searchRecallItems,
  RECALL_SCHEMA_VERSION,
  MAX_RECALL_ITEMS,
  type RecallItem,
  type RecallLibrary,
} from '../src/dashboard/recall-store';

describe('normalizeRecallUrl', () => {
  it('accepts valid HTTP URLs', () => {
    expect(normalizeRecallUrl('https://example.com/page')).toBe('https://example.com/page');
    expect(normalizeRecallUrl('http://example.com')).toBe('http://example.com/');
  });

  it('rejects non-HTTP URLs', () => {
    expect(normalizeRecallUrl('ftp://example.com')).toBeUndefined();
    expect(normalizeRecallUrl('file:///etc/passwd')).toBeUndefined();
    expect(normalizeRecallUrl('chrome://extensions')).toBeUndefined();
    expect(normalizeRecallUrl('chrome-extension://abc/page.html')).toBeUndefined();
  });

  it('rejects URLs with credentials', () => {
    expect(normalizeRecallUrl('https://user:pass@example.com')).toBeUndefined();
    expect(normalizeRecallUrl('https://user@example.com')).toBeUndefined();
  });

  it('rejects empty and very long URLs', () => {
    expect(normalizeRecallUrl('')).toBeUndefined();
    expect(normalizeRecallUrl('https://x.com/' + 'a'.repeat(5000))).toBeUndefined();
  });

  it('rejects malformed URLs', () => {
    expect(normalizeRecallUrl('not a url')).toBeUndefined();
  });
});

describe('hostnameFromUrl', () => {
  it('extracts hostname from HTTP URLs', () => {
    expect(hostnameFromUrl('https://www.example.com/page')).toBe('www.example.com');
    expect(hostnameFromUrl('http://Example.COM')).toBe('example.com');
  });

  it('returns undefined for non-HTTP', () => {
    expect(hostnameFromUrl('ftp://example.com')).toBeUndefined();
  });

  it('strips trailing dot', () => {
    expect(hostnameFromUrl('https://example.com.')).toBe('example.com');
  });
});

describe('sanitizeRecallLibrary', () => {
  it('returns empty library for invalid input', () => {
    expect(sanitizeRecallLibrary(null)).toEqual({ schemaVersion: RECALL_SCHEMA_VERSION, items: [] });
    expect(sanitizeRecallLibrary('string')).toEqual({ schemaVersion: RECALL_SCHEMA_VERSION, items: [] });
    expect(sanitizeRecallLibrary({ items: 'not array' })).toEqual({ schemaVersion: RECALL_SCHEMA_VERSION, items: [] });
  });

  it('preserves valid items', () => {
    const item: RecallItem = {
      id: 'test-id',
      url: 'https://example.com',
      title: 'Example',
      hostname: 'example.com',
      savedAt: 1700000000000,
    };
    const lib: RecallLibrary = { schemaVersion: RECALL_SCHEMA_VERSION, items: [item] };
    const result = sanitizeRecallLibrary(lib);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe('test-id');
    expect(result.items[0]!.url).toBe('https://example.com/');
    expect(result.items[0]!.hostname).toBe('example.com');
  });

  it('drops items with invalid URLs', () => {
    const item = {
      id: 'bad',
      url: 'chrome://extensions',
      title: 'Extensions',
      hostname: 'extensions',
      savedAt: 1700000000000,
    };
    const lib = { schemaVersion: RECALL_SCHEMA_VERSION, items: [item] };
    const result = sanitizeRecallLibrary(lib);
    expect(result.items).toHaveLength(0);
  });

  it('drops items with missing id', () => {
    const item = {
      url: 'https://example.com',
      title: 'Example',
      hostname: 'example.com',
      savedAt: 1700000000000,
    };
    const result = sanitizeRecallLibrary({ items: [item] });
    expect(result.items).toHaveLength(0);
  });

  it('deduplicates by id', () => {
    const item: RecallItem = {
      id: 'dup',
      url: 'https://example.com',
      title: 'Example',
      hostname: 'example.com',
      savedAt: 1700000000000,
    };
    const result = sanitizeRecallLibrary({ items: [item, item] });
    expect(result.items).toHaveLength(1);
  });

  it('enforces MAX_RECALL_ITEMS cap', () => {
    const items = Array.from({ length: MAX_RECALL_ITEMS + 10 }, (_, i) => ({
      id: `id-${i}`,
      url: `https://example.com/page-${i}`,
      title: `Page ${i}`,
      hostname: 'example.com',
      savedAt: 1700000000000,
    }));
    const result = sanitizeRecallLibrary({ items });
    expect(result.items.length).toBeLessThanOrEqual(MAX_RECALL_ITEMS);
  });

  it('preserves note and tags', () => {
    const item: RecallItem = {
      id: 'noted',
      url: 'https://example.com',
      title: 'Example',
      hostname: 'example.com',
      savedAt: 1700000000000,
      note: 'Useful page',
      tags: 'work,research',
    };
    const result = sanitizeRecallLibrary({ items: [item] });
    expect(result.items[0]!.note).toBe('Useful page');
    expect(result.items[0]!.tags).toBe('work,research');
  });

  it('drops items with negative savedAt', () => {
    const item = {
      id: 'neg',
      url: 'https://example.com',
      title: 'Example',
      hostname: 'example.com',
      savedAt: -1,
    };
    const result = sanitizeRecallLibrary({ items: [item] });
    expect(result.items).toHaveLength(0);
  });
});

describe('searchRecallItems', () => {
  const items: RecallItem[] = [
    { id: '1', url: 'https://react.dev', title: 'React Documentation', hostname: 'react.dev', savedAt: 1000 },
    { id: '2', url: 'https://vuejs.org', title: 'Vue.js Guide', hostname: 'vuejs.org', savedAt: 2000, note: 'Frontend framework', tags: 'web,frontend' },
    { id: '3', url: 'https://docs.python.org', title: 'Python Docs', hostname: 'docs.python.org', savedAt: 3000 },
  ];

  it('returns all items with empty query', () => {
    expect(searchRecallItems(items, '')).toHaveLength(3);
    expect(searchRecallItems(items, '  ')).toHaveLength(3);
  });

  it('matches by title', () => {
    const results = searchRecallItems(items, 'react');
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe('React Documentation');
  });

  it('matches by URL', () => {
    const results = searchRecallItems(items, 'vuejs.org');
    expect(results).toHaveLength(1);
  });

  it('matches by note', () => {
    const results = searchRecallItems(items, 'frontend framework');
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('2');
  });

  it('matches by tags', () => {
    const results = searchRecallItems(items, 'web');
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('2');
  });

  it('matches multiple terms (AND)', () => {
    const results = searchRecallItems(items, 'python docs');
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('3');
  });

  it('case-insensitive matching', () => {
    const results = searchRecallItems(items, 'REACT');
    expect(results).toHaveLength(1);
  });

  it('returns empty for no matches', () => {
    expect(searchRecallItems(items, 'golang')).toHaveLength(0);
  });
});
