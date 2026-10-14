import type { BrowserTrustEvent } from '../shared/types';
import type { Finding, Rule } from './types';

/**
 * Runs rules over events in chronological order; each event is evaluated
 * against the events that came before it. Not wired into the pipeline yet.
 */
export function analyze(rules: readonly Rule[], events: readonly BrowserTrustEvent[]): Finding[] {
  const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const findings: Finding[] = [];
  ordered.forEach((event, index) => {
    const history = ordered.slice(0, index);
    for (const rule of rules) {
      for (const finding of rule.evaluate(event, history)) {
        if (finding.eventIds.length === 0) {
          throw new Error(`Rule ${rule.id} returned a finding without supporting events`);
        }
        findings.push(finding);
      }
    }
  });
  return findings;
}
