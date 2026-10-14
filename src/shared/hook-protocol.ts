import type { EventDestination, JsonValue } from './types';

/**
 * Wire format between the MAIN-world page hook and the isolated content script.
 *
 * The page and the hook share one JavaScript world, so anything the hook sends
 * can also be forged or suppressed by the page. The relay and the background
 * therefore treat hook messages as untrusted input (validated, rate limited),
 * and rules must not read the absence of a hook event as proof of absence.
 */
export const HOOK_CHANNEL = '__browsertrust_hook__';

export const HOOK_CATEGORIES = ['network', 'storage', 'capability', 'form'] as const;
export type HookCategory = (typeof HOOK_CATEGORIES)[number];

export const MAX_HOOK_MESSAGE_CHARS = 4096;

export interface HookMessage {
  category: HookCategory;
  /** Lowercase dotted verb, e.g. "request.sent". */
  action: string;
  destination?: EventDestination;
  details: { [key: string]: JsonValue };
}
