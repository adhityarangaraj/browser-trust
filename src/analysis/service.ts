import type { EventPipeline } from '../core/pipeline';
import type { EventStore } from '../core/store';
import { analyzeEvent } from './engine';
import type { FindingStore } from './store';
import type { Rule } from './types';

/** The longest rule window today is the repeated-POST rule at 60 seconds. */
export const MAX_RULE_WINDOW_MS = 60_000;

export interface AnalysisConnection {
  /** Removes the pipeline subscription. */
  unsubscribe(): void;
  /** Resolves when every analysis task queued so far has finished (including dropped ones). */
  drain(): Promise<void>;
}

/** Connects validated pipeline events to deterministic rules and local findings storage. */
export function connectAnalysis(
  pipeline: EventPipeline,
  events: EventStore,
  findings: FindingStore,
  rules: readonly Rule[],
  onError: (error: unknown) => void = (error) => console.error('BrowserTrust: event analysis failed', error),
): AnalysisConnection {
  let queue: Promise<void> = Promise.resolve();
  const report = (error: unknown) => {
    try { onError(error); } catch (reportingError) {
      console.error('BrowserTrust: analysis error reporter failed', reportingError);
    }
  };
  const unsubscribe = pipeline.subscribe((event) => {
    const generationAtEmit = events.getGeneration();
    const run = queue.then(async () => {
      // The store was cleared after this event flowed through the pipeline.
      // Writing a finding derived from it would resurrect it as a zombie.
      if (events.getGeneration() !== generationAtEmit) return;
      try {
        const chronological = (await events.list()).reverse();
        if (events.getGeneration() !== generationAtEmit) return;
        const index = chronological.findIndex((item) => item.id === event.id);
        const historyFull = index < 0 ? chronological : chronological.slice(0, index);
        // Rules only ever reason within the longest configured window, so
        // older events can be dropped without changing results.
        const cutoff = event.timestamp - MAX_RULE_WINDOW_MS;
        const history = historyFull.filter((candidate) => candidate.timestamp >= cutoff);
        const produced = analyzeEvent(rules, event, history);
        if (events.getGeneration() !== generationAtEmit) return;
        await findings.appendMany(produced);
      } catch (error) {
        // The event has already been validated and stored; analysis must not
        // turn a rule or findings-storage failure into a dropped event.
        report(error);
      }
    });
    queue = run.catch(report);
    return queue;
  });
  return {
    unsubscribe,
    drain: () => queue.then(() => undefined, () => undefined),
  };
}
