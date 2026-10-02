/** Exercise the real server loader without credentials or network requests.
 * Run: node scripts/verify-briefing-data.cjs
 * Supabase mocks apply filters, ordering, pagination and selected-column
 * projection; the actual access policy and loader are transpiled unchanged.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const NOW = Date.parse('2026-10-02T12:00:00Z');
const PRIVATE_COLUMN = /^(brief_content|content|news(?:_.*)?|model(?:_.*)?|modelVersion|source_model)$/;
const compiled = new Map();
let passed = 0;

function loadModule(relativePath, mocks, now = NOW) {
  const filename = path.join(ROOT, relativePath);
  if (!compiled.has(filename)) {
    compiled.set(filename, ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText);
  }
  class ClockDate extends Date { static now() { return now; } }
  const module = { exports: {} };
  const run = vm.runInNewContext(`(function(exports, require, module) {\n${compiled.get(filename)}\n})`, { Date: ClockDate }, { filename });
  run(module.exports, (name) => {
    if (!(name in mocks)) throw new Error(`Unmocked dependency ${name} in ${relativePath}`);
    return mocks[name];
  }, module);
  return module.exports;
}

function database(tables, fail = () => null) {
  const queries = [];
  const client = {
    from(table) {
      const state = { table, columns: '', orders: [], filters: [], range: null, single: false };
      let execution;
      const query = {
        select(columns) { state.columns = columns; return query; },
        order(column, options = {}) { state.orders.push({ column, ascending: options.ascending !== false }); return query; },
        in(column, values) { state.filters.push({ column, values }); return query; },
        eq(column, value) { state.filters.push({ column, values: [value] }); return query; },
        range(from, to) { state.range = [from, to]; return query; },
        maybeSingle() { state.single = true; return query; },
        then(resolve, reject) {
          if (!execution) {
            queries.push({ ...state, orders: [...state.orders], filters: [...state.filters] });
            const failure = fail(state);
            if (failure) execution = Promise.resolve({ data: null, error: { message: failure } });
            else {
              let rows = [...(tables[table] ?? [])].filter((row) => state.filters.every(({ column, values }) => values.includes(row[column])));
              rows.sort((left, right) => {
                for (const { column, ascending } of state.orders) {
                  if (left[column] === right[column]) continue;
                  const comparison = left[column] == null ? -1 : right[column] == null ? 1 : left[column] < right[column] ? -1 : 1;
                  return ascending ? comparison : -comparison;
                }
                return 0;
              });
              if (state.range) rows = rows.slice(state.range[0], state.range[1] + 1);
              const columns = state.columns.split(',').map((column) => column.trim());
              rows = rows.map((row) => columns.includes('*') ? { ...row } : Object.fromEntries(columns.map((column) => [column, row[column]])));
              execution = Promise.resolve({ data: state.single ? rows[0] ?? null : rows, error: null });
            }
          }
          return execution.then(resolve, reject);
        },
      };
      return query;
    },
  };
  return { client, queries };
}

function stock(id, briefingDate, tradeDate, generatedAt, extra = {}) {
  return { id, briefing_date: briefingDate, trade_date: tradeDate, generated_at: generatedAt,
    quant_score: 91, bias_label: 'RISK_ON', is_override_active: false,
    brief_content: `PRIVATE-STOCK-${id}`, news_summary: 'PRIVATE-NEWS', news_headlines: ['PRIVATE-HEADLINE'],
    source_model: 'PRIVATE-MODEL', ...extra };
}
function crypto(id, tradeDate, createdAt, extra = {}) {
  return { id, trade_date: tradeDate, created_at: createdAt, updated_at: '2026-10-02T11:30:00Z',
    score: -42, bias_label: 'RISK_OFF', is_override_active: false,
    brief_content: `PRIVATE-CRYPTO-${id}`, model_version: 'PRIVATE-CRYPTO-MODEL', news_summary: 'PRIVATE-NEWS', ...extra };
}
function score(tradeDate, value = 31) { return { trade_date: tradeDate, score: value, bias_label: value > 0 ? 'RISK_ON' : 'RISK_OFF' }; }
function fixture() {
  return {
    daily_market_briefings: [
      stock('old', '2026-09-24', '2026-09-23', '2026-09-24T12:00:00Z'),
      stock('recent', '2026-10-02', '2026-10-01', '2026-10-02T11:00:00Z'),
    ],
    macro_bias_scores: [score('2026-09-24'), score('2026-09-23', 99), score('2026-10-02', 66), score('2026-10-01', -99)],
    crypto_daily_briefings: [
      crypto('old', '2026-09-24', '2026-09-24T12:00:00Z'),
      crypto('recent', '2026-10-02', '2026-10-02T11:00:00Z'),
    ],
  };
}
function runtime({ signedIn = false, isPro = false, tables = fixture(), now = NOW, fail } = {}) {
  const db = database(tables, fail);
  const policy = loadModule('src/lib/product/briefing-access.ts', {}, now);
  const api = loadModule('src/lib/product/paid-briefing-data.ts', {
    'server-only': {},
    react: { cache(fn) {
      const values = new Map();
      return (...args) => {
        const key = JSON.stringify(args);
        if (!values.has(key)) values.set(key, fn(...args));
        return values.get(key);
      };
    } },
    '@/lib/billing/subscription': { getUserSubscriptionStatus: async () => ({ user: signedIn ? { id: 'viewer' } : null, isPro }) },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => db.client },
    './briefing-access': policy,
  }, now);
  return { api, queries: db.queries };
}
function restrictedQueries(queries) {
  return queries.filter((query) => query.columns.split(',').some((column) => column.trim() === '*' || PRIVATE_COLUMN.test(column.trim())));
}
function assertSafe(value) {
  assert.ok(!JSON.stringify(value).includes('PRIVATE-'), 'Restricted source values must never reach a locked/listing result');
  function visit(item) {
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      assert.ok(!PRIVATE_COLUMN.test(key), `Restricted key ${key} is absent`);
      visit(child);
    }
  }
  visit(value);
}
async function test(name, run) {
  await run();
  passed += 1;
  console.log(`ok: ${name}`);
}

async function main() {
  for (const asset of ['stocks', 'crypto']) {
    await test(`${asset}: anonymous older publication requires sign-in without any private-column query`, async () => {
      const { api, queries } = runtime();
      const result = await api.loadPaidBriefingDetail(asset, '2026-09-24');
      assert.equal(result.access.kind, 'sign-in');
      assert.equal(result.briefing, null);
      assert.ok(result.metadata);
      assertSafe(result);
      assert.equal(restrictedQueries(queries).length, 0);
    });
    await test(`${asset}: anonymous and Free recent publications keep scores public and bodies unfetched`, async () => {
      for (const signedIn of [false, true]) {
        const { api, queries } = runtime({ signedIn });
        const result = await api.loadPaidBriefingDetail(asset, '2026-10-02');
        assert.equal(result.access.kind, 'pro-required');
        assert.equal(result.briefing, null);
        assert.equal(result.metadata.score, asset === 'stocks' ? 66 : -42);
        assertSafe(result);
        assert.equal(restrictedQueries(queries).length, 0);
      }
    });
    await test(`${asset}: Free reads older full content, using the published document id`, async () => {
      const { api, queries } = runtime({ signedIn: true });
      const result = await api.loadPaidBriefingDetail(asset, '2026-09-24');
      assert.equal(result.access.kind, 'free');
      assert.equal(result.briefing.content, `PRIVATE-${asset === 'stocks' ? 'STOCK' : 'CRYPTO'}-old`);
      const [body] = restrictedQueries(queries);
      assert.equal(restrictedQueries(queries).length, 1);
      assert.equal(body.filters[0].column, 'id');
      assert.equal(body.filters[0].values[0], 'old');
      assert.ok(!body.columns.includes('news'), 'Authorized document reads do not fetch unrelated news');
      if (asset === 'crypto') assert.equal(result.briefing.modelVersion, 'PRIVATE-CRYPTO-MODEL');
    });
    await test(`${asset}: Pro reads an actual recent full publication immediately`, async () => {
      const { api, queries } = runtime({ signedIn: true, isPro: true });
      const result = await api.loadPaidBriefingDetail(asset, '2026-10-02');
      assert.equal(result.access.kind, 'pro');
      assert.equal(result.briefing.content, `PRIVATE-${asset === 'stocks' ? 'STOCK' : 'CRYPTO'}-recent`);
      assert.equal(restrictedQueries(queries).length, 1);
    });
    await test(`${asset}: archive fetches and returns metadata only, including public numeric scores`, async () => {
      const { api, queries } = runtime();
      const result = await api.loadPaidBriefingArchive(asset);
      assert.equal(result.loadError, null);
      assert.equal(result.items.length, 2);
      assertSafe(result);
      assert.equal(restrictedQueries(queries).length, 0);
      assert.ok(result.items.every((row) => typeof row.score === 'number'));
      assert.ok(result.items.every((row) => !('id' in row) && !('generatedAt' in row)));
    });
  }

  await test('Exact seven-day boundary opens Free content; one millisecond earlier stays locked', async () => {
    const tables = { crypto_daily_briefings: [crypto('boundary', '2026-09-25', '2026-09-25T12:00:00Z')] };
    const before = runtime({ signedIn: true, tables, now: NOW - 1 });
    const locked = await before.api.loadPaidBriefingDetail('crypto', '2026-09-25');
    assert.equal(locked.access.kind, 'pro-required');
    assert.equal(restrictedQueries(before.queries).length, 0);
    const exact = runtime({ signedIn: true, tables });
    const opened = await exact.api.loadPaidBriefingDetail('crypto', '2026-09-25');
    assert.equal(opened.access.kind, 'free');
    assert.equal(opened.briefing.content, 'PRIVATE-CRYPTO-boundary');
    assert.equal(opened.access.freeAvailableAt, '2026-10-02T12:00:00.000Z');
  });
  await test('Stock regeneration keeps the earliest actual publication age and chooses the latest stored text', async () => {
    const tables = {
      daily_market_briefings: [stock('first', '2026-09-20', '2026-09-19', '2026-09-20T12:00:00Z'), stock('latest', '2026-09-20', '2026-09-19', '2026-10-02T11:00:00Z')],
      macro_bias_scores: [score('2026-09-20', -18), score('2026-09-19', 99)],
    };
    const { api, queries } = runtime({ signedIn: true, tables });
    const result = await api.loadPaidBriefingDetail('stocks', '2026-09-20');
    assert.equal(result.access.kind, 'free');
    assert.equal(result.metadata.publishedAt, '2026-09-20T12:00:00.000Z');
    assert.equal(result.access.freeAvailableAt, '2026-09-27T12:00:00.000Z');
    assert.equal(result.briefing.generatedAt, '2026-10-02T11:00:00.000Z');
    assert.equal(result.briefing.content, 'PRIVATE-STOCK-latest');
    assert.equal(result.briefing.score, -18, 'Displayed stock score follows briefing_date, not source trade_date');
    assert.equal(result.briefing.tradeDate, '2026-09-19');
    assert.equal(restrictedQueries(queries)[0].filters[0].values[0], 'latest');
  });
  await test('An earliest stock publication beyond the first 1,000 versions still controls release', async () => {
    const versions = Array.from({ length: 1000 }, (_, index) => stock(`version-${index}`, '2026-09-20', '2026-09-19', new Date(NOW - 3600000 - index * 1000).toISOString()));
    versions.push(stock('first-ever', '2026-09-20', '2026-09-19', '2026-09-20T12:00:00Z'));
    const { api, queries } = runtime({ signedIn: true, tables: { daily_market_briefings: versions, macro_bias_scores: [score('2026-09-20')] } });
    const result = await api.loadPaidBriefingDetail('stocks', '2026-09-20');
    assert.equal(result.access.kind, 'free');
    assert.equal(result.metadata.publishedAt, '2026-09-20T12:00:00.000Z');
    assert.equal(result.briefing.content, 'PRIVATE-STOCK-version-0');
    const pages = queries.filter((query) => query.table === 'daily_market_briefings' && query.range);
    assert.equal(pages.length, 2);
    assert.deepEqual(pages[1].range, [1000, 1999]);
  });
  await test('Crypto release uses preserved created_at even after a fresh updated_at', async () => {
    const { api } = runtime({ signedIn: true });
    const result = await api.loadPaidBriefingDetail('crypto', '2026-09-24');
    assert.equal(result.access.kind, 'free');
    assert.equal(result.metadata.publishedAt, '2026-09-24T12:00:00.000Z');
    assert.equal(result.metadata.freeAvailableAt, '2026-10-01T12:00:00.000Z');
  });
  await test('Unknown and invalid actual publication timestamps fail closed for Free', async () => {
    for (const timestamp of [null, undefined, '', 'not-a-timestamp']) {
      for (const asset of ['stocks', 'crypto']) {
        const tables = asset === 'stocks'
          ? { daily_market_briefings: [stock('unknown', '2026-09-20', '2026-09-19', timestamp)], macro_bias_scores: [score('2026-09-20')] }
          : { crypto_daily_briefings: [crypto('unknown', '2026-09-20', timestamp)] };
        const { api, queries } = runtime({ signedIn: true, tables });
        const result = await api.loadPaidBriefingDetail(asset, '2026-09-20');
        assert.equal(result.access.kind, 'pro-required');
        assert.equal(result.access.freeAvailableAt, null);
        assert.equal(result.briefing, null);
        assertSafe(result);
        assert.equal(restrictedQueries(queries).length, 0);
      }
    }
  });
  await test('A published stock article remains listed with null aligned score rather than borrowing its source score', async () => {
    const { api, queries } = runtime({ tables: {
      daily_market_briefings: [stock('actual', '2026-09-30', '2026-09-29', '2026-09-30T12:00:00Z')],
      macro_bias_scores: [score('2026-09-29', 87)],
    } });
    const result = await api.loadPaidBriefingArchive('stocks');
    assert.equal(result.loadError, null);
    assert.equal(result.items.length, 1);
    const item = result.items[0];
    assert.equal(item.date, '2026-09-30');
    assert.equal(item.tradeDate, '2026-09-29');
    assert.equal(item.score, null);
    assert.equal(item.biasLabel, 'UNAVAILABLE');
    assert.equal((await api.getBriefingMetadata('stocks', '2026-09-30')).date, '2026-09-30');
    assert.equal(await api.getBriefingMetadata('stocks', '2026-09-29'), null, 'Source bar date does not fabricate an extra published article');
    assert.equal(restrictedQueries(queries).length, 0);
  });
  await test('Metadata and aligned-score outages return a friendly load error, never a false missing article or a body fetch', async () => {
    for (const table of ['daily_market_briefings', 'macro_bias_scores', 'crypto_daily_briefings']) {
      const asset = table === 'crypto_daily_briefings' ? 'crypto' : 'stocks';
      const { api, queries } = runtime({ signedIn: true, isPro: true, fail: (query) => query.table === table ? 'PRIVATE-DATABASE-FAILURE' : null });
      const archive = await api.loadPaidBriefingArchive(asset);
      assert.equal(archive.items.length, 0);
      assert.equal(archive.loadError, 'Briefings could not be loaded. Please try again.');
      const result = await api.loadPaidBriefingDetail(asset, '2026-09-24');
      assert.equal(result.briefing, null);
      assert.equal(result.metadata, null);
      assert.ok(result.loadError, 'Routes can distinguish a metadata outage from a genuinely absent date');
      assertSafe(result);
      assert.equal(restrictedQueries(queries).length, 0);
    }
  });
  await test('Absent and invalid dated articles never fetch a substituted body', async () => {
    for (const date of ['2026-01-01', '2026-02-30', 'invalid']) {
      const { api, queries } = runtime({ signedIn: true, isPro: true });
      const result = await api.loadPaidBriefingDetail('stocks', date);
      assert.equal(result.metadata, null);
      assert.equal(result.briefing, null);
      assert.equal(result.loadError, null);
      assert.equal(restrictedQueries(queries).length, 0);
    }
  });
  await test('A body query failure preserves publication metadata with a friendly retry state', async () => {
    const { api } = runtime({ signedIn: true, isPro: true, fail: (query) => query.columns.includes('brief_content') ? 'PRIVATE-BODY-FAILURE' : null });
    const result = await api.loadPaidBriefingDetail('stocks', '2026-09-24');
    assert.equal(result.metadata.date, '2026-09-24');
    assert.equal(result.briefing, null);
    assert.equal(result.loadError, 'This briefing could not be loaded. Please try again.');
    assertSafe(result);
  });
  await test('A detached Pro flag without a signed-in user cannot grant anonymous content access', async () => {
    const { api, queries } = runtime({ signedIn: false, isPro: true });
    const result = await api.loadPaidBriefingDetail('stocks', '2026-10-02');
    assert.equal(result.access.kind, 'pro-required');
    assert.equal(result.briefing, null);
    assert.equal(restrictedQueries(queries).length, 0);
  });
  await test('Existing billing resolver still grants active, trialing and profile Pro eligibility independently of publication age', async () => {
    for (const [subscriptionStatus, profileIsPro, expected] of [
      ['active', false, true], ['trialing', false, true], ['inactive', true, true],
      ['past_due', false, false], ['canceled', false, false], ['unpaid', false, false], ['inactive', false, false],
    ]) {
      const db = database({ users: [{ id: 'viewer', subscription_status: subscriptionStatus }], profiles: [{ id: 'viewer', is_pro: profileIsPro }] });
      const server = { ...db.client, auth: { getUser: async () => ({ data: { user: { id: 'viewer', email: 'test@example.com' } }, error: null }) } };
      const billing = loadModule('src/lib/billing/subscription.ts', {
        'server-only': {}, '../supabase/admin': { createSupabaseAdminClient: () => db.client },
        '../supabase/server': { createSupabaseServerClient: async () => server },
      });
      assert.equal((await billing.getUserSubscriptionStatus()).isPro, expected, `${subscriptionStatus} / profile ${profileIsPro}`);
      assert.equal(billing.isSubscriptionActive(subscriptionStatus), subscriptionStatus === 'active' || subscriptionStatus === 'trialing');
    }
  });
  console.log(`\n${passed} briefing loader security scenarios passed. Real loader/policy/billing code; mocked database and auth only.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
