import QUnit from 'qunit';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createDiagnosticStore, normalizeEvent, handleDiagnostics } from '../server/diagnostics.js';

QUnit.module('Public diagnostics');
QUnit.test('allowlist rejects secrets, arbitrary paths and client fields', assert => {
  const event = normalizeEvent({ location: '/api/cache/kline?token=SECRET', message: 'SECRET', stack: 'SECRET', cookie: 'SECRET', errorName: 'SECRET', errorCode: 'SECRET' });
  assert.strictEqual(event.location, '/api/cache/kline');
  assert.false(JSON.stringify(event).includes('SECRET'));
  assert.strictEqual(normalizeEvent({ location: '/api/SECRET' }).location, 'application');
  assert.strictEqual(normalizeEvent({ errorName: 'TypeError', errorCode: 'ECONNREFUSED' }).errorCode, 'ECONNREFUSED');
});
QUnit.test('bounded retention, deduplication and restart persistence', async assert => {
  const dir = await mkdtemp(join(tmpdir(), 'diagnostic-test-'));
  try {
    const file = join(dir, 'events.json');
    let now = 1000;
    const store = createDiagnosticStore({ file, limit: 2, now: () => now });
    await store.add({ source: 'upstream', kind: 'network', location: 'aktools' });
    await store.add({ source: 'upstream', kind: 'network', location: 'aktools' });
    assert.strictEqual((await store.snapshot()).entries[0].count, 2);
    await store.flush();
    const restored = createDiagnosticStore({ file, now: () => now });
    assert.strictEqual((await restored.snapshot()).entries[0].location, 'aktools');
    await store.add({ kind: 'http', status: 500 });
    await store.add({ kind: 'http', status: 502 });
    assert.strictEqual((await store.snapshot()).entries.length, 2);
    now += 8 * 86400000;
    assert.strictEqual((await store.snapshot()).entries.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
async function request(method, body, headers = {}) {
  const req = Readable.from([Buffer.from(body)]);
  Object.assign(req, { method, headers: { host: 'market.test', 'content-type': 'application/json', ...headers } });
  const res = { writeHead(status, responseHeaders) { this.status = status; this.headers = responseHeaders; this.headersSent = true; }, end(text) { this.body = JSON.parse(text); } };
  await handleDiagnostics(req, res);
  return res;
}
QUnit.test('JSON ingestion rejects cross-origin, oversized and malformed input; public GET is no-store', async assert => {
  assert.strictEqual((await request('POST', '{}')).status, 403);
  assert.strictEqual((await request('POST', '{}', { origin: 'https://evil.test' })).status, 403);
  const headers = { origin: 'https://market.test' };
  assert.strictEqual((await request('POST', 'x'.repeat(5000), headers)).status, 413);
  assert.strictEqual((await request('POST', 'null', headers)).status, 400);
  assert.strictEqual((await request('POST', JSON.stringify({ source: 'server', kind: 'network', location: '/api/cache/kline?secret=PRIVATE' }), headers)).status, 202);
  const result = await request('GET', '');
  assert.strictEqual(result.headers['cache-control'], 'no-store');
  assert.true(result.body.entries.some(e => e.source === 'browser' && e.kind === 'network'));
  assert.false(JSON.stringify(result.body).includes('PRIVATE'));
});
