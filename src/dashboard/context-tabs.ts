import { isSavableWorkspaceUrl, type SavedTab, type SavedWindowGroup } from './context-workspaces';

export interface CurrentTabInfo {
  id: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  pinned: boolean;
  active: boolean;
}

export interface TabWindowGroup {
  windowId: number;
  label: string;
  isCurrent: boolean;
  tabs: CurrentTabInfo[];
}

export interface RestoreResult {
  succeeded: number;
  failed: { title: string; reason: string }[];
}

export async function queryEligibleTabGroups(): Promise<{ currentWindowId?: number; groups: TabWindowGroup[]; excludedCount: number }> {
  const [tabs, currentWindow] = await Promise.all([
    chrome.tabs.query({}),
    chrome.windows.getCurrent(),
  ]);
  const currentWindowId = currentWindow.id;
  let excludedCount = 0;
  const eligible: CurrentTabInfo[] = [];
  for (const tab of tabs) {
    if (tab.incognito || tab.id === undefined || tab.windowId === undefined || tab.index === undefined ||
        typeof tab.url !== 'string' || !isSavableWorkspaceUrl(tab.url)) {
      excludedCount += 1;
      continue;
    }
    eligible.push({
      id: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      url: tab.url,
      title: typeof tab.title === 'string' && tab.title.trim() ? tab.title.trim().slice(0, 500) : tab.url,
      pinned: tab.pinned === true,
      active: tab.active === true,
    });
  }
  const windowIds = [...new Set(eligible.map(({ windowId }) => windowId))];
  windowIds.sort((a, b) => a === currentWindowId ? -1 : b === currentWindowId ? 1 : a - b);
  const groups = windowIds.map((windowId, index) => ({
    windowId,
    isCurrent: windowId === currentWindowId,
    label: windowId === currentWindowId ? 'Current window' : `Other window ${index + (currentWindowId === undefined ? 1 : 0)}`,
    tabs: eligible.filter((tab) => tab.windowId === windowId).sort((a, b) => a.index - b.index),
  }));
  return { currentWindowId, groups, excludedCount };
}

export function snapshotGroups(groups: TabWindowGroup[], selectedTabIds?: Set<number>): SavedWindowGroup[] {
  return groups.flatMap((group, groupOrder) => {
    const tabs = group.tabs
      .filter(({ id }) => selectedTabIds === undefined || selectedTabIds.has(id))
      .map((tab, order): SavedTab => ({
        id: crypto.randomUUID(),
        url: tab.url,
        title: tab.title,
        order,
        pinned: tab.pinned,
      }));
    return tabs.length ? [{ id: crypto.randomUUID(), order: groupOrder, tabs }] : [];
  });
}

export async function restoreWorkspaceTabs(
  groups: SavedWindowGroup[],
  currentWindowId: number | undefined,
  target: 'current' | 'new',
): Promise<RestoreResult> {
  const orderedGroups = [...groups].sort((a, b) => a.order - b.order);
  const failed: RestoreResult['failed'] = [];
  let succeeded = 0;
  if (target === 'current') {
    const activeWindowId = (await chrome.windows.getCurrent().catch(() => undefined))?.id ?? currentWindowId;
    if (activeWindowId === undefined) {
      return { succeeded: 0, failed: orderedGroups.flatMap(({ tabs }) => tabs.map((tab) => ({ title: tab.title, reason: 'Could not identify the current browser window.' }))) };
    }
    for (const tab of orderedGroups.flatMap(({ tabs }) => [...tabs].sort((a, b) => a.order - b.order))) {
      try {
        const created = await chrome.tabs.create({ windowId: activeWindowId, url: tab.url, active: false, pinned: tab.pinned });
        if (created.id === undefined) throw new Error('Chrome did not return a tab identifier.');
        succeeded += 1;
      } catch (error) {
        failed.push({ title: tab.title, reason: errorMessage(error) });
      }
    }
    return { succeeded, failed };
  }

  for (const group of orderedGroups) {
    const orderedTabs = [...group.tabs].sort((a, b) => a.order - b.order);
    const first = orderedTabs[0];
    if (!first) continue;
    let windowId: number;
    try {
      const createdWindow = await chrome.windows.create({ url: first.url, focused: false, type: 'normal' });
      const createdWindowId = createdWindow?.id;
      if (createdWindowId === undefined) throw new Error('Chrome did not return a window identifier.');
      windowId = createdWindowId;
      succeeded += 1;
    } catch (error) {
      failed.push({ title: first.title, reason: errorMessage(error) });
      for (const tab of orderedTabs.slice(1)) {
        failed.push({ title: tab.title, reason: 'The saved window could not be created.' });
      }
      continue;
    }
    if (first.pinned) {
      try {
        const firstTabId = (await chrome.tabs.query({ windowId }))[0]?.id;
        if (firstTabId !== undefined) await chrome.tabs.update(firstTabId, { pinned: true });
      } catch {
        // Opening succeeded even if Chrome cannot restore the pinned marker.
      }
    }
    for (const tab of orderedTabs.slice(1)) {
      try {
        const created = await chrome.tabs.create({ windowId, url: tab.url, active: false, pinned: tab.pinned });
        if (created.id === undefined) throw new Error('Chrome did not return a tab identifier.');
        succeeded += 1;
      } catch (error) {
        failed.push({ title: tab.title, reason: errorMessage(error) });
      }
    }
  }
  return { succeeded, failed };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Chrome could not open this tab.';
}
