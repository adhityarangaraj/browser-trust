import { LOOTRUSH_ACTIVITY_REQUESTS, LOOTRUSH_SEQUENCE_DELAY_MS } from './demo-activity.js';

const demoForm = document.querySelector('#demo-form');
const dialog = document.querySelector('#demo-dialog');
const dialogContent = document.querySelector('#dialog-content');
const networkStatus = document.querySelector('#network-status');
const mobileMenu = document.querySelector('#mobile-nav');
const menuButton = document.querySelector('#menu-button');
const DEMO_CLAIM = Object.freeze({ displayName: 'BrowserTrust Demo', note: 'Synthetic test submission' });

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function openDialog(title, description, actionLabel, onAction, eyebrow = 'LOOTRUSH DEMO') {
  dialogContent.replaceChildren();
  dialogContent.append(element('p', 'eyebrow', eyebrow));
  dialogContent.append(element('h2', 'dialog-title', title));
  dialogContent.append(element('p', 'dialog-copy', description));
  if (actionLabel && onAction) {
    const action = element('button', 'button button-lime dialog-action', actionLabel);
    action.type = 'button';
    action.addEventListener('click', onAction, { once: true });
    dialogContent.append(action);
  }
  if (!dialog.open) dialog.showModal();
}

function closeDialog() {
  if (dialog.open) dialog.close();
}

function requestOrigin() {
  const url = new URL(window.location.href);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '4173') {
    throw new Error('Open the fixture from its documented loopback URL.');
  }
  url.hostname = url.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1';
  return url.origin;
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function sendJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!response.ok) throw new Error(`Local fixture returned HTTP ${response.status}`);
  return response.json();
}

let activitySequenceStarted = false;
async function startActivitySequence() {
  if (activitySequenceStarted) return;
  activitySequenceStarted = true;

  let base;
  try {
    base = requestOrigin();
  } catch {
    networkStatus.textContent = 'Open LootRush from http://127.0.0.1:4173/ to run local demo activity.';
    return;
  }
  let sent = 0;
  let failed = 0;
  for (let index = 0; index < LOOTRUSH_ACTIVITY_REQUESTS.length; index += 1) {
    if (index > 0) await wait(LOOTRUSH_SEQUENCE_DELAY_MS);
    const request = LOOTRUSH_ACTIVITY_REQUESTS[index];
    try {
      await sendJson(new URL(request.endpoint, base), request.payload);
      sent += 1;
    } catch {
      failed += 1;
    }
    networkStatus.textContent = `Local demo activity: ${sent + failed}/${LOOTRUSH_ACTIVITY_REQUESTS.length} requests attempted.`;
  }

  networkStatus.textContent = failed === 0
    ? `Local demo activity: ${sent} synthetic requests sent.`
    : `Local demo activity: ${sent} sent, ${failed} unavailable. The page is still usable.`;
}

const rewards = Object.freeze({
  arcade: { title: 'Arcade Vault Card', details: 'A fictional digital gaming credit for your next session. Demo cost: 8,000 points.' },
  phantom: { title: 'Phantom Audio Kit', details: 'A fictional wireless headset bundle, shown here as a reward preview. Demo cost: 15,000 points.' },
  mystery: { title: 'Mystery Loot Box', details: 'A fictional assortment of setup accessories. Demo cost: 5,500 points.' },
  member: { title: 'Member Skin Pack', details: 'A fictional collection of four cosmetic looks. Demo cost: 10,000 points.' },
});

document.querySelectorAll('[data-reward]').forEach((button) => {
  button.addEventListener('click', () => {
    const reward = rewards[button.dataset.reward];
    if (reward) openDialog(reward.title, `${reward.details} No item is redeemed or delivered by this local demo.`, 'Got it', closeDialog, 'REWARD PREVIEW');
  });
});

function openClaimPreview() {
  openDialog(
    'Claim preview',
    'This fictional demo profile has 12,450 points. Confirming sends one fixed synthetic form event to the local test server; it does not redeem or deliver a prize.',
    'Send demo claim event',
    () => {
      closeDialog();
      demoForm.requestSubmit();
    },
    'NO REAL REDEMPTION',
  );
}

document.querySelector('#claim-hero').addEventListener('click', openClaimPreview);
document.querySelector('#dialog-close').addEventListener('click', closeDialog);
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) closeDialog();
});

document.querySelector('#profile-button').addEventListener('click', () => {
  openDialog('Demo player profile', 'This fixture uses a static fictional profile with 12,450 points. There is no account connection, sign-in, or credential form.', 'Close', closeDialog, 'LOCAL PROFILE PREVIEW');
});

demoForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  networkStatus.textContent = 'Sending the fixed synthetic claim event to the local server…';
  try {
    await sendJson(new URL('/collect', window.location.origin), DEMO_CLAIM);
    localStorage.setItem('lootrush-demo-claim', 'synthetic-only');
    networkStatus.textContent = 'Demo claim event recorded locally. No reward was redeemed.';
  } catch {
    networkStatus.textContent = 'The local claim endpoint is unavailable. The reward preview remains available.';
  }
});

menuButton.addEventListener('click', () => {
  const opening = mobileMenu.hidden;
  mobileMenu.hidden = !opening;
  menuButton.setAttribute('aria-expanded', String(opening));
  menuButton.setAttribute('aria-label', opening ? 'Close navigation' : 'Open navigation');
});
mobileMenu.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
  mobileMenu.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Open navigation');
}));

// The fixture is plain JavaScript rather than React, but this guard also makes
// the single page-load sequence safe if the entry point is ever initialized twice.
void startActivitySequence();
