import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  ArrowDownWideNarrow,
  ArrowRight,
  Bell,
  Bookmark,
  CalendarClock,
  Check,
  Clock3,
  Compass,
  Globe2,
  LayoutDashboard,
  Menu,
  PanelsTopLeft,
  Search,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

type ViewId = 'overview' | 'sites' | 'permissions' | 'recall' | 'followups' | 'spaces' | 'trust';
type Period = 'Today' | '7 days' | '30 days';
type SortKey = 'visits' | 'lastVisited' | 'name';

type NavItem = {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  group: string;
};

const navItems: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'YOUR BROWSER' },
  { id: 'sites', label: 'Sites & Activity', icon: Activity, group: 'YOUR BROWSER' },
  { id: 'permissions', label: 'Permissions', icon: ShieldCheck, group: 'YOUR BROWSER' },
  { id: 'recall', label: 'Web Recall', icon: Search, group: 'YOUR TOOLS' },
  { id: 'followups', label: 'Follow-up Tracker', icon: CalendarClock, group: 'YOUR TOOLS' },
  { id: 'spaces', label: 'Context Keeper', icon: PanelsTopLeft, group: 'YOUR TOOLS' },
  { id: 'trust', label: 'Trust Monitor', icon: ShieldCheck, group: 'PRIVACY' },
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
    description: 'Review website access with clear, understandable controls.',
  },
  recall: {
    title: 'Web Recall',
    description: 'Find useful pages again from history and saved items.',
  },
  followups: {
    title: 'Follow-up Tracker',
    description: 'Keep renewals and important dates easy to remember.',
  },
  spaces: {
    title: 'Context Keeper',
    description: 'Bring related tabs together in named workspaces.',
  },
  trust: {
    title: 'Trust Monitor',
    description: 'A future home for BrowserTrust site activity and findings.',
  },
};

const sampleSites = [
  {
    name: 'Northstar Docs',
    domain: 'docs.northstar.dev',
    today: 8,
    week: 32,
    month: 94,
    lastVisited: 'Today, 10:42 AM',
    lastOrder: 4,
  },
  {
    name: 'GitHub',
    domain: 'github.com',
    today: 5,
    week: 24,
    month: 81,
    lastVisited: 'Today, 9:18 AM',
    lastOrder: 3,
  },
  {
    name: 'MDN Web Docs',
    domain: 'developer.mozilla.org',
    today: 3,
    week: 15,
    month: 49,
    lastVisited: 'Yesterday, 4:36 PM',
    lastOrder: 2,
  },
  {
    name: 'Linear',
    domain: 'linear.app',
    today: 1,
    week: 9,
    month: 31,
    lastVisited: 'Yesterday, 2:11 PM',
    lastOrder: 1,
  },
];

const sampleActivity = [
  { day: 'Mon', visits: 18 },
  { day: 'Tue', visits: 24 },
  { day: 'Wed', visits: 14 },
  { day: 'Thu', visits: 29 },
  { day: 'Fri', visits: 21 },
  { day: 'Sat', visits: 9 },
  { day: 'Sun', visits: 16 },
];
const sampleTodayActivity = [
  { day: '8 AM', visits: 3 },
  { day: '10 AM', visits: 8 },
  { day: '12 PM', visits: 5 },
  { day: '2 PM', visits: 7 },
  { day: '4 PM', visits: 4 },
  { day: '6 PM', visits: 2 },
];
const sampleMonthActivity = [
  { day: 'Wk 1', visits: 42 },
  { day: 'Wk 2', visits: 57 },
  { day: 'Wk 3', visits: 38 },
  { day: 'Wk 4', visits: 61 },
];

function App() {
  const [activeView, setActiveView] = useState<ViewId>('overview');
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

        <div className="workspace-switcher">
          <span className="workspace-avatar">BT</span>
          <span className="workspace-copy">
            <strong>Personal workspace</strong>
            <small>Local preview</small>
          </span>
        </div>

        <nav className="sidebar-nav" aria-label="Dashboard sections">
          {(['YOUR BROWSER', 'YOUR TOOLS', 'PRIVACY'] as const).map((group) => (
            <div className="nav-group" key={group}>
              <p className="nav-group-label">{group}</p>
              {navItems
                .filter((item) => item.group === group)
                .map(({ id, label, icon: Icon }) => (
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
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="privacy-callout">
            <ShieldCheck size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>
              <strong>Private by design</strong>
              <small>Dashboard preview runs locally.</small>
            </span>
          </div>
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
              <span className="status-dot" /> Local preview
            </span>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {activeView === 'overview'
                  ? 'YOUR BROWSER COMPANION'
                  : navItems.find((item) => item.id === activeView)?.group}
              </p>
              <h1>{current.title}</h1>
              <p className="page-description">{current.description}</p>
            </div>
          </div>
          {activeView === 'overview' ? (
            <Overview onNavigate={navigate} />
          ) : activeView === 'sites' ? (
            <SitesActivity />
          ) : (
            <FeaturePlaceholder view={activeView} onNavigate={navigate} />
          )}
          <footer className="page-footer">
            <span>BrowserTrust dashboard preview</span>
            <span>
              <span className="status-dot" /> No browsing data is connected
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
    { id: 'recall', title: 'Web Recall', description: 'Return to pages you want to keep', icon: Bookmark },
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
            This preview shows the dashboard structure. History, permissions, reminders, saved workspaces, and
            Trust Monitor data are not connected yet.
          </p>
        </div>
      </section>
    </div>
  );
}

function SitesActivity() {
  const [period, setPeriod] = useState<Period>('7 days');
  const [sortKey, setSortKey] = useState<SortKey>('visits');
  const [sortAscending, setSortAscending] = useState(false);
  const visitCount = (site: (typeof sampleSites)[number]) =>
    period === 'Today' ? site.today : period === '7 days' ? site.week : site.month;
  const sites = useMemo(
    () =>
      [...sampleSites].sort((a, b) => {
        const result =
          sortKey === 'name'
            ? a.name.localeCompare(b.name)
            : sortKey === 'lastVisited'
              ? a.lastOrder - b.lastOrder
              : visitCount(a) - visitCount(b);
        if (!sortAscending) return -result;
        return result;
      }),
    [period, sortAscending, sortKey],
  );
  const totalVisits = sampleSites.reduce((total, site) => total + visitCount(site), 0);
  const topSite = [...sampleSites].sort((a, b) => visitCount(b) - visitCount(a))[0]!;
  const activityData =
    period === 'Today' ? sampleTodayActivity : period === '30 days' ? sampleMonthActivity : sampleActivity;
  const activityScale = Math.max(...activityData.map(({ visits }) => visits));

  const selectSort = (next: SortKey) => {
    if (sortKey === next) setSortAscending(!sortAscending);
    else {
      setSortKey(next);
      setSortAscending(next === 'name');
    }
  };

  return (
    <div className="sites-view">
      <div className="preview-notice">
        <span className="notice-icon">
          <Activity size={16} aria-hidden="true" />
        </span>
        <p>
          <strong>Illustrative sample data</strong>
          <span>These values demonstrate the layout and are not from your browser history.</span>
        </p>
        <span className="sample-label">SAMPLE</span>
      </div>

      <div className="sites-toolbar">
        <div className="period-control" role="group" aria-label="Sample activity period">
          {(['Today', '7 days', '30 days'] as const).map((option) => (
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
        <span className="toolbar-caption">Sample period</span>
      </div>

      <section className="summary-grid" aria-label="Illustrative activity summary">
        <SummaryCard
          label="Recorded visits"
          value={totalVisits.toLocaleString()}
          detail={`${period} · sample`}
          icon={Activity}
        />
        <SummaryCard
          label="Unique sites"
          value={String(sampleSites.length)}
          detail="Sample sites"
          icon={Globe2}
        />
        <SummaryCard
          label="Most visited"
          value={topSite.name}
          detail={`${visitCount(topSite)} visits · sample`}
          icon={ArrowDownWideNarrow}
        />
        <SummaryCard
          label="Active browsing time"
          value="Not measured"
          detail="No time tracking is connected"
          icon={Clock3}
          subdued
        />
      </section>

      <section className="content-panel site-table-panel">
        <div className="panel-header">
          <div>
            <h2>Most-visited sites</h2>
            <p>Illustrative visit counts and last-visited times</p>
          </div>
          <span className="sample-label">SAMPLE DATA</span>
        </div>
        <div className="table-scroll">
          <table className="sites-table">
            <thead>
              <tr>
                <th scope="col">
                  <button className="sort-button" onClick={() => selectSort('name')}>
                    Site <SortGlyph active={sortKey === 'name'} ascending={sortAscending} />
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
                  <button className="sort-button" onClick={() => selectSort('lastVisited')}>
                    Last visited <SortGlyph active={sortKey === 'lastVisited'} ascending={sortAscending} />
                  </button>
                </th>
                <th scope="col">Share</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => {
                const count = visitCount(site);
                return (
                  <tr key={site.domain}>
                    <td>
                      <div className="site-cell">
                        <span className="site-favicon">{site.name.slice(0, 1)}</span>
                        <span>
                          <strong>{site.name}</strong>
                          <small>{site.domain}</small>
                        </span>
                      </div>
                    </td>
                    <td className="visits-cell">{count}</td>
                    <td className="last-visited-cell">{site.lastVisited}</td>
                    <td>
                      <div className="share-cell">
                        <span className="share-track">
                          <i style={{ width: `${Math.round((count / totalVisits) * 100)}%` }} />
                        </span>
                        <small>{Math.round((count / totalVisits) * 100)}%</small>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          Showing {sites.length} illustrative sites{' '}
          <span>
            Sorted by {sortKey === 'name' ? 'site name' : sortKey === 'visits' ? 'visits' : 'last visited'}
          </span>
        </div>
      </section>

      <div className="activity-lower-grid">
        <section className="content-panel activity-panel">
          <div className="panel-header">
            <div>
              <h2>Browsing activity</h2>
              <p>
                {period === 'Today' ? 'Hourly' : period === '30 days' ? 'Weekly' : 'Daily'} visit pattern ·
                illustrative only
              </p>
            </div>
            <span className="chart-legend">
              <i /> Sample visits
            </span>
          </div>
          <div className="activity-chart" role="img" aria-label={`Illustrative sample visits for ${period}`}>
            <div className="chart-guides">
              <i />
              <i />
              <i />
            </div>
            <div className="bar-chart">
              {activityData.map(({ day, visits }) => (
                <div className="bar-column" key={day}>
                  <div className="bar-track">
                    <i style={{ height: `${(visits / activityScale) * 100}%` }} />
                  </div>
                  <span>{day}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="chart-footnote">No real browsing activity is displayed.</div>
        </section>
        <section className="content-panel time-panel">
          <div className="panel-header">
            <div>
              <h2>Time spent</h2>
              <p>Browsing time is not available</p>
            </div>
            <Clock3 size={17} className="panel-muted-icon" aria-hidden="true" />
          </div>
          <div className="time-empty">
            <span className="time-empty-icon">
              <Clock3 size={19} aria-hidden="true" />
            </span>
            <strong>Not measured in this preview</strong>
            <p>Active tab time and focused-window time need a separate, explicit tracking implementation.</p>
          </div>
          <span className="time-footnote">Tab-open duration is not treated as attention time.</span>
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
  view: Exclude<ViewId, 'overview' | 'sites'>;
  onNavigate: (view: ViewId) => void;
}) {
  const feature: Record<
    typeof view,
    { icon: LucideIcon; title: string; description: string; rows: string[] }
  > = {
    permissions: {
      icon: ShieldCheck,
      title: 'Website permissions, made easier to review.',
      description:
        'A place to understand and manage supported site access when permission controls are implemented.',
      rows: [
        'Review supported permission states',
        'Make changes with clear explanations',
        'See what Chrome does and does not expose',
      ],
    },
    recall: {
      icon: Search,
      title: 'Find your way back to useful pages.',
      description: 'Search history and pages you explicitly save, with simple filters to narrow the results.',
      rows: ['Search page titles and URLs', 'Filter by date', 'Keep a personal saved-page list'],
    },
    followups: {
      icon: Bell,
      title: 'Keep important dates in view.',
      description: 'Add reminders and renewals yourself, then review what is coming up.',
      rows: ['Create and edit reminders', 'Track renewal dates and intervals', 'Review upcoming dates'],
    },
    spaces: {
      icon: PanelsTopLeft,
      title: 'Pick up where you left off.',
      description: 'Save related tabs into named workspaces and restore them when the time is right.',
      rows: ['Save selected tabs', 'Organize named workspaces', 'Restore a workspace later'],
    },
    trust: {
      icon: ShieldCheck,
      title: 'Evidence-backed site activity.',
      description:
        'The existing Trust Monitor remains in its current popup and activity page for now. Dashboard integration is planned for a later phase.',
      rows: [
        'Summarize observed site behavior',
        'Review findings with their evidence',
        'Understand monitoring coverage',
      ],
    },
  };
  const content = feature[view];
  const Icon = content.icon;
  return (
    <section className="feature-layout">
      <div className="feature-heading">
        <span className="feature-icon">
          <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">
            {view === 'trust' ? 'PRIVACY' : view === 'permissions' ? 'YOUR BROWSER' : 'YOUR TOOLS'}
          </p>
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
