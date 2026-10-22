import {
  ACTIVITY_TIME_KEY,
  EMPTY_ACTIVITY_TIME_DATA,
  addActiveInterval,
  normalizeWebHost,
  sanitizeActivityTimeData,
  type ActivityTimeData,
  type ActivityTimeSession,
  type ActivityTimeSnapshot,
} from '../core/activity-time';

export const ACTIVE_TIME_TRACKING_PERMISSIONS = ['tabs', 'idle', 'alarms'] as const;
export const ACTIVITY_TIME_ALARM = 'browsertrust.activity-time.checkpoint';
const CHECKPOINT_MINUTES = 1;
const IDLE_DETECTION_SECONDS = 15;
const MAX_CHECKPOINT_GAP_MS = 90 * 1000;
const SESSION_LIFECYCLE_KEY = 'bt.activityTime.browserSession';

interface ActiveContext {
  tabId: number;
  windowId: number;
  host: string;
}

/**
 * Event-driven active-tab time accounting. Alarms checkpoint once a minute;
 * every stored value is a local hostname/day aggregate, never a page URL.
 */
export class ActiveTimeTracker {
  private queue: Promise<unknown> = Promise.resolve();
  private idleListenerAttached = false;
  private alarmListenerAttached = false;
  private optionalListenersSetup: Promise<void> | undefined;

  constructor(private readonly now: () => number = Date.now) {}

  /** Register listeners synchronously so Chrome can wake the MV3 worker. */
  attach(): void {
    chrome.tabs.onActivated.addListener(() => void this.reconcile(false));
    chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
      if (changeInfo.url !== undefined || changeInfo.status === 'complete') {
        if (tab.active) void this.reconcile(false);
      }
    });
    chrome.tabs.onRemoved.addListener(() => void this.reconcile(false));
    chrome.windows.onFocusChanged.addListener(() => void this.reconcile(true));
    chrome.windows.onRemoved.addListener(() => void this.reconcile(true));
    chrome.permissions.onAdded.addListener(() => void this.attachOptionalListeners());
    chrome.permissions.onRemoved.addListener((removed) => {
      if (ACTIVE_TIME_TRACKING_PERMISSIONS.some((permission) => removed.permissions?.includes(permission))) {
        void this.disableAfterPermissionRemoval();
      }
    });

    void this.attachOptionalListeners();
    void this.initialize();
  }

  getSnapshot(): Promise<ActivityTimeSnapshot> {
    return this.enqueue(async () => this.snapshot(await this.read()));
  }

  setEnabled(enabled: boolean): Promise<ActivityTimeSnapshot> {
    return this.enqueue(async () => {
      let data = await this.read();
      if (enabled) {
        const granted = await chrome.permissions.contains({
          permissions: [...ACTIVE_TIME_TRACKING_PERMISSIONS],
        });
        if (!granted) throw new Error('Active browsing time permissions have not been granted.');
        data = { ...data, enabled: true, session: undefined };
        await this.write(data);
        await this.attachOptionalListeners();
        this.configureTracking();
        data = await this.reconcileData(data, false);
      } else {
        if (data.enabled) data = await this.reconcileData(data, true);
        data = { ...data, enabled: false, session: undefined };
        await this.write(data);
        await chrome.alarms.clear(ACTIVITY_TIME_ALARM);
      }
      return this.snapshot(data);
    });
  }

  clearRecords(): Promise<ActivityTimeSnapshot> {
    return this.enqueue(async () => {
      const data = await this.read();
      const checkpointed = data.enabled ? await this.reconcileData(data, true) : data;
      const cleared: ActivityTimeData = {
        ...EMPTY_ACTIVITY_TIME_DATA,
        enabled: checkpointed.enabled,
        session: checkpointed.session,
      };
      await this.write(cleared);
      return this.snapshot(cleared);
    });
  }

  private initialize(): Promise<void> {
    return this.enqueue(async () => {
      let data = await this.read();
      const lifecycle = await chrome.storage.session.get(SESSION_LIFECYCLE_KEY);
      const sameBrowserSession = lifecycle[SESSION_LIFECYCLE_KEY] === true;
      await chrome.storage.session.set({ [SESSION_LIFECYCLE_KEY]: true });

      if (!sameBrowserSession) {
        // storage.session is cleared on browser restart. Do not count time while
        // Chrome was closed or before this worker could resume.
        data = { ...data, session: undefined };
        await this.write(data);
      }
      if (data.enabled) {
        const granted = await chrome.permissions.contains({
          permissions: [...ACTIVE_TIME_TRACKING_PERMISSIONS],
        });
        if (!granted) {
          data = { ...data, enabled: false, session: undefined };
          await this.write(data);
          await chrome.alarms.clear(ACTIVITY_TIME_ALARM);
          return;
        }
        this.configureTracking();
        await this.reconcileData(data, sameBrowserSession);
      }
    });
  }

  private reconcile(checkpoint: boolean): Promise<void> {
    return this.enqueue(async () => {
      const data = await this.read();
      if (!data.enabled) return;
      const granted = await chrome.permissions.contains({
        permissions: [...ACTIVE_TIME_TRACKING_PERMISSIONS],
      });
      if (!granted) {
        const stopped = { ...data, enabled: false, session: undefined };
        await this.write(stopped);
        await chrome.alarms.clear(ACTIVITY_TIME_ALARM);
        return;
      }
      await this.reconcileData(data, checkpoint);
    });
  }

  private async reconcileData(data: ActivityTimeData, checkpoint: boolean): Promise<ActivityTimeData> {
    const timestamp = this.now();
    const current = await this.getActiveContext();
    const prior = data.session;
    let updated = data;

    if (prior) {
      const delta = timestamp - prior.lastCheckpointAt;
      const sameContext = current !== undefined && sameSession(prior, current);
      if (checkpoint && delta > 0 && delta <= MAX_CHECKPOINT_GAP_MS) {
        updated = addActiveInterval(updated, prior.host, prior.lastCheckpointAt, timestamp, timestamp);
      } else if (!sameContext && delta > 0 && delta <= MAX_CHECKPOINT_GAP_MS) {
        // A transition event closes the previous eligible interval at this instant.
        updated = addActiveInterval(updated, prior.host, prior.lastCheckpointAt, timestamp, timestamp);
      }
    }

    const nextSession: ActivityTimeSession | undefined = current
      ? {
          ...current,
          lastCheckpointAt:
            prior && current && sameSession(prior, current) && !checkpoint
              ? prior.lastCheckpointAt
              : timestamp,
        }
      : undefined;

    if (!sameData(updated, data) || !sameSessionOrMissing(nextSession, data.session)) {
      updated = { ...updated, session: nextSession };
      await this.write(updated);
    }
    return updated;
  }

  private async getActiveContext(): Promise<ActiveContext | undefined> {
    try {
      const [window, idleState] = await Promise.all([
        chrome.windows.getLastFocused({ populate: false }),
        chrome.idle.queryState(IDLE_DETECTION_SECONDS),
      ]);
      if (!window.focused || window.id === undefined || idleState !== 'active') return undefined;
      const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
      const host = normalizeWebHost(tab?.url);
      if (!tab || tab.id === undefined || !host) return undefined;
      return { tabId: tab.id, windowId: window.id, host };
    } catch (error) {
      console.warn('BrowserTrust: could not reconcile active browsing context', error);
      return undefined;
    }
  }

  private async attachOptionalListeners(): Promise<void> {
    if (this.optionalListenersSetup) return this.optionalListenersSetup;
    this.optionalListenersSetup = (async () => {
      const [idleGranted, alarmsGranted] = await Promise.all([
        chrome.permissions.contains({ permissions: ['idle'] }),
        chrome.permissions.contains({ permissions: ['alarms'] }),
      ]);
      if (idleGranted && !this.idleListenerAttached && chrome.idle?.onStateChanged) {
        chrome.idle.onStateChanged.addListener(() => void this.reconcile(true));
        this.idleListenerAttached = true;
      }
      if (alarmsGranted && !this.alarmListenerAttached && chrome.alarms?.onAlarm) {
        chrome.alarms.onAlarm.addListener((alarm) => {
          if (alarm.name === ACTIVITY_TIME_ALARM) void this.reconcile(true);
        });
        this.alarmListenerAttached = true;
      }
    })().finally(() => {
      this.optionalListenersSetup = undefined;
    });
    return this.optionalListenersSetup;
  }

  private configureTracking(): void {
    chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
    chrome.alarms.create(ACTIVITY_TIME_ALARM, { periodInMinutes: CHECKPOINT_MINUTES });
  }

  private async disableAfterPermissionRemoval(): Promise<void> {
    await this.enqueue(async () => {
      const data = await this.read();
      if (!data.enabled) return;
      const checkpointed = await this.reconcileData(data, true);
      const stopped = { ...checkpointed, enabled: false, session: undefined };
      await this.write(stopped);
      await chrome.alarms.clear(ACTIVITY_TIME_ALARM);
    });
  }

  private async read(): Promise<ActivityTimeData> {
    const result = await chrome.storage.local.get(ACTIVITY_TIME_KEY);
    return sanitizeActivityTimeData(result[ACTIVITY_TIME_KEY], this.now());
  }

  private async write(data: ActivityTimeData): Promise<void> {
    const sanitized = sanitizeActivityTimeData(data, this.now());
    await chrome.storage.local.set({ [ACTIVITY_TIME_KEY]: sanitized });
  }

  private snapshot(data: ActivityTimeData): ActivityTimeSnapshot {
    return { schemaVersion: data.schemaVersion, enabled: data.enabled, records: data.records };
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch((error: unknown) => {
      console.error('BrowserTrust: active-time operation failed', error);
    });
    return run;
  }
}

function sameSession(session: ActivityTimeSession, context: ActiveContext): boolean {
  return session.tabId === context.tabId && session.windowId === context.windowId && session.host === context.host;
}

function sameSessionOrMissing(
  first: ActivityTimeSession | undefined,
  second: ActivityTimeSession | undefined,
): boolean {
  return first === undefined
    ? second === undefined
    : second !== undefined &&
        first.tabId === second.tabId &&
        first.windowId === second.windowId &&
        first.host === second.host &&
        first.lastCheckpointAt === second.lastCheckpointAt;
}

function sameData(first: ActivityTimeData, second: ActivityTimeData): boolean {
  return first.records.length === second.records.length && first.records.every((record, index) => {
    const other = second.records[index];
    return other !== undefined && record.day === other.day && record.host === other.host && record.activeMs === other.activeMs;
  });
}
