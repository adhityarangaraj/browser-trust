import type { EventPipeline } from '../core/pipeline';
import type { EventStore } from '../core/store';
import { analyzeEvent } from './engine';
import type { FindingStore } from './store';
import type { Rule } from './types';

/** Connects validated pipeline events to deterministic rules and local findings storage. */
export function connectAnalysis(
  pipeline: EventPipeline,
  events: EventStore,
  findings: FindingStore,
  rules: readonly Rule[],
  onError: (error: unknown) => void = (error) => console.error('BrowserTrust: event analysis failed', error),
): () => void {
  let queue: Promise<void> = Promise.resolve();
  const report = (error: unknown) => {
    try { onError(error); } catch (reportingError) {
      console.error('BrowserTrust: analysis error reporter failed', reportingError);
    }
  };
  return pipeline.subscribe((event) => {
    const run = queue.then(async () => {
      try {
        const chronological = (await events.list()).reverse();
        const index = chronological.findIndex((item) => item.id === event.id);
        const history = index < 0 ? chronological : chronological.slice(0, index);
        await findings.appendMany(analyzeEvent(rules, event, history));
      } catch (error) {
        // The event has already been validated and stored; analysis must not
        // turn a rule or findings-storage failure into a dropped event.
        report(error);
      }
    });
    queue = run.catch(report);
    return queue;
  });
}
