import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Collector } from '../src/collectors/types';
import { CollectorManager } from '../src/background/collector-manager';

describe('CollectorManager permission state', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports an ungranted optional permission and activates after it is granted', async () => {
    let granted = false;
    vi.stubGlobal('chrome', { permissions: { contains: async () => granted } });
    const collector: Collector = {
      id: 'network.test',
      categories: ['network'],
      mechanism: 'extension-api',
      requiredPermissions: ['webRequest'],
      isAvailable: () => true,
      attach: () => undefined,
    };
    const manager = new CollectorManager([collector], async () => undefined);
    manager.setMonitoring(true);

    expect((await manager.status())[0]?.state).toBe('needs-permission');
    granted = true;
    expect((await manager.status())[0]?.state).toBe('active');
  });
});
