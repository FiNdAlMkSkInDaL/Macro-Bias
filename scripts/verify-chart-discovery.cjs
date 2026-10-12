/** Isolated checks: no provider calls, emails, subscriptions or database writes. */
const assert = require('node:assert/strict');
const loader = require('./distribution-loader.cjs');
const NOW = Date.parse('2026-10-13T14:20:00Z');
const publication = (date, score, extra = {}) => ({ date, tradeDate: date, score, biasLabel: 'NEUTRAL', publishedAt: `${date}T12:30:00Z`, freeAvailableAt: null, ...extra });
const stock = [publication('2026-10-13', 12), publication('2026-10-12', -8)];
const crypto = [publication('2026-10-12', 19, { overrideActive: true }), publication('2026-10-11', 8)];
const chart = loader()('src/lib/social/chart-content.ts');

(async () => {
  const value = chart.buildPublishedChart('stocks', '2026-10-13', [...stock,
    publication('2026-10-14', 40), publication('2026-10-10', 999), publication('2026-10-09', 1, { publishedAt: null }),
    publication('2026-10-08', 4, { publishedAt: '2026-10-14T12:00:00Z' })], NOW);
  assert.equal(value.points.length, 2); assert.equal(value.points[0].score, -8); assert.equal(value.score, 12);
  assert.match(value.alt, /Fixed scale -100 to \+100/);
  assert.equal(chart.buildPublishedChart('stocks', '2026-10-14', [publication('2026-10-14', 40)], NOW), null);
  assert.equal(chart.buildPublishedChart('stocks', '2026-02-30', stock, NOW), null);
  assert.equal(chart.buildPublishedChart('stocks', '2026-10-13', [publication('2026-10-13', null)], NOW), null);
  assert.equal(chart.buildPublishedChart('stocks', '2026-10-13', [publication('2026-10-13', 0, { biasLabel: '<bad>' })], NOW), null);
  assert.match(chart.buildPublishedChart('crypto', '2026-10-12', crypto, NOW).alt, /News override active/);
  const lots = Array.from({ length: 60 }, (_, index) => publication(new Date(Date.UTC(2026, 7, index + 1)).toISOString().slice(0, 10), index));
  assert.equal(chart.buildPublishedChart('stocks', lots.at(-1).date, lots, NOW).points.length, 30);
  console.log('PASS chart dates, actual numeric readings, missing/future rejection, override and bounded history');

  let failed = false;
  const archiveModule = { loadPaidBriefingArchive: async asset => ({ items: (asset === 'stocks' ? stock : crypto).map(item => ({ ...item, date: item.date.replace('2026', '2020'), tradeDate: item.tradeDate.replace('2026', '2020'), publishedAt: item.publishedAt.replace('2026', '2020') })), loadError: failed ? 'unavailable' : null }) };
  const load = loader({
    '@/lib/product/paid-briefing-data': archiveModule,
    './paid-briefing-data': archiveModule,
    '@/lib/server-env': { getAppUrl: () => 'https://www.macro-bias.com' },
    '@/lib/regime/regime-data': { ALL_REGIME_SLUGS: ['neutral', 'risk-on', 'risk-off'] },
    '@/lib/marketing/markdown-parser': { getAllMarketingPosts: async () => [{ slug: 'existing-explainer' }] },
  });
  const feed = load('src/lib/product/briefing-feed.ts');
  const both = await feed.loadBriefingFeed();
  assert.equal(both.items.length, 4);
  assert.equal(both.items.filter(item => item.tags[0] === 'stocks').length, 2);
  assert.equal((await feed.loadBriefingFeed('crypto')).items.length, 2);
  assert.ok(both.items.every(item => item.image.includes('/charts/') && !JSON.stringify(item).includes('brief_content')));
  assert.ok(both.items.every(item => new URL(item.url).searchParams.get('utm_campaign') === 'mb_briefing_feed_v1' && !item.id.includes('?')));
  const rss = load('src/app/feed.xml/route.ts');
  const response = await rss.GET(new Request('https://www.macro-bias.com/feed.xml?market=crypto'));
  const xml = await response.text();
  assert.match(xml, /media:content/); assert.match(xml, /charts\/crypto/); assert.ok(!xml.includes('charts/stocks'));
  assert.equal((await rss.GET(new Request('https://www.macro-bias.com/feed.xml?market=bad'))).status, 400);
  const sitemap = await load('src/app/sitemap.ts').default();
  for (const path of ['/today', '/crypto', '/briefings', '/crypto/briefings', '/briefings/2020-10-13', '/crypto/briefings/2020-10-12', '/intel/existing-explainer', '/regime/neutral']) assert.ok(sitemap.some(item => item.url.endsWith(path)), path);
  assert.ok(!sitemap.some(item => /\/login$|\/api\/|\/analytics|\/charts\//.test(item.url)));
  assert.equal(sitemap.find(item => item.url.endsWith('/today')).lastModified, undefined);
  assert.equal(sitemap.find(item => item.url.endsWith('/briefings/2020-10-13')).lastModified, stock[0].publishedAt.replace('2026', '2020'));
  failed = true;
  await assert.rejects(feed.loadBriefingFeed()); await assert.rejects(load('src/app/sitemap.ts').default());
  console.log('PASS balanced image feeds, discovery URLs, publication timestamps and outage handling');

  const effects = { uploads: [], posts: [] };
  class Agent {
    async login() {}
    async uploadBlob(data, options) { effects.uploads.push({ data, options }); return { data: { blob: { ref: 'fixture-blob' } } }; }
    async post(post) { effects.posts.push(post); return { uri: 'fixture:post' }; }
  }
  class RichText {
    constructor({ text }) { this.text = text; this.graphemeLength = [...new Intl.Segmenter().segment(text)].length; }
    async detectFacets() { this.facets = []; }
  }
  const bluesky = loader({ '@atproto/api': { AtpAgent: Agent, RichText } }, { BLUESKY_IDENTIFIER: 'fixture', BLUESKY_APP_PASSWORD: 'fixture-only' })('src/lib/social/bluesky.ts');
  const image = { data: new Uint8Array([137, 80, 78, 71]), alt: 'Published model readings, fixed scale.', url: 'https://www.macro-bias.com/charts/stocks/2026-10-12' };
  await bluesky.publishToBluesky('A complete observation and limitation.', image);
  assert.equal(effects.uploads[0].options.encoding, 'image/png');
  assert.equal(effects.posts[0].embed.$type, 'app.bsky.embed.images');
  assert.equal(effects.posts[0].embed.images[0].alt, image.alt); assert.equal(effects.posts[0].embed.images[0].aspectRatio.width, 1200);
  await assert.rejects(bluesky.publishToBluesky('x'.repeat(400), image));
  assert.equal(effects.posts.length, 1); assert.equal(effects.uploads.length, 1);
  console.log('PASS Bluesky image upload, embed, alt text and refusal to truncate chart captions');

  let subscriptions = 0;
  const subscribe = loader({
    '@/lib/analytics/server': { logMarketingEvent: async () => {} },
    '@/lib/analytics/conversions': { recordSubscriberAcquisition: async () => {} },
    '@/lib/marketing/welcome-drip': { enrollSubscriberInWelcomeDrip: async () => {}, dispatchPendingWelcomeDripEmails: async () => {} },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => { subscriptions++; throw new Error('No writes permitted'); } },
  })('src/app/api/subscribe/route.ts');
  const denied = await subscribe.POST(new Request('https://www.macro-bias.com/api/subscribe', { method: 'POST', body: JSON.stringify({ email: 'reader@customer.net', stocksOptedIn: false, cryptoOptedIn: false }) }));
  assert.equal(denied.status, 400); assert.equal(subscriptions, 0);
  console.log('PASS newsletter choice enforced before any subscription or welcome email');

  let complete = true;
  const checkpoints = new Map();
  const checkpointAdmin = { from: () => ({ upsert: async row => { checkpoints.set(row.id, row); return { error: null }; } }) };
  const growth = loader({
    '@/lib/analytics/acquisition-data': { getAcquisitionReport: async filters => {
      assert.equal(filters.campaign, 'mb_chart_distribution_v1'); assert.equal(filters.touch, 'first');
      return { range: {}, overview: { newSubscribers: 1 }, newsletterSignups: { stocks: 1, crypto: 0, both: 0, unknown: 0 }, sourceRows: [], coverage: { complete, warnings: [] } };
    } },
  })('src/lib/social/distribution-growth.ts');
  await growth.recordDistributionGrowth(new Date(NOW), checkpointAdmin);
  await growth.recordDistributionGrowth(new Date(NOW + 1000), checkpointAdmin);
  assert.equal(checkpoints.size, 1);
  assert.equal([...checkpoints.values()][0].metadata.metrics.newSubscribers, 1);
  complete = false;
  const partial = await growth.recordDistributionGrowth(new Date(NOW + 86_400_000), checkpointAdmin);
  assert.equal(partial.metrics, null); assert.equal(partial.newsletters, null); assert.equal(checkpoints.size, 2);
  assert.ok([...checkpoints.values()].every(row => row.metadata.traffic_type === 'internal' && !row.subscriber_email));
  console.log('PASS hosted aggregate checkpoints, per-day deduplication and unknown partial data');
})().catch(error => { console.error(error); process.exitCode = 1; });
