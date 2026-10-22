import { describe, expect, it, vi } from 'vitest';
import { createAlertHandle } from '../src/background/alerts';
import type { Finding } from '../src/analysis/types';
import { createEvent } from '../src/core/normalize';

function finding(id: string, severity: Finding['severity'], destinationHost = 'tracker.example'): Finding {
  return {
    id, ruleId: 'test.rule', title: `A ${severity} finding`, category: 'communication', explanation: `Explain ${id}`,
    severity, eventIds: [`event-${id}`], eventTimestamps: [1], sourceOrigin: 'https://shop.example',
    destinationHost, evidenceStrength: 'temporal-association', limitations: [], timestamp: 1,
  };
}

function stubDeps() {
  const notifications = {
    create: vi.fn(),
    clear: vi.fn(),
    onClicked: { addListener: vi.fn() },
    onClosed: { addListener: vi.fn() },
  };
  const action = {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
    setTitle: vi.fn(),
  };
  const tabs = { create: vi.fn() };
  const runtime = { getURL: (path: string) => `chrome-extension://x/${path}` };
  return { notifications, action, tabs, runtime };
}

function makeEvent(tabId = 7) {
  return createEvent({
    category: 'page', action: 'page.loaded', source: { origin: 'https://shop.example', tabId },
    evidence: { collector: 'page.lifecycle', mechanism: 'content-script', details: {} }, provenance: 'observed',
  });
}

describe('alerts', () => {
  it('alerts and badges only for high-severity findings', () => {
    const deps = stubDeps();
    const alerts = createAlertHandle(deps as never);
    alerts.onFindingsAdded([finding('low-1', 'low'), finding('medium-1', 'medium')], makeEvent());
    expect(deps.notifications.create).not.toHaveBeenCalled();
    expect(deps.action.setBadgeText).not.toHaveBeenCalled();

    alerts.onFindingsAdded([finding('high-1', 'high')], makeEvent());
    expect(deps.notifications.create).toHaveBeenCalledTimes(1);
    expect(deps.action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '!' });
    expect(deps.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 7, color: '#E53945' });
  });

  it('does not re-alert for the same finding id within one worker lifetime', () => {
    const deps = stubDeps();
    const alerts = createAlertHandle(deps as never);
    alerts.onFindingsAdded([finding('high-1', 'high')], makeEvent());
    alerts.onFindingsAdded([finding('high-1', 'high')], makeEvent());
    expect(deps.notifications.create).toHaveBeenCalledTimes(1);
  });

  it('clearForTab removes the badge for that tab only', () => {
    const deps = stubDeps();
    const alerts = createAlertHandle(deps as never);
    alerts.clearForTab(42);
    expect(deps.action.setBadgeText).toHaveBeenCalledWith({ tabId: 42, text: '' });
  });

  it('clearAll resets dedupe so a later identical finding alerts again', () => {
    const deps = stubDeps();
    const alerts = createAlertHandle(deps as never);
    alerts.onFindingsAdded([finding('high-1', 'high')], makeEvent());
    alerts.clearAll();
    alerts.onFindingsAdded([finding('high-1', 'high')], makeEvent());
    expect(deps.notifications.create).toHaveBeenCalledTimes(2);
    // Global badge cleared.
    expect(deps.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
  });
});
