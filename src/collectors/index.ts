import { createNetworkCollector } from './network';
import type { Collector } from './types';

/** Registry of background collectors. Add new ones here. */
export const collectors: readonly Collector[] = [createNetworkCollector()];
