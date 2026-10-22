import { describe, expect, it, vi } from 'vitest';
import { connectAnalysis, MAX_RULE_WINDOW_MS } from '../src/analysis/service';
import { FindingStore } from '../src/analysis/store';
import { rules } from '../src/analysis/rules';
import type { Rule } from '../src/analysis/types';
import { EventPipeline } from '../src/core/pipeline';
import { EventStore, type StorageAdapter } from '../src/core/store';
import type { BrowserTrustEvent } from '../src/shared/types';

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
    const analysis = connectAnalysis(pipeline, events, findings, rules);

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

    await analysis.drain();
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
    const analysis = connectAnalysis(pipeline, events, findings, [{
      id: 'throws.rule', description: 'test error', evaluate() { throw new Error('rule failed'); },
    }], error);
    await pipeline.emit({
      category: 'page', action: 'page.loaded', source: { origin: 'https://shop.example' },
      evidence: { collector: 'page.lifecycle', mechanism: 'content-script', details: {} }, provenance: 'observed',
    });
    await analysis.drain();
    expect(await events.count()).toBe(1);
    expect(error).toHaveBeenCalledOnce();
  });

  it('caps per-event history scan to the longest rule window', async () => {
    const { events, findings } = stores();
    let id = 0;
    let timestamp = 1000;
    const pipeline = new EventPipeline(events, { newId: () => `event-${++id}`, now: () => timestamp });
    const seenHistoryLengths: number[] = [];
    const probe: Rule = {
      id: 'probe', description: 'records history size',
      evaluate(_event: BrowserTrustEvent, history: readonly BrowserTrustEvent[]) {
        seenHistoryLengths.push(history.length);
        return [];
      },
    };
    const analysis = connectAnalysis(pipeline, events, findings, [probe]);
    // One ancient event, well outside the rule window.
    timestamp = 1000;
    await pipeline.emit({
      category: 'page', action: 'page.loaded', source: { origin: 'https://shop.example' },
      evidence: { collector: 'page.lifecycle', mechanism: 'content-script', details: {} }, provenance: 'observed',
    });
    // One recent event, inside the window.
    timestamp = 1000 + MAX_RULE_WINDOW_MS - 1000;
    await pipeline.emit({
      category: 'page', action: 'page.loaded', source: { origin: 'https://shop.example' },
      evidence: { collector: 'page.lifecycle', mechanism: 'content-script', details: {} }, provenance: 'observed',
    });
    // Current event is far beyond the window from the ancient one.
    timestamp = 1000 + MAX_RULE_WINDOW_MS + 10_000;
    await pipeline.emit({
      category: 'page', action: 'page.loaded', source: { origin: 'https://shop.example' },
      evidence: { collector: 'page.lifecycle', mechanism: 'content-script', details: {} }, provenance: 'observed',
    });
    await analysis.drain();
    // Three invocations: first sees nothing, second sees the first, third
    // sees only the second (ancient event is outside the window).
    expect(seenHistoryLengths).toEqual([0, 1, 1]);
  });

  it('does not resurrect findings for events cleared while analysis is in flight', async () => {
    const { events, findings } = stores();
    let id = 0;
    let timestamp = 1000;
    const pipeline = new EventPipeline(events, { newId: () => `event-${++id}`, now: () => timestamp += 1000 });
    const analysis = connectAnalysis(pipeline, events, findings, rules);

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
    // Clear immediately, BEFORE draining analysis. The queued task must
    // notice the generation bump and skip the findings write.
    await events.clear();
    await analysis.drain();
    expect(await findings.list()).toEqual([]);
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
