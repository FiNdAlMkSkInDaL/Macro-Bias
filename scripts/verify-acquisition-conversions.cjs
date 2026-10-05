/** Executes the actual server conversion/auth/subscription/checkout modules with
 * in-memory database/provider fixtures. No credentials, accounts or emails.
 * Run: node scripts/verify-acquisition-conversions.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const NOW = Date.parse('2026-10-04T21:00:00Z');
const clone = value => JSON.parse(JSON.stringify(value));

function harness(options = {}) {
  const tables = clone(options.tables ?? {});
  const effects = { writes: [], welcomeEnrollments: 0, welcomeDispatches: 0, checkout: [], adminOptions: [], dbCalls: [], invoiceRequests: [], transports: [] };
  const modules = new Map();
  let clock = NOW;
  const advanceClock = milliseconds => { clock += milliseconds; };
  class FixtureDate extends Date {
    constructor(...args) { args.length ? super(...args) : super(clock); }
    static now() { return clock; }
  }
  function from(table, clientOptions = {}) {
    const state = { action: 'select', filters: [], columns: null, single: false, payload: null, config: {} };
    let result;
    const query = {
      select(columns) { state.columns = columns; return query; },
      eq(key, value) { state.filters.push(row => row[key] === value); return query; },
      is(key, value) { state.filters.push(row => (row[key] ?? null) === value); return query; },
      in(key, values) { state.filters.push(row => values.includes(row[key])); return query; },
      limit() { return query; },
      maybeSingle() { state.single = true; return query; },
      update(payload) { state.action = 'update'; state.payload = payload; return query; },
      insert(payload) { state.action = 'insert'; state.payload = payload; return query; },
      upsert(payload, config) { state.action = 'upsert'; state.payload = payload; state.config = config; return query; },
      then(resolve, reject) {
        if (!result) {
          effects.dbCalls.push({ table, action: state.action, timeoutMs: clientOptions.timeoutMs });
          options.onDbCall?.({ table, action: state.action, clientOptions, advanceClock, effects });
          const rows = tables[table] ??= [];
          let selected;
          if (state.action === 'select') selected = rows.filter(row => state.filters.every(filter => filter(row)));
          else if (state.action === 'update') {
            selected = rows.filter(row => state.filters.every(filter => filter(row)));
            selected.forEach(row => Object.assign(row, clone(state.payload)));
            effects.writes.push({ table, action: state.action });
          } else {
            selected = [];
            for (const payload of Array.isArray(state.payload) ? state.payload : [state.payload]) {
              const key = state.config.onConflict ?? (table === 'free_subscribers' ? 'email' : 'id');
              const existing = rows.find(row => row[key] === payload[key]);
              if (existing && state.config.ignoreDuplicates) continue;
              if (existing) { Object.assign(existing, clone(payload)); selected.push(existing); }
              else {
                const row = { created_at: new FixtureDate().toISOString(), ...clone(payload) };
                rows.push(row); selected.push(row);
              }
              effects.writes.push({ table, action: state.action });
            }
          }
          result = { error: null, data: state.single ? clone(selected[0] ?? null) : clone(selected) };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return query;
  }
  const admin = { from, auth: { admin: { getUserById: async () => ({ data: { user: options.user ?? user() }, error: null }) } } };
  const auth = { auth: { getUser: async () => ({ data: { user: options.user ?? null }, error: options.authError ?? null }) }, from };
  const stripe = {
    checkout: { sessions: { create: async payload => { effects.checkout.push(clone(payload)); return { url: 'https://checkout.stripe.com/fixture' }; } } },
    invoices: { list: async (payload, requestOptions) => {
      effects.invoiceRequests.push({ payload: clone(payload), options: clone(requestOptions ?? {}) });
      return options.invoices?.(payload, requestOptions, { advanceClock, effects }) ?? { data: [], has_more: false };
    } },
    subscriptions: { retrieve: async () => ({ id: 'sub_fixture', status: 'active', metadata: options.subscriptionMetadata ?? { supabaseUUID: user().id }, customer: 'cus_fixture' }) },
    customers: { retrieve: async () => ({ id: 'cus_fixture', email: user().email }) },
    webhooks: { constructEvent: (payload, signature) => {
      if (signature !== 'fixture-verified-signature') throw new Error('Invalid fixture signature');
      return JSON.parse(payload);
    } },
  };
  const stubs = {
    'server-only': {},
    ...(!options.actualAdminFactory ? { '@/lib/supabase/admin': { createSupabaseAdminClient: (clientOptions = {}) => {
      effects.adminOptions.push(clone(clientOptions));
      return { ...admin, from: table => from(table, clientOptions) };
    } } } : {}),
    '@/lib/supabase/server': { createSupabaseServerClient: async () => auth },
    '@/lib/marketing/welcome-drip': {
      enrollSubscriberInWelcomeDrip: async () => { effects.welcomeEnrollments++; },
      dispatchPendingWelcomeDripEmails: async () => { effects.welcomeDispatches++; },
    },
    '@/lib/referral/generate-referral-code': { generateReferralCode: () => 'fixture-referral' },
    '@/lib/billing/subscription': { getUserSubscriptionStatus: async () => ({ subscriptionStatus: options.subscriptionStatus ?? 'inactive' }), isSubscriptionActive: value => ['active', 'trialing'].includes(value) },
    '@/lib/stripe': { getStripeClient: () => stripe, getStripePriceId: plan => `fixture-price-${plan}`, getStripeWebhookSecret: () => 'fixture-webhook-secret' },
    '@/lib/server-env': { getAppUrl: () => 'https://www.macro-bias.com', getRequiredServerEnv: key => key === 'NEXT_PUBLIC_SUPABASE_URL' ? 'https://fixture-project.supabase.co' : 'fixture-service-role-key' },
  };
  const fetchFixture = async (input, init) => {
    effects.transports.push({ path: new URL(String(input)).pathname, method: init?.method, signal: init?.signal });
    return options.fetchTransport?.(input, init, effects) ?? Response.json([]);
  };
  function load(relative) {
    const absolute = path.resolve(root, relative);
    if (modules.has(absolute)) return modules.get(absolute);
    const exports = {};
    modules.set(absolute, exports);
    const requireFixture = name => {
      const full = name.startsWith('.') ? path.resolve(path.dirname(absolute), name) : name.startsWith('@/') ? path.resolve(root, 'src', name.slice(2)) : null;
      const alias = full ? `@/${path.relative(path.resolve(root, 'src'), full).replaceAll('\\', '/')}` : name;
      if (stubs[alias]) return stubs[alias];
      if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init), redirect: (url, init = {}) => new Response(null, { status: init.status ?? 307, headers: { location: String(url) } }) } };
      if (full) return load(`${path.relative(root, full)}${path.extname(full) ? '' : '.ts'}`);
      return require(name);
    };
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date: FixtureDate, Error, DOMException, Headers, Request, Response, URL, URLSearchParams, AbortSignal, fetch: fetchFixture, console, process, setTimeout, clearTimeout }, { filename: absolute })(requireFixture, { exports }, exports);
    return exports;
  }
  return { load, tables, effects, stripe, advanceClock };
}

function attribution(source = 'reddit', latest = source) {
  return {
    version: 2, visitorId: 'c0b87a50-c1e7-42fb-a937-c0324dc5f2dc', sessionId: 'ba510e89-c9f3-4bbe-985b-f02f7c32a3d8',
    firstTouch: { source, medium: 'social', campaign: 'weekend_launch', content: 'a', referrerDomain: 'reddit.com', landingPath: '/crypto', capturedAt: '2026-10-04T19:59:00.000Z' },
    latestTouch: { source: latest, medium: 'social', campaign: 'weekend_launch', content: 'b', referrerDomain: 'reddit.com', landingPath: '/pricing', capturedAt: '2026-10-04T20:00:00.000Z' },
    expiresAt: '2027-01-01T19:59:00.000Z',
  };
}
function headers(attr = attribution(), consent = 'granted', extra = {}) {
  return new Headers({ host: 'www.macro-bias.com', 'user-agent': 'Mozilla/5.0', cookie: `mb_analytics_consent=${consent}; mb_acquisition_v2=${encodeURIComponent(JSON.stringify(attr))}`, ...extra });
}
function subscriberInput(extra = {}) {
  return { email: 'fixture@fixture-mail.net', createdAt: '2026-10-04T20:01:00.000Z', newSubscriber: true, headers: headers(), pagePath: '/crypto', stocksOptedIn: false, cryptoOptedIn: true, ...extra };
}
function user(extra = {}) {
  return { id: 'ca3c2f72-57aa-42a5-a516-8737b885d2f6', email: 'fixture@fixture-mail.net', created_at: '2026-10-04T20:01:00.000Z', email_confirmed_at: '2026-10-04T20:02:00.000Z', user_metadata: { acquisition_v2: attribution() }, ...extra };
}
function invoice(extra = {}) {
  return { id: 'in_current', livemode: true, status: 'paid', amount_paid: 2500, currency: 'usd', created: 1791144300, status_transitions: { paid_at: 1791144400 }, ...extra };
}
const checks = [];
async function check(name, test) { await test(); checks.push(name); }

(async () => {
  await check('subscriber conversion is immutable and identity is opaque', async () => {
    const h = harness(); const c = h.load('src/lib/analytics/conversions.ts');
    await c.recordSubscriberAcquisition(subscriberInput());
    await c.recordSubscriberAcquisition(subscriberInput({ headers: headers(attribution('linkedin')) }));
    const events = h.tables.marketing_event_log.filter(row => row.event_name === 'email_subscribed');
    assert.equal(events.length, 1); assert.equal(events[0].created_at, '2026-10-04T20:01:00.000Z');
    assert.equal(events[0].metadata.attribution.firstTouch.source, 'reddit');
    assert.equal(events[0].subscriber_email, null); assert.ok(!JSON.stringify(events[0]).includes('fixture@'));
    assert.match(events[0].metadata.entity_key, /^subscriber:[a-f0-9]{64}$/);
  });
  await check('returning signup and reactivation are not new subscriptions', async () => {
    const h = harness(); const c = h.load('src/lib/analytics/conversions.ts');
    await c.recordSubscriberAcquisition(subscriberInput({ newSubscriber: false }));
    await c.recordSubscriberAcquisition(subscriberInput({ newSubscriber: false, reactivated: true }));
    await c.recordSubscriberAcquisition(subscriberInput({ newSubscriber: false, reactivated: true }));
    assert.equal(h.tables.marketing_event_log.filter(row => row.event_name === 'email_subscribed').length, 0);
    assert.equal(h.tables.marketing_event_log.filter(row => row.event_name === 'subscriber_reactivated').length, 1);
  });
  await check('declined consent and DNT/GPC remain Unknown without identity linkage', async () => {
    for (const requestHeaders of [headers(attribution(), 'denied'), headers(attribution(), 'granted', { dnt: '1' }), headers(attribution(), 'granted', { 'sec-gpc': '1' })]) {
      const h = harness(); const c = h.load('src/lib/analytics/conversions.ts');
      await c.recordSubscriberAcquisition(subscriberInput({ headers: requestHeaders }));
      assert.equal(h.tables.marketing_event_log.length, 1);
      const event = h.tables.marketing_event_log[0];
      assert.equal(event.metadata.attribution, null); assert.equal(event.anonymous_id, null); assert.equal(event.session_id, null);
    }
  });
  await check('known bot/test request is marked and never linked', async () => {
    const h = harness(); const c = h.load('src/lib/analytics/conversions.ts');
    await c.recordSubscriberAcquisition(subscriberInput({ headers: headers(attribution(), 'granted', { 'user-agent': 'curl/8.1' }) }));
    assert.equal(h.tables.marketing_event_log.length, 1);
    assert.equal(h.tables.marketing_event_log[0].metadata.traffic_type, 'test');
    assert.equal(h.tables.marketing_event_log[0].metadata.attribution, null);
  });
  await check('actual subscription API atomically counts one concurrent new subscriber', async () => {
    const h = harness(); const route = h.load('src/app/api/subscribe/route.ts');
    const requests = Array.from({ length: 2 }, () => new Request('https://www.macro-bias.com/api/subscribe', { method: 'POST', headers: headers(), body: JSON.stringify({ email: 'fixture@fixture-mail.net', pagePath: '/crypto', stocksOptedIn: false, cryptoOptedIn: true }) }));
    const results = await Promise.all(requests.map(request => route.POST(request)));
    assert.ok(results.every(response => response.status === 200));
    assert.equal(h.tables.free_subscribers.length, 1);
    assert.equal(h.tables.marketing_event_log.filter(row => row.event_name === 'email_subscribed').length, 1);
    assert.equal(h.effects.welcomeEnrollments, 2); assert.equal(h.effects.welcomeDispatches, 2);
    assert.equal(h.tables.free_subscribers[0].crypto_opted_in, true);
  });
  await check('actual subscription API preserves old subscriber creation timestamp', async () => {
    const h = harness({ tables: { free_subscribers: [{ email: 'fixture@fixture-mail.net', created_at: '2026-01-01T00:00:00Z', status: 'inactive' }] } });
    const route = h.load('src/app/api/subscribe/route.ts');
    const response = await route.POST(new Request('https://www.macro-bias.com/api/subscribe', { method: 'POST', headers: headers(), body: JSON.stringify({ email: 'fixture@fixture-mail.net' }) }));
    assert.equal(response.status, 200); assert.equal(h.tables.free_subscribers[0].created_at, '2026-01-01T00:00:00Z');
    assert.equal(h.tables.free_subscribers[0].status, 'active');
    assert.equal(h.tables.marketing_event_log.filter(row => row.event_name === 'email_subscribed').length, 0);
    assert.equal(h.tables.marketing_event_log.filter(row => row.event_name === 'subscriber_reactivated').length, 1);
  });
  await check('account alerts confirm actual insertion without duplicate subscriptions or unwanted welcome mail', async () => {
    const h = harness({ user: user() }); const route = h.load('src/app/api/account/alerts/route.ts');
    const request = () => new Request('https://www.macro-bias.com/api/account/alerts', { method: 'POST', headers: headers(), body: JSON.stringify({ stocksOptedIn: true, cryptoOptedIn: true }) });
    const responses = await Promise.all([route.POST(request()), route.POST(request())]);
    assert.ok(responses.every(response => response.status === 200));
    assert.equal(h.tables.free_subscribers.length, 1);
    assert.equal(h.tables.marketing_event_log.filter(row => row.event_name === 'email_subscribed').length, 1);
    assert.equal(h.tables.marketing_event_log.find(row => row.event_name === 'email_subscribed').metadata.content_group, 'both');
    assert.equal(h.effects.welcomeEnrollments, 0); assert.equal(h.effects.welcomeDispatches, 0);
  });
  await check('turning all account alerts off cancels scheduled mail and emits no acquisition', async () => {
    const h = harness({ user: user(), tables: {
      free_subscribers: [{ email: user().email, status: 'active', stocks_opted_in: true, crypto_opted_in: true, created_at: '2026-01-01T00:00:00Z' }],
      welcome_email_drip_enrollments: [{ email: user().email, status: 'active' }],
      welcome_email_drip_deliveries: [{ email: user().email, status: 'scheduled' }],
    } });
    const route = h.load('src/app/api/account/alerts/route.ts');
    const response = await route.POST(new Request('https://www.macro-bias.com/api/account/alerts', { method: 'POST', headers: headers(), body: JSON.stringify({ stocksOptedIn: false, cryptoOptedIn: false }) }));
    assert.equal(response.status, 200); assert.equal(h.tables.free_subscribers[0].status, 'inactive');
    assert.equal(h.tables.welcome_email_drip_enrollments[0].status, 'unsubscribed');
    assert.equal(h.tables.welcome_email_drip_deliveries[0].status, 'cancelled');
    assert.equal((h.tables.marketing_event_log ?? []).length, 0);
  });
  await check('account event uses verified creation time and is replay safe', async () => {
    const h = harness(); const c = h.load('src/lib/analytics/conversions.ts');
    const input = { user: user(), headers: headers() };
    await c.confirmAccountAcquisition(input); await c.confirmAccountAcquisition(input);
    const accounts = h.tables.marketing_event_log.filter(row => row.event_name === 'account_created');
    assert.equal(accounts.length, 1); assert.equal(accounts[0].created_at, user().created_at);
    assert.equal(accounts[0].metadata.confirmation, 'verified_auth_user');
  });
  await check('old accounts, unverified accounts and reset flows cannot create registrations', async () => {
    for (const input of [
      { user: user({ created_at: '2026-01-01T00:00:00Z' }), headers: headers() },
      { user: user({ email_confirmed_at: null }), headers: headers() },
      { user: user(), headers: headers(), flowType: 'recovery' },
    ]) {
      const h = harness(); const c = h.load('src/lib/analytics/conversions.ts');
      await c.confirmAccountAcquisition(input);
      assert.equal((h.tables.marketing_event_log ?? []).filter(row => row.event_name === 'account_created').length, 0);
      if (input.flowType === 'recovery' || !input.user.email_confirmed_at) assert.equal(h.effects.writes.length, 0);
    }
  });
  await check('later login campaign cannot become an earlier signup source', async () => {
    const h = harness(); const c = h.load('src/lib/analytics/conversions.ts');
    const later = attribution('linkedin'); later.latestTouch.capturedAt = '2026-10-04T20:55:00Z';
    await c.confirmAccountAcquisition({ user: user({ user_metadata: {} }), headers: headers(later) });
    assert.equal(h.tables.marketing_event_log.find(row => row.event_name === 'account_created').metadata.attribution, null);
  });
  await check('cross-device signup confirmation retains consented original source; denial overrides', async () => {
    const h = harness(); const c = h.load('src/lib/analytics/conversions.ts');
    await c.confirmAccountAcquisition({ user: user(), headers: new Headers({ host: 'www.macro-bias.com', 'user-agent': 'Mozilla/5.0' }) });
    assert.equal(h.tables.marketing_event_log[0].metadata.attribution.firstTouch.source, 'reddit');
    const denied = harness(); const dc = denied.load('src/lib/analytics/conversions.ts');
    await dc.confirmAccountAcquisition({ user: user(), headers: headers(attribution(), 'denied') });
    assert.equal(denied.tables.marketing_event_log[0].metadata.attribution, null);
  });
  await check('account endpoint rejects unauthenticated and cross-site calls', async () => {
    const h = harness(); const route = h.load('src/app/api/analytics/account/route.ts');
    assert.equal((await route.POST(new Request('https://www.macro-bias.com/api/analytics/account', { method: 'POST' }))).status, 401);
    assert.equal((await route.POST(new Request('https://www.macro-bias.com/api/analytics/account', { method: 'POST', headers: { origin: 'https://attacker.invalid' } }))).status, 403);
    assert.equal(h.effects.writes.length, 0);
  });
  await check('Stripe metadata safely roundtrips first/latest within Stripe limits', async () => {
    const h = harness(); const c = h.load('src/lib/analytics/conversions.ts');
    const metadata = c.stripeAcquisitionMetadata(attribution('reddit', 'linkedin'));
    assert.ok(Object.keys(metadata).length < 47); assert.ok(Object.values(metadata).every(value => value.length <= 500));
    assert.deepEqual(clone(c.attributionFromStripeMetadata(metadata)), attribution('reddit', 'linkedin'));
    assert.deepEqual(clone(c.stripeAcquisitionMetadata(null)), {});
  });
  await check('cross-device identity retains first discovery with bounded expiry and latest non-direct touch', async () => {
    const h = harness(); const c = h.load('src/lib/analytics/conversions.ts');
    const original = attribution(); original.firstTouch.capturedAt = '2026-09-04T19:59:00.000Z';
    original.expiresAt = '2026-12-01T19:59:00.000Z';
    const direct = attribution('direct'); direct.firstTouch.medium = 'none'; direct.latestTouch.medium = 'none';
    direct.firstTouch.capturedAt = '2026-10-04T20:30:00.000Z'; direct.latestTouch.capturedAt = '2026-10-04T20:30:00.000Z';
    const merged = c.mergeAcquisition(original, direct);
    assert.equal(merged.firstTouch.source, 'reddit'); assert.equal(merged.latestTouch.source, 'reddit');
    assert.ok(Date.parse(merged.expiresAt) <= Date.parse(original.firstTouch.capturedAt) + 90 * 86400000);
    assert.ok(c.attributionFromStripeMetadata(c.stripeAcquisitionMetadata(merged)));
  });
  await check('checkout carries consented attribution into session and subscription metadata', async () => {
    const h = harness({ user: user() }); const route = h.load('src/app/api/checkout/route.ts');
    const response = await route.POST(new Request('https://www.macro-bias.com/api/checkout?plan=annual', { method: 'POST', headers: headers() }));
    assert.equal(response.status, 200); assert.equal(h.effects.checkout.length, 1);
    const session = h.effects.checkout[0];
    assert.equal(session.metadata.mb_first_source, 'reddit'); assert.equal(session.subscription_data.metadata.mb_latest_source, 'reddit');
    assert.equal(session.metadata.supabaseUUID, user().id); assert.equal(session.line_items[0].price, 'fixture-price-annual');
  });
  await check('checkout consent rejection keeps billing metadata but no marketing identity', async () => {
    const h = harness({ user: user() }); const route = h.load('src/app/api/checkout/route.ts');
    const response = await route.POST(new Request('https://www.macro-bias.com/api/checkout', { method: 'POST', headers: headers(attribution(), 'denied') }));
    assert.equal(response.status, 200); assert.equal(h.effects.checkout[0].metadata.mb_visitor, undefined);
    assert.equal(h.effects.checkout[0].metadata.supabaseUserId, user().id);
  });
  await check('first actual paid invoice counts once without changing payment or billing', async () => {
    const h = harness({ invoices: async () => ({ data: [invoice()], has_more: false }) }); const c = h.load('src/lib/analytics/conversions.ts');
    const input = { stripe: h.stripe, invoice: invoice(), userId: user().id, customerId: 'cus_fixture', attribution: attribution() };
    await c.recordPaidAcquisition(input); await c.recordPaidAcquisition(input);
    const events = h.tables.marketing_event_log.filter(row => row.event_name === 'paid_conversion');
    assert.equal(events.length, 1); assert.equal(events[0].metadata.first_paid_verified, true);
    assert.equal(events[0].metadata.amount_minor, 2500); assert.equal(events[0].created_at, new Date(invoice().status_transitions.paid_at * 1000).toISOString());
    assert.ok(h.effects.writes.every(write => write.table === 'marketing_event_log'));
  });
  await check('renewals do not become new upgrades when historic capture is absent', async () => {
    const prior = invoice({ id: 'in_prior', created: invoice().created - 10000, status_transitions: { paid_at: invoice().status_transitions.paid_at - 10000 } });
    const h = harness({ invoices: async () => ({ data: [invoice(), prior], has_more: false }) }); const c = h.load('src/lib/analytics/conversions.ts');
    await c.recordPaidAcquisition({ stripe: h.stripe, invoice: invoice(), userId: user().id, customerId: 'cus_fixture', attribution: attribution() });
    assert.equal(h.effects.writes.length, 0);
  });
  await check('trial/free/unpaid/test/out-of-band invoices cannot create paid conversions', async () => {
    const h = harness(); const c = h.load('src/lib/analytics/conversions.ts');
    for (const item of [invoice({ amount_paid: 0 }), invoice({ status: 'open' }), invoice({ livemode: false }), invoice({ paid_out_of_band: true }), invoice({ status_transitions: { paid_at: null } })]) {
      await c.recordPaidAcquisition({ stripe: h.stripe, invoice: item, userId: user().id, customerId: 'cus_fixture', attribution: attribution() });
    }
    assert.equal(h.effects.writes.length, 0);
  });
  await check('incomplete huge payment histories fail closed rather than labelling renewals new', async () => {
    let calls = 0;
    const h = harness({ invoices: async () => { calls++; return { data: [invoice({ id: `in_later_${calls}`, status_transitions: { paid_at: invoice().status_transitions.paid_at + 1000 } })], has_more: true }; } });
    const c = h.load('src/lib/analytics/conversions.ts');
    assert.equal(await c.isFirstPaidInvoice(h.stripe, invoice(), 'cus_fixture'), false); assert.equal(calls, 20);
    assert.equal(h.effects.writes.length, 0);
  });
  await check('actual verified Stripe webhook records first payment after existing billing synchronization', async () => {
    const actualInvoice = invoice({ subscription: 'sub_fixture', customer: 'cus_fixture', customer_email: user().email });
    const initial = harness(); const conversions = initial.load('src/lib/analytics/conversions.ts');
    const h = harness({ subscriptionMetadata: { supabaseUUID: user().id, ...conversions.stripeAcquisitionMetadata(attribution()) }, invoices: async () => ({ data: [actualInvoice], has_more: false }) });
    const route = h.load('src/app/api/webhooks/stripe/route.ts');
    const response = await route.POST(new Request('https://www.macro-bias.com/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': 'fixture-verified-signature' }, body: JSON.stringify({ type: 'invoice.paid', data: { object: actualInvoice } }) }));
    assert.equal(response.status, 200);
    assert.equal(h.tables.users[0].subscription_status, 'active'); assert.equal(h.tables.users[0].stripe_subscription_id, 'sub_fixture');
    assert.equal(h.tables.marketing_event_log.filter(row => row.event_name === 'paid_conversion').length, 1);
    assert.ok(h.effects.writes.findIndex(write => write.table === 'users') < h.effects.writes.findIndex(write => write.table === 'marketing_event_log'));
  });
  await check('invalid Stripe signature cannot update billing or record a conversion', async () => {
    const h = harness(); const route = h.load('src/app/api/webhooks/stripe/route.ts');
    const response = await route.POST(new Request('https://www.macro-bias.com/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': 'forged' }, body: JSON.stringify({ type: 'invoice.paid', data: { object: invoice() } }) }));
    assert.equal(response.status, 400); assert.equal(h.effects.writes.length, 0);
  });
  await check('a zero-opt-in record cannot become a newsletter acquisition', async () => {
    const h = harness(); const c = h.load('src/lib/analytics/conversions.ts');
    await c.recordSubscriberAcquisition(subscriberInput({ stocksOptedIn: false, cryptoOptedIn: false, headers: headers(attribution(), 'denied') }));
    assert.equal((h.tables.marketing_event_log ?? []).length, 0);
    assert.equal(h.effects.writes.length, 0);
  });
  await check('shared helper deadlines reach nested SDK calls and stop the next effect at cutoff', async () => {
    const advancing = { onDbCall({ effects, advanceClock }) { advanceClock(effects.dbCalls.length <= 2 ? 4500 : 1000); } };
    const accountHarness = harness(advancing); const accountConversions = accountHarness.load('src/lib/analytics/conversions.ts');
    await assert.rejects(accountConversions.confirmAccountAcquisition({ user: user(), headers: headers() }), /temporarily unavailable/);
    assert.deepEqual(accountHarness.effects.adminOptions.map(value => value.timeoutMs), [5000, 5000, 1000]);
    assert.deepEqual(accountHarness.effects.dbCalls.map(value => value.action), ['upsert', 'select', 'upsert']);
    assert.equal(accountHarness.effects.writes.length, 2); // No second identity effect/read after the 10s cutoff.
    const subscriberHarness = harness(advancing); const subscriberConversions = subscriberHarness.load('src/lib/analytics/conversions.ts');
    await subscriberConversions.recordSubscriberAcquisition(subscriberInput());
    assert.deepEqual(subscriberHarness.effects.adminOptions.map(value => value.timeoutMs), [5000, 5000, 1000]);
    const checkoutHarness = harness(); const checkoutConversions = checkoutHarness.load('src/lib/analytics/conversions.ts');
    await checkoutConversions.checkoutAcquisition(user(), headers());
    assert.deepEqual(checkoutHarness.effects.adminOptions.map(value => value.timeoutMs), [5000, 5000]);
    assert.ok(checkoutHarness.effects.dbCalls.every(value => value.action === 'select'));
    const expired = harness(); const logger = expired.load('src/lib/analytics/server.ts');
    await assert.rejects(logger.logMarketingEvent({ id: 'expired-id', eventName: 'page_view', pagePath: '/', timeoutMs: 5000, deadlineAt: NOW }), /temporarily unavailable/);
    assert.equal(expired.effects.adminOptions.length, 0); assert.equal(expired.effects.writes.length, 0);
    for (const timeoutMs of [0, -1, Infinity, NaN]) await assert.rejects(logger.logMarketingEvent({ id: 'invalid-timeout', eventName: 'page_view', pagePath: '/', timeoutMs }), /temporarily unavailable/);
    await logger.logMarketingEvent({ eventName: 'referral_clicked', pagePath: '/refer', timeoutMs: 0, deadlineAt: NOW - 1 });
    assert.deepEqual(expired.effects.adminOptions, [{}]); // Legacy non-ID behavior uses the unchanged default client.
  });
  await check('actual Supabase SDK transport receives and honors the bounded factory AbortSignal', async () => {
    const h = harness({ actualAdminFactory: true, fetchTransport: async (_input, init) => {
      assert.ok(init.signal instanceof AbortSignal);
      return new Promise((_resolve, reject) => {
        const keepAlive = setTimeout(() => reject(new Error('Transport did not receive its abort signal.')), 750);
        const abort = () => { clearTimeout(keepAlive); reject(new DOMException('Fixture transport aborted.', 'AbortError')); };
        if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true });
      });
    } });
    const logger = h.load('src/lib/analytics/server.ts');
    const began = Date.now();
    await assert.rejects(logger.logMarketingEvent({ id: '00000000-0000-8000-a000-000000000001', eventName: 'page_view', pagePath: '/', timeoutMs: 25, deadlineAt: NOW + 1000 }), /temporarily unavailable/);
    assert.ok(Date.now() - began < 750);
    assert.equal(h.effects.transports.length, 1);
    assert.equal(h.effects.transports[0].signal.aborted, true);
    assert.equal(h.effects.writes.length, 0);
  });
  await check('Stripe history uses SDK timeout/retry options, stops at 20s and retries analytics after billing sync', async () => {
    let calls = 0;
    const h = harness({ invoices: async (_payload, requestOptions, { advanceClock }) => {
      assert.equal(requestOptions.maxNetworkRetries, 0); calls++; advanceClock(4000);
      return { data: [invoice({ id: `in_later_${calls}`, status_transitions: { paid_at: invoice().status_transitions.paid_at + 1000 } })], has_more: true };
    } });
    const c = h.load('src/lib/analytics/conversions.ts');
    await assert.rejects(c.recordPaidAcquisition({ stripe: h.stripe, invoice: invoice(), userId: user().id, customerId: 'cus_fixture', attribution: attribution() }), /temporarily unavailable/);
    assert.equal(calls, 5);
    assert.deepEqual(h.effects.invoiceRequests.map(value => value.options.timeout), [5000, 5000, 5000, 5000, 4000]);
    assert.equal(h.effects.writes.length, 0);
    const actualInvoice = invoice({ subscription: 'sub_fixture', customer: 'cus_fixture', customer_email: user().email });
    const failed = harness({ invoices: async () => { throw new Error('Private simulated provider request detail.'); } });
    const route = failed.load('src/app/api/webhooks/stripe/route.ts');
    const response = await route.POST(new Request('https://www.macro-bias.com/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': 'fixture-verified-signature' }, body: JSON.stringify({ type: 'invoice.paid', data: { object: actualInvoice } }) }));
    assert.equal(response.status, 500);
    assert.equal(failed.tables.users[0].subscription_status, 'active');
    assert.equal((failed.tables.marketing_event_log ?? []).length, 0);
    const payload = await response.json();
    assert.match(payload.error, /temporarily unavailable/); assert.equal(payload.error.includes('Private simulated'), false);
    assert.equal(failed.effects.invoiceRequests[0].options.maxNetworkRetries, 0);
  });
  console.log(JSON.stringify({ ok: true, scenarioGroups: checks.length, checks, productionWrites: 0, realEmails: 0, accountsCreated: 0 }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
