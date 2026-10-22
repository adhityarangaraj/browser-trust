export const FOLLOW_UPS_KEY = 'bt.followUps';
export const FOLLOW_UP_SCHEMA_VERSION = 1 as const;
export const MAX_FOLLOW_UPS = 500;
export const MAX_FOLLOW_UP_BYTES = 2 * 1024 * 1024;

export const FOLLOW_UP_CATEGORIES = ['subscription', 'trial', 'task', 'renewal', 'other'] as const;
export type FollowUpCategory = (typeof FOLLOW_UP_CATEGORIES)[number];
export type FollowUpPriority = 'low' | 'medium' | 'high';
export type FollowUpStatus = 'pending' | 'completed';
export type DueGroup = 'overdue' | 'due-soon' | 'upcoming' | 'no-date' | 'completed';
export type FollowUpSort = 'due-date' | 'updated' | 'priority' | 'title';

export interface FollowUpInput {
  title: string;
  description: string;
  category: FollowUpCategory;
  dueDate: string;
  websiteUrl: string;
  priority: FollowUpPriority;
}

export interface FollowUp extends Omit<FollowUpInput, 'dueDate' | 'websiteUrl'> {
  id: string;
  dueDate?: string;
  websiteUrl?: string;
  status: FollowUpStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface FollowUpLibrary {
  schemaVersion: typeof FOLLOW_UP_SCHEMA_VERSION;
  items: FollowUp[];
}

export type FollowUpFieldErrors = Partial<Record<keyof FollowUpInput, string>>;
export type FollowUpValidation = { ok: true; value: FollowUpInput } | { ok: false; errors: FollowUpFieldErrors };

export const EMPTY_FOLLOW_UP_INPUT: FollowUpInput = {
  title: '', description: '', category: 'task', dueDate: '', websiteUrl: '', priority: 'medium',
};

const validPriorities = ['low', 'medium', 'high'] as const;
const validStatuses = ['pending', 'completed'] as const;
let mutationQueue: Promise<unknown> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1900 || year > 9999) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function localDateKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addCalendarDays(dateKey: string, amount: number): string {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day + amount);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function normalizeFollowUpUrl(value: string): string | undefined {
  if (value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return undefined;
    url.search = '';
    url.hash = '';
    return url.href.length <= 2048 ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function validateFollowUpInput(value: unknown): FollowUpValidation {
  if (!isRecord(value)) return { ok: false, errors: { title: 'Enter a title.' } };
  const errors: FollowUpFieldErrors = {};
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  const category = value.category;
  const dueDate = typeof value.dueDate === 'string' ? value.dueDate.trim() : '';
  const websiteUrl = typeof value.websiteUrl === 'string' ? value.websiteUrl.trim() : '';
  const priority = value.priority;

  if (!title) errors.title = 'Enter a title.';
  else if (title.length > 120) errors.title = 'Use 120 characters or fewer.';
  if (value.description !== undefined && typeof value.description !== 'string') errors.description = 'Details must be text.';
  if (description.length > 2000) errors.description = 'Use 2,000 characters or fewer.';
  if (!FOLLOW_UP_CATEGORIES.includes(category as FollowUpCategory)) errors.category = 'Choose a category.';
  if (!validPriorities.includes(priority as FollowUpPriority)) errors.priority = 'Choose a priority.';
  if (value.dueDate !== undefined && typeof value.dueDate !== 'string') errors.dueDate = 'Enter a valid calendar date.';
  if (dueDate && !isValidDateKey(dueDate)) errors.dueDate = 'Enter a valid calendar date.';
  let normalizedUrl: string | undefined;
  if (value.websiteUrl !== undefined && typeof value.websiteUrl !== 'string') errors.websiteUrl = 'Enter a valid website URL.';
  if (websiteUrl) {
    normalizedUrl = normalizeFollowUpUrl(websiteUrl);
    if (!normalizedUrl) errors.websiteUrl = 'Use a valid HTTP or HTTPS URL without embedded credentials.';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      description,
      category: category as FollowUpCategory,
      dueDate,
      websiteUrl: normalizedUrl ?? '',
      priority: priority as FollowUpPriority,
    },
  };
}

function sanitizeFollowUp(value: unknown): FollowUp | undefined {
  if (!isRecord(value)) return undefined;
  const id = typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 100 ? value.id : undefined;
  const validated = validateFollowUpInput({
    title: value.title,
    description: value.description ?? '',
    category: value.category,
    dueDate: value.dueDate ?? '',
    websiteUrl: value.websiteUrl ?? '',
    priority: value.priority,
  });
  const createdAt = value.createdAt;
  const updatedAt = value.updatedAt;
  const status = value.status;
  if (!id || !validated.ok || typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt < 0 ||
    typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < createdAt ||
    !validStatuses.includes(status as FollowUpStatus)) return undefined;
  const completedAt = status === 'completed'
    ? (typeof value.completedAt === 'number' && Number.isFinite(value.completedAt) && value.completedAt >= createdAt && value.completedAt <= updatedAt ? value.completedAt : updatedAt)
    : undefined;
  const { dueDate, websiteUrl, ...fields } = validated.value;
  return {
    id,
    ...fields,
    ...(dueDate ? { dueDate } : {}),
    ...(websiteUrl ? { websiteUrl } : {}),
    status: status as FollowUpStatus,
    createdAt,
    updatedAt,
    ...(completedAt !== undefined ? { completedAt } : {}),
  };
}

export function sanitizeFollowUpLibrary(value: unknown): FollowUpLibrary {
  if (!isRecord(value) || !Array.isArray(value.items)) return { schemaVersion: FOLLOW_UP_SCHEMA_VERSION, items: [] };
  const rawItems: unknown[] = value.items;
  const ids = new Set<string>();
  const items: FollowUp[] = [];
  for (const raw of rawItems) {
    if (items.length >= MAX_FOLLOW_UPS) break;
    const item = sanitizeFollowUp(raw);
    if (!item || ids.has(item.id)) continue;
    if (new TextEncoder().encode(JSON.stringify({ schemaVersion: FOLLOW_UP_SCHEMA_VERSION, items: [...items, item] })).byteLength > MAX_FOLLOW_UP_BYTES) continue;
    ids.add(item.id);
    items.push(item);
  }
  return { schemaVersion: FOLLOW_UP_SCHEMA_VERSION, items };
}

export function dueGroupFor(item: Pick<FollowUp, 'status' | 'dueDate'>, today = localDateKey()): DueGroup {
  if (item.status === 'completed') return 'completed';
  if (!item.dueDate) return 'no-date';
  if (item.dueDate < today) return 'overdue';
  if (item.dueDate <= addCalendarDays(today, 7)) return 'due-soon';
  return 'upcoming';
}

export function followUpSummary(items: readonly FollowUp[], today = localDateKey()) {
  const active = items.filter((item) => item.status === 'pending');
  return {
    active: active.length,
    overdue: active.filter((item) => dueGroupFor(item, today) === 'overdue').length,
    dueSoon: active.filter((item) => dueGroupFor(item, today) === 'due-soon').length,
    completed: items.filter((item) => item.status === 'completed').length,
  };
}

export function sortFollowUps(items: readonly FollowUp[], sort: FollowUpSort): FollowUp[] {
  const priorityOrder: Record<FollowUpPriority, number> = { high: 0, medium: 1, low: 2 };
  return [...items].sort((a, b) => {
    if (sort === 'updated') return b.updatedAt - a.updatedAt;
    if (sort === 'priority') return priorityOrder[a.priority] - priorityOrder[b.priority] || a.title.localeCompare(b.title);
    if (sort === 'title') return a.title.localeCompare(b.title);
    return (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || b.updatedAt - a.updatedAt;
  });
}

export function filterFollowUps(items: readonly FollowUp[], options: {
  query?: string; status?: FollowUpStatus | 'all'; category?: FollowUpCategory | 'all';
  priority?: FollowUpPriority | 'all'; dueGroup?: DueGroup | 'all'; today?: string;
}): FollowUp[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? '';
  return items.filter((item) => {
    if (options.status && options.status !== 'all' && item.status !== options.status) return false;
    if (options.category && options.category !== 'all' && item.category !== options.category) return false;
    if (options.priority && options.priority !== 'all' && item.priority !== options.priority) return false;
    if (options.dueGroup && options.dueGroup !== 'all' && dueGroupFor(item, options.today) !== options.dueGroup) return false;
    if (query && !`${item.title}\n${item.description}`.toLocaleLowerCase().includes(query)) return false;
    return true;
  });
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(task, task);
  mutationQueue = run.catch(() => undefined);
  return run;
}

function assertTimestamp(now: number): void {
  if (!Number.isFinite(now) || now < 0) throw new Error('A valid timestamp is required.');
}

async function readItems(): Promise<FollowUp[]> {
  const stored = await chrome.storage.local.get(FOLLOW_UPS_KEY);
  const data = sanitizeFollowUpLibrary(stored[FOLLOW_UPS_KEY]);
  if (stored[FOLLOW_UPS_KEY] !== undefined && JSON.stringify(stored[FOLLOW_UPS_KEY]) !== JSON.stringify(data)) {
    await chrome.storage.local.set({ [FOLLOW_UPS_KEY]: data });
  }
  return data.items;
}

async function writeItems(items: FollowUp[]): Promise<FollowUp[]> {
  if (items.length > MAX_FOLLOW_UPS) throw new Error(`The tracker is limited to ${MAX_FOLLOW_UPS} items.`);
  const data: FollowUpLibrary = { schemaVersion: FOLLOW_UP_SCHEMA_VERSION, items };
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_FOLLOW_UP_BYTES) {
    throw new Error('The tracker storage limit has been reached. Remove some items before saving.');
  }
  await chrome.storage.local.set({ [FOLLOW_UPS_KEY]: data });
  return items;
}

export function listFollowUps(): Promise<FollowUp[]> {
  return enqueue(readItems);
}

export function createFollowUp(input: unknown, now = Date.now()): Promise<FollowUp[]> {
  return enqueue(async () => {
    assertTimestamp(now);
    const validated = validateFollowUpInput(input);
    if (!validated.ok) throw new Error('The follow-up details are invalid.');
    const items = await readItems();
    if (items.length >= MAX_FOLLOW_UPS) throw new Error(`The tracker is limited to ${MAX_FOLLOW_UPS} items.`);
    const { dueDate, websiteUrl, ...fields } = validated.value;
    const item: FollowUp = {
      id: crypto.randomUUID(), ...fields,
      ...(dueDate ? { dueDate } : {}),
      ...(websiteUrl ? { websiteUrl } : {}),
      status: 'pending', createdAt: now, updatedAt: now,
    };
    return writeItems([...items, item]);
  });
}

export function updateFollowUp(id: string, input: unknown, now = Date.now()): Promise<FollowUp[]> {
  return enqueue(async () => {
    assertTimestamp(now);
    const validated = validateFollowUpInput(input);
    if (!validated.ok) throw new Error('The follow-up details are invalid.');
    const items = await readItems();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('This follow-up no longer exists. Refresh the tracker and try again.');
    const old = items[index]!;
    const { dueDate: _oldDueDate, websiteUrl: _oldWebsiteUrl, ...oldFields } = old;
    const { dueDate, websiteUrl, ...fields } = validated.value;
    const updated: FollowUp = {
      ...oldFields, ...fields,
      ...(dueDate ? { dueDate } : {}),
      ...(websiteUrl ? { websiteUrl } : {}),
      updatedAt: Math.max(now, old.updatedAt),
    };
    const next = [...items];
    next[index] = updated;
    return writeItems(next);
  });
}

export function setFollowUpStatus(id: string, status: FollowUpStatus, now = Date.now()): Promise<FollowUp[]> {
  return enqueue(async () => {
    assertTimestamp(now);
    if (!validStatuses.includes(status)) throw new Error('The follow-up status is invalid.');
    const items = await readItems();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('This follow-up no longer exists. Refresh the tracker and try again.');
    const item = items[index]!;
    const timestamp = Math.max(now, item.updatedAt);
    const { completedAt: _completedAt, ...withoutCompletedAt } = item;
    const updated: FollowUp = status === 'completed'
      ? { ...item, status, updatedAt: timestamp, completedAt: timestamp }
      : { ...withoutCompletedAt, status, updatedAt: timestamp };
    const next = [...items];
    next[index] = updated;
    return writeItems(next);
  });
}

export function deleteFollowUp(id: string): Promise<FollowUp[]> {
  return enqueue(async () => {
    const items = await readItems();
    if (!items.some((item) => item.id === id)) return items;
    return writeItems(items.filter((item) => item.id !== id));
  });
}
