const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const attributionContext = { exports: {}, Date, URL };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/analytics/attribution.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, attributionContext);

let isolatedAdminFactory = null;
const context = { exports: {}, Date, Map, Set, URL, AbortSignal, setTimeout, clearTimeout, require(name) {
  if (name === 'server-only') return {};
  if (name === 'node:crypto') return crypto;
  if (name === '@/lib/analytics/attribution') return attributionContext.exports;
  if (name === '@/lib/supabase/admin') return { createSupabaseAdminClient(options) {
    if (!isolatedAdminFactory) throw new Error('A test must provide its isolated fake client.');
    return isolatedAdminFactory(options);
  } };
  throw new Error(`Unexpected import: ${name}`);
} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/analytics/acquisition-data.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const { buildAcquisitionReport: build, resolveAcquisitionRange: range, getAcquisitionReport: load, acquisitionCsv: csv, ACQUISITION_EVENT_NAMES: names } = context.exports;
const NOW = new Date('2026-10-04T20:30:00.000Z');
const createdAt = '2026-10-04T12:00:00.000Z';
const visitor = '00000000-0000-4000-8000-000000000001';
const visitor2 = '00000000-0000-4000-8000-000000000002';
const session = '00000000-0000-4000-8000-000000000003';
const nav = '00000000-0000-4000-8000-000000000004';
const key = (kind, value) => `${kind}:${crypto.createHash('sha256').update(value.toLowerCase()).digest('hex')}`;
const subscriberKey = key('subscriber', 'real-person@example.net');
const accountKey = key('account', 'actual-auth-uuid');
const paidKey = key('paid', 'actual-auth-uuid');
const first = { source: 'reddit', medium: 'social', campaign: 'daily_launch', content: 'post_a', referrerDomain: 'reddit.com', landingPath: '/crypto/today', capturedAt: '2026-10-02T08:00:00.000Z' };
const last = { source: 'google.com', medium: 'organic', campaign: null, content: null, referrerDomain: 'google.com', landingPath: '/today', capturedAt: '2026-10-04T10:00:00.000Z' };
const attribution = { version: 2, visitorId: visitor, sessionId: session, firstTouch: first, latestTouch: last };
const view = (id, patch = {}) => ({ id, event_name: 'page_view', created_at: '2026-10-04T10:00:00.000Z', page_path: '/crypto/today', anonymous_id: visitor, session_id: session, metadata: { event_version: 2, tracking_mode: 'consented', traffic_type: 'human', content_group: 'crypto', attribution }, ...patch });
const conversion = (id, event, entityKey, patch = {}) => ({ id, event_name: event, created_at: createdAt, page_path: '/today', metadata: {
  event_version: 2, tracking_mode: 'consented', traffic_type: 'human', attribution, confirmed: true, entity_key: entityKey,
  conversion_kind: event === 'email_subscribed' ? 'new_subscriber' : event === 'account_created' ? 'new_account' : 'first_paid_upgrade',
  confirmation: event === 'email_subscribed' ? 'subscriber_record_saved' : event === 'account_created' ? 'verified_auth_user' : 'stripe_invoice_paid',
  ...(event === 'email_subscribed' ? { stocks_opted_in: true, crypto_opted_in: true } : {}),
  ...(event === 'paid_conversion' ? { first_paid_verified: true, amount_minor: 1000, currency: 'gbp' } : {}),
}, ...patch });
const subscriber = { entityKey: subscriberKey, createdAt, status: 'active', stocksOptedIn: true, cryptoOptedIn: true };
const account = { entityKey: accountKey, createdAt };
const base = () => ({ events: [view('view-1'), view('view-2'), conversion('sub-1', 'email_subscribed', subscriberKey), conversion('account-1', 'account_created', accountKey), conversion('paid-1', 'paid_conversion', paidKey)], subscribers: [subscriber], accounts: [account] });
const report = (input = base(), filters = {}) => build(input, filters, NOW);
let passed = 0;
function check(name, fn) { fn(); passed++; }

check('UTC boundaries and inclusive preset days', () => {
  const value = range({ preset: '7d' }, NOW);
  assert.equal(value.startDate, '2026-09-28');
  assert.equal(value.endExclusive, '2026-10-05T00:00:00.000Z');
  assert.equal(value.timezone, 'UTC');
  const input = base(); input.events.push(view('past', { created_at: '2026-09-27T23:59:59.999Z' }), view('edge', { created_at: '2026-09-28T00:00:00.000Z' }), view('future', { created_at: '2026-10-05T00:00:00.000Z' }));
  assert.equal(report(input, { preset: '7d' }).overview.pageViews, 3);
});
check('invalid and excessive ranges fail clearly', () => {
  for (const value of [{ preset: 'all' }, { preset: 'custom', start: '2026-02-30', end: '2026-10-04' }, { preset: 'custom', start: '2026-10-04', end: '2026-10-03' }, { preset: 'custom', start: '2025-01-01', end: '2026-10-04' }, { preset: 'custom', start: '2026-10-04', end: '2026-10-05' }]) assert.throws(() => range(value, NOW));
});
check('distinct visitors and sessions do not count repeated views', () => {
  const value = report();
  assert.equal(value.overview.pageViews, 2);
  assert.equal(value.overview.visitors, 1);
  assert.equal(value.overview.sessions, 1);
  assert.equal(value.overview.newSubscribers, 1);
  assert.equal(value.overview.newAccounts, 1);
  assert.equal(value.overview.paidConversions, 1);
  assert.equal(value.overview.subscriberRate, 100);
});
check('replayed conversions and unsafe legacy successes never inflate entities', () => {
  const input = base();
  input.events.push(input.events[0], input.events[2], { ...input.events[2], id: 'repeated-entity' }, { id: 'client-success', event_name: 'email_signup_success', created_at: createdAt }, { id: 'legacy-server-success', event_name: 'email_subscribed', created_at: createdAt, metadata: {} });
  input.subscribers.push(subscriber, { entityKey: key('subscriber', 'historical@example.net'), createdAt });
  const value = report(input);
  assert.equal(value.overview.newSubscribers, 2);
  assert.equal(value.coverage.knownSubscriberSources, 1);
  assert.equal(value.coverage.unknownSubscriberSources, 1);
  assert.equal(value.overview.subscriberRate, 100);
});
check('recorded historical sources retained while missing sources stay Unknown', () => {
  const value = report({ subscribers: [], accounts: [], events: [
    { id: 'legacy-known', event_name: 'page_view', created_at: createdAt, utm_source: 'newsletter', page_path: '/' },
    { id: 'legacy-unknown', event_name: 'page_view', created_at: createdAt, page_path: '/' },
    { id: 'legacy-referrer', event_name: 'page_view', created_at: createdAt, referrer: 'https://www.reddit.com/r/markets?private=value', page_path: '/' },
  ] });
  assert.equal(value.overview.visitors, 0);
  assert.equal(value.overview.sessions, 0);
  assert.equal(value.overview.subscriberRate, null);
  assert.deepEqual(Array.from(value.options.sources), ['newsletter', 'reddit', 'unknown']);
  assert.equal(value.coverage.legacyPageViews, 3);
});
check('first/latest and source/campaign filters use the same occurrence range', () => {
  const firstReport = report(base(), { touch: 'first', source: 'reddit', campaign: 'daily_launch' });
  assert.equal(firstReport.overview.newSubscribers, 1);
  assert.equal(firstReport.landingRows[0].label, '/crypto/today');
  assert.equal(report(base(), { touch: 'latest', source: 'reddit' }).overview.pageViews, 0);
  assert.equal(report(base(), { touch: 'latest', source: 'google.com' }).overview.newSubscribers, 1);
  assert.equal(firstReport.filters.touch, 'first');
});
check('canonical source aliases group historical recorded domains with new sources', () => {
  const value = report({ events: ['twitter', 't.co', 'x.com', 'google.co.uk', 'google.com'].map((utm_source, i) => ({ id: `alias-${i}`, event_name: 'page_view', created_at: createdAt, utm_source, page_path: '/' })), subscribers: [], accounts: [] });
  assert.equal(value.sourceRows.find(row => row.source === 'x').pageViews, 3);
  assert.equal(value.sourceRows.find(row => row.source === 'google').pageViews, 2);
});
check('Reddit app and web views group together without replacing recorded media or campaigns', () => {
  const rows = [
    { utm_source: 'reddit', referrer: null },
    { utm_source: 'reddit.com', referrer: null },
    { utm_source: null, referrer: 'https://www.reddit.com/r/markets' },
    { utm_source: null, referrer: 'android-app://com.reddit.frontpage/' },
  ].map((fields, index) => ({ id: `reddit-${index}`, event_name: 'page_view', created_at: createdAt, page_path: '/crypto', utm_medium: 'referral', utm_campaign: 'historic_weekend_post', ...fields }));
  rows.push({ id: 'reddit-paid', event_name: 'page_view', created_at: createdAt, page_path: '/crypto', utm_source: 'com.reddit.frontpage', utm_medium: 'cpc', utm_campaign: 'historic_paid_post' });
  const value = report({ events: rows, subscribers: [], accounts: [] }, { source: 'reddit' });
  assert.equal(value.overview.pageViews, 5);
  assert.equal(value.sourceRows.find(row => row.source === 'reddit' && row.medium === 'referral').pageViews, 4);
  assert.equal(value.sourceRows.find(row => row.source === 'reddit' && row.medium === 'cpc').pageViews, 1);
  assert.equal(value.campaignRows.find(row => row.campaign === 'historic_weekend_post').pageViews, 4);
  assert.equal(value.campaignRows.find(row => row.campaign === 'historic_paid_post').medium, 'cpc');
});
check('known search and Gmail app sources normalize without recasting explicit historical referral media', () => {
  const aliases = [['google.co.uk', 'google'], ['www.google.com', 'google'], ['cn.bing.com', 'bing'], ['duckduckgo.com', 'duckduckgo'], ['r.search.yahoo.com', 'yahoo'], ['search.yahoo.co.jp', 'yahoo'], ['com.google.android.gm', 'gmail']];
  const value = report({ events: aliases.map(([domain], index) => ({ id: `search-${index}`, event_name: 'page_view', created_at: createdAt, referrer: `https://${domain}/`, utm_medium: 'referral', utm_campaign: 'historical_search_link', page_path: '/' })), subscribers: [], accounts: [] });
  for (const platform of ['google', 'bing', 'duckduckgo', 'yahoo', 'gmail']) {
    const row = value.sourceRows.find(item => item.source === platform);
    assert.ok(row); assert.equal(row.medium, 'referral');
  }
  assert.ok(value.campaignRows.every(row => row.campaign === 'historical_search_link'));
  assert.equal(attributionContext.exports.normalizeSource('google.com.attacker.invalid'), 'google.com.attacker.invalid');
});
check('Unknown source is coverage, never a zero-percent source benchmark', () => {
  const value = report({ events: [{ id: 'legacy-identified-unknown', event_name: 'page_view', created_at: createdAt, anonymous_id: visitor, session_id: session, page_path: '/' }], subscribers: [{ entityKey: subscriberKey, createdAt }], accounts: [] });
  assert.equal(value.overview.visitors, 1);
  assert.equal(value.overview.subscriberRate, 0);
  assert.equal(value.sourceRows[0].source, 'unknown');
  assert.equal(value.sourceRows[0].subscriberRate, null);
});
check('conversion-only identities do not invent visits or funnel visitors', () => {
  const input = base(); input.events = input.events.filter(event => event.event_name !== 'page_view');
  input.subscribers.push({ entityKey: key('subscriber', 'unknown@example.net'), createdAt });
  const value = report(input);
  assert.equal(value.overview.newSubscribers, 2);
  assert.equal(value.overview.visitors, 0);
  assert.equal(value.overview.subscriberRate, null);
  assert.equal(value.funnel[1].value, 0);
  assert.equal(value.funnel[2].value, 0);
});
check('visitor conversion rates require the same filtered observed visitor', () => {
  const input = base();
  input.events[0] = view('view-1', { metadata: { event_version: 2, tracking_mode: 'consented', traffic_type: 'human', attribution: { ...attribution, visitorId: visitor2 } } });
  input.events = input.events.filter(event => event.id !== 'view-2');
  const value = report(input);
  assert.equal(value.overview.newSubscribers, 1);
  assert.equal(value.overview.subscriberRate, 0);
  assert.equal(value.funnel[1].value, 0);
});
check('linked outcome counts distinguish multiple entities from one visitor and explicit unlinked totals', () => {
  const input = base();
  const secondSubscriber = key('subscriber', 'second-real-person@example.net');
  const secondAccount = key('account', 'second-auth-id');
  input.subscribers.push({ entityKey: secondSubscriber, createdAt }, { entityKey: key('subscriber', 'unknown-person@example.net'), createdAt });
  input.accounts.push({ entityKey: secondAccount, createdAt }, { entityKey: key('account', 'unknown-auth-id'), createdAt });
  input.events.push(conversion('second-sub', 'email_subscribed', secondSubscriber), conversion('second-account', 'account_created', secondAccount), conversion('second-paid', 'paid_conversion', key('paid', 'second-auth-id')));
  const unlinkedPaid = conversion('unlinked-paid', 'paid_conversion', key('paid', 'unobserved-auth-id'));
  unlinkedPaid.metadata.attribution = { ...attribution, visitorId: visitor2 };
  input.events.push(unlinkedPaid);
  const value = report(input);
  assert.equal(value.overview.newSubscribers, 3);
  assert.equal(value.overview.newAccounts, 3);
  assert.equal(value.overview.paidConversions, 3);
  assert.equal(value.coverage.linkedSubscriberCount, 2);
  assert.equal(value.coverage.linkedAccountCount, 2);
  assert.equal(value.coverage.linkedPaidCount, 2);
  assert.equal(value.coverage.unlinkedSubscriberCount, 1);
  assert.equal(value.coverage.unlinkedAccountCount, 1);
  assert.equal(value.coverage.unlinkedPaidCount, 1);
  assert.equal(value.funnel[1].value, 1);
  assert.equal(value.funnel[2].value, 1);
  assert.equal(value.funnel[3].value, 1);
  assert.equal(value.overview.subscriberRate, 100);
});
check('later return visits do not retrospectively become pre-signup funnel evidence', () => {
  const input = base(); input.events = input.events.filter(event => event.event_name !== 'page_view');
  input.events.push(view('later-return', { created_at: '2026-10-04T13:00:00.000Z' }));
  const value = report(input);
  assert.equal(value.overview.visitors, 1);
  assert.equal(value.overview.newSubscribers, 1);
  assert.equal(value.overview.subscriberRate, 0);
  assert.equal(value.funnel[2].value, 0);
});
check('paid upgrades need verified first live payment proof, not active flags', () => {
  const input = base();
  input.events[4] = conversion('paid-unproven', 'paid_conversion', paidKey, { metadata: { ...input.events[4].metadata, first_paid_verified: false } });
  input.events.push({ ...input.events[4], id: 'trial-active', metadata: { confirmed: true, subscription_status: 'active' } });
  assert.equal(report(input).overview.paidConversions, 0);
  input.events[4] = conversion('paid-verified', 'paid_conversion', paidKey);
  input.events.push(conversion('paid-replay', 'paid_conversion', paidKey));
  assert.equal(report(input).overview.paidConversions, 1);
  assert.equal(report(input).coverage.paidHistoryAvailable, false);
});
check('bots/private views/diagnostics/crypto ledger remain outside totals', () => {
  const input = base();
  input.events.push(view('bot', { metadata: { traffic_type: 'bot' } }), view('qa', { utm_source: 'qa-smoke' }), view('private', { page_path: '/analytics?all=true' }), view('local', { referrer: 'http://localhost:3000/' }), { id: 'ledger', event_name: 'crypto_email_delivery', created_at: createdAt, metadata: { secret_provider_payload: 'never-read' } }, { id: 'reset', event_name: 'auth_reset_requested', created_at: createdAt });
  assert.equal(report(input).overview.pageViews, 2);
  assert.equal(report(input).coverage.excludedRows, 6);
  assert.equal(names.includes('crypto_email_delivery'), false);
});
check('actual private alerts alias cannot overwrite acquisition while public crypto dashboard remains countable', () => {
  assert.match(fs.readFileSync('src/app/alerts/page.tsx', 'utf8'), /redirect\('\/account'\)/);
  assert.equal(attributionContext.exports.deriveAcquisitionTouch({ url: 'https://www.macro-bias.com/alerts?utm_source=preference_link', now: NOW.getTime() }), null);
  assert.ok(attributionContext.exports.deriveAcquisitionTouch({ url: 'https://www.macro-bias.com/crypto/dashboard?utm_source=reddit', now: NOW.getTime() }));
  const value = report({ events: [view('private-alerts', { page_path: '/alerts?utm_source=preference_link' }), view('public-crypto-dashboard', { page_path: '/crypto/dashboard' })], subscribers: [], accounts: [] });
  assert.equal(value.overview.pageViews, 1);
  assert.equal(value.coverage.excludedRows, 1);
});
check('referral-only rows excluded; real later-unsubscribed history retained', () => {
  const input = base(); input.subscribers.push({ entityKey: key('subscriber', 'pro-referral@example.net'), createdAt, status: 'active', stocksOptedIn: false, cryptoOptedIn: false }, { entityKey: key('subscriber', 'unsubscribed@example.net'), createdAt, status: 'inactive', stocksOptedIn: false, cryptoOptedIn: false });
  assert.equal(report(input).overview.newSubscribers, 2);
  assert.equal(report(input).coverage.excludedReferralOnlyRows, 1);
});
check('immutable eligible signup survives later unsubscribe, all-off and interest changes', () => {
  const original = base();
  original.events[2] = { ...original.events[2], metadata: { ...original.events[2].metadata, stocks_opted_in: false, crypto_opted_in: true, content_group: 'crypto' } };
  const originalEvent = JSON.stringify(original.events[2]);
  for (const preferences of [
    { status: 'inactive', stocksOptedIn: false, cryptoOptedIn: false },
    { status: 'active', stocksOptedIn: false, cryptoOptedIn: false },
    { status: 'active', stocksOptedIn: true, cryptoOptedIn: false },
  ]) {
    const input = { ...original, subscribers: [{ ...subscriber, ...preferences }], events: [...original.events, original.events[2]] };
    const value = report(input, { touch: 'first', source: 'reddit', campaign: 'daily_launch' });
    assert.equal(value.overview.newSubscribers, 1);
    assert.equal(value.overview.subscriberVisitors, 1);
    assert.equal(value.overview.subscriberRate, 100);
    assert.equal(value.coverage.knownSubscriberSources, 1);
    assert.equal(value.coverage.excludedReferralOnlyRows, 0);
    assert.equal(value.contentRows.find(row => row.label === 'crypto').newSubscribers, 1);
    assert.equal(JSON.stringify(input.events[2]), originalEvent);
  }
});
check('zero-opt-in records need a real initial opt-in snapshot, not an unproven v2 label', () => {
  for (const invalidSnapshot of [
    { stocks_opted_in: false, crypto_opted_in: false },
    { stocks_opted_in: undefined, crypto_opted_in: undefined },
    { confirmed: false },
  ]) {
    const input = base();
    input.subscribers = [{ ...subscriber, status: 'active', stocksOptedIn: false, cryptoOptedIn: false }];
    input.events[2] = { ...input.events[2], metadata: { ...input.events[2].metadata, ...invalidSnapshot } };
    assert.equal(report(input).overview.newSubscribers, 0);
    assert.equal(report(input).coverage.excludedReferralOnlyRows, 1);
  }
  const wrongCreation = base();
  wrongCreation.subscribers = [{ ...subscriber, status: 'active', stocksOptedIn: false, cryptoOptedIn: false }];
  wrongCreation.events[2] = { ...wrongCreation.events[2], created_at: '2026-10-04T13:00:00.000Z' };
  assert.equal(report(wrongCreation).overview.newSubscribers, 0);
});
check('legacy inactive membership remains Unknown with explicit eligibility fallback disclosure', () => {
  const value = report({ events: [], accounts: [], subscribers: [{ ...subscriber, status: 'inactive', stocksOptedIn: false, cryptoOptedIn: false }] });
  assert.equal(value.overview.newSubscribers, 1);
  assert.equal(value.coverage.unknownSubscriberSources, 1);
  assert.equal(value.sourceRows[0].source, 'unknown');
  assert.ok(value.coverage.warnings.some(warning => warning.includes('original newsletter eligibility cannot be retrospectively proven')));
});
check('entity attribution cannot retroactively enrich an earlier creation', () => {
  const input = base(); input.events[2] = { ...input.events[2], created_at: '2026-10-04T13:00:00.000Z' };
  const value = report(input);
  assert.equal(value.overview.newSubscribers, 1);
  assert.equal(value.coverage.unknownSubscriberSources, 1);
});
check('consent marker identifies only its exact current navigation without duplicate view', () => {
  const aggregate = view('aggregate', { anonymous_id: null, session_id: null, metadata: { event_version: 2, traffic_type: 'human', tracking_mode: 'aggregate', navigation_id: nav, aggregate_touch: last } });
  const marker = view('marker', { event_name: 'visitor_identified', created_at: '2026-10-04T10:01:00.000Z', metadata: { event_version: 2, traffic_type: 'human', tracking_mode: 'consented', navigation_id: nav, attribution } });
  const value = report({ events: [aggregate, marker, conversion('sub-1', 'email_subscribed', subscriberKey)], subscribers: [subscriber], accounts: [] });
  assert.equal(value.overview.pageViews, 1);
  assert.equal(value.overview.visitors, 1);
  assert.equal(value.overview.sessions, 1);
  assert.equal(value.overview.subscriberRate, 100);
  assert.equal(value.coverage.identifiedPageViews, 1);
  assert.equal(value.coverage.consentIdentifiedVisits, 1);
  const older = { ...aggregate, created_at: '2026-10-03T10:00:00.000Z' };
  const oldReport = report({ events: [older, marker], subscribers: [], accounts: [] });
  assert.equal(oldReport.coverage.unidentifiedPageViews, 1);
});
check('range distinct visitor totals are not summed daily counts', () => {
  const input = base(); input.events.push(view('previous-day', { created_at: '2026-10-03T10:00:00.000Z' }));
  const value = report(input);
  assert.equal(value.overview.visitors, 1);
  assert.equal(value.dailySeries.reduce((sum, row) => sum + row.visitors, 0), 2);
  assert.equal(value.dailySeries.length, 30);
});
check('safe aggregate serialization and spreadsheet formula escaping', () => {
  const input = base(); input.events[0] = view('hostile', { metadata: { event_version: 2, traffic_type: 'human', tracking_mode: 'aggregate', aggregate_touch: { ...last, source: 'private@example.net', campaign: '=SUM(1,2)', landingPath: '/?token_hash=secret' } } });
  const value = report(input);
  const serialized = JSON.stringify(value);
  for (const privateValue of ['real-person@example.net', subscriberKey, visitor, 'token_hash', 'private@example.net']) assert.equal(serialized.includes(privateValue), false);
  assert.equal(csv(value, 'campaigns').includes("' =SUM"), false);
  assert.match(csv(value, 'campaigns').toLowerCase(), /'=sum\(1,2\)/);
  assert.equal(csv(value).includes('entity_key'), false);
});
check('incomplete/unavailable datasets carry visible coverage instead of silent success', () => {
  const input = base(); input.datasets = [{ name: 'events', rows: 25000, total: 25001, available: true, complete: false }, { name: 'subscribers', rows: 0, total: null, available: false, complete: false, error: 'Subscriber history unavailable.' }, { name: 'accounts', rows: 1, total: 1, available: true, complete: true }];
  const value = report(input);
  assert.equal(value.coverage.complete, false);
  assert.deepEqual(Array.from(value.coverage.truncatedDatasets), ['events']);
  assert.equal(value.coverage.datasets[1].available, false);
  assert.ok(value.coverage.warnings.includes('Subscriber history unavailable.'));
});

function fakeAdmin({ events = [], subscribers = [], users = [], failTable = null }) {
  const reads = [];
  return { reads, from(table) {
    const operation = { table, fields: null, count: null, names: null, start: null, end: null, cursor: null, column: null, take: 500 };
    const query = { select(fields, options = {}) { operation.fields = fields; operation.count = options.count; return query; }, in(column, values) { assert.equal(column, 'event_name'); operation.names = values; return query; }, gte(column, value) { assert.equal(column, 'created_at'); operation.start = value; return query; }, lt(column, value) { assert.equal(column, 'created_at'); operation.end = value; return query; }, order(column) { operation.column = column; return query; }, limit(take) { operation.take = take; return query; }, gt(column, value) { assert.equal(column, operation.column); operation.cursor = value; return query; }, async abortSignal(signal) {
      assert.equal(signal instanceof AbortSignal, true); reads.push({ ...operation });
      if (table === failTable) return { data: null, count: null, error: { message: 'private raw error must not escape' } };
      assert.ok(['marketing_event_log', 'free_subscribers'].includes(table));
      let data = table === 'marketing_event_log' ? events.filter(event => operation.names.includes(event.event_name)) : subscribers;
      data = data.filter(row => row.created_at >= operation.start && row.created_at < operation.end).sort((a,b) => a[operation.column].localeCompare(b[operation.column]));
      const count = data.length;
      if (operation.cursor) data = data.filter(row => row[operation.column] > operation.cursor);
      return { data: data.slice(0, operation.take), count: operation.count === 'exact' ? count : null, error: null };
    } }; return query;
  }, auth: { admin: { async listUsers({ page, perPage }) { reads.push({ table: 'auth', page, perPage }); return { data: { users: users.slice((page-1)*perPage,page*perPage) }, error: null }; } } } };
}

(async () => {
  const defaultAdmin = fakeAdmin({});
  let factoryCalls = 0;
  isolatedAdminFactory = options => {
    factoryCalls++;
    assert.equal(options.timeoutMs, 8000);
    assert.deepEqual(Object.keys(options), ['timeoutMs']);
    return defaultAdmin;
  };
  const empty = await load({ preset: '7d' }, undefined, NOW);
  assert.equal(empty.coverage.complete, true);
  assert.equal(factoryCalls, 1);
  assert.deepEqual(defaultAdmin.reads.map(read => read.table).sort(), ['auth', 'free_subscribers', 'marketing_event_log']);
  await load({ preset: '7d' }, fakeAdmin({}), NOW);
  assert.equal(factoryCalls, 1, 'An explicit isolated client must not create another client or change legacy defaults.');
  isolatedAdminFactory = null;
  passed++;
  const events = Array.from({ length: 501 }, (_, i) => view(`event-${String(i).padStart(5,'0')}`, { anonymous_id: null, session_id: null, metadata: { event_version: 2, traffic_type: 'human', tracking_mode: 'aggregate', aggregate_touch: last } }));
  events.push({ id: 'private-ledger', event_name: 'crypto_publication', created_at: createdAt, metadata: { huge_private_body: 'must never be loaded' } });
  const subscribers = Array.from({ length: 501 }, (_, i) => ({ email: `person-${String(i).padStart(5,'0')}@example.net`, created_at: createdAt, status: 'active', stocks_opted_in: true, crypto_opted_in: false }));
  subscribers.push({ email: 'codex-qa@example.invalid', created_at: createdAt, status: 'active', stocks_opted_in: true });
  const users = Array.from({ length: 501 }, (_, i) => ({ id: `auth-${i}`, email: `account-${i}@example.net`, created_at: createdAt, email_confirmed_at: createdAt }));
  users.push({ id: 'unconfirmed-attempt', email: 'not-yet-confirmed@example.net', created_at: createdAt });
  const admin = fakeAdmin({ events, subscribers, users });
  const value = await load({ preset: '7d' }, admin, NOW);
  assert.equal(value.overview.pageViews, 501);
  assert.equal(value.overview.newSubscribers, 501);
  assert.equal(value.overview.newAccounts, 501);
  assert.equal(value.coverage.complete, true);
  assert.equal(value.overview.visitors, 0);
  const eventReads = admin.reads.filter(read => read.table === 'marketing_event_log');
  assert.equal(eventReads.length, 2);
  assert.ok(eventReads[1].cursor);
  assert.equal(eventReads[0].fields.includes('subscriber_email'), false);
  assert.deepEqual(Array.from(eventReads[0].names), Array.from(names));
  assert.equal(JSON.stringify(value).includes('@example'), false);
  passed++;
  const failed = await load({}, fakeAdmin({ events, failTable: 'free_subscribers' }), NOW);
  assert.equal(failed.coverage.complete, false);
  assert.equal(failed.coverage.datasets.find(row => row.name === 'subscribers').available, false);
  assert.equal(JSON.stringify(failed).includes('private raw error'), false);
  assert.match(csv(failed), /subscribers_available/);
  passed++;
  const cappedEvents = Array.from({ length: 25001 }, (_, i) => view(`cap-${String(i).padStart(6,'0')}`, { anonymous_id: null, session_id: null, metadata: { event_version: 2, traffic_type: 'human', tracking_mode: 'aggregate', aggregate_touch: last } }));
  const capped = await load({}, fakeAdmin({ events: cappedEvents }), NOW);
  assert.equal(capped.overview.pageViews, 25000);
  assert.equal(capped.coverage.complete, false);
  assert.deepEqual(Array.from(capped.coverage.truncatedDatasets), ['events']);
  assert.equal(capped.coverage.datasets[0].total, 25001);
  passed++;
  console.log(JSON.stringify({ passed, checks: 'UTC filtering, first/latest attribution, authoritative entity dedup, linked rates/outcome counts, consent-marker correlation, Unknown history, immutable signup after churn, Reddit app/search aliases with recorded media preserved, actual private-route exclusion, private ledger allowlist, aggregate CSV safety, bounded default report transport, keyset pagination beyond 500 rows and partial-data disclosure.' }));
})().catch(error => { console.error(error); process.exitCode = 1; });
