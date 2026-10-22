import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEvent } from '../src/core/normalize';
import {
  buildCompletedEvent,
  buildErrorEvent,
  buildNetworkEvent,
  createNetworkCollector,
  type CompletedDetails,
  type ErrorDetails,
  type RequestDetails,
} from '../src/collectors/network';

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

  it('carries requestId through so completed/failed events can merge', () => {
    const input = buildNetworkEvent({ ...base, requestId: 'r-42' })!;
    expect(input.evidence.details.requestId).toBe('r-42');
    expect(input.destination?.isThirdParty).toBe(true);
  });
});

describe('buildCompletedEvent', () => {
  const details: CompletedDetails = {
    url: 'https://tracker.example/collect',
    method: 'POST',
    type: 'xmlhttprequest',
    tabId: 4,
    frameId: 0,
    initiator: 'https://shop.example',
    statusCode: 204,
    requestId: 'r-42',
    fromCache: false,
  };

  it('records the status code and requestId without widening the destination', () => {
    const input = buildCompletedEvent(details)!;
    expect(input.action).toBe('request.completed');
    expect(input.evidence.details).toMatchObject({ statusCode: 204, requestId: 'r-42' });
  });

  it('is skipped for extension-initiated or tab-less traffic', () => {
    expect(buildCompletedEvent({ ...details, tabId: -1 })).toBeUndefined();
    expect(buildCompletedEvent({ ...details, initiator: 'chrome-extension://abc' })).toBeUndefined();
  });
});

describe('buildErrorEvent', () => {
  const details: ErrorDetails = {
    url: 'https://tracker.example/collect',
    method: 'POST',
    type: 'xmlhttprequest',
    tabId: 4,
    frameId: 0,
    initiator: 'https://shop.example',
    error: 'net::ERR_FAILED',
    requestId: 'r-42',
  };

  it('records the error string and requestId', () => {
    const input = buildErrorEvent(details)!;
    expect(input.action).toBe('request.failed');
    expect(input.evidence.details).toMatchObject({ error: 'net::ERR_FAILED', requestId: 'r-42' });
  });
});

describe('network collector registration', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retries registration after the optional permission becomes available', () => {
    let shouldThrow = true;
    let registrations = 0;
    const event = {
      addListener: () => {
        registrations += 1;
        if (shouldThrow) throw new Error('webRequest permission is missing');
      },
    };
    vi.stubGlobal('chrome', { webRequest: { onBeforeRequest: event } });
    const collector = createNetworkCollector();

    expect(() => collector.attach({ emit: async () => undefined })).toThrow('permission is missing');
    shouldThrow = false;
    collector.attach({ emit: async () => undefined });
    collector.attach({ emit: async () => undefined });

    expect(registrations).toBe(2);
  });
});
