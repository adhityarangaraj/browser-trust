// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createAlertOverlay, parseShowAlert } from '../src/content/alert-overlay';
import type { AlertPayload } from '../src/shared/messages';

const payload = (id = 'f-1', overrides: Partial<AlertPayload> = {}): AlertPayload => ({
  findingId: id,
  title: 'Repeated cross-origin POST burst',
  explanation: 'The page sent 6 POST requests to collector.example.',
  severity: 'high',
  evidenceStrength: 'repeated pattern',
  where: 'collector.example',
  limitations: ['Repetition is not malicious intent.'],
  timestamp: 1_700_000_000_000,
  ...overrides,
});

const host = () => document.getElementById('browsertrust-alert-host');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('parseShowAlert', () => {
  it('accepts a well-formed show-alert message', () => {
    expect(parseShowAlert({ type: 'show-alert', alert: payload() })).toEqual(payload());
  });

  it('accepts medium severity findings for review recommended', () => {
    const med = payload('m-1', { severity: 'medium' });
    expect(parseShowAlert({ type: 'show-alert', alert: med })).toEqual(med);
  });

  it('rejects other message types and malformed payloads', () => {
    expect(parseShowAlert(null)).toBeNull();
    expect(parseShowAlert({ type: 'ingest-event', alert: payload() })).toBeNull();
    expect(parseShowAlert({ type: 'show-alert', alert: { ...payload(), title: 42 } })).toBeNull();
    expect(parseShowAlert({ type: 'show-alert', alert: { ...payload(), limitations: 'x' } })).toBeNull();
    expect(parseShowAlert({ type: 'show-alert', alert: { ...payload(), timestamp: Number.NaN } })).toBeNull();
  });

  it('truncates long text and caps limitations', () => {
    const parsed = parseShowAlert({
      type: 'show-alert',
      alert: payload('f', { explanation: 'x'.repeat(5000), limitations: Array(20).fill('limit') }),
    });
    expect(parsed?.explanation.length).toBeLessThanOrEqual(600);
    expect(parsed?.limitations).toHaveLength(5);
  });
});

describe('createAlertOverlay', () => {
  it('renders a modal alert dialog with the finding as text, not HTML', () => {
    const overlay = createAlertOverlay(document, 'open');
    overlay.show(payload('f-1', { title: '<img src=x onerror=alert(1)>' }));
    const root = host()?.shadowRoot;
    expect(overlay.isOpen()).toBe(true);
    const dialog = root?.querySelector('[role="alertdialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(root?.querySelector('h2')?.textContent).toBe('Suspicious activity detected');
    expect(root?.querySelector('.finding-title')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(root?.querySelector('img')).toBeNull();
    expect(root?.textContent).toContain('collector.example');
    expect(root?.textContent).toContain('Repetition is not malicious intent.');
  });

  it('renders "Review recommended" for medium-severity findings', () => {
    const overlay = createAlertOverlay(document, 'open');
    overlay.show(payload('m-1', { severity: 'medium', title: 'Form activity followed by network' }));
    const root = host()?.shadowRoot;
    expect(overlay.isOpen()).toBe(true);
    expect(root?.querySelector('h2')?.textContent).toBe('Review recommended');
    expect(root?.querySelector('.count')?.textContent).toBe('1 review finding');
    expect(root?.querySelector('.badge')?.textContent).toBe('MEDIUM');
    expect(root?.querySelector('.dialog')?.classList.contains('review')).toBe(true);
  });

  it('elevates from Review recommended to Suspicious activity when high finding is added', () => {
    const overlay = createAlertOverlay(document, 'open');
    overlay.show(payload('m-1', { severity: 'medium' }));
    const root = host()?.shadowRoot;
    expect(root?.querySelector('h2')?.textContent).toBe('Review recommended');

    overlay.show(payload('h-1', { severity: 'high' }));
    expect(root?.querySelector('h2')?.textContent).toBe('Suspicious activity detected');
    expect(root?.querySelector('.dialog')?.classList.contains('review')).toBe(false);
    expect(root?.querySelector('.count')?.textContent).toContain('including high severity');
  });

  it('stacks additional findings into the open dialog and ignores duplicates', () => {
    const overlay = createAlertOverlay(document, 'open');
    overlay.show(payload('f-1'));
    overlay.show(payload('f-2'));
    overlay.show(payload('f-1'));
    const root = host()?.shadowRoot;
    expect(document.querySelectorAll('#browsertrust-alert-host')).toHaveLength(1);
    expect(root?.querySelectorAll('.finding')).toHaveLength(2);
    expect(root?.querySelector('.count')?.textContent).toContain('2 findings');
  });

  it('closes on Dismiss and on Escape', () => {
    const overlay = createAlertOverlay(document, 'open');
    overlay.show(payload('f-1'));
    (host()?.shadowRoot?.querySelector('.dismiss') as HTMLButtonElement).click();
    expect(overlay.isOpen()).toBe(false);
    expect(host()).toBeNull();

    overlay.show(payload('f-2'));
    host()?.shadowRoot?.querySelector('[role="alertdialog"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay.isOpen()).toBe(false);
  });

  it('rebuilds if the page removed the host element', () => {
    const overlay = createAlertOverlay(document, 'open');
    overlay.show(payload('f-1'));
    host()?.remove();
    overlay.show(payload('f-2'));
    expect(overlay.isOpen()).toBe(true);
    expect(host()?.shadowRoot?.querySelectorAll('.finding')).toHaveLength(1);
  });
});
