import type { CollectorStatus } from '../collectors/types';
import type { BrowserTrustEvent } from '../shared/types';
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

  if (siteFindings.some((finding) => finding.severity === 'high')) {
    return result('suspicious-activity-detected', 'One or more high-severity rules matched observed evidence. Review the supporting events and limitations.', siteEvents, siteFindings);
  }
  if (siteFindings.length > 0) {
    return result('review-recommended', 'Some observed behavior matched a review rule. The findings describe evidence and do not prove malicious intent.', siteEvents, siteFindings);
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
