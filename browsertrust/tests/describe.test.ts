import { describe, expect, it } from 'vitest';
import { cookieAttributes, createThrottle, describeBody, keyLooksSensitive } from '../src/page-hooks/describe';

describe('describeBody', () => {
  it('reports shape and size, never content', () => {
    expect(describeBody(undefined)).toEqual({ bodyType: 'none' });
    expect(describeBody('abc')).toEqual({ bodyType: 'string', bodySize: 3 });
    expect(describeBody(new URLSearchParams({ a: '1' }))).toEqual({ bodyType: 'urlsearchparams', bodySize: 3 });
    expect(describeBody(new Blob(['hello']))).toEqual({ bodyType: 'blob', bodySize: 5 });
    expect(describeBody(new Uint8Array(4))).toEqual({ bodyType: 'arraybufferview', bodySize: 4 });
    const form = new FormData();
    form.append('a', 'SECRET');
    expect(describeBody(form)).toEqual({ bodyType: 'formdata', bodySize: 1 });
  });
});

describe('keyLooksSensitive / cookieAttributes', () => {
  it('flags sensitive-looking keys', () => {
    expect(keyLooksSensitive('authToken')).toBe(true);
    expect(keyLooksSensitive('user_email')).toBe(true);
    expect(keyLooksSensitive('theme')).toBe(false);
    expect(keyLooksSensitive(42)).toBe(false);
  });

  it('lists only known cookie attribute names', () => {
    expect(cookieAttributes('a=1; Secure; Max-Age=5; Foo=bar')).toEqual(['max-age', 'secure']);
    expect(cookieAttributes('a=1')).toEqual([]);
  });
});

describe('createThrottle', () => {
  it('passes one call per window and counts suppressed ones', () => {
    let t = 0;
    const throttle = createThrottle(1000, () => t);
    expect(throttle.take('k')).toBe(0);
    expect(throttle.take('k')).toBeUndefined();
    expect(throttle.take('k')).toBeUndefined();
    expect(throttle.take('other')).toBe(0);
    t = 1500;
    expect(throttle.take('k')).toBe(2);
  });
});
