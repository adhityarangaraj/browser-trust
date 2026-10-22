import { describe, expect, it } from 'vitest';
import { isKnownCommonHost, KNOWN_COMMON_HOSTS } from '../src/analysis/known-hosts';

describe('isKnownCommonHost', () => {
  it('matches subdomains via the registrable domain, not the raw host', () => {
    expect(isKnownCommonHost('www.youtube.com')).toBe(true);
    expect(isKnownCommonHost('m.youtube.com')).toBe(true);
    expect(isKnownCommonHost('music.youtube.com')).toBe(true);
    expect(isKnownCommonHost('scholar.google.com')).toBe(true);
    expect(isKnownCommonHost('mail.google.com')).toBe(true);
  });

  it('does not match hosts outside the allowlist, including look-alikes', () => {
    expect(isKnownCommonHost('youtube.evil.example')).toBe(false);
    expect(isKnownCommonHost('tracker.unrelated.net')).toBe(false);
    expect(isKnownCommonHost(undefined)).toBe(false);
    expect(isKnownCommonHost('')).toBe(false);
  });

  it('contains every registrable domain in lowercase form', () => {
    for (const entry of KNOWN_COMMON_HOSTS) {
      expect(entry).toBe(entry.toLowerCase());
      expect(entry).not.toContain('://');
      expect(entry).not.toContain('/');
    }
  });
});
