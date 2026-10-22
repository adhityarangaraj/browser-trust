import type { CollectorStatus } from '../collectors/types';
import type { BrowserTrustEvent } from '../shared/types';
import { isKnownCommonHost } from './known-hosts';
import type { Finding } from './types';

const MIN_EVENTS_FOR_ASSESSMENT = 3;

export type AssessmentState =
  | 'insufficient-evidence'
  | 'no-suspicious-activity-observed'
  | 'review-recommended'
  | 'suspicious-activity-detected';

export interface Assessment {
  state: AssessmentState;
  explanation: string;
  eventCount: number;
  findingCount: number;
  events: BrowserTrustEvent[];
  findings: Finding[];
}

export interface AssessmentContext {
  origin?: string;
  /** Hostname of the active page, used to check the built-in common-site allowlist. */
  host?: string;
  tabId?: number;
  monitoringEnabled: boolean;
  siteAccessGranted: boolean;
  contentScriptRegistered: boolean;
  collectors: readonly CollectorStatus[];
}

export function assessSite(
  events: readonly BrowserTrustEvent[],
  findings: readonly Finding[],
  context: AssessmentContext,
): Assessment {
  const siteEvents = events.filter((event) => {
    if (context.tabId !== undefined) return event.source.tabId === context.tabId;
    return context.origin !== undefined && event.source.origin === context.origin;
  });
  const siteEventIds = new Set(siteEvents.map((event) => event.id));
  const siteFindings = findings.filter((finding) => finding.eventIds.some((id) => siteEventIds.has(id)));

  if (!context.monitoringEnabled) {
    return result('insufficient-evidence', 'Monitoring is off, so activity is not currently being observed.', siteEvents, siteFindings);
  }
  if (!context.origin || !context.siteAccessGranted) {
    return result('insufficient-evidence', 'BrowserTrust does not have permission to observe this site.', siteEvents, siteFindings);
  }
  if (!context.contentScriptRegistered) {
    return result('insufficient-evidence', 'Page observers are not registered. Reload this permitted page after enabling monitoring.', siteEvents, siteFindings);
  }
  const missing = context.collectors.filter((collector) => collector.state === 'needs-permission');
  if (missing.length > 0) {
    return result(
      'insufficient-evidence',
      `Coverage is incomplete. Grant the optional permission required by ${missing.map((collector) => collector.id).join(', ')}.`,
      siteEvents,
      siteFindings,
    );
  }
  const networkCount = siteEvents.filter((event) => event.category === 'network').length;
  if (siteEvents.length < MIN_EVENTS_FOR_ASSESSMENT || networkCount === 0) {
    return result(
      'insufficient-evidence',
      `Too little activity is available for an assessment. Need at least ${MIN_EVENTS_FOR_ASSESSMENT} observations including a network event; currently ${siteEvents.length} observation(s), ${networkCount} network event(s).`,
      siteEvents,
      siteFindings,
    );
  }

  const allowlisted = isKnownCommonHost(context.host);
  const highCount = siteFindings.filter((finding) => finding.severity === 'high').length;
  const mediumCount = siteFindings.filter((finding) => finding.severity === 'medium').length;

  // High-severity promotion ONLY for sites not on the common-sites allowlist.
  // Pattern-based rules (sustained POST bursts, capability-then-upload) are
  // exactly what large legitimate sites — GitHub telemetry, YouTube ads,
  // analytics endpoints — do routinely, so firing a "Suspicious activity
  // detected" state on an allowlisted host produces false positives that
  // undermine the extension's credibility. The high findings still render
  // below the assessment for transparency; removing a site from
  // `known-hosts.ts` restores escalation.
  if (highCount > 0 && !allowlisted) {
    return result('suspicious-activity-detected', 'One or more high-severity rules matched observed evidence. Review the supporting events and limitations.', siteEvents, siteFindings);
  }
  if (mediumCount > 0 && !allowlisted) {
    return result('review-recommended', 'Some observed behavior matched a medium-severity review rule. The findings describe evidence and do not prove malicious intent.', siteEvents, siteFindings);
  }
  if (siteFindings.length > 0) {
    const count = siteFindings.length;
    const explanation = `Monitoring is active and activity was observed. ${count} finding${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} listed below but did not promote the overall assessment. This is not proof that the site is safe.`;
    return result('no-suspicious-activity-observed', explanation, siteEvents, siteFindings);
  }
  return result('no-suspicious-activity-observed', 'Monitoring is active and activity was observed, but no configured rule matched. This is not proof that the site is safe.', siteEvents, siteFindings);
}

function result(
  state: AssessmentState,
  explanation: string,
  events: BrowserTrustEvent[],
  findings: Finding[],
): Assessment {
  return { state, explanation, eventCount: events.length, findingCount: findings.length, events, findings };
}
