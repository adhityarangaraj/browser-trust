import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  EyeOff,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { assessSite, type Assessment, type AssessmentState } from '../analysis/assessment';
import { summarizeDestinations } from '../analysis/destinations';
import { buildReport, reportToJson, reportToMarkdown } from '../analysis/report';
import type { Finding } from '../analysis/types';
import { isOriginCovered } from '../config/access';
import { normalizeSiteOrigin } from '../config/settings';
import { sendRequest, type StateSnapshot } from '../shared/messages';
import type { BrowserTrustEvent, EventCategory } from '../shared/types';
import './trust-monitor.css';

type Section = 'overview' | 'findings' | 'activity' | 'sites';
type LoadState = 'loading' | 'ready' | 'error';

const sections: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Security overview' },
  { id: 'findings', label: 'Findings' },
  { id: 'activity', label: 'Activity / report' },
  { id: 'sites', label: 'Sites' },
];

function assessmentLabel(state: AssessmentState): string {
  switch (state) {
    case 'insufficient-evidence': return 'Insufficient evidence';
    case 'no-suspicious-activity-observed': return 'No suspicious activity observed';
    case 'review-recommended': return 'Review recommended';
    case 'suspicious-activity-detected': return 'Suspicious activity detected';
  }
}

function assessmentIcon(state: AssessmentState) {
  if (state === 'no-suspicious-activity-observed') return CheckCircle2;
  if (state === 'review-recommended') return AlertTriangle;
  if (state === 'suspicious-activity-detected') return ShieldAlert;
  return CircleHelp;
}

function severityLabel(severity: Finding['severity']): string {
  return severity === 'info' ? 'Informational' : severity;
}

function eventLabel(event: BrowserTrustEvent): string {
  const labels: Record<string, string> = {
    'page.loaded': 'Page loaded', 'element.added': 'Page element added',
    'form.field_edited': 'Form field edited', 'form.submitted': 'Form submitted',
    'form.submit_called': 'Script submitted a form', 'request.sent': 'Network request observed',
    'request.completed': 'Network request completed', 'request.failed': 'Network request failed',
    'storage.write': 'Browser storage write', 'storage.read': 'Browser storage read',
    'storage.remove': 'Browser storage item removed', 'storage.clear': 'Browser storage cleared',
    'cookie.read': 'Cookie read API called', 'cookie.write': 'Cookie write API called',
    'geolocation.requested': 'Geolocation API called', 'clipboard.read': 'Clipboard read API called',
    'media.requested': 'Media capture API called', 'clipboard.write': 'Clipboard write API called',
  };
  return labels[event.action] ?? event.action.replaceAll('.', ' ');
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function originHost(origin: string): string {
  try { return new URL(origin).host; } catch { return origin; }
}

function safeOrigin(value: string): string | undefined {
  return normalizeSiteOrigin(value);
}

export function TrustMonitor() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<StateSnapshot>();
  const [events, setEvents] = useState<BrowserTrustEvent[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [section, setSection] = useState<Section>('overview');
  const [selectedOrigin, setSelectedOrigin] = useState('');
  const [showIgnored, setShowIgnored] = useState(false);
  const [search, setSearch] = useState('');
  const [disabledCategories, setDisabledCategories] = useState<EventCategory[]>([]);
  const [notice, setNotice] = useState('');

  const refresh = async () => {
    setLoadState('loading');
    setError('');
    try {
      const [nextSnapshot, nextEvents, nextFindings] = await Promise.all([
        sendRequest<'get-state'>({ type: 'get-state' }),
        sendRequest<'list-events'>({ type: 'list-events', limit: 1000 }),
        sendRequest<'list-findings'>({ type: 'list-findings', limit: 500 }),
      ]);
      setSnapshot(nextSnapshot);
      setEvents(nextEvents);
      setFindings(nextFindings);
      setSelectedOrigin((current) => current || safeOrigin(nextEvents[0]?.source.origin ?? '') || nextSnapshot.settings.ignoredOrigins[0] || '');
      setLoadState('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setLoadState('error');
    }
  };

  useEffect(() => { void refresh(); }, []);

  const sites = useMemo(() => {
    const lastSeen = new Map<string, number>();
    for (const event of events) {
      const origin = safeOrigin(event.source.origin);
      if (origin) lastSeen.set(origin, Math.max(lastSeen.get(origin) ?? 0, event.timestamp));
    }
    for (const origin of snapshot?.settings.ignoredOrigins ?? []) {
      if (!lastSeen.has(origin)) lastSeen.set(origin, 0);
    }
    return [...lastSeen].map(([origin, timestamp]) => ({ origin, timestamp }))
      .sort((a, b) => b.timestamp - a.timestamp || a.origin.localeCompare(b.origin));
  }, [events, snapshot]);

  const selectedEvents = useMemo(() => events.filter((event) => event.source.origin === selectedOrigin), [events, selectedOrigin]);
  const assessment: Assessment | undefined = useMemo(() => {
    if (!snapshot || !selectedOrigin) return undefined;
    return assessSite(events, findings, {
      origin: selectedOrigin,
      monitoringEnabled: snapshot.settings.monitoringEnabled,
      siteAccessGranted: isOriginCovered(selectedOrigin, snapshot.grantedOrigins),
      contentScriptRegistered: snapshot.contentScriptRegistered,
      collectors: snapshot.collectors,
    });
  }, [snapshot, events, findings, selectedOrigin]);

  const ignored = snapshot?.settings.ignoredOrigins.includes(selectedOrigin) ?? false;
  const visibleSites = sites.filter((site) => showIgnored || !snapshot?.settings.ignoredOrigins.includes(site.origin));
  const destinations = useMemo(() => summarizeDestinations(selectedEvents), [selectedEvents]);
  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...selectedEvents].sort((a, b) => b.timestamp - a.timestamp).filter((event) => {
      if (disabledCategories.includes(event.category)) return false;
      if (!query) return true;
      return [event.action, event.source.origin, event.destination?.host, event.evidence.collector,
        event.evidence.mechanism, eventLabel(event)].some((value) => value?.toLowerCase().includes(query));
    });
  }, [selectedEvents, search, disabledCategories]);
  const categories = useMemo(() => [...new Set(selectedEvents.map((event) => event.category))].sort(), [selectedEvents]);

  async function toggleIgnored() {
    if (!snapshot || !selectedOrigin) return;
    try {
      const next = await sendRequest<'set-site-ignored'>({ type: 'set-site-ignored', origin: selectedOrigin, ignored: !ignored });
      setSnapshot(next);
      setNotice(ignored
        ? `${originHost(selectedOrigin)} is back in the overview attention list.`
        : `${originHost(selectedOrigin)} is hidden from the overview attention list. Monitoring and history are unchanged.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function copyReport() {
    if (!assessment || !snapshot || !selectedOrigin) return;
    const report = buildReport(selectedEvents, assessment.findings, destinations, assessment, {
      host: originHost(selectedOrigin), monitoringEnabled: snapshot.settings.monitoringEnabled,
      coverageGranted: isOriginCovered(selectedOrigin, snapshot.grantedOrigins),
    });
    try {
      await navigator.clipboard.writeText(reportToMarkdown(report));
      setNotice('Site report copied to the clipboard.');
    } catch {
      setError('The report could not be copied. Check clipboard access and try again.');
    }
  }

  async function clearActivity() {
    if (!window.confirm('Clear all BrowserTrust events, findings, and finding pins/dismissals? This also clears the popup and Activity page data.')) return;
    try {
      await sendRequest<'clear-events'>({ type: 'clear-events' });
      setSearch('');
      setDisabledCategories([]);
      setNotice('BrowserTrust activity and findings were cleared. Site access and ignored-site settings were kept.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function downloadReport() {
    if (!assessment || !snapshot || !selectedOrigin) return;
    const report = buildReport(selectedEvents, assessment.findings, destinations, assessment, {
      host: originHost(selectedOrigin), monitoringEnabled: snapshot.settings.monitoringEnabled,
      coverageGranted: isOriginCovered(selectedOrigin, snapshot.grantedOrigins),
    });
    const url = URL.createObjectURL(new Blob([reportToJson(report)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `browsertrust-${originHost(selectedOrigin).replaceAll(/[^a-z0-9.-]/gi, '-')}-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice('Site report downloaded.');
  }

  return (
    <section className="trust-monitor" aria-label="Trust Monitor">
      <div className="trust-toolbar">
        <nav className="trust-tabs" aria-label="Trust Monitor views">
          {sections.map((item) => <button key={item.id} className={section === item.id ? 'trust-tab active' : 'trust-tab'}
            aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}>{item.label}</button>)}
        </nav>
        <button className="secondary-button trust-refresh" onClick={() => void refresh()} disabled={loadState === 'loading'}>
          <RefreshCw size={15} aria-hidden="true" /> Refresh
        </button>
      </div>

      {error && <div className="trust-error" role="alert">{error}</div>}
      {notice && <p className="trust-notice" role="status">{notice}<button className="trust-dismiss" onClick={() => setNotice('')} aria-label="Dismiss">×</button></p>}
      {loadState === 'loading' && <div className="trust-empty">Loading locally stored activity…</div>}
      {loadState === 'error' && <div className="trust-empty"><p>Trust Monitor could not load its local data.</p><button className="primary-button" onClick={() => void refresh()}>Try again</button></div>}
      {loadState === 'ready' && (!sites.length ? <EmptyTrustState monitoringEnabled={snapshot?.settings.monitoringEnabled ?? false} /> : (
        <>
          <div className="trust-site-select">
            <label htmlFor="trust-site">Site assessment</label>
            <select id="trust-site" value={selectedOrigin} onChange={(event) => setSelectedOrigin(event.target.value)}>
              {sites.map((site) => <option key={site.origin} value={site.origin}>{originHost(site.origin)}{snapshot?.settings.ignoredOrigins.includes(site.origin) ? ' · ignored' : ''}</option>)}
            </select>
            {selectedOrigin && <button className="secondary-button" onClick={() => void toggleIgnored()}>
              <EyeOff size={15} aria-hidden="true" /> {ignored ? 'Unignore site' : 'Ignore site'}
            </button>}
          </div>
          {ignored && <div className="trust-ignored-note"><EyeOff size={15} aria-hidden="true" /> This site is hidden from the overview attention list. BrowserTrust continues monitoring it, retaining its events, and showing its findings here.</div>}
          {section === 'overview' && assessment && <OverviewPanel assessment={assessment} ignored={ignored} sites={visibleSites} onSelect={(origin) => { setSelectedOrigin(origin); setSection('sites'); }} destinations={destinations} onNavigate={setSection} />}
          {section === 'findings' && assessment && <FindingsPanel findings={assessment.findings} events={selectedEvents} origin={selectedOrigin} onShowActivity={() => setSection('activity')} />}
          {section === 'activity' && assessment && <ActivityPanel events={filteredEvents} total={selectedEvents.length} search={search} onSearch={setSearch}
            disabledCategories={disabledCategories} categories={categories} onToggleCategory={(value) => setDisabledCategories((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} findings={assessment.findings} destinations={destinations}
            monitoringEnabled={snapshot?.settings.monitoringEnabled ?? false} coverageGranted={isOriginCovered(selectedOrigin, snapshot?.grantedOrigins ?? [])}
            onCopy={() => void copyReport()} onDownload={downloadReport} onClear={() => void clearActivity()} />}
          {section === 'sites' && assessment && <SiteDetail origin={selectedOrigin} assessment={assessment} events={selectedEvents} findings={assessment.findings} destinations={destinations}
            sites={visibleSites} showIgnored={showIgnored} onShowIgnored={setShowIgnored} onSelect={setSelectedOrigin} />}
        </>
      ))}
    </section>
  );
}

function EmptyTrustState({ monitoringEnabled }: { monitoringEnabled: boolean }) {
  return <div className="trust-empty-state"><ShieldCheck size={30} aria-hidden="true" />
    <h2>No site activity recorded yet</h2>
    <p>{monitoringEnabled
      ? 'Grant BrowserTrust access to a website from the extension popup, then visit or reload that site to begin collecting supported activity.'
      : 'Monitoring is paused. Turn it on in the extension popup and grant access to a website to begin.'}</p>
    <p className="trust-footnote">BrowserTrust only observes sites you allow. Existing popup and activity views remain available.</p>
  </div>;
}

function OverviewPanel({ assessment, ignored, sites, onSelect, destinations, onNavigate }: {
  assessment: Assessment; ignored: boolean; sites: { origin: string; timestamp: number }[];
  onSelect: (origin: string) => void; destinations: ReturnType<typeof summarizeDestinations>; onNavigate: (section: Section) => void;
}) {
  const Icon = assessmentIcon(assessment.state);
  return <div className="trust-content">
    <div className={`trust-assessment state-${assessment.state}`}>
      <div className="trust-assessment-icon"><Icon size={19} aria-hidden="true" /></div>
      <div className="trust-assessment-copy"><p className="trust-kicker">{ignored ? 'Ignored site · assessment unchanged' : 'Current site assessment'}</p>
        <h2>{assessmentLabel(assessment.state)}</h2><p>{assessment.explanation}</p></div>
      <div className="trust-counts"><span><strong>{assessment.eventCount}</strong> observations</span><span><strong>{assessment.findingCount}</strong> findings</span></div>
    </div>
    <div className="trust-section-heading"><div><h2>Observed destinations</h2><p>Network metadata recorded for this site.</p></div><button className="text-button" onClick={() => onNavigate('activity')}>View activity <ExternalLink size={14} aria-hidden="true" /></button></div>
    {destinations.length ? <DestinationTable destinations={destinations.slice(0, 8)} /> : <p className="trust-inline-empty">No network destinations recorded for this site.</p>}
    <div className="trust-section-heading trust-sites-heading"><div><h2>Sites in Trust Monitor</h2><p>Ignored sites stay recorded and can be reopened here.</p></div><button className="text-button" onClick={() => onNavigate('sites')}>All sites</button></div>
    {sites.length ? <SiteList sites={sites.slice(0, 8)} onSelect={onSelect} /> : <p className="trust-inline-empty">No sites in the attention list.</p>}
  </div>;
}

function FindingsPanel({ findings, events, origin, onShowActivity }: { findings: Finding[]; events: BrowserTrustEvent[]; origin: string; onShowActivity: () => void }) {
  if (!findings.length) return <div className="trust-empty-state compact"><ShieldCheck size={28} aria-hidden="true" /><h2>No findings for {originHost(origin)}</h2>
    <p>{events.length ? 'The existing deterministic rules did not produce a finding from the recorded events. This is not proof that the site is safe.' : 'No events are recorded for this site yet.'}</p>
    <button className="secondary-button" onClick={onShowActivity}>Review activity</button></div>;
  return <div className="trust-content"><div className="trust-section-heading"><div><h2>Findings for {originHost(origin)}</h2><p>Deterministic findings with supporting evidence and stated limitations.</p></div><span>{findings.length} total</span></div>
    <ul className="trust-finding-list">{[...findings].sort((a, b) => b.timestamp - a.timestamp).map((finding) => <FindingRow key={finding.id} finding={finding} events={events} />)}</ul>
  </div>;
}

function FindingRow({ finding, events }: { finding: Finding; events: BrowserTrustEvent[] }) {
  const byId = new Map(events.map((event) => [event.id, event]));
  return <li className="trust-finding"><div className="trust-finding-head"><span className={`trust-severity severity-${finding.severity}`}>{severityLabel(finding.severity)}</span>
    <div><h3>{finding.title}</h3><p>{finding.explanation}</p></div><time dateTime={new Date(finding.timestamp).toISOString()}>{formatDate(finding.timestamp)}</time></div>
    <details><summary>Evidence and limitations</summary><div className="trust-evidence"><strong>Supporting events</strong>
      <ul>{finding.eventIds.map((id, index) => { const event = byId.get(id); const ts = finding.eventTimestamps[index] ?? event?.timestamp; return <li key={`${id}-${index}`}><code>{id}</code>{ts ? <time dateTime={new Date(ts).toISOString()}>{formatDate(ts)}</time> : null}{event ? <span>{eventLabel(event)} · {event.evidence.mechanism}</span> : <span>Event not in the retained event list</span>}</li>; })}</ul>
      <strong>Evidence strength</strong><p>{finding.evidenceStrength.replaceAll('-', ' ')}</p>
      {finding.limitations.length > 0 && <><strong>What this does not establish</strong><ul>{finding.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></>}
    </div></details>
  </li>;
}

function ActivityPanel({ events, total, search, onSearch, disabledCategories, categories, onToggleCategory, findings, destinations, monitoringEnabled, coverageGranted, onCopy, onDownload, onClear }: {
  events: BrowserTrustEvent[]; total: number; search: string; onSearch: (value: string) => void;
  disabledCategories: EventCategory[]; categories: EventCategory[]; onToggleCategory: (value: EventCategory) => void;
  findings: Finding[]; destinations: ReturnType<typeof summarizeDestinations>; monitoringEnabled: boolean; coverageGranted: boolean;
  onCopy: () => void; onDownload: () => void; onClear: () => void;
}) {
  return <div className="trust-content"><div className="trust-section-heading"><div><h2>Activity / report</h2><p>Same retained event records used by the popup and activity page.</p></div>
    <div className="trust-report-actions"><button className="secondary-button" onClick={onCopy}>Copy report</button><button className="secondary-button" onClick={onDownload}>Download JSON</button><button className="trust-clear-button" onClick={onClear}><Trash2 size={14} aria-hidden="true"/> Clear activity</button></div></div>
    <div className="trust-report-summary"><span><strong>{total}</strong> observations</span><span><strong>{destinations.length}</strong> destinations</span><span><strong>{findings.length}</strong> findings</span><span>{monitoringEnabled ? 'Monitoring enabled' : 'Monitoring paused'} · {coverageGranted ? 'site access granted' : 'site access missing'}</span></div>
    <div className="trust-subheading"><h3>Destinations</h3></div>{destinations.length ? <DestinationTable destinations={destinations} /> : <p className="trust-inline-empty">No network destinations observed for this site.</p>}
    <div className="trust-subheading"><h3>Activity timeline</h3><span>{events.length} shown · {total} retained for this site</span></div>
    <div className="trust-filter-bar"><label><Search size={15} aria-hidden="true"/><input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search activity" aria-label="Search activity" /></label></div>
    <div className="trust-category-filters" role="group" aria-label="Filter activity categories">{categories.map((value) => {
      const enabled = !disabledCategories.includes(value);
      return <button type="button" key={value} className={enabled ? 'trust-filter-chip active' : 'trust-filter-chip'} aria-pressed={enabled} onClick={() => onToggleCategory(value)}>{value}</button>;
    })}</div>
    {events.length ? <ol className="trust-timeline">{events.map((event) => <li key={event.id}><span className="trust-timeline-dot" aria-hidden="true"/><div><div className="trust-event-head"><strong>{eventLabel(event)}</strong><time dateTime={new Date(event.timestamp).toISOString()}>{formatDate(event.timestamp)}</time></div>
      <p>{event.action}{event.destination?.host ? ` · ${event.destination.host}` : ''}</p><div className="trust-event-meta"><code>{event.id}</code><span>{event.category}</span><span>{event.provenance}</span><span>{event.evidence.mechanism} · {event.evidence.collector}</span></div>
      {event.relatedEventIds?.length ? <p className="trust-related">Related evidence: {event.relatedEventIds.join(', ')}</p> : null}</div></li>)}</ol>
      : <p className="trust-inline-empty">{total ? 'No activity matches these filters.' : 'No activity recorded for this site.'}</p>}
    <div className="trust-report-footnote">Report content is built from locally retained, sanitized BrowserTrust records. Event order and timestamps reflect the existing event pipeline.</div>
  </div>;
}

function SiteDetail({ origin, assessment, events, findings, destinations, sites, showIgnored, onShowIgnored, onSelect }: {
  origin: string; assessment: Assessment; events: BrowserTrustEvent[]; findings: Finding[]; destinations: ReturnType<typeof summarizeDestinations>;
  sites: { origin: string; timestamp: number }[]; showIgnored: boolean; onShowIgnored: (value: boolean) => void; onSelect: (origin: string) => void;
}) {
  const Icon = assessmentIcon(assessment.state);
  return <div className="trust-content"><div className="trust-section-heading"><div><h2>{originHost(origin)}</h2><p>Assessment and retained evidence for this observed origin.</p></div><span className="trust-site-access">{assessment.state === 'insufficient-evidence' ? 'Coverage may be incomplete' : 'Observed'}</span></div>
    <div className={`trust-assessment compact state-${assessment.state}`}><Icon size={18} aria-hidden="true"/><div><strong>{assessmentLabel(assessment.state)}</strong><p>{assessment.explanation}</p></div></div>
    <div className="trust-report-summary"><span><strong>{events.length}</strong> observations</span><span><strong>{findings.length}</strong> findings</span><span><strong>{destinations.length}</strong> destinations</span></div>
    <div className="trust-subheading"><h3>Findings</h3></div>{findings.length ? <ul className="trust-finding-list">{[...findings].sort((a, b) => b.timestamp - a.timestamp).map((finding) => <FindingRow key={finding.id} finding={finding} events={events} />)}</ul> : <p className="trust-inline-empty">No findings are linked to this site's retained events.</p>}
    <div className="trust-subheading"><h3>Destinations</h3></div>{destinations.length ? <DestinationTable destinations={destinations} /> : <p className="trust-inline-empty">No destinations recorded.</p>}
    <div className="trust-section-heading"><div><h2>Observed sites</h2><p>Ignored sites remain available here and keep their local history.</p></div>
      <button className="text-button" aria-pressed={showIgnored} onClick={() => onShowIgnored(!showIgnored)}>{showIgnored ? 'Hide ignored sites' : 'Show ignored sites'}</button></div>
    {sites.length ? <SiteList sites={sites} onSelect={onSelect} /> : <p className="trust-inline-empty">No sites in this list. Show ignored sites to review hidden entries.</p>}
  </div>;
}

function SiteList({ sites, onSelect }: { sites: { origin: string; timestamp: number }[]; onSelect: (origin: string) => void }) {
  return <ul className="trust-site-list">{sites.map((site) => <li key={site.origin}><button onClick={() => onSelect(site.origin)}><span><GlobeLabel />{originHost(site.origin)}</span><span>{site.timestamp ? formatDate(site.timestamp) : 'No retained observations'}</span><span>View assessment <ArrowRight size={14} aria-hidden="true" /></span></button></li>)}</ul>;
}

function GlobeLabel() { return <ShieldCheck size={16} aria-hidden="true" />; }

function DestinationTable({ destinations }: { destinations: ReturnType<typeof summarizeDestinations> }) {
  return <div className="trust-table-wrap"><table className="trust-table"><thead><tr><th>Destination</th><th>Requests</th><th>Methods</th><th>Evidence</th><th>Latest</th></tr></thead><tbody>
    {destinations.map((destination) => <tr key={destination.host}><td><strong>{destination.host}</strong>{destination.anyThirdParty && <span className="trust-third-party">Third party</span>}</td>
      <td>{destination.observationCount}{destination.statusCodes.length ? <small>Status {destination.statusCodes.join(', ')}</small> : null}{destination.errorCount ? <small>{destination.errorCount} failed</small> : null}</td>
      <td>{destination.methods.join(', ') || '—'}</td><td>{destination.sources.join(', ')}</td><td>{formatDate(destination.lastObservedAt)}</td></tr>)}
  </tbody></table></div>;
}
