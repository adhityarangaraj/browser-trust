import { describe, expect, it } from 'vitest';
import { EventPipeline } from '../src/core/pipeline';
import { EventStore, type StorageAdapter } from '../src/core/store';

function memoryStore(): EventStore {
  const values = new Map<string, unknown>();
  const adapter: StorageAdapter = {
    async get<T>(key: string) { return values.get(key) as T | undefined; },
    async set(key, value) { values.set(key, value); },
  };
  return new EventStore(adapter);
}

describe('content event pipeline', () => {
  it('derives the source from the browser sender and strips URL query and fragment', async () => {
    const pipeline = new EventPipeline(memoryStore(), { newId: () => 'event-1', now: () => 1 });
    const event = await pipeline.ingestFromContent({
      category: 'network',
      action: 'request.sent',
      source: { origin: 'https://forged.example', url: 'https://forged.example/?secret=x' },
      destination: { origin: 'https://cdn.example', host: 'cdn.example', url: 'https://cdn.example/a' },
      evidence: { collector: 'page.hook', mechanism: 'main-world-hook', details: {} },
      provenance: 'observed',
    }, { url: 'https://shop.example/page?session=secret#part', tabId: 8, frameId: 2 });

    expect(event.source).toEqual({
      origin: 'https://shop.example',
      url: 'https://shop.example/page',
      tabId: 8,
      frameId: 2,
    });
    expect(JSON.stringify(event)).not.toContain('secret');
  });

  it('rejects malformed page input before it reaches storage', async () => {
    const pipeline = new EventPipeline(memoryStore());
    await expect(pipeline.ingestFromContent({ action: 'bad action' }, { url: 'https://shop.example/' })).rejects.toThrow();
  });
});
