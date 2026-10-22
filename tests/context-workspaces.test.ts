import { describe, expect, it } from 'vitest';
import {
  MAX_TABS_PER_WORKSPACE,
  MAX_TOTAL_SAVED_TABS,
  MAX_WORKSPACES,
  normalizeWorkspaceUrl,
  parseWorkspaceImport,
  sanitizeWorkspaceLibrary,
} from '../src/dashboard/context-workspaces';
import { snapshotGroups, type TabWindowGroup } from '../src/dashboard/context-tabs';

function workspace(id: string, url = 'https://example.com/path?topic=one#section') {
  return {
    id,
    name: `Workspace ${id}`,
    createdAt: 100,
    updatedAt: 200,
    groups: [{
      id: `group-${id}`,
      order: 0,
      tabs: [{ id: `tab-${id}`, url, title: 'Example', order: 0, pinned: false }],
    }],
  };
}

describe('Context Keeper workspace records', () => {
  it('accepts only credential-free HTTP(S) URLs and preserves meaningful URL parts', () => {
    expect(normalizeWorkspaceUrl('https://example.com/a?x=one#part')).toBe('https://example.com/a?x=one#part');
    expect(normalizeWorkspaceUrl('http://example.com/path')).toBe('http://example.com/path');
    expect(normalizeWorkspaceUrl('chrome://settings')).toBeUndefined();
    expect(normalizeWorkspaceUrl('chrome-extension://abc/dashboard.html')).toBeUndefined();
    expect(normalizeWorkspaceUrl('file:///private/file')).toBeUndefined();
    expect(normalizeWorkspaceUrl('https://user:secret@example.com/')).toBeUndefined();
    expect(normalizeWorkspaceUrl('not a URL')).toBeUndefined();
  });

  it('sanitizes malformed records, duplicate IDs, and unsupported URLs', () => {
    const library = sanitizeWorkspaceLibrary({
      schemaVersion: -1,
      workspaces: [
        workspace('keep'),
        workspace('keep'),
        workspace('internal', 'chrome://settings'),
        { ...workspace('broken'), name: '   ' },
      ],
    });
    expect(library.workspaces).toHaveLength(1);
    expect(library.workspaces[0]?.groups[0]?.tabs[0]?.url).toContain('?topic=one#section');
  });

  it('keeps the library, workspace, and window-group counts bounded', () => {
    const tooManyTabs = Array.from({ length: MAX_TABS_PER_WORKSPACE + 5 }, (_, index) => ({
      id: `tab-${index}`, url: `https://site-${index}.example/`, title: `Site ${index}`, order: index, pinned: false,
    }));
    const raw = {
      schemaVersion: 1,
      workspaces: [
        { ...workspace('large'), groups: [{ id: 'large-group', order: 0, tabs: tooManyTabs }] },
        ...Array.from({ length: MAX_WORKSPACES + 1 }, (_, index) => workspace(`small-${index}`)),
      ],
    };
    const library = sanitizeWorkspaceLibrary(raw);
    expect(library.workspaces).toHaveLength(MAX_WORKSPACES);
    expect(library.workspaces[0]?.groups[0]?.tabs).toHaveLength(MAX_TABS_PER_WORKSPACE);
    expect(library.workspaces.reduce((total, item) => total + item.groups.reduce((sum, group) => sum + group.tabs.length, 0), 0)).toBeLessThanOrEqual(MAX_TOTAL_SAVED_TABS);
  });

  it('enforces the aggregate tab limit across otherwise valid workspaces', () => {
    const fullWorkspaces = Array.from({ length: MAX_WORKSPACES }, (_, workspaceIndex) => ({
      ...workspace(`full-${workspaceIndex}`),
      groups: [{
        id: `group-full-${workspaceIndex}`,
        order: 0,
        tabs: Array.from({ length: MAX_TABS_PER_WORKSPACE }, (_, tabIndex) => ({
          id: `tab-${workspaceIndex}-${tabIndex}`,
          url: `https://site-${workspaceIndex}-${tabIndex}.example/`,
          title: 'Saved page',
          order: tabIndex,
          pinned: false,
        })),
      }],
    }));
    const library = sanitizeWorkspaceLibrary({ workspaces: fullWorkspaces });
    expect(library.workspaces.reduce((total, item) => total + item.groups.reduce((sum, group) => sum + group.tabs.length, 0), 0)).toBeLessThanOrEqual(MAX_TOTAL_SAVED_TABS);
  });

  it('preserves selected tabs in their source window groups without persisting live tab IDs', () => {
    const groups: TabWindowGroup[] = [
      { windowId: 77, label: 'Current window', isCurrent: true, tabs: [
        { id: 10, windowId: 77, index: 0, url: 'https://a.example/', title: 'A', pinned: true, active: true },
        { id: 11, windowId: 77, index: 1, url: 'https://b.example/', title: 'B', pinned: false, active: false },
      ] },
      { windowId: 88, label: 'Other window 1', isCurrent: false, tabs: [
        { id: 20, windowId: 88, index: 0, url: 'https://c.example/', title: 'C', pinned: false, active: true },
      ] },
    ];
    const snapshot = snapshotGroups(groups, new Set([10, 20]));
    expect(snapshot).toHaveLength(2);
    expect(snapshot.map(({ tabs }) => tabs.map(({ url }) => url))).toEqual([
      ['https://a.example/'], ['https://c.example/'],
    ]);
    expect(snapshot[0]?.tabs[0]).toMatchObject({ order: 0, pinned: true });
    expect(snapshot[0]?.tabs[0]?.id).not.toBe(10);
  });

  it('validates imports and counts rejected workspace and tab records', () => {
    const valid = workspace('external');
    const invalidUrl = { ...workspace('external2'), groups: [{
      id: 'group-external2', order: 0, tabs: [{ id: 'tab-invalid', url: 'chrome://history', title: 'History', order: 0, pinned: false }],
    }] };
    const draft = parseWorkspaceImport({ schemaVersion: 1, workspaces: [valid, invalidUrl, null] });
    expect(draft.workspaces).toHaveLength(1);
    expect(draft.rejectedWorkspaces).toBe(2);
    expect(draft.rejectedTabs).toBe(1);
    expect(() => parseWorkspaceImport({ schemaVersion: 2, workspaces: [] })).toThrow(/supported/);
  });
});
