/** Actual crypto publisher, stored-brief persistence, stock weekend branch and
 * analytics queries with isolated database, model and delivery fixtures only.
 * Run: node scripts/verify-crypto-publisher.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const BODY = `REGIME STATUS
Crypto is neutral, and today's score is a cautious directional guide.
MARKET MAP
- **Bitcoin**: Neutral -- BTC is holding its latest completed daily level.
- **Altcoins (ETH-led)**: Neutral -- ETH follows the broader market.
- **DeFi/L1s**: Neutral -- Higher-beta assets lack clear leadership.
- **Stablecoins/Flows**: Neutral -- No new flow disruption is evident.
RISK FRAME
The daily move needs confirmation from broader relative strength. Keep the dollar backdrop in view.
MODEL CONTEXT
The nearest historical matches give a mixed directional baseline. Treat the score as context for risk.
Model Diagnostics: BTC Close $100 | BTC Daily Change +1.00% | Score +10 | Analogs 2026-09-24.`;
function defaultTables(now = '2026-10-04T12:30:00Z') {
  const expected = new Date(Date.parse(`${now.slice(0, 10)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return {
    crypto_bias_scores: [{ id: 'fixture-score', trade_date: expected, score: 10, bias_label: 'RISK_ON', component_scores: [],
      ticker_changes: { 'BTC-USD': { close: 100, percentChange: 1 } }, engine_inputs: {}, created_at: now, updated_at: now }],
    crypto_daily_briefings: [{ id: 'fixture-brief', trade_date: expected, brief_content: BODY, score: 10,
      bias_label: 'RISK_ON', is_override_active: false, created_at: now }],
    etf_daily_prices: [{ ticker: 'BTC-USD', trade_date: expected }],
    users: [], free_subscribers: [{ email: 'crypto@fixture-mail.net', status: 'active', crypto_opted_in: true }],
  };
}
function harness(options = {}) {
  const now = options.now ?? '2026-10-04T12:30:00Z';
  let clock = Date.parse(now); let releaseReferral;
  const tables = clone(options.tables ?? defaultTables(now));
  const effects = { queries: [], writes: [], claims: [], finishes: [], deliveries: [], models: [], syncs: [], referrals: [], aiOptions: [], aiRequests: [], adminClients: [], timeouts: [], network: [] };
  const timeline = []; const adminConfigurations = [];
  const env = { CRON_SECRET: 'fixture-secret', RESEND_API_KEY: 'fixture-delivery-key', ...options.env };
  class FixtureDate extends Date {
    constructor(...args) { args.length ? super(...args) : super(clock); }
    static now() { return clock; }
  }
  function query(table, initialRows, captured = {}) {
    const state = { filters: [], first: 0, last: Infinity, order: null, single: false, head: false, count: false };
    const result = {
      select(columns, config = {}) { captured.columns = columns; state.head = config.head; state.count = config.count; return result; },
      eq(key, value) { (captured.equalities ??= []).push({ key, value }); state.filters.push(row => row[key] === value); return result; },
      in(key, values) { state.filters.push(row => values.includes(row[key])); return result; },
      not(key, operator, value) {
        const values = operator === 'in' ? JSON.parse(`[${value.slice(1, -1)}]`) : null;
        state.filters.push(row => values ? !values.includes(row[key]) : row[key] !== value); return result;
      },
      gte(key, value) { state.filters.push(row => row[key] >= value); return result; },
      lte(key, value) { state.filters.push(row => row[key] <= value); return result; },
      order(key, config = {}) { state.order = { key, ascending: config.ascending !== false }; captured.order = state.order; return result; },
      limit(value) { captured.limit = value; state.last = value - 1; return result; },
      range(first, last) { state.first = first; state.last = last; return result; },
      maybeSingle() { captured.maybeSingle = true; state.single = true; return result; }, single() { state.single = true; return result; },
      upsert(values, config) {
        const rows = Array.isArray(values) ? values : [values];
        for (const row of rows) {
          if (!tables[table]) tables[table] = [];
          const keys = config.onConflict.split(',');
          const exists = tables[table].find(item => keys.every(key => item[key] === row[key]));
          if (exists && config.ignoreDuplicates) continue;
          effects.writes.push({ table, row: clone(row), config });
          if (exists) Object.assign(exists, clone(row));
          else tables[table].push({ id: 'fixture-persisted', created_at: now, ...clone(row) });
        }
        return result;
      },
      update(values) { effects.writes.push({ table, update: clone(values) }); return result; },
      then(resolve, reject) {
        if (options.queryError?.table === table) return Promise.resolve({ data: null, error: options.queryError.error ?? { message: 'Fixture query failed' } }).then(resolve, reject);
        let rows = (initialRows ?? tables[table] ?? []).filter(row => state.filters.every(filter => filter(row)));
        const count = rows.length;
        if (state.order) rows = [...rows].sort((left, right) => String(left[state.order.key]).localeCompare(String(right[state.order.key])) * (state.order.ascending ? 1 : -1));
        rows = rows.slice(state.first, state.last + 1);
        return Promise.resolve({ data: state.head ? null : state.single ? rows[0] ?? null : rows, error: null, ...(state.count ? { count } : {}) }).then(resolve, reject);
      },
    };
    return result;
  }
  const database = {
    from(table) { const captured = { table }; effects.queries.push(captured); return query(table, undefined, captured); },
    rpc(name, args) {
      effects.queries.push({ rpc: name, args });
      const events = tables.marketing_event_log ?? [];
      let rows = [];
      if (name === 'get_top_events') {
        const counts = new Map(); for (const event of events) counts.set(event.event_name, (counts.get(event.event_name) ?? 0) + 1);
        rows = [...counts].sort((a, b) => b[1] - a[1]).slice(0, args.lim).map(([event_name, event_count]) => ({ event_name, event_count }));
      }
      return query(`rpc:${name}`, rows);
    },
  };
  const claim = { claimed: true, completed: false, id: 'fixture-claim', ...options.claim };
  const mocks = {
    'server-only': {}, 'twitter-api-v2': { TwitterApi: class {} },
    'next/server': { NextResponse: { json: (data, init = {}) => ({ data: clone(data), status: init.status ?? 200 }) } },
    '@anthropic-ai/sdk': class { constructor(config) {
      effects.aiOptions.push(clone(config));
      this.messages = { create: async input => { effects.aiRequests.push(clone(input)); throw new Error('Isolated AI timeout'); } };
    } },
    resend: { Resend: class {} },
    '@supabase/supabase-js': { createClient: (_, __, config) => {
      adminConfigurations.push(config); effects.adminClients.push({ auth: clone(config.auth), boundedFetch: typeof config.global?.fetch === 'function' }); return database;
    } },
    'src/lib/supabase/admin.ts': { createSupabaseAdminClient: () => database },
    'src/lib/supabase/server.ts': { createSupabaseServerClient: async () => database },
    'src/lib/server-env.ts': { getAppUrl: () => 'https://www.macro-bias.com', getRequiredServerEnv: () => 'fixture-key' },
    'src/lib/crypto-market-data/upsert-crypto-market-data.ts': { upsertCryptoMarketData: async () => {
      effects.syncs.push(true); clock += options.syncDelay ?? 0; if (options.syncError) throw new Error('Fixture sync failed'); return { tradeDate: tables.crypto_bias_scores?.[0]?.trade_date };
    } },
    'src/lib/crypto-briefing/crypto-brief-generator.ts': {
      generateCryptoDailyBriefing: async input => { effects.models.push(clone(input)); return { generatedBy: 'fixture', newsletterCopy: BODY, isOverrideActive: false, warnings: [] }; },
      persistCryptoBriefing: async (trade_date, score, bias_label, brief_content, is_override_active) => {
        if (options.persistMismatch) score -= 1;
        return database.from('crypto_daily_briefings').upsert({ trade_date, score, bias_label, brief_content, is_override_active }, { onConflict: 'trade_date', ignoreDuplicates: true });
      },
    },
    'src/lib/crypto-briefing/crypto-delivery.ts': {
      claimCryptoPublication: async (date, deadlineAt) => { effects.claims.push({ date, deadlineAt }); if (options.claimError) throw new Error('Fixture claim failed'); return claim; },
      finishCryptoPublication: async (value, status, metadata) => { effects.finishes.push({ status, metadata: clone(metadata) }); timeline.push(`finish:${status}`); clock += options.finishDelay ?? 0; },
      sendCryptoEmailOnce: async input => {
        effects.deliveries.push({ recipient: input.recipient, tradeDate: input.tradeDate, deadlineAt: input.deadlineAt, payload: clone(input.payload) });
        timeline.push('delivery'); clock += options.deliveryDelay ?? 0;
        if (options.deliveryError) throw new Error('Fixture provider failed');
        return { status: options.deliveryStatuses?.[effects.deliveries.length - 1] ?? options.deliveryStatus ?? 'accepted' };
      },
    },
    'src/lib/referral/premium-unlock.ts': { partitionUnlockedSubscribers: async (_, emails) => ({ unlockedEmails: [], regularFreeEmails: emails }) },
    'src/lib/referral/verify-referrals.ts': { verifyPendingReferrals: async () => {
      effects.referrals.push(true); timeline.push('referrals:start');
      if (options.referralError) throw new Error('Fixture referral failure');
      if (options.deferReferral) await new Promise(resolve => { releaseReferral = resolve; });
      timeline.push('referrals:end');
    } },
    'src/lib/social/bluesky.ts': { isBlueskyConfigured: () => false },
    'src/lib/social/telegram.ts': { isTelegramConfigured: () => false },
    'src/lib/social/threads.ts': { isThreadsConfigured: () => false },
    'src/lib/signal/format-tradable-signal.ts': { formatSignalSocialLine: () => '', extractTradableSignal: () => null },
    'src/lib/briefing/daily-brief-generator.ts': { generateDailyBriefing: async () => { effects.models.push(true); throw new Error('Unexpected stock model'); } },
    'src/lib/briefing/persist-daily-briefing.ts': { persistDailyBriefing: async () => { throw new Error('Unexpected stock write'); } },
    'src/lib/marketing/email-dispatch.ts': { dispatchQuantBriefing: async () => { effects.deliveries.push(true); } },
    'src/lib/market-data/upsert-daily-market-data.ts': { upsertDailyMarketData: async () => { effects.syncs.push(true); } },
    'src/lib/briefing/weekly-digest-data.ts': { getWeeklyDigestData: async () => null },
    'src/lib/paper-trading/get-paper-trading-dashboard-data.ts': { getPaperTradingDashboardData: async () => ({}) },
  };
  const cache = new Map();
  function load(relative, actual = false) {
    const file = relative.replaceAll('\\', '/');
    if (!actual && file in mocks) return mocks[file];
    if (cache.has(file)) return cache.get(file).exports;
    const filename = path.join(root, file);
    const source = options.sources?.[file] ?? fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} }; cache.set(file, module);
    const localRequire = name => {
      if (name in mocks) return mocks[name]; if (name.startsWith('node:')) return require(name);
      const next = name.startsWith('@/') ? 'src/' + name.slice(2)
        : name.startsWith('.') ? path.relative(root, path.resolve(path.dirname(filename), name)).replaceAll('\\', '/') : null;
      assert.ok(next, `Unexpected dependency ${name}`); return load(next.endsWith('.ts') ? next : next + '.ts');
    };
    vm.runInNewContext(`(function(exports,require,module){${compiled}\n})`, {
      Date: FixtureDate, Error, Intl, Buffer, URL, process: { env }, console: { log() {}, warn() {}, error() {} },
      AbortSignal: { timeout(value) { effects.timeouts.push(value); return AbortSignal.timeout(value); }, any: AbortSignal.any },
      fetch: async (input, init) => { effects.network.push({ signal: init.signal }); return { ok: true }; },
      setTimeout: fn => { fn(); return 0; }, clearTimeout() {},
    }, { filename })(module.exports, localRequire, module);
    return module.exports;
  }
  const request = (params = '', authorization = 'Bearer fixture-secret', extra = {}) => ({
    nextUrl: new URL(`https://fixture.invalid/api/cron/crypto-publish${params}`),
    headers: new Headers({ ...(authorization === null ? {} : { authorization }), ...extra }),
  });
  return { load, effects, tables, request, timeline, adminConfigurations,
    advance(value) { clock += value; }, now() { return clock; }, releaseReferral() { releaseReferral(); } };
}
let passed = 0;
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
(async () => {
  for (const now of ['2026-10-03T12:30:00Z', '2026-10-04T12:30:00Z', '2026-09-07T12:30:00Z']) {
    await check(`actual crypto publisher accepts fresh completed UTC candle on ${now.slice(0, 10)}`, async () => {
      const fixture = harness({ now }); const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request());
      assert.equal(response.status, 200); assert.equal(response.data.deliveryStatus, 'provider_accepted');
      assert.equal(fixture.effects.deliveries.length, 1); assert.equal(fixture.effects.models.length, 0);
      assert.equal(fixture.effects.writes.length, 0); assert.equal(fixture.effects.finishes[0].status, 'completed');
      const mail = fixture.effects.deliveries[0].payload;
      assert.ok(mail.subject.includes(`${response.data.candleDate} UTC`));
      assert.ok(mail.text.startsWith(`Based on the completed ${response.data.candleDate} UTC daily candle. Bitcoin trades every day.`));
      assert.ok(mail.html.includes(`completed ${response.data.candleDate} UTC daily candle`));
      assert.ok(mail.text.includes('Base Score: RISK ON (+10)')); assert.ok(mail.text.includes('REGIME STATUS'));
      assert.equal(/NO_TRADE|Permission:|Reliability [A-F]|Size \d+%/.test(mail.text), false);
      assert.ok(mail.headers['List-Unsubscribe']);
    });
  }
  await check('cron absent, invalid, empty and missing configured secrets cause no effects', async () => {
    for (const [env, authorization] of [[{}, null], [{}, ''], [{}, 'Bearer wrong'], [{}, 'Bearer fixture-secret-extra'], [{ CRON_SECRET: '', PUBLISH_CRON_SECRET: '' }, 'Bearer fixture-secret']]) {
      const fixture = harness({ env }); const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request('', authorization));
      assert.ok([401, 500].includes(response.status)); assert.ok(Object.values(fixture.effects).every(values => values.length === 0));
    }
    const fixture = harness(); assert.equal((await fixture.load('src/app/api/cron/crypto-publish/route.ts').POST(fixture.request('', null, { 'x-cron-secret': 'fixture-secret' }))).status, 200);
  });
  await check('completed and busy publication claims stop before data, model or mail effects', async () => {
    for (const claim of [{ claimed: false, completed: true }, { claimed: false, completed: false }]) {
      const fixture = harness({ claim }); const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request());
      assert.equal(response.status, claim.completed ? 200 : 202);
      assert.equal(fixture.effects.claims.length, 1);
      for (const [key, values] of Object.entries(fixture.effects)) if (key !== 'claims') assert.equal(values.length, 0);
    }
  });
  await check('stale, forming-only, invalid-score and missing completed-price states fail with no delivery', async () => {
    for (const change of [
      tables => { tables.crypto_bias_scores[0].trade_date = '2026-10-02'; },
      tables => { tables.crypto_bias_scores[0].trade_date = '2026-10-04'; },
      tables => { tables.crypto_bias_scores[0].bias_label = 'WRONG'; },
      tables => { tables.etf_daily_prices = [{ ticker: 'BTC-USD', trade_date: '2026-10-04' }]; },
    ]) {
      const tables = defaultTables(); change(tables); const fixture = harness({ tables });
      const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request());
      assert.equal(response.status, 500); assert.equal(fixture.effects.deliveries.length, 0);
      assert.equal(fixture.effects.models.length, 0); assert.equal(fixture.effects.writes.length, 0);
      assert.equal(fixture.effects.finishes[0].status, 'failed');
    }
  });
  await check('snapshot read fetches exactly the expected completed day while retaining full generator fields', async () => {
    const tables = defaultTables(); const expected = clone(tables.crypto_bias_scores[0]); tables.crypto_daily_briefings = [];
    expected.component_scores = [{ key: 'fixture-component', summary: 'Stored fixture context' }];
    expected.engine_inputs = { blendedForwardReturn: 0.25, modelVersion: 'stored-fixture-version' };
    tables.crypto_bias_scores = [{ ...expected, trade_date: '2026-10-04', score: 90 },
      ...Array.from({ length: 65 }, (_, index) => ({ ...expected, trade_date: new Date(Date.parse('2026-10-02T00:00:00Z') - index * 86_400_000).toISOString().slice(0, 10), score: -90 })), expected];
    const fixture = harness({ tables }); const original = clone(fixture.tables.crypto_bias_scores);
    const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request());
    assert.equal(response.status, 200); assert.equal(response.data.score, expected.score); assert.equal(response.data.tradeDate, expected.trade_date);
    const queries = fixture.effects.queries.filter(item => item.table === 'crypto_bias_scores'); assert.equal(queries.length, 1);
    assert.deepEqual(queries[0].equalities, [{ key: 'trade_date', value: '2026-10-03' }]); assert.equal(queries[0].limit, 1); assert.equal(queries[0].maybeSingle, true); assert.equal(queries[0].order, undefined);
    assert.equal(queries[0].columns, 'id, trade_date, score, bias_label, component_scores, ticker_changes, engine_inputs, technical_indicators, created_at, updated_at');
    assert.equal(fixture.effects.models.length, 1); assert.deepEqual(fixture.effects.models[0].componentScores, expected.component_scores);
    assert.deepEqual(fixture.effects.models[0].tickerChanges, expected.ticker_changes); assert.equal(fixture.effects.models[0].blendedForwardReturn, 0.25); assert.equal(fixture.effects.models[0].modelVersion, 'stored-fixture-version');
    assert.deepEqual(fixture.tables.crypto_bias_scores, original);
  });
  await check('snapshot errors report date and sanitized code or timeout category before body/model/mail effects', async () => {
    for (const [error, category] of [
      [{ code: '57014', message: 'Private SQL fixture prose' }, '57014'],
      [{ code: '', message: 'TimeoutError: operation was aborted due to timeout', hint: 'Private fixture details' }, 'request_timeout'],
      [{ code: '<private-code>', message: '<private database HTML>' }, 'unknown_database_error'],
    ]) {
      const fixture = harness({ queryError: { table: 'crypto_bias_scores', error } });
      const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request());
      assert.equal(response.status, 500); assert.equal(response.data.error, `Failed to read stored crypto score for 2026-10-03 (${category}).`);
      assert.equal(fixture.effects.models.length, 0); assert.equal(fixture.effects.writes.length, 0); assert.equal(fixture.effects.deliveries.length, 0); assert.equal(fixture.effects.finishes[0].status, 'failed');
    }
  });
  await check('sync failure can safely reuse a fresh stored score/body without generation or overwrite', async () => {
    const fixture = harness({ syncError: true }); const original = clone(fixture.tables.crypto_daily_briefings[0]);
    const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request());
    assert.equal(response.status, 200); assert.ok(response.data.warnings.some(value => value.startsWith('Market data sync failed:')));
    assert.equal(fixture.effects.models.length, 0); assert.equal(fixture.effects.writes.length, 0);
    assert.deepEqual(fixture.tables.crypto_daily_briefings[0], original);
  });
  await check('new briefing persists once, reads stored body, and mismatched persistence blocks delivery', async () => {
    for (const persistMismatch of [false, true]) {
      const tables = defaultTables(); tables.crypto_daily_briefings = []; const fixture = harness({ tables, persistMismatch });
      const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request());
      assert.equal(response.status, persistMismatch ? 500 : 200); assert.equal(fixture.effects.models.length, 1);
      assert.equal(fixture.effects.writes.length, 1); assert.equal(fixture.effects.writes[0].config.ignoreDuplicates, true);
      assert.equal(fixture.effects.deliveries.length, persistMismatch ? 0 : 1);
    }
  });
  await check('skipEmail marks published and allows later same-day delivery recovery', async () => {
    const fixture = harness(); const publisher = fixture.load('src/app/api/cron/crypto-publish/route.ts');
    const published = await publisher.GET(fixture.request('?skipEmail=true'));
    assert.equal(published.status, 200); assert.equal(fixture.effects.deliveries.length, 0); assert.equal(fixture.effects.finishes[0].status, 'published');
    const recovered = await publisher.GET(fixture.request()); assert.equal(recovered.status, 200);
    assert.equal(fixture.effects.deliveries.length, 1); assert.equal(fixture.effects.finishes[1].status, 'completed');
    assert.equal(fixture.effects.models.length, 0); assert.equal(fixture.effects.writes.length, 0);
  });
  await check('failed, uncertain, in-progress and thrown provider outcomes fail the publication claim', async () => {
    for (const config of [{ deliveryStatus: 'failed' }, { deliveryStatus: 'uncertain' }, { deliveryStatus: 'in_progress' }, { deliveryError: true }, { claimError: true }]) {
      const fixture = harness(config); const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request());
      assert.equal(response.status, 500);
      if (!config.claimError) assert.equal(fixture.effects.finishes[0].status, 'failed');
      else assert.equal(fixture.effects.deliveries.length, 0);
    }
  });
  await check('durably already accepted recipients complete without counting a new provider send', async () => {
    const fixture = harness({ deliveryStatus: 'already_accepted' });
    const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request());
    assert.equal(response.status, 200); assert.equal(response.data.alreadyAccepted, 1);
    assert.equal(response.data.freeEmailsSent, 0); assert.equal(response.data.emailSent, false);
    assert.equal(fixture.effects.finishes[0].status, 'completed');
  });
  await check('actual eligibility excludes stock-only/inactive/unsubscribed paid users and preserves readable tiers', async () => {
    const tables = defaultTables();
    tables.users = [ { email: 'paid@fixture-mail.net', subscription_status: 'active' },
      { email: 'trial@fixture-mail.net', subscription_status: 'trialing' }, { email: 'unsubscribed@fixture-mail.net', subscription_status: 'active' },
      { email: 'pastdue@fixture-mail.net', subscription_status: 'past_due' } ];
    tables.free_subscribers.push(
      { email: 'stock@fixture-mail.net', status: 'active', crypto_opted_in: false },
      { email: 'inactive@fixture-mail.net', status: 'inactive', crypto_opted_in: true },
      { email: 'unsubscribed@fixture-mail.net', status: 'inactive', crypto_opted_in: true },
      { email: 'paid@fixture-mail.net', status: 'active', crypto_opted_in: true });
    const fixture = harness({ tables }); const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request());
    assert.equal(response.status, 200);
    assert.deepEqual(fixture.effects.deliveries.map(item => item.recipient).sort(), ['crypto@fixture-mail.net', 'paid@fixture-mail.net', 'trial@fixture-mail.net']);
    const premium = fixture.effects.deliveries.find(item => item.recipient === 'paid@fixture-mail.net').payload;
    const free = fixture.effects.deliveries.find(item => item.recipient === 'crypto@fixture-mail.net').payload;
    for (const header of ['REGIME STATUS', 'MARKET MAP', 'RISK FRAME', 'MODEL CONTEXT']) assert.ok(premium.text.includes(header));
    assert.equal(free.text.includes('RISK FRAME'), false); assert.ok(premium.html.includes('RISK FRAME'));
    assert.equal(response.data.premiumEmailsSent, 2); assert.equal(response.data.freeEmailsSent, 1);
  });
  await check('shadow recipient configuration rejects authorized service before all effects', async () => {
    for (const params of ['', '?skipEmail=true']) {
      const fixture = harness({ env: { SHADOW_RUN_EMAIL: 'shadow@fixture-mail.net' } });
      const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request(params));
      assert.equal(response.status, 500); assert.match(response.data.error, /Shadow email routing/);
      assert.ok(Object.values(fixture.effects).every(values => values.length === 0));
    }
  });
  await check('absolute 270-second cutoff after data sync prevents subsequent data/model/mail effects', async () => {
    const fixture = harness({ syncDelay: 270_000 }); const startedAt = fixture.now();
    const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request());
    assert.equal(response.status, 500); assert.equal(fixture.effects.claims[0].deadlineAt, startedAt + 270_000);
    assert.equal(fixture.effects.syncs.length, 1); assert.equal(fixture.effects.queries.length, 0);
    assert.equal(fixture.effects.models.length, 0); assert.equal(fixture.effects.deliveries.length, 0); assert.equal(fixture.effects.finishes[0].status, 'failed');
  });
  await check('35 eligible unique recipients require 35 awaited accepted or existing receipts before completion', async () => {
    const tables = defaultTables();
    tables.users = Array.from({ length: 5 }, (_, index) => ({ email: `paid-${index}@fixture-mail.net`, subscription_status: 'active' }));
    tables.free_subscribers = Array.from({ length: 30 }, (_, index) => ({ email: `crypto-${index}@fixture-mail.net`, status: 'active', crypto_opted_in: true }));
    tables.free_subscribers.push({ ...tables.free_subscribers[0] }, { email: tables.users[0].email, status: 'active', crypto_opted_in: true },
      { email: 'stock-only@fixture-mail.net', status: 'active', crypto_opted_in: false });
    const fixture = harness({ tables, deliveryStatuses: Array(5).fill('already_accepted') }); const startedAt = fixture.now();
    const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request());
    assert.equal(response.status, 200); assert.equal(response.data.freeEmailsSent, 30); assert.equal(response.data.premiumEmailsSent, 0); assert.equal(response.data.alreadyAccepted, 5);
    assert.equal(fixture.effects.deliveries.length, 35); assert.equal(new Set(fixture.effects.deliveries.map(delivery => delivery.recipient)).size, 35);
    assert.ok(fixture.effects.deliveries.every(delivery => delivery.deadlineAt === startedAt + 270_000));
    assert.deepEqual(fixture.timeline.slice(-3), ['finish:completed', 'referrals:start', 'referrals:end']);
    assert.equal(fixture.timeline.filter(event => event === 'delivery').length, 35);
  });
  await check('cutoff preserves partial new and prior receipt counts and leaves publication resumable', async () => {
    const tables = defaultTables(); tables.free_subscribers = Array.from({ length: 3 }, (_, index) => ({ email: `partial-${index}@fixture-mail.net`, status: 'active', crypto_opted_in: true }));
    const fixture = harness({ tables, deliveryDelay: 135_000, deliveryStatuses: ['already_accepted', 'accepted'] });
    const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request());
    assert.equal(response.status, 500); assert.equal(response.data.deliveryStatus, 'failed'); assert.equal(response.data.freeEmailsSent, 1); assert.equal(response.data.alreadyAccepted, 1);
    assert.equal(fixture.effects.deliveries.length, 2); assert.equal(fixture.effects.finishes[0].status, 'failed'); assert.equal(fixture.effects.finishes[0].metadata.alreadyAccepted, 1);
    assert.equal(fixture.effects.referrals.length, 0);
  });
  await check('crypto-only admin fetch aborts in five seconds or remaining budget and rejects expired requests', async () => {
    const fixture = harness(); await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request());
    const config = fixture.adminConfigurations[0]; assert.deepEqual(clone(config.auth), { autoRefreshToken: false, persistSession: false });
    assert.ok(fixture.effects.adminClients.every(client => client.boundedFetch));
    await config.global.fetch('https://fixture.invalid/database', {}); assert.equal(fixture.effects.timeouts.at(-1), 5_000); assert.ok(fixture.effects.network[0].signal instanceof AbortSignal);
    fixture.advance(268_000); await config.global.fetch('https://fixture.invalid/database', {}); assert.equal(fixture.effects.timeouts.at(-1), 2_000);
    fixture.advance(2_000); await assert.rejects(() => config.global.fetch('https://fixture.invalid/database', {}), /runtime budget exhausted/); assert.equal(fixture.effects.network.length, 2);
  });
  await check('referral tail failure becomes warning after durable completion without a failed mail state', async () => {
    const fixture = harness({ referralError: true }); const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request());
    assert.equal(response.status, 200); assert.equal(response.data.deliveryStatus, 'provider_accepted'); assert.equal(fixture.effects.finishes.length, 1); assert.equal(fixture.effects.finishes[0].status, 'completed');
    assert.ok(response.data.warnings.some(warning => warning.startsWith('Referral verification did not complete')));
    assert.deepEqual(fixture.timeline.slice(-2), ['finish:completed', 'referrals:start']);
  });
  await check('exhausted ancillary budget defers referrals after completed receipt cleanup', async () => {
    const fixture = harness({ deliveryDelay: 275_000, finishDelay: 10_000 });
    const response = await fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request());
    assert.equal(response.status, 200); assert.equal(fixture.effects.finishes[0].status, 'completed'); assert.equal(fixture.effects.referrals.length, 0);
    assert.ok(response.data.warnings.some(warning => warning.startsWith('Referral verification deferred')));
  });
  await check('referral tail is awaited only after durable finish and receives its own bounded client', async () => {
    const fixture = harness({ deferReferral: true }); let settled = false;
    const pending = fixture.load('src/app/api/cron/crypto-publish/route.ts').GET(fixture.request()).then(value => { settled = true; return value; });
    for (let attempt = 0; fixture.effects.referrals.length === 0 && attempt < 100; attempt++) await Promise.resolve();
    assert.equal(fixture.effects.referrals.length, 1); assert.equal(settled, false); assert.equal(fixture.effects.finishes[0].status, 'completed');
    fixture.advance(284_000); await fixture.adminConfigurations.at(-1).global.fetch('https://fixture.invalid/referral', {}); assert.equal(fixture.effects.timeouts.at(-1), 1_000);
    fixture.releaseReferral(); assert.equal((await pending).status, 200); assert.equal(settled, true);
  });
  await check('actual generator persistence never overwrites an existing historical briefing', async () => {
    const fixture = harness(); const original = clone(fixture.tables.crypto_daily_briefings[0]);
    const generator = fixture.load('src/lib/crypto-briefing/crypto-brief-generator.ts', true);
    await generator.persistCryptoBriefing('2026-10-03', 20, 'NEUTRAL', 'replacement body', true);
    assert.deepEqual(fixture.tables.crypto_daily_briefings[0], original); assert.equal(fixture.effects.writes.length, 0);
  });
  await check('actual crypto model synthesis bounds SDK timeout/retries and preserves deterministic fallback', async () => {
    const fixture = harness(); const generator = fixture.load('src/lib/crypto-briefing/crypto-brief-generator.ts', true);
    const generated = await generator.generateCryptoDailyBriefing({ tradeDate: '2026-10-03', score: 10, label: 'RISK_ON',
      tickerChanges: { 'BTC-USD': { close: 100, percentChange: 1 } }, componentScores: [] });
    assert.equal(fixture.effects.aiOptions.length, 1);
    assert.equal(fixture.effects.aiOptions[0].timeout, 45_000); assert.equal(fixture.effects.aiOptions[0].maxRetries, 0);
    assert.equal(fixture.effects.aiRequests.length, 2); assert.equal(generated.generatedBy, 'fallback');
    for (const header of ['REGIME STATUS', 'MARKET MAP', 'RISK FRAME', 'MODEL CONTEXT']) assert.ok(generated.newsletterCopy.includes(header));
    assert.equal(/NO_TRADE|Permission:|Reliability [A-F]|Size \d+%/.test(generated.newsletterCopy), false);
    assert.equal(fixture.effects.deliveries.length, 0); assert.equal(fixture.effects.writes.length, 0);
  });
  await check('actual stock publisher retains weekend no-send behavior before all data effects', async () => {
    for (const now of ['2026-10-03T12:30:00Z', '2026-10-04T12:30:00Z']) {
      const fixture = harness({ now }); const response = await fixture.load('src/app/api/cron/publish/route.ts').GET(fixture.request());
      assert.equal(response.status, 200); assert.equal(response.data.skipped, true);
      assert.ok(Object.values(fixture.effects).every(values => values.length === 0));
    }
  });
  await check('scheduler changes only crypto to seven calendar days; stock remains weekdays', () => {
    const crons = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).crons;
    assert.equal(crons.find(item => item.path === '/api/cron/crypto-publish').schedule, '30 12 * * *');
    assert.equal(crons.find(item => item.path === '/api/cron/publish').schedule, '30 12 * * 1-5');
  });
  await check('actual analytics excludes durable backend receipts while preserving ordinary analytics state and top15', async () => {
    const ordinary = [];
    for (let index = 1; index <= 15; index++) for (let repeat = 0; repeat < index; repeat++) ordinary.push({
      event_name: `ordinary_${index}`, created_at: '2026-10-04T12:00:00Z', page_path: '/', metadata: {}, subscriber_email: null, utm_source: null,
    });
    const receipts = Array.from({ length: 400 }, (_, index) => ({ event_name: index % 2 ? 'crypto_publication' : 'crypto_email_delivery',
      created_at: '2026-10-04T12:00:00Z', page_path: '/api/cron/crypto-publish', metadata: { status: 'accepted' }, subscriber_email: null, utm_source: null }));
    const file = 'src/lib/analytics/dashboard-data.ts';
    const baseline = execFileSync('git', ['show', '65525a3f6732336f75bd6b3ea73ed24378eeb8d3:' + file], { cwd: root, encoding: 'utf8' });
    const before = harness({ tables: { marketing_event_log: ordinary }, sources: { [file]: baseline } });
    const after = harness({ tables: { marketing_event_log: [...receipts, ...ordinary] } });
    const expected = clone(await before.load(file).getAnalyticsDashboardData());
    const actual = clone(await after.load(file).getAnalyticsDashboardData());
    assert.deepEqual(actual, expected);
    assert.equal(actual.topEvents.length, 15); assert.equal(actual.eventStats.last24h, ordinary.length);
    assert.equal(after.effects.queries.find(item => item.rpc === 'get_top_events').args.lim, 17);
    assert.ok(actual.marketing.observedEventNames.every(name => !name.startsWith('crypto_')));
  });
  console.log(`${passed} crypto publisher/regression scenario groups passed. No live writes or delivery.`);
})().catch(error => { console.error(error); process.exit(1); });
