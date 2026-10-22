import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDownWideNarrow, Check, Copy, Download, ExternalLink, FolderOpen, Globe2,
  Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, Upload, X,
} from 'lucide-react';
import './context-keeper.css';
import { queryEligibleTabGroups, restoreWorkspaceTabs, snapshotGroups, type TabWindowGroup } from './context-tabs';
import {
  CONTEXT_EXPORT_SCHEMA, MAX_GROUPS_PER_WORKSPACE, MAX_IMPORT_BYTES, MAX_TABS_PER_WORKSPACE,
  MAX_TOTAL_SAVED_TABS, MAX_WORKSPACES, createWorkspaceId, parseWorkspaceImport,
  mutateWorkspaceLibrary, readWorkspaceLibrary, normalizeWorkspaceUrl,
  type SavedTab, type SavedWindowGroup, type SavedWorkspace, type WorkspaceImportDraft,
} from './context-workspaces';

type SaveMode = 'current' | 'selected' | 'all';
type WorkspaceSort = 'updated' | 'created' | 'name' | 'tabs';
type DuplicatePolicy = 'keep' | 'skip' | 'review';
type RestoreTarget = 'current' | 'new';

const saveModeLabels: Record<SaveMode, string> = {
  current: 'Save current window',
  selected: 'Save selected tabs',
  all: 'Save all windows',
};

export function ContextKeeper() {
  const [library, setLibrary] = useState<SavedWorkspace[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState('');
  const [tabsPermission, setTabsPermission] = useState(false);
  const [tabGroups, setTabGroups] = useState<TabWindowGroup[]>([]);
  const [currentWindowId, setCurrentWindowId] = useState<number>();
  const [openUrls, setOpenUrls] = useState<Set<string>>(new Set());
  const [tabInventoryAvailable, setTabInventoryAvailable] = useState(false);
  const [tabLoading, setTabLoading] = useState(true);
  const [tabError, setTabError] = useState('');
  const [excludedCount, setExcludedCount] = useState(0);
  const [selectedTabIds, setSelectedTabIds] = useState<Set<number>>(new Set());
  const [tabSearch, setTabSearch] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  const [sort, setSort] = useState<WorkspaceSort>('updated');
  const [saveMode, setSaveMode] = useState<SaveMode>();
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceDescription, setWorkspaceDescription] = useState('');
  const [editingId, setEditingId] = useState<string>();
  const [previewId, setPreviewId] = useState<string>();
  const [previewTabIds, setPreviewTabIds] = useState<Set<string>>(new Set());
  const [duplicatePolicy, setDuplicatePolicy] = useState<DuplicatePolicy>('review');
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget>('current');
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [importDraft, setImportDraft] = useState<WorkspaceImportDraft>();
  const [importError, setImportError] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refreshLibrary = async () => {
    setLibraryLoading(true);
    setLibraryError('');
    try {
      const result = await readWorkspaceLibrary();
      setLibrary(result.workspaces);
    } catch {
      setLibraryError('Saved workspaces could not be read from local extension storage.');
    } finally {
      setLibraryLoading(false);
    }
  };

  const refreshTabs = async () => {
    setTabLoading(true);
    setTabError('');
    try {
      const granted = await chrome.permissions.contains({ permissions: ['tabs'] });
      setTabsPermission(granted);
      if (!granted) {
        const currentWindow = await chrome.windows.getCurrent();
        setCurrentWindowId(currentWindow.id);
        setTabInventoryAvailable(false);
        setDuplicatePolicy('keep');
        setTabGroups([]);
        setOpenUrls(new Set());
        setSelectedTabIds(new Set());
        setExcludedCount(0);
        return;
      }
      const result = await queryEligibleTabGroups();
      setTabInventoryAvailable(true);
      setTabGroups(result.groups);
      setCurrentWindowId(result.currentWindowId);
      setExcludedCount(result.excludedCount);
      const ids = new Set(result.groups.flatMap(({ tabs }) => tabs.map(({ id }) => id)));
      setSelectedTabIds((current) => new Set([...current].filter((id) => ids.has(id))));
      setOpenUrls(new Set(result.groups.flatMap(({ tabs }) => tabs.flatMap(({ url }) => {
        const normalized = normalizeWorkspaceUrl(url);
        return normalized ? [normalized] : [];
      }))));
    } catch {
      setTabInventoryAvailable(false);
      setDuplicatePolicy('keep');
      setTabGroups([]);
      setOpenUrls(new Set());
      setSelectedTabIds(new Set());
      setTabError('Chrome could not read open tab details. Check the optional Tabs permission and refresh.');
    } finally {
      setTabLoading(false);
    }
  };

  useEffect(() => { void refreshLibrary(); void refreshTabs(); }, []);

  const allTabs = useMemo(() => tabGroups.flatMap(({ tabs }) => tabs), [tabGroups]);
  const normalizedTabQuery = tabSearch.trim().toLocaleLowerCase();
  const filteredTabs = useMemo(() => allTabs.filter((tab) =>
    !normalizedTabQuery || tab.title.toLocaleLowerCase().includes(normalizedTabQuery) || hostname(tab.url).includes(normalizedTabQuery),
  ), [allTabs, normalizedTabQuery]);
  const filteredTabIds = useMemo(() => new Set(filteredTabs.map(({ id }) => id)), [filteredTabs]);
  const allFilteredSelected = filteredTabs.length > 0 && filteredTabs.every(({ id }) => selectedTabIds.has(id));
  const selectedTabCount = selectedTabIds.size;
  const visibleWorkspaces = useMemo(() => {
    const query = librarySearch.trim().toLocaleLowerCase();
    const matches = library.filter((workspace) =>
      !query || workspace.name.toLocaleLowerCase().includes(query) || (workspace.description ?? '').toLocaleLowerCase().includes(query) ||
      workspace.groups.some(({ tabs }) => tabs.some((tab) => hostname(tab.url).includes(query))),
    );
    matches.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name)
      : sort === 'created' ? b.createdAt - a.createdAt
        : sort === 'tabs' ? tabCount(b) - tabCount(a) || b.updatedAt - a.updatedAt
          : b.updatedAt - a.updatedAt);
    return matches;
  }, [library, librarySearch, sort]);
  const preview = library.find(({ id }) => id === previewId);
  const importPlan = useMemo(() => {
    if (!importDraft) return undefined;
    let totalTabs = library.reduce((count, workspace) => count + tabCount(workspace), 0);
    const workspaces: SavedWorkspace[] = [];
    let skippedForLimits = 0;
    for (const workspace of importDraft.workspaces) {
      const count = tabCount(workspace);
      if (library.length + workspaces.length >= MAX_WORKSPACES || totalTabs + count > MAX_TOTAL_SAVED_TABS) {
        skippedForLimits += 1;
        continue;
      }
      workspaces.push(workspace);
      totalTabs += count;
    }
    return { workspaces, skippedForLimits };
  }, [importDraft, library]);
  const selectedPreviewTabs = preview?.groups.flatMap(({ tabs }) => tabs).filter(({ id }) => previewTabIds.has(id)) ?? [];
  const duplicateCount = selectedPreviewTabs.filter(({ url }) => {
    const normalized = normalizeWorkspaceUrl(url);
    return normalized !== undefined && openUrls.has(normalized);
  }).length;

  const requestTabsPermission = async () => {
    setError('');
    try {
      const granted = await chrome.permissions.request({ permissions: ['tabs'] });
      if (!granted) {
        setError('Chrome did not grant Tabs access. You can enable it for BrowserTrust from extension settings.');
        return;
      }
      await refreshTabs();
    } catch {
      setError('Chrome could not request Tabs access. Open the extension settings to grant it, then refresh.');
    }
  };

  const openExtensionSettings = () => {
    void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  };

  const toggleFilteredTabs = () => setSelectedTabIds((current) => {
    const next = new Set(current);
    if (allFilteredSelected) filteredTabs.forEach(({ id }) => next.delete(id));
    else filteredTabs.forEach(({ id }) => next.add(id));
    return next;
  });

  const beginSave = (mode: SaveMode) => {
    setMessage('');
    setError('');
    const candidateGroups = mode === 'current'
      ? tabGroups.filter(({ isCurrent }) => isCurrent)
      : tabGroups;
    const groups = snapshotGroups(candidateGroups, mode === 'selected' ? selectedTabIds : undefined);
    const count = groups.reduce((sum, group) => sum + group.tabs.length, 0);
    if (count === 0) {
      setError(mode === 'selected'
        ? 'Select at least one eligible tab before saving.'
        : mode === 'current' ? 'There are no eligible web tabs in the current window.' : 'There are no eligible web tabs to save.');
      return;
    }
    if (count > MAX_TABS_PER_WORKSPACE || groups.length > MAX_GROUPS_PER_WORKSPACE) {
      setError(`A workspace can contain up to ${MAX_TABS_PER_WORKSPACE} tabs across ${MAX_GROUPS_PER_WORKSPACE} windows. Narrow your selection and try again.`);
      return;
    }
    setSaveMode(mode);
    setEditingId(undefined);
    setWorkspaceName('');
    setWorkspaceDescription('');
  };

  const commitWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = workspaceName.trim();
    if (!name) {
      setError('Enter a workspace name before saving.');
      return;
    }
    setError('');
    setMessage('');
    try {
      if (editingId) {
        const result = await mutateWorkspaceLibrary((stored) => stored.map((workspace) => workspace.id === editingId ? {
          ...workspace,
          name: name.slice(0, 100),
          ...(workspaceDescription.trim() ? { description: workspaceDescription.trim().slice(0, 500) } : { description: undefined }),
          updatedAt: Date.now(),
        } : workspace));
        setLibrary(result.workspaces);
        setMessage(`Updated “${name}”.`);
      } else if (saveMode) {
        const sourceGroups = saveMode === 'current' ? tabGroups.filter(({ isCurrent }) => isCurrent) : tabGroups;
        const groups = snapshotGroups(sourceGroups, saveMode === 'selected' ? selectedTabIds : undefined);
        const now = Date.now();
        const workspace: SavedWorkspace = {
          id: createWorkspaceId(),
          name: name.slice(0, 100),
          ...(workspaceDescription.trim() ? { description: workspaceDescription.trim().slice(0, 500) } : {}),
          createdAt: now,
          updatedAt: now,
          groups,
        };
        const result = await mutateWorkspaceLibrary((stored) => [workspace, ...stored]);
        setLibrary(result.workspaces);
        setMessage(`Saved “${name}” with ${tabCount(workspace)} tabs.`);
      }
      setWorkspaceName('');
      setWorkspaceDescription('');
      setEditingId(undefined);
      setSaveMode(undefined);
    } catch {
      setError('BrowserTrust could not save the workspace. Check available extension storage and try again.');
    }
  };

  const editWorkspace = (workspace: SavedWorkspace) => {
    setEditingId(workspace.id);
    setSaveMode(undefined);
    setWorkspaceName(workspace.name);
    setWorkspaceDescription(workspace.description ?? '');
    setError('');
  };

  const duplicateWorkspace = async (workspace: SavedWorkspace) => {
    try {
      const now = Date.now();
      const copy: SavedWorkspace = {
        ...workspace,
        id: createWorkspaceId(),
        name: `${workspace.name} copy`.slice(0, 100),
        createdAt: now,
        updatedAt: now,
        groups: workspace.groups.map((group) => ({
          ...group,
          id: createWorkspaceId(),
          tabs: group.tabs.map((tab) => ({ ...tab, id: createWorkspaceId() })),
        })),
      };
      const result = await mutateWorkspaceLibrary((stored) => [copy, ...stored]);
      setLibrary(result.workspaces);
      setMessage(`Duplicated “${workspace.name}”.`);
      setError('');
    } catch {
      setError('Could not duplicate this workspace within the local storage limits.');
    }
  };

  const deleteWorkspace = async (workspace: SavedWorkspace) => {
    if (!window.confirm(`Delete “${workspace.name}” from this device?`)) return;
    try {
      const result = await mutateWorkspaceLibrary((stored) => stored.filter(({ id }) => id !== workspace.id));
      setLibrary(result.workspaces);
      if (previewId === workspace.id) setPreviewId(undefined);
      setMessage(`Deleted “${workspace.name}”.`);
      setError('');
    } catch {
      setError('Could not delete this workspace from local storage.');
    }
  };

  const clearLibrary = async () => {
    if (!window.confirm(`Delete all ${library.length} saved workspaces from this device? This cannot be undone.`)) return;
    try {
      await mutateWorkspaceLibrary(() => []);
      setLibrary([]);
      setPreviewId(undefined);
      setMessage('Cleared the Context Keeper library.');
      setError('');
    } catch {
      setError('Could not clear the Context Keeper library.');
    }
  };

  const openPreview = (workspace: SavedWorkspace) => {
    setPreviewId(workspace.id);
    setPreviewTabIds(new Set(workspace.groups.flatMap(({ tabs }) => tabs.map(({ id }) => id))));
    setDuplicatePolicy(tabsPermission && tabInventoryAvailable ? 'review' : 'keep');
    setRestoreTarget('current');
    setMessage('');
  };

  const togglePreviewTab = (id: string) => setPreviewTabIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const restoreSelected = async () => {
    if (!preview || selectedPreviewTabs.length === 0) return;
    const selectedIds = new Set(selectedPreviewTabs.map(({ id }) => id));
    let groups: SavedWindowGroup[] = preview.groups.flatMap((group) => {
      const tabs = group.tabs.filter(({ id }) => selectedIds.has(id));
      return tabs.length ? [{ ...group, tabs }] : [];
    });
    if (duplicatePolicy === 'skip') {
      groups = groups.flatMap((group) => {
        const tabs = group.tabs.filter((tab) => {
          const normalized = normalizeWorkspaceUrl(tab.url);
          return normalized === undefined || !openUrls.has(normalized);
        });
        return tabs.length ? [{ ...group, tabs }] : [];
      });
    }
    const restoreCount = groups.reduce((count, group) => count + group.tabs.length, 0);
    if (restoreCount === 0) {
      setMessage('All selected tabs are already open. Change the duplicate policy or select other tabs.');
      return;
    }
    const duplicateNotice = duplicatePolicy === 'skip' ? '' : duplicateCount > 0 ? ` This includes ${duplicateCount} URL${duplicateCount === 1 ? '' : 's'} already open.` : '';
    const targetLabel = restoreTarget === 'new' ? 'new window group(s)' : 'the current window';
    if (!window.confirm(`Open ${restoreCount} selected tab${restoreCount === 1 ? '' : 's'} in ${targetLabel}?${duplicateNotice}`)) return;
    setRestoreBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await restoreWorkspaceTabs(groups, currentWindowId, restoreTarget);
      const suffix = result.failed.length ? ` ${result.failed.length} failed: ${result.failed.slice(0, 3).map(({ title, reason }) => `${title}: ${reason}`).join(' · ')}` : '';
      setMessage(`Opened ${result.succeeded} of ${restoreCount} selected tabs.${suffix}`);
      await refreshTabs();
    } catch {
      setError('Chrome could not complete the restore request. Some tabs may already have opened; refresh the tab list to confirm.');
    } finally {
      setRestoreBusy(false);
    }
  };

  const exportWorkspaces = (workspaces: SavedWorkspace[], name: string) => {
    const payload = { schemaVersion: CONTEXT_EXPORT_SCHEMA, exportedAt: new Date().toISOString(), workspaces };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `browsertrust-${safeFilename(name)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const stageImport = async (file?: File) => {
    setImportError('');
    setImportDraft(undefined);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError(`Choose a JSON file smaller than ${(MAX_IMPORT_BYTES / 1024 / 1024).toFixed(0)} MB.`);
      return;
    }
    try {
      const candidate: unknown = JSON.parse(await file.text());
      setImportDraft(parseWorkspaceImport(candidate));
    } catch (caught) {
      setImportError(caught instanceof Error ? caught.message : 'This file could not be read as a BrowserTrust workspace export.');
    }
  };

  const commitImport = async () => {
    if (!importDraft || !importPlan) return;
    const seenIds = new Set(library.map(({ id }) => id));
    const additions: SavedWorkspace[] = [];
    for (const workspace of importPlan.workspaces) {
      let id = createWorkspaceId();
      while (seenIds.has(id)) id = createWorkspaceId();
      seenIds.add(id);
      const now = Date.now();
      additions.push({
        ...workspace,
        id,
        createdAt: now,
        updatedAt: now,
        groups: workspace.groups.map((group) => ({
          ...group,
          id: createWorkspaceId(),
          tabs: group.tabs.map((tab) => ({ ...tab, id: createWorkspaceId() })),
        })),
      });
    }
    if (!additions.length) {
      setImportError('No imported workspaces fit the remaining local workspace and tab limits.');
      return;
    }
    try {
      const result = await mutateWorkspaceLibrary((stored) => [...additions, ...stored]);
      setLibrary(result.workspaces);
      setImportDraft(undefined);
      setMessage(`Imported ${additions.length} workspace${additions.length === 1 ? '' : 's'}; skipped ${importDraft.rejectedWorkspaces} invalid workspace${importDraft.rejectedWorkspaces === 1 ? '' : 's'}, ${importDraft.rejectedTabs} invalid tab${importDraft.rejectedTabs === 1 ? '' : 's'}, and ${importPlan.skippedForLimits} due to library limits.`);
      setImportError('');
    } catch {
      setImportError('Could not store this import within the local storage limit. Existing workspaces were not changed.');
    }
  };

  return (
    <div className="context-keeper">
      <section className="context-privacy-note">
        <span><ShieldCheck size={17} aria-hidden="true" /></span>
        <p><strong>Saved on this device</strong><small>Workspaces keep tab URLs, titles, order, and pinned state in local extension storage. Page contents and credentials are never captured or sent online.</small></p>
        <span className="sample-label">LOCAL ONLY</span>
      </section>

      {(error || libraryError || tabError) && <p className="context-message context-error" role="alert">{error || libraryError || tabError}</p>}
      {message && <p className="context-message context-success" role="status"><Check size={14} /> {message}</p>}

      <section className="content-panel context-current-panel">
        <div className="panel-header context-panel-header">
          <div><h2>Open tabs</h2><p>Choose tabs to keep together. Search only filters the list; it does not change your selections.</p></div>
          <button className="secondary-button" onClick={() => void refreshTabs()} disabled={tabLoading}><RefreshCw size={13} /> Refresh tabs</button>
        </div>
        {!tabsPermission && <div className="context-permission-prompt"><div><strong>Allow access to open tab details</strong><p>Chrome’s optional Tabs permission lets Context Keeper read tab titles and URLs to save a workspace. BrowserTrust does not need access to page contents.</p></div><button className="primary-button" onClick={() => void requestTabsPermission()}>Allow Tabs access</button>{error && <button className="text-button" onClick={openExtensionSettings}><ExternalLink size={12} /> Open extension settings</button>}</div>}
        {tabsPermission && <>
          <div className="context-tab-toolbar">
            <label className="context-search"><Search size={14} /><span className="visually-hidden">Search open tabs</span><input value={tabSearch} onChange={(event) => setTabSearch(event.target.value)} placeholder="Search title or hostname" /></label>
            <button className="text-button" onClick={toggleFilteredTabs} disabled={filteredTabs.length === 0} aria-pressed={allFilteredSelected}>{allFilteredSelected ? 'Deselect filtered' : 'Select filtered results'}</button>
            <span className="context-selection-count">{selectedTabCount} selected</span>
          </div>
          {tabLoading ? <p className="context-empty">Reading eligible tabs…</p> : allTabs.length === 0 ? <div className="context-empty"><FolderOpen size={22} /><strong>No eligible web tabs found</strong><p>Open a regular HTTP or HTTPS site, then refresh this list. Browser pages and the dashboard are excluded.</p></div> : filteredTabs.length === 0 ? <p className="context-empty">No tabs match this search.</p> : <div className="context-tab-groups">{tabGroups.map((group) => {
            const tabs = group.tabs.filter((tab) => filteredTabIds.has(tab.id));
            if (!tabs.length) return null;
            return <section className="context-tab-group" key={group.windowId}>
              <h3>{group.label}<span>{tabs.length}</span></h3>
              {tabs.map((tab) => <label className="context-tab-row" key={tab.id}>
                <input type="checkbox" checked={selectedTabIds.has(tab.id)} onChange={() => setSelectedTabIds((current) => {
                  const next = new Set(current);
                  if (next.has(tab.id)) next.delete(tab.id); else next.add(tab.id);
                  return next;
                })} />
                <Globe2 className="context-favicon-fallback" size={16} aria-hidden="true" />
                <span className="context-tab-copy"><strong>{tab.title || 'Untitled tab'}</strong><small>{hostname(tab.url)}</small></span>
                {tab.pinned && <span className="context-pinned-label">Pinned</span>}
                {tab.active && <span className="context-active-label">Active</span>}
              </label>)}
            </section>;
          })}</div>}
          <div className="context-save-actions"><button className="secondary-button" onClick={() => beginSave('current')} disabled={tabLoading || !tabGroups.some(({ isCurrent, tabs }) => isCurrent && tabs.length)}><Plus size={13} /> Save current window</button><button className="primary-button" onClick={() => beginSave('selected')} disabled={tabLoading || selectedTabCount === 0}><Plus size={13} /> Save selected tabs</button><button className="secondary-button" onClick={() => beginSave('all')} disabled={tabLoading || allTabs.length === 0}><Plus size={13} /> Save all windows</button><span>{excludedCount ? `${excludedCount} restricted or unsupported tab${excludedCount === 1 ? '' : 's'} excluded` : 'Only HTTP and HTTPS tabs are eligible'}</span></div>
        </>}
        {(saveMode || editingId) && <form className="context-workspace-form" onSubmit={(event) => void commitWorkspace(event)}>
          <div className="context-form-title"><strong>{editingId ? 'Edit workspace details' : `Name this workspace · ${saveMode ? saveModeLabels[saveMode] : ''}`}</strong><button type="button" className="icon-button" aria-label="Close workspace form" onClick={() => { setSaveMode(undefined); setEditingId(undefined); }}><X size={14} /></button></div>
          <label>Workspace name<input required maxLength={100} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="e.g. Product research" /></label>
          <label>Description <span>Optional</span><textarea maxLength={500} rows={2} value={workspaceDescription} onChange={(event) => setWorkspaceDescription(event.target.value)} placeholder="A short note about these tabs" /></label>
          <div><button className="primary-button" type="submit">{editingId ? 'Save changes' : 'Save workspace'}</button><button className="text-button" type="button" onClick={() => { setSaveMode(undefined); setEditingId(undefined); }}>Cancel</button></div>
        </form>}
      </section>

      <section className="context-library-section">
        <div className="section-heading-row"><div><h2>Saved workspaces</h2><p>{library.length} of {MAX_WORKSPACES} stored locally</p></div><div className="context-library-tools"><label className="context-search"><Search size={14} /><span className="visually-hidden">Search saved workspaces</span><input value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="Search workspaces" /></label><label className="context-sort">Sort <select value={sort} onChange={(event) => setSort(event.target.value as WorkspaceSort)}><option value="updated">Recently updated</option><option value="created">Recently created</option><option value="name">Name</option><option value="tabs">Tab count</option></select><ArrowDownWideNarrow size={13} /></label><button className="secondary-button" onClick={() => exportWorkspaces(library, 'workspaces')} disabled={!library.length}><Download size={13} /> Export library</button><label className="secondary-button context-import-button"><Upload size={13} /> Import JSON<input type="file" accept="application/json,.json" onChange={(event) => { void stageImport(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label>{library.length > 0 && <button className="icon-button context-clear-button" aria-label="Clear all saved workspaces" title="Clear all workspaces" onClick={() => void clearLibrary()}><Trash2 size={14} /></button>}</div></div>
        {importError && <p className="context-message context-error" role="alert">{importError}</p>}
        {importDraft && importPlan && <div className="context-import-summary"><p><strong>Import preview:</strong> {importPlan.workspaces.length} workspaces and {importPlan.workspaces.reduce((sum, workspace) => sum + tabCount(workspace), 0)} tabs will be added. {importDraft.rejectedWorkspaces} invalid workspace records, {importDraft.rejectedTabs} invalid tab records, and {importPlan.skippedForLimits} workspaces exceed the remaining local limits. Imported IDs will be replaced.</p><button className="primary-button" onClick={() => void commitImport()} disabled={!importPlan.workspaces.length}>Import workspaces</button><button className="text-button" onClick={() => setImportDraft(undefined)}>Cancel</button></div>}
        {libraryLoading ? <p className="context-empty">Loading saved workspaces…</p> : library.length === 0 ? <div className="context-empty"><FolderOpen size={22} /><strong>Your saved workspaces will appear here</strong><p>Select tabs above and save them with a name to create your first workspace.</p></div> : visibleWorkspaces.length === 0 ? <p className="context-empty">No workspaces match this search.</p> : <div className="context-workspace-grid">{visibleWorkspaces.map((workspace) => <WorkspaceCard key={workspace.id} workspace={workspace} onPreview={() => openPreview(workspace)} onEdit={() => editWorkspace(workspace)} onDuplicate={() => void duplicateWorkspace(workspace)} onDelete={() => void deleteWorkspace(workspace)} onExport={() => exportWorkspaces([workspace], safeFilename(workspace.name))} />)}</div>}
      </section>

      {preview && <section className="content-panel context-preview-panel" aria-labelledby="context-preview-title">
        <div className="panel-header context-panel-header"><div><p className="eyebrow">WORKSPACE PREVIEW</p><h2 id="context-preview-title">{preview.name}</h2><p>{preview.description || `${tabCount(preview)} saved tabs across ${preview.groups.length} windows`}</p></div><button className="icon-button" aria-label="Close workspace preview" onClick={() => setPreviewId(undefined)}><X size={15} /></button></div>
        <div className="context-restore-toolbar"><span><strong>{selectedPreviewTabs.length}</strong> tabs selected</span><label>Duplicates<select value={duplicatePolicy} onChange={(event) => setDuplicatePolicy(event.target.value as DuplicatePolicy)}><option value="review" disabled={!tabInventoryAvailable}>Review in preview</option><option value="skip" disabled={!tabInventoryAvailable}>Skip already open</option><option value="keep">Restore all selected</option></select></label><label>Open in<select value={restoreTarget} onChange={(event) => setRestoreTarget(event.target.value as RestoreTarget)}><option value="current">Current window</option><option value="new">New window(s)</option></select></label><button className="primary-button" onClick={() => void restoreSelected()} disabled={restoreBusy || selectedPreviewTabs.length === 0}>{restoreBusy ? 'Opening tabs…' : `Restore ${duplicatePolicy === 'skip' ? selectedPreviewTabs.length - duplicateCount : selectedPreviewTabs.length} tabs`}</button></div>
        {!tabInventoryAvailable && <p className="context-duplicate-note">Duplicate checks are unavailable because BrowserTrust cannot currently read open tab URLs. Grant the optional Tabs access above and refresh to compare duplicates.</p>}
        {duplicatePolicy === 'review' && duplicateCount > 0 && <p className="context-duplicate-note">{duplicateCount} selected URL{duplicateCount === 1 ? ' is' : 's are'} already open. Review the marked tabs below and uncheck any you do not want to restore.</p>}
        <div className="context-preview-groups">{preview.groups.map((group, groupIndex) => <section className="context-preview-group" key={group.id}><h3>{restoreTarget === 'new' ? `Saved window ${groupIndex + 1}` : `Saved window group ${groupIndex + 1}`}<span>{group.tabs.filter(({ id }) => previewTabIds.has(id)).length} selected</span></h3>{group.tabs.map((tab) => <PreviewTab key={tab.id} tab={tab} selected={previewTabIds.has(tab.id)} duplicate={urlIsOpen(tab.url, openUrls)} onToggle={() => togglePreviewTab(tab.id)} />)}</section>)}</div>
      </section>}
    </div>
  );
}

function WorkspaceCard({ workspace, onPreview, onEdit, onDuplicate, onDelete, onExport }: {
  workspace: SavedWorkspace;
  onPreview: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const domains = [...new Set(workspace.groups.flatMap(({ tabs }) => tabs.map(({ url }) => hostname(url))))].slice(0, 5);
  return <article className="context-workspace-card">
    <button className="context-workspace-main" onClick={onPreview}>
      <span className="context-workspace-icon"><FolderOpen size={18} /></span>
      <span className="context-workspace-title"><strong>{workspace.name}</strong><small>{tabCount(workspace)} tabs · {workspace.groups.length} window{workspace.groups.length === 1 ? '' : 's'}</small>{workspace.description && <small>{workspace.description}</small>}</span>
      <span className="context-workspace-count">{tabCount(workspace)}</span>
    </button>
    <div className="context-domain-preview" aria-label="Saved site preview">{domains.map((domain) => <span key={domain} title={domain}>{domain.slice(0, 1).toUpperCase()}</span>)}<small>{domains.join(' · ')}</small></div>
    <div className="context-workspace-meta"><span>Created {formatDate(workspace.createdAt)}</span><span>Updated {formatDate(workspace.updatedAt)}</span></div>
    <div className="context-workspace-actions"><button className="text-button" onClick={onPreview}>Preview & restore</button><button aria-label={`Edit ${workspace.name}`} title="Edit" onClick={onEdit}><Pencil size={13} /></button><button aria-label={`Duplicate ${workspace.name}`} title="Duplicate" onClick={onDuplicate}><Copy size={13} /></button><button aria-label={`Export ${workspace.name}`} title="Export" onClick={onExport}><Download size={13} /></button><button aria-label={`Delete ${workspace.name}`} title="Delete" onClick={onDelete}><Trash2 size={13} /></button></div>
  </article>;
}

function PreviewTab({ tab, selected, duplicate, onToggle }: { tab: SavedTab; selected: boolean; duplicate: boolean; onToggle: () => void }) {
  const supported = normalizeWorkspaceUrl(tab.url) !== undefined;
  return <label className={`context-preview-tab${duplicate ? ' is-duplicate' : ''}${!supported ? ' is-invalid' : ''}`}>
    <input type="checkbox" checked={selected} disabled={!supported} onChange={onToggle} />
    <Globe2 size={15} className="context-favicon-fallback" aria-hidden="true" />
    <span className="context-tab-copy"><strong>{tab.title || tab.url}</strong><small>{supported ? hostname(tab.url) : 'Unsupported or invalid URL'}</small></span>
    {tab.pinned && <span className="context-pinned-label">Pinned</span>}
    {duplicate && <span className="context-duplicate-label">Already open</span>}
  </label>;
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return 'Unknown site'; }
}

function tabCount(workspace: SavedWorkspace): number {
  return workspace.groups.reduce((sum, group) => sum + group.tabs.length, 0);
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

function safeFilename(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'workspaces';
}

function urlIsOpen(url: string, openUrls: Set<string>): boolean {
  const normalized = normalizeWorkspaceUrl(url);
  return normalized !== undefined && openUrls.has(normalized);
}
