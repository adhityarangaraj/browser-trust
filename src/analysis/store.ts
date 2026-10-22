import type { StorageAdapter } from '../core/store';
import type { Finding } from './types';

export const FINDINGS_KEY = 'bt.findings';
export const MAX_FINDINGS = 500;

/** Bounded, locally persisted findings with stable-ID deduplication. */
export class FindingStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly adapter: StorageAdapter, private readonly maxFindings = MAX_FINDINGS) {}

  /** Returns the subset of `findings` that were actually appended (not duplicates). */
  appendMany(findings: readonly Finding[]): Promise<Finding[]> {
    return this.enqueue(async () => {
      const stored = await this.read();
      const ids = new Set(stored.map((finding) => finding.id));
      const additions = findings.filter((finding) => {
        if (ids.has(finding.id)) return false;
        ids.add(finding.id);
        return true;
      });
      if (additions.length === 0) return [];
      await this.adapter.set(FINDINGS_KEY, [...stored, ...additions].slice(-this.maxFindings));
      return additions;
    });
  }

  list(limit?: number): Promise<Finding[]> {
    return this.enqueue(async () => {
      const newestFirst = (await this.read()).reverse();
      return limit === undefined ? newestFirst : newestFirst.slice(0, Math.max(0, limit));
    });
  }

  count(): Promise<number> {
    return this.enqueue(async () => (await this.read()).length);
  }

  clear(): Promise<void> {
    return this.enqueue(() => this.adapter.set(FINDINGS_KEY, []));
  }

  private async read(): Promise<Finding[]> {
    const stored = await this.adapter.get<unknown>(FINDINGS_KEY);
    if (!Array.isArray(stored)) return [];
    return stored.filter(isFinding);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function isFinding(value: unknown): value is Finding {
  if (!isRecord(value)) return false;
  return isString(value.id) && isString(value.ruleId) && isString(value.title) &&
    (value.category === 'communication' || value.category === 'capability') &&
    isString(value.explanation) &&
    (value.severity === 'info' || value.severity === 'low' || value.severity === 'medium' || value.severity === 'high') &&
    Array.isArray(value.eventIds) && value.eventIds.length > 0 && value.eventIds.every(isString) &&
    Array.isArray(value.eventTimestamps) && value.eventTimestamps.length === value.eventIds.length &&
    value.eventTimestamps.every((timestamp) => typeof timestamp === 'number' && Number.isFinite(timestamp)) &&
    (value.sourceOrigin === undefined || isString(value.sourceOrigin)) &&
    (value.destinationHost === undefined || isString(value.destinationHost)) &&
    (value.evidenceStrength === 'direct-observation' || value.evidenceStrength === 'temporal-association' || value.evidenceStrength === 'repeated-pattern') &&
    Array.isArray(value.limitations) && value.limitations.every(isString) &&
    typeof value.timestamp === 'number' && Number.isFinite(value.timestamp);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
