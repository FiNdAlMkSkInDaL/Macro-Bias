/** Actual source retry and cron failure fixtures. No external requests or writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const instant = Date.parse('2026-10-06T06:15:00Z');
class ClockDate extends Date {
  constructor(...args) { super(...(args.length ? args : [instant])); }
  static now() { return instant; }
}
function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) { assert.ok(name in mocks, `Unexpected dependency ${name}`); return mocks[name]; },
    Date: ClockDate, Intl, URL, AbortSignal, Buffer, Error,
    ...globals,
  });
  return module.exports;
}
function payload(dates) {
  const prices = dates.map((_, index) => 770 + index);
  return { chart: { result: [{
    meta: { symbol: 'SPY', exchangeTimezoneName: 'America/New_York' },
    timestamp: dates.map(date => Date.parse(`${date}T13:30:00Z`) / 1000),
    indicators: {
      quote: [{ open: prices, high: prices.map(value => value + 2), low: prices.map(value => value - 2), close: prices, volume: prices.map(() => 1000) }],
      adjclose: [{ adjclose: prices }],
    },
  }] } };
}
function source(responses) {
  let requests = 0;
  const delays = [];
  const module = load('src/lib/market-data/completed-price-bars.ts', {}, {
    fetch: async (_url, options) => {
      assert.equal(options.cache, 'no-store');
      assert.ok(options.signal instanceof AbortSignal);
      const response = responses[Math.min(requests++, responses.length - 1)];
      if (response instanceof Error) throw response;
      return { ok: true, json: async () => response };
    },
    setTimeout(callback, delay) { delays.push(delay); callback(); },
  });
  return { module, requests: () => requests, delays };
}
let passed = 0;
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }

(async () => {
  await check('Oct 6 morning recovery retries an Oct 2 provider response and returns only completed bars through Oct 5', async () => {
    const test = source([payload(['2026-10-02']), payload(['2026-10-02', '2026-10-05', '2026-10-06'])]);
    const rows = await test.module.fetchCompletedYahooPrices('SPY', new ClockDate());
    assert.equal(test.requests(), 2);
    assert.deepEqual(test.delays, [1500]);
    assert.equal(rows.at(-1).trade_date, '2026-10-05');
    assert.ok(!rows.some(row => row.trade_date === '2026-10-06'));
  });
  await check('22:15 UTC includes the current completed NY session in both daylight and standard time', async () => {
    for (const [now, previous, latest] of [
      ['2026-10-06T22:15:00Z', '2026-10-05', '2026-10-06'],
      ['2026-11-03T22:15:00Z', '2026-11-02', '2026-11-03'],
    ]) {
      const test = source([payload([previous, latest])]);
      const rows = await test.module.fetchCompletedYahooPrices('SPY', new ClockDate(now));
      assert.equal(test.requests(), 1);
      assert.equal(rows.at(-1).trade_date, latest);
      assert.equal(test.module.latestCompletedPriceDate('SPY', new ClockDate(now)), latest);
    }
  });
  await check('a temporarily empty final-bar response recovers on the next attempt', async () => {
    const test = source([payload(['2026-10-06']), payload(['2026-10-05'])]);
    const rows = await test.module.fetchCompletedYahooPrices('SPY', new ClockDate());
    assert.equal(test.requests(), 2);
    assert.equal(rows.at(-1).trade_date, '2026-10-05');
  });
  await check('exhausted stale retries retain valid older bars and storage rejects overwriting them', async () => {
    const test = source([payload(['2026-10-02'])]);
    const rows = await test.module.fetchCompletedYahooPrices('SPY', new ClockDate());
    assert.equal(test.requests(), 3);
    assert.deepEqual(test.delays, [1500, 3000]);
    assert.equal(rows.at(-1).trade_date, '2026-10-02');
    let writes = 0;
    const db = { from() {
      let ticker;
      const query = {
        select() { return query; }, eq(_key, value) { ticker = value; return query; },
        gte() { return query; }, lte() { return query; }, abortSignal() { return query; },
        upsert() { writes++; assert.fail('Stale source must not overwrite the stored candle'); },
        then(resolve, reject) {
          return Promise.resolve({ data: [{ ...rows[0], ticker, close: 777, created_at: '2026-10-03T00:00:00Z' }], error: null }).then(resolve, reject);
        },
      };
      return query;
    } };
    const sync = load('src/lib/market-data/sync-completed-market-prices.ts', {
      '../supabase/admin': { createSupabaseAdminClient: () => db },
      './completed-price-bars': { latestCompletedPriceDate: test.module.latestCompletedPriceDate, fetchCompletedYahooPrices: async ticker => rows.map(row => ({ ...row, ticker })) },
    });
    const result = await sync.syncCompletedMarketPrices(new ClockDate());
    assert.equal(result.ok, false);
    assert.equal(result.results[0].tradeDate, '2026-10-02');
    assert.ok(result.results[0].error.includes('2026-10-05'));
    assert.equal(writes, 0);
  });
  await check('later transport failures preserve verified older bars for stale catch-up', async () => {
    const test = source([payload(['2026-10-02']), Error('Fixture provider unavailable.')]);
    const rows = await test.module.fetchCompletedYahooPrices('SPY', new ClockDate());
    assert.equal(test.requests(), 3);
    assert.equal(rows.at(-1).trade_date, '2026-10-02');
    const unavailable = source([Error('Fixture provider unavailable.')]);
    await assert.rejects(unavailable.module.fetchCompletedYahooPrices('SPY', new ClockDate()), /Fixture provider unavailable/);
    assert.equal(unavailable.requests(), 3);
  });
  await check('retry deadline preserves actual bars without spending unavailable delay time', async () => {
    const test = source([payload(['2026-10-02'])]);
    const rows = await test.module.fetchCompletedYahooPrices('SPY', new ClockDate(), { deadlineAt: instant + 1000 });
    assert.equal(rows.at(-1).trade_date, '2026-10-02');
    assert.equal(test.requests(), 1);
    assert.equal(test.delays.length, 0);
  });
  await check('cron records a stale ticker and returns 502; unexpected failures also produce a bounded error response', async () => {
    const logs = [];
    let syncCalls = 0;
    let outcome = { observedAt: new ClockDate().toISOString(), ok: false, results: [{ ticker: 'SPY', tradeDate: '2026-10-02', expectedDate: '2026-10-05', changed: false, writes: [], error: 'Completed SPY bar missing.' }] };
    const route = load('src/app/api/cron/prices/route.ts', {
      'node:crypto': require('node:crypto'),
      'next/server': { NextResponse: { json: (body, options) => ({ body, ...options }) } },
      '@/lib/market-data/sync-completed-market-prices': { async syncCompletedMarketPrices() { syncCalls++; if (outcome instanceof Error) throw outcome; return outcome; } },
    }, {
      process: { env: { CRON_SECRET: 'fixture-secret' } },
      console: { info: value => logs.push(value), error: value => logs.push(value) },
    });
    const denied = await route.GET({ headers: { get: () => 'Bearer invalid-fixture' } });
    assert.equal(denied.status, 401);
    assert.equal(syncCalls, 0);
    assert.equal(logs.length, 0);
    const request = { headers: { get: () => 'Bearer fixture-secret' } };
    const result = await route.GET(request);
    assert.equal(result.status, 502);
    assert.match(logs[0], /SPY.*2026-10-02.*2026-10-05/);
    assert.ok(!logs[0].includes('fixture-secret'));
    outcome = Error('Fixture storage unavailable.');
    const failed = await route.GET(request);
    assert.equal(failed.status, 502);
    assert.equal(failed.body.error, 'Fixture storage unavailable.');
    assert.equal(failed.headers['Cache-Control'], 'no-store');
    assert.equal(syncCalls, 2);
  });
  console.log(`${passed} price recovery scenario groups passed; zero external requests or writes.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
