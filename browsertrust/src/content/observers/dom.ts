import type { ContentEventInput } from '../../core/normalize';
import { describeUrl, toDestination } from '../../shared/url';
import type { ContentObserver } from '../observer';

export const DOM_OBSERVER_ID = 'dom.mutations';
export const MAX_DOM_EVENTS_PER_PAGE = 200;

const WATCHED = 'script, iframe, form';

/**
 * Reports script, iframe and form elements being added to the page (and those
 * already present when observation starts). Attribute values other than URLs
 * are never recorded, and inline script text is not read, only its length.
 *
 * Limits: sees what lands in the DOM, not scripts created and run without
 * being attached, and the page can detach the elements before we look.
 */
export function createDomObserver(doc: Document = document): ContentObserver {
  let observer: MutationObserver | undefined;

  return {
    id: DOM_OBSERVER_ID,
    start(context) {
      if (observer) return;
      let reported = 0;
      let truncated = false;
      const seen = new WeakSet<Element>();
      const ownOrigin = doc.location?.origin ?? '';

      const report = (element: Element, initial: boolean) => {
        if (seen.has(element)) return;
        seen.add(element);
        if (reported >= MAX_DOM_EVENTS_PER_PAGE) {
          if (!truncated) {
            truncated = true;
            context.emit(domEvent('events.truncated', { limit: MAX_DOM_EVENTS_PER_PAGE }));
          }
          return;
        }
        reported += 1;
        context.emit(describeElement(element, ownOrigin, initial));
      };

      const visit = (node: Node, initial: boolean) => {
        if (node.nodeType !== 1) return;
        const element = node as Element;
        if (element.matches(WATCHED)) report(element, initial);
        element.querySelectorAll(WATCHED).forEach((child) => report(child, initial));
      };

      visit(doc.documentElement ?? doc.createElement('div'), true);

      observer = new MutationObserver((records) => {
        for (const record of records) record.addedNodes.forEach((node) => visit(node, false));
      });
      observer.observe(doc, { childList: true, subtree: true });
    },
    stop() {
      observer?.disconnect();
      observer = undefined;
    },
  };
}

function domEvent(action: string, details: Record<string, string | number | boolean>): ContentEventInput {
  return {
    category: 'dom',
    action,
    evidence: { collector: DOM_OBSERVER_ID, mechanism: 'content-script', details },
    provenance: 'observed',
  };
}

function describeElement(element: Element, ownOrigin: string, initial: boolean): ContentEventInput {
  const tag = element.tagName.toLowerCase();
  const rawUrl = tag === 'form' ? (element as HTMLFormElement).action : element.getAttribute('src');
  const base = element.ownerDocument.baseURI;
  const description = rawUrl ? describeUrl(rawUrl, base) : undefined;

  const details: Record<string, string | number | boolean> = { tag, initial };
  if (tag === 'script') {
    details.inline = !rawUrl;
    if (!rawUrl) details.inlineLength = element.textContent?.length ?? 0;
    details.async = element.hasAttribute('async');
    details.defer = element.hasAttribute('defer');
  } else if (tag === 'iframe') {
    details.sandboxed = element.hasAttribute('sandbox');
    details.hiddenHint = looksHidden(element);
  } else {
    details.method = ((element as HTMLFormElement).method || 'get').toLowerCase();
  }

  const event = domEvent('element.added', details);
  return description
    ? { ...event, destination: toDestination(description, ownOrigin, { resourceType: tag }) }
    : event;
}

/** Attribute-only heuristic; computed styles are deliberately not read. */
function looksHidden(element: Element): boolean {
  const style = (element.getAttribute('style') ?? '').replace(/\s+/g, '').toLowerCase();
  return (
    element.getAttribute('width') === '0' ||
    element.getAttribute('height') === '0' ||
    element.hasAttribute('hidden') ||
    style.includes('display:none') ||
    style.includes('visibility:hidden')
  );
}
