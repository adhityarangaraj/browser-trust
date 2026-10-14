import type { NewEvent } from '../core/normalize';
import type { Collector, CollectorStatus } from '../collectors/types';

/**
 * Attaches collectors and gates their events on the monitoring switch.
 * Listeners are attached once per worker start (and again when a permission is
 * granted); the switch is checked per event, so toggling needs no re-attach.
 */
export class CollectorManager {
  private enabled = false;
  private markReady!: () => void;
  private readonly ready = new Promise<void>((resolve) => {
    this.markReady = resolve;
  });

  constructor(
    private readonly collectors: readonly Collector[],
    private readonly sink: (event: NewEvent) => Promise<void>,
  ) {}

  /** Synchronous. Call at the top level of the service worker and after permission changes. */
  attachAll(): void {
    const context = {
      emit: async (event: NewEvent) => {
        await this.ready; // events can arrive before settings finish loading
        if (this.enabled) await this.sink(event);
      },
    };
    for (const collector of this.collectors) {
      try {
        collector.attach(context);
      } catch (error) {
        console.error(`BrowserTrust: collector ${collector.id} failed to attach`, error);
      }
    }
  }

  setMonitoring(enabled: boolean): void {
    this.enabled = enabled;
    this.markReady();
  }

  status(): CollectorStatus[] {
    return this.collectors.map((c) => ({
      id: c.id,
      categories: c.categories,
      mechanism: c.mechanism,
      requiredPermissions: c.requiredPermissions ?? [],
      state: !c.isAvailable() ? 'needs-permission' : this.enabled ? 'active' : 'paused',
    }));
  }
}
