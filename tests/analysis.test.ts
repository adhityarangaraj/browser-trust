import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analysis/engine';
import type { Rule } from '../src/analysis/types';
import { createEvent } from '../src/core/normalize';

const make = (id: string, timestamp: number) =>
  createEvent(
    {
      category: 'page',
      action: 'page.loaded',
      source: { origin: 'https://example.com' },
      evidence: { collector: 't', mechanism: 'content-script', details: {} },
      provenance: 'observed',
    },
    { newId: () => id, now: () => timestamp },
  );

describe('analyze', () => {
  it('returns nothing when no rules are registered', () => {
    expect(analyze([], [make('a', 1)])).toEqual([]);
  });

  it('evaluates events in time order with prior events as history', () => {
    const seenHistory: number[] = [];
    const rule: Rule = {
      id: 'test.rule',
      description: 'records history length',
      evaluate: (_event, history) => {
        seenHistory.push(history.length);
        return [];
      },
    };
    analyze([rule], [make('b', 2), make('a', 1)]);
    expect(seenHistory).toEqual([0, 1]);
  });

  it('rejects findings that cite no evidence', () => {
    const rule: Rule = {
      id: 'bad.rule',
      description: 'no evidence',
      evaluate: () => [
        { ruleId: 'bad.rule', title: 't', explanation: 'e', severity: 'low', confidence: 1, eventIds: [] },
      ],
    };
    expect(() => analyze([rule], [make('a', 1)])).toThrow(/without supporting events/);
  });
});
