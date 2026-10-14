import type { Collector } from './types';

/**
 * Registry of background collectors. Phase 1 ships none.
 * Phase 2+ adds entries here (e.g. a webRequest metadata collector).
 */
export const collectors: readonly Collector[] = [];
