import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearFindingPreferences,
  DEFAULT_PREFERENCES,
  loadPreferences,
  MAX_DISMISSED,
  MAX_PINNED,
  PREFERENCES_KEY,
  savePreferences,
} from '../src/config/preferences';

function installFakeStorage(initial: Record<string, unknown> = {}): Record<string, unknown> {
  const store: Record<string, unknown> = { ...initial };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        async get(key: string) {
          return key in store ? { [key]: store[key] } : {};
        },
        async set(payload: Record<string, unknown>) {
          Object.assign(store, payload);
        },
      },
    },
  });
  return store;
}

describe('preferences store', () => {
  beforeEach(() => installFakeStorage());
  afterEach(() => vi.unstubAllGlobals());

  it('returns defaults when nothing has been stored', async () => {
    expect(await loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('round-trips the user-chosen theme and pin/dismiss sets', async () => {
    await savePreferences({
      schemaVersion: 1,
      theme: 'light',
      pinnedFindingIds: ['f-1', 'f-2'],
      dismissedFindingIds: ['f-3'],
    });
    expect(await loadPreferences()).toMatchObject({
      theme: 'light', pinnedFindingIds: ['f-1', 'f-2'], dismissedFindingIds: ['f-3'],
    });
  });

  it('sanitizes malformed stored data instead of surfacing it', async () => {
    const store = installFakeStorage({
      [PREFERENCES_KEY]: {
        schemaVersion: 1,
        theme: 'retro-wave',
        pinnedFindingIds: ['f-1', '', 42, 'f-1', 'f-2'],
        dismissedFindingIds: 'not-an-array',
      },
    });
    const prefs = await loadPreferences();
    expect(prefs.theme).toBe('dark');
    expect(prefs.pinnedFindingIds).toEqual(['f-1', 'f-2']);
    expect(prefs.dismissedFindingIds).toEqual([]);
    expect(store).toBeDefined();
  });

  it('caps pin and dismiss lists to the documented maximums', async () => {
    const many = Array.from({ length: MAX_PINNED + 50 }, (_, index) => `pinned-${index}`);
    const manyDismissed = Array.from({ length: MAX_DISMISSED + 100 }, (_, index) => `dismissed-${index}`);
    await savePreferences({
      schemaVersion: 1, theme: 'dark', pinnedFindingIds: many, dismissedFindingIds: manyDismissed,
    });
    const prefs = await loadPreferences();
    expect(prefs.pinnedFindingIds).toHaveLength(MAX_PINNED);
    expect(prefs.dismissedFindingIds).toHaveLength(MAX_DISMISSED);
  });

  it('clears only the finding sets, keeping the theme', async () => {
    await savePreferences({
      schemaVersion: 1, theme: 'light',
      pinnedFindingIds: ['f-1'], dismissedFindingIds: ['f-2'],
    });
    await clearFindingPreferences();
    const prefs = await loadPreferences();
    expect(prefs.theme).toBe('light');
    expect(prefs.pinnedFindingIds).toEqual([]);
    expect(prefs.dismissedFindingIds).toEqual([]);
  });
});
