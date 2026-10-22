import { describe, it, expect } from 'vitest';
import { scoreItem, rankItems, type RankableItem } from '../src/dashboard/recall-ranking';

const NOW = 1700000000000; // fixed timestamp for determinism

function makeItem(overrides: Partial<RankableItem> = {}): RankableItem {
  return {
    title: 'Example Page Title',
    url: 'https://example.com/page',
    hostname: 'example.com',
    lastVisitTime: NOW - 1000 * 60 * 60, // 1 hour ago
    visitCount: 5,
    ...overrides,
  };
}

describe('scoreItem', () => {
  it('returns 0 when no query terms match', () => {
    const item = makeItem({ title: 'Cooking Recipes', url: 'https://food.com/recipes', hostname: 'food.com' });
    expect(scoreItem(item, 'quantum physics', NOW)).toBe(0);
  });

  it('gives higher score for exact title phrase match', () => {
    const item = makeItem({ title: 'TypeScript Handbook' });
    const phraseScore = scoreItem(item, 'TypeScript Handbook', NOW);
    const singleTermScore = scoreItem(item, 'TypeScript', NOW);
    expect(phraseScore).toBeGreaterThan(singleTermScore);
  });

  it('gives higher score for exact URL phrase match', () => {
    const item = makeItem({ url: 'https://docs.example.com/typescript-guide' });
    const phraseScore = scoreItem(item, 'typescript-guide', NOW);
    const singleTermScore = scoreItem(item, 'typescript', NOW);
    expect(phraseScore).toBeGreaterThan(singleTermScore);
  });

  it('adds domain match bonus', () => {
    const itemWithDomain = makeItem({ hostname: 'github.com', url: 'https://github.com/repo' });
    const itemWithoutDomain = makeItem({ hostname: 'example.com', url: 'https://example.com/github-guide' });
    // Both have "github" in URL, but one also has it in hostname
    const scoreDomain = scoreItem(itemWithDomain, 'github', NOW);
    const scoreNoDomain = scoreItem(itemWithoutDomain, 'github', NOW);
    expect(scoreDomain).toBeGreaterThan(scoreNoDomain);
  });

  it('case-insensitive matching', () => {
    const item = makeItem({ title: 'JavaScript Guide' });
    const upper = scoreItem(item, 'JAVASCRIPT', NOW);
    const lower = scoreItem(item, 'javascript', NOW);
    expect(upper).toBe(lower);
    expect(upper).toBeGreaterThan(0);
  });

  it('handles multiple terms in different orders', () => {
    const item = makeItem({ title: 'React TypeScript Tutorial' });
    const score1 = scoreItem(item, 'react typescript', NOW);
    const score2 = scoreItem(item, 'typescript react', NOW);
    expect(score1).toBe(score2);
    expect(score1).toBeGreaterThan(0);
  });

  it('gives recency bonus to recent items', () => {
    const recent = makeItem({ lastVisitTime: NOW - 1000 * 60 }); // 1 minute ago
    const old = makeItem({ lastVisitTime: NOW - 1000 * 60 * 60 * 24 * 29 }); // 29 days ago
    const recentScore = scoreItem(recent, 'example', NOW);
    const oldScore = scoreItem(old, 'example', NOW);
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  it('gives visit frequency bonus', () => {
    const popular = makeItem({ visitCount: 10 });
    const rare = makeItem({ visitCount: 1 });
    const popularScore = scoreItem(popular, 'example', NOW);
    const rareScore = scoreItem(rare, 'example', NOW);
    expect(popularScore).toBeGreaterThan(rareScore);
  });

  it('with empty query, ranks by recency and visits', () => {
    const item = makeItem();
    const score = scoreItem(item, '', NOW);
    expect(score).toBeGreaterThan(0);
  });

  it('caps visit bonus at 10', () => {
    const item1 = makeItem({ visitCount: 10, lastVisitTime: NOW });
    const item2 = makeItem({ visitCount: 100, lastVisitTime: NOW });
    const score1 = scoreItem(item1, 'example', NOW);
    const score2 = scoreItem(item2, 'example', NOW);
    expect(score1).toBe(score2); // both capped
  });

  it('normalizes whitespace in query and titles', () => {
    const item = makeItem({ title: 'Multiple   Spaces   Here' });
    const score = scoreItem(item, 'multiple spaces here', NOW);
    expect(score).toBeGreaterThan(0);
  });
});

describe('rankItems', () => {
  it('excludes items with score 0', () => {
    const items = [
      makeItem({ title: 'React Guide', url: 'https://react.dev' }),
      makeItem({ title: 'Cooking Blog', url: 'https://food.com' }),
    ];
    const ranked = rankItems(items, 'react', NOW);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.item.title).toBe('React Guide');
  });

  it('sorts by score descending', () => {
    const items = [
      makeItem({ title: 'JavaScript Basics', url: 'https://js.com/basics', hostname: 'js.com' }),
      makeItem({ title: 'Advanced JavaScript Patterns and JavaScript Design', url: 'https://patterns.dev/javascript', hostname: 'patterns.dev' }),
    ];
    const ranked = rankItems(items, 'javascript', NOW);
    expect(ranked.length).toBeGreaterThanOrEqual(1);
    // The item with more "javascript" mentions should score higher
    if (ranked.length > 1) {
      expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);
    }
  });

  it('returns all items with empty query', () => {
    const items = [
      makeItem({ title: 'A', visitCount: 5 }),
      makeItem({ title: 'B', visitCount: 3, url: 'https://b.com' }),
    ];
    const ranked = rankItems(items, '', NOW);
    expect(ranked).toHaveLength(2);
  });

  it('handles empty input', () => {
    const ranked = rankItems([], 'test', NOW);
    expect(ranked).toHaveLength(0);
  });
});
