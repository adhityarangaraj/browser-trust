import { describe, expect, it } from 'vitest';
import { createEvent } from '../src/core/normalize';
import { buildNetworkEvent, type RequestDetails } from '../src/collectors/network';

const base: RequestDetails = {
  url: 'https://tracker.example/collect?id=SECRET&v=1#x',
  method: 'POST',
  type: 'xmlhttprequest',
  tabId: 4,
  frameId: 0,
  initiator: 'https://shop.example',
};

describe('buildNetworkEvent', () => {
  it('builds a valid, metadata-only event', () => {
    const input = buildNetworkEvent(base)!;
    const event = createEvent(input);
    expect(event.category).toBe('network');
    expect(event.source).toMatchObject({ origin: 'https://shop.example', tabId: 4 });
    expect(event.destination).toMatchObject({
      host: 'tracker.example',
      url: 'https://tracker.example/collect',
      isCrossOrigin: true,
    });
    expect(JSON.stringify(event)).not.toContain('SECRET');
    expect(event.evidence.details).toMatchObject({ hasQuery: true, queryParamCount: 2, initiatorKnown: true });
  });

  it('uses the destination as source for top-level navigations', () => {
    const input = buildNetworkEvent({ ...base, type: 'main_frame', method: 'GET', initiator: undefined })!;
    expect(input.source.origin).toBe('https://tracker.example');
    expect(input.destination?.isCrossOrigin).toBe(false);
    expect(input.evidence.details.initiatorKnown).toBe(false);
  });

  it('ignores tab-less and extension traffic', () => {
    expect(buildNetworkEvent({ ...base, tabId: -1 })).toBeUndefined();
    expect(buildNetworkEvent({ ...base, initiator: 'chrome-extension://abc' })).toBeUndefined();
  });
});
