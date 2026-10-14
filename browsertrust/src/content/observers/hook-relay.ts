import type { ContentEventInput } from '../../core/normalize';
import {
  HOOK_CATEGORIES,
  HOOK_CHANNEL,
  MAX_HOOK_MESSAGE_CHARS,
  type HookMessage,
} from '../../shared/hook-protocol';
import type { ContentObserver, ObserverContext } from '../observer';

export const HOOK_RELAY_ID = 'page.hook';
export const MAX_HOOK_EVENTS_PER_PAGE = 500;
export const MAX_HOOK_EVENTS_PER_SECOND = 50;
const MAX_BUFFERED = 100;

const ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/**
 * Receives messages from the MAIN-world page hook and forwards them to the
 * background. The page can forge these messages, so they are shape-checked and
 * rate limited here and fully validated again in the background.
 *
 * The listener is attached when this is created (synchronously, before page
 * scripts run) and messages are buffered until start(), so nothing is lost
 * while settings load.
 */
export function createHookRelay(doc: Document = document, now: () => number = Date.now): ContentObserver {
  let context: ObserverContext | undefined;
  const buffer: ContentEventInput[] = [];
  let total = 0;
  let windowStart = 0;
  let inWindow = 0;
  let truncated = false;

  const forward = (event: ContentEventInput) => {
    if (context) context.emit(event);
    else if (buffer.length < MAX_BUFFERED) buffer.push(event);
  };

  const onMessage = (raw: Event) => {
    const detail = (raw as CustomEvent).detail;
    const message = parse(detail);
    if (!message) return;

    const t = now();
    if (t - windowStart >= 1000) {
      windowStart = t;
      inWindow = 0;
    }
    if (total >= MAX_HOOK_EVENTS_PER_PAGE || inWindow >= MAX_HOOK_EVENTS_PER_SECOND) {
      if (!truncated) {
        truncated = true;
        forward({
          category: 'system',
          action: 'hook.truncated',
          evidence: {
            collector: HOOK_RELAY_ID,
            mechanism: 'content-script',
            details: { perPageLimit: MAX_HOOK_EVENTS_PER_PAGE, perSecondLimit: MAX_HOOK_EVENTS_PER_SECOND },
          },
          provenance: 'observed',
        });
      }
      return;
    }
    total += 1;
    inWindow += 1;
    forward({
      category: message.category,
      action: message.action,
      ...(message.destination ? { destination: message.destination } : {}),
      evidence: { collector: HOOK_RELAY_ID, mechanism: 'main-world-hook', details: message.details },
      provenance: 'observed',
    });
  };

  doc.addEventListener(HOOK_CHANNEL, onMessage);

  return {
    id: HOOK_RELAY_ID,
    start(ctx) {
      context = ctx;
      for (const event of buffer.splice(0)) ctx.emit(event);
    },
    stop() {
      context = undefined;
      buffer.length = 0;
    },
  };
}

function parse(detail: unknown): HookMessage | undefined {
  if (typeof detail !== 'string' || detail.length > MAX_HOOK_MESSAGE_CHARS) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(detail);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const m = value as Partial<HookMessage>;
  if (!HOOK_CATEGORIES.includes(m.category as never)) return undefined;
  if (typeof m.action !== 'string' || !ACTION_PATTERN.test(m.action)) return undefined;
  if (typeof m.details !== 'object' || m.details === null || Array.isArray(m.details)) return undefined;
  if (m.destination !== undefined && (typeof m.destination !== 'object' || m.destination === null)) return undefined;
  return m as HookMessage;
}
