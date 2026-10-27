/** Public price summaries: no network, credentials, subscriptions or sends. */
const assert = require('node:assert/strict');
const loader = require('./distribution-loader.cjs');
const build = loader()('src/lib/product/public-briefing-summary.ts').buildPublicBriefingSummary;
const quote = (ticker, change, tradeDate) => ({ ticker, close: 100 + change, previousClose: 100, percentChange: change, tradeDate });
const facts = (asset, a, b) => ({ trade_date: '2026-10-27', window: { latestTradeDate: '2026-10-26' }, ticker_changes: asset === 'stocks'
  ? { SPY: quote('SPY', a, '2026-10-26'), QQQ: quote('QQQ', b, '2026-10-26') }
  : { 'BTC-USD': quote('BTC-USD', a, '2026-10-27'), 'ETH-USD': quote('ETH-USD', b, '2026-10-27') }, brief_content: 'PAID_COPY_MUST_NOT_ESCAPE', technical_indicators: { private: 'SECRET_MODEL' } });
(async () => {
  for (const asset of ['stocks', 'crypto']) for (const a of [-2, 0, 2]) for (const b of [-3, 0, 3]) {
    const result = build(asset, '2026-10-27', facts(asset, a, b));
    assert(result); assert.equal(result.quotes.length, 2); assert.match(result.watch, /compare|comparison/i);
    assert(!/PAID_COPY|SECRET_MODEL|technical_indicators|brief_content/.test(JSON.stringify(result)));
    if (a < 0 && b < 0) assert(!result.headline.includes('gains'));
    if (a > 0 && b > 0) assert(!result.headline.includes('fall'));
  }
  const good = facts('stocks', 1, 2);
  for (const bad of [null, { ...good, trade_date: '2026-10-26' }, { ...good, window: { latestTradeDate: '2026-10-23' } },
    { ...good, ticker_changes: { ...good.ticker_changes, QQQ: { ...good.ticker_changes.QQQ, percentChange: 100 } } },
    { ...good, ticker_changes: { ...good.ticker_changes, SPY: { ...good.ticker_changes.SPY, tradeDate: '2026-10-27' } } },
    { ...good, ticker_changes: {} }]) assert.equal(build('stocks', '2026-10-27', bad), null);
  assert.equal(build('stocks', '2026-02-30', good), null);
  assert.match(build('stocks', '2026-10-27', facts('stocks', 0.001, 0.001)).observation, /little changed/);
  let reads = 0, publishedAt = '2020-10-27T13:00:00Z', fails = false;
  const admin = { from(table) {
    assert.equal(table, 'macro_bias_scores'); reads++;
    const q = { select(columns) { assert.equal(columns, 'trade_date,ticker_changes,window:engine_inputs->tradeWindow'); return q; },
      eq() { return q; }, maybeSingle: async () => ({ data: good, error: fails ? {} : null }) }; return q;
  } };
  const load = loader({ react: { cache: fn => fn }, '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    './paid-briefing-data': { isPaidBriefingDate: value => /^\d{4}-\d{2}-\d{2}$/.test(value), getBriefingMetadata: async () => ({ publishedAt }) } });
  const read = load('src/lib/product/public-briefing-summary-data.ts').loadPublicBriefingSummary;
  assert(await read('stocks', '2026-10-27')); assert.equal(reads, 1);
  publishedAt = '2099-10-27T13:00:00Z'; assert.equal(await read('stocks', '2026-10-27'), null); assert.equal(reads, 1);
  publishedAt = null; assert.equal(await read('stocks', '2026-10-27'), null); assert.equal(reads, 1);
  publishedAt = '2020-10-27T13:00:00Z'; fails = true; assert.equal(await read('stocks', '2026-10-27'), null);
  const login = loader()('src/app/login/layout.tsx').metadata;
  assert.equal(login.robots.index, false); assert.equal(login.robots.follow, true); assert.equal(login.alternates.canonical, '/login');
  console.log('PASS public summaries: dated and consistent prices, direction/relative performance, omissions, publication gate, price-only projection, private-data exclusion and login noindex/canonical');
})().catch(e => { console.error(e); process.exitCode = 1; });
