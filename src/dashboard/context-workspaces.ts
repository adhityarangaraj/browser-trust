export const CONTEXT_WORKSPACES_KEY = 'bt.contextWorkspaces';
export const CONTEXT_EXPORT_SCHEMA = 1;
export const MAX_WORKSPACES = 40;
export const MAX_TABS_PER_WORKSPACE = 120;
export const MAX_GROUPS_PER_WORKSPACE = 20;
export const MAX_TOTAL_SAVED_TABS = 2000;
export const MAX_LIBRARY_BYTES = 3 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

export interface SavedTab {
  id: string;
  url: string;
  title: string;
  order: number;
  pinned: boolean;
}

export interface SavedWindowGroup {
  id: string;
  order: number;
  tabs: SavedTab[];
}

export interface SavedWorkspace {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  groups: SavedWindowGroup[];
}

export interface WorkspaceLibrary {
  schemaVersion: typeof CONTEXT_EXPORT_SCHEMA;
  workspaces: SavedWorkspace[];
}

export interface WorkspaceImportDraft {
  workspaces: SavedWorkspace[];
  rejectedWorkspaces: number;
  rejectedTabs: number;
}

export const EMPTY_WORKSPACE_LIBRARY: WorkspaceLibrary = {
  schemaVersion: CONTEXT_EXPORT_SCHEMA,
  workspaces: [],
};

export function isSavableWorkspaceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username && !url.password && value.length <= 4096;
  } catch {
    return false;
  }
}

export function normalizeWorkspaceUrl(value: string): string | undefined {
  if (!isSavableWorkspaceUrl(value)) return undefined;
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}

export function sanitizeWorkspaceLibrary(value: unknown): WorkspaceLibrary {
  if (!isRecord(value)) return EMPTY_WORKSPACE_LIBRARY;
  const rawWorkspaces: unknown[] = Array.isArray(value.workspaces) ? value.workspaces : [];
  const workspaces: SavedWorkspace[] = [];
  const ids = new Set<string>();
  let totalTabs = 0;
  for (const raw of rawWorkspaces) {
    if (workspaces.length >= MAX_WORKSPACES || !isRecord(raw)) continue;
    const workspace = sanitizeWorkspace(raw, MAX_TABS_PER_WORKSPACE, MAX_GROUPS_PER_WORKSPACE);
    if (!workspace) continue;
    const workspaceIds = [workspace.id, ...workspace.groups.flatMap((group) => [group.id, ...group.tabs.map(({ id }) => id)])];
    if (new Set(workspaceIds).size !== workspaceIds.length || workspaceIds.some((id) => ids.has(id))) continue;
    const count = countTabs(workspace);
    if (count === 0 || totalTabs + count > MAX_TOTAL_SAVED_TABS) continue;
    const candidate = [...workspaces, workspace];
    if (serializedSize(candidate) > MAX_LIBRARY_BYTES) continue;
    workspaceIds.forEach((id) => ids.add(id));
    totalTabs += count;
    workspaces.push(workspace);
  }
  return { schemaVersion: CONTEXT_EXPORT_SCHEMA, workspaces };
}

export async function readWorkspaceLibrary(): Promise<WorkspaceLibrary> {
  const stored = await chrome.storage.local.get(CONTEXT_WORKSPACES_KEY);
  return sanitizeWorkspaceLibrary(stored[CONTEXT_WORKSPACES_KEY]);
}

export async function writeWorkspaceLibrary(workspaces: SavedWorkspace[]): Promise<WorkspaceLibrary> {
  const library = sanitizeWorkspaceLibrary({ schemaVersion: CONTEXT_EXPORT_SCHEMA, workspaces });
  if (library.workspaces.length !== workspaces.length) {
    throw new Error('The workspace library exceeds its storage limits or contains invalid records.');
  }
  if (serializedSize(library.workspaces) > MAX_LIBRARY_BYTES) {
    throw new Error('The workspace library is too large to store locally.');
  }
  await chrome.storage.local.set({ [CONTEXT_WORKSPACES_KEY]: library });
  return library;
}

let mutationQueue: Promise<void> = Promise.resolve();

/** Serialize workspace mutations and apply each one to the latest stored library. */
export function mutateWorkspaceLibrary(
  update: (workspaces: SavedWorkspace[]) => SavedWorkspace[],
): Promise<WorkspaceLibrary> {
  const operation = mutationQueue.then(async () => {
    const current = await readWorkspaceLibrary();
    return writeWorkspaceLibrary(update(current.workspaces));
  });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function parseWorkspaceImport(value: unknown): WorkspaceImportDraft {
  if (!isRecord(value) || value.schemaVersion !== CONTEXT_EXPORT_SCHEMA || !Array.isArray(value.workspaces)) {
    throw new Error('This file is not a supported BrowserTrust workspace export.');
  }
  const rawWorkspaces = value.workspaces as unknown[];
  const workspaces: SavedWorkspace[] = [];
  let rejectedWorkspaces = 0;
  let rejectedTabs = 0;
  for (const raw of rawWorkspaces.slice(0, MAX_WORKSPACES * 2)) {
    if (!isRecord(raw)) {
      rejectedWorkspaces += 1;
      continue;
    }
    const rawTabCount = countRawTabs(raw);
    const workspace = sanitizeWorkspace(raw, MAX_TABS_PER_WORKSPACE, MAX_GROUPS_PER_WORKSPACE);
    if (!workspace || countTabs(workspace) === 0) {
      rejectedWorkspaces += 1;
      rejectedTabs += rawTabCount;
      continue;
    }
    rejectedTabs += Math.max(0, rawTabCount - countTabs(workspace));
    workspaces.push(workspace);
  }
  return { workspaces: workspaces.slice(0, MAX_WORKSPACES), rejectedWorkspaces, rejectedTabs };
}

export function createWorkspaceId(): string {
  return crypto.randomUUID();
}

function sanitizeWorkspace(
  value: Record<string, unknown>,
  maxTabs: number,
  maxGroups: number,
): SavedWorkspace | undefined {
  const id = safeId(value.id);
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 100) : '';
  const createdAt = finiteTimestamp(value.createdAt);
  const updatedAt = finiteTimestamp(value.updatedAt);
  if (!id || !name || createdAt === undefined || updatedAt === undefined || !Array.isArray(value.groups)) return undefined;
  const groups: SavedWindowGroup[] = [];
  const groupIds = new Set<string>();
  const tabIds = new Set<string>();
  let remaining = maxTabs;
  const rawGroups = value.groups as unknown[];
  for (const rawGroup of rawGroups.slice(0, maxGroups)) {
    if (!isRecord(rawGroup) || !Array.isArray(rawGroup.tabs) || remaining <= 0) continue;
    const groupId = safeId(rawGroup.id);
    const order = nonNegativeInteger(rawGroup.order);
    if (!groupId || groupIds.has(groupId) || order === undefined) continue;
    groupIds.add(groupId);
    const tabs: SavedTab[] = [];
    const rawTabs = rawGroup.tabs as unknown[];
    for (const rawTab of rawTabs) {
      if (tabs.length >= remaining || !isRecord(rawTab)) continue;
      const tabId = safeId(rawTab.id);
      const url = typeof rawTab.url === 'string' ? normalizeWorkspaceUrl(rawTab.url) : undefined;
      const tabOrder = nonNegativeInteger(rawTab.order);
      if (!tabId || tabIds.has(tabId) || !url || tabOrder === undefined) continue;
      tabIds.add(tabId);
      tabs.push({
        id: tabId,
        url,
        title: typeof rawTab.title === 'string' ? rawTab.title.trim().slice(0, 500) || url : url,
        order: tabOrder,
        pinned: rawTab.pinned === true,
      });
    }
    remaining -= tabs.length;
    if (tabs.length) groups.push({ id: groupId, order, tabs: tabs.sort((a, b) => a.order - b.order) });
  }
  if (!groups.length) return undefined;
  const description = typeof value.description === 'string' ? value.description.trim().slice(0, 500) : '';
  return {
    id,
    name,
    ...(description ? { description } : {}),
    createdAt,
    updatedAt,
    groups: groups.sort((a, b) => a.order - b.order),
  };
}

function safeId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value) ? value : undefined;
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function countTabs(workspace: SavedWorkspace): number {
  return workspace.groups.reduce((sum, group) => sum + group.tabs.length, 0);
}

function countRawTabs(value: Record<string, unknown>): number {
  if (!Array.isArray(value.groups)) return 0;
  const groups = value.groups as unknown[];
  return groups.reduce<number>((count, group: unknown) =>
    count + (isRecord(group) && Array.isArray(group.tabs) ? group.tabs.length : 0), 0);
}

function serializedSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
