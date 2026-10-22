import { describe, expect, it } from 'vitest';
import { buildReport, reportToJson, reportToMarkdown } from '../src/analysis/report';
import type { Finding } from '../src/analysis/types';
import type { DestinationSummary } from '../src/analysis/destinations';
import { createEvent } from '../src/core/normalize';

const assessment = {
  state: 'review-recommended' as const,
  explanation: 'Some observed behavior matched a review rule.',
  eventCount: 2,
  findingCount: 1,
};

const event = createEvent({
  category: 'network', action: 'request.sent', source: { origin: 'https://shop.example', tabId: 1 },
  destination: { host: 'tracker.example', method: 'POST' },
  evidence: { collector: 'network.webrequest', mechanism: 'extension-api', details: {} }, provenance: 'observed',
}, { newId: () => 'event-1', now: () => 1_700_000_000_000 });

const finding: Finding = {
  id: 'r:1', ruleId: 'sequence.form-network', title: 'Form activity followed by a request',
  category: 'communication', explanation: 'A form submission was followed by a request.',
  severity: 'medium', eventIds: ['form-1', 'event-1'], eventTimestamps: [1_700_000_000_000, 1_700_000_000_500],
  sourceOrigin: 'https://shop.example', destinationHost: 'tracker.example',
  evidenceStrength: 'temporal-association', limitations: ['Payloads are not collected.'],
  timestamp: 1_700_000_000_500,
};

const destination: DestinationSummary = {
  host: 'tracker.example', observationCount: 2, methods: ['POST'],
  sourceOrigins: ['https://shop.example'], lastObservedAt: 1_700_000_000_500,
  sources: ['extension-api'], eventIds: ['event-1'],
  statusCodes: [204], errorCount: 0, anyThirdParty: true,
};

describe('buildReport', () => {
  it('captures scope and the current observation set', () => {
    const report = buildReport([event], [finding], [destination], assessment, {
      host: 'shop.example', monitoringEnabled: true, coverageGranted: true,
    }, new Date('2026-10-22T11:50:00Z'));
    expect(report).toMatchObject({
      generatedAt: '2026-10-22T11:50:00.000Z',
      host: 'shop.example',
      monitoring: 'enabled',
      coverage: 'granted',
      assessment: { state: 'review-recommended', eventCount: 2, findingCount: 1 },
    });
    expect(report.findings).toHaveLength(1);
    expect(report.destinations).toHaveLength(1);
    expect(report.events).toHaveLength(1);
  });

  it('round-trips through JSON without losing finding fields', () => {
    const report = buildReport([event], [finding], [destination], assessment, {
      monitoringEnabled: false, coverageGranted: false,
    });
    const json = reportToJson(report);
    const parsed = JSON.parse(json);
    expect(parsed.monitoring).toBe('paused');
    expect(parsed.coverage).toBe('missing');
    expect(parsed.findings[0].ruleId).toBe('sequence.form-network');
    expect(parsed.destinations[0].anyThirdParty).toBe(true);
  });
});

describe('reportToMarkdown', () => {
  const report = buildReport([event], [finding], [destination], assessment, {
    host: 'shop.example', monitoringEnabled: true, coverageGranted: true,
  }, new Date('2026-10-22T11:50:00Z'));
  const markdown = reportToMarkdown(report);

  it('includes the assessment headline, finding title, destination row, and privacy footer', () => {
    expect(markdown).toContain('# BrowserTrust report');
    expect(markdown).toContain('**Review recommended**');
    expect(markdown).toContain('### [medium] Form activity followed by a request');
    expect(markdown).toContain('`sequence.form-network`');
    expect(markdown).toContain('**tracker.example**');
    expect(markdown).toContain('status 204');
    expect(markdown).toContain('third-party');
    expect(markdown).toContain('metadata only');
  });

  it('reports empty sections honestly instead of omitting them', () => {
    const empty = buildReport([], [], [], { ...assessment, state: 'insufficient-evidence', eventCount: 0, findingCount: 0 }, {
      host: 'shop.example', monitoringEnabled: true, coverageGranted: false,
    });
    const markdownEmpty = reportToMarkdown(empty);
    expect(markdownEmpty).toContain('## Findings (0)');
    expect(markdownEmpty).toContain('_No findings for this page._');
    expect(markdownEmpty).toContain('_No network destinations observed for this page._');
    expect(markdownEmpty).toContain('_No activity observed yet._');
  });
});
