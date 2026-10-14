/**
 * BrowserTrust content script (isolated world). It is registered dynamically
 * only on origins the user has granted and starts the registered observers
 * only while monitoring is enabled.
 */
import { loadSettings, SETTINGS_KEY } from '../config/settings';
import type { ContentEventInput } from '../core/normalize';
import { sendRequest } from '../shared/messages';
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
