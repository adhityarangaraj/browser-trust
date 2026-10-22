import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestbedServer, SYNTHETIC_SUBMISSION } from './server.mjs';

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

test('serves the clearly labelled local fixture', async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Suspicious behavior demo/);
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


test('allows only the fixture origin to preflight the local cross-origin demo POST', async () => {
  const response = await fetch(`${baseUrl}/collect`, {
    method: 'OPTIONS',
    headers: {
      origin: 'http://127.0.0.1:4173',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type'
    }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4173');
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
  assert.match(await response.text(), /--canvas/);
});

test('serves the action script as JavaScript instead of returning 404', async () => {
  const response = await fetch(`${baseUrl}/app.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /javascript/);
  assert.match(await response.text(), /Run all actions|run-all/);
});
