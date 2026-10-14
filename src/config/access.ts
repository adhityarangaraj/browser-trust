/**
 * Site access: which pages BrowserTrust may observe.
 *
 * Access is user-granted at runtime through optional host permissions, never
 * listed per site in code. Content scripts are registered dynamically for
 * whatever origins the user has granted.
 */

export const CONTENT_SCRIPT_ID = 'browsertrust-content';
export const ALL_SITES_PATTERNS = ['http://*/*', 'https://*/*'] as const;

/** Pages where Chrome refuses extension access even with host permission. */
const EXCLUDED_MATCHES = [
  'https://chromewebstore.google.com/*',
  'https://chrome.google.com/webstore/*',
];

export type UrlAnalysis =
  | { ok: true; origin: string; host: string; pattern: string }
  | { ok: false; reason: string };

/** Decides whether a tab URL is a context BrowserTrust can ever monitor. */
export function analyzeUrl(rawUrl: string | undefined): UrlAnalysis {
  if (!rawUrl) return { ok: false, reason: 'No page is selected.' };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'This page has an invalid address.' };
  }
  if (url.protocol === 'file:') {
    return {
      ok: false,
      reason: 'Local files are not supported in this phase (they need the separate "Allow access to file URLs" setting).',
    };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Chrome does not allow extensions on ${url.protocol} pages.` };
  }
  const isWebStore =
    url.hostname === 'chromewebstore.google.com' ||
    (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'));
  if (isWebStore) {
    return { ok: false, reason: 'Chrome does not allow extensions on the Chrome Web Store.' };
  }
  return { ok: true, origin: url.origin, host: url.host, pattern: `${url.origin}/*` };
}

export function isWebOriginPattern(pattern: string): boolean {
  return /^(https?|\*):\/\//.test(pattern);
}

/** True when `grantedPatterns` cover every page of `origin`. Handles the all-sites grant. */
export function isOriginCovered(origin: string, grantedPatterns: readonly string[]): boolean {
  const scheme = origin.startsWith('https:') ? 'https' : 'http';
  return grantedPatterns.some(
    (p) => p === `${origin}/*` || p === `${scheme}://*/*` || p === '*://*/*',
  );
}

export async function getGrantedOrigins(): Promise<string[]> {
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.filter(isWebOriginPattern);
}

export async function isContentScriptRegistered(): Promise<boolean> {
  const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  return scripts.length > 0;
}

/**
 * Makes the registered content script match the granted origins.
 * Returns true when a content script is registered afterwards.
 */
export async function syncContentScripts(monitoringEnabled: boolean): Promise<boolean> {
  const origins = monitoringEnabled ? await getGrantedOrigins() : [];
  const registered = await isContentScriptRegistered();

  if (origins.length === 0) {
    if (registered) await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    return false;
  }

  const script: chrome.scripting.RegisteredContentScript = {
    id: CONTENT_SCRIPT_ID,
    matches: origins,
    excludeMatches: EXCLUDED_MATCHES,
    js: ['content.js'],
    runAt: 'document_start',
    allFrames: true,
    persistAcrossSessions: true,
    world: 'ISOLATED',
  };
  if (registered) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
  return true;
}
