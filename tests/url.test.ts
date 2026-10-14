import { describe, expect, it } from 'vitest';
import { describeUrl, toDestination } from '../src/shared/url';

describe('describeUrl', () => {
  it('drops query, fragment and credentials but counts parameters', () => {
    expect(describeUrl('https://user:pw@a.com:8443/p/q?token=abc&x=1#frag')).toEqual({
      origin: 'https://a.com:8443',
      host: 'a.com:8443',
      url: 'https://a.com:8443/p/q',
      hasQuery: true,
      queryParamCount: 2,
    });
  });

  it('never keeps data: or blob: payloads', () => {
    expect(describeUrl('data:text/plain;base64,c2VjcmV0')?.url).toBe('data:');
    expect(describeUrl('blob:https://a.com/uuid')?.url).toBe('blob:');
  });

  it('resolves relative URLs against a base and rejects garbage', () => {
    expect(describeUrl('/x?y=1', 'https://a.com/z')?.url).toBe('https://a.com/x');
    expect(describeUrl('http://')).toBeUndefined();
  });
});

describe('toDestination', () => {
  it('flags cross-origin destinations', () => {
    const d = describeUrl('https://b.com/api')!;
    expect(toDestination(d, 'https://a.com', { method: 'POST' })).toMatchObject({
      host: 'b.com',
      method: 'POST',
      isCrossOrigin: true,
    });
    expect(toDestination(d, 'https://b.com').isCrossOrigin).toBe(false);
  });
});
