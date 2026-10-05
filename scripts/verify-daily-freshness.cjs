/** Runs the actual score/data loaders and refresh effect with isolated fixtures.
 * No credentials, database writes, browser session injection or external requests.
 * Run: node scripts/verify-daily-freshness.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
let now = Date.parse('2026-10-02T11:30:00Z');
let passed = 0;
const compiled = new Map();
class ClockDate extends Date {
  constructor(...args) { if (args.length) super(...args); else super(now); }
  static now() { return now; }
}
function load(relative, mocks, globals = {}) {
  const filename = path.join(root, relative);
  if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText);
  const module = { exports: {} };
  vm.runInNewContext(`(function(exports, require, module) {${compiled.get(filename)}\n})`, { Date: ClockDate, Intl, ...globals }, { filename })(module.exports, (name) => {
    if (!(name in mocks)) throw new Error(`Unmocked dependency: ${name}`);
    return mocks[name];
  }, module);
  return module.exports;
}
function database(tables, fail = () => false) {
  const queries = [];
  return {
    queries,
    client: { from(table) {
      const state = { table, columns: '', filters: [], orders: [], limit: null, single: false };
      let promise;
      const query = {
        select(columns) { state.columns = columns; return query; },
        order(column, options = {}) { state.orders.push([column, options.ascending !== false]); return query; },
        eq(column, value) { state.filters.push([column, 'eq', value]); return query; },
        gte(column, value) { state.filters.push([column, 'gte', value]); return query; },
        lte(column, value) { state.filters.push([column, 'lte', value]); return query; },
        limit(value) { state.limit = value; return query; },
        maybeSingle() { state.single = true; return query; },
        then(resolve, reject) {
          if (!promise) {
            queries.push({ ...state, filters: [...state.filters], orders: [...state.orders] });
            if (fail(state)) promise = Promise.resolve({ data: null, error: { message: 'Fixture unavailable' } });
            else {
              let rows = [...(tables[table] ?? [])].filter((row) => state.filters.every(([column, op, value]) => op === 'eq' ? row[column] === value : op === 'gte' ? row[column] >= value : row[column] <= value));
              rows.sort((left, right) => {
                for (const [column, ascending] of state.orders) {
                  if (left[column] === right[column]) continue;
                  const comparison = left[column] < right[column] ? -1 : 1;
                  return ascending ? comparison : -comparison;
                }
                return 0;
              });
              if (state.limit != null) rows = rows.slice(0, state.limit);
              rows = rows.map((row) => Object.fromEntries(state.columns.split(',').map((column) => {
                const name = column.trim().split(':')[0];
                return [name, row[name]];
              })));
              promise = Promise.resolve({ data: state.single ? rows[0] ?? null : rows, error: null });
            }
          }
          return promise.then(resolve, reject);
        },
      };
      return query;
    } },
  };
}
const session = load('src/lib/market-data/stock-session.ts', {});
function fixture(asset, dates = ['2026-10-01', '2026-09-30']) {
  const table = asset === 'stocks' ? 'macro_bias_scores' : 'crypto_bias_scores';
  const ticker = asset === 'stocks' ? 'SPY' : 'BTC-USD';
  const tables = {
    [table]: dates.map((date, index) => ({ trade_date: date, score: index ? 3 : 5, bias_label: 'NEUTRAL',
      updated_at: `${date}T13:09:00Z`, created_at: `${date}T13:09:00Z`,
      source_date: asset === 'stocks' && date === '2026-10-01' ? '2026-09-30' : date,
      tradableSignal: { position: 'LONG', reliability: 'A', size: 0.5 },
    })),
    daily_market_briefings: [], crypto_daily_briefings: [],
    etf_daily_prices: [{ ticker, trade_date: asset === 'stocks' ? '2026-09-30' : '2026-10-01', open: 10, high: 12, low: 9, close: 11 }],
  };
  return { table, tables };
}
function loaders(tables, fail) {
  const db = database(tables, fail);
  const snapshot = load('src/lib/product/workspace-snapshot.ts', {
    'server-only': {}, react: { cache: fn => fn }, '../market-data/stock-session': session,
    '../supabase/admin': { createSupabaseAdminClient: () => db.client },
  });
  const scores = load('src/lib/product/score-access.ts', {
    react: { cache: fn => fn }, './workspace-snapshot': snapshot,
    'server-only': {}, '../briefing/daily-briefing-config': { DAILY_BRIEFING_SECTION_HEADERS: { bottomLine: 'BOTTOM LINE' } },
    '../billing/subscription': { getUserSubscriptionStatus: async () => ({ user: null, isPro: false }) },
    '../market-data/stock-session': session,
    '../signal/format-tradable-signal': { extractTradableSignal: ({ tradableSignal }) => tradableSignal },
    '../supabase/admin': { createSupabaseAdminClient: () => db.client },
  });
  const data = load('src/lib/product/public-daily-data.ts', {
    '../market-data/completed-price-bars': load('src/lib/market-data/completed-price-bars.ts', {}),
    'server-only': {}, '../supabase/admin': { createSupabaseAdminClient: () => db.client }, './score-access': scores,
  });
  return { db, scores, data };
}
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }

(async () => {
  for (const asset of ['stocks', 'crypto']) {
    await check(`${asset}: latest public reading for anonymous and Free, without private queries`, async () => {
      const { tables, table } = fixture(asset);
      const { db, scores, data } = loaders(tables);
      for (const user of [null, { id: 'free' }]) {
        const viewer = await scores.getViewerScore(asset, { isPro: false, user }, 'latest-publication');
        assert.equal(viewer.score.tradeDate, '2026-10-01');
        assert.equal(viewer.score.delayed, false);
        assert.equal(viewer.score.permission, null);
        assert.equal(viewer.score.sentence, null);
        assert.equal('modelDecision' in viewer.score, false);
        const daily = await data.loadPublicDailyData(asset, viewer);
        assert.equal(daily.score.tradeDate, '2026-10-01');
        assert.equal(daily.availability.windowEnd, '2026-10-01');
        assert.equal(daily.history.at(-1).tradeDate, '2026-10-01');
      }
      assert.ok(db.queries.filter((query) => query.table === table).every((query) => !/engine_inputs|tradableSignal/.test(query.columns)));
      assert.ok(db.queries.every((query) => !/briefings/.test(query.table)));
      assert.equal((await data.loadPublicDailyData(asset)).score.tradeDate, '2026-10-01');
    });
    await check(`${asset}: weekend/no new publication keeps actual latest date; single row remains visible`, async () => {
      now = Date.parse('2026-10-03T14:00:00Z');
      const { tables } = fixture(asset, ['2026-10-01']);
      const { scores } = loaders(tables);
      const result = await scores.getViewerScore(asset, { user: null, isPro: false }, 'latest-publication');
      assert.equal(result.score.tradeDate, '2026-10-01');
      assert.equal(result.missingSessionDate, null);
      now = Date.parse('2026-10-02T11:30:00Z');
    });
    await check(`${asset}: empty, query outage, invalid score and missing candle remain honest`, async () => {
      const emptyTables = fixture(asset, []).tables;
      emptyTables.etf_daily_prices = [];
      const empty = loaders(emptyTables);
      const none = await empty.data.loadPublicDailyData(asset);
      assert.equal(none.score, null);
      assert.equal(none.availability.windowEnd, null);
      assert.equal(none.candles.length, 0);
      const { tables, table } = fixture(asset);
      const failed = loaders(tables, (query) => query.table === table);
      const unavailable = await failed.data.loadPublicDailyData(asset);
      assert.equal(unavailable.score, null);
      assert.equal(unavailable.availability.scoreStatus, 'unavailable');
      tables[table][0].score = 999;
      const invalid = await loaders(tables).data.loadPublicDailyData(asset);
      assert.equal(invalid.score, null);
      assert.ok(invalid.loadError);
      tables[table][0].score = 5;
      tables.etf_daily_prices = [];
      const missingPrice = await loaders(tables).data.loadPublicDailyData(asset);
      assert.equal(missingPrice.score.tradeDate, '2026-10-01');
      assert.equal(missingPrice.candles.length, 0);
      assert.equal(missingPrice.availability.priceStatus, 'empty');
    });
    await check(`${asset}: completed quote history remains available when no score exists or score loading fails`, async () => {
      const { tables } = fixture(asset, []);
      const quoteOnly = await loaders(tables).data.loadPublicDailyData(asset);
      assert.equal(quoteOnly.score, null);
      assert.equal(quoteOnly.candles.length, 1);
      assert.equal(quoteOnly.availability.priceStatus, 'available');
      const failed = loaders(tables, ({ table: name }) => name === (asset === 'stocks' ? 'macro_bias_scores' : 'crypto_bias_scores'));
      const preserved = await failed.data.loadPublicDailyData(asset);
      assert.equal(preserved.score, null); assert.ok(preserved.loadError);
      assert.equal(preserved.availability.scoreStatus, 'unavailable');
      assert.equal(preserved.candles.length, 1); assert.equal(preserved.availability.priceStatus, 'available');
    });
    await check(`${asset}: default delay and paid current-decision selector stay unchanged`, async () => {
      const { tables } = fixture(asset);
      const { scores } = loaders(tables);
      const legacyFree = await scores.getViewerScore(asset, { user: { id: 'free' }, isPro: false });
      assert.equal(legacyFree.score.tradeDate, '2026-09-30');
      const pro = await scores.getViewerScore(asset, { user: { id: 'pro' }, isPro: true }, 'latest-publication');
      assert.equal(pro.score.tradeDate, '2026-10-01');
      assert.equal(pro.score.modelDecision.position, 'LONG');
      assert.equal(pro.score.modelDecision.size, 0.5);
    });
  }
  await check('publication and source dates stay distinct; unfinished stock bars are excluded', async () => {
    const { tables } = fixture('stocks');
    tables.etf_daily_prices.push({ ticker: 'SPY', trade_date: '2026-10-02', open: 11, high: 12, low: 10, close: 11 });
    const daily = await loaders(tables).data.loadPublicDailyData('stocks');
    assert.equal(daily.score.tradeDate, '2026-10-01');
    assert.equal(daily.score.publishedAt, '2026-10-01T13:09:00Z');
    assert.equal(daily.score.sourceTradeDate, '2026-09-30');
    assert.equal(daily.candles.at(-1).tradeDate, '2026-09-30');
    assert.match(daily.priceNotice, /Completed SPY close pending for 1 Oct 2026/);
  });
  await check('both markets refresh completed quotes without a new score; exact-date joins preserve missing scores', async () => {
    const chart = load('src/lib/product/market-chart.ts', {});
    for (const asset of ['stocks', 'crypto']) {
      now = Date.parse(asset === 'stocks' ? '2026-10-02T20:16:00Z' : '2026-10-03T00:01:00Z');
      const { tables } = fixture(asset);
      const { data } = loaders(tables);
      const before = await data.loadPublicDailyData(asset);
      tables.etf_daily_prices.push({ ticker: asset === 'stocks' ? 'SPY' : 'BTC-USD', trade_date: '2026-10-02', open: 11, high: 12, low: 10, close: 11 });
      const refreshed = await data.loadPublicDailyData(asset);
      assert.equal(refreshed.score.tradeDate, before.score.tradeDate);
      assert.equal(refreshed.score.sourceTradeDate, before.score.sourceTradeDate);
      assert.equal(refreshed.availability.lastCandleDate, '2026-10-02');
      assert.equal(refreshed.availability.windowStart, '2026-07-02');
      assert.equal(refreshed.availability.windowEnd, '2026-10-02');
      const series = chart.windowMarketChartSeries(chart.buildMarketChartSeries(refreshed.candles, refreshed.history, null));
      assert.equal(series.latestMark.tradeDate, '2026-10-01');
      assert.equal(series.latestCandle.tradeDate, '2026-10-02');
      assert.equal(series.sessions.at(-1).mark, null);
      assert.equal(refreshed.priceNotice, null);
    }
    now = Date.parse('2026-10-02T11:30:00Z');
  });
  await check('NYSE weekend and holiday do not produce a false overdue-price notice; BTC current UTC day stays excluded', async () => {
    const { tables } = fixture('stocks', ['2026-09-04']);
    tables.etf_daily_prices[0].trade_date = '2026-09-04';
    now = Date.parse('2026-09-07T21:00:00Z');
    const holiday = await loaders(tables).data.loadPublicDailyData('stocks');
    assert.equal(holiday.availability.lastCandleDate, '2026-09-04');
    assert.equal(holiday.priceNotice, null);
    now = Date.parse('2026-09-06T14:00:00Z');
    assert.equal((await loaders(tables).data.loadPublicDailyData('stocks')).priceNotice, null);
    now = Date.parse('2026-10-02T12:00:00Z');
    const crypto = fixture('crypto');
    crypto.tables.etf_daily_prices.push({ ticker: 'BTC-USD', trade_date: '2026-10-02', open: 11, high: 12, low: 10, close: 11 });
    assert.equal((await loaders(crypto.tables).data.loadPublicDailyData('crypto')).availability.lastCandleDate, '2026-10-01');
    now = Date.parse('2026-10-02T11:30:00Z');
  });
  await check('Pro missing current stock session remains unavailable instead of moving a dated decision', async () => {
    const { tables } = fixture('stocks', ['2026-09-29']);
    const pro = await loaders(tables).scores.getViewerScore('stocks', { user: { id: 'pro' }, isPro: true }, 'latest-publication');
    assert.equal(pro.score, null);
    assert.equal(pro.missingSessionDate, '2026-10-02');
  });
  await check('refresh lifecycle: new stored publication, visible timer/focus, hidden skip, throttle and cleanup', async () => {
    const { tables, table } = fixture('stocks');
    const { data } = loaders(tables);
    let rendered = await data.loadPublicDailyData('stocks');
    let pending;
    let refreshCount = 0;
    let transitions = 0;
    let cleanup;
    const events = () => {
      const listeners = new Map();
      return {
        addEventListener(name, callback) { assert.equal(listeners.has(name), false); listeners.set(name, callback); },
        removeEventListener(name, callback) { assert.equal(listeners.get(name), callback); listeners.delete(name); },
        fire(name) { listeners.get(name)?.(); },
        size() { return listeners.size; },
      };
    };
    const document = { ...events(), visibilityState: 'visible' };
    let tick;
    let interval;
    let cleared = false;
    const window = { ...events(), setInterval(callback, milliseconds) { tick = callback; interval = milliseconds; return 9; }, clearInterval(id) { assert.equal(id, 9); cleared = true; } };
    const router = { refresh() { refreshCount++; pending = data.loadPublicDailyData('stocks').then((next) => { rendered = next; }); } };
    const component = load('src/components/product/DailyReadingRefresh.tsx', {
      react: { useEffect(effect) { cleanup = effect(); }, startTransition(callback) { transitions++; callback(); } },
      'next/navigation': { useRouter: () => router },
    }, { window, document });
    assert.equal(component.DailyReadingRefresh(), null);
    assert.equal(interval, 60_000);
    assert.equal(rendered.score.tradeDate, '2026-10-01');
    tables[table].push({ ...tables[table][0], trade_date: '2026-10-02', created_at: '2026-10-02T12:35:00Z', source_date: '2026-10-01' });
    now = Date.parse('2026-10-02T12:36:00Z');
    tick(); await pending;
    assert.equal(rendered.score.tradeDate, '2026-10-02');
    assert.equal(rendered.score.sourceTradeDate, '2026-10-01');
    window.fire('focus'); document.fire('visibilitychange'); window.fire('pageshow');
    assert.equal(refreshCount, 1, 'duplicate focus/visibility/pageshow events are throttled');
    document.visibilityState = 'hidden'; now += 60_000;
    tick(); window.fire('focus');
    assert.equal(refreshCount, 1, 'hidden pages do not request refreshes');
    document.visibilityState = 'visible'; document.fire('visibilitychange'); await pending;
    assert.equal(refreshCount, 2);
    assert.equal(rendered.score.tradeDate, '2026-10-02', 'no new publication does not advance date');
    now += 5_000; window.fire('focus'); await pending;
    assert.equal(refreshCount, 3);
    assert.equal(transitions, refreshCount);
    cleanup();
    assert.equal(cleared, true);
    assert.equal(window.size(), 0); assert.equal(document.size(), 0);
    window.fire('focus'); document.fire('visibilitychange');
    assert.equal(refreshCount, 3);
  });
  console.log(`${passed} daily freshness scenario groups passed.`);
})().catch((error) => { console.error(error); process.exit(1); });
