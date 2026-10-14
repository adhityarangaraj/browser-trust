/**
 * BrowserTrust service worker: lifecycle, message routing and wiring.
 * It can be stopped and restarted by Chrome at any time, so all state lives in
 * chrome.storage and listeners are registered synchronously at the top level.
 */
import { collectors } from '../collectors';
import {
  getGrantedOrigins,
  isContentScriptRegistered,
  syncContentScripts,
} from '../config/access';
import { loadSettings, saveSettings } from '../config/settings';
import { EventPipeline } from '../core/pipeline';
import { chromeStorageAdapter, EventStore } from '../core/store';
import type { Request, StateSnapshot } from '../shared/messages';
import { CollectorManager } from './collector-manager';

const store = new EventStore(chromeStorageAdapter);
const pipeline = new EventPipeline(store);
const collectorManager = new CollectorManager(collectors, {
  emit: async (event) => {
    await pipeline.emit(event);
  },
});

async function reconcile(): Promise<void> {
  const settings = await loadSettings();
  await syncContentScripts(settings.monitoringEnabled);
  await collectorManager.sync(settings.monitoringEnabled);
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
    collectors: collectorManager.status(),
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
  const fromContentScript = sender.tab !== undefined;

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
      await reconcile();
      return snapshot();
    }
    case 'list-events':
      return store.list(request.limit);
    case 'clear-events':
      await store.clear();
      return null;
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

// Collectors are in-memory, so restart them each time the worker wakes up.
void loadSettings().then((s) => collectorManager.sync(s.monitoringEnabled));
