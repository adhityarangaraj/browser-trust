/**
 * BrowserTrust content script (isolated world). It is registered dynamically
 * only on origins the user has granted and starts the registered observers
 * only while monitoring is enabled.
 */
import { loadSettings, SETTINGS_KEY } from '../config/settings';
import type { ContentEventInput } from '../core/normalize';
import { sendRequest } from '../shared/messages';
import { createAlertOverlay, parseShowAlert } from './alert-overlay';
import type { ObserverContext } from './observer';
import { observers } from './observers';

const context: ObserverContext = {
  emit(event: ContentEventInput) {
    // Fails harmlessly if the extension was reloaded while this page stayed open.
    sendRequest<'ingest-event'>({ type: 'ingest-event', event }).catch(() => undefined);
  },
};

let active = false;

function setActive(enabled: boolean): void {
  if (enabled === active) return;
  active = enabled;
  for (const observer of observers) {
    if (enabled) observer.start(context);
    else observer.stop();
  }
}

void loadSettings().then((settings) => setActive(settings.monitoringEnabled));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(SETTINGS_KEY in changes)) return;
  void loadSettings().then((settings) => setActive(settings.monitoringEnabled));
});

// High-severity alerts pushed by the background are shown as a full-page
// dialog in the top frame only. Messages from other tabs' content scripts
// cannot reach this listener; we still require our own extension id and no
// sender tab (i.e. the service worker) and validate the payload.
const alertOverlay = window.top === window ? createAlertOverlay() : undefined;

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!alertOverlay || sender.id !== chrome.runtime.id || sender.tab !== undefined) return;
  const alert = parseShowAlert(message);
  if (!alert) return;
  alertOverlay.show(alert);
  sendResponse({ shown: true });
});
