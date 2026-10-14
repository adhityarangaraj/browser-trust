import type { ContentObserver } from '../observer';

/**
 * Registry of content-level observers. Phase 1 ships none.
 * Phase 2+ adds DOM and form observers here.
 */
export const observers: readonly ContentObserver[] = [];
