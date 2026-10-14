import { describe, expect, it } from 'vitest';
import { createEvent, EventValidationError, validateEvent, type NewEvent } from '../src/core/normalize';

const base: NewEvent = {
  category: 'network',
  action: 'request.sent',
  source: { origin: 'https://example.com' },
  evidence: { collector: 'test.collector', mechanism: 'extension-api', details: { bytes: 12 } },
  provenance: 'observed',
};

const deps = { now: () => 1000, newId: () => 'id-1' };

describe('createEvent', () => {
  it('adds id, timestamp and schema version', () => {
    const event = createEvent(base, deps);
    expect(event).toMatchObject({ id: 'id-1', timestamp: 1000, schemaVersion: 1 });
  });

  it('keeps optional fields only when provided', () => {
    const event = createEvent(base, deps);
    expect('destination' in event).toBe(false);
    expect('severity' in event).toBe(false);
  });

  it('rejects unknown categories and malformed actions', () => {
    expect(() => createEvent({ ...base, category: 'nope' as never }, deps)).toThrow(EventValidationError);
    expect(() => createEvent({ ...base, action: 'Request Sent' }, deps)).toThrow(EventValidationError);
  });

  it('requires related events for inferred provenance', () => {
    expect(() => createEvent({ ...base, provenance: 'inferred' }, deps)).toThrow(/relatedEventIds/);
    const ok = createEvent({ ...base, provenance: 'inferred', relatedEventIds: ['a'], confidence: 0.4 }, deps);
    expect(ok.relatedEventIds).toEqual(['a']);
  });

  it('rejects out-of-range confidence', () => {
    expect(() => createEvent({ ...base, confidence: 1.5 }, deps)).toThrow(/confidence/);
  });

  it('rejects evidence that is not JSON-safe or too large', () => {
    const bad = { ...base, evidence: { ...base.evidence, details: { fn: (() => 1) as never } } };
    expect(() => createEvent(bad, deps)).toThrow(/JSON-safe/);
    const big = { ...base, evidence: { ...base.evidence, details: { blob: 'x'.repeat(9000) } } };
    expect(() => createEvent(big, deps)).toThrow(/exceeds/);
  });
});

describe('validateEvent', () => {
  it('rejects non-objects', () => {
    expect(validateEvent(null).ok).toBe(false);
    expect(validateEvent('x').ok).toBe(false);
  });

  it('round-trips a valid event', () => {
    const event = createEvent(base, deps);
    const result = validateEvent(JSON.parse(JSON.stringify(event)));
    expect(result).toEqual({ ok: true, event });
  });
});
