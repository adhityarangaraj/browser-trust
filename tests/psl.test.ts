import { describe, expect, it } from 'vitest';
import { isCrossSite, registrableDomain } from '../src/shared/psl';

describe('registrableDomain', () => {
  it('returns the last two labels for ordinary TLDs', () => {
    expect(registrableDomain('cdn.example.com')).toBe('example.com');
    expect(registrableDomain('example.com')).toBe('example.com');
    expect(registrableDomain('a.b.c.example.net')).toBe('example.net');
  });

  it('keeps three labels for known multi-label suffixes', () => {
    expect(registrableDomain('shop.co.uk')).toBe('shop.co.uk');
    expect(registrableDomain('cdn.shop.co.uk')).toBe('shop.co.uk');
    expect(registrableDomain('cdn.pages.github.io')).toBe('pages.github.io');
    expect(registrableDomain('a.b.example.com.au')).toBe('example.com.au');
  });

  it('normalizes casing and handles edge inputs', () => {
    expect(registrableDomain('CDN.Example.COM')).toBe('example.com');
    expect(registrableDomain('localhost')).toBe('localhost');
    expect(registrableDomain('')).toBe('');
  });
});

describe('isCrossSite', () => {
  it('is false for same registrable domain, true otherwise', () => {
    expect(isCrossSite('cdn.example.com', 'api.example.com')).toBe(false);
    expect(isCrossSite('shop.example.com', 'tracker.other.net')).toBe(true);
    expect(isCrossSite('a.shop.co.uk', 'b.shop.co.uk')).toBe(false);
    expect(isCrossSite('a.shop.co.uk', 'other.co.uk')).toBe(true);
  });

  it('returns false when either host is missing', () => {
    expect(isCrossSite('', 'tracker.net')).toBe(false);
    expect(isCrossSite('shop.example.com', '')).toBe(false);
  });
});
