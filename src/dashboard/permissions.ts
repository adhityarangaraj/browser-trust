import { normalizeWebHost } from '../core/activity-time';

export type PermissionSettingState =
  | 'allow'
  | 'block'
  | 'ask'
  | 'session_only'
  | 'unsupported'
  | 'error'
  | 'unknown';

export interface PermissionDefinition {
  id: string;
  label: string;
  apiKey: string;
  sensitivity: 'high' | 'medium' | 'low';
  description: string;
  settingsLabel: string;
  canBlock: boolean;
  supportedFromChrome?: number;
}

export interface SitePermissionState {
  permissionId: string;
  state: PermissionSettingState;
  error?: string;
}

export interface PermissionAuditEntry {
  id: string;
  timestamp: number;
  originPattern: string;
  permissionId: string;
  previousState?: PermissionSettingState;
  newState: 'block';
  succeeded: boolean;
}

export const PERMISSION_AUDIT_KEY = 'bt.permissionAudit';
export const PERMISSION_AUDIT_MAX_ENTRIES = 100;
export const PERMISSION_AUDIT_RETENTION_DAYS = 90;

export const SITE_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  {
    id: 'camera', label: 'Camera', apiKey: 'camera', sensitivity: 'high',
    description: 'Controls whether this site may request camera access through Chrome.',
    settingsLabel: 'Camera site setting', canBlock: true,
  },
  {
    id: 'microphone', label: 'Microphone', apiKey: 'microphone', sensitivity: 'high',
    description: 'Controls whether this site may request microphone access through Chrome.',
    settingsLabel: 'Microphone site setting', canBlock: true,
  },
  {
    id: 'geolocation', label: 'Location', apiKey: 'location', sensitivity: 'high',
    description: 'Controls whether Chrome allows this site to request your location.',
    settingsLabel: 'Location site setting', canBlock: true,
  },
  {
    id: 'notifications', label: 'Notifications', apiKey: 'notifications', sensitivity: 'medium',
    description: 'Controls whether this site may show desktop notifications.',
    settingsLabel: 'Notifications site setting', canBlock: true,
  },
  {
    id: 'clipboard', label: 'Advanced clipboard', apiKey: 'clipboard', sensitivity: 'high',
    description: 'Controls advanced Async Clipboard access, including reads and writes without a user gesture.',
    settingsLabel: 'Clipboard site setting', canBlock: true, supportedFromChrome: 121,
  },
  {
    id: 'popups', label: 'Pop-ups and redirects', apiKey: 'popups', sensitivity: 'medium',
    description: 'Controls whether this site may open pop-ups.', settingsLabel: 'Pop-ups site setting', canBlock: true,
  },
  {
    id: 'javascript', label: 'JavaScript', apiKey: 'javascript', sensitivity: 'medium',
    description: 'Controls whether Chrome runs JavaScript on this site.', settingsLabel: 'JavaScript site setting', canBlock: true,
  },
  {
    id: 'images', label: 'Images', apiKey: 'images', sensitivity: 'low',
    description: 'Controls whether Chrome displays images from this site.', settingsLabel: 'Images site setting', canBlock: true,
  },
  {
    id: 'automaticDownloads', label: 'Automatic downloads', apiKey: 'automaticDownloads', sensitivity: 'medium',
    description: 'Controls whether this site may start multiple downloads automatically.',
    settingsLabel: 'Automatic downloads site setting', canBlock: true,
  },
  {
    id: 'sound', label: 'Sound', apiKey: 'sound', sensitivity: 'low',
    description: 'Controls whether this site may play sound.', settingsLabel: 'Sound site setting', canBlock: true,
    supportedFromChrome: 141,
  },
];

const VALID_STATES = new Set<PermissionSettingState>([
  'allow', 'block', 'ask', 'session_only', 'unsupported', 'error', 'unknown',
]);
const AUDIT_RETENTION_MS = PERMISSION_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Read the effective Chrome content setting for one known hostname. */
export async function readSitePermissionSettings(host: string): Promise<SitePermissionState[]> {
  const normalizedHost = normalizeWebHost(`https://${host}`);
  if (!normalizedHost || normalizedHost !== host.toLowerCase()) {
    throw new Error('A normalized hostname is required to inspect site settings.');
  }
  return Promise.all(SITE_PERMISSION_DEFINITIONS.map(async (definition) => {
    return readSitePermissionSetting(normalizedHost, definition.id);
  }));
}

export async function readSitePermissionSetting(host: string, permissionId: string): Promise<SitePermissionState> {
  const definition = SITE_PERMISSION_DEFINITIONS.find((candidate) => candidate.id === permissionId);
  const normalizedHost = normalizeWebHost(`https://${host}`);
  if (!definition || !normalizedHost || normalizedHost !== host.toLowerCase()) {
    throw new Error('A known permission and normalized hostname are required.');
  }
  const api = getContentSettingApi(definition.apiKey);
  if (!api) return { permissionId: definition.id, state: 'unsupported' };
  try {
    const value = await api.get(`https://${normalizedHost}/`);
    return { permissionId: definition.id, state: isKnownSetting(value) ? value : 'unknown' };
  } catch {
    return { permissionId: definition.id, state: 'error' };
  }
}

export function canBlockSitePermission(permissionId: string): boolean {
  const definition = SITE_PERMISSION_DEFINITIONS.find((candidate) => candidate.id === permissionId);
  return definition?.canBlock === true && getContentSettingApi(definition.apiKey)?.set !== undefined;
}

/** Set a restrictive, BrowserTrust-owned site rule. Callers must re-read and confirm afterward. */
export async function blockSitePermission(host: string, permissionId: string): Promise<void> {
  const definition = SITE_PERMISSION_DEFINITIONS.find((candidate) => candidate.id === permissionId);
  const normalizedHost = normalizeWebHost(`https://${host}`);
  if (!definition?.canBlock || !normalizedHost || normalizedHost !== host.toLowerCase()) {
    throw new Error('This site permission cannot be changed here.');
  }
  const api = getContentSettingApi(definition.apiKey);
  if (!api?.set) throw new Error('Chrome does not support changing this site setting here.');
  await api.set(`*://${normalizedHost}/*`, 'block');
}

export async function readPermissionAudit(now = Date.now()): Promise<PermissionAuditEntry[]> {
  const stored = await chrome.storage.local.get(PERMISSION_AUDIT_KEY);
  const value: unknown = stored[PERMISSION_AUDIT_KEY];
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => sanitizeAuditEntry(entry))
    .filter((entry): entry is PermissionAuditEntry =>
      entry !== undefined && entry.timestamp <= now && entry.timestamp >= now - AUDIT_RETENTION_MS,
    )
    .slice(0, PERMISSION_AUDIT_MAX_ENTRIES);
}

export async function appendPermissionAudit(
  entry: Omit<PermissionAuditEntry, 'id'>,
  now = Date.now(),
): Promise<void> {
  const entries = await readPermissionAudit(now);
  const normalizedHost = hostFromContentPattern(entry.originPattern);
  if (!normalizedHost) return;
  const next: PermissionAuditEntry = {
    ...entry,
    id: crypto.randomUUID(),
    originPattern: `*://${normalizedHost}/*`,
  };
  await chrome.storage.local.set({
    [PERMISSION_AUDIT_KEY]: [next, ...entries].slice(0, PERMISSION_AUDIT_MAX_ENTRIES),
  });
}

export async function clearPermissionAudit(): Promise<void> {
  await chrome.storage.local.remove(PERMISSION_AUDIT_KEY);
}

function getContentSettingApi(apiKey: string): {
  get: (primaryUrl: string) => Promise<string>;
  set?: (primaryPattern: string, setting: string) => Promise<void>;
} | undefined {
  const namespace: unknown = Reflect.get(chrome, 'contentSettings');
  if (!isRecord(namespace)) return undefined;
  const api: unknown = Reflect.get(namespace, apiKey);
  if (!isRecord(api)) return undefined;
  const getMethod: unknown = Reflect.get(api, 'get');
  if (typeof getMethod !== 'function') return undefined;
  const setMethod: unknown = Reflect.get(api, 'set');
  return {
    get: async (primaryUrl) => {
      const result: unknown = await Reflect.apply(getMethod, api, [{ primaryUrl }]);
      if (!isRecord(result) || typeof result.setting !== 'string') {
        throw new Error('Chrome returned an unrecognized content setting.');
      }
      return result.setting;
    },
    ...(typeof setMethod === 'function'
      ? { set: async (primaryPattern: string, setting: string) => {
          await Reflect.apply(setMethod, api, [{ primaryPattern, setting }]);
        } }
      : {}),
  };
}

function isKnownSetting(value: string): value is PermissionSettingState {
  return VALID_STATES.has(value as PermissionSettingState) && !['unsupported', 'error', 'unknown'].includes(value);
}

function sanitizeAuditEntry(value: Record<string, unknown>): PermissionAuditEntry | undefined {
  const originPattern = typeof value.originPattern === 'string' ? value.originPattern : '';
  const host = hostFromContentPattern(originPattern);
  const definition = typeof value.permissionId === 'string'
    ? SITE_PERMISSION_DEFINITIONS.find((candidate) => candidate.id === value.permissionId)
    : undefined;
  if (!host || !definition || typeof value.id !== 'string' || typeof value.timestamp !== 'number') return undefined;
  if (!Number.isFinite(value.timestamp) || typeof value.succeeded !== 'boolean' || value.newState !== 'block') return undefined;
  const previousState = typeof value.previousState === 'string' && VALID_STATES.has(value.previousState as PermissionSettingState)
    ? value.previousState as PermissionSettingState
    : undefined;
  return {
    id: value.id,
    timestamp: value.timestamp,
    originPattern: `*://${host}/*`,
    permissionId: definition.id,
    ...(previousState ? { previousState } : {}),
    newState: 'block',
    succeeded: value.succeeded,
  };
}

function hostFromContentPattern(pattern: string): string | undefined {
  const match = /^\*:\/\/([^/]+)\/\*$/.exec(pattern);
  if (!match?.[1]) return undefined;
  const host = normalizeWebHost(`https://${match[1]}`);
  return host === match[1].toLowerCase() ? host : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
