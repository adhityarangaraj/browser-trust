import { describe, expect, it } from 'vitest';
import { summarizeDestinations } from '../src/analysis/destinations';
import { createEvent } from '../src/core/normalize';

function network(id: string, host: string, timestamp: number, mechanism: 'extension-api' | 'main-world-hook', method = 'GET') {
  return createEvent({
    category: 'network', action: 'request.sent', source: { origin: 'https://shop.example', tabId: 1 },
    destination: { host, origin: `https://${host}`, url: `https://${host}/path`, method },
    evidence: { collector: mechanism === 'extension-api' ? 'network.webrequest' : 'page.hook', mechanism, details: {} },
    provenance: 'observed',
  }, { newId: () => id, now: () => timestamp });
}

describe('summarizeDestinations', () => {
  it('groups by host, preserves evidence sources and methods, and does not pretend observations are deduplicated', () => {
    const summaries = summarizeDestinations([
      network('a', 'api.example', 1, 'extension-api', 'POST'),
      network('b', 'api.example', 2, 'main-world-hook', 'POST'),
      network('c', 'cdn.example', 3, 'extension-api'),
    ]);
    expect(summaries[0]).toMatchObject({
      host: 'cdn.example', observationCount: 1, sources: ['extension-api'], sourceOrigins: ['https://shop.example'], eventIds: ['c'],
    });
    expect(summaries[1]).toMatchObject({
      host: 'api.example', observationCount: 2, methods: ['POST'],
      sourceOrigins: ['https://shop.example'], sources: ['extension-api', 'main-world-hook'], eventIds: ['a', 'b'],
    });
  });

  it('skips non-network events and network events without a hostname', () => {
    const incomplete = createEvent({
      category: 'network', action: 'request.sent', source: { origin: 'https://shop.example' },
      evidence: { collector: 'network.webrequest', mechanism: 'extension-api', details: {} }, provenance: 'observed',
    });
    expect(summarizeDestinations([incomplete])).toEqual([]);
  });

  it('merges status codes and error counts from completed/failed events by requestId', () => {
    const sent = createEvent({
      category: 'network', action: 'request.sent', source: { origin: 'https://shop.example', tabId: 1 },
      destination: { host: 'tracker.example', origin: 'https://tracker.example', url: 'https://tracker.example/a', method: 'POST', isThirdParty: true },
      evidence: { collector: 'network.webrequest', mechanism: 'extension-api', details: { requestId: 'r-1' } },
      provenance: 'observed',
    }, { newId: () => 's1', now: () => 1 });
    const completed = createEvent({
      category: 'network', action: 'request.completed', source: { origin: 'https://shop.example', tabId: 1 },
      destination: { host: 'tracker.example', origin: 'https://tracker.example', method: 'POST' },
      evidence: { collector: 'network.webrequest', mechanism: 'extension-api', details: { requestId: 'r-1', statusCode: 204 } },
      provenance: 'observed',
    }, { newId: () => 'c1', now: () => 2 });
    const failed = createEvent({
      category: 'network', action: 'request.failed', source: { origin: 'https://shop.example', tabId: 1 },
      destination: { host: 'tracker.example', origin: 'https://tracker.example', method: 'POST' },
      evidence: { collector: 'network.webrequest', mechanism: 'extension-api', details: { requestId: 'r-2', error: 'net::ERR_FAILED' } },
      provenance: 'observed',
    }, { newId: () => 'f1', now: () => 3 });
    const [summary] = summarizeDestinations([sent, completed, failed]);
    expect(summary).toMatchObject({
      host: 'tracker.example',
      observationCount: 1, // only request.sent counts, completions do not double
      statusCodes: [204],
      errorCount: 1,
      anyThirdParty: true,
    });
  });
});
