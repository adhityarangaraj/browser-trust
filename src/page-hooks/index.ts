/**
 * BrowserTrust page hook. Registered by the service worker as a MAIN-world
 * content script on user-granted origins; it runs inside the page's own JS
 * world before page scripts. It has no access to extension APIs, so it
 * reports through a DOM event that the isolated content script relays.
 */
import { HOOK_CHANNEL, type HookMessage } from '../shared/hook-protocol';
import { installHooks } from './hooks';

const INSTALLED = Symbol.for('browsertrust.hooks.installed');

function report(message: HookMessage): void {
  document.dispatchEvent(new CustomEvent(HOOK_CHANNEL, { detail: JSON.stringify(message) }));
}

const target = window as unknown as Record<symbol, unknown>;
if (!target[INSTALLED]) {
  Object.defineProperty(target, INSTALLED, { value: true, enumerable: false });
  installHooks(window, report);
}
