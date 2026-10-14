import { describe, expect, it } from 'vitest';
import { createEvent } from '../src/core/normalize';
import { EventPipeline } from '../src/core/pipeline';
import { EventStore, type StorageAdapter } from '../src/core/store';

function memoryAdapter(): StorageAdapter {
  const data = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
  };
}

const input = {
  category: 'page' as const,
  action: 'page.loaded',
  source: { origin: 'https://example.com' },
  evidence: { collector: 't', mechanism: 'content-script' as const, details: {} },
  provenance: 'observed' as const,
};

describe('EventStore', () => {
  it('starts empty and lists newest first', async () => {
    const store = new EventStore(memoryAdapter());
    expect(await store.count()).toBe(0);
    await store.append(createEvent(input, { newId: () => 'a' }));
    await store.append(createEvent(input, { newId: () => 'b' }));
    expect((await store.list()).map((e) => e.id)).toEqual(['b', 'a']);
    expect(await store.list(1)).toHaveLength(1);
  });

  it('drops the oldest events beyond the cap', async () => {
    const store = new EventStore(memoryAdapter(), 2);
    for (const id of ['a', 'b', 'c']) await store.append(createEvent(input, { newId: () => id }));
    expect((await store.list()).map((e) => e.id)).toEqual(['c', 'b']);
  });

  it('does not lose events appended concurrently', async () => {
    const store = new EventStore(memoryAdapter());
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.append(createEvent(input, { newId: () => `e${i}` }))),
    );
    expect(await store.count()).toBe(20);
  });

  it('clears', async () => {
    const store = new EventStore(memoryAdapter());
    await store.append(createEvent(input));
    await store.clear();
    expect(await store.count()).toBe(0);
  });
});

describe('EventPipeline.ingestFromContent', () => {
  const { source: _ignored, ...contentInput } = input;

  it('derives the source from the sender, ignoring any claimed source', async () => {
    const store = new EventStore(memoryAdapter());
    const pipeline = new EventPipeline(store);
    const claimed = { ...contentInput, source: { origin: 'https://spoofed.example' } };
    const event = await pipeline.ingestFromContent(claimed, {
      url: 'https://real.example/path?secret=1#frag',
      tabId: 3,
      frameId: 0,
    });
    expect(event.source).toEqual({
      origin: 'https://real.example',
      url: 'https://real.example/path',
      tabId: 3,
      frameId: 0,
    });
    expect(await store.count()).toBe(1);
  });

  it('rejects invalid events without storing them', async () => {
    const store = new EventStore(memoryAdapter());
    const pipeline = new EventPipeline(store);
    await expect(
      pipeline.ingestFromContent({ category: 'bogus' }, { url: 'https://real.example/' }),
    ).rejects.toThrow();
    expect(await store.count()).toBe(0);
  });

  it('notifies subscribers', async () => {
    const pipeline = new EventPipeline(new EventStore(memoryAdapter()));
    const seen: string[] = [];
    pipeline.subscribe((e) => seen.push(e.action));
    await pipeline.ingestFromContent(contentInput, { url: 'https://real.example/' });
    expect(seen).toEqual(['page.loaded']);
  });
});
