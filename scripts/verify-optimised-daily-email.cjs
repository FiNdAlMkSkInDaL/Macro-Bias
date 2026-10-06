/** Customer-visible daily email contracts, using actual source with isolated
 * AI/database/provider fixtures. No credentials, external requests or live sends.
 * Run: node scripts/verify-optimised-daily-email.cjs
 * Optional local preview: --preview-dir <absolute directory outside this repo>
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness, signal, cleanCrypto } = require('./verify-readable-briefing-email.cjs');

const matches = [
  { tradeDate: '2026-09-19', distance: 0.1, weight: 1, btcForward1DayReturn: 3, btcForward3DayReturn: 5 },
  { tradeDate: '2026-09-20', distance: 0.2, weight: 1, btcForward1DayReturn: -1, btcForward3DayReturn: -2 },
  { tradeDate: '2026-09-18', distance: 0.3, weight: 1, btcForward1DayReturn: 3.4, btcForward3DayReturn: 6 },
];
const crypto = {
  tradeDate: '2026-10-06', score: 72, label: 'EXTREME_RISK_ON',
  signal: { ...signal, position: 'LONG', size: 0.5, reliability: 'B', neighborAgreement: 2 / 3 },
  modelVersion: 'fixture-model', blendedForwardReturn: 2.52,
  tickerChanges: {
    'BTC-USD': { ticker: 'BTC-USD', tradeDate: '2026-10-06', close: 85786.594, previousClose: 86478.421, percentChange: -0.8 },
    'ETH-USD': { ticker: 'ETH-USD', tradeDate: '2026-10-06', close: 3250.1234, previousClose: 3292.9301, percentChange: -1.3 },
    'SOL-USD': { ticker: 'SOL-USD', tradeDate: '2026-10-06', close: 180.4567, previousClose: 180.8183, percentChange: -0.2 },
  },
  componentScores: ['trendAndMomentum', 'cryptoStructure', 'macroCorrelation', 'volatility'].map((key, index) => ({
    key, pillar: key, weight: index === 2 ? 40 : 20, signal: 0.72, contribution: 18,
    summary: 'Recorded quantitative fixture input.', analogDates: matches.map(item => item.tradeDate),
    analogMatches: matches, averageForward1DayReturn: 1.8, averageForward3DayReturn: 3,
    bearishHitRate1Day: 1 / 3, bearishHitRate3Day: 1 / 3,
  })),
};
const context = {
  scoreDate: crypto.tradeDate, marketDataDate: crypto.tradeDate, generatedAt: '2026-10-07T12:30:00Z',
  previousScore: 60, previousScoreDate: '2026-10-05',
  interpretation: 'The model is strongly positive, while BTC fell and ETH lagged BTC in the completed daily candle.',
  evidence: ['Premium evidence marker: similar-session outcomes support a positive model lean.'],
  historicalContext: 'Premium history marker: 3 unique historical sessions, measured over 1 and 3 days, with mixed outcomes.',
  coverageNote: 'Stablecoin flows and on-chain DeFi activity are not measured.',
};
const providerOptions = {
  now: '2026-10-07T12:30:00Z',
  tables: {
    crypto_bias_scores: [
      { id: 'fixture-current', trade_date: crypto.tradeDate, score: crypto.score, bias_label: crypto.label,
        ticker_changes: crypto.tickerChanges, component_scores: crypto.componentScores,
        engine_inputs: { tradableSignal: crypto.signal, blendedForwardReturn: crypto.blendedForwardReturn, modelVersion: crypto.modelVersion },
        technical_indicators: {}, created_at: '2026-10-07T06:00:00Z' },
      { id: 'fixture-previous', trade_date: '2026-10-05', score: 60, bias_label: 'EXTREME_RISK_ON', engine_inputs: {} },
    ],
    crypto_daily_briefings: [],
    etf_daily_prices: [{ ticker: 'BTC-USD', trade_date: crypto.tradeDate }],
    users: [{ email: 'paid@macro-bias.com', subscription_status: 'active' }],
    free_subscribers: [{ email: 'free@macro-bias.com', status: 'active', tier: 'free', crypto_opted_in: true }],
  },
};
const clone = value => JSON.parse(JSON.stringify(value));
const CONTROL_FIELDS = /\b(?:NO_TRADE|Permission\s*:|Reliability\s+[A-F]\b|rel\s+[A-F]\b|Size\s+\d+%|Model Diagnostics|compressed quant context|this fallback)/i;
function customerReadable(mail) {
  for (const value of [mail.subject, mail.html, mail.text]) assert.equal(CONTROL_FIELDS.test(value), false, 'customer email exposes internal model/processing fields');
}
async function fixtureEmails() {
  const h = harness({ now: '2026-10-07T12:30:00Z' });
  const generated = await h.load('src/lib/crypto-briefing/crypto-brief-generator.ts').generateCryptoDailyBriefing(crypto, { optimised: true });
  const create = h.load('src/lib/marketing/crypto-email-content.ts').createCryptoBriefingEmailContent;
  return {
    generated,
    premium: create(generated.newsletterCopy, crypto.score, crypto.label, 'premium', context, crypto.signal),
    free: create(generated.newsletterCopy, crypto.score, crypto.label, 'free', context, crypto.signal),
  };
}
async function run() {
  let passed = 0;
  const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
  await check('tomorrow means 7 October London time, including the UTC midnight boundary', async () => {
    const enabled = harness().load('src/lib/marketing/daily-email-context.ts').dailyEmailImprovementsEnabled;
    assert.equal(enabled(new Date('2026-10-06T22:59:59Z')), false);
    assert.equal(enabled(new Date('2026-10-06T23:00:00Z')), true);
    assert.equal(enabled(new Date('2026-10-07T12:30:00Z')), true);
  });
  await check('optimised fallback uses measured prices and separates uncovered flows from neutral', async () => {
    const { generated } = await fixtureEmails();
    assert.equal(generated.generatedBy, 'fallback');
    assert.ok(generated.newsletterCopy.includes('85,786.59'));
    assert.ok(generated.newsletterCopy.includes('-0.80%'));
    assert.ok(generated.newsletterCopy.includes('ETH'));
    assert.ok(generated.newsletterCopy.includes('SOL'));
    assert.match(generated.newsletterCopy, /Stablecoins\/Flows[^\n]*(?:Not measured|not measured|unavailable)/);
    assert.ok(!generated.newsletterCopy.includes('No obvious flow disruption'));
    assert.ok(!generated.newsletterCopy.includes('compressed quant context'));
  });
  await check('strong score with falling prices explains confirmation limits without weakening the stored score', async () => {
    const { generated, premium } = await fixtureEmails();
    assert.equal(crypto.score, 72);
    assert.ok(premium.text.includes('EXTREME RISK ON (+72)'));
    assert.match(generated.newsletterCopy, /(?:confirmation|fell|negative|declin|down|lagg|oppos)/i);
    assert.ok(premium.text.includes('Good historical fit'));
    assert.ok(premium.text.includes('not a probability of a gain'));
    customerReadable(premium);
  });
  await check('historical sample counts distinct sessions once across pillars and names both outcome horizons', async () => {
    const build = harness().load('src/lib/crypto-briefing/crypto-brief-generator.ts').buildCryptoEmailEvidence;
    const repeated = { ...crypto, componentScores: crypto.componentScores.map(item => ({ ...item, analogMatches: [...matches, matches[0]] })) };
    const evidence = build(repeated);
    assert.match(evidence.historicalContext, /^3\b[^.]*\bsessions\b/, 'deduplicated sample must contain three historical sessions');
    assert.ok(!/\b12\b[^.]*\bsessions\b/.test(evidence.historicalContext), 'shared pillar neighbours must not be counted four times');
    assert.ok(evidence.historicalContext.includes('+1.80% after one day'));
    assert.ok(evidence.historicalContext.includes('+3.00% after three days'));
    assert.ok(evidence.historicalContext.includes('-1.00% to +3.40%'));
    assert.ok(evidence.historicalContext.includes('-2.00% to +6.00%'));
    assert.match(evidence.historicalContext, /past (?:outcomes|results)[^.]*not[^.]*(?:forecast|predict)/i);
    assert.ok(!evidence.evidence.join(' ').includes('contribution'));
  });
  await check('valid AI copy cannot invent price/flow facts, confidence, historical outcomes or a news override', async () => {
    const invented = cleanCrypto
      .replace('Crypto is in a neutral regime, and the score remains useful context.', 'An invented event makes today an override.')
      .replace('The nearest analog is 2026-09-24.', 'The nearest analog guaranteed a profit of 99%.');
    const h = harness({ aiResponse: { is_override_active: true, newsletter_copy: invented } });
    const generated = await h.load('src/lib/crypto-briefing/crypto-brief-generator.ts').generateCryptoDailyBriefing(crypto, { optimised: true });
    assert.equal(generated.generatedBy, 'anthropic');
    assert.equal(generated.isOverrideActive, false);
    assert.ok(generated.newsletterCopy.includes('85,786.59'));
    assert.match(generated.newsletterCopy, /\b3\b[^.\n]*\bsessions\b/, 'AI prose must retain the deduplicated stored sample');
    assert.ok(!generated.newsletterCopy.includes('guaranteed'));
    assert.ok(!generated.newsletterCopy.includes('invented event'));
    assert.ok(!generated.newsletterCopy.includes('fixture has no flow disruption'));
  });
  await check('HTML and plain text expose score date, price cutoff, actual prior-score delta and dashboard CTA', async () => {
    const { premium, free } = await fixtureEmails();
    for (const mail of [premium, free]) {
      assert.ok(mail.text.includes('Score date: 6 Oct 2026'));
      assert.ok(mail.text.includes('Price data through: 6 Oct 2026 (UTC)'));
      assert.ok(mail.text.includes('Prepared: 7 Oct, 12:30 UTC'));
      assert.ok(mail.text.includes('Change: +12 points since 5 Oct 2026 (+60)'));
      assert.ok(mail.html.includes('https://www.macro-bias.com/crypto/dashboard'));
      assert.ok(mail.text.includes('View dashboard: https://www.macro-bias.com/crypto/dashboard'));
      assert.ok(mail.html.includes('Unsubscribe'));
      assert.ok(mail.text.includes('{{UNSUBSCRIBE_URL}}'));
      customerReadable(mail);
    }
  });
  await check('free preview retains the lead and BTC row without disclosing premium evidence or history', async () => {
    const { premium, free } = await fixtureEmails();
    assert.ok(premium.text.includes('Premium evidence marker'));
    assert.ok(premium.text.includes('Premium history marker'));
    for (const value of [free.html, free.text]) {
      assert.ok(value.includes('Bitcoin'));
      assert.ok(!value.includes('Premium evidence marker'));
      assert.ok(!value.includes('Premium history marker'));
      assert.ok(!value.includes('Altcoins (ETH-led)'));
      assert.ok(value.includes('Explore Pro'));
    }
  });
  await check('weak historical evidence overrides enthusiastic lead and score, with honest missing-price coverage', async () => {
    const weak = { ...crypto, signal: { ...crypto.signal, noTrade: true, position: 'NO_TRADE', reliability: 'F' }, tickerChanges: {} };
    const h = harness();
    const generated = await h.load('src/lib/crypto-briefing/crypto-brief-generator.ts').generateCryptoDailyBriefing(weak, { optimised: true });
    assert.match(generated.newsletterCopy, /historical match is too weak|historical evidence is too weak/);
    assert.match(generated.newsletterCopy, /(?:unavailable|not available|not recorded|not measured)/i);
    assert.ok(!generated.newsletterCopy.includes('still deserves weight'));
    const create = h.load('src/lib/marketing/crypto-email-content.ts').createCryptoBriefingEmailContent;
    const mail = create(generated.newsletterCopy, weak.score, weak.label, 'premium', { ...context, interpretation: 'High conviction today.' }, weak.signal);
    assert.match(mail.text, /historical (?:evidence|match)[^.]*too weak[^.]*(?:rely|trust)/i);
    assert.ok(!mail.text.includes('High conviction today'));
    assert.ok(mail.text.includes('Insufficient historical fit'));
    customerReadable(mail);
  });
  await check('legacy score rows without recorded signal metadata cannot claim measured confidence', async () => {
    const legacy = { ...crypto, signal: { ...signal, reliability: 'C', neighborAgreement: 0, distanceQuality: 0, reason: 'Legacy score without tradable signal metadata.' } };
    const h = harness();
    const generator = h.load('src/lib/crypto-briefing/crypto-brief-generator.ts');
    const evidence = generator.buildCryptoEmailEvidence(legacy);
    const generated = await generator.generateCryptoDailyBriefing(legacy, { optimised: true });
    assert.ok(generated.newsletterCopy.includes('confidence is unavailable'));
    const mail = h.load('src/lib/marketing/crypto-email-content.ts').createCryptoBriefingEmailContent(
      generated.newsletterCopy, 72, legacy.label, 'premium', { ...context, ...evidence }, legacy.signal,
    );
    assert.ok(mail.text.includes('Unavailable for this stored score'));
    assert.ok(!mail.text.includes('Mixed historical fit'));
    assert.ok(!mail.text.includes('agreement 0%'));
    customerReadable(mail);
  });
  await check('stale and invalid individual prices cannot be presented as the current candle', async () => {
    const changed = clone(crypto);
    changed.tickerChanges['BTC-USD'].tradeDate = '2026-10-05';
    changed.tickerChanges['ETH-USD'].close = -1;
    changed.tickerChanges['SOL-USD'].percentChange = NaN;
    const generated = await harness().load('src/lib/crypto-briefing/crypto-brief-generator.ts').generateCryptoDailyBriefing(changed, { optimised: true });
    assert.ok(!generated.newsletterCopy.includes('85,786.59'));
    assert.ok(!generated.newsletterCopy.includes('-1.30%'));
    assert.match(generated.newsletterCopy, /Bitcoin[^\n]*unavailable/);
    assert.match(generated.newsletterCopy, /Altcoins[^\n]*unavailable/);
    assert.match(generated.newsletterCopy, /DeFi\/L1s[^\n]*unavailable/);
  });
  await check('missing, same-day, future and invalid previous snapshots cannot invent a score change', async () => {
    const h = harness();
    const create = h.load('src/lib/marketing/crypto-email-content.ts').createCryptoBriefingEmailContent;
    for (const previous of [
      { previousScore: null }, { previousScoreDate: crypto.tradeDate }, { previousScoreDate: '2026-10-07' },
      { previousScore: NaN }, { previousScoreDate: '2026-02-31' },
    ]) {
      const mail = create(cleanCrypto, 72, crypto.label, 'premium', { ...context, ...previous }, crypto.signal);
      assert.ok(!mail.text.includes('Change:'));
      assert.ok(!mail.html.includes('Change:'));
    }
  });
  await check('newsletter and metadata markup are escaped in HTML while the plain text remains usable', async () => {
    const h = harness();
    const create = h.load('src/lib/marketing/crypto-email-content.ts').createCryptoBriefingEmailContent;
    const untrusted = '<img src=x onerror="globalThis.fixtureInjection=true">';
    const mail = create(cleanCrypto.replace('Crypto is', `${untrusted} Crypto is`), 72, crypto.label, 'premium', {
      ...context, interpretation: untrusted, evidence: [`Evidence ${untrusted}`], historicalContext: untrusted,
    }, crypto.signal);
    assert.ok(!mail.html.includes('<img'));
    assert.ok(mail.html.includes('&lt;img'));
    assert.ok(mail.html.includes('&quot;'));
    assert.ok(mail.text.includes(untrusted));
  });
  await check('real scheduled publisher sends optimised paid/free HTML and text through the isolated provider', async () => {
    const h = harness(clone(providerOptions));
    const result = await h.load('src/app/api/cron/crypto-publish/route.ts').GET({
      headers: { get: key => key === 'authorization' ? 'Bearer fixture-cron-secret' : null },
      nextUrl: new URL('https://www.macro-bias.com/api/cron/crypto-publish'),
    });
    assert.equal(result.status, 200, JSON.stringify({ data: result.data, logs: h.logs }));
    assert.equal(h.sends.length, 2);
    assert.equal(h.writes.length, 1);
    for (const mail of h.sends) {
      assert.ok(mail.subject.includes('+72'));
      assert.ok(mail.text.includes('Score date: 6 Oct 2026'));
      assert.ok(mail.text.includes('Price data through: 6 Oct 2026 (UTC)'));
      assert.ok(mail.text.includes('Change: +12 points since 5 Oct 2026 (+60)'));
      assert.ok(!mail.text.includes('{{UNSUBSCRIBE_URL}}'));
      assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
      assert.ok(mail.headers['List-Unsubscribe']);
      customerReadable(mail);
    }
  });
  await check('stock scheduled publisher uses session metadata and the shared reading layout for both tiers', async () => {
    const h = harness({ now: '2026-10-07T12:30:00Z', tables: {
      macro_bias_scores: [
        { trade_date: '2026-10-06', score: 10, bias_label: 'NEUTRAL', component_scores: [], engine_inputs: { tradableSignal: signal, tradeWindow: { latestTradeDate: '2026-10-06' } }, technical_indicators: {} },
        { trade_date: '2026-10-05', score: 5, bias_label: 'NEUTRAL', component_scores: [], engine_inputs: { tradableSignal: signal }, technical_indicators: {} },
      ], daily_market_briefings: [],
      users: [{ email: 'paid@macro-bias.com', subscription_status: 'active' }],
      free_subscribers: [{ email: 'free@macro-bias.com', status: 'active', tier: 'free', stocks_opted_in: true }],
    }});
    const result = await h.load('src/app/api/cron/publish/route.ts').GET({
      headers: { get: key => key === 'authorization' ? 'Bearer fixture-cron-secret' : null },
      nextUrl: new URL('https://www.macro-bias.com/api/cron/publish'),
    });
    assert.equal(result.status, 200, JSON.stringify({ data: result.data, logs: h.logs }));
    assert.equal(h.sends.length, 2);
    for (const mail of h.sends) {
      assert.ok(mail.text.includes('Session: 6 Oct 2026'));
      assert.ok(mail.text.includes('Price data through: 6 Oct 2026'));
      assert.ok(mail.text.includes('Change: +5 points since 5 Oct 2026 (+5)'));
      assert.ok(mail.html.includes('View dashboard'));
      assert.ok(mail.html.includes('font-size:16px'));
      assert.ok(!mail.text.includes('{{UNSUBSCRIBE_URL}}'));
      customerReadable(mail);
    }
  });
  console.log(`\n${passed} optimised daily email scenarios passed. Actual source; isolated fixtures only.`);
  const previewIndex = process.argv.indexOf('--preview-dir');
  if (previewIndex !== -1) {
    const destination = path.resolve(process.argv[previewIndex + 1] ?? '');
    const root = path.resolve(__dirname, '..');
    assert.ok(path.isAbsolute(process.argv[previewIndex + 1] ?? ''), 'Preview destination must be absolute');
    assert.ok(destination !== root && !destination.startsWith(root + path.sep), 'Preview artifacts must stay outside repo');
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, 'preview-context.txt'), 'Synthetic regression fixtures rendered by the actual email builder. These are test data, not a published score or a prediction. No email was sent.\n');
    const previews = await fixtureEmails();
    for (const tier of ['premium', 'free']) {
      fs.writeFileSync(path.join(destination, `crypto-${tier}.html`), previews[tier].html);
      fs.writeFileSync(path.join(destination, `crypto-${tier}.txt`), previews[tier].text);
    }
    console.log(`Local fixture previews written to ${destination}`);
  }
  return { passed };
}
module.exports = { run, fixtureEmails, crypto, context, providerOptions };
if (require.main === module) run().catch(error => { console.error(error.stack); process.exitCode = 1; });
