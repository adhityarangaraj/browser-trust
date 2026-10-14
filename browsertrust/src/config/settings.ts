export interface Settings {
  schemaVersion: 1;
  /** Master switch. When off, no collectors run and no content scripts are registered. */
  monitoringEnabled: boolean;
}

export const SETTINGS_KEY = 'bt.settings';

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  monitoringEnabled: true,
};

export async function loadSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] as Partial<Settings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...(typeof stored?.monitoringEnabled === 'boolean'
      ? { monitoringEnabled: stored.monitoringEnabled }
      : {}),
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}
