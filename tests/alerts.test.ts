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

function makeEvent(tabId = 7, origin = 'https://shop.example') {
  return createEvent({
    category: 'page', action: 'page.loaded', source: { origin, tabId },
    evidence: { collector: 'page.lifecycle', mechanism: 'content-script', details: {} }, provenance: 'observed',
  });
}

describe('alerts', () => {
  it('does not alert for low-severity findings, but alerts and badges for medium and high', () => {
    const deps = stubDeps();
    const alerts = createAlertHandle(deps as never);
    alerts.onFindingsAdded([finding('low-1', 'low')], makeEvent());
    expect(deps.notifications.create).not.toHaveBeenCalled();
    expect(deps.action.setBadgeText).not.toHaveBeenCalled();

    alerts.onFindingsAdded([finding('medium-1', 'medium')], makeEvent());
    expect(deps.notifications.create).toHaveBeenCalledTimes(1);
    expect(deps.action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '!' });
    expect(deps.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 7, color: '#F59E0B' });

    alerts.onFindingsAdded([finding('high-1', 'high')], makeEvent());
    expect(deps.notifications.create).toHaveBeenCalledTimes(2);
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

  it('does not notify for events whose source host is on the common-sites allowlist', () => {
    const deps = stubDeps();
    const alerts = createAlertHandle(deps as never);
    alerts.onFindingsAdded([finding('high-gh', 'high')], makeEvent(9, 'https://github.com'));
    alerts.onFindingsAdded([finding('high-yt', 'high')], makeEvent(10, 'https://music.youtube.com'));
    expect(deps.notifications.create).not.toHaveBeenCalled();
    expect(deps.action.setBadgeText).not.toHaveBeenCalled();
    // An unlisted host still alerts.
    alerts.onFindingsAdded([finding('high-x', 'high')], makeEvent(11, 'https://unknown.example'));
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

  it('shows the in-page dialog in the top frame when the content script acknowledges', async () => {
    const deps = stubDeps();
    const sendMessage = vi.fn().mockResolvedValue({ shown: true });
    const alerts = createAlertHandle({ ...deps, tabs: { ...deps.tabs, sendMessage } } as never);
    alerts.onFindingsAdded([finding('high-1', 'high')], makeEvent());
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    const [tabId, message, options] = sendMessage.mock.calls[0]!;
    expect(tabId).toBe(7);
    expect(options).toEqual({ frameId: 0 });
    expect(message).toMatchObject({
      type: 'show-alert',
      alert: { findingId: 'high-1', where: 'tracker.example', evidenceStrength: 'temporal association' },
    });
    await Promise.resolve();
    expect(deps.notifications.create).not.toHaveBeenCalled();
    expect(deps.action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '!' });
  });

  it('falls back to an OS notification when the tab has no content script', async () => {
    const deps = stubDeps();
    const sendMessage = vi.fn().mockRejectedValue(new Error('Receiving end does not exist.'));
    const alerts = createAlertHandle({ ...deps, tabs: { ...deps.tabs, sendMessage } } as never);
    alerts.onFindingsAdded([finding('high-1', 'high')], makeEvent());
    await vi.waitFor(() => expect(deps.notifications.create).toHaveBeenCalledTimes(1));
  });

  it('falls back to an OS notification when the content script does not acknowledge', async () => {
    const deps = stubDeps();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const alerts = createAlertHandle({ ...deps, tabs: { ...deps.tabs, sendMessage } } as never);
    alerts.onFindingsAdded([finding('high-1', 'high')], makeEvent());
    await vi.waitFor(() => expect(deps.notifications.create).toHaveBeenCalledTimes(1));
  });
});
