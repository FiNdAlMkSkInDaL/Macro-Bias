/** In-memory providers only. No credentials, subscribers, sends, orders or production writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const loader = require('./distribution-loader.cjs');
const overrides = {};
let activeAdmin;
overrides['../supabase/admin'] = { createSupabaseAdminClient: () => { assert(activeAdmin, 'unexpected provider access'); return activeAdmin; } };
const load = loader(overrides, { VERCEL_GIT_COMMIT_SHA: '', MODEL_SOURCE_REVISION: 'fixture-source-commit' });
overrides['../signal'] = load('src/lib/signal/strategy');
const { MODEL_FORWARD: recipe } = load('src/lib/model-forward/recipe');
const service = load('src/lib/model-forward/service');
const records = load('src/lib/model-forward/records');
const { relativeStrengthSeries } = load('src/lib/model-forward/features');
const { calculateRelativeStrengthIndex } = load('src/lib/macro-bias/technical-analysis');
const { computeForwardPrediction } = load('src/lib/model-forward/models');
const { isCompletedPriceDate } = load('src/lib/market-data/completed-price-bars');
const { stockRiskText } = load('src/lib/model-forward/risk');
const { loadPublicStockRisk } = load('src/lib/model-forward/public-risk');
const date = '2026-10-27T09:00:00.000Z';
const json = value => JSON.parse(JSON.stringify(value));
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, ordered(v)])) : value;
const bases = { SPY: 200, QQQ: 120, TLT: 100, GLD: 100, USO: 50, HYG: 80, VIX: 20, CPER: 20, 'BTC-USD': 1000, 'ETH-USD': 20, DXY: 100 };
const prices = Object.fromEntries(Object.keys(bases).map(t => [t, []]));
let index = 0;
for (let time = Date.parse('2016-01-01'); time <= Date.parse('2026-10-26'); time += 86400000, index++) {
  const d = new Date(time).toISOString().slice(0, 10), equity = isCompletedPriceDate('SPY', d, new Date(date));
  Object.entries(bases).forEach(([ticker, base], j) => {
    if (!ticker.endsWith('-USD') && !equity) return;
    const close = base * Math.exp(index * 0.00015 + 0.08 * Math.sin(index / (31 + j)) + 0.02 * Math.sin(index / (4 + j)));
    prices[ticker].push({ trade_date: d, open: close * (1 + 0.007 * Math.sin(index / (7 + j))), close });
  });
}
function database(now = date) {
  const state = { rows: [], now, insertDelay: null };
  const value = (row, path) => path.replaceAll('->>', '.').replaceAll('->', '.').split('.').reduce((o, k) => o?.[k], row);
  class Query {
    filters = []; inserted = null; lo = 0; hi = Infinity; descending = false;
    select() { return this; }
    in(k, a) { this.filters.push(r => a.includes(value(r, k))); return this; }
    eq(k, x) { this.filters.push(r => value(r, k) === x); return this; }
    gte(k, x) { this.filters.push(r => value(r, k) >= x); return this; }
    order(k, o) { this.sortKeys ??= []; this.sortKeys.push({ key: k, descending: o?.ascending === false }); return this; }
    limit(n) { this.hi = n - 1; return this; }
    range(a, b) { this.lo = a; this.hi = b; return this; }
    insert(row) { this.inserted = row; return this; }
    async execute(single = false) {
      if (this.inserted) {
        if (state.rows.some(r => r.id === this.inserted.id)) return { data: null, error: { code: '23505' } };
        const row = { ...json(this.inserted), metadata: ordered(this.inserted.metadata), created_at: state.insertDelay ?? state.now };
        state.rows.push(row); return { data: row, error: null };
      }
      let rows = state.rows.filter(r => this.filters.every(f => f(r)));
      if (this.sortKeys) rows.sort((a, b) => { for (const { key, descending } of this.sortKeys) { const result = String(value(a, key)).localeCompare(String(value(b, key))) * (descending ? -1 : 1); if (result) return result; } return 0; });
      rows = rows.slice(this.lo, this.hi + 1);
      return { data: json(single ? rows[0] ?? null : rows), error: null };
    }
    single() { return this.execute(true); }
    then(resolve, reject) { return this.execute().then(resolve, reject); }
  }
  const admin = { from(table) { assert.equal(table, 'marketing_event_log'); return new Query(); } };
  return { state, admin, deps: { admin, clock: () => new Date(state.now), readPrices: async () => prices } };
}
function addSession(day) {
  for (const rows of Object.values(prices)) { const prior = rows.at(-1).close; rows.push({ trade_date: day, open: prior * 1.001, close: prior * 1.006 }); }
}
(async () => {
  const closes = prices.SPY.map(p => p.close), fastRsi = relativeStrengthSeries(closes);
  for (const i of [14, 15, 60, 252, closes.length - 1]) assert.equal(fastRsi[i], calculateRelativeStrengthIndex(closes.slice(0, i + 1), 14), 'incremental RSI must match the original helper');
  const h = database(); activeAdmin = h.admin;
  const preview = await service.runModelForward({ preview: true, deps: h.deps });
  assert(preview.ok); assert.equal(h.state.rows.length, 0, 'preview must never persist');
  const concurrent = await Promise.all([service.runModelForward({ deps: h.deps }), service.runModelForward({ deps: h.deps })]);
  assert(concurrent.every(r => r.ok));
  const locked = h.state.rows.filter(r => r.event_name === recipe.predictionEvent);
  assert.equal(locked.length, 2, 'concurrent runs must lock one prediction per market/target');
  locked.forEach(row => assert(records.validSavedPrediction(row), 'JSONB key reordering must preserve integrity'));
  locked.forEach(row => assert.equal(row.metadata.sourceRevision, 'fixture-source-commit', 'empty Vercel Git metadata must use the explicit release commit'));
  const before = json(locked); h.state.now = '2026-10-27T10:00:00Z';
  await service.runModelForward({ deps: h.deps });
  assert.deepEqual(json(h.state.rows.filter(r => r.event_name === recipe.predictionEvent)), before, 'retry cannot revise a prediction');
  const state = await loadPublicStockRisk('2026-10-27', new Date(date));
  assert(state.forecast && state.forecast.absoluteMovePct > 0);
  assert.match(stockRiskText(state), /open to close/); assert.match(stockRiskText(state), /excludes overnight/);
  assert(!Object.keys(state.forecast).includes('arms'), 'public projection cannot expose shadow models');
  assert.equal((await loadPublicStockRisk('2026-10-28', new Date(date))).forecast, null, 'wrong session cannot substitute');
  assert.equal((await loadPublicStockRisk(undefined, new Date('2026-10-27T21:00:00Z'))).forecast, null, 'expired session estimate cannot appear current');
  const altered = json(locked[0]); altered.metadata.prediction.risk.ewma *= 10;
  assert.equal(records.validSavedPrediction(altered), null, 'altered payload excluded');
  const fakeOpen = json(locked[0]); fakeOpen.metadata.prediction.targetOpen = '2026-10-27T23:00:00Z';
  const { checksum, ...payload } = fakeOpen.metadata; fakeOpen.metadata.checksum = records.digest(payload);
  assert.equal(records.validSavedPrediction(fakeOpen), null, 'declared target open cannot bypass the actual market open');
  const late = database('2026-10-27T13:29:59.000Z'); late.state.insertDelay = '2026-10-27T13:30:01.000Z';
  const lateRun = await service.runModelForward({ deps: late.deps });
  assert(!lateRun.ok); assert.equal(service.summarizeForward(late.state.rows).invalid, 1, 'database timestamp excludes a slow late write');
  h.state.now = '2026-10-28T09:00:00Z';
  const missing = await service.runModelForward({ deps: h.deps });
  assert(!missing.ok); assert.equal(h.state.rows.filter(r => r.event_name === recipe.outcomeEvent).length, 0, 'missing outcome is never zero');
  addSession('2026-10-27');
  assert((await service.runModelForward({ deps: h.deps })).ok);
  let report = service.summarizeForward(h.state.rows);
  assert.equal(report.cohorts.find(r => r.market === 'stocks').completed, 1);
  assert.equal(report.cohorts.find(r => r.market === 'crypto').completed, 0, 'unfinished crypto UTC session not graded');
  assert.equal(report.cohorts.find(r => r.market === 'crypto').models, null);
  addSession('2026-10-28'); h.state.now = '2026-10-29T09:00:00Z';
  await service.runModelForward({ deps: h.deps }); report = service.summarizeForward(h.state.rows);
  assert.equal(report.cohorts.find(r => r.market === 'stocks').completed, 2);
  assert.equal(report.cohorts.find(r => r.market === 'crypto').completed, 1);
  assert(report.cohorts.every(r => !r.reviewReady));
  assert(report.cohorts.every(r => r.risk.every(m => m.paired95 === null)), 'tiny sample is not an uncertainty estimate');
  const changed = json(h.state.rows.find(r => r.event_name === recipe.predictionEvent && r.metadata.prediction.market === 'crypto' && r.metadata.prediction.targetDate === '2026-10-30'));
  changed.metadata.modelHash = 'new-model-version'; const { checksum: _, ...newPayload } = changed.metadata; changed.metadata.checksum = records.digest(newPayload);
  const alternate = h.state.rows.filter(r => r.id !== changed.id).concat([changed]);
  assert.equal(service.summarizeForward(alternate).cohorts.length, 3, 'different algorithms never pool their evidence');
  const end = database(recipe.settlementEnd); end.deps.readPrices = () => { throw Error('must not fetch after bounded window'); };
  assert.equal((await service.runModelForward({ deps: end.deps })).mode, 'inactive');
  assert.equal(end.state.rows.length, 0);
  if (process.argv[2]) {
    const cache = JSON.parse(fs.readFileSync(process.argv[2] + '/prices.json', 'utf8')).prices;
    const historical = JSON.parse(fs.readFileSync(process.argv[2] + '/report.json', 'utf8'));
    for (const market of ['stocks', 'crypto']) {
      const actual = computeForwardPrediction(cache, market, new Date(date));
      const expected = historical[market].latestReconstructedPrediction;
      assert.equal(actual.sourceDate, expected.date); assert.equal(actual.targetDate, expected.targetDate);
      for (const name of Object.keys(actual.arms)) for (const field of ['score', 'position', 'expectedReturn', 'probabilityUp']) {
        const a = actual.arms[name][field], b = expected.predictions[name][field];
        assert(a === null && b === null || Math.abs(a - b) < 1e-12, `${market} ${name} ${field}: hosted learner differs from validated research`);
      }
      assert(Math.abs(actual.risk.ewma - expected.riskEwma) < 1e-12);
    }
  }
  console.log('PASS forward test: research parity, preview isolation, concurrent immutable locks, JSONB integrity, actual opens/UTC targets, late database writes, settlement, missing data, public projection, cohort separation and finite window.');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
