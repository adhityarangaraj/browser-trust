/**
 * User-local preferences: theme, pinned findings, dismissed findings.
 *
 * These are stored separately from `Settings` so growth (an unbounded set of
 * finding IDs the user has interacted with) does not bloat the hot settings
 * read path or require schema migrations alongside permission-sensitive data.
 *
 * All reads come from `chrome.storage.local` and merge against defaults so a
 * missing or malformed stored value does not break the popup.
 */

export type Theme = 'dark' | 'light';

export interface Preferences {
  schemaVersion: 1;
  theme: Theme;
  /** Deterministic finding IDs the user chose to surface first. */
  pinnedFindingIds: string[];
  /** Deterministic finding IDs the user chose to hide. */
  dismissedFindingIds: string[];
}

export const PREFERENCES_KEY = 'bt.preferences';
/** Keep the lists bounded so a long-running profile cannot blow out storage. */
export const MAX_PINNED = 200;
export const MAX_DISMISSED = 500;

export const DEFAULT_PREFERENCES: Preferences = {
  schemaVersion: 1,
  theme: 'dark',
  pinnedFindingIds: [],
  dismissedFindingIds: [],
};

function sanitizeStringList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  // Preserve insertion order (so pin order is stable) but de-duplicate.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of strings) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
    if (out.length >= cap) break;
  }
  return out;
}

export async function loadPreferences(): Promise<Preferences> {
  const result = await chrome.storage.local.get(PREFERENCES_KEY);
  const stored = result[PREFERENCES_KEY] as Partial<Preferences> | undefined;
  const theme: Theme = stored?.theme === 'light' ? 'light' : 'dark';
  return {
    ...DEFAULT_PREFERENCES,
    theme,
    pinnedFindingIds: sanitizeStringList(stored?.pinnedFindingIds, MAX_PINNED),
    dismissedFindingIds: sanitizeStringList(stored?.dismissedFindingIds, MAX_DISMISSED),
  };
}

export async function savePreferences(preferences: Preferences): Promise<void> {
  const sanitized: Preferences = {
    schemaVersion: 1,
    theme: preferences.theme === 'light' ? 'light' : 'dark',
    pinnedFindingIds: sanitizeStringList(preferences.pinnedFindingIds, MAX_PINNED),
    dismissedFindingIds: sanitizeStringList(preferences.dismissedFindingIds, MAX_DISMISSED),
  };
  await chrome.storage.local.set({ [PREFERENCES_KEY]: sanitized });
}

export async function clearFindingPreferences(): Promise<void> {
  const current = await loadPreferences();
  await savePreferences({ ...current, pinnedFindingIds: [], dismissedFindingIds: [] });
}
