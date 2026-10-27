const assert = require('node:assert/strict');
const { buildForwardReport } = require('./lib/build-forward-report.cjs');
const policy = require('../docs/model-monitor-policy.json');
const experiment = { id: policy.experiment, outcomeEvent: 'outcome', captureEnd: '2027-02-01T00:00:00Z', settlementEnd: '2027-02-03T00:00:00Z' };
const now = new Date('2026-10-27T20:00:00Z');
const input = { now, experiment, policy, events: [{ id: 'private', metadata: { vector: 'DO_NOT_EXPORT' } }],
  summarizeForward: () => ({ invalid: 0, latestHealth: { checkedAt: now.toISOString(), ok: true }, cohorts: [{ key: 'crypto:h:r', market: 'crypto', locked: 1, completed: 0, pending: 1 }] }),
  validSavedPrediction: row => ({ prediction: { market: 'crypto', targetDate: '2026-10-28', targetOpen: '2026-10-28T00:00:00Z', features: ['DO_NOT_EXPORT'] }, secret: 'DO_NOT_EXPORT' }),
  validSavedOutcome: () => null, isCompletedPriceDate: () => true };
const report = buildForwardReport(input);
assert.equal(report.completeRead, true); assert.equal(report.cohorts[0].locked, 1);
assert(!JSON.stringify(report).includes('DO_NOT_EXPORT'));
assert.deepEqual(report.issues, []);
let reads = 0, failed = false;
const overrides = {
  'next/server': { NextResponse: { json: (data, options = {}) => new Response(JSON.stringify(data), options) } },
  '@/lib/model-monitor/read-report': { readHostedForwardReport: async () => { reads++; if (failed) throw Error('SECRET_DATABASE_ERROR'); return report; } },
};
const load = require('./distribution-loader.cjs')(overrides, { MODEL_MONITOR_READ_TOKEN: 'x'.repeat(48), CRON_SECRET: 'different-collector-secret' });
const route = load('src/app/api/monitor/model-forward/route');
const request = token => new Request('https://example.test/api/monitor/model-forward?capture=1', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
(async () => {
  assert.equal((await route.GET(request())).status, 401);
  assert.equal((await route.GET(request('different-collector-secret'))).status, 401);
  assert.equal(reads, 0);
  const ok = await route.GET(request('x'.repeat(48)));
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await ok.json(), report);
  failed = true;
  const error = await route.GET(request('x'.repeat(48)));
  assert.equal(error.status, 503); assert(!(await error.text()).includes('SECRET_DATABASE_ERROR'));
  assert.equal(reads, 2);
  console.log('PASS: report projection excludes vectors/inputs; dedicated auth rejects collector credentials before reads; no-store and sanitized failures; endpoint has no write/generation path.');
})().catch(error => { console.error(error); process.exitCode = 1; });
