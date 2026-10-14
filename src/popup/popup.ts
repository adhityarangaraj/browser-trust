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
  const running = state.collectors.filter((c) => c.running).length;
  if (!on) {
    monitoringStatus.textContent = 'Monitoring is off.';
  } else if (state.collectors.length === 0) {
    monitoringStatus.textContent = 'Monitoring is on, but no collectors exist yet (Phase 1).';
  } else {
    monitoringStatus.textContent = `Monitoring is on (${running} of ${state.collectors.length} collectors running).`;
  }
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
    eventsSummary.textContent = 'No events recorded. Nothing is collected yet in Phase 1.';
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

clearEvents.addEventListener('click', async () => {
  await sendRequest<'clear-events'>({ type: 'clear-events' });
  await refresh();
});

refresh().catch((error: unknown) => {
  monitoringStatus.textContent = `BrowserTrust could not load its state: ${
    error instanceof Error ? error.message : String(error)
  }`;
});
