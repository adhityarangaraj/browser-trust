import type { BrowserTrustEvent, Severity } from '../shared/types';

export type FindingCategory = 'communication' | 'capability';
export type EvidenceStrength = 'direct-observation' | 'temporal-association' | 'repeated-pattern';

/** A conclusion drawn from events. Always inferred, always traceable to evidence. */
export interface Finding {
  /** Deterministic from the rule and supporting event IDs. */
  id: string;
  ruleId: string;
  title: string;
  category: FindingCategory;
  /** Plain-language explanation of what happened and why it may matter. */
  explanation: string;
  severity: Severity;
  /** Events that support this finding. Must be non-empty. */
  eventIds: string[];
  /** Timestamps aligned with eventIds. */
  eventTimestamps: number[];
  sourceOrigin?: string;
  destinationHost?: string;
  evidenceStrength: EvidenceStrength;
  limitations: string[];
  /** Time this finding was derived, using the latest supporting event. */
  timestamp: number;
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
