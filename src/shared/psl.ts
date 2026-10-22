/**
 * Lightweight registrable-domain helper so BrowserTrust can distinguish
 * "cross-origin" (foo.example.com vs bar.example.com) from "cross-site"
 * (example.com vs tracker.net). It is deliberately not a full Public Suffix
 * List: shipping the real PSL (~15k rules) in a browser extension is
 * disproportionate, and the handful of multi-label suffixes below covers the
 * common cases the demo scenarios exercise. Hosts that fall outside this list
 * use a simple last-two-labels heuristic.
 *
 * Documented limitation: domains whose true public suffix is not in this list
 * (e.g. certain regional ccTLDs or hosted-platform suffixes) will be
 * classified by last-two-labels and may understate third-party status. The
 * event still carries `isCrossOrigin`, which is unaffected by this heuristic.
 */

const MULTI_LABEL_SUFFIXES = new Set<string>([
  // Common UK, AU, JP, NZ, ZA, IN, IL ccTLD compounds.
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'co.nz', 'net.nz', 'org.nz',
  'co.za', 'org.za', 'net.za', 'web.za',
  'co.in', 'net.in', 'org.in', 'gen.in',
  'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il',
  'co.kr', 'ne.kr', 'or.kr',
  // Common Latin American and European compounds.
  'com.br', 'net.br', 'org.br', 'gov.br',
  'com.mx', 'org.mx', 'gob.mx',
  'com.ar', 'org.ar',
  'com.tr', 'org.tr', 'net.tr',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.hk', 'org.hk', 'gov.hk',
  'com.sg', 'org.sg',
  'com.my', 'org.my',
  // A few popular hosted-platform suffixes that behave as public suffixes.
  'github.io', 'gitlab.io', 'web.app', 'firebaseapp.com', 'netlify.app',
  'vercel.app', 'herokuapp.com', 'cloudfront.net', 'azurewebsites.net',
  'r2.dev', 's3.amazonaws.com',
]);

/**
 * Returns the registrable domain (eTLD+1) for a hostname using the
 * documented heuristic. For "a.b.co.uk" this returns "b.co.uk".
 */
export function registrableDomain(host: string): string {
  if (!host) return host;
  const parts = host.toLowerCase().split('.').filter((part) => part.length > 0);
  if (parts.length <= 1) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (parts.length >= 3 && MULTI_LABEL_SUFFIXES.has(lastTwo)) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

/**
 * True when `sourceHost` and `destinationHost` sit on different registrable
 * domains. Both must be hostnames (no scheme, no port, no path).
 */
export function isCrossSite(sourceHost: string, destinationHost: string): boolean {
  if (!sourceHost || !destinationHost) return false;
  return registrableDomain(sourceHost) !== registrableDomain(destinationHost);
}
