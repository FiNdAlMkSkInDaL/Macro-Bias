/** Actual crypto ingestion and UTC-session source with isolated provider/model/database.
 * No credentials, network requests, live scores or email writes.
 * Run: node scripts/verify-crypto-daily-service.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const DAY = 86_400_000;
const iso = (value) => new Date(value).toISOString().slice(0, 10);
const clone = (value) => JSON.parse(JSON.stringify(value));

function harness(now, options = {}) {
  const requests = []; const writes = []; const inputs = []; const tables = new Map();
  const timeouts = []; const delays = []; const attempts = new Map();
  let activeRequests = 0; let peakRequests = 0;
  const put = (table, row) => {
    if (!tables.has(table)) tables.set(table, new Map());
    const key = table === 'etf_daily_prices' ? `${row.ticker}:${row.trade_date}` : row.trade_date;
    tables.get(table).set(key, clone(row));
  };
  for (const item of options.seed ?? []) put(item.table, item.row);
  const dayStart = Date.parse(`${iso(now)}T00:00:00Z`);
  const expected = iso(dayStart - DAY);
  function rows(ticker) {
    const history = [];
    const base = { 'BTC-USD': 10000, 'ETH-USD': 1000, 'SOL-USD': 50, 'DX-Y.NYB': 100, GLD: 200, TLT: 90 }[ticker];
    for (let offset = -240; offset <= 1; offset++) {
      const time = dayStart + offset * DAY; const date = iso(time); const weekday = new Date(time).getUTCDay();
      if (['DX-Y.NYB', 'GLD', 'TLT'].includes(ticker) && (weekday === 0 || weekday === 6 || options.holidays?.includes(date))) continue;
      if (options.missing?.some(item => item.ticker === ticker && item.date === date)) continue;
      const close = base + (offset + 240) / 10;
      history.push({ ticker, trade_date: date, open: close - 0.25, high: close + 1,
        low: close - 1, close, adjusted_close: close, volume: 1000, source: 'fixture-provider' });
    }
    return history;
  }
  for (const ticker of ['GLD', 'TLT']) {
    for (const row of rows(ticker)) put('etf_daily_prices', row);
  }
  const database = { from(table) {
    const state = { filters: [], start: 0, end: Infinity };
    const query = {
      select() { return query; }, order() { return query; },
      eq(key, value) { state.filters.push(row => row[key] === value); return query; },
      gte(key, value) { state.filters.push(row => row[key] >= value); return query; },
      lte(key, value) { state.filters.push(row => row[key] <= value); return query; },
      range(start, end) { state.start = start; state.end = end; return query; },
      then(resolve, reject) { return Promise.resolve({ data: [...(tables.get(table)?.values() ?? [])]
        .filter(row => state.filters.every(filter => filter(row))).slice(state.start, state.end + 1), error: null }).then(resolve, reject); },
      async upsert(values, config) {
        assert.equal(config.ignoreDuplicates, true, `${table} must preserve existing rows`);
        const expectedConflict = table === 'etf_daily_prices' ? 'ticker,trade_date' : 'trade_date';
        assert.equal(config.onConflict, expectedConflict);
        for (const row of values) {
          const key = table === 'etf_daily_prices' ? `${row.ticker}:${row.trade_date}` : row.trade_date;
          if (tables.get(table)?.has(key)) continue;
          writes.push({ table, row: clone(row) }); put(table, row);
        }
        return { error: null };
      },
    };
    return query;
  }};
  const mocks = {
    'src/lib/supabase/admin.ts': { createSupabaseAdminClient: () => database },
    'src/lib/signal/index.ts': { CRYPTO_STRATEGY_RULES: {} },
    'src/lib/crypto-bias/calculate-crypto-bias.ts': { calculateCryptoDailyBias(input) {
      inputs.push(clone(input));
      return { tradeDate: input.tradeDate, score: 10, label: 'RISK_ON', tickerChanges: input.tickerChanges,
        componentScores: [], signal: {}, blendedForwardReturn: 0, modelVersion: 'isolated-fixture' };
    } },
  };
  const cache = new Map();
  function load(file) {
    if (file in mocks) return mocks[file];
    if (cache.has(file)) return cache.get(file).exports;
    const filename = path.join(root, file);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} }; cache.set(file, module);
    const localRequire = name => {
      const relative = path.relative(root, path.resolve(path.dirname(filename), name)).replaceAll('\\', '/');
      const candidates = [relative + '.ts', relative + '/index.ts'];
      const next = candidates.find(value => value in mocks || fs.existsSync(path.join(root, value)));
      assert.ok(next, `Unexpected dependency ${name}`); return load(next);
    };
    vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
      Date, Error, URL, AbortSignal: { timeout(ms) { timeouts.push(ms); return { fixtureTimeoutMs: ms }; } }, console: { log() {} },
      setTimeout(fn, ms) { delays.push(ms); fn(); return 0; },
      fetch: async (url, config) => {
        const ticker = decodeURIComponent(url.pathname.split('/').at(-1));
        requests.push({ ticker, url: String(url), config });
        activeRequests++; peakRequests = Math.max(peakRequests, activeRequests);
        await Promise.resolve();
        activeRequests--;
        const attempt = (attempts.get(ticker) ?? 0) + 1; attempts.set(ticker, attempt);
        if (options.failFetchTicker === ticker) throw new Error('Isolated provider timeout');
        const history = rows(ticker);
        const quote = Object.fromEntries(['open', 'high', 'low', 'close', 'volume'].map(key => [key,
          history.map(row => options.invalid?.some(item => item.ticker === ticker && item.date === row.trade_date && item.key === key) ? null : row[key]) ]));
        return { ok: true, status: 200, json: async () => ({ chart: { result: [{ timestamp: history.map(row => Date.parse(`${row.trade_date}T00:00:00Z`) / 1000),
          indicators: { quote: [quote], adjclose: [{ adjclose: history.map(row => row.adjusted_close) }] } }] } }) };
      },
    }, { filename })(localRequire, module, module.exports);
    return module.exports;
  }
  return { load, requests, writes, inputs, tables, expected, timeouts, delays, attempts,
    get peakRequests() { return peakRequests; }, get activeRequests() { return activeRequests; } };
}

let passed = 0;
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
(async () => {
  await check('UTC daily finality includes weekends/holidays and changes exactly at midnight', () => {
    const session = harness(new Date('2026-10-04')).load('src/lib/crypto-market-data/crypto-session.ts');
    for (const [now, expected] of [
      ['2026-10-03T12:30:00Z', '2026-10-02'], ['2026-10-04T12:30:00Z', '2026-10-03'],
      ['2026-09-07T12:30:00Z', '2026-09-06'], ['2026-10-04T23:59:59.999Z', '2026-10-03'],
      ['2026-10-05T00:00:00.000Z', '2026-10-04'], ['2026-03-29T00:15:00Z', '2026-03-28'],
    ]) assert.equal(session.latestCompletedCryptoTradeDate(new Date(now)), expected);
    assert.equal(session.cryptoUtcDayStart(new Date('2026-10-04T23:59:00Z')).toISOString(), '2026-10-04T00:00:00.000Z');
    assert.equal(session.isCompletedCryptoTradeDate('2026-10-04', new Date('2026-10-04T23:59:59Z')), false);
    assert.equal(session.isCompletedCryptoTradeDate('2026-02-30', new Date('2026-10-04')), false);
    assert.throws(() => session.cryptoUtcDayStart(new Date('bad')), /Invalid crypto session time/);
  });
  for (const nowText of ['2026-10-03T12:30:00Z', '2026-10-04T12:30:00Z', '2026-09-07T12:30:00Z']) {
    await check(`actual ingestion publishes ${nowText.slice(0, 10)} independently of stock calendar`, async () => {
      const now = new Date(nowText); const fixture = harness(now, { holidays: ['2026-09-07'] });
      const result = await fixture.load('src/lib/crypto-market-data/upsert-crypto-market-data.ts').upsertCryptoMarketData({ asOfDate: now, lookbackDays: 240 });
      assert.equal(result.tradeDate, fixture.expected); assert.equal(fixture.inputs.length, 1);
      for (const request of fixture.requests) {
        const url = new URL(request.url);
        assert.equal(Number(url.searchParams.get('period2')), Date.parse(`${nowText.slice(0, 10)}T00:00:00Z`) / 1000);
        assert.equal(url.searchParams.get('interval'), '1d'); assert.equal(request.config.cache, 'no-store');
      }
      assert.ok(fixture.writes.length > 0);
      assert.ok(fixture.writes.every(item => item.row.trade_date <= fixture.expected));
      assert.ok(fixture.writes.filter(item => item.table === 'etf_daily_prices').every(item => !['GLD', 'TLT'].includes(item.row.ticker)));
      const score = fixture.tables.get('crypto_bias_scores').get(fixture.expected);
      const actualSharedDate = nowText.startsWith('2026-09-07') ? '2026-09-04' : '2026-10-02';
      assert.deepEqual(score.engine_inputs.sharedMarketDataAsOf, { DXY: actualSharedDate, GLD: actualSharedDate, TLT: actualSharedDate });
      assert.ok(fixture.writes.filter(item => item.table === 'etf_daily_prices' && item.row.ticker === 'DXY')
        .every(item => ![0, 6].includes(new Date(`${item.row.trade_date}T00:00:00Z`).getUTCDay())));
      for (const ticker of ['BTC-USD', 'ETH-USD', 'SOL-USD']) assert.equal(result.tickerChanges[ticker].tradeDate, fixture.expected);
      const firstWrites = fixture.writes.length;
      await fixture.load('src/lib/crypto-market-data/upsert-crypto-market-data.ts').upsertCryptoMarketData({ asOfDate: now, lookbackDays: 240 });
      assert.equal(fixture.writes.length, firstWrites, 'retry must not rewrite prices or score');
    });
  }
  for (const options of [
    { missing: [{ ticker: 'BTC-USD', date: '2026-10-03' }] },
    { missing: [{ ticker: 'ETH-USD', date: '2026-10-02' }] },
    { missing: [{ ticker: 'SOL-USD', date: '2026-10-03' }] },
    { invalid: [{ ticker: 'BTC-USD', date: '2026-10-03', key: 'open' }] },
  ]) {
    await check(`missing/incomplete real candles fail before any model or storage writes: ${JSON.stringify(options)}`, async () => {
      const now = new Date('2026-10-04T12:30:00Z'); const fixture = harness(now, options);
      await assert.rejects(() => fixture.load('src/lib/crypto-market-data/upsert-crypto-market-data.ts').upsertCryptoMarketData({ asOfDate: now, lookbackDays: 240 }), /stale or incomplete|Missing completed/);
      assert.equal(fixture.inputs.length, 0); assert.equal(fixture.writes.length, 0);
    });
  }
  await check('existing historical prices and published scores remain byte-for-byte unchanged', async () => {
    const now = new Date('2026-10-04T12:30:00Z');
    const historicalPrice = { ticker: 'BTC-USD', trade_date: '2026-10-01', close: 999, technical_indicators: { retained: true }, created_at: 'original' };
    const existingScore = { trade_date: '2026-10-03', score: -99, engine_inputs: { retained: true }, brief_content: 'original' };
    const fixture = harness(now, { seed: [ { table: 'etf_daily_prices', row: historicalPrice }, { table: 'crypto_bias_scores', row: existingScore } ] });
    await fixture.load('src/lib/crypto-market-data/upsert-crypto-market-data.ts').upsertCryptoMarketData({ asOfDate: now, lookbackDays: 240 });
    assert.deepEqual(fixture.tables.get('etf_daily_prices').get('BTC-USD:2026-10-01'), historicalPrice);
    assert.deepEqual(fixture.tables.get('crypto_bias_scores').get('2026-10-03'), existingScore);
    assert.ok(fixture.writes.every(item => ['etf_daily_prices', 'crypto_bias_scores'].includes(item.table)));
  });
  await check('actual provider concurrency and retries keep crypto external waits inside the cron budget', async () => {
    const now = new Date('2026-10-04T12:30:00Z'); const fixture = harness(now, { failFetchTicker: 'BTC-USD' });
    await assert.rejects(() => fixture.load('src/lib/crypto-market-data/upsert-crypto-market-data.ts').upsertCryptoMarketData({ asOfDate: now, lookbackDays: 240 }), /Isolated provider timeout/);
    assert.equal(fixture.attempts.get('BTC-USD'), 2);
    for (const ticker of ['ETH-USD', 'SOL-USD', 'DX-Y.NYB']) assert.equal(fixture.attempts.get(ticker), 1);
    assert.ok(fixture.peakRequests >= 2, 'independent histories must overlap');
    assert.ok(fixture.timeouts.every(ms => ms === 10_000));
    assert.ok(fixture.delays.includes(1_500));
    assert.ok(fixture.delays.includes(750));
    assert.equal(fixture.activeRequests, 0, 'all independent provider requests must settle before returning');
    assert.equal(fixture.inputs.length, 0); assert.equal(fixture.writes.length, 0);
  });
  console.log(`${passed} crypto daily ingestion scenario groups passed. No live writes or delivery.`);
})().catch(error => { console.error(error); process.exit(1); });
