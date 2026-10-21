/** Offline only: no network, real credentials, account changes or live posts. */
const assert = require('node:assert/strict');
const loader = require('./distribution-loader.cjs');
const api = loader()('src/lib/social/grok-x-publishing.ts');
const now = new Date('2026-10-21T11:00:00Z');
const item = (date, score) => ({ date, tradeDate: date, score, biasLabel: 'NEUTRAL', overrideActive: false,
  publishedAt: `${date}T13:00:00Z`, freeAvailableAt: null });
const items = [item('2026-10-20', 0), item('2026-10-19', -28)];
function harness(options = {}) {
  const rows = [], effects = { reads: 0, sends: 0, writes: 0 };
  const admin = { from() {
    let filters = [], action = 'read', payload;
    const q = {
      select() { return q; }, eq(key, value) { filters.push(row => row[key] === value); return q; }, maybeSingle() { return q; },
      insert(value) { action = 'insert'; payload = value; return q; }, update(value) { action = 'update'; payload = value; return q; },
      then(resolve, reject) {
        let error = null, data = rows.filter(row => filters.every(f => f(row)))[0] ?? null;
        if (action === 'read') { effects.reads++; if (options.failRead) error = { code: 'SECRET_DB_ERROR' }; }
        if (action === 'insert') {
          if (options.failClaim) error = { code: 'DB_FAILURE' };
          else if (rows.some(row => row.id === payload.id)) error = { code: '23505' };
          else { rows.push(JSON.parse(JSON.stringify(payload))); effects.writes++; }
        }
        if (action === 'update') {
          if (options.failFinish) error = { code: 'SECRET_DB_ERROR' };
          else { Object.assign(data, JSON.parse(JSON.stringify(payload))); effects.writes++; }
        }
        return Promise.resolve({ data, error }).then(resolve, reject);
      },
    }; return q;
  } };
  return { rows, effects, deps: { admin, archive: async () => ({ items, loadError: options.sourceError ? 'SECRET' : null }),
    publish: async () => { effects.sends++; if (options.failPublish) throw Error('SECRET_PROVIDER_TOKEN'); return '123456789'; } } };
}
(async () => {
  const post = api.buildGrokXPost('stocks', items, now);
  assert.match(post.text, /-28 \(2026-10-19\) to 0 \(2026-10-20\)/);
  assert.match(post.text, /not a buy or sell signal/);
  assert(!post.text.includes('close')); assert(post.text.length - post.trackedUrl.length + 23 <= 280);
  const link = new URL(post.trackedUrl);
  assert.equal(link.origin, 'https://www.macro-bias.com'); assert.equal(link.pathname, '/today');
  assert.equal(link.searchParams.get('utm_source'), 'x'); assert.equal(link.searchParams.get('utm_medium'), 'organic_social');
  assert.equal(link.searchParams.get('utm_campaign'), 'mb_growth_202610_stocks_backdrop');
  assert.equal(link.searchParams.get('utm_content'), 'grok_stocks_20261021');
  const cryptoNow = new Date('2026-10-23T14:00:00Z');
  const crypto = api.buildGrokXPost('crypto', [item('2026-10-22', 6), item('2026-10-21', -2)], cryptoNow);
  assert.match(crypto.text, /Crypto composite/); assert.match(crypto.text, /not a BTC price target/);
  assert.equal(new URL(crypto.trackedUrl).pathname, '/crypto');
  for (const bad of [[], [item('2026-10-18', 0), item('2026-10-17', 2)], [item('2026-10-22', 0), items[0]],
    [{ ...items[0], score: null }, items[1]], [{ ...items[0], publishedAt: 'not-a-date' }, items[1]], [items[0], item('2026-10-01', -1)]]) {
    assert.throws(() => api.buildGrokXPost('stocks', bad, now));
  }
  assert.throws(() => api.buildGrokXPost('crypto', items, new Date('2026-10-22T11:00:00Z')));
  assert.equal(api.grokXSlot('stocks', now), true); assert.equal(api.grokXSlot('crypto', now), false);
  assert.equal(api.grokXSlot('crypto', cryptoNow), true);
  assert.equal(api.grokXWindowOpen(new Date(api.GROK_X_END)), false);
  assert.equal(api.grokXClaimId('stocks', now), api.grokXClaimId('stocks', cryptoNow));
  assert.notEqual(api.grokXClaimId('stocks', now), api.grokXClaimId('crypto', now));
  let h = harness(); await api.previewGrokX('stocks', now, h.deps);
  assert.equal(h.effects.writes, 0); assert.equal(h.effects.sends, 0);
  const outcomes = await Promise.allSettled([1, 2, 3].map(() => api.publishGrokX('stocks', post.fingerprint, now, h.deps)));
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1); assert.equal(h.effects.sends, 1);
  assert.equal(h.rows.length, 1); assert.equal(h.rows[0].metadata.traffic_type, 'internal');
  assert.equal(h.rows[0].event_name, 'grok_x_delivery'); assert.equal(h.rows[0].metadata.status, 'published');
  assert.equal((await api.publishGrokX('stocks', post.fingerprint, now, h.deps)).status, 'already_published');
  assert.equal(h.effects.sends, 1);
  for (const options of [{ failPublish: true }, { failFinish: true }]) {
    h = harness(options); await assert.rejects(api.publishGrokX('stocks', post.fingerprint, now, h.deps), /publication_outcome_needs_review/);
    await assert.rejects(api.publishGrokX('stocks', post.fingerprint, now, h.deps), /previous_outcome_needs_review/);
    assert.equal(h.effects.sends, 1);
  }
  for (const options of [{ failRead: true }, { failClaim: true }, { sourceError: true }]) {
    h = harness(options); await assert.rejects(api.publishGrokX('stocks', post.fingerprint, now, h.deps)); assert.equal(h.effects.sends, 0);
  }
  h = harness(); await assert.rejects(api.publishGrokX('stocks', '0'.repeat(64), now, h.deps), /preview_changed/);
  assert.equal(h.effects.writes, 0);
  await assert.rejects(api.publishGrokX('stocks', post.fingerprint, new Date(api.GROK_X_END), h.deps), /experiment_ended/);
  await assert.rejects(api.publishGrokX('crypto', post.fingerprint, now, h.deps), /outside_market_slot/);
  assert.equal(h.effects.reads, 1); // Only the fingerprint mismatch read above.
  const calls = [], token = 'a'.repeat(48);
  const NextResponse = { json: (body, init) => ({ body, ...init }) };
  const mocks = { 'next/server': { NextResponse }, '@/lib/social/grok-x-publishing': {
    ...api, grokXWindowOpen: () => true, previewGrokX: async market => { calls.push(market); return post; },
    publishGrokX: async market => { calls.push(market); return { status: 'published' }; },
  } };
  const env = { VERCEL_ENV: 'production', GROK_X_PUBLISH_ENABLED: 'true', GROK_X_PUBLISH_TOKEN: token };
  const route = loader(mocks, env)('src/app/api/marketing/grok-x/route.ts');
  const request = (auth, body = {}, query = '?market=stocks') => ({ headers: new Headers(auth ? { authorization: `Bearer ${auth}` } : {}),
    nextUrl: new URL(`https://www.macro-bias.com/api/marketing/grok-x${query}`), text: async () => JSON.stringify(body) });
  assert.equal((await route.GET(request(null))).status, 401);
  assert.equal((await route.POST(request('wrong'))).status, 401); assert.equal(calls.length, 0);
  for (const override of [{ VERCEL_ENV: 'preview' }, { GROK_X_PUBLISH_ENABLED: '' }, { GROK_X_PUBLISH_TOKEN: '' }]) {
    const disabled = loader(mocks, { ...env, ...override })('src/app/api/marketing/grok-x/route.ts');
    assert.equal((await disabled.POST(request(token))).status, 503);
  }
  assert.equal((await route.POST(request(token, { market: 'stocks', fingerprint: post.fingerprint, text: 'arbitrary' }))).status, 400);
  assert.equal((await route.POST(request(token, { market: 'stocks', fingerprint: post.fingerprint, reply_to: 'victim' }))).status, 400);
  assert.equal((await route.POST(request(token, { market: 'invalid', fingerprint: post.fingerprint }))).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await route.GET(request(token))).status, 200);
  assert.equal((await route.POST(request(token, { market: 'stocks', fingerprint: post.fingerprint }))).status, 200);
  const ended = loader({ ...mocks, '@/lib/social/grok-x-publishing': { ...mocks['@/lib/social/grok-x-publishing'], grokXWindowOpen: () => false } }, env)('src/app/api/marketing/grok-x/route.ts');
  assert.equal((await ended.POST(request(token))).status, 410);
  const acquisition = loader()('src/lib/analytics/acquisition-data.ts');
  assert(!acquisition.ACQUISITION_EVENT_NAMES.includes(api.GROK_X_EVENT));
  console.log('PASS Grok X: dated public facts, tracking, expiry/slots, read-only preview, atomic weekly cap, uncertain outcomes, authentication, no arbitrary posts and acquisition exclusion');
})().catch(error => { console.error(error); process.exitCode = 1; });
