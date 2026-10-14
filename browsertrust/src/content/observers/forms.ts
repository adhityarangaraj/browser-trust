import type { ContentEventInput } from '../../core/normalize';
import { describeUrl, toDestination } from '../../shared/url';
import type { ContentObserver } from '../observer';

export const FORM_OBSERVER_ID = 'form.interaction';

/** Standard autocomplete tokens that indicate sensitive data. Anything else is not recorded. */
const SENSITIVE_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-name',
  'username',
  'email',
  'tel',
  'street-address',
  'postal-code',
  'bday',
]);

/**
 * Reports form submissions and first edits of fields. Only structure is
 * recorded (field types, counts, destination); never values or field names.
 *
 * Limits: `submit` events do not fire for form.submit() calls (the page hook
 * covers those) and say nothing about data sent with fetch/XHR instead.
 */
export function createFormObserver(doc: Document = document): ContentObserver {
  let teardown: (() => void) | undefined;

  return {
    id: FORM_OBSERVER_ID,
    start(context) {
      if (teardown) return;
      const ownOrigin = doc.location?.origin ?? '';
      const edited = new WeakSet<Element>();

      const onSubmit = (event: Event) => {
        const form = event.target;
        if (!isForm(form)) return;
        context.emit(describeSubmission(form, ownOrigin, event.isTrusted));
      };

      const onInput = (event: Event) => {
        const field = event.target;
        if (!isField(field) || edited.has(field)) return;
        edited.add(field);
        context.emit(describeEdit(field, event.isTrusted));
      };

      doc.addEventListener('submit', onSubmit, true);
      doc.addEventListener('input', onInput, true);
      teardown = () => {
        doc.removeEventListener('submit', onSubmit, true);
        doc.removeEventListener('input', onInput, true);
      };
    },
    stop() {
      teardown?.();
      teardown = undefined;
    },
  };
}

// Duck-typed on purpose: `instanceof Element` fails across frames and JS worlds.
function tagOf(target: unknown): string | undefined {
  const node = target as { nodeType?: number; tagName?: unknown } | null;
  return node?.nodeType === 1 && typeof node.tagName === 'string' ? node.tagName : undefined;
}

function isForm(target: unknown): target is HTMLFormElement {
  return tagOf(target) === 'FORM';
}

function isField(target: unknown): target is HTMLInputElement {
  const tag = tagOf(target);
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function fieldType(field: Element): string {
  const tag = field.tagName.toLowerCase();
  return tag === 'input' ? ((field as HTMLInputElement).type || 'text').toLowerCase() : tag;
}

function sensitiveHints(fields: Iterable<Element>): string[] {
  const hints = new Set<string>();
  for (const field of fields) {
    for (const token of (field.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/)) {
      if (SENSITIVE_AUTOCOMPLETE.has(token)) hints.add(token);
    }
  }
  return [...hints].sort();
}

function describeSubmission(form: HTMLFormElement, ownOrigin: string, isTrusted: boolean): ContentEventInput {
  const fields = Array.from(form.elements).filter(isField);
  const types: Record<string, number> = {};
  for (const field of fields) {
    const type = fieldType(field);
    types[type] = (types[type] ?? 0) + 1;
  }
  const description = describeUrl(form.action, form.ownerDocument.baseURI);
  const method = (form.method || 'get').toLowerCase();

  return {
    category: 'form',
    action: 'form.submitted',
    ...(description ? { destination: toDestination(description, ownOrigin, { method: method.toUpperCase() }) } : {}),
    evidence: {
      collector: FORM_OBSERVER_ID,
      mechanism: 'content-script',
      details: {
        method,
        fieldCount: fields.length,
        fieldTypes: types,
        hasPassword: (types.password ?? 0) > 0,
        hasFileInput: (types.file ?? 0) > 0,
        sensitiveHints: sensitiveHints(fields),
        isTrusted,
      },
    },
    provenance: 'observed',
  };
}

function describeEdit(field: Element, isTrusted: boolean): ContentEventInput {
  const form = (field as HTMLInputElement).form;
  const hints = sensitiveHints([field]);
  return {
    category: 'form',
    action: 'field.edited',
    evidence: {
      collector: FORM_OBSERVER_ID,
      mechanism: 'content-script',
      details: { fieldType: fieldType(field), inForm: form !== null, sensitiveHints: hints, isTrusted },
    },
    provenance: 'observed',
  };
}
