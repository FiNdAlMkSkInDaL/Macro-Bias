/** No network, accounts, subscriptions or live publishing. */
const assert = require('node:assert/strict');
const loader = require('./distribution-loader.cjs');
const NOW = new Date('2026-10-13T14:20:00Z');
const stock = { briefing_date: '2026-10-13', trade_date: '2026-10-13', quant_score: 0, bias_label: 'NEUTRAL',
  generated_at: '2026-10-13T12:40:00Z', brief_content: 'REGIME STATUS: SPY rose 0.5%. The model offers very little direction today.\n\nTRADING IMPLICATION:\nPAID BODY MUST NOT LEAK.' };
const crypto = { trade_date: '2026-10-12', score: 19, bias_label: 'NEUTRAL', created_at: '2026-10-13T12:40:00Z',
  brief_content: 'REGIME STATUS:\n**BTC** rose 0.93%. There is very little direction in this score.\n\nMARKET MAP:\nPAID BODY MUST NOT LEAK.' };
const clone = value => JSON.parse(JSON.stringify(value));

function harness(options = {}) {
  const tables = { daily_market_briefings: [clone({ ...stock, ...options.stock })], crypto_daily_briefings: options.crypto || options.includeCrypto ? [clone({ ...crypto, ...options.crypto })] : [],
    macro_bias_scores: [{ score: 0, bias_label: 'NEUTRAL', trade_date: '2026-10-13', ...options.score }],
    crypto_bias_scores: [{ score: 19, bias_label: 'NEUTRAL', trade_date: '2026-10-12', ...options.cryptoScore }], marketing_event_log: clone(options.deliveries ?? []) };
  const effects = { writes: 0, published: [], reads: [] };
  const admin = { from(table) {
    const state = { action: 'select', filters: [], single: false, limit: Infinity, payload: null };
    const field = (row, key) => key.startsWith('metadata->>') ? row.metadata?.[key.slice(11)] : row[key];
    const query = {
      select() { return query; }, eq(key, value) { state.filters.push(row => field(row, key) === value); return query; },
      gte(key, value) { state.filters.push(row => field(row, key) >= value); return query; },
      order() { return query; }, limit(value) { state.limit = value; return query; },
      maybeSingle() { state.single = true; return query; },
      insert(payload) { state.action = 'insert'; state.payload = clone(payload); return query; },
      update(payload) { state.action = 'update'; state.payload = clone(payload); return query; },
      then(resolve, reject) {
        let data = (tables[table] ?? []).filter(row => state.filters.every(filter => filter(row))).slice(0, state.limit), error = null;
        if (state.action === 'insert') {
          if (options.failClaim) error = { code: 'XX', message: 'SECRET_DATABASE_ERROR' };
          else if (tables[table].some(row => row.id === state.payload.id)) error = { code: '23505' };
          else { tables[table].push({ ...state.payload, created_at: NOW.toISOString() }); effects.writes++; }
        } else if (state.action === 'update') {
          if (options.failFinish) error = { code: 'XX', message: 'SECRET_DATABASE_ERROR' };
          else { data.forEach(row => Object.assign(row, state.payload)); effects.writes++; }
        } else { effects.reads.push(table); if (options.failRead) error = { code: 'XX', message: 'SECRET_DATABASE_ERROR' }; }
        return Promise.resolve({ data: state.single ? clone(data[0] ?? null) : clone(data), error }).then(resolve, reject);
      },
    }; return query;
  } };
  const load = loader();
  const module = load('src/lib/social/distribution.ts');
  const dependencies = { admin, configured: channel => options.missing !== channel,
    chart: async (market, date) => {
      if (options.failChart) throw new Error('SECRET_CHART_ERROR');
      const source = tables[market === 'stocks' ? 'macro_bias_scores' : 'crypto_bias_scores'][0];
      return { market, date, score: options.chartMismatch ? 77 : source.score, label: source.bias_label, overrideActive: false,
        data: new Uint8Array([137, 80, 78, 71]), alt: 'Real published readings', url: `https://www.macro-bias.com/charts/${market}/${date}`,
        points: [{ date: '2026-10-01', score: -5 }, { date, score: source.score }] };
    }, publish: async (channel, text, image) => {
    assert.ok(image.data.byteLength); assert.match(image.url, /\/charts\//);
    effects.published.push({ channel, text });
    if (options.failPublish === channel) throw new Error('SECRET_PROVIDER_TOKEN');
    return options.nullPublish ? null : `remote:${channel}`;
  } };
  return { ...module, tables, effects, admin, run: extra => module.runDistribution({ now: NOW, live: true, ...extra }, dependencies) };
}

(async () => {
  const content = loader()('src/lib/social/distribution-content.ts');
  assert.equal(content.isDistributionDate('2026-02-30'), false);
  assert.equal(content.distributionDestination('evil.com', 'stocks', '2026-10-13'), null);
  assert.equal(content.distributionDestination('bluesky', '//evil.com', '2026-10-13'), null);
  for (const channel of ['bluesky', 'threads']) {
    const url = content.distributionDestination(channel, 'crypto', '2026-10-12');
    assert.equal(url.origin, 'https://www.macro-bias.com'); assert.equal(url.searchParams.get('utm_source'), channel);
    assert.equal(url.pathname, '/crypto'); assert.equal(url.searchParams.get('utm_content'), 'crypto_2026-10-12');
  }
  for (let day = 12; day <= 16; day++) assert.equal(Array.from(content.scheduledDistributionMarkets(new Date(`2026-10-${day}T14:15:00Z`))).join(','), 'stocks,crypto');
  assert.equal(content.scheduledDistributionMarkets(new Date('2026-10-17T14:15:00Z')).length, 0);
  const post = content.buildDistributionPost({ market: 'crypto', channel: 'bluesky', date: '2026-10-12', score: 19, label: 'NEUTRAL', content: crypto.brief_content });
  assert.match(post, /12 Oct close/); assert.match(post, /Model: neutral \(\+19\)/);
  assert.ok(!post.includes('PAID BODY')); assert.ok(!post.includes('**'));
  assert.equal(content.regimeExcerpt('REGIME STATUS: Subscribe now to unlock daily wins.\n\nMARKET MAP: x'), null);
  assert.equal(content.buildDistributionPost({ market: 'crypto', channel: 'bluesky', date: '2026-10-12', score: 19, label: 'NEUTRAL', content: `REGIME STATUS: ${'A long observation. '.repeat(40)}` }), null);
  assert.equal(content.regimeExcerpt('No recognised section. A useful sounding invented fallback.'), null);
  console.log('PASS copy, caveats, fixed destinations and equal schedule');

  let h = harness(); let result = await h.run({ previewBoth: true });
  assert.equal(result.mode, 'preview'); assert.equal(result.results.length, 2);
  assert.equal(h.effects.writes, 0); assert.equal(h.effects.published.length, 0);
  result = await h.run({ live: false }); assert.equal(h.effects.writes, 0);
  h = harness(); await Promise.all([h.run(), h.run(), h.run()]);
  assert.equal(h.effects.published.length, 1); assert.equal(h.tables.marketing_event_log.length, 1);
  assert.equal(h.tables.marketing_event_log[0].metadata.status, 'published');
  assert.equal(h.tables.marketing_event_log[0].metadata.traffic_type, 'internal');
  assert.equal(h.tables.marketing_event_log[0].subscriber_email, undefined);
  result = await h.run(); assert.equal(result.results[0].status, 'already_published');
  assert.equal(h.effects.published.length, 1);
  console.log('PASS read-only preview and simultaneous delivery claims');

  h = harness({ crypto: { trade_date: '2026-10-15', created_at: '2026-10-16T12:40:00Z' }, cryptoScore: { trade_date: '2026-10-15' } });
  result = await h.run({ now: new Date('2026-10-16T14:20:00Z') });
  assert.equal(result.results.find(item => item.market === 'crypto').status, 'published');
  h = harness(); result = await h.run({ now: new Date('2026-10-17T14:20:00Z') });
  assert.equal(result.results.length, 0); assert.equal(h.effects.reads.length, 0);

  for (const options of [{ failPublish: 'bluesky' }, { nullPublish: true }, { failFinish: true }]) {
    h = harness(options); result = await h.run(); assert.equal(result.ok, false);
    assert.equal(result.results[0].status, 'needs_review');
    await h.run(); assert.equal(h.effects.published.length, 1);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
    const health = await h.distributionDeliveryHealth(new Date(NOW.getTime() + 6 * 60_000), h.admin);
    assert.equal(health[0].status, 'needs_review');
  }
  h = harness({ failClaim: true }); result = await h.run(); assert.equal(result.ok, false); assert.equal(h.effects.published.length, 0);
  h = harness({ failRead: true }); result = await h.run(); assert.equal(result.ok, false); assert.equal(h.effects.published.length, 0);
  h = harness({ failPublish: 'bluesky' }); result = await h.run({ channels: ['bluesky', 'threads'] });
  assert.equal(result.results[1].status, 'published'); assert.equal(h.effects.published.length, 2);
  h = harness({ missing: 'bluesky' }); result = await h.run(); assert.equal(h.effects.writes, 0); assert.equal(result.ok, false);
  console.log('PASS ambiguous outcomes, failure isolation and secret redaction');

  for (const options of [{ stock: { generated_at: '2026-10-12T12:40:00Z' } }, { stock: { generated_at: '2026-10-14T12:40:00Z' } },
    { stock: { trade_date: '2026-10-12' } }, { score: { score: 25 } }, { stock: { quant_score: '0' } }]) {
    h = harness(options); result = await h.run(); assert.equal(result.results[0].status, 'skipped'); assert.equal(h.effects.published.length, 0);
  }
  h = harness({ crypto: { trade_date: '2026-10-13' } }); result = await h.run({ previewBoth: true });
  assert.equal(result.results.find(row => row.market === 'crypto').reason, 'fresh_briefing_missing');
  h = harness(); await h.run();
  const recent = clone(h.tables.marketing_event_log[0]); recent.id = 'another-date'; recent.metadata.source_date = '2026-10-06';
  h = harness({ deliveries: [recent] }); result = await h.run(); assert.equal(result.results[0].reason, 'same_excerpt_used_recently'); assert.equal(h.effects.published.length, 0);
  h = harness(); const id = h.distributionDeliveryId('bluesky', 'stocks', '2026-10-13');
  h = harness({ deliveries: [{ id, event_name: 'distribution_delivery', created_at: NOW.toISOString(), metadata: { status: 'claimed', claimed_at: '2026-10-13T13:00:00Z' } }] });
  result = await h.run(); assert.equal(result.results[0].status, 'needs_review'); assert.equal(h.effects.published.length, 0);
  console.log('PASS stale/future/session/score checks, repetition and crash recovery');

  h = harness({ includeCrypto: true }); result = await h.run();
  assert.equal(h.effects.published.length, 2);
  assert.ok(result.results.every(item => item.chartUrl && item.status === 'published'));
  assert.ok(h.tables.marketing_event_log.every(row => row.utm_campaign === 'mb_chart_distribution_v1' && row.metadata.chart_url));
  for (const options of [{ failChart: true }, { chartMismatch: true }]) {
    h = harness(options); await h.run(); assert.equal(h.effects.writes, 0); assert.equal(h.effects.published.length, 0);
  }
  const compact = content.buildDistributionPost({ market: 'stocks', channel: 'bluesky', date: '2026-10-13', score: 0, label: 'NEUTRAL',
    content: `REGIME STATUS: ${'A long observation. '.repeat(40)}`, chart: true, previous: { date: '2026-10-12', score: -12 }, overrideActive: true });
  assert.match(compact, /from -12 \(12 Oct\) to 0/); assert.match(compact, /News override active/); assert.match(compact, /\/go\/chart\//);
  assert.equal(content.distributionDestination('bluesky', 'stocks', '2026-10-13', true).pathname, '/today');
  assert.equal(content.distributionDestination('bluesky', 'stocks', '2026-10-13', true).searchParams.get('utm_campaign'), 'mb_chart_distribution_v1');
  console.log('PASS equal chart allocation, real images, source mismatch and safe long-copy alternative');

  const calls = [];
  const NextResponse = { json: (body, init = {}) => ({ body, status: init.status ?? 200, headers: init.headers }), redirect: (url, init) => ({ url, ...init }) };
  const growthCalls = [];
  const mocks = { 'next/server': { NextResponse }, '@/lib/social/distribution-growth': { recordDistributionGrowth: async () => { growthCalls.push(true); return { complete: true }; } }, '@/lib/social/distribution': {
    runDistribution: async options => { calls.push(options); return { ok: true, results: [], mode: options.live && !options.previewBoth ? 'live' : 'preview', scheduledMarkets: ['stocks', 'crypto'] }; }, distributionDeliveryHealth: async () => [],
  } };
  const request = (token, search = '') => ({ headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}), nextUrl: new URL(`https://www.macro-bias.com/api/cron/distribution${search}`) });
  const route = loader(mocks, { CRON_SECRET: 'a-secret', VERCEL_ENV: 'production', DISTRIBUTION_MODE: 'live' })('src/app/api/cron/distribution/route.ts');
  assert.equal((await route.GET(request(null))).status, 401); assert.equal((await route.GET(request('bad'))).status, 401); assert.equal(calls.length, 0);
  await route.GET(request('a-secret', '?preview=1')); assert.equal(calls.at(-1).previewBoth, true);
  assert.equal(growthCalls.length, 0);
  await route.GET(request('a-secret')); assert.equal(growthCalls.length, 1);
  const previewRoute = loader(mocks, { CRON_SECRET: 'a-secret', VERCEL_ENV: 'preview', DISTRIBUTION_MODE: 'live' })('src/app/api/cron/distribution/route.ts');
  await previewRoute.GET(request('a-secret')); assert.equal(calls.at(-1).live, false);
  const disabled = loader(mocks, { CRON_SECRET: 'a-secret', VERCEL_ENV: 'production' })('src/app/api/cron/distribution/route.ts');
  await disabled.GET(request('a-secret')); assert.equal(calls.at(-1).live, false);
  assert.equal(growthCalls.length, 1);
  const redirect = loader(mocks)('src/app/go/[channel]/[market]/[date]/route.ts');
  const response = await redirect.GET({}, { params: Promise.resolve({ channel: 'bluesky', market: 'stocks', date: '2026-10-13' }) });
  assert.equal(response.status, 307); assert.equal(response.headers['X-Robots-Tag'], 'noindex');
  assert.equal(response.url.searchParams.get('utm_source'), 'bluesky');
  console.log('PASS cron authentication and production-only activation');
})().catch(error => { console.error(error); process.exitCode = 1; });
