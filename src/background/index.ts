/**
 * BrowserTrust service worker: lifecycle, message routing and wiring.
 * It can be stopped and restarted by Chrome at any time, so all state lives in
 * chrome.storage and listeners are registered synchronously at the top level.
 */
import { collectors } from '../collectors';
import { rules } from '../analysis/rules';
import { connectAnalysis } from '../analysis/service';
import { FindingStore } from '../analysis/store';
import {
  getGrantedOrigins,
  isContentScriptRegistered,
  syncContentScripts,
} from '../config/access';
import { clearFindingPreferences } from '../config/preferences';
import { loadSettings, normalizeSiteOrigin, saveSettings } from '../config/settings';
import { ActiveTimeTracker } from './activity-time-tracker';
import { EventPipeline } from '../core/pipeline';
import { chromeStorageAdapter, EventStore } from '../core/store';
import type { Request, StateSnapshot } from '../shared/messages';
import { CollectorManager } from './collector-manager';

const store = new EventStore(chromeStorageAdapter);
const findingStore = new FindingStore(chromeStorageAdapter);
const pipeline = new EventPipeline(store);
const collectorManager = new CollectorManager(collectors, async (event) => {
  await pipeline.emit(event);
});

const analysis = connectAnalysis(pipeline, store, findingStore, rules);
const activeTimeTracker = new ActiveTimeTracker();

// Listeners must be registered synchronously so Chrome can wake the worker for them.
collectorManager.attachAll();
activeTimeTracker.attach();

async function reconcile(): Promise<void> {
  const settings = await loadSettings();
  collectorManager.attachAll(); // picks up collectors whose permission was just granted
  collectorManager.setMonitoring(settings.monitoringEnabled);
  await syncContentScripts(settings.monitoringEnabled);
}

async function snapshot(): Promise<StateSnapshot> {
  const [settings, eventCount, grantedOrigins, contentScriptRegistered] = await Promise.all([
    loadSettings(),
    store.count(),
    getGrantedOrigins(),
    isContentScriptRegistered(),
  ]);
  return {
    settings,
    eventCount,
    collectors: await collectorManager.status(),
    grantedOrigins,
    contentScriptRegistered,
  };
}

/**
 * Extension pages (popup) are privileged; content scripts (which run next to
 * untrusted page code) may only submit events.
 */
async function handle(request: Request, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (sender.id !== chrome.runtime.id) throw new Error('Rejected: unknown sender');
  // An extension page opened in a browser tab also has `sender.tab`. Identify
  // privileged extension contexts by their extension URL before treating a
  // tab-backed message as coming from an untrusted site content script.
  const extensionUrl = chrome.runtime.getURL('');
  const fromExtensionPage = typeof sender.url === 'string' && sender.url.startsWith(extensionUrl);
  const fromContentScript = sender.tab !== undefined && !fromExtensionPage;

  if (request.type === 'ingest-event') {
    if (!fromContentScript) throw new Error('Rejected: ingest-event is for content scripts');
    const settings = await loadSettings();
    if (!settings.monitoringEnabled) return null;
    await pipeline.ingestFromContent(request.event, {
      url: sender.url,
      tabId: sender.tab?.id,
      frameId: sender.frameId,
    });
    return null;
  }

  if (fromContentScript) throw new Error('Rejected: privileged request from a content script');

  switch (request.type) {
    case 'get-state':
      return snapshot();
    case 'set-monitoring': {
      const settings = await loadSettings();
      await saveSettings({ ...settings, monitoringEnabled: request.enabled });
      // Close the collector gate immediately after persistence succeeds; do
      // not leave a window open while content scripts are reconciled.
      collectorManager.setMonitoring(request.enabled);
      await reconcile();
      return snapshot();
    }
    case 'set-site-ignored': {
      if (typeof request.ignored !== 'boolean') throw new Error('ignored must be a boolean');
      const origin = normalizeSiteOrigin(request.origin);
      if (!origin) throw new Error('origin must be a valid HTTP(S) origin');
      const settings = await loadSettings();
      const ignoredOrigins = new Set(settings.ignoredOrigins);
      if (request.ignored) ignoredOrigins.add(origin);
      else ignoredOrigins.delete(origin);
      await saveSettings({ ...settings, ignoredOrigins: [...ignoredOrigins] });
      return snapshot();
    }
    case 'list-events':
      return store.list(request.limit);
    case 'list-findings':
      return findingStore.list(request.limit);
    case 'clear-events':
      // Bump the store generation first so any analysis task already queued
      // for an in-flight event drops its finding write instead of resurrecting it.
      await store.clear();
      await analysis.drain();
      await findingStore.clear();
      // Pin/dismiss state is keyed by finding ID, so wiping the finding store
      // leaves orphaned ids. Clear those too; theme preference is kept.
      await clearFindingPreferences();
      return null;
    case 'get-activity-time':
      return activeTimeTracker.getSnapshot();
    case 'set-activity-time-tracking':
      if (typeof request.enabled !== 'boolean') throw new Error('enabled must be a boolean');
      return activeTimeTracker.setEnabled(request.enabled);
    case 'clear-activity-time':
      return activeTimeTracker.clearRecords();
    default:
      throw new Error(`Unknown request: ${(request as { type: string }).type}`);
  }
}

chrome.runtime.onMessage.addListener((message: Request, sender, sendResponse) => {
  handle(message, sender).then(
    (data) => sendResponse({ ok: true, data } satisfies { ok: true; data: unknown }),
    (error: unknown) =>
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
  return true; // keep the channel open for the async response
});

chrome.runtime.onInstalled.addListener(() => void reconcile());
chrome.runtime.onStartup.addListener(() => void reconcile());
// Re-register content scripts whenever the user grants or revokes site access.
chrome.permissions.onAdded.addListener(() => void reconcile());
chrome.permissions.onRemoved.addListener(() => void reconcile());

// The monitoring switch is in-memory, so reload it each time the worker wakes up.
void loadSettings().then((s) => collectorManager.setMonitoring(s.monitoringEnabled));
