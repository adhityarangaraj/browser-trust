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
const siteStatus = el('site-status');
const allowSite = el<HTMLButtonElement>('allow-site');
const removeSite = el<HTMLButtonElement>('remove-site');
const allowAll = el<HTMLButtonElement>('allow-all');
const collectorsList = el('collectors-list');
const collectorsHint = el('collectors-hint');
const enablePermissions = el<HTMLButtonElement>('enable-permissions');
const eventsSummary = el('events-summary');
const eventsList = el('events-list');
const clearEvents = el<HTMLButtonElement>('clear-events');

async function activeTabUrl(): Promise<string | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url;
}

function renderMonitoring(state: StateSnapshot): void {
  const on = state.settings.monitoringEnabled;
  toggle.checked = on;
  monitoringStatus.textContent = on
    ? 'Monitoring is on. Only sites you allowed are observed.'
    : 'Monitoring is off.';
}

function renderCollectors(state: StateSnapshot): void {
  collectorsList.replaceChildren();
  for (const collector of state.collectors) {
    const item = document.createElement('li');
    const label =
      collector.state === 'needs-permission'
        ? `needs permission: ${collector.requiredPermissions.join(', ')}`
        : collector.state;
    item.textContent = `${collector.id} — ${label}`;
    collectorsList.append(item);
  }
  const blocked = state.collectors.filter((c) => c.state === 'needs-permission');
  enablePermissions.hidden = blocked.length === 0;
  const allSites = ALL_SITES_PATTERNS.every((p) => state.grantedOrigins.includes(p));
  collectorsHint.textContent = allSites
    ? 'Page-level observers run on allowed sites.'
    : 'Network metadata only covers requests to hosts you allowed. Seeing third-party destinations needs access to all websites.';
}

function renderSite(state: StateSnapshot, url: string | undefined): void {
  allowSite.hidden = removeSite.hidden = allowAll.hidden = true;
  const analysis = analyzeUrl(url);
  if (!analysis.ok) {
    siteStatus.textContent = `${analysis.reason} BrowserTrust cannot monitor this page.`;
    return;
  }
  const allSites = ALL_SITES_PATTERNS.every((p) => state.grantedOrigins.includes(p));
  const covered = isOriginCovered(analysis.origin, state.grantedOrigins);
  if (covered) {
    siteStatus.textContent = allSites
      ? `BrowserTrust has access to all websites, including ${analysis.host}.`
      : `BrowserTrust has access to ${analysis.host}.`;
    removeSite.hidden = state.grantedOrigins.includes(analysis.pattern) ? false : true;
  } else {
    siteStatus.textContent = `BrowserTrust has no access to ${analysis.host}, so nothing is observed there.`;
    allowSite.textContent = `Allow on ${analysis.host}`;
    allowSite.hidden = false;
  }
  allowAll.hidden = allSites;
}

function describeEvent(event: BrowserTrustEvent): string {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const target = event.destination?.host ? ` → ${event.destination.host}` : '';
  return `${time} · ${event.category}/${event.action} · ${event.source.origin}${target}`;
}

function renderEvents(state: StateSnapshot, events: BrowserTrustEvent[]): void {
  eventsList.replaceChildren();
  clearEvents.hidden = state.eventCount === 0;
  if (state.eventCount === 0) {
    eventsSummary.textContent = 'No events recorded yet. Allow a site, browse it, then reopen this popup.';
    return;
  }
  eventsSummary.textContent = `${state.eventCount} stored event(s). Showing the latest ${events.length}.`;
  for (const event of events) {
    const item = document.createElement('li');
    item.textContent = describeEvent(event); // textContent: event data is never parsed as HTML
    eventsList.append(item);
  }
}

async function refresh(): Promise<void> {
  const [state, events, url] = await Promise.all([
    sendRequest<'get-state'>({ type: 'get-state' }),
    sendRequest<'list-events'>({ type: 'list-events', limit: 20 }),
    activeTabUrl(),
  ]);
  renderMonitoring(state);
  renderCollectors(state);
  renderSite(state, url);
  renderEvents(state, events);
}

toggle.addEventListener('change', async () => {
  await sendRequest<'set-monitoring'>({ type: 'set-monitoring', enabled: toggle.checked });
  await refresh();
});

// permissions.request must run directly inside the click handler (user gesture).
allowSite.addEventListener('click', async () => {
  const analysis = analyzeUrl(await activeTabUrl());
  if (!analysis.ok) return;
  await chrome.permissions.request({ origins: [analysis.pattern] });
  await refresh();
});

removeSite.addEventListener('click', async () => {
  const analysis = analyzeUrl(await activeTabUrl());
  if (!analysis.ok) return;
  await chrome.permissions.remove({ origins: [analysis.pattern] });
  await refresh();
});

allowAll.addEventListener('click', async () => {
  await chrome.permissions.request({ origins: [...ALL_SITES_PATTERNS] });
  await refresh();
});

enablePermissions.addEventListener('click', async () => {
  const state = await sendRequest<'get-state'>({ type: 'get-state' });
  const permissions = [...new Set(state.collectors.flatMap((c) => c.requiredPermissions))];
  if (permissions.length > 0) await chrome.permissions.request({ permissions });
  await refresh();
});

clearEvents.addEventListener('click', async () => {
  await sendRequest<'clear-events'>({ type: 'clear-events' });
  await refresh();
});

refresh().catch((error: unknown) => {
  monitoringStatus.textContent = `BrowserTrust could not load its state: ${
    error instanceof Error ? error.message : String(error)
  }`;
});
