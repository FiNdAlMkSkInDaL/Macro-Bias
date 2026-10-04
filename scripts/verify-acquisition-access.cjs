/** Actual admin/filter/JSON/CSV/account/login source, isolated auth/database/UI.
 * No account, network, email, checkout or live-data operations.
 * Run: node scripts/verify-acquisition-access.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const NOW = Date.parse('2026-10-04T21:00:00Z');
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');

function user(email, extra = {}) {
  return { id: 'verified-auth-user-id', email, email_confirmed_at: '2026-10-03T12:00:00Z', created_at: '2026-01-01T12:00:00Z', user_metadata: {}, ...extra };
}

function consentedRequest(source = 'google', visitorId = '11111111-1111-4111-8111-111111111111') {
  const capturedAt = NOW - 60_000;
  const touch = { source, medium: source === 'google' ? 'organic' : 'social', campaign: 'launch', content: null,
    referrerDomain: source === 'google' ? 'google.com' : 'reddit.com', landingPath: '/crypto', capturedAt: new Date(capturedAt).toISOString() };
  const attribution = { version: 2, visitorId, sessionId: '22222222-2222-4222-8222-222222222222',
    firstTouch: touch, latestTouch: touch, expiresAt: new Date(capturedAt + 90 * 24 * 60 * 60_000).toISOString() };
  return { attribution, headers: new Headers({ host: 'www.macro-bias.com', 'user-agent': 'Mozilla/5.0 Chrome/131',
    cookie: `mb_analytics_consent=granted; mb_acquisition_v2=${encodeURIComponent(JSON.stringify(attribution))}` }) };
}

function harness(options = {}) {
  const effects = { authReads: 0, queryReads: [], reportCalls: 0, writes: [], fetches: [], signups: 0, statuses: [] };
  const cache = new Map();
  const tables = { marketing_event_log: clone(options.events ?? []), free_subscribers: clone(options.subscribers ?? []) };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } }
  function from(table) {
    const state = { filters: [], single: false, action: 'select', columns: null, config: {}, payload: null, limit: Infinity };
    const query = {
      select(columns) { state.columns = columns; return query; },
      in(key, values) { state.filters.push(row => values.includes(row[key])); effects.queryReads.push({ table, allowlist: values }); return query; },
      eq(key, value) { state.filters.push(row => row[key] === value); return query; },
      gte(key, value) { state.filters.push(row => row[key] >= value); return query; },
      gt(key, value) { state.filters.push(row => row[key] > value); return query; },
      lt(key, value) { state.filters.push(row => row[key] < value); return query; },
      order() { return query; }, limit(value) { state.limit = value; return query; }, abortSignal() { return query; },
      maybeSingle() { state.single = true; return query; },
      insert(payload) { state.action = 'insert'; state.payload = payload; return query; },
      upsert(payload, config) { state.action = 'upsert'; state.payload = payload; state.config = config; return query; },
      then(resolve, reject) {
        let selected = (tables[table] ?? []).filter(row => state.filters.every(filter => filter(row))).slice(0, state.limit);
        if (state.action !== 'select') {
          const items = tables[table] ??= [], key = state.config.onConflict ?? 'id';
          const existing = items.find(row => row[key] === state.payload[key]);
          selected = [];
          if (!existing || !state.config.ignoreDuplicates) {
            if (existing) Object.assign(existing, clone(state.payload));
            else items.push({ created_at: new Clock().toISOString(), ...clone(state.payload) });
            selected = [existing ?? items.at(-1)]; effects.writes.push({ table, ...clone(state.payload) });
          }
        } else effects.queryReads.push({ table, columns: state.columns });
        return Promise.resolve({ data: state.single ? clone(selected[0] ?? null) : clone(selected), error: null, count: selected.length }).then(resolve, reject);
      },
    };
    return query;
  }
  const supabase = { auth: { getUser: async () => {
    effects.authReads++;
    if (options.authThrows) throw new Error('SECRET_PROVIDER_CREDENTIAL_FAILURE');
    return { data: { user: options.user ?? null }, error: options.authError ?? null };
  } } };
  const admin = { from, auth: { admin: { listUsers: async () => {
    effects.queryReads.push({ table: 'auth.users', readOnly: true }); return { data: { users: clone(options.accounts ?? []) }, error: null };
  } } } };
  const browserAuth = { auth: {
    initialize: async () => {}, signUp: async () => { effects.signups++; return { data: options.signupResponse ?? { user: null, session: null }, error: null }; },
    getSession: async () => ({ data: { session: options.signupResponse?.session ?? null }, error: null }),
  } };
  let stateIndex = 0;
  const react = { cache: callback => callback, useEffect() {}, useState(initializer) {
    const index = stateIndex++;
    const initial = typeof initializer === 'function' ? initializer() : initializer;
    const value = index === 1 ? 'signup' : initial;
    return [value, next => effects.statuses.push({ index, value: typeof next === 'function' ? next(value) : next })];
  } };
  const jsx = (type, props) => ({ type, props });
  const navigation = { redirect(location) { const error = new Error('NEXT_REDIRECT'); error.location = location; throw error; } };
  function filePath(specifier, parent) {
    const base = specifier.startsWith('@/') ? path.join(root, 'src', specifier.slice(2)) : path.resolve(path.dirname(parent), specifier);
    return ['.ts', '.tsx', ''].map(suffix => base + suffix).find(file => fs.existsSync(file));
  }
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const context = vm.createContext({ module, exports: module.exports, Date: Clock, URL, URLSearchParams, Headers, Request, Response,
      setTimeout, clearTimeout, AbortSignal, console: { warn() {} },
      window: { location: { origin: 'https://www.macro-bias.com', assign() {} } },
      fetch: async (...args) => { effects.fetches.push(args); return Response.json({ ok: true }); },
      require(specifier) {
        if (specifier === 'server-only') return {};
        if (specifier === 'node:crypto') return require(specifier);
        if (specifier === 'react') return react;
        if (specifier === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
        if (specifier === './analytics-dashboard') return { __esModule: true, default: () => null };
        if (specifier.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
        if (specifier === 'next/navigation') return navigation;
        if (specifier === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
        if (specifier === '@/lib/supabase/server') return { createSupabaseServerClient: async () => supabase };
        if (specifier === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => admin };
        if (specifier === '@/lib/supabase/browser') return { createSupabaseBrowserClient: () => browserAuth, getSupabaseBrowserClientConfigError: () => null };
        if (specifier === '@/lib/analytics/client') return { getAcquisitionAttribution: () => null };
        if (specifier === '@/lib/analytics/dashboard-data') return {
          getAnalyticsAdminUser: load(path.join(root, 'src/lib/analytics/admin-access.ts')).getAnalyticsAdminUser,
          getAnalyticsDashboardData: async () => { effects.reportCalls++; throw new Error('Legacy page queried data'); },
        };
        if (specifier === '@/lib/analytics/acquisition-data') {
          const real = load(path.join(root, 'src/lib/analytics/acquisition-data.ts'));
          return { ...real, getAcquisitionReport: async filters => {
            effects.reportCalls++;
            if (options.reportThrows) throw new Error('SECRET_INTERNAL_DATABASE_CREDENTIAL_OR_EMAIL');
            return real.getAcquisitionReport(filters, admin, new Clock());
          } };
        }
        if (specifier.startsWith('@/components/') || specifier === 'next/link') return { __esModule: true, default: () => null,
          AcquisitionDashboard: () => null, AnalyticsDashboard: () => null };
        if (specifier.startsWith('@/') || specifier.startsWith('.')) {
          const resolved = filePath(specifier, file); if (!resolved) throw new Error(`Missing fixture module ${specifier}`); return load(resolved);
        }
        throw new Error(`Unapproved fixture import ${specifier}`);
      },
    });
    new vm.Script(compiled, { filename: file }).runInContext(context); return module.exports;
  }
  const json = load(path.join(root, 'src/app/api/analytics/dashboard/route.ts'));
  const csv = load(path.join(root, 'src/app/api/analytics/export/route.ts'));
  return { load, json, csv, effects, tables,
    request: (query = '') => new Request(`https://www.macro-bias.com/api/analytics/dashboard${query}`),
  };
}

function privateHeaders(response) {
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
}
let passed = 0;
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }

(async () => {
  await check('signed out, unconfirmed, Free/paid/manual Pro, lookalike emails denied before data access', async () => {
    const people = [null, user('finlayp32@gmail.com', { email_confirmed_at: null }), user('customer@gmail.com'),
      user('paid@gmail.com', { subscription_status: 'active' }), user('manual@gmail.com', { user_metadata: { is_pro: true, is_admin: true } }),
      user('finlayp32+admin@gmail.com'), user('finlayp32@gmail.com.evil.example'), user('FINLAYP32@GMAIL.COM.evil'), user('finphillips21@googlemail.com')];
    for (const person of people) {
      const h = harness({ user: person });
      for (const endpoint of [h.json, h.csv]) {
        const response = await endpoint.GET(h.request('?preset=30d'));
        assert.equal(response.status, 403); privateHeaders(response); assert.deepEqual(await response.json(), { error: 'Forbidden' });
      }
      assert.equal(h.effects.reportCalls, 0); assert.equal(h.effects.queryReads.length, 0); assert.equal(h.effects.writes.length, 0);
    }
  });
  await check('only the two exact confirmed admin addresses can read JSON and aggregate CSV', async () => {
    for (const email of ['finlayp32@gmail.com', 'finphillips21@gmail.com', ' FINLAYP32@GMAIL.COM ']) {
      const h = harness({ user: user(email) });
      const response = await h.json.GET(h.request('?preset=7d&touch=first'));
      assert.equal(response.status, 200); privateHeaders(response); const report = await response.json(); assert.equal(report.range.timezone, 'UTC');
      const download = await h.csv.GET(h.request('?preset=30d&view=sources')); assert.equal(download.status, 200); privateHeaders(download);
      assert.equal(download.headers.get('content-type'), 'text/csv; charset=utf-8'); assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
      assert.match(download.headers.get('content-disposition'), /^attachment; filename="macro-bias-sources-2026-09-05-2026-10-04\.csv"$/);
      assert.equal(h.effects.reportCalls, 2); assert.equal(h.effects.writes.length, 0);
    }
  });
  await check('returned authentication errors fail closed even if provider supplies an admin user', async () => {
    const h = harness({ user: user('finlayp32@gmail.com'), authError: { message: 'SECRET_PROVIDER_DETAIL' } });
    for (const endpoint of [h.json, h.csv]) { const response = await endpoint.GET(h.request()); assert.equal(response.status, 403); privateHeaders(response); }
    assert.equal(h.effects.reportCalls, 0); assert.equal(h.effects.queryReads.length, 0);
  });
  await check('malformed/custom/reversed/future/overlong dates and invalid dimensions return safe 400 before reads', async () => {
    const cases = ['?preset=custom&start=2026-02-30&end=2026-10-04', '?preset=custom&start=2026-10-04&end=2026-10-01',
      '?preset=custom&start=2026-10-01&end=2026-10-05', '?preset=custom&start=2025-01-01&end=2026-10-04', '?preset=custom&start=bad&end=2026-10-04',
      '?preset=365d', '?touch=arbitrary', '?campaign=private%40gmail.com', '?source=private%40gmail.com', '?campaign=bad%00label'];
    for (const query of cases) {
      const h = harness({ user: user('finlayp32@gmail.com') });
      for (const endpoint of [h.json, h.csv]) { const response = await endpoint.GET(h.request(query)); assert.equal(response.status, 400); privateHeaders(response); assert(!JSON.stringify(await response.json()).includes('private')); }
      assert.equal(h.effects.reportCalls, 0); assert.equal(h.effects.queryReads.length, 0);
    }
    const h = harness({ user: user('finlayp32@gmail.com') }); assert.equal((await h.csv.GET(h.request('?view=raw-events'))).status, 400); assert.equal(h.effects.reportCalls, 0);
  });
  await check('data outages return stable sanitized no-store errors without provider detail', async () => {
    const h = harness({ user: user('finlayp32@gmail.com'), reportThrows: true });
    for (const endpoint of [h.json, h.csv]) { const response = await endpoint.GET(h.request()); assert.equal(response.status, 503); privateHeaders(response); assert(!JSON.stringify(await response.json()).includes('SECRET')); }
  });
  await check('actual report reads allowlisted events only and serializes no raw identities or private payloads', async () => {
    const events = [
      { id: 'event-private-id', event_name: 'page_view', created_at: '2026-10-04T20:00:00Z', page_path: '/today?access_token=SECRET_URL_TOKEN',
        utm_campaign: 'private.customer@gmail.com', referrer: 'https://www.google.com/search?q=private.customer@gmail.com', subscriber_email: 'private.customer@gmail.com', metadata: { secret: 'SECRET_RAW_METADATA' } },
      { id: 'ledger-private-id', event_name: 'crypto_email_delivery', created_at: '2026-10-04T20:00:00Z', page_path: '/', metadata: { body: 'SECRET_DELIVERY_BODY', recipient: 'private.customer@gmail.com' } },
    ];
    const h = harness({ user: user('finlayp32@gmail.com'), events,
      subscribers: [{ email: 'private.customer@gmail.com', status: 'active', created_at: '2026-10-04T19:00:00Z', stocks_opted_in: true, crypto_opted_in: false }],
      accounts: [user('private.account@gmail.com', { id: 'private-auth-id', created_at: '2026-10-04T19:00:00Z' })] });
    const json = await (await h.json.GET(h.request())).text(), csv = await (await h.csv.GET(h.request())).text();
    for (const output of [json, csv]) for (const secret of ['private.customer@gmail.com', 'private.account@gmail.com', 'private-auth-id', 'event-private-id', 'ledger-private-id', 'SECRET_URL_TOKEN', 'SECRET_RAW_METADATA', 'SECRET_DELIVERY_BODY']) assert(!output.includes(secret), `Private value exposed: ${secret}`);
    const eventQueries = h.effects.queryReads.filter(item => item.table === 'marketing_event_log' && item.allowlist);
    assert(eventQueries.length); for (const query of eventQueries) assert.deepEqual(clone(query.allowlist), ['page_view', 'visitor_identified', 'email_subscribed', 'account_created', 'paid_conversion']);
    assert.equal(h.effects.writes.length, 0);
  });
  await check('CSV escapes spreadsheet formulas while retaining aggregate-only output', async () => {
    const h = harness({ user: user('finlayp32@gmail.com'), events: [{ id: 'formula', event_name: 'page_view', created_at: '2026-10-04T20:00:00Z', page_path: '/', utm_campaign: '=SUM(1+1)' }] });
    const response = await h.csv.GET(h.request('?view=campaigns'));
    assert.equal(response.status, 200); const csv = await response.text(); assert(csv.includes("'=SUM(1+1)")); assert(!csv.includes('subscriber_email'));
  });
  await check('page authorization occurs before any query for anonymous and ordinary users', async () => {
    for (const person of [null, user('ordinary@gmail.com')]) {
      const h = harness({ user: person }); const page = h.load(path.join(root, 'src/app/analytics/page.tsx')).default;
      if (!person) await assert.rejects(page({ searchParams: Promise.resolve({ preset: '30d' }) }), error => error.message === 'NEXT_REDIRECT');
      else assert((await page({ searchParams: Promise.resolve({ preset: '30d' }) })).props);
      assert.equal(h.effects.reportCalls, 0); assert.equal(h.effects.queryReads.length, 0);
    }
  });
  await check('page authentication outage renders a safe access state before report reads', async () => {
    const h = harness({ user: user('finlayp32@gmail.com'), authThrows: true });
    const page = h.load(path.join(root, 'src/app/analytics/page.tsx')).default;
    const output = await page({ searchParams: Promise.resolve({ preset: '30d' }) });
    assert(output.props); assert(!JSON.stringify(output).includes('SECRET'));
    assert.equal(h.effects.reportCalls, 0); assert.equal(h.effects.queryReads.length, 0);
  });
  await check('obfuscated duplicate signUp response with no session cannot report a new account', async () => {
    const h = harness({ signupResponse: { user: { id: 'obfuscated-fake-id', email: 'existing@gmail.com', created_at: new Date(NOW).toISOString(), identities: [] }, session: null } });
    const page = h.load(path.join(root, 'src/app/login/page.tsx')).default();
    const find = node => !node || typeof node !== 'object' ? null : node.type === 'form' ? node :
      Object.values(node.props ?? {}).flatMap(value => Array.isArray(value) ? value : [value]).map(find).find(Boolean);
    await find(page).props.onSubmit({ preventDefault() {} }); assert.equal(h.effects.signups, 1); assert.equal(h.effects.fetches.length, 0); assert.equal(h.effects.writes.length, 0);
  });
  await check('account API ignores forged signUp identity and uses actual stored old Auth creation date', async () => {
    const h = harness({ user: user('existing@gmail.com') }); const api = h.load(path.join(root, 'src/app/api/analytics/account/route.ts'));
    const response = await api.POST(new Request('https://www.macro-bias.com/api/analytics/account', { method: 'POST', headers: { origin: 'https://www.macro-bias.com' },
      body: JSON.stringify({ user: { id: 'obfuscated-fake-id', email: 'existing@gmail.com', created_at: '2026-10-04T20:59:00Z', email_confirmed_at: '2026-10-04T20:59:00Z' }, newAccount: true }) }));
    assert.equal(response.status, 200); assert.equal(h.effects.authReads, 1); assert.equal(h.effects.writes.length, 0);
  });
  await check('confirmed new account event binds actual Auth ID/date and retries preserve one immutable record', async () => {
    const person = user('new.customer@gmail.com', { created_at: '2026-10-04T20:30:00Z', email_confirmed_at: '2026-10-04T20:45:00Z' });
    const h = harness({ user: person }); const api = h.load(path.join(root, 'src/app/api/analytics/account/route.ts'));
    for (let repeat = 0; repeat < 2; repeat++) await api.POST(new Request('https://www.macro-bias.com/api/analytics/account', { method: 'POST' }));
    const records = h.tables.marketing_event_log.filter(row => row.event_name === 'account_created'); assert.equal(records.length, 1);
    assert.equal(records[0].created_at, person.created_at); assert.equal(records[0].metadata.entity_key, `account:${hash(person.id)}`);
    assert.equal(records[0].metadata.confirmation, 'verified_auth_user'); assert(!JSON.stringify(records[0]).includes(person.email));
  });
  await check('unconfirmed and recovery accounts never create conversion records', async () => {
    const h = harness(); const conversions = h.load(path.join(root, 'src/lib/analytics/conversions.ts'));
    await conversions.confirmAccountAcquisition({ user: user('new@gmail.com', { created_at: '2026-10-04T20:00:00Z', email_confirmed_at: null }), headers: new Headers() });
    await conversions.confirmAccountAcquisition({ user: user('new@gmail.com', { created_at: '2026-10-04T20:00:00Z' }), headers: new Headers(), flowType: 'recovery' });
    assert.equal(h.effects.writes.length, 0);
  });
  await check('zero opt-ins and returning preferences cannot emit a new newsletter conversion', async () => {
    const h = harness(), conversions = h.load(path.join(root, 'src/lib/analytics/conversions.ts'));
    const input = { email: 'stored.customer@gmail.com', createdAt: '2026-10-04T20:00:00Z', headers: new Headers(), pagePath: '/emails', stocksOptedIn: false, cryptoOptedIn: false };
    await conversions.recordSubscriberAcquisition({ ...input, newSubscriber: true });
    await conversions.recordSubscriberAcquisition({ ...input, newSubscriber: false, reactivated: true });
    await conversions.recordSubscriberAcquisition({ ...input, newSubscriber: false, stocksOptedIn: true });
    assert.equal(h.effects.writes.length, 0);
    await conversions.recordSubscriberAcquisition({ ...input, newSubscriber: true, cryptoOptedIn: true });
    await conversions.recordSubscriberAcquisition({ ...input, newSubscriber: true, cryptoOptedIn: true });
    const newsletter = h.tables.marketing_event_log.filter(row => row.event_name === 'email_subscribed'); assert.equal(newsletter.length, 1);
    assert.equal(newsletter[0].created_at, input.createdAt); assert.equal(newsletter[0].metadata.crypto_opted_in, true);
  });
  await check('public returning/reactivation requests cannot alter an existing subscriber identity; only a new eligible insert bridges', async () => {
    const email = 'actual.new.signup@gmail.com', createdAt = '2026-10-04T20:59:00Z';
    const original = consentedRequest(), different = consentedRequest('reddit', '33333333-3333-4333-8333-333333333333');
    const h = harness(), conversions = h.load(path.join(root, 'src/lib/analytics/conversions.ts'));
    const input = { email, createdAt, pagePath: '/crypto', stocksOptedIn: false, cryptoOptedIn: true };
    await conversions.recordSubscriberAcquisition({ ...input, newSubscriber: true, headers: original.headers });
    const bridge = clone(h.tables.marketing_event_log.find(row => row.event_name === 'acquisition_identity'));
    assert(bridge); assert.equal(bridge.anonymous_id, original.attribution.visitorId);
    assert.equal(bridge.metadata.attribution.firstTouch.source, 'google');
    assert.equal(h.tables.marketing_event_log.filter(row => row.event_name === 'email_subscribed').length, 1);
    const initialBridgeWrites = h.effects.writes.filter(row => row.event_name === 'acquisition_identity').length;
    for (const returning of [{}, { reactivated: true }]) {
      await conversions.recordSubscriberAcquisition({ ...input, ...returning, newSubscriber: false, headers: different.headers });
      assert.equal(h.effects.writes.filter(row => row.event_name === 'acquisition_identity').length, initialBridgeWrites);
      assert.deepEqual(h.tables.marketing_event_log.find(row => row.id === bridge.id), bridge);
    }
    await conversions.recordSubscriberAcquisition({ ...input, email: 'no.optins@gmail.com', newSubscriber: true,
      stocksOptedIn: false, cryptoOptedIn: false, headers: different.headers });
    assert.equal(h.effects.writes.filter(row => row.event_name === 'acquisition_identity').length, initialBridgeWrites);
    assert.equal(h.tables.marketing_event_log.filter(row => row.event_name === 'email_subscribed').length, 1);
  });
  await check('confirmed stored Auth ownership can still bind subscriber identity for an existing account without inventing signup', async () => {
    const h = harness(), conversions = h.load(path.join(root, 'src/lib/analytics/conversions.ts'));
    const person = user('owned.existing.account@gmail.com'), consent = consentedRequest();
    await conversions.confirmAccountAcquisition({ user: person, headers: consent.headers });
    const bridges = h.tables.marketing_event_log.filter(row => row.event_name === 'acquisition_identity');
    assert.equal(bridges.length, 2);
    const subscriber = bridges.find(row => row.metadata.entity_key === `subscriber:${hash(person.email)}`);
    assert(subscriber); assert.equal(subscriber.anonymous_id, consent.attribution.visitorId);
    assert.equal(subscriber.metadata.attribution.firstTouch.source, 'google');
    assert.equal(h.tables.marketing_event_log.filter(row => row.event_name === 'account_created').length, 0);
  });
  await check('active zero-opt-in rows with no confirmed initial opt-in remain excluded', async () => {
    const email = 'no.newsletter@gmail.com', createdAt = '2026-10-04T20:00:00Z';
    for (const preferences of [{}, { stocks_opted_in: false, crypto_opted_in: false }]) {
      const h = harness({ user: user('finlayp32@gmail.com'),
        subscribers: [{ email, status: 'active', created_at: createdAt, stocks_opted_in: false, crypto_opted_in: false }],
        events: [{ id: 'forged-conversion-id', event_name: 'email_subscribed', created_at: createdAt, page_path: '/emails', metadata: {
          event_version: 2, confirmed: true, traffic_type: 'human', conversion_kind: 'new_subscriber', confirmation: 'subscriber_record_saved', entity_key: `subscriber:${hash(email)}`, ...preferences,
        } }] });
      const report = await (await h.json.GET(h.request())).json(); assert.equal(report.overview.newSubscribers, 0);
      assert.equal(report.coverage.excludedReferralOnlyRows, 1);
    }
  });
  await check('actual immutable initial newsletter signup stays counted after later preferences or unsubscribe', async () => {
    const email = 'real.initial.signup@gmail.com', createdAt = '2026-10-04T20:00:00Z';
    for (const status of ['active', 'inactive']) {
      const h = harness({ user: user('finlayp32@gmail.com'),
        subscribers: [{ email, status, created_at: createdAt, stocks_opted_in: false, crypto_opted_in: false }] });
      const conversions = h.load(path.join(root, 'src/lib/analytics/conversions.ts'));
      await conversions.recordSubscriberAcquisition({ email, createdAt, newSubscriber: true, headers: new Headers(), pagePath: '/crypto', stocksOptedIn: false, cryptoOptedIn: true });
      const report = await (await h.json.GET(h.request())).json(); assert.equal(report.overview.newSubscribers, 1);
      assert.equal(report.coverage.excludedReferralOnlyRows, 0);
      const stored = h.tables.marketing_event_log.filter(row => row.event_name === 'email_subscribed'); assert.equal(stored.length, 1);
      assert.equal(stored[0].metadata.crypto_opted_in, true); assert.equal(stored[0].created_at, createdAt);
    }
  });
  await check('test, trial, zero-cash, out-of-band and renewal invoices never count as new paid upgrades', async () => {
    const first = { id: 'in_first', created: Math.floor(NOW / 1000), livemode: true, status: 'paid', amount_paid: 2500, currency: 'usd', status_transitions: { paid_at: Math.floor(NOW / 1000) } };
    for (const changed of [{ livemode: false }, { status: 'open' }, { amount_paid: 0 }, { paid_out_of_band: true }, { status_transitions: { paid_at: null } }]) {
      const h = harness(), conversions = h.load(path.join(root, 'src/lib/analytics/conversions.ts')); let reads = 0;
      await conversions.recordPaidAcquisition({ stripe: { invoices: { list: async () => { reads++; return { data: [], has_more: false }; } } },
        invoice: { ...first, ...changed }, userId: 'actual-auth-id', customerId: 'cus_actual', attribution: null });
      assert.equal(h.effects.writes.length, 0); assert.equal(reads, 0);
    }
    const h = harness(), conversions = h.load(path.join(root, 'src/lib/analytics/conversions.ts'));
    await conversions.recordPaidAcquisition({ stripe: { invoices: { list: async () => ({ data: [{ ...first, id: 'in_older', created: first.created - 5000, status_transitions: { paid_at: first.created - 5000 } }], has_more: false }) } },
      invoice: first, userId: 'actual-auth-id', customerId: 'cus_actual', attribution: null });
    assert.equal(h.effects.writes.length, 0);
  });
  await check('first actual paid upgrade creates one immutable per-user receipt across invoice retries', async () => {
    const h = harness(), conversions = h.load(path.join(root, 'src/lib/analytics/conversions.ts'));
    const invoice = { id: 'in_first', created: Math.floor(NOW / 1000), livemode: true, status: 'paid', amount_paid: 2500, currency: 'usd', status_transitions: { paid_at: Math.floor(NOW / 1000) } };
    const stripe = { invoices: { list: async () => ({ data: [invoice], has_more: false }) } };
    await conversions.recordPaidAcquisition({ stripe, invoice, userId: 'actual-auth-id', customerId: 'cus_actual', attribution: null });
    await conversions.recordPaidAcquisition({ stripe, invoice: { ...invoice, amount_paid: 9900 }, userId: 'actual-auth-id', customerId: 'cus_actual', attribution: null });
    const paid = h.tables.marketing_event_log.filter(row => row.event_name === 'paid_conversion'); assert.equal(paid.length, 1);
    assert.equal(paid[0].metadata.amount_minor, 2500); assert.equal(paid[0].metadata.entity_key, `paid:${hash('actual-auth-id')}`);
    assert.equal(paid[0].metadata.confirmation, 'stripe_invoice_paid'); assert.equal(paid[0].metadata.first_paid_verified, true);
  });
  await check('Stripe history requests have bounded timeout, no retries and fail closed on uncertainty', async () => {
    const h = harness(), conversions = h.load(path.join(root, 'src/lib/analytics/conversions.ts'));
    const invoice = { id: 'in_first', created: Math.floor(NOW / 1000), livemode: true, status: 'paid', amount_paid: 2500, currency: 'usd', status_transitions: { paid_at: Math.floor(NOW / 1000) } };
    let reads = 0;
    const stripe = { invoices: { list: async (_params, options) => {
      reads++; assert(options.timeout >= 1 && options.timeout <= 5000); assert.equal(options.maxNetworkRetries, 0);
      throw new Error('SECRET_PROVIDER_HISTORY_FAILURE');
    } } };
    await assert.rejects(conversions.isFirstPaidInvoice(stripe, invoice, 'cus_actual'), error => /temporarily unavailable/.test(error.message) && !error.message.includes('SECRET'));
    assert.equal(reads, 1); assert.equal(h.effects.writes.length, 0);
    await assert.rejects(conversions.isFirstPaidInvoice(stripe, invoice, 'cus_actual', { deadlineAt: NOW - 1 }), /temporarily unavailable/);
    assert.equal(reads, 1);
  });
  await check('thrown authentication provider outage fails closed with sanitized response', async () => {
    const h = harness({ user: user('finlayp32@gmail.com'), authThrows: true });
    for (const endpoint of [h.json, h.csv]) { const response = await endpoint.GET(h.request()); assert([403, 503].includes(response.status)); privateHeaders(response); assert(!JSON.stringify(await response.json()).includes('SECRET')); }
    assert.equal(h.effects.reportCalls, 0); assert.equal(h.effects.queryReads.length, 0);
  });
  console.log(`Acquisition access: ${passed} scenario groups passed; no live account, network or email operations.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
