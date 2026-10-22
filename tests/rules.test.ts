import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analysis/engine';
import {
  capabilityNetworkRule,
  dynamicThirdPartyScriptRule,
  formNetworkRule,
  hiddenCrossOriginIframeRule,
  repeatedExternalPostRule,
  rules,
  scriptedFormNetworkRule,
  sensitiveCapabilityRule,
} from '../src/analysis/rules';
import { createEvent } from '../src/core/normalize';
import type { BrowserTrustEvent, EventCategory, JsonValue } from '../src/shared/types';

function event(args: {
  id: string;
  timestamp: number;
  category: EventCategory;
  action: string;
  tabId?: number;
  origin?: string;
  host?: string;
  method?: string;
  mechanism?: 'extension-api' | 'content-script' | 'main-world-hook';
  crossOrigin?: boolean;
  api?: string;
  isTrusted?: boolean;
  detailsMethod?: string;
}): BrowserTrustEvent {
  return createEvent({
    category: args.category,
    action: args.action,
    source: { origin: args.origin ?? 'https://shop.example', ...(args.tabId !== undefined ? { tabId: args.tabId } : {}) },
    ...(args.host ? { destination: {
      host: args.host,
      origin: `https://${args.host}`,
      method: args.method ?? 'GET',
      isCrossOrigin: args.crossOrigin ?? true,
    } } : {}),
    evidence: {
      collector: args.mechanism === 'extension-api' ? 'network.webrequest' : 'page.hook',
      mechanism: args.mechanism ?? 'content-script',
      details: {
        ...(args.api ? { api: args.api } : {}),
        ...(args.isTrusted !== undefined ? { isTrusted: args.isTrusted } : {}),
        ...(args.detailsMethod ? { method: args.detailsMethod } : {}),
      },
    },
    provenance: 'observed',
  }, { newId: () => args.id, now: () => args.timestamp });
}

const form = (id = 'form', timestamp = 1000, tabId = 7, host = 'collector.example', method = 'POST') => event({
  id, timestamp, category: 'form', action: 'form.submitted', tabId, host, method,
  detailsMethod: method.toLowerCase(), isTrusted: true,
});
const request = (id = 'request', timestamp = 2000, tabId = 7, host = 'collector.example', method = 'POST') => event({
  id, timestamp, category: 'network', action: 'request.sent', tabId, host, method, mechanism: 'extension-api',
});
const location = (id = 'location', timestamp = 1000, tabId = 7) => event({
  id, timestamp, category: 'capability', action: 'geolocation.requested', tabId, api: 'getCurrentPosition', mechanism: 'main-world-hook',
});

describe('deterministic rules', () => {
  it('correlates form submission and network request at the inclusive window boundary', () => {
    const findings = analyze([formNetworkRule], [request('request', 31_000), form()]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      eventIds: ['form', 'request'], eventTimestamps: [1000, 31_000],
      destinationHost: 'collector.example', evidenceStrength: 'temporal-association',
    });
    expect(findings[0]?.limitations.join(' ')).toMatch(/payloads are not collected/i);
  });

  it('does not correlate outside the window or across tab/source contexts', () => {
    expect(analyze([formNetworkRule], [form(), request('late', 31_001)])).toEqual([]);
    expect(analyze([formNetworkRule], [form(), request('other-tab', 2000, 8)])).toEqual([]);
    expect(analyze([formNetworkRule], [form(), event({
      id: 'other-origin', timestamp: 2000, category: 'network', action: 'request.sent', tabId: 7,
      origin: 'https://other.example', host: 'collector.example', mechanism: 'extension-api',
    })])).toEqual([]);
  });

  it('requires a trusted submit with a matching method and known destination', () => {
    const untrusted = event({
      id: 'synthetic-form', timestamp: 1000, category: 'form', action: 'form.submitted', tabId: 7,
      host: 'collector.example', method: 'POST', isTrusted: false,
    });
    expect(analyze([formNetworkRule], [untrusted, request()])).toEqual([]);
    expect(analyze([formNetworkRule], [form(), request('wrong-method', 2000, 7, 'collector.example', 'GET')])).toEqual([]);
    expect(analyze([formNetworkRule], [form(), request('wrong-host', 2000, 7, 'elsewhere.example', 'POST')])).toEqual([]);
  });

  it('flags supported sensitive API calls without claiming successful access', () => {
    const finding = analyze([sensitiveCapabilityRule], [location()])[0];
    expect(finding).toMatchObject({ ruleId: 'capability.sensitive-request', evidenceStrength: 'direct-observation' });
    expect(finding?.limitations.join(' ')).toMatch(/does not prove/i);
  });

  it('correlates capability and network only within the bounded same-page window', () => {
    expect(analyze([capabilityNetworkRule], [location(), request('near', 16_000)])).toHaveLength(1);
    expect(analyze([capabilityNetworkRule], [location(), request('outside', 16_001)])).toEqual([]);
    expect(analyze([capabilityNetworkRule], [location(), request('other-tab', 2000, 8)])).toEqual([]);
  });

  it('escalates capability-network to high severity when the request is a cross-origin POST', () => {
    const highFinding = analyze([capabilityNetworkRule], [location(), request('post', 2000, 7, 'collector.example', 'POST')])[0];
    expect(highFinding?.severity).toBe('high');
    expect(highFinding?.title).toMatch(/cross-origin POST/);
    const sameOriginRequest = event({
      id: 'same-origin', timestamp: 2000, category: 'network', action: 'request.sent', tabId: 7,
      origin: 'https://shop.example', host: 'shop.example', method: 'POST', mechanism: 'extension-api', crossOrigin: false,
    });
    expect(analyze([capabilityNetworkRule], [location(), sameOriginRequest])[0]?.severity).toBe('medium');
    const getRequest = request('get', 2000, 7, 'collector.example', 'GET');
    expect(analyze([capabilityNetworkRule], [location(), getRequest])[0]?.severity).toBe('medium');
  });

  it('requires repeated cross-origin POST metadata and anchors the finding to three observations', () => {
    const events = [request('p1', 1000), request('p2', 20_000), request('p3', 60_000), request('p4', 60_001)];
    const findings = analyze([repeatedExternalPostRule], events);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.eventIds).toEqual(['p1', 'p2', 'p3']);
    expect(findings[0]?.severity).toBe('medium');
    expect(analyze([repeatedExternalPostRule], [request('old1', 1_000), request('old2', 20_000), request('old3', 61_001)])).toEqual([]);
    expect(analyze([repeatedExternalPostRule], [request('get1', 1, 7, 'cdn.example', 'GET')])).toEqual([]);
  });

  it('escalates to a high-severity finding when the repeated-POST pattern sustains to six observations', () => {
    const burst = [1, 2, 3, 4, 5, 6].map((i) => request(`p${i}`, 1000 + i * 1000));
    const findings = analyze([repeatedExternalPostRule], burst);
    const medium = findings.find((f) => f.severity === 'medium');
    const high = findings.find((f) => f.severity === 'high');
    expect(medium?.eventIds).toEqual(['p1', 'p2', 'p3']);
    expect(high?.eventIds).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    expect(high?.title).toMatch(/sustained/i);
    // The two findings have distinct IDs so neither dedupes the other.
    expect(medium?.id).not.toEqual(high?.id);
  });

  it('does not flag ordinary external GET requests or page-hook-only metadata', () => {
    const ordinary = event({
      id: 'get', timestamp: 1, category: 'network', action: 'request.sent', tabId: 7,
      host: 'cdn.example', method: 'GET', mechanism: 'extension-api',
    });
    const hookOnly = event({
      id: 'hook', timestamp: 2, category: 'network', action: 'request.sent', tabId: 7,
      host: 'collector.example', method: 'POST', mechanism: 'main-world-hook',
    });
    expect(analyze(rules, [ordinary, hookOnly])).toEqual([]);
  });

  it('does not throw for missing optional destination metadata', () => {
    const incomplete = event({ id: 'network', timestamp: 2, category: 'network', action: 'request.sent', tabId: 7, mechanism: 'extension-api' });
    expect(() => analyze(rules, [form(), incomplete])).not.toThrow();
  });

  function dom(args: {
    id: string;
    timestamp: number;
    tag: 'iframe' | 'script';
    host?: string;
    isCrossOrigin?: boolean;
    isThirdParty?: boolean;
    hiddenHint?: boolean;
    initial?: boolean;
  }): BrowserTrustEvent {
    const details: Record<string, JsonValue> = { tag: args.tag, initial: args.initial ?? false };
    if (args.hiddenHint !== undefined) details.hiddenHint = args.hiddenHint;
    return createEvent({
      category: 'dom',
      action: 'element.added',
      source: { origin: 'https://shop.example', tabId: 7 },
      ...(args.host ? { destination: {
        host: args.host,
        origin: `https://${args.host}`,
        ...(args.isCrossOrigin !== undefined ? { isCrossOrigin: args.isCrossOrigin } : {}),
        ...(args.isThirdParty !== undefined ? { isThirdParty: args.isThirdParty } : {}),
      } } : {}),
      evidence: { collector: 'dom.mutations', mechanism: 'content-script', details },
      provenance: 'observed',
    }, { newId: () => args.id, now: () => args.timestamp });
  }

  it('flags hidden cross-origin iframes but ignores visible or same-origin ones', () => {
    const hiddenCross = dom({ id: 'iframe-hc', timestamp: 1, tag: 'iframe', host: 'tracker.example', isCrossOrigin: true, hiddenHint: true });
    const findings = analyze([hiddenCrossOriginIframeRule], [hiddenCross]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'medium', destinationHost: 'tracker.example' });
    const visibleCross = dom({ id: 'iframe-vc', timestamp: 2, tag: 'iframe', host: 'tracker.example', isCrossOrigin: true, hiddenHint: false });
    expect(analyze([hiddenCrossOriginIframeRule], [visibleCross])).toEqual([]);
    const hiddenSame = dom({ id: 'iframe-hs', timestamp: 3, tag: 'iframe', host: 'shop.example', isCrossOrigin: false, hiddenHint: true });
    expect(analyze([hiddenCrossOriginIframeRule], [hiddenSame])).toEqual([]);
  });

  it('flags dynamically-injected cross-site scripts but ignores initial ones and same-site ones', () => {
    const injected = dom({ id: 'script-inj', timestamp: 1, tag: 'script', host: 'cdn.other.net', isThirdParty: true, initial: false });
    const findings = analyze([dynamicThirdPartyScriptRule], [injected]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('low');
    const initial = dom({ id: 'script-init', timestamp: 2, tag: 'script', host: 'cdn.other.net', isThirdParty: true, initial: true });
    expect(analyze([dynamicThirdPartyScriptRule], [initial])).toEqual([]);
    const sameSite = dom({ id: 'script-same', timestamp: 3, tag: 'script', host: 'static.shop.example', isThirdParty: false, initial: false });
    expect(analyze([dynamicThirdPartyScriptRule], [sameSite])).toEqual([]);
  });

  it('correlates a scripted form.submit() with a later network request from the same page', () => {
    const scripted = event({
      id: 'scripted-form', timestamp: 1000, category: 'form', action: 'form.submit_called', tabId: 7,
      host: 'collector.example', method: 'POST', mechanism: 'main-world-hook',
    });
    const findings = analyze([scriptedFormNetworkRule], [scripted, request('scripted-req', 10_000)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'low', eventIds: ['scripted-form', 'scripted-req'] });
    // Outside the window
    expect(analyze([scriptedFormNetworkRule], [scripted, request('late', 31_001)])).toEqual([]);
    // Different tab
    expect(analyze([scriptedFormNetworkRule], [scripted, request('other-tab', 2000, 8)])).toEqual([]);
    // The declarative formNetworkRule does not fire for a scripted submit (no `submit` event, no isTrusted)
    expect(analyze([formNetworkRule], [scripted, request('scripted-req', 10_000)])).toEqual([]);
  });
});
