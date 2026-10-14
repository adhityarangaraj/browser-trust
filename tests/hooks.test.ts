/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { createEvent } from '../src/core/normalize';
import { installHooks } from '../src/page-hooks/hooks';
import type { HookMessage } from '../src/shared/hook-protocol';

/** A stand-in for `window` with just enough platform objects to wrap. */
function fakeWindow() {
  const calls: string[] = [];
  class FakeStorage {
    private data = new Map<string, string>();
    setItem(k: string, v: string) {
      calls.push('setItem');
      this.data.set(k, String(v));
    }
    getItem(k: string) {
      calls.push('getItem');
      return this.data.get(k) ?? null;
    }
    removeItem(k: string) {
      this.data.delete(k);
    }
    clear() {
      this.data.clear();
    }
  }
  class FakeXHR {
    open(..._args: unknown[]) {
      calls.push('open');
    }
    send(..._args: unknown[]) {
      calls.push('send');
    }
  }
  class FakeDocument {
    private jar = '';
    get cookie() {
      return this.jar;
    }
    set cookie(v: string) {
      this.jar = v.split(';')[0] ?? '';
    }
  }
  class FakeClipboard {
    async readText() {
      return 'CLIPBOARD-SECRET';
    }
    async writeText(_t: string) {}
  }
  class FakeGeolocation {
    getCurrentPosition(_ok: unknown, _err?: unknown, _o?: unknown) {}
    watchPosition(_ok: unknown, _err?: unknown, _o?: unknown) {
      return 1;
    }
  }
  class FakeMediaDevices {
    async getUserMedia(_c: unknown) {
      return {};
    }
  }
  class FakeForm {
    action = 'https://collector.example/post?x=1';
    method = 'post';
    elements = [1, 2, 3];
    submit() {
      calls.push('form.submit');
    }
  }
  class FakeNavigator {
    sendBeacon(_u: string, _d?: unknown) {
      return true;
    }
  }
  const localStorage = new FakeStorage();
  const sessionStorage = new FakeStorage();
  const win: any = {
    location: { origin: 'https://page.example', href: 'https://page.example/app' },
    fetch: async (..._args: unknown[]) => {
      calls.push('fetch');
      return { ok: true };
    },
    XMLHttpRequest: FakeXHR,
    Storage: FakeStorage,
    localStorage,
    sessionStorage,
    Document: FakeDocument,
    Clipboard: FakeClipboard,
    Geolocation: FakeGeolocation,
    MediaDevices: FakeMediaDevices,
    HTMLFormElement: FakeForm,
    Navigator: FakeNavigator,
    WebSocket: class FakeWebSocket {
      constructor(public url: string) {
        calls.push('ws');
      }
    },
  };
  return { win, calls, FakeXHR, FakeDocument, FakeClipboard, FakeGeolocation, FakeMediaDevices, FakeForm, FakeNavigator };
}

function setup() {
  const f = fakeWindow();
  const messages: HookMessage[] = [];
  const installed = installHooks(f.win, (m) => messages.push(m));
  return { ...f, messages, installed };
}

const toSource = { origin: 'https://page.example' };

describe('installHooks', () => {
  it('installs every hook on a full platform and tolerates a bare window', () => {
    expect(setup().installed).toEqual(
      expect.arrayContaining(['fetch', 'xhr.open', 'xhr.send', 'beacon', 'websocket', 'storage.setItem', 'cookie', 'clipboard.readText', 'geolocation.getCurrentPosition', 'media.getUserMedia', 'form.submit']),
    );
    expect(installHooks({ location: { origin: 'x', href: 'x' } }, () => undefined)).toEqual([]);
  });

  it('reports fetch metadata, never the URL query or body, and still calls through', async () => {
    const { win, messages, calls } = setup();
    const result = await win.fetch('https://tracker.example/c?uid=SECRET-UID', { method: 'post', body: 'SECRET-BODY', keepalive: true });
    expect(result).toEqual({ ok: true });
    expect(calls).toContain('fetch');
    expect(messages[0]).toMatchObject({
      category: 'network',
      action: 'request.sent',
      destination: { host: 'tracker.example', url: 'https://tracker.example/c', method: 'POST', isCrossOrigin: true },
      details: { api: 'fetch', bodyType: 'string', bodySize: 11, hasQuery: true, keepalive: true },
    });
    expect(JSON.stringify(messages)).not.toMatch(/SECRET/);
  });

  it('handles Request-like and URL inputs, relative URLs', async () => {
    const { win, messages } = setup();
    await win.fetch({ url: 'https://a.example/x', method: 'PUT' });
    await win.fetch('/api/me');
    expect(messages[0]!.destination).toMatchObject({ method: 'PUT', host: 'a.example' });
    expect(messages[1]!.destination).toMatchObject({ url: 'https://page.example/api/me', isCrossOrigin: false });
  });

  it('reports XHR on send using the method and URL from open', () => {
    const { win, messages, calls } = setup();
    const xhr = new win.XMLHttpRequest();
    xhr.open('POST', 'https://t.example/p?q=1');
    xhr.send('abc');
    expect(calls).toEqual(['open', 'send']);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ details: { api: 'xhr', bodySize: 3 }, destination: { method: 'POST' } });
  });

  it('reports sendBeacon and WebSocket construction', () => {
    const { win, messages } = setup();
    new win.Navigator().sendBeacon('https://b.example/beacon', 'payload');
    const ws = new win.WebSocket('wss://live.example/stream');
    expect(ws.url).toBe('wss://live.example/stream');
    expect(messages.map((m) => m.details.api)).toEqual(['beacon', 'websocket']);
  });

  it('reports storage writes without keys or values and coalesces reads', () => {
    const { win, messages } = setup();
    win.localStorage.setItem('auth_token', 'SECRET-VALUE');
    win.sessionStorage.setItem('theme', 'dark');
    for (let i = 0; i < 5; i++) win.localStorage.getItem('auth_token');
    win.localStorage.removeItem('auth_token');
    expect(win.localStorage.getItem('auth_token')).toBeNull();
    const writes = messages.filter((m) => m.action === 'storage.write');
    expect(writes[0]!.details).toEqual({ area: 'local', valueLength: 12, keyLooksSensitive: true });
    expect(writes[1]!.details).toMatchObject({ area: 'session', keyLooksSensitive: false });
    expect(messages.filter((m) => m.action === 'storage.read')).toHaveLength(1);
    expect(JSON.stringify(messages)).not.toMatch(/SECRET|auth_token|theme/);
  });

  it('reports cookie reads and writes without name or value', () => {
    const { win, messages } = setup();
    const doc = new win.Document();
    doc.cookie = 'sid=SECRET; Secure; SameSite=Lax; Path=/';
    expect(doc.cookie).toBe('sid=SECRET'); // behavior preserved
    const write = messages.find((m) => m.action === 'cookie.write')!;
    expect(write.details).toEqual({ valueLength: 40, attributes: ['path', 'samesite', 'secure'] });
    expect(messages.some((m) => m.action === 'cookie.read')).toBe(true);
    expect(JSON.stringify(messages)).not.toMatch(/SECRET|sid=/);
  });

  it('reports capability use and passes results through', async () => {
    const { win, messages } = setup();
    expect(await new win.Clipboard().readText()).toBe('CLIPBOARD-SECRET');
    await new win.Clipboard().writeText('copied');
    new win.Geolocation().getCurrentPosition(() => undefined, undefined, { enableHighAccuracy: true });
    await new win.MediaDevices().getUserMedia({ audio: true, video: false });
    expect(messages.map((m) => m.action)).toEqual([
      'clipboard.read',
      'clipboard.write',
      'geolocation.requested',
      'media.requested',
    ]);
    expect(messages[1]!.details).toMatchObject({ textLength: 6 });
    expect(messages[2]!.details).toMatchObject({ highAccuracy: true });
    expect(messages[3]!.details).toMatchObject({ audio: true, video: false });
    expect(JSON.stringify(messages)).not.toContain('CLIPBOARD-SECRET');
  });

  it('reports programmatic form submission', () => {
    const { win, messages, calls } = setup();
    new win.HTMLFormElement().submit();
    expect(calls).toContain('form.submit');
    expect(messages[0]).toMatchObject({
      category: 'form',
      action: 'form.submit_called',
      destination: { host: 'collector.example', method: 'POST', isCrossOrigin: true },
      details: { api: 'submit', fieldCount: 3 },
    });
  });

  it('never lets a reporting failure break the page', async () => {
    const f = fakeWindow();
    installHooks(f.win, () => {
      throw new Error('boom');
    });
    await expect(f.win.fetch('https://a.example/')).resolves.toEqual({ ok: true });
    expect(() => f.win.localStorage.setItem('a', 'b')).not.toThrow();
  });

  it('produces messages that become valid events', async () => {
    const { win, messages } = setup();
    await win.fetch('https://t.example/x', { method: 'POST', body: 'x' });
    win.localStorage.setItem('k', 'v');
    for (const m of messages) {
      const event = createEvent({
        category: m.category,
        action: m.action,
        ...(m.destination ? { destination: m.destination } : {}),
        evidence: { collector: 'page.hook', mechanism: 'main-world-hook', details: m.details },
        provenance: 'observed',
        source: toSource,
      });
      expect(event.evidence.mechanism).toBe('main-world-hook');
    }
  });
});
