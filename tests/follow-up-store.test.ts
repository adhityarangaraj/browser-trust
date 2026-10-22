import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFollowUp,
  deleteFollowUp,
  dueGroupFor,
  filterFollowUps,
  FOLLOW_UPS_KEY,
  followUpSummary,
  isValidDateKey,
  listFollowUps,
  localDateKey,
  MAX_FOLLOW_UPS,
  normalizeFollowUpUrl,
  sanitizeFollowUpLibrary,
  setFollowUpStatus,
  sortFollowUps,
  updateFollowUp,
  validateFollowUpInput,
  type FollowUp,
  type FollowUpInput,
} from '../src/dashboard/follow-up-store';

const input: FollowUpInput = {
  title: 'Renew plan', description: 'Check the annual plan', category: 'subscription',
  dueDate: '2026-10-30', websiteUrl: 'https://billing.example/path?token=private#section', priority: 'high',
};

function item(id: string, changes: Partial<FollowUp> = {}): FollowUp {
  return {
    id, title: id, description: '', category: 'task', dueDate: '2026-10-30', status: 'pending', priority: 'medium',
    createdAt: 1, updatedAt: 1, ...changes,
  };
}

function installStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  vi.stubGlobal('chrome', { storage: { local: {
    async get(key: string) { return key in data ? { [key]: data[key] } : {}; },
    async set(next: Record<string, unknown>) { Object.assign(data, next); },
  } } });
  vi.stubGlobal('crypto', { randomUUID: () => 'follow-up-test-id' });
  return data;
}

describe('follow-up model and local store', () => {
  beforeEach(() => installStorage());
  afterEach(() => vi.unstubAllGlobals());

  it('validates dates, titles, fields, and credential-free HTTP(S) website URLs', () => {
    expect(isValidDateKey('2026-02-28')).toBe(true);
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('26-02-28')).toBe(false);
    expect(validateFollowUpInput({ ...input, title: '  ' })).toMatchObject({ ok: false, errors: { title: 'Enter a title.' } });
    expect(validateFollowUpInput({ ...input, dueDate: '2026-02-30' })).toMatchObject({ ok: false, errors: { dueDate: 'Enter a valid calendar date.' } });
    expect(validateFollowUpInput({ ...input, websiteUrl: 'javascript:alert(1)' }).ok).toBe(false);
    expect(validateFollowUpInput({ ...input, websiteUrl: 'https://user:pass@example.test' }).ok).toBe(false);
    expect(normalizeFollowUpUrl(input.websiteUrl)).toBe('https://billing.example/path');
  });

  it('derives overdue, due-soon, upcoming, no-date, and completed groups by calendar date', () => {
    const today = '2026-10-23';
    expect(dueGroupFor(item('old', { dueDate: '2026-10-22' }), today)).toBe('overdue');
    expect(dueGroupFor(item('today', { dueDate: today }), today)).toBe('due-soon');
    expect(dueGroupFor(item('week', { dueDate: '2026-10-30' }), today)).toBe('due-soon');
    expect(dueGroupFor(item('later', { dueDate: '2026-10-31' }), today)).toBe('upcoming');
    expect(dueGroupFor(item('none', { dueDate: undefined }), today)).toBe('no-date');
    expect(dueGroupFor(item('done', { status: 'completed' }), today)).toBe('completed');
  });

  it('formats the local calendar day without converting through UTC', () => {
    const localDate = new Date(2026, 9, 23, 0, 15);
    expect(localDateKey(localDate)).toBe('2026-10-23');
  });

  it('calculates summary metrics from stored records and excludes completed items from due counts', () => {
    expect(followUpSummary([
      item('late', { dueDate: '2026-10-22' }),
      item('soon', { dueDate: '2026-10-25' }),
      item('complete', { status: 'completed', dueDate: '2026-10-20', completedAt: 10 }),
    ], '2026-10-23')).toEqual({ active: 2, overdue: 1, dueSoon: 1, completed: 1 });
  });

  it('filters and sorts without mutating the stored array', () => {
    const original = [item('Z task', { priority: 'low', dueDate: undefined }), item('A subscription', { category: 'subscription', priority: 'high', dueDate: '2026-10-24' })];
    const filtered = filterFollowUps(original, { query: 'subscription', category: 'subscription' });
    expect(filtered.map(({ id }) => id)).toEqual(['A subscription']);
    expect(sortFollowUps(original, 'priority').map(({ id }) => id)).toEqual(['A subscription', 'Z task']);
    expect(original[0]?.id).toBe('Z task');
  });

  it('sanitizes malformed, duplicate, and over-limit stored records', () => {
    const raw = [item('kept'), { ...item('bad'), title: '  ' }, item('kept')];
    const sanitized = sanitizeFollowUpLibrary({ schemaVersion: 0, items: raw });
    expect(sanitized.items.map(({ id }) => id)).toEqual(['kept']);
    expect(sanitizeFollowUpLibrary({ items: Array.from({ length: MAX_FOLLOW_UPS + 1 }, (_, i) => item(`id-${i}`)) }).items)
      .toHaveLength(MAX_FOLLOW_UPS);
    expect(sanitizeFollowUpLibrary({ items: 'not-an-array' }).items).toEqual([]);
  });

  it('persists create, edit, complete, reopen, and delete operations locally', async () => {
    const storage = installStorage();
    let records = await createFollowUp(input, 100);
    expect(records[0]).toMatchObject({ id: 'follow-up-test-id', status: 'pending', createdAt: 100, updatedAt: 100 });
    expect(records[0]?.websiteUrl).toBe('https://billing.example/path');
    records = await updateFollowUp('follow-up-test-id', { ...input, title: 'Renew annual plan', dueDate: '' }, 200);
    expect(records[0]).toMatchObject({ title: 'Renew annual plan', createdAt: 100, updatedAt: 200 });
    expect(records[0]).not.toHaveProperty('dueDate');
    records = await setFollowUpStatus('follow-up-test-id', 'completed', 300);
    expect(records[0]).toMatchObject({ status: 'completed', completedAt: 300, updatedAt: 300 });
    records = await setFollowUpStatus('follow-up-test-id', 'pending', 400);
    expect(records[0]?.status).toBe('pending');
    expect(records[0]).not.toHaveProperty('completedAt');
    expect(await listFollowUps()).toHaveLength(1);
    expect((storage[FOLLOW_UPS_KEY] as { items: FollowUp[] }).items).toHaveLength(1);
    expect(await deleteFollowUp('follow-up-test-id')).toEqual([]);
  });
});
