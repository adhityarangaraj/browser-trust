/**
 * Pure, UI-agnostic report builder. Produces a snapshot of what the popup is
 * currently showing — assessment, findings, destinations and events for the
 * active tab — in two shapes:
 *
 *   - JSON: the raw structured object for programmatic use or diffing.
 *   - Markdown: a human-readable summary for pasting into tickets or chat.
 *
 * Both derive from the same already-sanitized data: events carry only metadata,
 * findings carry explanations and event IDs, destinations are host-grouped.
 * Nothing new is collected here, so "redacted" is a documented property of the
 * pipeline (see README's "What BrowserTrust observes"), not something this
 * module enforces at write time.
 */

import type { Assessment, AssessmentState } from './assessment';
import type { DestinationSummary } from './destinations';
import type { Finding } from './types';
import type { BrowserTrustEvent } from '../shared/types';

export interface ReportContext {
  host?: string;
  monitoringEnabled: boolean;
  coverageGranted: boolean;
}

export interface Report {
  generatedAt: string;
  host?: string;
  monitoring: 'enabled' | 'paused';
  coverage: 'granted' | 'missing';
  assessment: {
    state: AssessmentState;
    explanation: string;
    eventCount: number;
    findingCount: number;
  };
  findings: Finding[];
  destinations: DestinationSummary[];
  events: BrowserTrustEvent[];
}

export function buildReport(
  events: readonly BrowserTrustEvent[],
  findings: readonly Finding[],
  destinations: readonly DestinationSummary[],
  assessment: Pick<Assessment, 'state' | 'explanation' | 'eventCount' | 'findingCount'>,
  context: ReportContext,
  generatedAt: Date = new Date(),
): Report {
  return {
    generatedAt: generatedAt.toISOString(),
    ...(context.host ? { host: context.host } : {}),
    monitoring: context.monitoringEnabled ? 'enabled' : 'paused',
    coverage: context.coverageGranted ? 'granted' : 'missing',
    assessment: {
      state: assessment.state,
      explanation: assessment.explanation,
      eventCount: assessment.eventCount,
      findingCount: assessment.findingCount,
    },
    findings: [...findings],
    destinations: [...destinations],
    events: [...events],
  };
}

export function reportToJson(report: Report): string {
  return JSON.stringify(report, null, 2);
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.toISOString()}`;
}

function labelForState(state: AssessmentState): string {
  switch (state) {
    case 'insufficient-evidence': return 'Insufficient evidence';
    case 'no-suspicious-activity-observed': return 'No suspicious activity observed';
    case 'review-recommended': return 'Review recommended';
    case 'suspicious-activity-detected': return 'Suspicious activity detected';
  }
}

export function reportToMarkdown(report: Report): string {
  const lines: string[] = [];
  lines.push('# BrowserTrust report');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Host: ${report.host ?? 'unknown'}`);
  lines.push(`- Monitoring: ${report.monitoring}`);
  lines.push(`- Site access: ${report.coverage}`);
  lines.push(`- Assessment: **${labelForState(report.assessment.state)}**`);
  lines.push(`- Explanation: ${report.assessment.explanation}`);
  lines.push(`- Observations: ${report.assessment.eventCount} · Findings: ${report.assessment.findingCount}`);
  lines.push('');

  lines.push(`## Findings (${report.findings.length})`);
  if (report.findings.length === 0) {
    lines.push('_No findings for this page._');
  } else {
    for (const finding of report.findings) {
      lines.push(`### [${finding.severity}] ${finding.title}`);
      lines.push(`- Rule: \`${finding.ruleId}\``);
      lines.push(`- Evidence strength: ${finding.evidenceStrength.replaceAll('-', ' ')}`);
      if (finding.sourceOrigin) lines.push(`- Source: ${finding.sourceOrigin}`);
      if (finding.destinationHost) lines.push(`- Destination: ${finding.destinationHost}`);
      lines.push(`- When: ${formatTime(finding.timestamp)}`);
      lines.push(`- Explanation: ${finding.explanation}`);
      lines.push(`- Supporting events (${finding.eventIds.length}):`);
      finding.eventIds.forEach((id, index) => {
        const ts = finding.eventTimestamps[index];
        lines.push(`  - \`${id}\`${typeof ts === 'number' ? ` at ${formatTime(ts)}` : ''}`);
      });
      if (finding.limitations.length > 0) {
        lines.push(`- Limitations:`);
        for (const limitation of finding.limitations) lines.push(`  - ${limitation}`);
      }
      lines.push('');
    }
  }

  lines.push(`## Destinations (${report.destinations.length})`);
  if (report.destinations.length === 0) {
    lines.push('_No network destinations observed for this page._');
  } else {
    for (const destination of report.destinations) {
      const bits: string[] = [
        `${destination.observationCount} observation(s)`,
        destination.methods.join('/') || 'method unavailable',
        `from ${destination.sourceOrigins.join(', ')}`,
        `via ${destination.sources.join(', ')}`,
      ];
      if (destination.statusCodes.length > 0) bits.push(`status ${destination.statusCodes.join(', ')}`);
      if (destination.errorCount > 0) bits.push(`${destination.errorCount} failed`);
      if (destination.anyThirdParty) bits.push('third-party');
      bits.push(`latest ${formatTime(destination.lastObservedAt)}`);
      lines.push(`- **${destination.host}** — ${bits.join(' · ')}`);
    }
  }
  lines.push('');

  lines.push(`## Events (${report.events.length})`);
  if (report.events.length === 0) {
    lines.push('_No activity observed yet._');
  } else {
    for (const event of report.events) {
      const destination = event.destination?.host ? ` → ${event.destination.host}` : '';
      lines.push(`- ${formatTime(event.timestamp)} · \`${event.action}\` · ${event.source.origin}${destination} · ${event.evidence.mechanism} (\`${event.evidence.collector}\`)`);
    }
  }
  lines.push('');
  lines.push('_BrowserTrust records metadata only. Request bodies, form values, cookie values and clipboard contents are never collected._');
  return lines.join('\n');
}
