const assert = require('node:assert/strict');
const calls = [], report = { coverage: { complete: true }, overview: { newSubscribers: 2 }, newsletterSignups: { stocks: 2, crypto: 1, both: 1, unknown: 0 },
  sourceRows: [], contentRows: [{ key: 'stocks', visitors: 1 }], attributionContentRows: [{ key: 'learn_intro', newSubscribers: 2 }],
  freshness: { loadedAt: '2026-11-05T12:00:00Z' },
  range: {}, landingRows: [{ key: '/learn', visitors: 1 }, { key: '/intel/bitcoin-ethereum-divergence', visitors: 1 }, { key: '/unrelated', visitors: 99 }] };
let incomplete = false;
const load = require('./distribution-loader.cjs')({ './acquisition-data': { getAcquisitionReport: async filters => {
  calls.push(filters); return { ...report, coverage: { complete: !incomplete } };
} } });
const { getTurnaroundReport } = load('src/lib/analytics/turnaround-report');
(async () => {
  assert.equal((await getTurnaroundReport(new Date('2026-11-03T23:59:59Z'))).phase, 'before_start'); assert.equal(calls.length, 0);
  const live = await getTurnaroundReport(new Date('2026-11-05T12:00:00Z'));
  assert.equal(calls.length, 3); assert.equal(calls[0].touch, 'first'); assert.equal(calls[1].touch, 'latest'); assert.equal(calls[2].campaign, undefined);
  assert.equal(live.first.metrics.newSubscribers, 2); assert.equal(live.first.newsletters.both, 1);
  assert.equal(live.first.contents[0].key, 'stocks'); assert.equal(live.first.attributionContents[0].key, 'learn_intro');
  assert.equal(live.first.freshness.loadedAt, '2026-11-05T12:00:00Z');
  assert.deepEqual(live.resourceEntries.rows.map(r => r.key), ['/learn', '/intel/bitcoin-ethereum-divergence']);
  calls.length = 0; const ended = await getTurnaroundReport(new Date('2026-11-20T12:00:00Z'));
  assert.equal(ended.phase, 'ended'); assert(calls.every(c => c.end === '2026-11-17'));
  incomplete = true; const missing = await getTurnaroundReport(new Date('2026-11-05'));
  assert.equal(missing.first.metrics, null); assert.equal(missing.latestAssist.metrics, null); assert.equal(missing.resourceEntries.rows, null);
  assert.equal(missing.first.contents, null); assert.equal(missing.first.attributionContents, null);
  let reads = 0;
  const Page = require('./distribution-loader.cjs')({ '@/lib/analytics/admin-access': { getAnalyticsAdminUser: async () => null },
    '@/lib/analytics/turnaround-report': { getTurnaroundReport: async () => { reads++; throw Error('PRIVATE'); } },
    '../analytics.module.css': {} })('src/app/analytics/turnaround/page');
  await Page.default(); assert.equal(reads, 0, 'owner gate must run before service reporting');
  const redirect = require('./distribution-loader.cjs')({ '@/lib/server-env': { getAppUrl: () => 'https://www.macro-bias.com' },
    'next/server': { NextResponse: { redirect: (url, options) => ({ url: String(url), ...options }) } } })('src/app/start/x/route').GET();
  assert.equal(redirect.status, 307); const url = new URL(redirect.url);
  assert.equal(url.pathname, '/learn'); assert.equal(url.searchParams.get('utm_campaign'), 'mb_acquisition_turnaround_20261104');
  console.log('PASS: finite reporting dates, first/latest separation, original choices, resource overlap, unavailable data, owner gate before reads and fixed profile redirect.');
})().catch(e => { console.error(e); process.exitCode = 1; });
