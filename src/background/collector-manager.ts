import type { Collector, CollectorContext, CollectorStatus } from '../collectors/types';

/** Starts and stops collectors according to the monitoring switch. */
export class CollectorManager {
  private readonly running = new Set<string>();

  constructor(
    private readonly collectors: readonly Collector[],
    private readonly context: CollectorContext,
  ) {}

  async sync(monitoringEnabled: boolean): Promise<void> {
    for (const collector of this.collectors) {
      const isRunning = this.running.has(collector.id);
      try {
        if (monitoringEnabled && !isRunning) {
          await collector.start(this.context);
          this.running.add(collector.id);
        } else if (!monitoringEnabled && isRunning) {
          await collector.stop();
          this.running.delete(collector.id);
        }
      } catch (error) {
        console.error(`BrowserTrust: collector ${collector.id} failed`, error);
      }
    }
  }

  status(): CollectorStatus[] {
    return this.collectors.map((c) => ({
      id: c.id,
      categories: c.categories,
      mechanism: c.mechanism,
      running: this.running.has(c.id),
    }));
  }
}
