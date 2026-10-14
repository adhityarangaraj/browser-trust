import { describe, expect, it } from 'vitest';
import { analyzeUrl, isOriginCovered, isWebOriginPattern } from '../src/config/access';

describe('analyzeUrl', () => {
  it('accepts http and https pages without per-site configuration', () => {
    expect(analyzeUrl('https://example.com/a?b=1')).toEqual({
      ok: true,
      origin: 'https://example.com',
      host: 'example.com',
      pattern: 'https://example.com/*',
    });
    expect(analyzeUrl('http://localhost:3000/x')).toMatchObject({
      ok: true,
      pattern: 'http://localhost:3000/*',
    });
  });

  it.each([
    'chrome://extensions',
    'chrome-extension://abc/popup.html',
    'about:blank',
    'data:text/html,hi',
    'file:///tmp/a.html',
    'https://chromewebstore.google.com/detail/x',
    'https://chrome.google.com/webstore/detail/x',
    'not a url',
    undefined,
  ])('rejects unsupported context %s', (url) => {
    expect(analyzeUrl(url).ok).toBe(false);
  });
});

describe('isOriginCovered', () => {
  it('matches exact and all-sites grants', () => {
    expect(isOriginCovered('https://a.com', ['https://a.com/*'])).toBe(true);
    expect(isOriginCovered('https://a.com', ['https://*/*'])).toBe(true);
    expect(isOriginCovered('https://a.com', ['http://*/*'])).toBe(false);
    expect(isOriginCovered('https://a.com', ['https://b.com/*'])).toBe(false);
    expect(isOriginCovered('http://a.com', ['*://*/*'])).toBe(true);
  });
});

describe('isWebOriginPattern', () => {
  it('filters non-web patterns', () => {
    expect(isWebOriginPattern('https://a.com/*')).toBe(true);
    expect(isWebOriginPattern('*://*/*')).toBe(true);
    expect(isWebOriginPattern('chrome://favicon/*')).toBe(false);
  });
});
