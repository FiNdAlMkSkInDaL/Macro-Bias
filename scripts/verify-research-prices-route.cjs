const assert = require('node:assert/strict');
let reads = 0, failed = false;
const overrides = {
  'next/server': { NextResponse: { json: (data, options = {}) => new Response(JSON.stringify(data), options) } },
  '@/lib/model-forward/service': { forwardDependencies: () => ({ clock: () => new Date('2026-10-27T09:00:00Z'), readPrices: async () => {
    reads++; if (failed) throw Error('PRIVATE_DATABASE_ERROR'); return { SPY: [{ trade_date: '2026-10-26', open: 100, close: 101 }] };
  } }) },
};
const load = require('./distribution-loader.cjs')(overrides, { MODEL_MONITOR_READ_TOKEN: 'x'.repeat(48), CRON_SECRET: 'collector' });
const route = load('src/app/api/monitor/research-prices/route');
const request = token => new Request('https://example.test/api/monitor/research-prices?capture=1', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
(async () => {
  for (const token of [undefined, 'collector', 'bad']) assert.equal((await route.GET(request(token))).status, 401);
  assert.equal(reads, 0);
  const ok = await route.GET(request('x'.repeat(48))), body = await ok.json();
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal(ok.headers.get('x-robots-tag'), 'noindex'); assert.equal(body.completeRead, true);
  assert.deepEqual(Object.keys(body).sort(), ['asOf', 'completeRead', 'prices', 'sourceRevision', 'version']);
  failed = true;
  const error = await route.GET(request('x'.repeat(48)));
  assert.equal(error.status, 503); assert(!(await error.text()).includes('PRIVATE_DATABASE_ERROR'));
  assert.equal(reads, 2);
  console.log('PASS: dedicated read auth before access, completed quote projection only, no-store, sanitized failure and no collector invocation.');
})().catch(e => { console.error(e); process.exitCode = 1; });
