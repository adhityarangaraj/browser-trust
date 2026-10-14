/* eslint-disable @typescript-eslint/no-explicit-any --
   Wrapping platform objects is inherently dynamic. This is the only module where `any` is allowed. */
import type { HookMessage } from '../shared/hook-protocol';
import { toDestination } from '../shared/url';
import {
  cookieAttributes,
  createThrottle,
  describeBody,
  describeRequestTarget,
  keyLooksSensitive,
} from './describe';

export type Report = (message: HookMessage) => void;

const READ_THROTTLE_MS = 1000;

/**
 * Wraps page APIs so their use is reported. Runs in the page's own JS world
 * (MAIN) before page scripts. Returns the names of hooks that were installed.
 *
 * What it observes: calls made through the wrapped entry points.
 * What it cannot see: references the page captured earlier or takes from a
 * fresh iframe, property-style storage access (`localStorage.key = v`),
 * resource loads that are not fetch/XHR (images, scripts, CSS), and anything
 * the page does after tampering with these wrappers.
 *
 * Nothing here reads request bodies, storage keys/values, cookie values or
 * clipboard contents. Only sizes, types and flags are reported.
 */
export function installHooks(win: any, report: Report): string[] {
  const installed: string[] = [];
  const throttle = createThrottle(READ_THROTTLE_MS);
  const safe = (fn: () => void) => {
    try {
      fn();
    } catch {
      /* the hook must never break the page */
    }
  };
  const pageOrigin = () => String(win.location?.origin ?? '');
  const pageHref = () => String(win.location?.href ?? '');
  const mark = (name: string) => installed.push(name);

  /** Replaces target[name] with a Proxy that reports before calling through. */
  function wrap(target: any, name: string, label: string, before: (self: any, args: any[]) => void): void {
    const descriptor = target && Object.getOwnPropertyDescriptor(target, name);
    const original = descriptor?.value;
    if (typeof original !== 'function' || !descriptor.configurable) return;
    const proxy = new Proxy(original, {
      apply(fn, self, args) {
        safe(() => before(self, args));
        return Reflect.apply(fn, self, args);
      },
    });
    Object.defineProperty(target, name, { ...descriptor, value: proxy });
    mark(label);
  }

  function requestEvent(api: string, method: string, input: unknown, extra: Record<string, any> = {}): HookMessage | undefined {
    const description = describeRequestTarget(input, pageHref());
    if (!description) return undefined;
    return {
      category: 'network',
      action: 'request.sent',
      destination: toDestination(description, pageOrigin(), { method: method.toUpperCase(), resourceType: api }),
      details: { api, hasQuery: description.hasQuery, queryParamCount: description.queryParamCount, ...extra },
    };
  }

  // fetch
  wrap(win, 'fetch', 'fetch', (_self, [input, init]) => {
    const method = String(init?.method ?? (input as any)?.method ?? 'GET');
    const body = describeBody(init?.body);
    const message = requestEvent('fetch', method, input, {
      ...body,
      keepalive: init?.keepalive === true,
      credentials: typeof init?.credentials === 'string' ? init.credentials : 'default',
    });
    if (message) report(message);
  });

  // XMLHttpRequest
  const xhrInfo = new WeakMap<object, { method: string; url: unknown }>();
  const xhrProto = win.XMLHttpRequest?.prototype;
  wrap(xhrProto, 'open', 'xhr.open', (self, [method, url]) => {
    xhrInfo.set(self, { method: String(method), url: typeof url === 'string' ? url : String(url) });
  });
  wrap(xhrProto, 'send', 'xhr.send', (self, [body]) => {
    const info = xhrInfo.get(self);
    if (!info) return;
    const message = requestEvent('xhr', info.method, info.url, describeBody(body));
    if (message) report(message);
  });

  // navigator.sendBeacon
  wrap(win.Navigator?.prototype ?? win.navigator, 'sendBeacon', 'beacon', (_self, [url, data]) => {
    const message = requestEvent('beacon', 'POST', url, describeBody(data));
    if (message) report(message);
  });

  // WebSocket (constructor)
  if (typeof win.WebSocket === 'function') {
    win.WebSocket = new Proxy(win.WebSocket, {
      construct(target, args, newTarget) {
        safe(() => {
          const message = requestEvent('websocket', 'GET', args[0], {});
          if (message) report(message);
        });
        return Reflect.construct(target, args, newTarget);
      },
    });
    mark('websocket');
  }

  // Web Storage (method calls only)
  const storageProto = win.Storage?.prototype;
  const areaOf = (self: any): string => {
    try {
      if (self === win.localStorage) return 'local';
      if (self === win.sessionStorage) return 'session';
    } catch {
      /* storage access can throw in sandboxed frames */
    }
    return 'unknown';
  };
  wrap(storageProto, 'setItem', 'storage.setItem', (self, [key, value]) => {
    report({
      category: 'storage',
      action: 'storage.write',
      details: {
        area: areaOf(self),
        valueLength: String(value).length,
        keyLooksSensitive: keyLooksSensitive(key),
      },
    });
  });
  wrap(storageProto, 'removeItem', 'storage.removeItem', (self, [key]) => {
    report({
      category: 'storage',
      action: 'storage.remove',
      details: { area: areaOf(self), keyLooksSensitive: keyLooksSensitive(key) },
    });
  });
  wrap(storageProto, 'clear', 'storage.clear', (self) => {
    report({ category: 'storage', action: 'storage.clear', details: { area: areaOf(self) } });
  });
  wrap(storageProto, 'getItem', 'storage.getItem', (self, [key]) => {
    const area = areaOf(self);
    const suppressed = throttle.take(`storage.read:${area}`);
    if (suppressed === undefined) return;
    report({
      category: 'storage',
      action: 'storage.read',
      details: { area, keyLooksSensitive: keyLooksSensitive(key), coalescedReads: suppressed + 1 },
    });
  });

  // document.cookie accessor
  const cookieOwner = win.Document?.prototype;
  const cookieDescriptor = cookieOwner && Object.getOwnPropertyDescriptor(cookieOwner, 'cookie');
  if (cookieDescriptor?.configurable && cookieDescriptor.get && cookieDescriptor.set) {
    const { get, set } = cookieDescriptor;
    Object.defineProperty(cookieOwner, 'cookie', {
      ...cookieDescriptor,
      get() {
        safe(() => {
          const suppressed = throttle.take('cookie.read');
          if (suppressed === undefined) return;
          report({ category: 'storage', action: 'cookie.read', details: { coalescedReads: suppressed + 1 } });
        });
        return Reflect.apply(get, this, []);
      },
      set(value: unknown) {
        safe(() =>
          report({
            category: 'storage',
            action: 'cookie.write',
            details: { valueLength: String(value).length, attributes: cookieAttributes(value) },
          }),
        );
        Reflect.apply(set, this, [value]);
      },
    });
    mark('cookie');
  }

  // Clipboard
  const clipboardProto = win.Clipboard?.prototype;
  wrap(clipboardProto, 'readText', 'clipboard.readText', () =>
    report({ category: 'capability', action: 'clipboard.read', details: { api: 'readText' } }),
  );
  wrap(clipboardProto, 'read', 'clipboard.read', () =>
    report({ category: 'capability', action: 'clipboard.read', details: { api: 'read' } }),
  );
  wrap(clipboardProto, 'writeText', 'clipboard.writeText', (_self, [text]) =>
    report({
      category: 'capability',
      action: 'clipboard.write',
      details: { api: 'writeText', textLength: String(text).length },
    }),
  );
  wrap(clipboardProto, 'write', 'clipboard.write', () =>
    report({ category: 'capability', action: 'clipboard.write', details: { api: 'write' } }),
  );

  // Geolocation
  for (const api of ['getCurrentPosition', 'watchPosition']) {
    wrap(win.Geolocation?.prototype, api, `geolocation.${api}`, (_self, [, , options]) =>
      report({
        category: 'capability',
        action: 'geolocation.requested',
        details: { api, highAccuracy: options?.enableHighAccuracy === true },
      }),
    );
  }

  // Camera, microphone, screen capture
  const mediaProto = win.MediaDevices?.prototype;
  wrap(mediaProto, 'getUserMedia', 'media.getUserMedia', (_self, [constraints]) =>
    report({
      category: 'capability',
      action: 'media.requested',
      details: { api: 'getUserMedia', audio: Boolean(constraints?.audio), video: Boolean(constraints?.video) },
    }),
  );
  wrap(mediaProto, 'getDisplayMedia', 'media.getDisplayMedia', () =>
    report({ category: 'capability', action: 'media.requested', details: { api: 'getDisplayMedia' } }),
  );

  // Form submission from script (does not fire a `submit` event)
  for (const api of ['submit', 'requestSubmit']) {
    wrap(win.HTMLFormElement?.prototype, api, `form.${api}`, (form) => {
      const description = describeRequestTarget(form.action, pageHref());
      const method = String(form.method || 'get');
      report({
        category: 'form',
        action: 'form.submit_called',
        ...(description
          ? { destination: toDestination(description, pageOrigin(), { method: method.toUpperCase() }) }
          : {}),
        details: { api, method: method.toLowerCase(), fieldCount: Number(form.elements?.length ?? 0) },
      });
    });
  }

  return installed;
}
