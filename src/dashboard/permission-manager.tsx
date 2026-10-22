import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownWideNarrow, Check, ExternalLink, History, LockKeyhole, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { querySiteHistory, type SiteVisitSummary } from './history';
import {
  appendPermissionAudit,
  blockSitePermission,
  canBlockSitePermission,
  clearPermissionAudit,
  DEVICE_PERMISSION_LIMITATIONS,
  PERMISSION_AUDIT_RETENTION_DAYS,
  readPermissionAudit,
  readSitePermissionSetting,
  readSitePermissionSettings,
  SITE_PERMISSION_DEFINITIONS,
  type PermissionAuditEntry,
  type PermissionDefinition,
  type PermissionSettingState,
  type SitePermissionState,
} from './permissions';

type PermissionFilter = 'all' | 'sensitive' | 'allow' | 'block' | 'ask' | 'unsupported';
type PermissionSort = 'sensitivity' | 'lastVisitTime' | 'host';
type ManagerSite = SiteVisitSummary & { settings: SitePermissionState[] };

const MAX_REVIEW_SITES = 100;
const SENSITIVE_IDS = new Set(['camera', 'microphone', 'geolocation', 'clipboard']);
const filters: { id: PermissionFilter; label: string }[] = [
  { id: 'all', label: 'All sites' },
  { id: 'sensitive', label: 'Sensitive access' },
  { id: 'allow', label: 'Allowed' },
  { id: 'block', label: 'Blocked' },
  { id: 'ask', label: 'Ask' },
  { id: 'unsupported', label: 'Unsupported' },
];

const extensionPermissionDescriptions: Record<string, string> = {
  storage: 'Store BrowserTrust settings, events, findings, and local audit entries.',
  scripting: 'Register BrowserTrust observers on sites you allow.',
  activeTab: 'Read the active tab after a user action in the extension.',
  webRequest: 'Observe request metadata when enabled.',
  history: 'Read local visit metadata for Sites & Activity and site discovery.',
  tabs: 'Read active tab hostnames for optional active-time estimates.',
  idle: 'Detect whether Chrome reports the user idle for optional active-time estimates.',
  alarms: 'Checkpoint optional active-time estimates once per minute.',
  contentSettings: 'Read effective per-site Chrome content settings and add site-specific restrictive rules when requested.',
};

export function PermissionManager() {
  const [historyGranted, setHistoryGranted] = useState(false);
  const [settingsGranted, setSettingsGranted] = useState(false);
  const [sites, setSites] = useState<ManagerSite[]>([]);
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState('');
  const [permissionBusy, setPermissionBusy] = useState<'history' | 'contentSettings' | undefined>();
  const [filter, setFilter] = useState<PermissionFilter>('all');
  const [sort, setSort] = useState<PermissionSort>('sensitivity');
  const [query, setQuery] = useState('');
  const [selectedHost, setSelectedHost] = useState<string>();
  const [selectedHosts, setSelectedHosts] = useState<string[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewItems, setReviewItems] = useState<string[]>([]);
  const [pendingKey, setPendingKey] = useState<string>();
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [audit, setAudit] = useState<PermissionAuditEntry[]>([]);
  const [auditError, setAuditError] = useState('');
  const [extensionPermissions, setExtensionPermissions] = useState<string[]>([]);
  const [extensionOrigins, setExtensionOrigins] = useState<string[]>([]);

  const refresh = async () => {
    setLoading(true);
    setRefreshError('');
    try {
      const [hasHistory, hasContentSettings, granted, auditEntries] = await Promise.all([
        chrome.permissions.contains({ permissions: ['history'] }),
        chrome.permissions.contains({ permissions: ['contentSettings'] }),
        chrome.permissions.getAll(),
        readPermissionAudit(),
      ]);
      setHistoryGranted(hasHistory);
      setSettingsGranted(hasContentSettings);
      setExtensionPermissions(granted.permissions ?? []);
      setExtensionOrigins(granted.origins ?? []);
      setAudit(auditEntries);

      if (!hasHistory) {
        setSites([]);
        setHistoryTruncated(false);
        return;
      }

      const history = await querySiteHistory('Last 30 days');
      setHistoryTruncated(history.truncated || history.failedUrlQueries > 0 || history.sites.length > MAX_REVIEW_SITES);
      const discovered = history.sites.slice(0, MAX_REVIEW_SITES);
      const enriched = hasContentSettings
        ? await mapWithConcurrency(discovered, 4, async (site) => ({
            ...site,
            settings: await readSitePermissionSettings(site.host),
          }))
        : discovered.map((site) => ({ ...site, settings: [] }));
      setSites(enriched);
      if (!selectedHost && enriched[0]) setSelectedHost(enriched[0].host);
      else if (selectedHost && !enriched.some((site) => site.host === selectedHost)) setSelectedHost(enriched[0]?.host);
    } catch {
      setRefreshError('Chrome could not load the site inventory. Check the optional permissions and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const visibleSites = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const result = sites.filter((site) => {
      if (normalizedQuery && !site.host.includes(normalizedQuery)) return false;
      if (filter === 'sensitive') return hasSensitiveAllow(site);
      if (filter === 'unsupported') return site.settings.some(({ state }) => state === 'unsupported');
      if (filter === 'all') return true;
      return site.settings.some(({ state }) => state === filter);
    });
    result.sort((a, b) => {
      if (sort === 'host') return a.host.localeCompare(b.host);
      if (sort === 'lastVisitTime') return b.lastVisitTime - a.lastVisitTime;
      return sensitiveAllowCount(b) - sensitiveAllowCount(a) || b.lastVisitTime - a.lastVisitTime || a.host.localeCompare(b.host);
    });
    return result;
  }, [filter, query, sites, sort]);

  const selectedSite = sites.find((site) => site.host === selectedHost);
  const sensitiveGrantCount = sites.reduce((count, site) => count + sensitiveAllowCount(site), 0);
  const extensionManifest = chrome.runtime.getManifest();
  const requiredPermissions = extensionManifest.permissions ?? [];
  const optionalPermissions = extensionManifest.optional_permissions ?? [];

  const requestPermission = async (permission: 'history' | 'contentSettings') => {
    setPermissionBusy(permission);
    setActionError('');
    try {
      const granted = await chrome.permissions.request({ permissions: [permission] });
      if (granted) await refresh();
      else setActionError(`Chrome did not grant the optional ${permission} permission.`);
    } catch {
      setActionError(`Could not request ${permission}. You can manage extension permissions in Chrome settings.`);
    } finally {
      setPermissionBusy(undefined);
    }
  };

  const blockOne = async (site: ManagerSite, definition: PermissionDefinition, bulk = false) => {
    const key = `${site.host}::${definition.id}`;
    if (pendingKey) return false;
    if (!bulk && !window.confirm(
      `Block ${definition.label} for ${site.host}? BrowserTrust will add a site-specific Chrome content-setting rule. You can review site settings in Chrome to change it later.`,
    )) return false;

    setPendingKey(key);
    setActionError('');
    setActionMessage('');
    let previousState: PermissionSettingState | undefined;
    let succeeded = false;
    try {
      previousState = (await readSitePermissionSetting(site.host, definition.id)).state;
      if (previousState !== 'allow') throw new Error('The current effective setting is no longer allowed; it was not changed.');
      await blockSitePermission(site.host, definition.id);
      succeeded = (await readSitePermissionSetting(site.host, definition.id)).state === 'block';
      if (!succeeded) throw new Error('Chrome did not report the setting as blocked after the update.');
      setActionMessage(`Blocked ${definition.label.toLowerCase()} for ${site.host}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Chrome could not change this setting.');
    }

    try {
      await appendPermissionAudit({
        timestamp: Date.now(),
        originPattern: `*://${site.host}/*`,
        permissionId: definition.id,
        ...(previousState ? { previousState } : {}),
        newState: 'block',
        succeeded,
      });
      setAudit(await readPermissionAudit());
    } catch {
      setAuditError('The setting action completed, but its local audit entry could not be saved.');
    }
    setPendingKey(undefined);
    return succeeded;
  };

  const openChromeSettings = async () => {
    await chrome.tabs.create({ url: 'chrome://settings/content' });
  };

  const openReview = (hosts = sites.filter(hasSensitiveAllow).map(({ host }) => host)) => {
    const chosen = new Set(hosts);
    const eligible = sites.filter(({ host }) => chosen.has(host)).flatMap((site) => site.settings
      .filter(({ permissionId, state }) => SENSITIVE_IDS.has(permissionId) && state === 'allow')
      .map(({ permissionId }) => reviewKey(site.host, permissionId)));
    setSelectedHosts([...chosen]);
    setReviewItems(eligible);
    setReviewOpen(true);
  };

  const applyReview = async () => {
    const affected = reviewItems.map(parseReviewKey).filter((item): item is { host: string; permissionId: string } => item !== undefined);
    if (affected.length === 0) return;
    const hostList = [...new Set(affected.map(({ host }) => host))];
    if (!window.confirm(`Block ${affected.length} sensitive site setting${affected.length === 1 ? '' : 's'} across ${hostList.length} site${hostList.length === 1 ? '' : 's'}? Each block adds a BrowserTrust-specific Chrome setting rule.`)) return;
    let changed = 0;
    for (const item of affected) {
      const site = sites.find(({ host }) => host === item.host);
      const definition = SITE_PERMISSION_DEFINITIONS.find(({ id }) => id === item.permissionId);
      if (site && definition && await blockOne(site, definition, true)) changed += 1;
    }
    setReviewOpen(false);
    setActionMessage(`Review complete: ${changed} of ${affected.length} setting${affected.length === 1 ? '' : 's'} confirmed blocked.`);
    await refresh();
  };

  const toggleSite = (host: string) => setSelectedHosts((current) =>
    current.includes(host) ? current.filter((item) => item !== host) : [...current, host],
  );
  const toggleReviewItem = (key: string) => setReviewItems((current) =>
    current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
  );

  const clearAudit = async () => {
    if (!window.confirm('Clear BrowserTrust permission-action audit entries from this device?')) return;
    try {
      await clearPermissionAudit();
      setAudit([]);
      setAuditError('');
    } catch {
      setAuditError('Could not clear the local audit log.');
    }
  };

  return (
    <div className="permission-manager">
      <section className="permission-intro">
        <div className="permission-intro-icon"><ShieldCheck size={19} aria-hidden="true" /></div>
        <div>
          <h2>Review website access</h2>
          <p>Site discovery uses up to 30 days of local Chrome history. A site appearing here means it was visited; it does not mean the site currently has a special permission.</p>
        </div>
        <button className="secondary-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} /> Refresh</button>
      </section>

      <div className="permission-coverage-grid">
        <section className={`permission-access-card${historyGranted ? ' access-enabled' : ''}`}>
          <div className="permission-access-heading"><History size={16} /><strong>Site discovery</strong><StatusTag state={historyGranted ? 'enabled' : 'required'} /></div>
          <p>History is used on this device to find visited hostnames and last-visit dates. BrowserTrust does not store page URLs in this manager.</p>
          {!historyGranted && <button className="primary-button" onClick={() => void requestPermission('history')} disabled={permissionBusy !== undefined}>{permissionBusy === 'history' ? 'Requesting…' : 'Allow history access'}</button>}
        </section>
        <section className={`permission-access-card${settingsGranted ? ' access-enabled' : ''}`}>
          <div className="permission-access-heading"><LockKeyhole size={16} /><strong>Chrome site settings</strong><StatusTag state={settingsGranted ? 'enabled' : 'required'} /></div>
          <p>Optional contentSettings access reads effective per-site settings and can add a restrictive site-specific block when you ask.</p>
          {!settingsGranted && <button className="primary-button" onClick={() => void requestPermission('contentSettings')} disabled={permissionBusy !== undefined}>{permissionBusy === 'contentSettings' ? 'Requesting…' : 'Enable settings review'}</button>}
        </section>
      </div>

      <div className="permission-coverage-note">
        <AlertTriangle size={15} aria-hidden="true" />
        <p>Chrome reports the effective setting for each queried origin, but does not tell this API whether it came from a site exception or a broader default. The site list is limited to recent history and is not an inventory of every permission grant.</p>
      </div>

      {actionError && <p className="permission-feedback feedback-error" role="alert">{actionError}</p>}
      {actionMessage && <p className="permission-feedback feedback-success" role="status"><Check size={14} /> {actionMessage}</p>}
      {refreshError && <p className="permission-feedback feedback-error" role="alert">{refreshError}</p>}

      <section className="permission-summary-row" aria-label="Permission review summary">
        <div><span>Visited sites</span><strong>{loading ? '…' : sites.length}</strong></div>
        <div><span>Effective sensitive allows</span><strong>{loading || !settingsGranted ? '—' : sensitiveGrantCount}</strong></div>
        <div><span>Settings needing Chrome</span><strong>{DEVICE_PERMISSION_LIMITATIONS.length}</strong></div>
        <div className="review-queue-summary"><span>Review queue</span><strong>{loading || !settingsGranted ? '—' : sensitiveGrantCount}</strong><button className="text-button" onClick={openReview} disabled={!settingsGranted || sensitiveGrantCount === 0}>Review allowed access</button></div>
      </section>

      {!historyGranted && <section className="permission-empty"><History size={20} /><strong>Allow site discovery to begin</strong><p>Without History permission, Chrome does not give this extension a list of visited sites to check.</p></section>}
      {historyGranted && !settingsGranted && <section className="permission-empty"><LockKeyhole size={20} /><strong>Site list is available; permission states are not</strong><p>Enable Chrome site-settings access to query the effective states for each visited hostname. No setting is changed by enabling access.</p></section>}
      {historyGranted && settingsGranted && <>
        <section className="content-panel permission-table-panel">
          <div className="panel-header permission-table-header">
            <div><h2>Sites from recent history</h2><p>{historyTruncated ? 'Showing a bounded subset of recent hostnames; not exhaustive.' : 'Choose a site to inspect the effective Chrome settings.'}</p></div>
            <button className="secondary-button" onClick={openChromeSettings}><ExternalLink size={13} /> Chrome site settings</button>
          </div>
          <div className="permission-toolbar">
            <div className="permission-filter-tabs" role="group" aria-label="Filter sites by permission state">
              {filters.map(({ id, label }) => <button key={id} className={filter === id ? 'filter-active' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
            </div>
            <label className="permission-search"><Search size={14} /><span className="visually-hidden">Search sites</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search domains" /></label>
            <label className="permission-sort">Sort <select value={sort} onChange={(event) => setSort(event.target.value as PermissionSort)}><option value="sensitivity">Sensitivity</option><option value="lastVisitTime">Last visit</option><option value="host">Domain</option></select><ArrowDownWideNarrow size={13} aria-hidden="true" /></label>
          </div>
          {historyTruncated && <p className="permission-result-note">The History query cap, per-URL lookup failures, or 100-site review limit may omit sites from this list.</p>}
          <div className="table-scroll">
            <table className="sites-table permission-sites-table">
              <thead><tr><th scope="col"><span className="visually-hidden">Select site for review</span></th><th scope="col">Site</th><th scope="col">Sensitive access</th><th scope="col">Last visit</th></tr></thead>
              <tbody>{visibleSites.map((site) => {
                const highAllowed = site.settings.some(({ permissionId, state }) => SENSITIVE_IDS.has(permissionId) && state === 'allow');
                return <tr key={site.host} className={site.host === selectedHost ? 'permission-row-selected' : ''}>
                  <td><input aria-label={`Select ${site.host} for sensitive permission review`} type="checkbox" checked={selectedHosts.includes(site.host)} disabled={!highAllowed} onChange={() => toggleSite(site.host)} /></td>
                  <td><button className="permission-site-select" onClick={() => setSelectedHost(site.host)}><span className="site-favicon">{site.host.slice(0, 1).toUpperCase()}</span><span><strong>{site.host}</strong><small>History presence only</small></span></button></td>
                  <td>{site.settings.length === 0 ? <StateBadge state="unsupported" /> : <SensitiveSummary site={site} />}</td>
                  <td className="last-visited-cell">{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(site.lastVisitTime)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          {visibleSites.length === 0 && <p className="permission-empty-inline">No sites match this filter.</p>}
          <div className="table-footer"><span>{visibleSites.length} of {sites.length} listed sites</span><button className="text-button" onClick={() => openReview(selectedHosts)} disabled={selectedHosts.length === 0}>Review selected sites ({selectedHosts.length})</button></div>
        </section>

        {reviewOpen && <section className="bulk-review-panel" aria-labelledby="bulk-review-title">
          <div className="bulk-review-header"><div><p className="eyebrow">REVIEW BEFORE CHANGING</p><h2 id="bulk-review-title">Sensitive settings selected for blocking</h2><p>Only the items below will be changed. Each action creates a BrowserTrust-owned Chrome rule.</p></div><button className="icon-button" aria-label="Close review" onClick={() => setReviewOpen(false)}><X size={16} /></button></div>
          <div className="bulk-review-list">{sites.filter(({ host }) => selectedHosts.includes(host)).flatMap((site) => site.settings
            .filter(({ permissionId, state }) => SENSITIVE_IDS.has(permissionId) && state === 'allow')
            .map(({ permissionId }) => {
              const definition = SITE_PERMISSION_DEFINITIONS.find((item) => item.id === permissionId)!;
              const key = reviewKey(site.host, permissionId);
              return <label className="bulk-review-item" key={key}><input type="checkbox" checked={reviewItems.includes(key)} onChange={() => toggleReviewItem(key)} /><span><strong>{definition.label}</strong><small>{site.host} · currently allowed (effective)</small></span><StateBadge state="allow" /></label>;
            }))}</div>
          {reviewItems.length === 0 && <p className="permission-empty-inline">Select at least one allowed sensitive setting above.</p>}
          <div className="bulk-review-actions"><button className="secondary-button" onClick={() => setReviewOpen(false)}>Cancel</button><button className="primary-button" onClick={() => void applyReview()} disabled={reviewItems.length === 0 || pendingKey !== undefined}>{pendingKey ? 'Applying…' : `Block ${reviewItems.length} selected settings`}</button></div>
        </section>}

        <section className="content-panel permission-detail-panel">
          <div className="panel-header"><div><h2>{selectedSite?.host ?? 'Site details'}</h2><p>Effective Chrome settings · last visit {selectedSite ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(selectedSite.lastVisitTime) : 'unavailable'}</p></div><button className="secondary-button" onClick={openChromeSettings}><ExternalLink size={13} /> Manage in Chrome</button></div>
          {!selectedSite ? <p className="permission-empty-inline">Select a site above to inspect its permission settings.</p> : <div className="permission-detail-list">{SITE_PERMISSION_DEFINITIONS.map((definition) => {
            const state = selectedSite.settings.find((item) => item.permissionId === definition.id)?.state ?? 'unsupported';
            const key = `${selectedSite.host}::${definition.id}`;
            const canBlock = definition.canBlock && canBlockSitePermission(definition.id) && state === 'allow';
            return <article className="permission-detail-row" key={definition.id}>
              <div className="permission-detail-main"><span className={`sensitivity-marker sensitivity-${definition.sensitivity}`} aria-hidden="true" /><div><strong>{definition.label}</strong><p>{definition.description}</p></div></div>
              <StateBadge state={state} />
              {canBlock ? <button className="secondary-button danger-action" onClick={() => void blockOne(selectedSite, definition)} disabled={pendingKey !== undefined}>{pendingKey === key ? 'Blocking…' : 'Block'}</button> : <span className="permission-control-note">{state === 'unsupported' ? 'Not exposed by this Chrome API/version' : state === 'error' ? 'Could not read' : 'Use Chrome settings to change or reset'}</span>}
            </article>;
          })}</div>}
          <div className="permission-detail-footnote">“Allowed”, “Blocked”, and “Ask” describe the effective content setting returned for the HTTPS hostname. They do not reveal whether Chrome stores a site exception or uses a broader default. BrowserTrust can add a block rule; removing or resetting individual Chrome exceptions must be done in Chrome settings.</div>
        </section>
      </>}

      <section className="content-panel device-limitations-panel">
        <div className="panel-header"><div><h2>Device access and browser-level controls</h2><p>These grants are managed outside the per-site content settings API.</p></div><button className="secondary-button" onClick={openChromeSettings}><ExternalLink size={13} /> Open Chrome site settings</button></div>
        <div className="device-permission-list">{DEVICE_PERMISSION_LIMITATIONS.map(({ id, label }) => <div className="device-permission-row" key={id}><span><strong>{label}</strong><small>Chrome does not expose other sites’ granted-device inventory to this extension.</small></span><StateBadge state="unsupported" /><button className="text-button" onClick={openChromeSettings}>Open settings</button></div>)}</div>
      </section>

      <section className="content-panel extension-permissions-panel">
        <div className="panel-header"><div><h2>BrowserTrust extension access</h2><p>Separate from permissions that websites hold. Optional access is enabled only when Chrome currently grants it.</p></div></div>
        <div className="extension-permission-groups"><ExtensionPermissionGroup title="Required by the extension" permissions={requiredPermissions} granted={extensionPermissions} /><ExtensionPermissionGroup title="Optional feature access" permissions={optionalPermissions} granted={extensionPermissions} /></div>
        <div className="extension-origins"><strong>Currently granted site access</strong>{extensionOrigins.length ? <ul>{extensionOrigins.map((origin) => <li key={origin}>{origin}</li>)}</ul> : <p>No host access is currently granted to BrowserTrust.</p>}</div>
      </section>

      <section className="content-panel permission-audit-panel">
        <div className="panel-header"><div><h2>BrowserTrust action log</h2><p>Only changes made from this manager are recorded, for up to {PERMISSION_AUDIT_RETENTION_DAYS} days. Earlier Chrome permission history is not available here.</p></div><button className="secondary-button" onClick={() => void clearAudit()} disabled={audit.length === 0}><X size={13} /> Clear log</button></div>
        {auditError && <p className="permission-feedback feedback-error" role="alert">{auditError}</p>}
        {audit.length ? <div className="audit-list">{audit.map((entry) => <div className="audit-row" key={entry.id}><span className={entry.succeeded ? 'audit-result success' : 'audit-result failure'}>{entry.succeeded ? 'Confirmed' : 'Failed'}</span><strong>{entry.originPattern.slice(4, -2)}</strong><span>{SITE_PERMISSION_DEFINITIONS.find(({ id }) => id === entry.permissionId)?.label ?? entry.permissionId}: {entry.previousState ?? 'unknown'} → {entry.newState}</span><time dateTime={new Date(entry.timestamp).toISOString()}>{new Date(entry.timestamp).toLocaleString()}</time></div>)}</div> : <p className="permission-empty-inline">No BrowserTrust permission actions have been recorded.</p>}
      </section>
    </div>
  );
}

function StatusTag({ state }: { state: 'enabled' | 'required' }) {
  return <span className={`permission-status-tag ${state}`}>{state === 'enabled' ? 'Enabled' : 'Optional'}</span>;
}

function StateBadge({ state }: { state: PermissionSettingState }) {
  const labels: Record<PermissionSettingState, string> = {
    allow: 'Allowed', block: 'Blocked', ask: 'Ask', session_only: 'Session only',
    unsupported: 'Unsupported', error: 'Unavailable', unknown: 'Unknown',
  };
  return <span className={`permission-state-badge state-${state}`}>{labels[state]}</span>;
}

function SensitiveSummary({ site }: { site: ManagerSite }) {
  const allowed = site.settings.filter(({ permissionId, state }) => SENSITIVE_IDS.has(permissionId) && state === 'allow');
  if (!allowed.length) return <span className="permission-summary-muted">No effective sensitive allows</span>;
  return <span className="sensitive-summary">{allowed.map(({ permissionId }) => SITE_PERMISSION_DEFINITIONS.find(({ id }) => id === permissionId)?.label).filter(Boolean).join(', ')} allowed (effective)</span>;
}

function ExtensionPermissionGroup({ title, permissions, granted }: { title: string; permissions: readonly string[]; granted: string[] }) {
  return <section className="extension-permission-group"><h3>{title}</h3>{permissions.length ? <ul>{permissions.map((permission) => {
    const isGranted = granted.includes(permission);
    return <li key={permission}><span><strong>{permission}</strong><small>{extensionPermissionDescriptions[permission] ?? 'Extension API access declared by the manifest.'}</small></span><span className={`extension-access-state ${isGranted ? 'enabled' : 'disabled'}`}>{isGranted ? 'Granted' : 'Not granted'}</span></li>;
  })}</ul> : <p>None declared.</p>}</section>;
}

function hasSensitiveAllow(site: ManagerSite): boolean {
  return site.settings.some(({ permissionId, state }) => SENSITIVE_IDS.has(permissionId) && state === 'allow');
}

function sensitiveAllowCount(site: ManagerSite): number {
  return site.settings.filter(({ permissionId, state }) => SENSITIVE_IDS.has(permissionId) && state === 'allow').length;
}

function reviewKey(host: string, permissionId: string): string {
  return `${host}::${permissionId}`;
}

function parseReviewKey(value: string): { host: string; permissionId: string } | undefined {
  const separator = value.lastIndexOf('::');
  if (separator <= 0) return undefined;
  return { host: value.slice(0, separator), permissionId: value.slice(separator + 2) };
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, operation: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item !== undefined) results[index] = await operation(item);
    }
  });
  await Promise.all(workers);
  return results;
}
