/** Actual scheduler/publisher under isolated API/database fixtures; never posts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loader = require('./distribution-loader.cjs');
const schema = fs.readFileSync(path.join(__dirname, '../supabase/migrations/202604130001_create_marketing_analytics_and_drips.sql'), 'utf8');
const columns = new Set([...schema.match(/create table if not exists public\.marketing_event_log \(([\s\S]*?)\r?\n\);/)[1].matchAll(/^\s+([a-z_]+)\s/gm)].map(m => m[1]));
const stockNow = new Date('2026-10-29T15:00:00Z'), cryptoNow = new Date('2026-10-28T15:00:00Z');
const quote = (ticker, date, change) => ({ ticker, tradeDate: date, close: 100 + change, previousClose: 100, percentChange: change });
function fixture(market, now) {
  const today = now.toISOString().slice(0, 10), prior = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const date = market === 'stocks' ? today : prior;
  return { item: { date, tradeDate: date, publishedAt: `${today}T13:00:00Z`, score: 0, biasLabel: 'NEUTRAL' },
    facts: { trade_date: date, window: { latestTradeDate: prior }, ticker_changes: market === 'stocks'
      ? { SPY: quote('SPY', prior, 1), QQQ: quote('QQQ', prior, 2) }
      : { 'BTC-USD': quote('BTC-USD', prior, 1), 'ETH-USD': quote('ETH-USD', prior, 2) } } };
}
function harness(options = {}) {
  let factReads=0;
  const rows = [], effects = { reads: 0, writes: 0, sends: 0, engagement: 0 };
  const admin = { from() {
    let filters = [], action = 'read', payload, single = false, max = 100;
    const q = { select() { return q; }, eq(k,v) { filters.push(r => r[k] === v); return q; },
      order() { return q; }, limit(n) { max = n; return q; }, maybeSingle() { single = true; return q; },
      insert(v) { action = 'insert'; payload = v; return q; }, update(v) { action = 'update'; payload = v; return q; }, upsert(v) { action = 'upsert'; payload = v; return q; },
      then(resolve,reject) {
        let error = null; let found = rows.filter(r => filters.every(f => f(r)));
        if (action === 'read') { effects.reads++; if (options.failRead) error = {}; }
        if (action !== 'read') {
          for (const key of Object.keys(payload)) assert(columns.has(key), `Unknown event column ${key}`);
          if (options.failClaim && action === 'insert' || options.failFinish && action === 'update') error = {};
          else if (action === 'insert' && rows.some(r => r.id === payload.id)) error = { code: '23505' };
          else {
            effects.writes++;
            if (action === 'update') { if (found[0]) Object.assign(found[0], JSON.parse(JSON.stringify(payload))); }
            else { const old = rows.find(r => r.id === payload.id); if (old) Object.assign(old, JSON.parse(JSON.stringify(payload))); else rows.unshift({ ...JSON.parse(JSON.stringify(payload)), created_at: stockNow.toISOString() }); }
          }
        }
        const data = single ? found[0] ?? null : found.slice(0,max);
        return Promise.resolve({ data,error }).then(resolve,reject);
      } }; return q;
  } };
  const get = async filters => ({ range: { startDate: filters.start, endDate: filters.end }, overview: { newSubscribers: 1, visitors: 2 },
    newsletterSignups: { stocks: 1, crypto: 1, both: 1, unknown: 0 }, attributionContentRows: [{ key: 'stocks_20261029', newSubscribers: 1 }],
    coverage: { complete: !options.partial, warnings: [] } });
  const api = loader({ '@/lib/analytics/acquisition-data': { getAcquisitionReport: get } })('src/lib/social/x-experiment.ts');
  const deps = { admin, archive: async market => ({ items: [fixture(market, options.now ?? stockNow).item], loadError: options.sourceError ? 'SECRET' : null }),
    verifyAccount: async () => { if(options.failAccount) throw new api.XTestError('x_account_mismatch'); },
    facts: async market => options.missingFacts || options.recoverInput && factReads++ === 0 ? null : fixture(market, options.now ?? stockNow).facts,
    publish: async () => { effects.sends++; if (options.failPublish) throw Error('SECRET_PROVIDER_TOKEN'); return '123456789'; },
    engagement: async ids => { effects.engagement++; if (options.noEngagement) throw Error('SECRET'); return ids.map(id => ({ id, impressions: 7, likes: 0, replies: 0, reposts: 0 })); } };
  return { api, deps, effects, rows };
}
(async () => {
  let h = harness(), api = h.api;
  const plan = api.xTestPlan(); assert.equal(plan.length, 8); assert.equal(plan.filter(p => p.market === 'stocks').length, 4); assert.equal(plan.filter(p => p.market === 'crypto').length, 4);
  assert.equal(Date.parse(api.X_TEST.end) - Date.parse(api.X_TEST.start), 14 * 86400000);
  assert.equal(api.xTestMarket(stockNow), 'stocks'); assert.equal(api.xTestMarket(cryptoNow), 'crypto');
  for (const at of ['2026-10-27T15:00:00Z','2026-10-31T15:00:00Z','2026-11-11T15:00:00Z','2026-10-29T16:00:00Z','2026-10-29T14:59:59Z']) assert.equal(api.xTestMarket(new Date(at)), null);
  assert.equal(api.xTestMarket(new Date('2026-10-29T15:30:00Z')), 'stocks');
  for (const [market,now] of [['stocks',stockNow],['crypto',cryptoNow]]) {
    const f = fixture(market,now), post = api.buildXTestPost(market,[f.item],f.facts,now), url = new URL(post.trackedUrl);
    assert.equal(url.searchParams.get('utm_campaign'), api.X_TEST.id); assert.equal(url.searchParams.get('utm_content'), post.contentId);
    assert.equal(url.pathname, `${market === 'stocks' ? '/briefings' : '/crypto/briefings'}/${f.item.date}`);
    assert(!/model readings|no clear directional|buy now/i.test(post.text)); assert(post.text.length-url.href.length+23<=280);
    assert.throws(() => api.buildXTestPost(market,[{ ...f.item, publishedAt:'2099-01-01T13:00:00Z' }],f.facts,now));
    assert.throws(() => api.buildXTestPost(market,[f.item],null,now));
  }
  await api.runXTest({live:true,preview:true,now:stockNow,deps:h.deps}); assert.equal(h.effects.writes,0); assert.equal(h.effects.sends,0);
  await api.runXTest({now:stockNow,deps:h.deps}); assert.equal(h.effects.writes,0);
  const results = await Promise.allSettled([1,2,3].map(()=>api.publishXTest('stocks',stockNow,h.deps)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1); assert.equal(h.effects.sends,1);
  assert.equal((await api.publishXTest('stocks',stockNow,h.deps)).status,'already_published'); assert.equal(h.effects.sends,1);
  assert.equal(h.rows[0].metadata.traffic_type,'internal'); assert.equal(h.rows[0].metadata.status,'published');
  for (const options of [{failPublish:true},{failFinish:true}]) {
    h=harness(options); await assert.rejects(h.api.publishXTest('stocks',stockNow,h.deps),/publication_outcome_needs_review/);
    await assert.rejects(h.api.publishXTest('stocks',stockNow,h.deps),/previous_outcome_needs_review/); assert.equal(h.effects.sends,1);
  }
  for (const options of [{failRead:true},{failClaim:true},{missingFacts:true},{sourceError:true},{failAccount:true}]) {
    h=harness(options); await assert.rejects(h.api.publishXTest('stocks',stockNow,h.deps)); assert.equal(h.effects.sends,0);
  }
  h=harness(); const run=await h.api.runXTest({live:true,now:stockNow,deps:h.deps}); assert.equal(run.ok,true); assert.equal(h.effects.sends,1); assert.equal(run.growth.first.newsletters.both,1);
  await h.api.runXTest({live:true,now:new Date('2026-10-29T15:30:00Z'),deps:h.deps}); assert.equal(h.effects.sends,1); assert.equal(h.effects.engagement,1);
  const writes=h.effects.writes; await h.api.runXTest({live:true,now:new Date(h.api.X_TEST.finalCheckpointEnd),deps:h.deps}); assert.equal(h.effects.writes,writes);
  h=harness({recoverInput:true}); const recovered=await h.api.runXTest({live:true,now:stockNow,deps:h.deps}); assert.equal(recovered.result.attempts,2); assert.equal(h.effects.sends,1); assert.equal(recovered.ok,true);
  h=harness({failPublish:true}); const uncertain=await h.api.runXTest({live:true,now:stockNow,deps:h.deps}); assert.equal(uncertain.result.attempts,1); assert.equal(h.effects.sends,1); assert.equal(uncertain.ok,false);
  h=harness({partial:true,noEngagement:true}); const partial=await h.api.runXTest({live:true,now:stockNow,deps:h.deps});
  assert.equal(partial.ok,false); assert.equal(partial.growth.first.metrics,null); assert.equal(partial.growth.first.newsletters,null); assert.equal(partial.growth.engagement.posts,null);
  let invoked=0; const base={VERCEL_ENV:'production',X_COMMENTARY_MODE:'live',CRON_SECRET:'fixture'};
  const route=(env)=>loader({'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@/lib/social/x-experiment':{runXTest:async options=>{invoked++;return{ok:true,...options};}}},env)('src/app/api/cron/x-test/route.ts');
  const req=(auth,query='')=>({headers:new Headers(auth?{authorization:`Bearer ${auth}`} : {}),nextUrl:new URL(`https://fixture.invalid/api/cron/x-test${query}`)});
  assert.equal((await route(base).GET(req(null))).status,401); assert.equal(invoked,0);
  assert.equal((await route(base).GET(req('wrong'))).status,401); assert.equal(invoked,0);
  assert.equal((await route({...base,VERCEL_ENV:'preview'}).GET(req('fixture'))).body.live,false);
  assert.equal((await route({...base,X_COMMENTARY_MODE:''}).GET(req('fixture'))).body.live,false);
  assert.equal((await route(base).GET(req('fixture','?preview=1'))).body.preview,true);
  assert.equal((await route(base).GET(req('fixture'))).body.live,true);
  const acquisition=loader()('src/lib/analytics/acquisition-data.ts');
  for(const name of [api.X_TEST.deliveryEvent,api.X_TEST.runEvent,api.X_TEST.growthEvent]) assert(!acquisition.ACQUISITION_EVENT_NAMES.includes(name));
  const React=require('react'), {renderToStaticMarkup}=require('react-dom/server');
  let owner=false, privateReads=0;
  const page=loader({'react/jsx-runtime':require('react/jsx-runtime'),'next/link':({children,...props})=>React.createElement('a',props,children),
    '../analytics.module.css':{},'@/lib/analytics/admin-access':{getAnalyticsAdminUser:async()=>owner?{id:'fixture-owner'}:null},
    '@/lib/social/x-experiment':{xTestReport:async()=>{privateReads++;return{capturedAt:'2026-10-27T15:00:00Z',phase:'before_start',experiment:api.X_TEST,
      first:{range:{startDate:'2026-10-27'},complete:true,metrics:{newSubscribers:1},newsletters:{stocks:1,crypto:1,both:1,unknown:0},posts:[{key:'stocks_20261029',newSubscribers:1}],coverage:{warnings:[]}},
      latestAssist:{metrics:{newSubscribers:0,paidConversions:0}},plan,deliveries:[{date:'2026-10-29',market:'stocks',status:'published',remote_id:'123456789'}],runs:[],latestCheckpoint:null};}},
  },base)('src/app/analytics/x-test/page.tsx');
  assert.match(renderToStaticMarkup(await page.default()),/Owner analytics/); assert.equal(privateReads,0);
  owner=true; const markup=renderToStaticMarkup(await page.default()); assert.equal(privateReads,1);
  assert.match(markup,/x\.com\/macro_bias\/status\/123456789/); assert.match(markup,/setup baseline counts/);
  assert.match(markup,/start=2026-10-27/); assert.match(markup,/Unavailable/);
  console.log('PASS X test: eight balanced slots, UTC expiry, bounded recovery, fresh useful copy, tracked dated destinations, read-only preview, atomic delivery, uncertain-send hold, incomplete analytics, engagement gaps, cron gates and acquisition exclusions');
})().catch(e=>{console.error(e);process.exitCode=1;});
