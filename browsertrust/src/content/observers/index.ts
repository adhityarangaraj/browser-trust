import type { ContentObserver } from '../observer';
import { createDomObserver } from './dom';
import { createFormObserver } from './forms';
import { createHookRelay } from './hook-relay';
import { createPageObserver } from './page';

/** Registry of content-level observers (isolated world). Add new ones here. */
export const observers: readonly ContentObserver[] = [
  createPageObserver(),
  createDomObserver(),
  createFormObserver(),
  createHookRelay(), // attaches its listener immediately; see hook-relay.ts
];
