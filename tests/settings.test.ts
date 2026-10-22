import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  MAX_IGNORED_ORIGINS,
  normalizeSiteOrigin,
  sanitizeIgnoredOrigins,
  saveSettings,
  SETTINGS_KEY,
} from '../src/config/settings';

function installFakeStorage(initial: Record<string, unknown> = {}): Record<string, unknown> {
  const store: Record<string, unknown> = { ...initial };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        async get(key: string) { return key in store ? { [key]: store[key] } : {}; },
        async set(payload: Record<string, unknown>) { Object.assign(store, payload); },
      },
    },
  });
  return store;
}

describe('site ignore settings', () => {
  beforeEach(() => installFakeStorage());
  afterEach(() => vi.unstubAllGlobals());

  it('keeps ignored origins in the existing local settings record', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, ignoredOrigins: ['https://shop.example'] });
    expect(await loadSettings()).toMatchObject({ ignoredOrigins: ['https://shop.example'] });
  });

  it('normalizes only credential-free HTTP(S) origins without paths or fragments', () => {
    expect(normalizeSiteOrigin('https://shop.example')).toBe('https://shop.example');
    expect(normalizeSiteOrigin('https://shop.example/path')).toBeUndefined();
    expect(normalizeSiteOrigin('https://user:secret@shop.example')).toBeUndefined();
    expect(normalizeSiteOrigin('chrome://settings')).toBeUndefined();
  });

  it('sanitizes malformed, duplicate, and oversized ignored-origin lists', async () => {
    const items = Array.from({ length: MAX_IGNORED_ORIGINS + 10 }, (_, index) => `https://site-${index}.example`);
    expect(sanitizeIgnoredOrigins(['https://valid.example', 'https://valid.example', 'file://invalid', ...items]))
      .toHaveLength(MAX_IGNORED_ORIGINS);
    const store = installFakeStorage({ [SETTINGS_KEY]: { schemaVersion: 1, monitoringEnabled: true, ignoredOrigins: ['bad', 'https://valid.example'] } });
    expect((await loadSettings()).ignoredOrigins).toEqual(['https://valid.example']);
    expect(store[SETTINGS_KEY]).toBeDefined();
  });
});
