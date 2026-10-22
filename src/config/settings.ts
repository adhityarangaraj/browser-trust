export interface Settings {
  schemaVersion: 1;
  /** Master switch. When off, no collectors run and no content scripts are registered. */
  monitoringEnabled: boolean;
  /** Origins hidden from the Trust Monitor overview attention list; collection continues. */
  ignoredOrigins: string[];
}

export const MAX_IGNORED_ORIGINS = 100;

export const SETTINGS_KEY = 'bt.settings';

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  monitoringEnabled: true,
  ignoredOrigins: [],
};

export function normalizeSiteOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 512) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return undefined;
    if (url.origin !== value || url.pathname !== '/' || url.search || url.hash) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function sanitizeIgnoredOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const origins = new Set<string>();
  const earliest = Math.max(0, value.length - MAX_IGNORED_ORIGINS * 4);
  for (let index = value.length - 1; index >= earliest && origins.size < MAX_IGNORED_ORIGINS; index -= 1) {
    const candidate: unknown = value[index];
    const origin = normalizeSiteOrigin(candidate);
    if (origin) origins.add(origin);
  }
  return [...origins].reverse();
}

export async function loadSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] as Partial<Settings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...(typeof stored?.monitoringEnabled === 'boolean'
      ? { monitoringEnabled: stored.monitoringEnabled }
      : {}),
    ignoredOrigins: sanitizeIgnoredOrigins(stored?.ignoredOrigins),
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: { ...settings, ignoredOrigins: sanitizeIgnoredOrigins(settings.ignoredOrigins) },
  });
}
