/**
 * Full-page alert dialog for high-severity and medium-severity (review recommended)
 * findings, rendered by the isolated content script in the top frame when the background
 * pushes `show-alert`.
 *
 * - Rendered inside a closed shadow root so page CSS cannot restyle it and
 *   page scripts cannot read its contents through the host element.
 * - All text goes through `textContent`; the payload is treated as untrusted
 *   and validated/truncated before rendering.
 * - Limitation: the host element lives in the page's DOM, so a hostile page
 *   can still remove or cover it. The toolbar badge is set independently.
 */
import type { AlertPayload } from '../shared/messages';

const HOST_ID = 'browsertrust-alert-host';
const MAX_TEXT = 600;
const MAX_LIMITATIONS = 5;
const MAX_FINDINGS = 10;
const SVG_NS = 'http://www.w3.org/2000/svg';

const clip = (value: string): string =>
  value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT - 1)}…` : value;

/** Validates an incoming runtime message. Returns the payload or null. */
export function parseShowAlert(message: unknown): AlertPayload | null {
  if (typeof message !== 'object' || message === null) return null;
  const { type, alert } = message as { type?: unknown; alert?: unknown };
  if (type !== 'show-alert' || typeof alert !== 'object' || alert === null) return null;
  const a = alert as Record<string, unknown>;
  const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  if (!isText(a.findingId) || !isText(a.title) || !isText(a.explanation) || !isText(a.evidenceStrength)) {
    return null;
  }
  if (typeof a.timestamp !== 'number' || !Number.isFinite(a.timestamp)) return null;
  if (a.where !== undefined && typeof a.where !== 'string') return null;
  if (!Array.isArray(a.limitations)) return null;
  const limitations = a.limitations
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .slice(0, MAX_LIMITATIONS)
    .map(clip);
  const severity =
    a.severity === 'high' || a.severity === 'medium' || a.severity === 'low'
      ? a.severity
      : 'medium';
  return {
    findingId: clip(a.findingId),
    title: clip(a.title),
    explanation: clip(a.explanation),
    severity,
    evidenceStrength: clip(a.evidenceStrength),
    ...(a.where ? { where: clip(a.where) } : {}),
    limitations,
    timestamp: a.timestamp,
  };
}

export interface AlertOverlay {
  /** Shows the dialog, or adds the finding to the one already open. */
  show(alert: AlertPayload): void;
  close(): void;
  isOpen(): boolean;
}

/** `shadowMode` is 'closed' in production; tests pass 'open' to inspect the dialog. */
export function createAlertOverlay(
  doc: Document = document,
  shadowMode: ShadowRootMode = 'closed',
): AlertOverlay {
  let host: HTMLElement | undefined;
  let backdrop: HTMLElement | undefined;
  let dialog: HTMLElement | undefined;
  let icon: HTMLElement | undefined;
  let eyebrow: HTMLElement | undefined;
  let h2: HTMLElement | undefined;
  let summary: HTMLElement | undefined;
  let list: HTMLElement | undefined;
  let countLabel: HTMLElement | undefined;
  let dismissButton: HTMLButtonElement | undefined;
  let shadow: ShadowRoot | undefined;
  let previousFocus: Element | null = null;
  const findings = new Map<string, AlertPayload>();

  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const warningIcon = (): SVGSVGElement => {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M12 3 2 20.5h20L12 3Zm0 6v5.5m0 3v.01');
    svg.append(path);
    return svg;
  };

  const updateDialogState = (): void => {
    if (!dialog || !h2 || !summary || !eyebrow || !icon || !dismissButton || !countLabel || !backdrop) return;
    const all = Array.from(findings.values());
    const hasHigh = all.some((f) => f.severity === 'high');
    const n = all.length;

    if (hasHigh) {
      backdrop.classList.remove('review');
      dialog.classList.remove('review');
      icon.classList.remove('review');
      eyebrow.classList.remove('review');
      dismissButton.classList.remove('review');
      eyebrow.textContent = 'BrowserTrust alert';
      h2.textContent = 'Suspicious activity detected';
      summary.textContent =
        `BrowserTrust observed behavior on ${doc.location?.host || 'this page'} that matches a high-severity rule. ` +
        'This is based on observed metadata and is not proof of what data was sent.';
      countLabel.textContent =
        n === 1 ? '1 high-severity finding' : `${n} findings (including high severity)`;
    } else {
      backdrop.classList.add('review');
      dialog.classList.add('review');
      icon.classList.add('review');
      eyebrow.classList.add('review');
      dismissButton.classList.add('review');
      eyebrow.textContent = 'BrowserTrust notice';
      h2.textContent = 'Review recommended';
      summary.textContent =
        `BrowserTrust observed behavior on ${doc.location?.host || 'this page'} that matches a medium-severity review rule. ` +
        'This is based on observed metadata and is not proof of what data was sent.';
      countLabel.textContent =
        n === 1 ? '1 review finding' : `${n} review findings`;
    }
  };

  const renderFinding = (alert: AlertPayload): HTMLElement => {
    const item = el('article', 'finding');
    const header = el('div', 'finding-head');
    header.append(el('span', `badge ${alert.severity}`, alert.severity.toUpperCase()), el('h3', 'finding-title', alert.title));
    item.append(header);
    item.append(el('p', 'explanation', alert.explanation));

    const meta = el('dl', 'meta');
    const addMeta = (label: string, value: string): void => {
      const row = el('div');
      row.append(el('dt', undefined, label), el('dd', undefined, value));
      meta.append(row);
    };
    if (alert.where) addMeta('Where', alert.where);
    addMeta('Evidence', alert.evidenceStrength);
    addMeta('Observed', new Date(alert.timestamp).toLocaleTimeString());
    item.append(meta);

    if (alert.limitations.length > 0) {
      const limits = el('details', 'limits');
      limits.append(el('summary', undefined, 'What this evidence does not establish'));
      const ul = el('ul');
      for (const limitation of alert.limitations) ul.append(el('li', undefined, limitation));
      limits.append(ul);
      item.append(limits);
    }
    return item;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab' && shadow) {
      // Keep keyboard focus inside the dialog while it is open.
      const focusables = Array.from(shadow.querySelectorAll<HTMLElement>('summary, button'));
      if (focusables.length === 0) return;
      const index = focusables.indexOf(shadow.activeElement as HTMLElement);
      const step = event.shiftKey ? -1 : 1;
      const next = focusables[(index + step + focusables.length) % focusables.length];
      event.preventDefault();
      next?.focus();
    }
  };

  const build = (): void => {
    host = el('div');
    host.id = HOST_ID;
    host.setAttribute('style', 'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important;');
    const root = host.attachShadow({ mode: shadowMode });
    shadow = root;
    const style = el('style');
    style.textContent = STYLES;

    backdrop = el('div', 'backdrop');
    dialog = el('section', 'dialog');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'bt-heading');
    dialog.setAttribute('aria-describedby', 'bt-summary');
    dialog.addEventListener('keydown', onKeyDown);

    const top = el('header', 'top');
    icon = el('div', 'icon');
    icon.append(warningIcon());
    const headings = el('div');
    eyebrow = el('p', 'eyebrow', 'BrowserTrust alert');
    headings.append(eyebrow);
    h2 = el('h2', undefined, 'Suspicious activity detected');
    h2.id = 'bt-heading';
    headings.append(h2);
    countLabel = el('p', 'count');
    headings.append(countLabel);
    top.append(icon, headings);

    summary = el(
      'p',
      'summary',
      `BrowserTrust observed behavior on ${doc.location?.host || 'this page'} that matches a review rule. ` +
        'This is based on observed metadata and is not proof of what data was sent.',
    );
    summary.id = 'bt-summary';

    list = el('div', 'findings');

    const footer = el('footer', 'footer');
    footer.append(el('p', 'hint', 'Open the BrowserTrust toolbar icon to review the full evidence.'));
    dismissButton = el('button', 'dismiss', 'Dismiss');
    dismissButton.type = 'button';
    dismissButton.addEventListener('click', () => close());
    footer.append(dismissButton);

    dialog.append(top, summary, list, footer);
    backdrop.append(dialog);
    root.append(style, backdrop);
    (doc.body ?? doc.documentElement).append(host);
  };

  function close(): void {
    host?.remove();
    host = backdrop = dialog = icon = eyebrow = h2 = summary = list = countLabel = dismissButton = undefined;
    shadow = undefined;
    findings.clear();
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
    previousFocus = null;
  }

  return {
    show(alert) {
      if (findings.has(alert.findingId) || findings.size >= MAX_FINDINGS) return;
      if (!host || !host.isConnected) {
        close();
        previousFocus = doc.activeElement;
        build();
      }
      findings.set(alert.findingId, alert);
      list?.append(renderFinding(alert));
      updateDialogState();
      dismissButton?.focus();
    },
    close,
    isOpen: () => host?.isConnected === true,
  };
}

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.backdrop {
  position: fixed; inset: 0; display: grid; place-items: center; padding: 24px;
  background: radial-gradient(circle at 50% 30%, rgba(229, 57, 69, 0.28), rgba(8, 9, 12, 0.82) 70%);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #fff;
  animation: fade 180ms ease-out;
}
.backdrop.review {
  background: radial-gradient(circle at 50% 30%, rgba(245, 158, 11, 0.24), rgba(8, 9, 12, 0.82) 70%);
}
.dialog {
  width: min(560px, 100%); max-height: min(86vh, 760px); display: flex; flex-direction: column;
  background: linear-gradient(180deg, #1d1f25 0%, #15161a 100%);
  border: 1px solid rgba(229, 57, 69, 0.55); border-radius: 18px;
  box-shadow: 0 0 0 6px rgba(229, 57, 69, 0.12), 0 30px 80px rgba(0, 0, 0, 0.6);
  overflow: hidden; animation: pop 220ms cubic-bezier(.2, .9, .3, 1.2);
}
.dialog.review {
  border-color: rgba(245, 158, 11, 0.55);
  box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.12), 0 30px 80px rgba(0, 0, 0, 0.6);
}
.top { display: flex; gap: 16px; align-items: center; padding: 24px 24px 12px; }
.icon {
  flex: none; display: grid; place-items: center; width: 56px; height: 56px; border-radius: 16px;
  background: #e53945; box-shadow: 0 8px 24px rgba(229, 57, 69, 0.45); animation: pulse 1.8s ease-in-out infinite;
}
.icon.review {
  background: #f59e0b;
  box-shadow: 0 8px 24px rgba(245, 158, 11, 0.45);
}
.icon svg { width: 30px; height: 30px; fill: none; stroke: #fff; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.eyebrow { margin: 0; color: #ff8a92; font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
.eyebrow.review { color: #fbbf24; }
h2 { margin: 2px 0 0; font-size: 22px; line-height: 1.2; font-weight: 750; }
.count { margin: 2px 0 0; color: #b8bec8; font-size: 12px; }
.summary { margin: 0; padding: 0 24px 16px; color: #d4d8de; }
.findings { display: grid; gap: 12px; padding: 0 24px 16px; overflow: auto; }
.finding { background: #202329; border: 1px solid #30343b; border-radius: 12px; padding: 14px 16px; }
.finding-head { display: flex; gap: 10px; align-items: center; }
.badge { flex: none; padding: 2px 8px; border-radius: 999px; background: rgba(229, 57, 69, 0.18); color: #ff8a92; font-size: 11px; font-weight: 800; letter-spacing: .05em; }
.badge.medium { background: rgba(245, 158, 11, 0.18); color: #fbbf24; }
.badge.low { background: rgba(184, 190, 200, 0.18); color: #d4d8de; }
.finding-title { margin: 0; font-size: 15px; font-weight: 650; }
.explanation { margin: 8px 0 10px; color: #d4d8de; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0; font-size: 12px; }
.meta div { display: flex; gap: 6px; min-width: 0; }
.meta dt { color: #8c939e; }
.meta dd { margin: 0; color: #fff; overflow-wrap: anywhere; }
.limits { margin-top: 10px; font-size: 12px; color: #b8bec8; }
.limits summary { cursor: pointer; color: #b8bec8; }
.limits ul { margin: 6px 0 0; padding-left: 18px; }
.footer { display: flex; gap: 16px; align-items: center; justify-content: space-between; padding: 14px 24px; border-top: 1px solid #30343b; background: #17181c; }
.hint { margin: 0; color: #8c939e; font-size: 12px; }
.dismiss {
  flex: none; font: inherit; font-weight: 650; color: #fff; cursor: pointer;
  padding: 10px 22px; border: 0; border-radius: 10px; background: #e53945;
  transition: background 120ms ease, transform 120ms ease;
}
.dismiss.review { background: #f59e0b; }
.dismiss.review:hover { background: #d97706; }
.dismiss:hover { background: #f04a56; transform: translateY(-1px); }
.dismiss:focus-visible { outline: 3px solid rgba(255, 138, 146, 0.6); outline-offset: 2px; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop { from { opacity: 0; transform: translateY(12px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes pulse { 0%, 100% { box-shadow: 0 8px 24px rgba(229, 57, 69, 0.45); } 50% { box-shadow: 0 8px 34px rgba(229, 57, 69, 0.8); } }
@media (prefers-reduced-motion: reduce) { .backdrop, .dialog, .icon { animation: none; } }
`;
