/**
 * Alerts for high-severity and medium-severity (review recommended) findings.
 * Fires even when the popup is closed, via an in-page modal dialog (falling
 * back to chrome.notifications), and sets a colored "!" badge on the
 * extension icon (red for high, orange for medium) for the tab that triggered the
 * finding.
 *
 * Delivery:
 *   - Primary: a large in-page alert dialog. The background pushes a
 *     `show-alert` message to the top frame of the triggering tab and the
 *     BrowserTrust content script renders it (see `content/alert-overlay.ts`).
 *   - Fallback: a native OS notification via `chrome.notifications`, used
 *     when the tab is unknown, has no BrowserTrust content script (e.g. only
 *     `webRequest` covers it), or does not acknowledge the message.
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
import { isKnownCommonHost } from '../analysis/known-hosts';
import type { OnFindingsAdded } from '../analysis/service';
import type { AlertPayload, ShowAlertMessage } from '../shared/messages';

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
  const highestSeverityByTab = new Map<number, Finding['severity']>();

  const findingTitle = (finding: Finding): string => finding.title;
  const findingBody = (finding: Finding): string => {
    const where = finding.destinationHost ?? finding.sourceOrigin;
    const prefix = `Severity: ${finding.severity.toUpperCase()} · ${finding.evidenceStrength.replaceAll('-', ' ')}`;
    return where ? `${prefix}\n${where}\n${finding.explanation}` : `${prefix}\n${finding.explanation}`;
  };

  const notifiedIdFor = (finding: Finding): string => `${NOTIFICATION_PREFIX}${finding.id}`;

  const showOsNotification = (finding: Finding, tabId: number | undefined): void => {
    const notificationId = notifiedIdFor(finding);
    if (tabId !== undefined) tabByNotification.set(notificationId, tabId);
    // requireInteraction keeps it on screen until the user acknowledges.
    deps.notifications?.create(notificationId, {
      type: 'basic',
      iconUrl: deps.runtime?.getURL('icons/icon-128.png') ?? 'icons/icon-128.png',
      title: `BrowserTrust: ${findingTitle(finding)}`,
      message: findingBody(finding),
      priority: finding.severity === 'high' ? 2 : 1,
      requireInteraction: true,
    });
  };

  /**
   * Asks the content script in the tab's top frame to show the in-page alert
   * dialog. Resolves true only when the content script acknowledges it.
   */
  const showInPage = async (finding: Finding, tabId: number): Promise<boolean> => {
    const tabs = deps.tabs;
    if (!tabs?.sendMessage) return false;
    const message: ShowAlertMessage = { type: 'show-alert', alert: toAlertPayload(finding) };
    try {
      const reply: unknown = await tabs.sendMessage(tabId, message, { frameId: 0 });
      return typeof reply === 'object' && reply !== null && (reply as { shown?: unknown }).shown === true;
    } catch {
      return false; // no content script in this tab, or the tab is gone
    }
  };

  const onFindingsAdded: OnFindingsAdded = (findings, triggerEvent) => {
    const relevant = findings.filter(
      (finding) => finding.severity === 'high' || finding.severity === 'medium',
    );
    if (relevant.length === 0) return;
    // Mirrors the assessment layer: for allowlisted common sites we treat
    // pattern-based findings as informational. The findings still appear
    // in the popup; we just do not pop an alert dialog over the user's work.
    const sourceHost = (() => {
      try {
        return triggerEvent.source.origin ? new URL(triggerEvent.source.origin).host : undefined;
      } catch {
        return undefined;
      }
    })();
    if (isKnownCommonHost(sourceHost)) return;
    const tabId = triggerEvent.source.tabId;
    for (const finding of relevant) {
      if (notified.has(finding.id)) continue;
      notified.add(finding.id);
      if (tabId === undefined || !deps.tabs?.sendMessage) {
        showOsNotification(finding, tabId);
      } else {
        void showInPage(finding, tabId).then((shown) => {
          if (!shown) showOsNotification(finding, tabId);
        });
      }
      if (tabId !== undefined) {
        const currentHighest = highestSeverityByTab.get(tabId);
        const newSeverity = currentHighest === 'high' || finding.severity === 'high' ? 'high' : 'medium';
        highestSeverityByTab.set(tabId, newSeverity);
        const color = newSeverity === 'high' ? '#E53945' : '#F59E0B';
        try {
          deps.action?.setBadgeText({ tabId, text: '!' });
          deps.action?.setBadgeBackgroundColor({ tabId, color });
          deps.action?.setTitle?.({ tabId, title: `BrowserTrust: ${findingTitle(finding)}` });
        } catch (error) {
          console.error('BrowserTrust: badge update failed', error);
        }
      }
    }
  };

  const clearForTab = (tabId: number): void => {
    highestSeverityByTab.delete(tabId);
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
    highestSeverityByTab.clear();
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

/** Builds the display-only payload for the in-page alert dialog. */
export function toAlertPayload(finding: Finding): AlertPayload {
  const where = finding.destinationHost ?? finding.sourceOrigin;
  return {
    findingId: finding.id,
    title: finding.title,
    explanation: finding.explanation,
    severity: finding.severity,
    evidenceStrength: finding.evidenceStrength.replaceAll('-', ' '),
    ...(where ? { where } : {}),
    limitations: [...finding.limitations],
    timestamp: finding.timestamp,
  };
}
