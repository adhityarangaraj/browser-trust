import { describe, expect, it } from 'vitest';
import { FindingStore, FINDINGS_KEY } from '../src/analysis/store';
import type { Finding } from '../src/analysis/types';
import type { StorageAdapter } from '../src/core/store';

function finding(id: string): Finding {
  return {
    id, ruleId: 'test.rule', title: 'Test finding', category: 'communication', explanation: 'Test',
    severity: 'low', eventIds: [`event-${id}`], eventTimestamps: [1], evidenceStrength: 'direct-observation',
    limitations: [], timestamp: 1,
  };
}

function setup(max = 500) {
  const values = new Map<string, unknown>();
  const adapter: StorageAdapter = {
    async get<T>(key: string) { return values.get(key) as T | undefined; },
    async set(key, value) { values.set(key, structuredClone(value)); },
  };
  return { store: new FindingStore(adapter, max), values };
}

describe('FindingStore', () => {
  it('persists findings, prevents duplicate IDs, and returns only the net-new additions', async () => {
    const { store } = setup();
    expect((await store.appendMany([finding('a'), finding('b')])).map((item) => item.id)).toEqual(['a', 'b']);
    expect((await store.appendMany([finding('a'), finding('c')])).map((item) => item.id)).toEqual(['c']);
    expect(await store.appendMany([finding('c')])).toEqual([]);
    expect((await store.list()).map((item) => item.id)).toEqual(['c', 'b', 'a']);
    expect(await store.count()).toBe(3);
  });

  it('bounds storage and clears findings', async () => {
    const { store, values } = setup(2);
    await store.appendMany([finding('a'), finding('b'), finding('c')]);
    expect((await store.list()).map((item) => item.id)).toEqual(['c', 'b']);
    await store.clear();
    expect(await store.list()).toEqual([]);
    expect(values.get(FINDINGS_KEY)).toEqual([]);
  });

  it('ignores malformed persisted records', async () => {
    const { store, values } = setup();
    values.set(FINDINGS_KEY, [{ id: 'partial', eventIds: ['event'] }, finding('valid')]);
    expect((await store.list()).map((item) => item.id)).toEqual(['valid']);
  });
});
