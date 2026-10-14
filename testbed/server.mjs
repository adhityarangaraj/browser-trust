import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const TESTBED_HOST = '127.0.0.1';
export const TESTBED_PORT = 4173;
export const SYNTHETIC_SUBMISSION = Object.freeze({
  displayName: 'BrowserTrust Demo',
  note: 'Synthetic test submission',
});

const pagePath = fileURLToPath(new URL('./index.html', import.meta.url));
const MAX_BODY_BYTES = 2048;

/** Accept only this fixture's fixed synthetic payload; never log arbitrary input. */
export function isSyntheticSubmission(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    value.displayName === SYNTHETIC_SUBMISSION.displayName &&
    value.note === SYNTHETIC_SUBMISSION.note;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Payload too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Expected JSON'), { statusCode: 400 });
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

export function createTestbedServer(log = (entry) => console.log(entry)) {
  return createHttpServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', `http://${TESTBED_HOST}`).pathname;
    if (request.method === 'GET' && pathname === '/') {
      try {
        const html = await readFile(pagePath);
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(html);
      } catch {
        sendJson(response, 500, { ok: false, error: 'Test page unavailable' });
      }
      return;
    }
    if (request.method !== 'POST' || pathname !== '/collect') {
      sendJson(response, 404, { ok: false, error: 'Not found' });
      return;
    }
    if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      sendJson(response, 415, { ok: false, error: 'Expected application/json' });
      request.resume();
      return;
    }

    try {
      const payload = await readJsonBody(request);
      if (!isSyntheticSubmission(payload)) {
        sendJson(response, 400, { ok: false, error: 'Payload does not match the fixed synthetic fixture' });
        return;
      }
      log({ received: 'synthetic-form-submission', ...SYNTHETIC_SUBMISSION });
      sendJson(response, 200, { ok: true });
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
      sendJson(response, statusCode, { ok: false, error: statusCode === 413 ? 'Payload too large' : 'Expected JSON' });
      request.resume();
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createTestbedServer();
  server.listen(TESTBED_PORT, TESTBED_HOST, () => {
    console.log(`BrowserTrust local testbed: http://${TESTBED_HOST}:${TESTBED_PORT}/`);
    console.log('Stop with Ctrl+C. The server accepts only the fixed synthetic test form.');
  });
}
