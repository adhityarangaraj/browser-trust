import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

type ViewId =
  'overview' | 'sites' | 'permissions' | 'recall' | 'followups' | 'spaces' | 'screen-time' | 'trust';
type NavItem = { id: ViewId; label: string; icon: string; group: string };

const navItems: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: '⌂', group: 'YOUR BROWSER' },
  { id: 'sites', label: 'Site overview', icon: '◉', group: 'YOUR BROWSER' },
  { id: 'permissions', label: 'Permissions', icon: '◇', group: 'YOUR BROWSER' },
  { id: 'recall', label: 'Web recall', icon: '⌕', group: 'YOUR TOOLS' },
  { id: 'followups', label: 'Follow-up tracker', icon: '◷', group: 'YOUR TOOLS' },
  { id: 'spaces', label: 'Context keeper', icon: '▤', group: 'YOUR TOOLS' },
  { id: 'screen-time', label: 'Screen time', icon: '◷', group: 'YOUR TOOLS' },
  { id: 'trust', label: 'Trust monitor', icon: '◈', group: 'PRIVACY' },
];

const viewCopy: Record<ViewId, { title: string; subtitle: string; eyebrow: string }> = {
  overview: {
    title: 'Your browser, at a glance',
    subtitle: 'A calmer home for the things you do on the web.',
    eyebrow: 'PERSONAL DASHBOARD',
  },
  sites: {
    title: 'Site overview',
    subtitle: 'Get a clearer picture of the sites you visit most.',
    eyebrow: 'YOUR BROWSER',
  },
  permissions: {
    title: 'Permission manager',
    subtitle: 'Review the access websites can ask your browser to grant.',
    eyebrow: 'YOUR BROWSER',
  },
  recall: {
    title: 'Web recall',
    subtitle: 'Find your way back to pages and ideas you saved.',
    eyebrow: 'YOUR TOOLS',
  },
  followups: {
    title: 'Follow-up tracker',
    subtitle: 'Keep renewals and important dates from slipping by.',
    eyebrow: 'YOUR TOOLS',
  },
  spaces: {
    title: 'Context keeper',
    subtitle: 'Save the tabs that belong together, ready for later.',
    eyebrow: 'YOUR TOOLS',
  },
  'screen-time': {
    title: 'Screen time',
    subtitle: 'Understand time spent with your browser in focus.',
    eyebrow: 'YOUR TOOLS',
  },
  trust: {
    title: 'Trust monitor',
    subtitle: 'A future home for BrowserTrust’s evidence-backed site activity.',
    eyebrow: 'PRIVACY',
  },
};

function App() {
  const [active, setActive] = useState<ViewId>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const current = viewCopy[active];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#overview" onClick={() => setActive('overview')}>
          <span className="brand-mark">b</span>
          <span className="brand-name">
            browser<span>trust</span>
          </span>
        </a>
        <div className="profile-card">
          <div className="avatar">Y</div>
          <div>
            <strong>Your browser</strong>
            <span>Personal space</span>
          </div>
          <span className="profile-chevron">⌄</span>
        </div>
        <nav aria-label="Dashboard sections">
          {(['YOUR BROWSER', 'YOUR TOOLS', 'PRIVACY'] as const).map((group) => (
            <div className="nav-group" key={group}>
              <p className="nav-label">{group}</p>
              {navItems
                .filter((item) => item.group === group)
                .map((item) => (
                  <button
                    className={`nav-item ${active === item.id ? 'active' : ''}`}
                    key={item.id}
                    onClick={() => {
                      setActive(item.id);
                      setMenuOpen(false);
                    }}
                    aria-current={active === item.id ? 'page' : undefined}
                  >
                    <span className="nav-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    {item.label}
                    {item.id === 'trust' && <span className="nav-soon">NEW</span>}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <span>✳</span>
            <p>
              <strong>Private by design</strong>
              <br />
              Your dashboard stays on this device.
            </p>
          </div>
          <span className="version">BROWSERTRUST · PREVIEW</span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            ☰
          </button>
          <div className="breadcrumb">
            <span>BrowserTrust</span>
            <span className="crumb-slash">/</span>
            <strong>{navItems.find((item) => item.id === active)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <i /> LOCAL PREVIEW
            </span>
            <button className="help-button" aria-label="About this preview">
              ?
            </button>
          </div>
        </header>

        <div className="page-content">
          <section className="page-heading">
            <div>
              <p className="eyebrow">{current.eyebrow}</p>
              <h1>{current.title}</h1>
              <p className="page-subtitle">{current.subtitle}</p>
            </div>
            <div className="date-chip">
              <span>◷</span> Today
            </div>
          </section>
          {active === 'overview' ? <Overview onNavigate={setActive} /> : <FeatureView id={active} />}
          <footer className="page-footer">
            <span>Made for a more mindful web.</span>
            <span>
              <i className="footer-dot" /> All information stays on your device
            </span>
          </footer>
        </div>
      </main>
      {menuOpen && (
        <button className="scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />
      )}
    </div>
  );
}

function Overview({ onNavigate }: { onNavigate: (id: ViewId) => void }) {
  return (
    <>
      <section className="welcome-card">
        <div className="welcome-copy">
          <span className="sun-icon">✳</span>
          <p className="welcome-kicker">A LITTLE MORE CLARITY</p>
          <h2>
            Make the web feel
            <br />a little more like yours.
          </h2>
          <p>
            Your personal browser companion is taking shape. Start with a space that brings your everyday web
            life together.
          </p>
          <button className="primary-button" onClick={() => onNavigate('sites')}>
            Explore your browser <span>→</span>
          </button>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-spark spark-one">✳</div>
          <div className="art-spark spark-two">✦</div>
          <div className="browser-window">
            <div className="window-top">
              <b />
              <b />
              <b />
              <span />
            </div>
            <div className="window-content">
              <div className="window-sidebar">
                <i />
                <i />
                <i />
              </div>
              <div className="window-lines">
                <i />
                <i />
                <i />
                <div className="window-card" />
                <i />
                <i />
              </div>
            </div>
          </div>
          <div className="floating-stamp">
            ✦ <span>your space</span>
          </div>
        </div>
      </section>

      <div className="section-title">
        <div>
          <p className="eyebrow">YOUR PERSONAL SPACE</p>
          <h2>A few things to get started</h2>
        </div>
        <span className="sample-tag">PREVIEW CONTENT</span>
      </div>
      <section className="stats-grid" aria-label="Dashboard preview cards">
        <MetricCard
          icon="◉"
          tone="coral"
          label="Your sites"
          value="A fresh start"
          detail="See your browsing patterns"
          action="View site overview"
          onClick={() => onNavigate('sites')}
        />
        <MetricCard
          icon="◇"
          tone="lavender"
          label="Permissions"
          value="In your hands"
          detail="Review site access"
          action="Explore permissions"
          onClick={() => onNavigate('permissions')}
        />
        <MetricCard
          icon="⌕"
          tone="mint"
          label="Web recall"
          value="Find it again"
          detail="Bring useful pages back"
          action="Open web recall"
          onClick={() => onNavigate('recall')}
        />
      </section>

      <section className="lower-grid">
        <div className="panel focus-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">A MOMENT TO RESET</p>
              <h2>Your day, at your pace</h2>
            </div>
            <span className="sample-tag">ILLUSTRATIVE</span>
          </div>
          <div className="focus-content">
            <div className="focus-illustration">
              <div className="focus-sun">☼</div>
              <div className="focus-hill hill-back" />
              <div className="focus-hill hill-front" />
              <div className="focus-star">✦</div>
            </div>
            <div className="focus-message">
              <span className="focus-time">A GOOD PLACE TO BEGIN</span>
              <p>
                Small steps make a thoughtful web life. Your personal tools will be ready here as they arrive.
              </p>
              <button className="text-button" onClick={() => onNavigate('followups')}>
                See what’s coming <span>→</span>
              </button>
            </div>
          </div>
        </div>
        <div className="panel upcoming-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">UP NEXT</p>
              <h2>Keep it all together</h2>
            </div>
            <button
              className="circle-arrow"
              aria-label="Open Context Keeper"
              onClick={() => onNavigate('spaces')}
            >
              ↗
            </button>
          </div>
          <p className="upcoming-copy">Gather tabs, save a thought, or set a reminder for later.</p>
          <div className="upcoming-list">
            <button onClick={() => onNavigate('spaces')}>
              <span className="up-icon blue">▤</span>
              <span>
                <strong>Context Keeper</strong>
                <small>Workspaces for your open tabs</small>
              </span>
              <b>→</b>
            </button>
            <button onClick={() => onNavigate('followups')}>
              <span className="up-icon yellow">◷</span>
              <span>
                <strong>Follow-up Tracker</strong>
                <small>Dates worth remembering</small>
              </span>
              <b>→</b>
            </button>
          </div>
        </div>
      </section>
      <section className="trust-strip">
        <div className="shield-icon">◈</div>
        <div>
          <strong>Trust Monitor, thoughtfully integrated.</strong>
          <p>Your existing site activity tools will have a home here when they’re ready.</p>
        </div>
        <button className="text-button" onClick={() => onNavigate('trust')}>
          Take a look <span>→</span>
        </button>
      </section>
    </>
  );
}

function MetricCard({
  icon,
  tone,
  label,
  value,
  detail,
  action,
  onClick,
}: {
  icon: string;
  tone: string;
  label: string;
  value: string;
  detail: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span className={`metric-icon ${tone}`}>{icon}</span>
        <span className="sample-tag">SAMPLE</span>
      </div>
      <p className="metric-label">{label}</p>
      <h3>{value}</h3>
      <p className="metric-detail">{detail}</p>
      <button className="card-link" onClick={onClick}>
        {action}
        <span>→</span>
      </button>
    </article>
  );
}

const featureContent: Record<
  Exclude<ViewId, 'overview'>,
  { icon: string; accent: string; intro: string; bullets: string[]; label: string }
> = {
  sites: {
    icon: '◉',
    accent: 'coral',
    intro: 'A simple overview of your most visited places, with visit patterns and details you can explore.',
    bullets: ['Frequently visited sites', 'Visit counts and last-visited dates', 'Search and site details'],
    label: 'SITE OVERVIEW',
  },
  permissions: {
    icon: '◇',
    accent: 'lavender',
    intro: 'A clear place to review supported website permissions and make changes when you choose.',
    bullets: [
      'Permission categories where supported',
      'Current permission states',
      'Evidence-based review suggestions',
    ],
    label: 'PERMISSION MANAGER',
  },
  recall: {
    icon: '⌕',
    accent: 'mint',
    intro: 'Search your browser history and pages you explicitly save to find useful things again.',
    bullets: ['Search titles and URLs', 'Filter by date', 'Keep a personal saved-page list'],
    label: 'WEB RECALL',
  },
  followups: {
    icon: '◷',
    accent: 'yellow',
    intro: 'Keep track of renewals and reminders you add, with dates that are easy to review.',
    bullets: [
      'Add a service and reminder date',
      'See what’s coming up',
      'Choose a billing interval and amount',
    ],
    label: 'FOLLOW-UP TRACKER',
  },
  spaces: {
    icon: '▤',
    accent: 'blue',
    intro: 'Save a set of tabs as a named workspace and pick it back up when you’re ready.',
    bullets: ['Save selected tabs', 'Organize named workspaces', 'Restore a workspace later'],
    label: 'CONTEXT KEEPER',
  },
  'screen-time': {
    icon: '◷',
    accent: 'lavender',
    intro: 'A careful view of time while the browser window is focused or a tab is active.',
    bullets: ['Daily and weekly summaries', 'Focused-window time', 'Active-tab time'],
    label: 'SCREEN TIME',
  },
  trust: {
    icon: '◈',
    accent: 'coral',
    intro: 'Your existing BrowserTrust monitor will be brought into this dashboard in a later phase.',
    bullets: [
      'Evidence-backed site findings',
      'Observed destinations and activity',
      'Monitoring controls and per-site preferences',
    ],
    label: 'TRUST MONITOR',
  },
};

function FeatureView({ id }: { id: Exclude<ViewId, 'overview'> }) {
  const feature = featureContent[id];
  return (
    <section className="feature-layout">
      <article className="feature-intro panel">
        <div className={`feature-symbol ${feature.accent}`}>{feature.icon}</div>
        <p className="eyebrow">{feature.label}</p>
        <h2>
          A more thoughtful way
          <br />
          to{' '}
          {id === 'recall'
            ? 'find your way back'
            : id === 'trust'
              ? 'understand site activity'
              : feature.label.toLowerCase()}
          .
        </h2>
        <p>{feature.intro}</p>
        <div className="coming-pill">
          <span /> Foundation preview · feature not connected yet
        </div>
      </article>
      <div className="feature-detail panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">WHAT THIS SPACE IS FOR</p>
            <h2>Designed around you</h2>
          </div>
          <span className="sample-tag">PLACEHOLDER</span>
        </div>
        <ul className="feature-list">
          {feature.bullets.map((item, index) => (
            <li key={item}>
              <span className="list-number">0{index + 1}</span>
              <span>{item}</span>
              <span className="list-check">✦</span>
            </li>
          ))}
        </ul>
        <div className="empty-state">
          <span className="empty-spark">✳</span>
          <strong>Your space is ready to grow</strong>
          <p>This is a preview of the dashboard layout. No browser data is being read or shown here yet.</p>
        </div>
      </div>
    </section>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Dashboard root element is missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
