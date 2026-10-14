import type { BrowserTrustEvent } from '../shared/types';
import type { Finding, Rule } from './types';

/**
 * Runs rules over events in chronological order; each event is evaluated
 * against the events that came before it. Duplicate findings are collapsed by
 * their deterministic ID.
 */
export function analyze(rules: readonly Rule[], events: readonly BrowserTrustEvent[]): Finding[] {
  const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const findings: Finding[] = [];
  const seen = new Set<string>();
  ordered.forEach((event, index) => {
    for (const finding of analyzeEvent(rules, event, ordered.slice(0, index))) {
      if (seen.has(finding.id)) continue;
      seen.add(finding.id);
      findings.push(finding);
    }
  });
  return findings;
}

/** Evaluates only a newly ingested event against its chronological history. */
export function analyzeEvent(
  rules: readonly Rule[],
  event: BrowserTrustEvent,
  history: readonly BrowserTrustEvent[],
): Finding[] {
  const orderedHistory = [...history].filter((candidate) => candidate.id !== event.id).sort((a, b) => a.timestamp - b.timestamp);
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    for (const finding of rule.evaluate(event, orderedHistory)) {
      if (finding.eventIds.length === 0) {
        throw new Error(`Rule ${rule.id} returned a finding without supporting events`);
      }
      if (finding.eventTimestamps.length !== finding.eventIds.length) {
        throw new Error(`Rule ${rule.id} returned mismatched event timestamps`);
      }
      if (seen.has(finding.id)) continue;
      seen.add(finding.id);
      findings.push(finding);
    }
  }
  return findings;
}
