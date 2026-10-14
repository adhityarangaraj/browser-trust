import { describeUrl } from '../../shared/url';
import type { ContentObserver } from '../observer';

export const PAGE_OBSERVER_ID = 'page.lifecycle';

/** Reports that BrowserTrust's content script is observing a loaded page or frame. */
export function createPageObserver(doc: Document = document): ContentObserver {
  let cleanup: (() => void) | undefined;

  return {
    id: PAGE_OBSERVER_ID,
    start(context) {
      if (cleanup) return;
      const win = doc.defaultView;
      const report = () => {
        const referrer = doc.referrer ? describeUrl(doc.referrer) : undefined;
        const ownOrigin = doc.location?.origin ?? '';
        context.emit({
          category: 'page',
          action: 'page.loaded',
          evidence: {
            collector: PAGE_OBSERVER_ID,
            mechanism: 'content-script',
            details: {
              isTopFrame: win ? win.top === win : true,
              readyState: doc.readyState,
              hasReferrer: referrer !== undefined,
              referrerCrossOrigin: referrer ? referrer.origin !== ownOrigin : false,
            },
          },
          provenance: 'observed',
        });
      };

      if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', report, { once: true });
        cleanup = () => doc.removeEventListener('DOMContentLoaded', report);
      } else {
        report();
        cleanup = () => undefined;
      }
    },
    stop() {
      cleanup?.();
      cleanup = undefined;
    },
  };
}
