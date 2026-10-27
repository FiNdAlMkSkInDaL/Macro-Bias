/** Actual email builders and authenticated route, isolated from all real providers. */
const assert = require('node:assert/strict');
const { harness, signal } = require('./verify-readable-briefing-email.cjs');
const h = harness({ now: '2026-10-28T12:30:00Z' });
const stock = h.load('src/lib/marketing/email-dispatch.ts').createQuantBriefingEmailContent;
const crypto = h.load('src/lib/marketing/crypto-email-content.ts').createCryptoBriefingEmailContent;
const stockRisk = { forecast: { sourceDate: '2026-10-27', targetDate: '2026-10-28', capturedAt: '2026-10-28T09:00:00Z', absoluteMovePct: 0.58, referencePrice: 775.34, version: 'stock-risk-ewma-094-v1' }, notice: null };
for (const tier of ['free', 'premium']) {
  const context = { scoreDate: '2026-10-28', marketDataDate: '2026-10-27', stockRisk };
  const message = stock('', 18, 'NEUTRAL', false, tier, null, signal, context);
  for (const body of [message.html, message.text]) {
    assert.match(body, /Around 0\.58% from open to close/);
    assert.match(body, /28 Oct 2026/); assert.match(body, /27 Oct 2026/);
    assert.match(body, /\$4\.50 per share/);
    assert.match(body, /excludes overnight gaps/); assert.match(body, /actual moves can be larger/);
    assert(!/58% (?:chance|probability)|inputHash|modelHash|shrink_50|riskConstant/.test(body));
  }
  const unavailable = stock('', 18, 'NEUTRAL', false, tier, null, signal, { ...context, stockRisk: { forecast: null, notice: 'The SPY move estimate is temporarily unavailable.' } });
  assert.match(unavailable.text, /temporarily unavailable/); assert(!unavailable.text.includes('Around 0.00%'));
  const c = crypto('', 18, 'NEUTRAL', tier, context, signal);
  assert(!c.text.includes('SPY move estimate'), 'unvalidated crypto risk cannot inherit the stock forecast');
}
const loader = require('./distribution-loader.cjs');
let calls = 0, failureWrites = 0;
const load = loader({
  '@/lib/model-forward/service': { runModelForward: async ({ preview }) => { calls++; return { ok: true, mode: preview ? 'preview' : 'live' }; }, recordForwardFailure: async () => { failureWrites++; } },
  'next/server': { NextResponse: { json: (data, init) => ({ data, ...init }) } },
}, { CRON_SECRET: 'private-fixture-secret', VERCEL_ENV: 'production' });
const route = load('src/app/api/cron/model-forward/route');
const request = (auth, preview = false) => ({ headers: new Headers(auth ? { authorization: auth } : {}), nextUrl: new URL(`https://fixture.invalid/api/cron/model-forward${preview ? '?preview=1' : ''}`) });
(async () => {
  assert.equal((await route.GET(request())).status, 401); assert.equal((await route.GET(request('Bearer wrong'))).status, 401); assert.equal(calls, 0);
  const check = await route.GET(request('Bearer private-fixture-secret', true)); assert.equal(check.data.mode, 'preview');
  assert.equal((await route.GET(request('Bearer private-fixture-secret'))).data.mode, 'live'); assert.equal(failureWrites, 0);
  console.log('PASS Free/Pro stock HTML/plain risk copy, dates, dollar reference, unavailable state, crypto separation and cron authentication/preview gates.');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
