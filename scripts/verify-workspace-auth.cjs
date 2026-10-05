/** Exercise the actual workspace guards with isolated server-auth fixtures.
 * Run: node scripts/verify-workspace-auth.cjs
 * No credentials, database writes, emails, payments or external requests.
 * Browser and HTTP/RSC checks against the optimized server are separate QA.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const compiled = new Map();
let passed = 0;
function load(relative, mocks, globals = {}) {
  const filename = path.join(root, relative);
  if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText);
  const module = { exports: {} };
  vm.runInNewContext(`(function(exports, require, module) {${compiled.get(filename)}\n})`, { URL, console, ...globals }, { filename })(module.exports, (name) => {
    if (!(name in mocks)) throw new Error(`Unmocked dependency ${name} in ${relative}`);
    return mocks[name];
  }, module);
  return module.exports;
}
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
class Redirect extends Error { constructor(url) { super(url); this.url = url; } }
const navigation = { redirect: (url) => { throw new Redirect(url); } };
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const response = {
  json: (body, options = {}) => ({ body, status: options.status ?? 200, headers: options.headers ?? {} }),
  redirect: (url) => ({ redirected: url.toString(), status: 307 }),
  next: () => ({ passed: true, cookies: { set() {} } }),
};
const anonymous = { user: null, isPro: false, subscriptionStatus: null };
const free = { user: { id: 'verified-free-user', email: 'free@example.test' }, isPro: false, subscriptionStatus: 'inactive' };
const pro = { ...free, user: { id: 'verified-pro-user', email: 'pro@example.test' }, isPro: true };

function subscription(authResult, profileIsPro = false) {
  let authCalls = 0;
  let dataCalls = 0;
  const userQuery = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { subscription_status: 'inactive' }, error: null }; } };
  const profileQuery = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { is_pro: profileIsPro }, error: null }; } };
  const actual = load('src/lib/billing/subscription.ts', {
    react: { cache: fn => fn },
    'server-only': {},
    '../supabase/server': { createSupabaseServerClient: async () => ({ auth: { getUser: async () => { authCalls++; return authResult; } }, from() { dataCalls++; return userQuery; } }) },
    '../supabase/admin': { createSupabaseAdminClient: () => ({ from() { dataCalls++; return profileQuery; } }) },
  });
  return { actual, counts: () => ({ authCalls, dataCalls }) };
}
function workspaceGuard(status) {
  return load('src/lib/product/workspace-auth.ts', {
    'server-only': {}, 'next/navigation': navigation,
    '../billing/subscription': { getUserSubscriptionStatus: async () => status },
  });
}
function dashboard(asset, status) {
  let workspaceCalls = 0;
  let extraDataCalls = 0;
  const guard = workspaceGuard(status);
  const data = { active: { score: null }, tape: {} };
  const sentinel = new Error('Authenticated Pro branch reached');
  const mocks = {
    react: { Suspense: 'Suspense' },
    '@/components/ui/LoadingIndicator': { LoadingIndicator: 'LoadingIndicator' },
    '@/lib/product/supplemental-quotes': { getSupplementalQuotes: async () => { extraDataCalls++; return []; } },
    '@/lib/market-data/derive-historical-analogs': { deriveHistoricalAnalogs: () => null },
    '@/components/product/pro-context-observations': { buildProContextObservations: () => [] },
    'react/jsx-runtime': jsx,
    'next/cache': { unstable_noStore() {} },
    'next/headers': { headers: async () => ({ get: () => null }) },
    '@/components/product/FreeWorkspace': { FreeWorkspace: 'FreeWorkspace' },
    '@/components/product/MemberShell': { MemberShell: 'MemberShell' },
    '@/components/product/ProWorkspace': { ProWorkspace: 'ProWorkspace', ProBriefingActions: 'ProBriefingActions' },
    '@/components/product/pro-model-settings': {},
    '@/lib/product/workspace-auth': guard,
    '@/lib/product/workspace-data': { loadWorkspaceSnapshot: async () => null, loadWorkspaceData: async (market, viewer) => {
      workspaceCalls++;
      assert.equal(market, asset);
      assert.equal(viewer.user?.id, status.user?.id);
      if (viewer.isPro) throw sentinel;
      return data;
    } },
    '@/lib/product/paid-briefing-link': { loadPaidBriefingLink: async () => { extraDataCalls++; return null; } },
    '@/components/billing/ManagePlan': { ManagePlan: 'ManagePlan' },
    '../../components/billing/ManagePlan': { ManagePlan: 'ManagePlan' },
    '@/lib/billing/stripe-customer': { getStripeCustomerId: async () => { extraDataCalls++; return null; } },
    '../../lib/billing/stripe-customer': { getStripeCustomerId: async () => { extraDataCalls++; return null; } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => { extraDataCalls++; throw sentinel; } },
    '@/lib/signal/format-tradable-signal': { extractTradableSignal: () => null },
    '../../lib/server-env': { getAppUrl: () => 'http://localhost' },
    '../../types': { CORE_ASSET_TICKERS: [] },
  };
  const page = load(asset === 'crypto' ? 'src/app/crypto/dashboard/page.tsx' : 'src/app/dashboard/page.tsx', mocks, {
    fetch: async () => { extraDataCalls++; return { ok: false }; }, process: { env: {} },
  }).default;
  return { page, data, sentinel, counts: () => ({ workspaceCalls, extraDataCalls }) };
}
function request(pathname, search = '') {
  const nextUrl = new URL(`http://localhost${pathname}${search}`);
  nextUrl.clone = () => new URL(nextUrl);
  return { nextUrl, url: nextUrl.toString(), cookies: { getAll: () => [], set() {} } };
}
function middleware(user) {
  return load('src/middleware.ts', {
    'next/server': { NextResponse: response },
    './lib/supabase/middleware': { updateSession: async () => ({ user, response: { passed: true } }) },
    './lib/test-lab/constants': { isTestLabAllowedEmail: () => false },
  });
}
const sessions = load('src/lib/market-data/stock-session.ts', {});
function api(status) {
  let snapshotCalls = 0;
  const rows = ['2026-10-01', '2026-09-30'].map((date, index) => ({
    trade_date: date, score: index ? 4 : 5, bias_label: 'NEUTRAL', ticker_changes: {}, component_scores: [],
    engine_inputs: { tradableSignal: { position: 'FLAT' }, modelVersion: 'WORKSPACE_PRIVATE_FIXTURE' },
  }));
  const route = load('src/app/api/bias/latest/route.ts', {
    'next/server': { NextResponse: response },
    '../../../../lib/billing/subscription': { getUserSubscriptionStatus: async () => status },
    '../../../../lib/market-data/derive-historical-analogs': { deriveHistoricalAnalogs: () => ({ privateWorkspaceFixture: true }) },
    '../../../../lib/market-data/get-latest-bias-snapshot': { getRecentBiasSnapshots: async () => { snapshotCalls++; return rows; } },
    '../../../../lib/product/score-access': { selectVisibleRow: sessions.selectVisibleRow, stockSessionDate: () => '2026-10-02' },
    '../../../../lib/macro-bias/constants': { BIAS_PILLAR_WEIGHTS: {} },
    '../../../../types': { CORE_ASSET_TICKERS: [] },
  });
  return { route, snapshotCalls: () => snapshotCalls };
}

(async () => {
  for (const [label, result] of [
    ['empty credentials', { data: { user: null }, error: null }],
    ['invalid credentials', { data: { user: null }, error: { message: 'Invalid JWT' } }],
    ['expired credentials', { data: { user: null }, error: { message: 'JWT expired' } }],
    ['verification error with stale user', { data: { user: free.user }, error: { message: 'User verification failed' } }],
  ]) {
    await check(`server verifier rejects ${label} before account/entitlement queries`, async () => {
      const fixture = subscription(result);
      const status = await fixture.actual.getUserSubscriptionStatus();
      assert.equal(status.user, null);
      assert.equal(status.isPro, false);
      assert.deepEqual(fixture.counts(), { authCalls: 1, dataCalls: 0 });
    });
  }
  for (const asset of ['stocks', 'crypto']) {
    const route = asset === 'stocks' ? '/dashboard' : '/crypto/dashboard';
    for (const [label, status] of [['anonymous', anonymous], ['unsigned Pro flag', { ...anonymous, isPro: true }], ['empty user id', { ...free, user: { ...free.user, id: '' } }]]) {
      await check(`${asset} page rejects ${label} before loading/rendering workspace`, async () => {
        const fixture = dashboard(asset, status);
        await assert.rejects(fixture.page(), (error) => error instanceof Redirect && new URL(error.url, 'http://localhost').searchParams.get('redirectTo') === route);
        assert.deepEqual(fixture.counts(), { workspaceCalls: 0, extraDataCalls: 0 });
      });
    }
    await check(`${asset} verified Free page preserves member workspace`, async () => {
      const fixture = dashboard(asset, free);
      const element = await fixture.page();
      assert.equal(element.type, 'FreeWorkspace');
      assert.equal(element.props.data, fixture.data);
      assert.equal(element.props.userId, free.user.id);
      assert.equal(element.props.audience, 'member');
      assert.deepEqual(fixture.counts(), { workspaceCalls: 1, extraDataCalls: 0 });
    });
    await check(`${asset} verified Pro reaches its existing Pro branch`, async () => {
      const fixture = dashboard(asset, pro);
      await assert.rejects(fixture.page(), (error) => error === fixture.sentinel);
      assert.equal(fixture.counts().workspaceCalls, 1);
    });
  }
  await check('workspace data loader rejects unsigned calls before any query', async () => {
    let calls = 0;
    const count = () => { calls++; throw new Error('Workspace queried before auth'); };
    const loader = load('src/lib/product/workspace-data.ts', {
      'server-only': {},
      '../account/alert-preferences': { loadAlertPreferences: count },
      '../crypto-bias/constants': { CRYPTO_TRACKED_TICKERS: [] },
      '../macro-bias/constants': { TRACKED_TICKERS: [] },
      '../supabase/admin': { createSupabaseAdminClient: count },
      './public-daily-data': { loadPublicDailyData: count },
      './score-access': { getViewerScore: count },
      './workspace-snapshot': { readPaidWorkspaceSelection: count },
    });
    for (const asset of ['stocks', 'crypto']) {
      await assert.rejects(loader.loadWorkspaceData(asset, anonymous), /Sign in/);
      await assert.rejects(loader.loadWorkspaceData(asset, { ...anonymous, isPro: true }), /Sign in/);
    }
    assert.equal(calls, 0);
  });
  await check('middleware protects both workspace routes/descendants and exact query return path', async () => {
    for (const route of ['/dashboard', '/dashboard/', '/dashboard/nested', '/crypto/dashboard', '/crypto/dashboard/', '/crypto/dashboard/nested']) {
      const result = await middleware(null).middleware(request(route, '?selected=2026-09-17'));
      assert.equal(result.status, 307);
      assert.equal(new URL(result.redirected).searchParams.get('redirectTo'), `${route}?selected=2026-09-17`);
      assert.equal((await middleware(free.user).middleware(request(route))).passed, true);
    }
  });
  await check('middleware retains intentional public daily/history/briefing route access', async () => {
    for (const route of ['/', '/today', '/crypto', '/track-record', '/crypto/track-record', '/briefings/2026-09-17', '/crypto/briefings/2026-09-17']) {
      assert.equal((await middleware(null).middleware(request(route))).passed, true);
    }
  });
  await check('middleware rejects provider verification errors even with a stale user object', async () => {
    const helper = load('src/lib/supabase/middleware.ts', {
      '@supabase/ssr': { createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: free.user }, error: { message: 'JWT expired' } }) } }) },
      'next/server': { NextResponse: response },
    }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'http://fixture.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture' } } });
    assert.equal((await helper.updateSession(request('/crypto/dashboard'))).user, null);
  });
  for (const [label, status] of [['anonymous', anonymous], ['unsigned Pro flag', { ...anonymous, isPro: true }], ['empty user id', { ...free, user: { ...free.user, id: '' } }]]) {
    await check(`workspace API rejects ${label} without querying/exposing model context`, async () => {
      const fixture = api(status);
      const result = await fixture.route.GET();
      assert.equal(result.status, 401);
      assert.equal(result.headers['Cache-Control'], 'private, no-store');
      assert.equal(fixture.snapshotCalls(), 0);
      assert.equal(result.body.data, undefined);
      assert.equal(JSON.stringify(result.body).includes('WORKSPACE_PRIVATE_FIXTURE'), false);
    });
  }
  for (const [label, status, date] of [['Free', free, '2026-09-30'], ['Pro', pro, '2026-10-01']]) {
    await check(`workspace API preserves verified ${label} session/decision semantics`, async () => {
      const fixture = api(status);
      const result = await fixture.route.GET();
      assert.equal(result.status, 200);
      assert.equal(result.body.data.tradeDate, date);
      assert.equal(result.headers['Cache-Control'], 'private, no-store');
      assert.equal(fixture.snapshotCalls(), 1);
    });
  }
  await check('account alert action rejects failed server verification before saving/parsing', async () => {
    let saves = 0;
    const action = load('src/app/api/account/alerts/route.ts', {
      'next/server': { NextResponse: response },
      '@/lib/account/alert-preferences': { saveAlertPreferences: async () => { saves++; } },
      '@/lib/analytics/conversions': { recordSubscriberAcquisition: async () => { throw new Error('Recorded unauthorized acquisition'); } },
      '@/lib/supabase/server': { createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: free.user }, error: { message: 'Invalid JWT' } }) } }) },
    });
    const result = await action.POST({ json: () => { throw new Error('Parsed unauthorized request'); } });
    assert.equal(result.status, 401);
    assert.equal(saves, 0);
  });
  await check('analytics dashboard API rejects anonymous before reading admin data', async () => {
    let dataCalls = 0;
    const route = load('src/app/api/analytics/dashboard/route.ts', {
      'next/server': { NextResponse: response },
      '@/lib/analytics/admin-access': { getAnalyticsAdminUser: async () => null },
      '@/lib/analytics/acquisition-data': { getAcquisitionReport: async () => { dataCalls++; } },
      '@/lib/analytics/filters': { parseAcquisitionFilters: () => { throw new Error('Parsed unauthorized filters'); } },
    });
    assert.equal((await route.GET()).status, 403);
    assert.equal(dataCalls, 0);
  });
  await check('analytics verifier rejects stale admin identity with an auth error', async () => {
    let result;
    const admin = load('src/lib/analytics/admin-access.ts', {
      'server-only': {}, react: { cache: fn => fn },
      '@/lib/supabase/server': { createSupabaseServerClient: async () => ({ auth: { getUser: async () => result } }) },
    });
    const actual = load('src/lib/analytics/dashboard-data.ts', {
      'server-only': {},
      '@/lib/paper-trading/get-paper-trading-dashboard-data': {},
      '@/lib/supabase/admin': { createSupabaseAdminClient: () => { throw new Error('Read unauthorized admin data'); } },
      '@/lib/analytics/admin-access': admin,
    });
    result = { data: { user: { ...free.user, email: actual.ANALYTICS_ADMIN_EMAIL } }, error: { message: 'JWT expired' } };
    assert.equal(await actual.getAnalyticsAdminUser(), null);
  });
  console.log(`Workspace auth verification passed: ${passed} focused checks.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
