import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  ArrowDownWideNarrow,
  ArrowRight,
  Bell,
  CalendarClock,
  Camera,
  Check,
  Clock3,
  Compass,
  Globe2,
  LayoutDashboard,
  MapPin,
  Menu,
  Mic,
  PanelsTopLeft,
  Pause,
  Play,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import './theme.css';
import './dashboard.css';
import './permission-manager.css';
import { ACTIVE_TIME_TRACKING_PERMISSIONS } from '../background/activity-time-tracker';
import {
  localDayKey,
  summarizeActiveTime,
  type ActivityTimeSnapshot,
} from '../core/activity-time';
import { sendRequest } from '../shared/messages';
import { getHistoryRange, querySiteHistory, type HistoryActivityResult, type HistoryPeriod } from './history';
import { PermissionManager } from './permission-manager';
import { ContextKeeper } from './context-keeper';
import { TrustMonitor } from './trust-monitor';
import { FollowUpTracker } from './follow-up-tracker';
import { WebRecall } from './web-recall';

type ViewId = 'overview' | 'sites' | 'permissions' | 'recall' | 'followups' | 'spaces' | 'trust';
type SortKey = 'visits' | 'lastVisitTime' | 'host' | 'activeMs';
type HistoryStatus = 'checking' | 'permission' | 'loading' | 'ready' | 'error';

type NavItem = {
  id: ViewId;
  label: string;
  icon: LucideIcon;
};

const primaryNav: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'sites', label: 'Sites & Activity', icon: Activity },
  { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
  { id: 'recall', label: 'Web Recall', icon: Search },
  { id: 'spaces', label: 'Context Keeper', icon: PanelsTopLeft },
];

const allNav: NavItem[] = [
  ...primaryNav,
  { id: 'followups', label: 'Follow-up Tracker', icon: CalendarClock },
  { id: 'trust', label: 'Trust Monitor', icon: Shield },
];

const permissionIndicators = [
  { label: 'Camera', icon: Camera },
  { label: 'Microphone', icon: Mic },
  { label: 'Location', icon: MapPin },
  { label: 'Notifications', icon: Bell },
  { label: 'Shield', icon: Shield },
];

const headings: Record<ViewId, { title: string; description: string }> = {
  overview: {
    title: 'Overview',
    description: 'A clear starting point for a more considered browser experience.',
  },
  sites: {
    title: 'Sites & Activity',
    description: 'Explore browsing patterns and site visits in one place.',
  },
  permissions: {
    title: 'Permissions',
    description: 'Inspect supported Chrome site settings and understand where Chrome keeps the rest.',
  },
  recall: {
    title: 'Web Recall',
    description: 'Find useful pages again from history and saved items.',
  },
  followups: {
    title: 'Follow-up Tracker',
    description: 'Track renewals, tasks, and deadlines in a private local list.',
  },
  spaces: {
    title: 'Context Keeper',
    description: 'Bring related tabs together in named workspaces.',
  },
  trust: {
    title: 'Trust Monitor',
    description: 'Review evidence-backed site assessments, findings, destinations, and activity.',
  },
};

const PERIODS: readonly HistoryPeriod[] = ['Today', 'Last 7 days', 'Last 30 days'];

function initialView(): ViewId {
  const requested = new URLSearchParams(window.location.search).get('view');
  return allNav.some((item) => item.id === requested) ? (requested as ViewId) : 'overview';
}

function App() {
  const [activeView, setActiveView] = useState<ViewId>(initialView);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const current = headings[activeView];

  const navigate = (view: ViewId) => {
    setActiveView(view);
    setSidebarOpen(false);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <a
          className="brand"
          href="#overview"
          onClick={() => navigate('overview')}
          aria-label="BrowserTrust overview"
        >
          <span className="brand-mark" aria-hidden="true">
            b
          </span>
          <span className="brand-name">BrowserTrust</span>
        </a>

        <nav className="sidebar-nav" aria-label="Dashboard sections">
          {primaryNav.map(({ id, label, icon: Icon }) => (
            <button
              className={`nav-item${activeView === id ? ' nav-item-active' : ''}`}
              key={id}
              onClick={() => navigate(id)}
              aria-current={activeView === id ? 'page' : undefined}
            >
              <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-section">
          <p className="sidebar-section-label">TRUST MONITOR</p>
          <button
            className={`nav-item${activeView === 'trust' ? ' nav-item-active' : ''}`}
            onClick={() => navigate('trust')}
            aria-current={activeView === 'trust' ? 'page' : undefined}
          >
            <Shield size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>Trust Monitor</span>
          </button>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-section-label">CURRENT SITE PERMISSIONS</p>
          <div className="permission-indicators">
            {permissionIndicators.map(({ label, icon: Icon }) => (
              <div className="permission-indicator" key={label} title={label}>
                <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-bottom">
          <button
            className={`nav-item followup-nav${activeView === 'followups' ? ' nav-item-active' : ''}`}
            onClick={() => navigate('followups')}
            aria-current={activeView === 'followups' ? 'page' : undefined}
          >
            <CalendarClock size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>Follow-up Tracker</span>
          </button>
          <span className="sidebar-version">BROWSERTRUST · PREVIEW</span>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="main-area">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={19} aria-hidden="true" />
          </button>
          <div className="breadcrumbs">
            <span>BrowserTrust</span>
            <span className="breadcrumb-separator">/</span>
            <strong>{current.title}</strong>
          </div>
          <div className="topbar-actions">
            <span className="local-status">
              <span className="status-dot" /> Local only
            </span>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {activeView === 'overview'
                  ? 'YOUR BROWSER COMPANION'
                  : 'DASHBOARD'}
              </p>
              <h1>{current.title}</h1>
              <p className="page-description">{current.description}</p>
            </div>
          </div>
          {activeView === 'overview' ? (
            <Overview onNavigate={navigate} />
          ) : activeView === 'sites' ? (
            <SitesActivity />
          ) : activeView === 'permissions' ? (
            <PermissionManager />
          ) : activeView === 'spaces' ? (
            <ContextKeeper />
          ) : activeView === 'followups' ? (
            <FollowUpTracker />
          ) : activeView === 'trust' ? (
            <TrustMonitor />
          ) : activeView === 'recall' ? (
            <WebRecall />
          ) : (
            <FeaturePlaceholder view={activeView} onNavigate={navigate} />
          )}
          <footer className="page-footer">
            <span>BrowserTrust dashboard</span>
            <span>
              <span className="status-dot" /> {activeView === 'sites' || activeView === 'permissions' || activeView === 'spaces' || activeView === 'followups' || activeView === 'trust' || activeView === 'recall' ? 'Data and workspace snapshots stay on this device' : 'This view is a placeholder'}
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function Overview({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const quickLinks: { id: ViewId; title: string; description: string; icon: LucideIcon }[] = [
    {
      id: 'sites',
      title: 'Sites & Activity',
      description: 'Visit patterns and activity summaries',
      icon: Activity,
    },
    {
      id: 'permissions',
      title: 'Permissions',
      description: 'Review site access in one place',
      icon: ShieldCheck,
    },
    { id: 'spaces', title: 'Context Keeper', description: 'Save and restore tab workspaces', icon: PanelsTopLeft },
  ];

  return (
    <div className="overview-view">
      <section className="overview-banner">
        <div className="banner-copy">
          <span className="banner-label">BROWSERTRUST DASHBOARD</span>
          <h2>Your browser, with more clarity.</h2>
          <p>
            Tools for understanding your browsing activity, keeping useful context, and reviewing site
            behavior.
          </p>
        </div>
        <div className="banner-mark" aria-hidden="true">
          <ShieldCheck size={56} strokeWidth={1.2} />
        </div>
        <button className="button button-primary banner-action" onClick={() => onNavigate('sites')}>
          Explore Sites & Activity <ArrowRight size={15} aria-hidden="true" />
        </button>
      </section>

      <div className="section-heading-row">
        <div>
          <h2>Explore your workspace</h2>
          <p>Choose a space to continue.</p>
        </div>
      </div>
      <section className="quick-links" aria-label="Dashboard sections">
        {quickLinks.map(({ id, title, description, icon: Icon }) => (
          <button className="quick-link" key={id} onClick={() => onNavigate(id)}>
            <span className="quick-link-icon">
              <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span className="quick-link-copy">
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <ArrowRight className="quick-link-arrow" size={16} aria-hidden="true" />
          </button>
        ))}
      </section>

      <section className="overview-note">
        <div className="note-icon">
          <Compass size={18} strokeWidth={1.8} aria-hidden="true" />
        </div>
        <div>
          <strong>A foundation for your browser companion</strong>
          <p>
            Sites & Activity includes local history summaries and optional active-time estimates. Permissions
            reviews recent sites and supported Chrome settings. Context Keeper saves local tab workspaces. Web
            Recall provides private local history search with saved collections. Trust Monitor reviews evidence-backed
            site assessments.
          </p>
        </div>
      </section>
    </div>
  );
}

function SitesActivity() {
  const [period, setPeriod] = useState<HistoryPeriod>('Last 7 days');
  const [sortKey, setSortKey] = useState<SortKey>('visits');
  const [sortAscending, setSortAscending] = useState(false);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>('checking');
  const [history, setHistory] = useState<HistoryActivityResult>();
  const [historyError, setHistoryError] = useState('');
  const [timeError, setTimeError] = useState('');
  const [time, setTime] = useState<ActivityTimeSnapshot>();
  const [trackingPending, setTrackingPending] = useState(false);
  const [historyPending, setHistoryPending] = useState(false);
  const [now, setNow] = useState(Date.now);
  const range = useMemo(() => getHistoryRange(period, now), [period, now]);

  const loadHistory = async (cancelled: () => boolean = () => false) => {
    try {
      const allowed = await chrome.permissions.contains({ permissions: ['history'] });
      if (cancelled()) return;
      if (!allowed) {
        setHistoryStatus('permission');
        setHistory(undefined);
        return;
      }
      setHistoryStatus('loading');
      setHistory(undefined);
      setHistoryError('');
      const result = await querySiteHistory(period);
      if (!cancelled()) {
        setHistory(result);
        setHistoryStatus('ready');
        setNow(Date.now());
      }
    } catch {
      if (!cancelled()) {
        setHistoryStatus('error');
        setHistoryError('Chrome could not read browsing history. Try again or review the extension permission.');
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      loadHistory(() => cancelled),
      sendRequest<'get-activity-time'>({ type: 'get-activity-time' }).then((snapshot) => setTime(snapshot)).catch(() => undefined),
    ]);
    return () => { cancelled = true; };
  }, [period]);

  const requestHistory = async () => {
    setHistoryPending(true);
    try {
      const allowed = await chrome.permissions.request({ permissions: ['history'] });
      if (allowed) await loadHistory();
      else setHistoryStatus('permission');
    } catch {
      setHistoryError('Chrome did not grant history access. You can enable it in extension settings.');
      setHistoryStatus('error');
    } finally {
      setHistoryPending(false);
    }
  };

  const toggleTracking = async () => {
    setTrackingPending(true);
    try {
      const enabled = time?.enabled !== true;
      if (enabled) {
        const allowed = await chrome.permissions.request({ permissions: [...ACTIVE_TIME_TRACKING_PERMISSIONS] });
        if (!allowed) {
          setTimeError('Tracking stays off until the optional tabs, idle, and alarms permissions are granted.');
          return;
        }
      }
      setTime(await sendRequest<'set-activity-time-tracking'>({ type: 'set-activity-time-tracking', enabled }));
      setTimeError('');
    } catch {
      setTimeError('Could not update active-time tracking. Check the optional permissions and try again.');
    } finally {
      setTrackingPending(false);
    }
  };

  const clearTracking = async () => {
    if (!window.confirm('Clear all locally stored active browsing-time records?')) return;
    try {
      setTime(await sendRequest<'clear-activity-time'>({ type: 'clear-activity-time' }));
      setTimeError('');
    } catch {
      setTimeError('Could not clear the locally stored active-time records.');
    }
  };

  const refreshDashboard = async () => {
    await Promise.all([
      loadHistory(),
      sendRequest<'get-activity-time'>({ type: 'get-activity-time' }).then((snapshot) => setTime(snapshot)).catch(() => setTimeError('Could not refresh active-time records.')),
    ]);
  };

  const activeByHost = useMemo(() => summarizeActiveTime(time?.records ?? [], range.startDay, range.endDay), [time, range]);
  const siteMap = new Map((history?.sites ?? []).map((site) => [site.host, site]));
  const hosts = new Set([...siteMap.keys(), ...activeByHost.keys()]);
  const sites = [...hosts].map((host) => ({
    host,
    visits: siteMap.get(host)?.visits ?? 0,
    lastVisitTime: siteMap.get(host)?.lastVisitTime ?? 0,
    activeMs: activeByHost.get(host) ?? 0,
  }));
  sites.sort((a, b) => {
    const result = sortKey === 'host' ? a.host.localeCompare(b.host)
      : sortKey === 'activeMs' ? a.activeMs - b.activeMs
        : sortKey === 'lastVisitTime' ? a.lastVisitTime - b.lastVisitTime
          : a.visits - b.visits;
    return sortAscending ? result : -result;
  });
  const totalVisits = history?.totalVisits ?? 0;
  const topSite = [...(history?.sites ?? [])].sort((a, b) => b.visits - a.visits)[0];
  const activeTotal = [...activeByHost.values()].reduce((sum, value) => sum + value, 0);
  const activityData = Array.from({ length: period === 'Today' ? 1 : period === 'Last 7 days' ? 7 : 30 }, (_, index) => {
    const date = new Date(range.startTime);
    date.setDate(date.getDate() + index);
    const key = localDayKey(date.getTime());
    return { day: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), visits: history?.dailyVisits.get(key) ?? 0 };
  });
  const activityScale = Math.max(1, ...activityData.map(({ visits }) => visits));

  const selectSort = (next: SortKey) => {
    if (sortKey === next) setSortAscending(!sortAscending);
    else {
      setSortKey(next);
      setSortAscending(next === 'host');
    }
  };

  return (
    <div className="sites-view">
      <div className="preview-notice">
        <span className="notice-icon">
          <Activity size={16} aria-hidden="true" />
        </span>
        <p>
          <strong>Private, local activity summary</strong>
          <span>History visits are read only after you grant access. Active time is an estimate for an active tab in a focused window while Chrome reports you active.</span>
        </p>
        <span className="sample-label">ON THIS DEVICE</span>
      </div>

      <div className="sites-toolbar">
        <div className="period-control" role="group" aria-label="History date range">
          {PERIODS.map((option) => (
            <button
              className={period === option ? 'period-active' : ''}
              key={option}
              onClick={() => setPeriod(option)}
              aria-pressed={period === option}
            >
              {option}
            </button>
          ))}
        </div>
        <span className="toolbar-caption">Local browser history</span>
        <button className="secondary-button" onClick={() => void refreshDashboard()} disabled={historyStatus === 'loading'}><RefreshCw size={13} /> Refresh</button>
      </div>

      {historyStatus === 'permission' && <section className="access-panel"><div><strong>Allow access to browsing history</strong><p>BrowserTrust uses Chrome’s History API to count visits and group them by hostname. URLs are processed locally for this view and are not sent anywhere.</p></div><button className="primary-button" onClick={() => void requestHistory()} disabled={historyPending}>{historyPending ? 'Requesting…' : 'Allow history access'}</button></section>}
      {historyStatus === 'loading' && <p className="state-message" role="status">Loading local browsing history…</p>}
      {historyStatus === 'error' && <div className="state-message state-error" role="alert"><span>{historyError}</span><button className="secondary-button" onClick={() => void loadHistory()}>Try again</button></div>}
      {historyStatus === 'ready' && history && (history.truncated || history.failedUrlQueries > 0) && <p className="state-message">This history summary may be incomplete{history.truncated ? ' because Chrome returned the 3,000-item query limit' : ''}{history.failedUrlQueries ? `; ${history.failedUrlQueries} URL visit lookup${history.failedUrlQueries === 1 ? '' : 's'} failed` : ''}.</p>}
      {timeError && <p className="state-message state-error" role="alert">{timeError}</p>}
      <section className="summary-grid" aria-label="Browsing activity summary">
        <SummaryCard
          label="Recorded visits"
          value={historyStatus === 'ready' ? totalVisits.toLocaleString() : '—'}
          detail={`${period} · local history`}
          icon={Activity}
        />
        <SummaryCard
          label="Unique sites"
          value={historyStatus === 'ready' ? String(history?.sites.length ?? 0) : '—'}
          detail="Distinct hostnames"
          icon={Globe2}
        />
        <SummaryCard
          label="Most visited"
          value={historyStatus === 'ready' ? topSite?.host ?? 'No visits' : '—'}
          detail={topSite ? `${topSite.visits} visits` : 'No history in this period'}
          icon={ArrowDownWideNarrow}
        />
        <SummaryCard
          label="Active browsing time"
          value={activeTotal ? formatDuration(activeTotal) : time?.enabled ? 'No records yet' : 'Paused'}
          detail={time?.enabled ? 'Estimated active browsing time' : 'Tracking is off'}
          icon={Clock3}
          subdued
        />
      </section>

      <section className="content-panel site-table-panel">
        <div className="panel-header">
          <div>
          <h2>Sites</h2>
            <p>Visits and estimated active time by hostname</p>
          </div>
          <span className="table-caption">{history?.truncated ? 'Showing up to 3,000 history items' : `${sites.length} sites`}</span>
        </div>
        <div className="table-scroll">
          <table className="sites-table">
            <thead>
              <tr>
                <th scope="col">
                    <button className="sort-button" onClick={() => selectSort('host')}>
                    Site <SortGlyph active={sortKey === 'host'} ascending={sortAscending} />
                  </button>
                </th>
                <th scope="col">
                  <button
                    className="sort-button"
                    onClick={() => selectSort('visits')}
                    aria-label="Sort by visit count"
                  >
                    Visits <SortGlyph active={sortKey === 'visits'} ascending={sortAscending} />
                  </button>
                </th>
                <th scope="col">
                  <button className="sort-button" onClick={() => selectSort('lastVisitTime')}>
                    Last visit <SortGlyph active={sortKey === 'lastVisitTime'} ascending={sortAscending} />
                  </button>
                </th>
                <th scope="col"><button className="sort-button" onClick={() => selectSort('activeMs')}>Est. active time <SortGlyph active={sortKey === 'activeMs'} ascending={sortAscending} /></button></th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => {
                return (
                  <tr key={site.host}>
                    <td>
                      <div className="site-cell">
                        <span className="site-favicon">{site.host.slice(0, 1).toUpperCase()}</span>
                        <span>
                          <strong>{site.host}</strong>
                          <small>{site.visits ? 'Visited in selected period' : 'Time record only'}</small>
                        </span>
                      </div>
                    </td>
                    <td className="visits-cell">{site.visits || '—'}</td>
                    <td className="last-visited-cell">{site.lastVisitTime ? formatLastVisit(site.lastVisitTime) : '—'}</td>
                    <td className="visits-cell">{site.activeMs ? formatDuration(site.activeMs) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          {historyStatus !== 'ready' ? 'Grant history access to see sites.' : sites.length === 0 ? 'No site visits or time records for this period.' : `Showing ${sites.length} sites`}{' '}
          <span>
            Sorted by {sortKey === 'host' ? 'hostname' : sortKey === 'visits' ? 'visits' : sortKey === 'activeMs' ? 'estimated active time' : 'last visit'}
          </span>
        </div>
      </section>

      <div className="activity-lower-grid">
        <section className="content-panel activity-panel">
          <div className="panel-header">
            <div>
              <h2>Browsing activity</h2>
              <p>
                Daily visit counts · local history
              </p>
            </div>
            <span className="chart-legend">
              <i /> Visits
            </span>
          </div>
          {historyStatus === 'ready' && totalVisits > 0 ? <div className="activity-chart" role="img" aria-label={`Daily local visit counts for ${period}`}>
            <div className="chart-guides">
              <i />
              <i />
              <i />
            </div>
            <div className="bar-chart">
              {activityData.map(({ day, visits }) => (
                <div className="bar-column" key={day}>
                  <div className="bar-track">
                  {visits > 0 && <i style={{ height: `${(visits / activityScale) * 100}%` }} />}
                  </div>
                  <span>{day}</span>
                </div>
              ))}
            </div>
          </div> : <p className="state-message">{historyStatus === 'ready' ? 'No visits in this date range.' : 'History data will appear here after access is granted.'}</p>}
          <div className="chart-footnote">Visit totals use local top-level visit records within the selected range.</div>
        </section>
        <section className="content-panel time-panel">
          <div className="panel-header">
            <div>
              <h2>Time spent</h2>
              <p>{time?.enabled ? 'Tracking is enabled' : 'Optional, locally stored estimate'}</p>
            </div>
            <Clock3 size={17} className="panel-muted-icon" aria-hidden="true" />
          </div>
          <div className="time-empty">
            <span className="time-empty-icon">
              <Clock3 size={19} aria-hidden="true" />
            </span>
            <strong>
              {time?.enabled
                ? activeTotal
                  ? `${formatDuration(activeTotal)} recorded`
                  : 'Waiting for eligible browsing'
                : 'Tracking is paused'}
            </strong>
            <p>Enabling requests optional tabs, idle, and alarms permissions. Counts only an HTTP(S) active tab in the focused Chrome window while Chrome reports you active. This estimates foreground time, not attention; long worker/browser interruptions can be undercounted.</p>
          </div>
          <div className="tracking-actions"><button className={time?.enabled ? 'secondary-button' : 'primary-button'} onClick={() => void toggleTracking()} disabled={trackingPending}>{time?.enabled ? <><Pause size={13} /> Pause tracking</> : <><Play size={13} /> Enable time tracking</>}</button>{(time?.records.length ?? 0) > 0 && <button className="secondary-button" onClick={() => void clearTracking()}><Trash2 size={13} /> Clear records</button>}</div>
          <span className="time-footnote">Stored locally as hostname/day totals for up to 30 days. No full URLs or page content are stored.</span>
        </section>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  subdued = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  subdued?: boolean;
}) {
  return (
    <article className={`summary-card${subdued ? ' summary-card-subdued' : ''}`}>
      <div className="summary-card-top">
        <span>{label}</span>
        <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
      </div>
      <strong className="summary-value">{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${Math.max(1, minutes)}m`;
}

function formatLastVisit(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

function SortGlyph({ active, ascending }: { active: boolean; ascending: boolean }) {
  return (
    <ArrowDownWideNarrow
      className={`sort-glyph${active ? ' sort-glyph-active' : ''}${ascending ? ' sort-glyph-ascending' : ''}`}
      size={13}
      aria-hidden="true"
    />
  );
}

function FeaturePlaceholder({
  view,
  onNavigate,
}: {
  view: Exclude<ViewId, 'overview' | 'sites' | 'permissions' | 'spaces' | 'followups' | 'trust' | 'recall'>;
  onNavigate: (view: ViewId) => void;
}) {
  const feature: Record<
    string,
    { icon: LucideIcon; title: string; description: string; rows: string[] }
  > = {};
  const content = feature[view as string];
  if (!content) return null;
  const Icon = content.icon;
  return (
    <section className="feature-layout">
      <div className="feature-heading">
        <span className="feature-icon">
          <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">YOUR TOOLS</p>
          <h2>{content.title}</h2>
          <p>{content.description}</p>
        </div>
      </div>
      <div className="content-panel feature-panel">
        <div className="panel-header">
          <div>
            <h2>Planned for this space</h2>
            <p>This preview does not read or change browser data.</p>
          </div>
          <span className="feature-state">
            <span /> Not connected
          </span>
        </div>
        <ul className="feature-list">
          {content.rows.map((row) => (
            <li key={row}>
              <span className="feature-list-icon">
                <Check size={14} aria-hidden="true" />
              </span>
              {row}
            </li>
          ))}
        </ul>
        <div className="feature-empty">
          <div className="feature-empty-icon">
            <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
          </div>
          <strong>No browser data is shown here</strong>
          <p>
            This feature is a design placeholder. No permissions, history, reminders, or workspaces are being
            accessed.
          </p>
        </div>
      </div>
      <button className="back-link" onClick={() => onNavigate('overview')}>
        <ArrowRight size={14} className="back-arrow" aria-hidden="true" /> Back to Overview
      </button>
    </section>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Dashboard root element is missing');
createRoot(root).render(<App />);
