import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestbedServer, SYNTHETIC_SUBMISSION } from './server.mjs';
import { LOOTRUSH_ACTIVITY_REQUESTS } from './demo-activity.js';

const received = [];
const server = createTestbedServer((entry) => received.push(entry));
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('serves the clearly labelled LootRush local fixture', async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /LootRush/);
  assert.match(html, /LOCAL SECURITY TEST FIXTURE/);
});

test('serves the localhost alias used for cross-origin fixture traffic', async () => {
  const alias = baseUrl.replace('127.0.0.1', 'localhost');
  const response = await fetch(alias);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /LootRush/);
});

test('accepts and logs only the fixed synthetic POST', async () => {
  const response = await fetch(`${baseUrl}/collect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(SYNTHETIC_SUBMISSION),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(received, [{ received: 'synthetic-form-submission', ...SYNTHETIC_SUBMISSION }]);
});

test('rejects arbitrary payloads without logging them', async () => {
  const response = await fetch(`${baseUrl}/collect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'not synthetic', note: 'private data' }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(received, [{ received: 'synthetic-form-submission', ...SYNTHETIC_SUBMISSION }]);
});

test('rejects non-JSON payloads', async () => {
  const response = await fetch(`${baseUrl}/collect`, { method: 'POST', body: 'synthetic' });
  assert.equal(response.status, 415);
  assert.equal(received.length, 1);
});

test('rejects oversized payloads without logging them', async () => {
  const response = await fetch(`${baseUrl}/collect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'x'.repeat(4096),
  });
  assert.equal(response.status, 413);
  assert.equal(received.length, 1);
});

test('accepts only the seven fixed LootRush demo POST payloads', async () => {
  const start = received.length;
  const localAlias = baseUrl.replace('127.0.0.1', 'localhost');
  for (const { endpoint, payload } of LOOTRUSH_ACTIVITY_REQUESTS) {
    const response = await fetch(`${localAlias}${endpoint}`, {
      method: 'POST',
      headers: {
        origin: 'http://127.0.0.1:4173',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 200, endpoint);
    assert.deepEqual(await response.json(), { ok: true, endpoint });
  }
  assert.deepEqual(received.slice(start), LOOTRUSH_ACTIVITY_REQUESTS.map(({ endpoint }) => ({
    received: 'lootrush-demo-activity',
    endpoint,
  })));
});

test('rejects modified LootRush activity payloads without logging request data', async () => {
  const start = received.length;
  const response = await fetch(`${baseUrl}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'real-user-data', token: 'not-allowed' }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(received.slice(start), []);
});


test('allows only the fixture origin to preflight the local cross-origin demo POSTs', async () => {
  for (const { endpoint } of LOOTRUSH_ACTIVITY_REQUESTS) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:4173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.equal(response.status, 204, endpoint);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4173');
  }
});

test('does not grant cross-origin access to unrelated origins', async () => {
  const response = await fetch(`${baseUrl}/collect`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://example.com',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type'
    }
  });
  assert.equal(response.status, 403);
});


test('serves the stylesheet as CSS instead of returning 404', async () => {
  const response = await fetch(`${baseUrl}/styles.css`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/css/);
  assert.match(await response.text(), /--bg/);
});

test('serves the action script as JavaScript instead of returning 404', async () => {
  const response = await fetch(`${baseUrl}/app.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /javascript/);
  assert.match(await response.text(), /startActivitySequence|LOOTRUSH_ACTIVITY_REQUESTS/);
});

test('serves the browser request sequence as JavaScript', async () => {
  const response = await fetch(`${baseUrl}/demo-activity.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /javascript/);
  assert.match(await response.text(), /\/api\/events/);
});
