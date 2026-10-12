const assert = require('node:assert/strict');
const loader = require('./distribution-loader.cjs');
const monitor = loader()('src/lib/analytics/listing-monitor.ts');
const page = html => new Response(html, { headers: { 'content-type': 'text/html' } });
const target = monitor.LISTING_TARGETS.find(item => item.source === 'inboxreads');
const link = 'https://www.macro-bias.com/?utm_source=inboxreads&amp;utm_medium=directory&amp;utm_campaign=mb_free_listings';
function harness(complete = true) {
  const effects = { queries: 0, writes: [], reports: 0, pages: 0 };
  const admin = { from() {
    effects.queries++;
    const q = { select() { return q; }, eq() { return q; }, order() { return q; },
      limit() { return Promise.resolve({ data: [], error: null }); },
      upsert(row) { effects.writes.push(row); return Promise.resolve({ error: null }); } };
    return q;
  } };
  return { effects, dependencies: { admin, report: async filters => {
    effects.reports++;
    return { range: { startDate: filters.start, endDate: filters.end }, overview: { newSubscribers: 0 }, sourceRows: [],
      coverage: { complete }, freshness: { loadedAt: '2026-10-13T08:00:00Z' } };
  }, fetchPage: async () => { effects.pages++; return page('<h1>Directory</h1>'); } } };
}
(async () => {
  let checked = await monitor.checkListing(target, async () => page(`<script><a href="${link}">Macro Bias</a></script><h1>Directory</h1>`));
  assert.equal(checked.status, 'not_observed', 'script text is not publication evidence');
  checked = await monitor.checkListing(target, async () => page('<a href="https://macro-bias.com.evil.example">Macro Bias</a>'));
  assert.equal(checked.status, 'not_observed', 'lookalike hosts are not publication evidence');
  const visited = [];
  checked = await monitor.checkListing(target, async url => {
    visited.push(String(url));
    return page(visited.length === 1 ? '<a href="/n/macro-bias">Macro Bias</a>' : `<a href="${link}">Subscribe</a>`);
  });
  assert.equal(checked.status, 'published'); assert.equal(checked.trackingIntact, true);
  assert.deepEqual(visited, ['https://inboxreads.co/new', 'https://inboxreads.co/n/macro-bias']);
  assert.ok(visited.every(url => !url.includes('www.macro-bias.com')), 'never fetch the destination');
  checked = await monitor.checkListing(target, async () => page('<a href="https://macro-bias.com">Subscribe</a>'));
  assert.equal(checked.status, 'published'); assert.equal(checked.trackingIntact, false);
  let requests = 0;
  checked = await monitor.checkListing(target, async () => {
    requests++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secrets' } });
  });
  assert.equal(checked.status, 'check_failed'); assert.equal(requests, 1, 'no untrusted redirect requests');
  checked = await monitor.checkListing(target, async () => { throw new Error('PRIVATE_PROVIDER_ERROR'); });
  assert.equal(checked.status, 'check_failed'); assert.ok(!JSON.stringify(checked).includes('PRIVATE_PROVIDER_ERROR'));
  let h = harness();
  let result = await monitor.runListingMonitor(new Date(monitor.LISTING_MONITOR_END), h.dependencies);
  assert.equal(result.status, 'inactive'); assert.equal(h.effects.queries, 0); assert.equal(h.effects.reports, 0); assert.equal(h.effects.pages, 0);
  h = harness(false);
  result = await monitor.runListingMonitor(new Date('2026-10-13T08:00:00Z'), h.dependencies);
  assert.equal(result.cumulative.overview, null, 'partial reads cannot become zero');
  assert.equal(result.cumulative.sourceRows, null); assert.equal(result.mailbox.status, 'not_connected');
  assert.equal(h.effects.writes[0].event_name, 'listing_monitor_snapshot');
  assert.equal(h.effects.writes[0].metadata.traffic_type, 'internal');
  h = harness();
  await monitor.runListingMonitor(new Date('2026-10-13T08:00:00Z'), h.dependencies);
  await monitor.runListingMonitor(new Date('2026-10-13T08:15:00Z'), h.dependencies);
  assert.equal(h.effects.writes[0].id, h.effects.writes[1].id, 'retries reuse the daily snapshot key');
  let ran = 0;
  const route = loader({ '@/lib/analytics/listing-monitor': { runListingMonitor: async () => { ran++; return { status: 'recorded' }; } } },
    { CRON_SECRET: 'test-secret', VERCEL_ENV: 'production' })('src/app/api/cron/listings/route.ts');
  assert.equal((await route.GET(new Request('https://macro-bias.com/api/cron/listings'))).status, 401); assert.equal(ran, 0);
  assert.equal((await route.GET(new Request('https://macro-bias.com/api/cron/listings', { headers: { authorization: 'Bearer test-secret' } }))).status, 200);
  assert.equal(ran, 1);
  const privateRoute = loader({ '@/lib/analytics/admin-access': { getAnalyticsAdminUser: async () => null } })('src/app/api/analytics/listings/route.ts');
  assert.equal((await privateRoute.GET()).status, 403);
  console.log('Listing monitor checks passed: publication evidence, bounded redirects, unavailable data, expiry, idempotency and access control.');
})().catch(error => { console.error(error); process.exitCode = 1; });
