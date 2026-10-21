/** Offline only: no network, real credentials, account changes or live posts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loader = require('./distribution-loader.cjs');
// Validate payloads against the real table definition, rather than letting an
// unconstrained mock accept columns PostgREST will reject before a send.
const schema = fs.readFileSync(path.join(__dirname, '../supabase/migrations/202604130001_create_marketing_analytics_and_drips.sql'), 'utf8');
const eventTable = schema.match(/create table if not exists public\.marketing_event_log \(([\s\S]*?)\r?\n\);/)[1];
const eventColumns = new Set([...eventTable.matchAll(/^\s+([a-z_]+)\s/gm)].map(match => match[1]));
const api = loader()('src/lib/social/grok-x-publishing.ts');
const now = new Date('2026-10-21T11:00:00Z');
const item = (date, score) => ({ date, tradeDate: date, score, biasLabel: 'NEUTRAL', overrideActive: false,
  publishedAt: `${date}T13:00:00Z`, freeAvailableAt: null });
const items = [item('2026-10-20', 0), item('2026-10-19', -28)];
const quote = (ticker, move, date = '2026-10-20') => ({ ticker, tradeDate: date, close: 100 + move, previousClose: 100, percentChange: move });
const facts = { trade_date: '2026-10-20', window: { latestTradeDate: '2026-10-20' },
  ticker_changes: { SPY: quote('SPY', 0.42), QQQ: quote('QQQ', 1.21) },
  technical_indicators: { SPY: { tradeDate: '2026-10-20', sma20: 101 } } };
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
          for (const key of Object.keys(payload)) assert(eventColumns.has(key), `Unknown marketing_event_log column: ${key}`);
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
    facts: async () => options.missingFacts ? null : facts,
    publish: async () => { effects.sends++; if (options.failPublish) throw Error('SECRET_PROVIDER_TOKEN'); return '123456789'; } } };
}
(async () => {
  const post = api.buildGrokXPost('stocks', items, now, facts);
  assert.match(post.text, /^Nasdaq-100 stocks led the gains\./);
  assert.match(post.text, /S&P 500 ETF SPY \+0.42% \(20 Oct close\)/);
  assert.match(post.text, /below its 20-day average \(\$101.00\).*reclaim that line/);
  assert(!post.text.includes('model readings')); assert(post.text.length - post.trackedUrl.length + 23 <= 280);
  assert.equal(post.marketDataDate, '2026-10-20'); assert.equal(post.editorialVersion, 'market_context_v2');
  const link = new URL(post.trackedUrl);
  assert.equal(link.origin, 'https://www.macro-bias.com'); assert.equal(link.pathname, '/today');
  assert.equal(link.searchParams.get('utm_source'), 'x'); assert.equal(link.searchParams.get('utm_medium'), 'organic_social');
  assert.equal(link.searchParams.get('utm_campaign'), 'mb_growth_202610_stocks_backdrop');
  assert.equal(link.searchParams.get('utm_content'), 'grok_stocks_20261021');
  const cryptoNow = new Date('2026-10-23T14:00:00Z');
  const cryptoFacts = { trade_date: '2026-10-22', ticker_changes: { 'BTC-USD': quote('BTC-USD', 1, '2026-10-22'), 'ETH-USD': quote('ETH-USD', 2, '2026-10-22') } };
  const crypto = api.buildGrokXPost('crypto', [item('2026-10-22', 6), item('2026-10-21', -2)], cryptoNow, cryptoFacts);
  assert.match(crypto.text, /^Ethereum led the crypto gains/); assert.match(crypto.text, /Bitcoin \+1.00%; Ethereum \+2.00%/);
  assert.match(crypto.text, /Watch whether both keep rising/);
  assert.equal(new URL(crypto.trackedUrl).pathname, '/crypto');
  for (const bad of [[], [item('2026-10-18', 0), item('2026-10-17', 2)], [item('2026-10-22', 0), items[0]],
    [{ ...items[0], score: null }, items[1]], [{ ...items[0], publishedAt: 'not-a-date' }, items[1]], [items[0], item('2026-10-01', -1)]]) {
    assert.throws(() => api.buildGrokXPost('stocks', bad, now, facts));
  }
  assert.throws(() => api.buildGrokXPost('crypto', items, new Date('2026-10-22T11:00:00Z'), cryptoFacts));
  for (const bad of [null, { ...facts, trade_date: '2026-10-19' },
    { ...facts, window: { latestTradeDate: '2026-10-19' } }, { ...facts, ticker_changes: {} },
    { ...facts, ticker_changes: { ...facts.ticker_changes, QQQ: { ...facts.ticker_changes.QQQ, percentChange: 10 } } },
    { ...facts, ticker_changes: { ...facts.ticker_changes, SPY: { ...facts.ticker_changes.SPY, tradeDate: '2026-10-19' } } }]) {
    assert.throws(() => api.buildGrokXPost('stocks', items, now, bad), /useful_market_context_unavailable/);
  }
  // Direction and relative performance must not be confused: rising less is
  // not falling; falling less is not a rally. Exercise every editorial branch.
  const commentary = loader()('src/lib/social/grok-x-commentary.ts');
  for (const a of [-2, 0, 2]) for (const b of [-3, 0, 3]) {
    for (const market of ['stocks', 'crypto']) {
      const cryptoMarket = market === 'crypto';
      const date = cryptoMarket ? '2026-10-22' : '2026-10-20';
      const source = cryptoMarket ? { ...cryptoFacts, ticker_changes: { 'BTC-USD': quote('BTC-USD', a, date), 'ETH-USD': quote('ETH-USD', b, date) } }
        : { ...facts, ticker_changes: { SPY: quote('SPY', a), QQQ: quote('QQQ', b) } };
      const value = api.buildGrokXPost(market, cryptoMarket ? [item(date, 6), item('2026-10-21', -2)] : items, cryptoMarket ? cryptoNow : now, source);
      assert(value.text.length - value.trackedUrl.length + 23 <= 280);
      if (a < 0 && b < 0) assert(!/led the gains|rose faster|stocks rose/.test(value.text));
      if (a > 0 && b > 0) assert(!/fell harder|bigger hit|stocks fell/.test(value.text));
    }
  }
  assert.equal(commentary.grokXCompletedSession('stocks', new Date('2026-10-26T13:00:00Z')), '2026-10-23');
  assert.equal(commentary.grokXCompletedSession('crypto', new Date('2026-10-26T13:00:00Z')), '2026-10-25');
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
  assert.equal(h.rows[0].metadata.contentId, 'grok_stocks_20261021');
  assert.equal(new URL(h.rows[0].metadata.trackedUrl).searchParams.get('utm_content'), 'grok_stocks_20261021');
  assert.equal((await api.publishGrokX('stocks', post.fingerprint, now, h.deps)).status, 'already_published');
  assert.equal(h.effects.sends, 1);
  for (const options of [{ failPublish: true }, { failFinish: true }]) {
    h = harness(options); await assert.rejects(api.publishGrokX('stocks', post.fingerprint, now, h.deps), /publication_outcome_needs_review/);
    await assert.rejects(api.publishGrokX('stocks', post.fingerprint, now, h.deps), /previous_outcome_needs_review/);
    assert.equal(h.effects.sends, 1);
  }
  for (const options of [{ failRead: true }, { failClaim: true }, { sourceError: true }, { missingFacts: true }]) {
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
