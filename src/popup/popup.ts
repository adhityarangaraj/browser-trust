import { assessSite, type AssessmentState } from '../analysis/assessment';
import { summarizeDestinations } from '../analysis/destinations';
import { buildReport, reportToJson, reportToMarkdown, type Report } from '../analysis/report';
import type { Finding } from '../analysis/types';
import { ALL_SITES_PATTERNS, analyzeUrl, isOriginCovered } from '../config/access';
import { sendRequest, type StateSnapshot } from '../shared/messages';
import type { BrowserTrustEvent } from '../shared/types';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

const toggle = el<HTMLInputElement>('monitoring-toggle');
const monitoringStatus = el('monitoring-status');
const errorBox = el('error-box');
const assessmentCard = el('assessment-card');
const assessmentTitle = el('assessment-title');
const assessmentExplanation = el('assessment-explanation');
const siteHost = el('site-host');
const siteStatus = el('site-status');
const allowSite = el<HTMLButtonElement>('allow-site');
const removeSite = el<HTMLButtonElement>('remove-site');
const allowAll = el<HTMLButtonElement>('allow-all');
const collectorsList = el('collectors-list');
const enablePermissions = el<HTMLButtonElement>('enable-permissions');
const eventCount = el('event-count');
const networkCount = el('network-count');
const findingCount = el('finding-count');
const findingsEmpty = el('findings-empty');
const findingsList = el('findings-list');
const destinationsEmpty = el('destinations-empty');
const destinationsList = el('destinations-list');
const eventsEmpty = el('events-empty');
const eventsList = el('events-list');
const clearEvents = el<HTMLButtonElement>('clear-events');
const refreshButton = el<HTMLButtonElement>('refresh');
const refreshStatus = el('refresh-status');
const copyReportButton = document.getElementById('copy-report') as HTMLButtonElement | null;
const downloadReportButton = document.getElementById('download-report') as HTMLButtonElement | null;
const behaviorList = el('behavior-list');
const activityLink = document.querySelector<HTMLAnchorElement>('.view-activity');
const activityPage = document.body.dataset.page === 'activity';
const eventsSearchInput = document.getElementById('events-search') as HTMLInputElement | null;
const eventsCategoryFilters = document.getElementById('events-category-filters');

const TIMELINE_CATEGORIES: readonly string[] = ['page', 'dom', 'form', 'storage', 'network', 'capability'];
const timelineCategoryEnabled = new Map<string, boolean>(
  TIMELINE_CATEGORIES.map((category) => [category, true]),
);
let timelineSearchQuery = '';
let timelineAllEvents: BrowserTrustEvent[] = [];
let flashResetTimer: number | undefined;
let latestReport: Report | undefined;

interface ActiveTab { url?: string; id?: number; }
let currentTab: ActiveTab = {};
let requiredPermissions: chrome.runtime.ManifestPermission[] = [];

async function activeTab(): Promise<ActiveTab> {
  const requestedId = new URLSearchParams(location.search).get('tab');
  if (activityPage && requestedId) {
    const tab = await chrome.tabs.get(Number(requestedId));
    return { url: tab.url, id: tab.id };
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { url: tab?.url, id: tab?.id };
}

function labelForState(state: AssessmentState): string {
  switch (state) {
    case 'insufficient-evidence': return 'Insufficient evidence';
    case 'no-suspicious-activity-observed': return 'No suspicious activity observed';
    case 'review-recommended': return 'Review recommended';
    case 'suspicious-activity-detected': return 'Suspicious activity detected';
  }
}

function eventLabel(event: BrowserTrustEvent): string {
  const labels: Record<string, string> = {
    'page.loaded': 'Page loaded',
    'element.added': 'Page element added',
    'form.field_edited': 'Form field edited',
    'form.submitted': 'Form submitted',
    'form.submit_called': 'Script submitted a form',
    'request.sent': 'Network request observed',
    'request.completed': 'Network request completed',
    'request.failed': 'Network request failed',
    'storage.write': 'Storage write',
    'storage.read': 'Storage read',
    'storage.remove': 'Storage item removed',
    'storage.clear': 'Storage cleared',
    'cookie.read': 'Cookie read',
    'cookie.write': 'Cookie write',
    'geolocation.requested': 'Geolocation API called',
    'clipboard.read': 'Clipboard read API called',
    'media.requested': 'Media capture API called',
    'clipboard.write': 'Clipboard write API called',
  };
  return labels[event.action] ?? event.action.replaceAll('.', ' ');
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderMonitoring(state: StateSnapshot): void {
  toggle.checked = state.settings.monitoringEnabled;
  monitoringStatus.textContent = state.settings.monitoringEnabled ? 'Monitoring enabled' : 'Monitoring paused';
}

function renderCoverage(state: StateSnapshot, url: string | undefined): boolean {
  allowSite.hidden = removeSite.hidden = allowAll.hidden = true;
  collectorsList.replaceChildren();
  const analysis = analyzeUrl(url);
  if (!analysis.ok) {
    siteHost.textContent = 'Unsupported page';
    siteStatus.textContent = `${analysis.reason} BrowserTrust cannot observe this page.`;
    requiredPermissions = [];
    enablePermissions.hidden = true;
    return false;
  }

  siteHost.textContent = analysis.host;
  const covered = isOriginCovered(analysis.origin, state.grantedOrigins);
  const allSites = ALL_SITES_PATTERNS.every((pattern) => state.grantedOrigins.includes(pattern));
  if (!covered) {
    siteStatus.textContent = `No host permission for ${analysis.host}; page activity is not covered.`;
    allowSite.textContent = `Allow ${analysis.host}`;
    allowSite.hidden = false;
  } else {
    siteStatus.textContent = allSites
      ? 'All HTTP and HTTPS sites are allowed. Third-party request coverage still depends on browser permissions.'
      : `Access granted for ${analysis.host}. Requests to other hosts may not be visible.`;
    removeSite.hidden = !state.grantedOrigins.includes(analysis.pattern);
  }
  allowAll.hidden = allSites;

  for (const collector of state.collectors) {
    const item = document.createElement('li');
    const status = collector.state === 'needs-permission'
      ? `permission needed: ${collector.requiredPermissions.join(', ')}`
      : collector.state;
    item.textContent = `${collector.id} · ${collector.mechanism} · ${status}`;
    collectorsList.append(item);
  }
  const blocked = state.collectors.filter((collector) => collector.state === 'needs-permission');
  requiredPermissions = [...new Set(blocked.flatMap((collector) => collector.requiredPermissions))];
  enablePermissions.hidden = requiredPermissions.length === 0;
  return covered;
}

function appendFinding(
  item: Finding,
  eventsById: Map<string, BrowserTrustEvent>,
  visibleEventIds: Set<string>,
): HTMLLIElement {
  const row = document.createElement('li');
  row.id = item.id;
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.className = 'finding-summary';
  const severity = document.createElement('span');
  severity.className = `severity ${item.severity}`;
  severity.textContent = item.severity;
  const title = document.createElement('span');
  title.className = 'finding-title';
  title.textContent = item.title;
  summary.append(severity, title);
  details.append(summary);

  const explanation = document.createElement('p');
  explanation.textContent = item.explanation;
  details.append(explanation);
  const evidence = document.createElement('p');
  evidence.className = 'meta';
  evidence.textContent = `${item.evidenceStrength.replaceAll('-', ' ')} · ${formatTime(item.timestamp)}${item.sourceOrigin ? ` · page ${item.sourceOrigin}` : ''}${item.destinationHost ? ` · destination ${item.destinationHost}` : ''}`;
  details.append(evidence);

  const refs = document.createElement('ul');
  item.eventIds.forEach((id, index) => {
    const event = eventsById.get(id);
    const ref = document.createElement('li');
    const text = event
      ? `${eventLabel(event)} · ${formatTime(item.eventTimestamps[index] ?? event.timestamp)}${event.destination?.host ? ` · ${event.destination.host}` : ''}`
      : `Supporting event ${id} · ${formatTime(item.eventTimestamps[index] ?? item.timestamp)} (outside retained event history)`;
    if (visibleEventIds.has(id)) {
      const link = document.createElement('a');
      link.href = `#event-${id}`;
      link.textContent = text;
      ref.append(link);
    } else {
      ref.textContent = text;
    }
    refs.append(ref);
  });
  details.append(refs);

  const limits = document.createElement('ul');
  for (const limitation of item.limitations) {
    const li = document.createElement('li');
    li.textContent = limitation;
    limits.append(li);
  }
  details.append(limits);
  row.append(details);
  return row;
}

function renderFindings(findings: Finding[], events: BrowserTrustEvent[]): void {
  findingsList.replaceChildren();
  findingsEmpty.hidden = findings.length > 0;
  const byId = new Map(events.map((event) => [event.id, event]));
  const visibleEventIds = new Set(events.slice(0, 15).map((event) => event.id));
  for (const item of findings.slice(0, activityPage ? 500 : 3)) findingsList.append(appendFinding(item, byId, visibleEventIds));
}

function renderDestinations(events: BrowserTrustEvent[], findings: Finding[]): void {
  destinationsList.replaceChildren();
  const summaries = summarizeDestinations(events);
  const visibleEventIds = new Set(events.slice(0, 15).map((event) => event.id));
  destinationsEmpty.hidden = summaries.length > 0;
  for (const destination of summaries.slice(0, activityPage ? 1000 : 3)) {
    const row = document.createElement('li');
    const host = document.createElement('p');
    host.className = 'destination-host';
    host.textContent = destination.host;
    const meta = document.createElement('p');
    meta.className = 'meta';
    const statusPart = destination.statusCodes.length > 0
      ? ` · status ${destination.statusCodes.join(', ')}`
      : '';
    const errorPart = destination.errorCount > 0 ? ` · ${destination.errorCount} failed` : '';
    const partyPart = destination.anyThirdParty ? ' · third-party' : '';
    meta.textContent = `${destination.observationCount} observation(s) · ${destination.methods.join(', ') || 'method unavailable'} · from ${destination.sourceOrigins.join(', ')} · via ${destination.sources.join(', ')}${statusPart}${errorPart}${partyPart} · latest ${formatTime(destination.lastObservedAt)}`;
    row.append(host, meta);

    const eventLinks = document.createElement('p');
    eventLinks.className = 'meta';
    for (const id of destination.eventIds.filter((eventId) => visibleEventIds.has(eventId)).slice(-3)) {
      const link = document.createElement('a');
      link.href = `#event-${id}`;
      link.textContent = 'view event';
      eventLinks.append(link, document.createTextNode(' '));
    }
    row.append(eventLinks);
    const related = findings.filter((item) => item.destinationHost === destination.host);
    if (related.length > 0) {
      const findingLink = document.createElement('a');
      findingLink.href = `#${related[0]!.id}`;
      findingLink.textContent = `Finding: ${related[0]!.title}`;
      const relatedLine = document.createElement('p');
      relatedLine.className = 'meta';
      relatedLine.append(findingLink);
      row.append(relatedLine);
    }
    destinationsList.append(row);
  }
}

function matchesTimelineFilters(event: BrowserTrustEvent): boolean {
  if (!timelineCategoryEnabled.get(event.category)) return false;
  if (!timelineSearchQuery) return true;
  const haystack = [
    eventLabel(event),
    event.action,
    event.source.origin,
    event.destination?.host ?? '',
    event.evidence.collector,
    event.evidence.mechanism,
  ].join(' ').toLowerCase();
  return haystack.includes(timelineSearchQuery);
}

function renderTimeline(events: BrowserTrustEvent[]): void {
  eventsList.replaceChildren();
  timelineAllEvents = events;
  const visible = activityPage ? events.filter(matchesTimelineFilters) : events;
  eventsEmpty.hidden = visible.length > 0;
  for (const event of visible.slice(0, activityPage ? 1000 : 4)) {
    const row = document.createElement('li');
    row.id = `event-${event.id}`;
    const label = document.createElement('span');
    label.className = 'event-label';
    label.textContent = eventLabel(event);
    row.append(label);
    if (activityPage) {
      const when = document.createElement('span');
      when.className = 'meta';
      when.textContent = ` · ${formatTime(event.timestamp)} · ${event.provenance}`;
      const source = document.createElement('span');
      source.className = 'event-source';
      source.textContent = `${event.source.origin}${event.destination?.host ? ` → ${event.destination.host}` : ''} · ${event.evidence.mechanism} (${event.evidence.collector})`;
      row.append(when, source);
    } else if (event.destination?.host) {
      const destination = document.createElement('span');
      destination.className = 'meta';
      destination.textContent = ` · ${event.destination.host}`;
      row.append(destination);
    }
    eventsList.append(row);
  }
}

function renderTimelineFilters(): void {
  if (!activityPage || !eventsCategoryFilters) return;
  eventsCategoryFilters.replaceChildren();
  for (const category of TIMELINE_CATEGORIES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chip${timelineCategoryEnabled.get(category) ? ' chip-on' : ''}`;
    button.textContent = category;
    button.setAttribute('aria-pressed', String(timelineCategoryEnabled.get(category) === true));
    button.addEventListener('click', () => {
      timelineCategoryEnabled.set(category, !(timelineCategoryEnabled.get(category) ?? false));
      button.classList.toggle('chip-on', timelineCategoryEnabled.get(category) === true);
      button.setAttribute('aria-pressed', String(timelineCategoryEnabled.get(category) === true));
      renderTimeline(timelineAllEvents);
    });
    eventsCategoryFilters.append(button);
  }
}

function flashEvent(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  target.classList.add('flash');
  if (flashResetTimer !== undefined) window.clearTimeout(flashResetTimer);
  flashResetTimer = window.setTimeout(() => {
    target.classList.remove('flash');
    flashResetTimer = undefined;
  }, 1500);
}

function renderBehavior(events: BrowserTrustEvent[], findings: Finding[]): void {
  behaviorList.replaceChildren();
  const labels = new Set<string>();
  for (const event of events) {
    if (event.action === 'form.submitted' || event.action === 'form.submit_called') labels.add('Form submission observed');
    if (event.category === 'network') labels.add('Network requests observed');
    if (event.category === 'storage') labels.add('Browser storage activity observed');
    if (['geolocation.requested', 'clipboard.read', 'media.requested'].includes(event.action)) labels.add('Sensitive browser capability activity observed');
  }
  if (findings.length === 0 && events.length > 0) labels.add('No configured rule matched the observed activity');
  for (const label of [...labels].slice(0, 4)) {
    const item = document.createElement('li'); item.textContent = label; behaviorList.append(item);
  }
  if (!labels.size) { const item = document.createElement('li'); item.textContent = 'No behavior recorded for this page yet.'; behaviorList.append(item); }
}

function showError(error: unknown): void {
  errorBox.textContent = `BrowserTrust could not update: ${error instanceof Error ? error.message : String(error)}`;
  errorBox.hidden = false;
}

async function refresh(): Promise<void> {
  errorBox.hidden = true;
  refreshButton.disabled = true;
  refreshStatus.textContent = 'Refreshing…';
  try {
    const [state, events, findings, tab] = await Promise.all([
      sendRequest<'get-state'>({ type: 'get-state' }),
      sendRequest<'list-events'>({ type: 'list-events', limit: 1000 }),
      sendRequest<'list-findings'>({ type: 'list-findings', limit: 500 }),
      activeTab(),
    ]);
    currentTab = tab;
    if (activityLink) activityLink.href = `activity.html?tab=${encodeURIComponent(String(tab.id ?? ''))}`;
    renderMonitoring(state);
    const site = analyzeUrl(tab.url);
    const siteAccessGranted = renderCoverage(state, tab.url);
    const assessment = assessSite(events, findings, {
      origin: site.ok ? site.origin : undefined,
      tabId: tab.id,
      monitoringEnabled: state.settings.monitoringEnabled,
      siteAccessGranted,
      contentScriptRegistered: state.contentScriptRegistered,
      collectors: state.collectors,
    });
    assessmentCard.dataset.state = assessment.state;
    assessmentTitle.textContent = labelForState(assessment.state);
    assessmentExplanation.textContent = assessment.explanation;
    eventCount.textContent = String(assessment.eventCount);
    networkCount.textContent = String(assessment.events.filter((event) => event.category === 'network').length);
    findingCount.textContent = String(assessment.findingCount);
    renderFindings(assessment.findings, assessment.events);
    renderBehavior(assessment.events, assessment.findings);
    renderDestinations(assessment.events, assessment.findings);
    renderTimeline(assessment.events);
    latestReport = buildReport(
      assessment.events,
      assessment.findings,
      summarizeDestinations(assessment.events),
      assessment,
      {
        host: site.ok ? site.host : undefined,
        monitoringEnabled: state.settings.monitoringEnabled,
        coverageGranted: siteAccessGranted,
      },
    );
    const hasAny = assessment.events.length > 0 || assessment.findings.length > 0;
    if (copyReportButton) copyReportButton.disabled = !hasAny;
    if (downloadReportButton) downloadReportButton.disabled = !hasAny;
    clearEvents.disabled = events.length === 0 && findings.length === 0;
    refreshStatus.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    showError(error);
    refreshStatus.textContent = '';
  } finally {
    refreshButton.disabled = false;
  }
}

toggle.addEventListener('change', async () => {
  try {
    await sendRequest<'set-monitoring'>({ type: 'set-monitoring', enabled: toggle.checked });
    await refresh();
  } catch (error) { showError(error); }
});

allowSite.addEventListener('click', async () => {
  const analysis = analyzeUrl(currentTab.url);
  if (!analysis.ok) return;
  try {
    await chrome.permissions.request({ origins: [analysis.pattern] });
    await refresh();
  } catch (error) { showError(error); }
});

removeSite.addEventListener('click', async () => {
  const analysis = analyzeUrl(currentTab.url);
  if (!analysis.ok) return;
  try {
    await chrome.permissions.remove({ origins: [analysis.pattern] });
    await refresh();
  } catch (error) { showError(error); }
});

allowAll.addEventListener('click', async () => {
  try {
    await chrome.permissions.request({ origins: [...ALL_SITES_PATTERNS] });
    await refresh();
  } catch (error) { showError(error); }
});

enablePermissions.addEventListener('click', async () => {
  if (requiredPermissions.length === 0) return;
  try {
    await chrome.permissions.request({ permissions: requiredPermissions });
    await refresh();
  } catch (error) { showError(error); }
});

refreshButton.addEventListener('click', () => void refresh());

if (eventsSearchInput) {
  eventsSearchInput.addEventListener('input', () => {
    timelineSearchQuery = eventsSearchInput.value.trim().toLowerCase();
    renderTimeline(timelineAllEvents);
  });
}

async function withButtonBusy(button: HTMLButtonElement, label: string, task: () => Promise<void>): Promise<void> {
  const original = button.textContent;
  button.disabled = true;
  try {
    await task();
    refreshStatus.textContent = label;
  } catch (error) {
    showError(error);
  } finally {
    button.textContent = original;
    button.disabled = false;
  }
}

function reportFilename(report: Report, extension: 'json' | 'md'): string {
  const host = report.host ?? 'site';
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  return `browsertrust-${host}-${stamp}.${extension}`;
}

copyReportButton?.addEventListener('click', () => {
  const report = latestReport;
  if (!report) return;
  void withButtonBusy(copyReportButton, 'Report copied to clipboard', async () => {
    await navigator.clipboard.writeText(reportToMarkdown(report));
  });
});

downloadReportButton?.addEventListener('click', () => {
  const report = latestReport;
  if (!report) return;
  void withButtonBusy(downloadReportButton, 'Report downloaded', async () => {
    const blob = new Blob([reportToJson(report)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = reportFilename(report, 'json');
      anchor.rel = 'noopener';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  });
});

renderTimelineFilters();

// Clicking a supporting-event link scrolls to the timeline row AND briefly
// highlights it so the connection is visible, even when it was already in view.
document.addEventListener('click', (clickEvent) => {
  const target = clickEvent.target;
  if (!(target instanceof HTMLAnchorElement)) return;
  const href = target.getAttribute('href') ?? '';
  if (!href.startsWith('#event-') && !href.startsWith('#')) return;
  const id = href.slice(1);
  const row = document.getElementById(id);
  if (!row) return;
  clickEvent.preventDefault();
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  flashEvent(id);
});
clearEvents.addEventListener('click', async () => {
  clearEvents.disabled = true;
  try {
    await sendRequest<'clear-events'>({ type: 'clear-events' });
    await refresh();
  } catch (error) {
    clearEvents.disabled = false;
    showError(error);
  }
});

void refresh();
