/** Actual parser, price-only sync and cron guard with isolated fixtures; no external writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}, globals = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Date, Intl, URL, AbortSignal, setTimeout, Buffer, ...globals })((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`); return mocks[name];
  }, module, module.exports);
  return module.exports;
}
const prices = load('src/lib/market-data/completed-price-bars.ts');
function payload(ticker, date = '2026-10-01', values = [764.36, 765.65, 758.79, 763.99, 763.99, 47668000]) {
  return { chart: { result: [{ meta: { symbol: ticker, exchangeTimezoneName: ticker === 'SPY' ? 'America/New_York' : 'UTC' }, timestamp: [Date.parse(`${date}T${ticker === 'SPY' ? '13:30' : '00:00'}:00Z`) / 1000], indicators: { quote: [{ open: [values[0]], high: [values[1]], low: [values[2]], close: [values[3]], volume: [values[5]] }], adjclose: [{ adjclose: [values[4]] }] } }] } };
}
let passed = 0;
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
(async () => {
  await check('verified October 1 SPY quote values and separate adjustment contract', () => {
    const row = prices.parseCompletedYahooPrices('SPY', payload('SPY'), new Date('2026-10-02T12:00:00Z'))[0];
    assert.deepEqual(JSON.parse(JSON.stringify(row)), { ticker: 'SPY', trade_date: '2026-10-01', open: 764.36, high: 765.65, low: 758.79, close: 763.99, adjusted_close: 763.99, volume: 47668000, source: 'yahoo-chart-api' });
    const adjusted = prices.parseCompletedYahooPrices('SPY', payload('SPY', '2026-10-01', [100, 110, 95, 105, 90, 500]), new Date('2026-10-02T12:00:00Z'))[0];
    assert.equal(adjusted.close, 105); assert.equal(adjusted.adjusted_close, 90); assert.equal(adjusted.open, 100);
  });
  await check('exchange-local date and UTC-day finality; current/partial/invalid bars are not synthesized', () => {
    const open = payload('SPY', '2026-10-02');
    assert.equal(prices.parseCompletedYahooPrices('SPY', open, new Date('2026-10-02T20:14:00Z')).length, 0);
    assert.equal(prices.parseCompletedYahooPrices('SPY', open, new Date('2026-10-02T20:15:00Z')).length, 1);
    assert.equal(prices.parseCompletedYahooPrices('BTC-USD', payload('BTC-USD', '2026-10-02'), new Date('2026-10-02T23:59:59Z')).length, 0);
    assert.equal(prices.parseCompletedYahooPrices('BTC-USD', payload('BTC-USD', '2026-10-02'), new Date('2026-10-03T00:00:00Z')).length, 1);
    assert.equal(prices.parseCompletedYahooPrices('SPY', payload('SPY', '2026-10-01', [null, 10, 9, 10, 10, 100]), new Date('2026-10-02')).length, 0);
    assert.equal(prices.parseCompletedYahooPrices('SPY', payload('SPY', '2026-10-01', [11, 10, 9, 10, 10, 100]), new Date('2026-10-02')).length, 0);
    assert.throws(() => prices.parseCompletedYahooPrices('SPY', payload('BTC-USD'), new Date('2026-10-02')), /Invalid Yahoo daily source/);
    assert.equal(prices.isCompletedPriceDate('SPY', '2026-02-30', new Date('2026-10-02')), false);
  });
  await check('DST, weekends, NYSE holidays and conservative early-close finality', () => {
    assert.equal(prices.completedPriceDateCutoff('SPY', new Date('2026-12-01T21:14:00Z')), '2026-11-30');
    assert.equal(prices.completedPriceDateCutoff('SPY', new Date('2026-12-01T21:15:00Z')), '2026-12-01');
    assert.equal(prices.latestCompletedPriceDate('SPY', new Date('2026-09-07T21:00:00Z')), '2026-09-04');
    assert.equal(prices.latestCompletedPriceDate('SPY', new Date('2026-07-05T21:00:00Z')), '2026-07-02');
    assert.equal(prices.latestCompletedPriceDate('SPY', new Date('2026-04-03T21:00:00Z')), '2026-04-02');
    assert.equal(prices.latestCompletedPriceDate('SPY', new Date('2026-12-25T22:00:00Z')), '2026-12-24');
    assert.equal(prices.isCompletedPriceDate('SPY', '2026-11-27', new Date('2026-11-27T18:15:00Z')), false);
    assert.equal(prices.isCompletedPriceDate('SPY', '2026-11-27', new Date('2026-11-27T21:15:00Z')), true);
    assert.equal(prices.latestCompletedPriceDate('BTC-USD', new Date('2026-10-04T12:00:00Z')), '2026-10-03');
  });
  await check('fetch uses the same daily provider, raw/adjusted fields, no cache and excludes the current day', async () => {
    let requested;
    const api = load('src/lib/market-data/completed-price-bars.ts', {}, { fetch: async (url, options) => { requested = { url, options }; return { ok: true, json: async () => payload('SPY') }; } });
    const rows = await api.fetchCompletedYahooPrices('SPY', new Date('2026-10-02T12:00:00Z'));
    assert.equal(rows.length, 1); assert.equal(requested.url.hostname, 'query1.finance.yahoo.com');
    assert.equal(requested.url.searchParams.get('interval'), '1d'); assert.equal(requested.url.searchParams.get('includeAdjustedClose'), 'true');
    assert.equal(requested.url.searchParams.get('includePrePost'), 'false'); assert.equal(requested.options.cache, 'no-store');
  });
  await check('price-only sync catches up absent completed bars, finalizes latest row, preserves existing history and is idempotent', async () => {
    const rows = new Map(); const writes = []; const queried = [];
    const admin = { from(table) { queried.push(table); assert.equal(table, 'etf_daily_prices'); let ticker, date;
      return { select() { return this; }, eq(key, value) { if (key === 'ticker') ticker = value; else date = value; return this; }, gte() { return this; }, lte() { return this; },
        then(resolve) { return Promise.resolve({ data: [...rows.values()].filter((row) => row.ticker === ticker), error: null }).then(resolve); },
        upsert(values, options) { assert.equal(options.onConflict, 'ticker,trade_date'); const inserted = [];
          for (const row of Array.isArray(values) ? values : [values]) { assert.equal('technical_indicators' in row, false); assert.equal('created_at' in row, false);
            const key = `${row.ticker}:${row.trade_date}`; if (options.ignoreDuplicates && rows.has(key)) continue;
            writes.push(row); rows.set(key, { ...rows.get(key), ...row }); inserted.push(row); }
          const result = { data: inserted, error: null }; return { then(resolve) { return Promise.resolve(result).then(resolve); }, select() { return Promise.resolve(result); } }; },
      }; } };
    rows.set('BTC-USD:2026-10-01', { ticker: 'BTC-USD', trade_date: '2026-10-01', technical_indicators: { untouched: true }, created_at: 'original', close: 1 });
    for (const ticker of ['SPY', 'BTC-USD']) rows.set(`${ticker}:2026-09-29`, { ticker, trade_date: '2026-09-29', close: 12345 });
    const sync = load('src/lib/market-data/sync-completed-market-prices.ts', { '../supabase/admin': { createSupabaseAdminClient: () => admin }, './completed-price-bars': { latestCompletedPriceDate: prices.latestCompletedPriceDate,
      fetchCompletedYahooPrices: async (ticker, now) => ['2026-09-29', '2026-09-30', '2026-10-01'].flatMap((date) => prices.parseCompletedYahooPrices(ticker, payload(ticker, date), now)) } });
    const now = new Date('2026-10-02T12:00:00Z');
    const first = await sync.syncCompletedMarketPrices(now);
    assert.equal(first.ok, true); assert.equal(writes.length, 4); assert.ok(first.results.every((result) => result.writes.length === 2));
    assert.equal((await sync.syncCompletedMarketPrices(now)).results.every((result) => !result.changed), true); assert.equal(writes.length, 4);
    assert.equal(rows.get('BTC-USD:2026-10-01').technical_indicators.untouched, true); assert.equal(rows.get('BTC-USD:2026-10-01').created_at, 'original');
    assert.ok(queried.every((table) => table === 'etf_daily_prices'));
    assert.equal(rows.get('SPY:2026-09-29').close, 12345); assert.equal(rows.get('BTC-USD:2026-09-29').close, 12345);
  });
  await check('missing provider data causes no fabricated writes and reports a retryable failure', async () => {
    const sync = load('src/lib/market-data/sync-completed-market-prices.ts', { '../supabase/admin': { createSupabaseAdminClient: () => ({ from() { throw Error('No database reads expected'); } }) }, './completed-price-bars': { fetchCompletedYahooPrices: async () => [] } });
    const result = await sync.syncCompletedMarketPrices(new Date('2026-10-02'));
    assert.equal(result.ok, false); assert.ok(result.results.every((item) => !item.changed && item.error && item.row === null));
  });
  await check('provider staleness reports actual/expected dates; weekends and holidays are not failures', async () => {
    const now = new Date('2026-09-07T21:00:00Z');
    let stale = false;
    const source = (ticker) => prices.parseCompletedYahooPrices(ticker, payload(ticker, ticker === 'SPY' ? stale ? '2026-09-03' : '2026-09-04' : '2026-09-06'), now);
    const admin = { from() { let ticker; return { select() { return this; }, eq(key, value) { ticker = value; return this; }, gte() { return this; }, lte() { return this; }, then(resolve) { return Promise.resolve({ data: source(ticker), error: null }).then(resolve); } }; } };
    const sync = load('src/lib/market-data/sync-completed-market-prices.ts', { '../supabase/admin': { createSupabaseAdminClient: () => admin }, './completed-price-bars': { latestCompletedPriceDate: prices.latestCompletedPriceDate, fetchCompletedYahooPrices: async (ticker) => source(ticker) } });
    const holiday = await sync.syncCompletedMarketPrices(now);
    assert.equal(holiday.ok, true); assert.equal(holiday.results[0].tradeDate, '2026-09-04');
    stale = true;
    const old = await sync.syncCompletedMarketPrices(now);
    assert.equal(old.ok, false); assert.equal(old.results[0].stale, true);
    assert.equal(old.results[0].tradeDate, '2026-09-03'); assert.equal(old.results[0].expectedDate, '2026-09-04');
    assert.match(old.results[0].error, /2026-09-03.*2026-09-04/); assert.equal(old.results[0].changed, false);
  });
  await check('cron fails closed on missing/empty/invalid credentials before any provider or storage access', async () => {
    let calls = 0; const env = {};
    const route = load('src/app/api/cron/prices/route.ts', { 'node:crypto': require('node:crypto'), 'next/server': { NextResponse: { json: (body, options = {}) => ({ body, ...options }) } }, '@/lib/market-data/sync-completed-market-prices': { syncCompletedMarketPrices: async () => { calls++; return { ok: true }; } } }, { process: { env } });
    assert.equal((await route.GET(new Request('https://example.test/api/cron/prices'))).status, 503);
    env.CRON_SECRET = 'isolated-test-secret';
    for (const header of ['', 'Bearer wrong', 'Bearer isolated-test-secret-extra']) assert.equal((await route.GET(new Request('https://example.test/api/cron/prices', { headers: { authorization: header } }))).status, 401);
    assert.equal(calls, 0);
    const valid = await route.GET(new Request('https://example.test/api/cron/prices', { headers: { authorization: 'Bearer isolated-test-secret' } }));
    assert.equal(valid.status, 200); assert.equal(valid.headers['Cache-Control'], 'no-store'); assert.equal(calls, 1);
  });
  const crons = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).crons;
  assert.ok(crons.some((cron) => cron.path === '/api/cron/prices' && cron.schedule === '15 0 * * *'));
  console.log(`${passed} completed-price scenario groups passed.`);
})().catch((error) => { console.error(error); process.exit(1); });
