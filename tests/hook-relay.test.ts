// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ContentEventInput } from '../src/core/normalize';
import {
  createHookRelay,
  MAX_HOOK_EVENTS_PER_PAGE,
  MAX_HOOK_EVENTS_PER_SECOND,
} from '../src/content/observers/hook-relay';
import { HOOK_CHANNEL, type HookMessage } from '../src/shared/hook-protocol';

const send = (detail: unknown) =>
  document.dispatchEvent(new CustomEvent(HOOK_CHANNEL, { detail }));
const msg = (overrides: Partial<HookMessage> = {}): string =>
  JSON.stringify({ category: 'storage', action: 'storage.write', details: { area: 'local' }, ...overrides });

function relay(now?: () => number) {
  const events: ContentEventInput[] = [];
  const observer = createHookRelay(document, now);
  return { observer, events, ctx: { emit: (e: ContentEventInput) => void events.push(e) } };
}

describe('hook relay', () => {
  it('forwards valid messages as main-world-hook events', () => {
    const { observer, events, ctx } = relay(() => 0);
    observer.start(ctx);
    send(msg());
    observer.stop();
    expect(events).toEqual([
      {
        category: 'storage',
        action: 'storage.write',
        evidence: { collector: 'page.hook', mechanism: 'main-world-hook', details: { area: 'local' } },
        provenance: 'observed',
      },
    ]);
  });

  it('buffers messages that arrive before start()', () => {
    const { observer, events, ctx } = relay(() => 0);
    send(msg());
    expect(events).toHaveLength(0);
    observer.start(ctx);
    expect(events).toHaveLength(1);
    observer.stop();
  });

  it('drops malformed, oversized and disallowed messages', () => {
    const { observer, events, ctx } = relay(() => 0);
    observer.start(ctx);
    send({ category: 'storage' }); // not a string
    send('not json');
    send(msg({ category: 'system' as never }));
    send(msg({ action: 'Bad Action' }));
    send(JSON.stringify({ category: 'storage', action: 'a.b', details: { x: 'y'.repeat(5000) } }));
    observer.stop();
    expect(events).toHaveLength(0);
  });

  it('rate limits per second and reports truncation once', () => {
    let t = 0;
    const { observer, events, ctx } = relay(() => t);
    observer.start(ctx);
    for (let i = 0; i < MAX_HOOK_EVENTS_PER_SECOND + 30; i++) send(msg());
    expect(events.filter((e) => e.action === 'storage.write')).toHaveLength(MAX_HOOK_EVENTS_PER_SECOND);
    expect(events.filter((e) => e.action === 'hook.truncated')).toHaveLength(1);
    t = 2000;
    send(msg());
    expect(events.filter((e) => e.action === 'storage.write')).toHaveLength(MAX_HOOK_EVENTS_PER_SECOND + 1);
    observer.stop();
    expect(MAX_HOOK_EVENTS_PER_PAGE).toBeGreaterThan(MAX_HOOK_EVENTS_PER_SECOND);
  });
});
