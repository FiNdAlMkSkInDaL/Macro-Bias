const assert = require('node:assert/strict');
const loader = require('./distribution-loader.cjs');
const campaign = 'mb_acquisition_turnaround_20261104';
const token = 'read-only-fixture-'.repeat(3);
let routeReads = 0, fail = false;
const loadRoute = env => loader({
  '@/lib/analytics/turnaround-monitor': { readTurnaroundMonitorReport: async () => {
    routeReads++; if (fail) throw Error('subscriber@example.com secret');
    return { schemaVersion: 'turnaround-monitor-v1', campaign };
  } },
  'next/server': { NextResponse: { json: (body, options) => ({ body, ...options }) } },
}, env)('src/app/api/monitor/turnaround/route');
const request = authorization => ({ headers: new Headers(authorization ? { authorization } : {}) });

(async () => {
  for (const env of [{}, { CRON_SECRET: token }, { MODEL_MONITOR_READ_TOKEN: 'short', CRON_SECRET: token }]) {
    assert.equal((await loadRoute(env).GET(request(`Bearer ${token}`))).status, 401);
  }
  const route = loadRoute({ MODEL_MONITOR_READ_TOKEN: token });
  for (const supplied of [undefined, 'wrong', `Bearer ${'x'.repeat(token.length)}`, `Bearer ${'é'.repeat(token.length)}`])
    assert.equal((await route.GET(request(supplied))).status, 401);
  assert.equal(routeReads, 0, 'authenticate before aggregate service reads');
  const accepted = await route.GET(request(`Bearer ${token}`));
  assert.equal(routeReads, 1); assert.equal(accepted.body.campaign, campaign);
  assert.equal(accepted.headers['Cache-Control'], 'no-store'); assert.equal(accepted.headers.Vary, 'Authorization');
  fail = true; const unavailable = await route.GET(request(`Bearer ${token}`));
  assert.equal(unavailable.status, 503); assert(!JSON.stringify(unavailable).includes('subscriber@example.com'));

  const queries = [];
  let result = { data: [{ metadata: {
    channel: 'bluesky', content_id: 'learn_intro', market: 'both', account: 'macrobias.bsky.social', status: 'published',
    remote_uri: 'at://did:plc:w7bpdelvlrpjlmv5edae4wcp/app.bsky.feed.post/3mziio45aq22t',
    remote_cid: 'bafyreibs2adltfoh7zdu7abnmiezlvllmvzql7vhodg4ottsavh4zwdp2y',
    permalink: 'https://bsky.app/profile/macrobias.bsky.social/post/3mziio45aq22t',
    claimed_at: '2026-11-04T13:49:00Z', finished_at: '2026-11-04T13:50:03.782Z',
    repository_verified: true, public_post_verified: true,
    text: 'PRIVATE_RAW_POST', subscriber_email: 'PRIVATE_IDENTITY@example.com', access_token: 'PRIVATE_TOKEN',
  } }], count: 1, error: null };
  const query = { select: (...v) => { queries.push(['select', ...v]); return query; },
    eq: (...v) => { queries.push(['eq', ...v]); return query; }, order: () => query, limit: async () => result };
  const admin = { from: name => { assert.equal(name, 'marketing_event_log'); return query; } };
  const mod = loader({ '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    './turnaround-report': { TURNAROUND: { campaign }, getTurnaroundReport: async () => ({ first: null }) } })('src/lib/analytics/turnaround-monitor');
  const delivered = await mod.readTurnaroundDeliveries(admin);
  assert.equal(delivered.complete, true); assert.equal(delivered.rows[0].status, 'published');
  assert.equal(delivered.rows[0].account, 'macrobias.bsky.social');
  assert.equal(delivered.rows[0].finishedAt, '2026-11-04T13:50:03.782Z');
  assert(!JSON.stringify(delivered).includes('PRIVATE_'), 'no raw metadata, credentials or identities in projection');
  assert(queries.some(q => q[0] === 'eq' && q[1] === 'event_name' && q[2] === 'acquisition_turnaround_delivery'));
  assert(queries.some(q => q[0] === 'eq' && q[1] === 'utm_campaign' && q[2] === campaign));
  result = { data: [{ metadata: { channel: 'PRIVATE_CHANNEL', account: 'PRIVATE_IDENTITY@example.com',
    permalink: 'https://bsky.app/profile/macrobias.bsky.social/post/3mziio45aq22t?token=PRIVATE_TOKEN',
    remote_uri: 'https://evil.example/PRIVATE_TOKEN', finished_at: 'invalid' } }], count: 1 };
  const hostile = await mod.readTurnaroundDeliveries(admin);
  assert(!JSON.stringify(hostile).includes('PRIVATE_'));
  assert.equal(hostile.rows[0].permalink, null); assert.equal(hostile.rows[0].account, null);
  assert.equal(hostile.rows[0].publicPostVerified, null, 'missing verification is unknown');
  for (const failedRead of [{ error: { message: 'PRIVATE_TOKEN' }, data: null }, { data: [], count: null },
    { data: [], count: 1 }, { data: Array.from({ length: 101 }, () => ({ metadata: {} })), count: 101 }]) {
    result = failedRead; const missing = await mod.readTurnaroundDeliveries(admin);
    assert.equal(missing.complete, false); assert.equal(missing.rows, null); assert(!JSON.stringify(missing).includes('PRIVATE_'));
  }
  result = { data: [], count: 0 }; const zero = await mod.readTurnaroundDeliveries(admin);
  assert.equal(zero.complete, true); assert.equal(zero.rows.length, 0);
  console.log('PASS: monitor authentication before reads, strict token/no CRON fallback, no-store, sanitized errors/receipt projection, campaign boundary and unknown incomplete reads.');
})().catch(error => { console.error(error); process.exitCode = 1; });
