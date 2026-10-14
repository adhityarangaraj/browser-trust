import { describe, expect, it, vi } from 'vitest';
import { connectAnalysis } from '../src/analysis/service';
import { FindingStore } from '../src/analysis/store';
import { rules } from '../src/analysis/rules';
import { EventPipeline } from '../src/core/pipeline';
import { EventStore, type StorageAdapter } from '../src/core/store';

function stores() {
  const values = new Map<string, unknown>();
  const adapter: StorageAdapter = {
    async get<T>(key: string) { return values.get(key) as T | undefined; },
    async set(key, value) { values.set(key, structuredClone(value)); },
  };
  return { events: new EventStore(adapter), findings: new FindingStore(adapter), adapter };
}

describe('live analysis connection', () => {
  it('derives and persists a finding after a matching pair flows through EventPipeline', async () => {
    const { events, findings } = stores();
    let id = 0;
    let timestamp = 1000;
    const pipeline = new EventPipeline(events, { newId: () => `event-${++id}`, now: () => timestamp += 1000 });
    connectAnalysis(pipeline, events, findings, rules);

    await pipeline.emit({
      category: 'form', action: 'form.submitted', source: { origin: 'https://shop.example', tabId: 2 },
      destination: { host: 'collector.example', method: 'POST' },
      evidence: { collector: 'form.interaction', mechanism: 'content-script', details: { method: 'post', isTrusted: true } },
      provenance: 'observed',
    });
    await pipeline.emit({
      category: 'network', action: 'request.sent', source: { origin: 'https://shop.example', tabId: 2 },
      destination: { host: 'collector.example', method: 'POST' },
      evidence: { collector: 'network.webrequest', mechanism: 'extension-api', details: {} },
      provenance: 'observed',
    });

    const result = await findings.list();
    expect(result).toHaveLength(1);
    expect(result[0]?.eventIds).toEqual(['event-1', 'event-2']);
    expect(result[0]?.eventTimestamps).toEqual([2000, 3000]);
    expect((await events.list()).map((event) => event.id)).toHaveLength(2);
  });

  it('keeps the event stored if a rule or finding write fails', async () => {
    const { events, findings } = stores();
    const error = vi.fn();
    const pipeline = new EventPipeline(events);
    connectAnalysis(pipeline, events, findings, [{
      id: 'throws.rule', description: 'test error', evaluate() { throw new Error('rule failed'); },
    }], error);
    await pipeline.emit({
      category: 'page', action: 'page.loaded', source: { origin: 'https://shop.example' },
      evidence: { collector: 'page.lifecycle', mechanism: 'content-script', details: {} }, provenance: 'observed',
    });
    expect(await events.count()).toBe(1);
    expect(error).toHaveBeenCalledOnce();
  });

  it('keeps persisted findings available through a new store instance', async () => {
    const { findings, adapter } = stores();
    await findings.appendMany([{
      id: 'stable', ruleId: 'test.rule', title: 'Stored', category: 'communication', explanation: 'Persisted',
      severity: 'low', eventIds: ['event-1'], eventTimestamps: [123], evidenceStrength: 'direct-observation',
      limitations: [], timestamp: 123,
    }]);
    expect((await new FindingStore(adapter).list())[0]?.id).toBe('stable');
  });
});
