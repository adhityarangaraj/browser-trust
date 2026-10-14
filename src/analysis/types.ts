import type { BrowserTrustEvent, Severity } from '../shared/types';

/** A conclusion drawn from events. Always inferred, always traceable to evidence. */
export interface Finding {
  ruleId: string;
  title: string;
  /** Plain-language explanation of what happened and why it may matter. */
  explanation: string;
  severity: Severity;
  confidence: number;
  /** Events that support this finding. Must be non-empty. */
  eventIds: string[];
}

/** A deterministic check over an event and the events before it. */
export interface Rule {
  readonly id: string;
  readonly description: string;
  evaluate(event: BrowserTrustEvent, history: readonly BrowserTrustEvent[]): Finding[];
}

/**
 * Optional, later-phase analyzer (e.g. a local language model). It receives
 * normalized events only and must return the same Finding shape.
 */
export interface BehaviorAnalyzer {
  readonly id: string;
  analyze(events: readonly BrowserTrustEvent[]): Promise<Finding[]>;
}
