import { describe, expect, it } from 'vitest';
import { assessSite } from '../src/analysis/assessment';
import type { Finding } from '../src/analysis/types';
import { createEvent } from '../src/core/normalize';
import type { BrowserTrustEvent } from '../src/shared/types';

const event: BrowserTrustEvent = createEvent({
  category: 'page', action: 'page.loaded', source: { origin: 'https://shop.example', tabId: 4 },
  evidence: { collector: 'page.lifecycle', mechanism: 'content-script', details: {} }, provenance: 'observed',
}, { newId: () => 'page-event', now: () => 100 });

const context = {
  origin: 'https://shop.example', tabId: 4, monitoringEnabled: true, siteAccessGranted: true,
  contentScriptRegistered: true, collectors: [{
    id: 'network.webrequest', categories: ['network'] as const, mechanism: 'extension-api' as const,
    requiredPermissions: ['webRequest'] as chrome.runtime.ManifestPermission[], state: 'active' as const,
  }],
};

const finding: Finding = {
  id: 'review-1', ruleId: 'test.rule', title: 'Review', category: 'communication', explanation: 'Review this',
  severity: 'medium', eventIds: ['page-event'], eventTimestamps: [100], evidenceStrength: 'temporal-association',
  limitations: ['Causation is not established.'], timestamp: 100,
};

describe('assessSite', () => {
  it('reports insufficient evidence for monitoring off, missing access, missing API permission, and no activity', () => {
    expect(assessSite([event], [], { ...context, monitoringEnabled: false }).state).toBe('insufficient-evidence');
    expect(assessSite([event], [], { ...context, siteAccessGranted: false }).state).toBe('insufficient-evidence');
    expect(assessSite([event], [], {
      ...context, collectors: [{ ...context.collectors[0]!, state: 'needs-permission' }],
    }).explanation).toMatch(/incomplete/i);
    expect(assessSite([], [], context).state).toBe('insufficient-evidence');
    expect(assessSite([event, event, event], [], context).explanation).toMatch(/network event/i);
    expect(assessSite([event], [], { ...context, contentScriptRegistered: false }).explanation).toMatch(/not registered/i);
  });

  it('distinguishes a clean observation period from review and high-severity findings', () => {
    const observations = [event,
      createEvent({
        category: 'network', action: 'request.sent', source: { origin: 'https://shop.example', tabId: 4 },
        destination: { host: 'shop.example', method: 'GET' },
        evidence: { collector: 'network.webrequest', mechanism: 'extension-api', details: {} }, provenance: 'observed',
      }),
      createEvent({
        category: 'dom', action: 'element.added', source: { origin: 'https://shop.example', tabId: 4 },
        evidence: { collector: 'dom.mutations', mechanism: 'content-script', details: {} }, provenance: 'observed',
      }),
    ];
    expect(assessSite(observations, [], context).state).toBe('no-suspicious-activity-observed');
    expect(assessSite(observations, [finding], context).state).toBe('review-recommended');
    expect(assessSite(observations, [{ ...finding, severity: 'high' }], context).state).toBe('suspicious-activity-detected');
    expect(assessSite(observations, [], context).explanation).toMatch(/not proof/i);
    // Low-only findings surface but do NOT flip the overall assessment.
    const lowOnly = assessSite(observations, [{ ...finding, severity: 'low' }], context);
    expect(lowOnly.state).toBe('no-suspicious-activity-observed');
    expect(lowOnly.findings).toHaveLength(1);
    expect(lowOnly.explanation).toMatch(/did not promote/);
  });

  it('does not promote medium findings on a well-known common host to review', () => {
    const observations = [event,
      createEvent({
        category: 'network', action: 'request.sent', source: { origin: 'https://www.youtube.com', tabId: 4 },
        destination: { host: 'youtube.com', method: 'GET' },
        evidence: { collector: 'network.webrequest', mechanism: 'extension-api', details: {} }, provenance: 'observed',
      }),
      createEvent({
        category: 'dom', action: 'element.added', source: { origin: 'https://www.youtube.com', tabId: 4 },
        evidence: { collector: 'dom.mutations', mechanism: 'content-script', details: {} }, provenance: 'observed',
      }),
    ];
    const allowlistedContext = { ...context, origin: 'https://www.youtube.com', host: 'www.youtube.com' };
    const result = assessSite(observations, [finding], allowlistedContext);
    expect(result.state).toBe('no-suspicious-activity-observed');
    expect(result.findings).toHaveLength(1);
    expect(result.explanation).toMatch(/did not promote/);
    expect(result.explanation).not.toMatch(/built-in list/);
    // The same medium finding on a non-allowlisted host still promotes.
    const unlistedContext = { ...context, origin: 'https://unknown.example', host: 'unknown.example' };
    expect(assessSite(observations, [finding], unlistedContext).state).toBe('review-recommended');
  });

  it('does NOT promote high-severity pattern findings on allowlisted hosts, but still surfaces them', () => {
    const observations = [event,
      createEvent({
        category: 'network', action: 'request.sent', source: { origin: 'https://github.com', tabId: 4 },
        destination: { host: 'collector.github.com', method: 'POST' },
        evidence: { collector: 'network.webrequest', mechanism: 'extension-api', details: {} }, provenance: 'observed',
      }),
      createEvent({
        category: 'dom', action: 'element.added', source: { origin: 'https://github.com', tabId: 4 },
        evidence: { collector: 'dom.mutations', mechanism: 'content-script', details: {} }, provenance: 'observed',
      }),
    ];
    const allowlistedContext = { ...context, origin: 'https://github.com', host: 'github.com' };
    const result = assessSite(observations, [{ ...finding, severity: 'high' }], allowlistedContext);
    expect(result.state).toBe('no-suspicious-activity-observed');
    expect(result.findings).toHaveLength(1);
    expect(result.explanation).toMatch(/did not promote/);
    expect(result.explanation).not.toMatch(/built-in list/);
    // The same high finding on a non-allowlisted host still escalates.
    const unlistedContext = { ...context, origin: 'https://unknown.example', host: 'unknown.example' };
    expect(assessSite(observations, [{ ...finding, severity: 'high' }], unlistedContext).state)
      .toBe('suspicious-activity-detected');
  });

  it('scopes counts to the current tab, including frames, and excludes other tabs', () => {
    const otherTab = createEvent({
      category: 'page', action: 'page.loaded', source: { origin: 'https://shop.example', tabId: 5 },
      evidence: { collector: 'page.lifecycle', mechanism: 'content-script', details: {} }, provenance: 'observed',
    });
    const result = assessSite([event, otherTab], [finding], context);
    expect(result.eventCount).toBe(1);
    expect(result.findingCount).toBe(1);
    const frameEvent = createEvent({
      category: 'form', action: 'form.submitted', source: { origin: 'https://embedded.example', tabId: 4, frameId: 2 },
      evidence: { collector: 'form.interaction', mechanism: 'content-script', details: {} }, provenance: 'observed',
    });
    expect(assessSite([event, frameEvent], [], context).eventCount).toBe(2);
  });
});
