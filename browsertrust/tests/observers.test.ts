// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContentEventInput } from '../src/core/normalize';
import { createEvent } from '../src/core/normalize';
import { createDomObserver, MAX_DOM_EVENTS_PER_PAGE } from '../src/content/observers/dom';
import { createFormObserver } from '../src/content/observers/forms';
import { createPageObserver } from '../src/content/observers/page';

const source = { origin: 'https://page.example' };
let events: ContentEventInput[];
const context = { emit: (e: ContentEventInput) => void events.push(e) };

beforeEach(() => {
  events = [];
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('every observer event passes full schema validation', () => {
  it('page + dom + form', async () => {
    const observers = [createPageObserver(), createDomObserver(), createFormObserver()];
    observers.forEach((o) => o.start(context));
    document.body.innerHTML = `<form action="https://collector.example/post?x=1" method="POST">
      <input type="password" name="pw"><input type="text" name="n"></form>`;
    await tick();
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));
    observers.forEach((o) => o.stop());
    expect(events.length).toBeGreaterThanOrEqual(3);
    for (const e of events) expect(() => createEvent({ ...e, source })).not.toThrow();
  });
});

describe('dom observer', () => {
  it('reports added scripts and iframes with destination metadata only', async () => {
    const observer = createDomObserver();
    observer.start(context);
    const script = document.createElement('script');
    script.src = 'https://cdn.other.example/lib.js?key=SECRET';
    const frame = document.createElement('iframe');
    frame.setAttribute('width', '0');
    frame.src = 'https://ads.example/frame';
    const inline = document.createElement('script');
    inline.textContent = 'var token = "SECRET-INLINE";';
    document.body.append(script, frame, inline);
    await tick();
    observer.stop();

    const added = events.filter((e) => e.action === 'element.added');
    expect(added).toHaveLength(3);
    expect(added[0]!.destination).toMatchObject({ host: 'cdn.other.example', isCrossOrigin: true });
    expect(added[1]!.evidence.details).toMatchObject({ tag: 'iframe', hiddenHint: true });
    expect(added[2]!.evidence.details).toMatchObject({ inline: true, inlineLength: 28 });
    expect(JSON.stringify(events)).not.toContain('SECRET');
  });

  it('reports existing elements on start and nested additions once', async () => {
    document.body.innerHTML = '<script src="/a.js"></script>';
    const observer = createDomObserver();
    observer.start(context);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<form></form>';
    document.body.append(wrapper);
    await tick();
    observer.stop();
    expect(events.map((e) => e.evidence.details.tag)).toEqual(['script', 'form']);
    expect(events[0]!.evidence.details.initial).toBe(true);
  });

  it('caps events per page and says so once', async () => {
    const observer = createDomObserver();
    observer.start(context);
    for (let i = 0; i < MAX_DOM_EVENTS_PER_PAGE + 20; i++) {
      document.body.append(document.createElement('iframe'));
    }
    await tick();
    observer.stop();
    expect(events.filter((e) => e.action === 'element.added')).toHaveLength(MAX_DOM_EVENTS_PER_PAGE);
    expect(events.filter((e) => e.action === 'events.truncated')).toHaveLength(1);
  });

  it('stops observing after stop()', async () => {
    const observer = createDomObserver();
    observer.start(context);
    observer.stop();
    document.body.append(document.createElement('iframe'));
    await tick();
    expect(events).toHaveLength(0);
  });
});

describe('form observer', () => {
  it('describes submissions without values or field names', () => {
    document.body.innerHTML = `<form id="f" action="https://other.example/collect?a=1" method="post">
      <input type="email" name="secret-field-name" value="me@private.example" autocomplete="email">
      <input type="password" value="hunter2" autocomplete="current-password">
      <input type="hidden" value="csrf"><button>go</button></form>`;
    const observer = createFormObserver();
    observer.start(context);
    document.getElementById('f')!.dispatchEvent(new Event('submit', { bubbles: true }));
    observer.stop();

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event!.destination).toMatchObject({ host: 'other.example', method: 'POST', isCrossOrigin: true });
    expect(event!.evidence.details).toMatchObject({
      method: 'post',
      fieldCount: 3,
      fieldTypes: { email: 1, password: 1, hidden: 1 },
      hasPassword: true,
      sensitiveHints: ['current-password', 'email'],
      isTrusted: false,
    });
    const json = JSON.stringify(events);
    for (const secret of ['hunter2', 'me@private.example', 'secret-field-name', 'csrf']) {
      expect(json).not.toContain(secret);
    }
  });

  it('reports the first edit of each field only', () => {
    document.body.innerHTML = '<form><input id="a" type="text"><input id="b" type="tel"></form>';
    const observer = createFormObserver();
    observer.start(context);
    const a = document.getElementById('a')!;
    a.dispatchEvent(new Event('input', { bubbles: true }));
    a.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('b')!.dispatchEvent(new Event('input', { bubbles: true }));
    observer.stop();
    expect(events.map((e) => e.evidence.details.fieldType)).toEqual(['text', 'tel']);
  });
});

describe('page observer', () => {
  it('reports page.loaded once', () => {
    const observer = createPageObserver();
    observer.start(context);
    observer.start(context);
    observer.stop();
    expect(events.filter((e) => e.action === 'page.loaded')).toHaveLength(1);
  });
});
