/**
 * Native OS alerts for high-severity findings. Fires even when the popup is
 * closed, via `chrome.notifications`, and sets a red "!" badge on the
 * extension icon for the tab that triggered the finding.
 *
 * Design choices:
 *   - Only `severity: 'high'` findings alert. That is the same bar the
 *     assessment uses for "Suspicious activity detected", so what the user
 *     sees as an alert matches what the popup headline says.
 *   - De-duplicated by finding id for the lifetime of the service worker.
 *     Chrome may restart the worker, which resets the set — that is fine,
 *     because the FindingStore itself dedupes writes, so the same finding is
 *     never ANALYZED twice; a worker restart simply means a finding emitted
 *     after the restart alerts even if we already alerted before. In practice
 *     the restart interval and the ring-buffer window keep this negligible.
 *   - Clicking the notification opens the activity page for the triggering
 *     tab, scrolled to the finding by anchor id.
 */
import type { BrowserTrustEvent } from '../shared/types';
import type { Finding } from '../analysis/types';
import type { OnFindingsAdded } from '../analysis/service';

const NOTIFICATION_PREFIX = 'bt-finding:';

export interface AlertHandle {
  /** The pipeline-ready callback to hand to `connectAnalysis`. */
  onFindingsAdded: OnFindingsAdded;
  /** Clears the badge for a tab and marks it as no longer alerting. Call on monitoring-off or clear-events. */
  clearForTab(tabId: number): void;
  /** Clears every active alert and the dedupe set. Called by `clear-events`. */
  clearAll(): void;
}

export interface AlertDeps {
  notifications?: typeof chrome.notifications;
  action?: typeof chrome.action;
  tabs?: typeof chrome.tabs;
  runtime?: Pick<typeof chrome.runtime, 'getURL'>;
}

/**
 * Builds the alert handle. The deps object is injectable so tests can supply
 * stubs without a Chrome environment.
 */
export function createAlertHandle(deps: AlertDeps = {
  notifications: typeof chrome !== 'undefined' ? chrome.notifications : undefined,
  action: typeof chrome !== 'undefined' ? chrome.action : undefined,
  tabs: typeof chrome !== 'undefined' ? chrome.tabs : undefined,
  runtime: typeof chrome !== 'undefined' ? chrome.runtime : undefined,
}): AlertHandle {
  const notified = new Set<string>();
  const tabByNotification = new Map<string, number>();

  const findingTitle = (finding: Finding): string => finding.title;
  const findingBody = (finding: Finding): string => {
    const where = finding.destinationHost ?? finding.sourceOrigin;
    const prefix = `Severity: HIGH · ${finding.evidenceStrength.replaceAll('-', ' ')}`;
    return where ? `${prefix}\n${where}\n${finding.explanation}` : `${prefix}\n${finding.explanation}`;
  };

  const notifiedIdFor = (finding: Finding): string => `${NOTIFICATION_PREFIX}${finding.id}`;

  const onFindingsAdded: OnFindingsAdded = (findings, triggerEvent) => {
    const high = findings.filter((finding) => finding.severity === 'high');
    if (high.length === 0) return;
    const tabId = triggerEvent.source.tabId;
    for (const finding of high) {
      if (notified.has(finding.id)) continue;
      notified.add(finding.id);
      const notificationId = notifiedIdFor(finding);
      if (tabId !== undefined) tabByNotification.set(notificationId, tabId);
      // Native OS notification. requireInteraction keeps it on screen until
      // the user acknowledges — appropriate for a HIGH finding.
      deps.notifications?.create(notificationId, {
        type: 'basic',
        iconUrl: deps.runtime?.getURL('icons/icon-128.png') ?? 'icons/icon-128.png',
        title: `BrowserTrust: ${findingTitle(finding)}`,
        message: findingBody(finding),
        priority: 2,
        requireInteraction: true,
      });
      if (tabId !== undefined) {
        try {
          deps.action?.setBadgeText({ tabId, text: '!' });
          deps.action?.setBadgeBackgroundColor({ tabId, color: '#E53945' });
          deps.action?.setTitle?.({ tabId, title: `BrowserTrust: ${findingTitle(finding)}` });
        } catch (error) {
          console.error('BrowserTrust: badge update failed', error);
        }
      }
    }
  };

  const clearForTab = (tabId: number): void => {
    try {
      deps.action?.setBadgeText({ tabId, text: '' });
      deps.action?.setTitle?.({ tabId, title: 'BrowserTrust' });
    } catch (error) {
      console.error('BrowserTrust: badge clear failed', error);
    }
  };

  const clearAll = (): void => {
    for (const notificationId of tabByNotification.keys()) {
      try { deps.notifications?.clear(notificationId); } catch { /* best-effort */ }
    }
    tabByNotification.clear();
    notified.clear();
    try {
      deps.action?.setBadgeText({ text: '' });
      deps.action?.setTitle?.({ title: 'BrowserTrust' });
    } catch (error) {
      console.error('BrowserTrust: global badge clear failed', error);
    }
  };

  // Clicking the notification opens the activity page for the triggering tab.
  deps.notifications?.onClicked?.addListener?.((notificationId) => {
    if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;
    const tabId = tabByNotification.get(notificationId);
    const base = deps.runtime?.getURL('activity.html') ?? 'activity.html';
    const url = tabId !== undefined ? `${base}?tab=${encodeURIComponent(String(tabId))}` : base;
    deps.tabs?.create({ url });
    deps.notifications?.clear(notificationId);
  });

  // If the user dismisses a notification, forget its tab mapping.
  deps.notifications?.onClosed?.addListener?.((notificationId) => {
    tabByNotification.delete(notificationId);
  });

  return { onFindingsAdded, clearForTab, clearAll };
}
