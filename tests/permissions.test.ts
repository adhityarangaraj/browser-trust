import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendPermissionAudit,
  blockSitePermission,
  PERMISSION_AUDIT_KEY,
  PERMISSION_AUDIT_MAX_ENTRIES,
  readPermissionAudit,
  readSitePermissionSetting,
  readSitePermissionSettings,
} from '../src/dashboard/permissions';

describe('dashboard site permissions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('queries supported effective settings for the HTTPS origin', async () => {
    const get = vi.fn(async () => ({ setting: 'ask' }));
    vi.stubGlobal('chrome', { contentSettings: { camera: { get } } });

    await expect(readSitePermissionSetting('example.com', 'camera')).resolves.toEqual({
      permissionId: 'camera', state: 'ask',
    });
    expect(get).toHaveBeenCalledWith({ primaryUrl: 'https://example.com/' });
  });

  it('marks APIs absent from the current Chrome runtime unsupported', async () => {
    vi.stubGlobal('chrome', { contentSettings: {} });
    const results = await readSitePermissionSettings('example.com');
    expect(results).toHaveLength(10);
    expect(results.every(({ state }) => state === 'unsupported')).toBe(true);
  });

  it('adds only a site-specific block rule for a normalized host', async () => {
    const set = vi.fn(async (_value: Record<string, unknown>) => undefined);
    vi.stubGlobal('chrome', { contentSettings: { camera: { get: vi.fn(), set } } });

    await blockSitePermission('example.com', 'camera');
    expect(set).toHaveBeenCalledWith({ primaryPattern: '*://example.com/*', setting: 'block' });
    await expect(blockSitePermission('https://example.com/path', 'camera')).rejects.toThrow();
  });

  it('retains only valid, recent BrowserTrust audit actions and caps entries', async () => {
    const now = 2_000_000_000_000;
    const set = vi.fn(async (_items: Record<string, unknown>) => undefined);
    const existing = Array.from({ length: PERMISSION_AUDIT_MAX_ENTRIES + 2 }, (_, index) => ({
      id: `entry-${index}`,
      timestamp: now - index,
      originPattern: '*://example.com/*',
      permissionId: 'camera',
      newState: 'block',
      succeeded: true,
    }));
    const get = vi.fn(async () => ({ [PERMISSION_AUDIT_KEY]: existing }));
    vi.stubGlobal('chrome', { storage: { local: { get, set, remove: vi.fn() } } });
    vi.stubGlobal('crypto', { randomUUID: () => 'new-entry' });

    const recent = await readPermissionAudit(now);
    expect(recent).toHaveLength(PERMISSION_AUDIT_MAX_ENTRIES);
    expect(recent[0]?.originPattern).toBe('*://example.com/*');
    await appendPermissionAudit({
      timestamp: now,
      originPattern: '*://example.org/*',
      permissionId: 'microphone',
      previousState: 'allow',
      newState: 'block',
      succeeded: true,
    }, now);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      [PERMISSION_AUDIT_KEY]: expect.arrayContaining([expect.objectContaining({
        id: 'new-entry', originPattern: '*://example.org/*',
      })]),
    }));
    const stored = set.mock.calls[0]?.[0][PERMISSION_AUDIT_KEY];
    expect(stored).toHaveLength(PERMISSION_AUDIT_MAX_ENTRIES);
  });
});
