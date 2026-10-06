/** Editorial policy and factual/provenance contracts for actual email source.
 * This cannot measure authentic human authorship; it checks supported content,
 * bounded copy, missing-data honesty and delivery-visible invariants instead.
 * No credentials, network requests or real sends. Optional --preview-dir must
 * point to an absolute directory outside this checkout.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness, quant, news, signal, cleanStock, cleanCrypto } = require('./verify-readable-briefing-email.cjs');
const { crypto: cryptoFixture } = require('./verify-optimised-daily-email.cjs');

const NOW = '2026-10-07T12:30:00Z';
const clone = value => JSON.parse(JSON.stringify(value));
const PRIVATE_FIELDS = /\b(?:NO_TRADE|Permission\s*:|Reliability\s+[A-F]\b|rel\s+[A-F]\b|Size\s+\d+%|Model Diagnostics|compressed quant context|this fallback)/i;
const FAKE_PERSONAL_EXPERIENCE = /\b(?:I (?:bought|sold|traded|felt|watched)|my (?:portfolio|position|trade)|we (?:watched|felt|spoke|bought|sold)|our (?:personal|own) (?:position|trade|portfolio))\b/i;

function section(copy, heading) {
  const headers = /^(REGIME STATUS|TRADING IMPLICATION|BASE SCORE|WHY IT MATTERS|MODEL CONTEXT|MARKET MAP|RISK FRAME)(?:[ \t]*:[ \t]*(.*))?[ \t]*$/gm;
  const found = [...copy.matchAll(headers)];
  const index = found.findIndex(item => item[1] === heading);
  if (index < 0) return '';
  return [found[index][2] ?? '', copy.slice(found[index].index + found[index][0].length, found[index + 1]?.index ?? copy.length)].join('\n').trim();
}
const sentences = value => value.split(/(?<=[.!?])\s+/).map(item => item.trim()).filter(Boolean).length;
const occurrences = (value, needle) => value.split(needle).length - 1;
const readableHtml = value => value.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')
  .replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'")
  .replace(/\s+/g, ' ');

function withCryptoRisk(copy, risk) {
  const candidate = copy.replace(/(^RISK FRAME\n)[\s\S]*?(?=\nMODEL CONTEXT)/m, (_, heading) => `${heading}${risk}\n`);
  assert.ok(candidate.includes(risk), 'the AI risk fixture must actually contain the injected candidate');
  return candidate;
}

function customerInvariants(mail, market, score) {
  const signed = score > 0 ? `+${score}` : `${score}`;
  assert.ok(mail.subject.includes(`(${signed})`), 'subject must retain the supplied score');
  assert.ok(mail.text.includes(`(${signed})`), 'plain text must retain the supplied score');
  assert.ok(readableHtml(mail.html).includes(`(${signed})`), 'HTML must retain the supplied score');
  for (const value of [mail.subject, mail.text, readableHtml(mail.html)]) {
    assert.equal(PRIVATE_FIELDS.test(value), false, 'email leaks processing or model controls');
    assert.equal(FAKE_PERSONAL_EXPERIENCE.test(value), false, 'email invents personal experience');
  }
  assert.equal(occurrences(mail.html, '>View dashboard</a>'), 1, 'one primary dashboard button');
  assert.equal(occurrences(mail.text, 'View dashboard:'), 1, 'one plain-text dashboard action');
  const dashboard = `https://www.macro-bias.com/${market === 'crypto' ? 'crypto/' : ''}dashboard`;
  assert.ok(mail.html.includes(dashboard));
  assert.ok(mail.text.includes(dashboard));
  assert.ok(mail.html.includes('Unsubscribe'));
  assert.equal(occurrences(mail.text, '{{UNSUBSCRIBE_URL}}'), 1);
}

const cryptoCases = [
  { name: 'positive-score-falling-price', score: 72, label: 'EXTREME_RISK_ON', move: -0.8 },
  { name: 'negative-score-rising-price', score: -58, label: 'EXTREME_RISK_OFF', move: 1.27 },
  { name: 'zero-score', score: 0, label: 'NEUTRAL', move: 0.18 },
  { name: 'missing-price', score: 37, label: 'RISK_ON', missing: true },
  { name: 'stale-price', score: -27, label: 'RISK_OFF', stale: true },
  { name: 'weak-historical-fit', score: 72, label: 'EXTREME_RISK_ON', move: -0.8, weak: true },
  { name: 'legacy-confidence', score: 37, label: 'RISK_ON', move: -0.37, legacy: true },
];

function cryptoInput(testCase) {
  const input = clone(cryptoFixture);
  input.score = testCase.score;
  input.label = testCase.label;
  if (testCase.missing) input.tickerChanges = {};
  if (testCase.stale) for (const quote of Object.values(input.tickerChanges)) quote.tradeDate = '2026-10-05';
  if (testCase.move != null) input.tickerChanges['BTC-USD'].percentChange = testCase.move;
  if (testCase.weak) Object.assign(input.signal, { noTrade: true, position: 'NO_TRADE', reliability: 'F' });
  if (testCase.legacy) Object.assign(input.signal, { reliability: 'C', neighborAgreement: 0, distanceQuality: 0,
    reason: 'Legacy score without tradable signal metadata.' });
  return input;
}

async function cryptoPreviews(testCase) {
  const input = cryptoInput(testCase);
  const h = harness({ now: NOW });
  const generator = h.load('src/lib/crypto-briefing/crypto-brief-generator.ts');
  const generated = await generator.generateCryptoDailyBriefing(input, { optimised: true });
  const evidence = generator.buildCryptoEmailEvidence(input);
  const context = { scoreDate: input.tradeDate, marketDataDate: input.tradeDate, generatedAt: NOW,
    previousScore: testCase.score - 3, previousScoreDate: '2026-10-05', ...evidence };
  const create = h.load('src/lib/marketing/crypto-email-content.ts').createCryptoBriefingEmailContent;
  const result = { input, generated, context, premium: create(generated.newsletterCopy, input.score, input.label, 'premium', context, input.signal),
    free: create(generated.newsletterCopy, input.score, input.label, 'free', context, input.signal) };
  assert.equal(h.sends.length, 0);
  assert.equal(h.writes.length, 0);
  return result;
}

const stockCases = [
  { name: 'positive-score', score: 38, label: 'RISK_ON' },
  { name: 'negative-score', score: -42, label: 'RISK_OFF' },
  { name: 'zero-score', score: 0, label: 'NEUTRAL' },
  { name: 'weak-historical-fit', score: 38, label: 'RISK_ON', weak: true },
  { name: 'missing-news', score: -42, label: 'RISK_OFF', missingNews: true },
  { name: 'headline-override', score: 38, label: 'RISK_ON', override: true },
];

async function stockPreviews(testCase) {
  const h = harness({ now: NOW });
  const q = { ...clone(quant), tradeDate: '2026-10-06', score: testCase.score, label: testCase.label,
    signal: { ...signal, ...(testCase.weak ? { noTrade: true, position: 'NO_TRADE', reliability: 'F' } : {}) },
    publishedScoreContext: { averageForward1DayReturn: 0.37, averageForward3DayReturn: -0.21, blendedForwardReturn: 0.16,
      componentSummaries: ['SPY RSI is 51.7. HYG/TLT percentile is 42.1.'], marketDataDate: '2026-10-06' } };
  const n = testCase.missingNews ? { status: 'unavailable', disclaimer: 'The news feed is unavailable.', headlines: [], summary: '' }
    : { ...clone(news), ...(testCase.override ? { headlines: ['Fixture headline: bank collapse triggers emergency action.'],
      summary: 'Fixture headline: bank collapse triggers emergency action.' } : {}) };
  const generated = await h.load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext(q, n);
  const snapshot = { trade_date: q.tradeDate, score: q.score, bias_label: q.label,
    component_scores: [{ summary: q.publishedScoreContext.componentSummaries.join(' '), averageForward1DayReturn: 0.37,
      averageForward3DayReturn: -0.21, analogMatches: [{ tradeDate: '2026-09-24', spyForward1DayReturn: 0.33 }] }],
    engine_inputs: { tradeWindow: { latestTradeDate: q.tradeDate }, tradableSignal: q.signal }, technical_indicators: {} };
  const context = h.load('src/lib/marketing/daily-email-context.ts').buildStockEmailContext(generated, snapshot,
    { trade_date: '2026-10-05', score: q.score - 2 });
  const create = h.load('src/lib/marketing/email-dispatch.ts').createQuantBriefingEmailContent;
  assert.equal(h.sends.length, 0);
  assert.equal(h.writes.length, 0);
  return { input: q, generated, context,
    premium: create(generated.newsletterCopy, q.score, q.label, generated.isOverrideActive, 'premium', null, q.signal, context),
    free: create(generated.newsletterCopy, q.score, q.label, generated.isOverrideActive, 'free', null, q.signal, context) };
}

async function run() {
  let passed = 0;
  const previews = [];
  const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
  await check('both future prompts include the shared editorial policy and labelled factual examples', async () => {
    const stockHarness = harness({ now: NOW });
    const cryptoHarness = harness({ now: NOW });
    const shared = stockHarness.load('src/lib/briefing/editorial-voice.ts').DAILY_EMAIL_EDITORIAL_VOICE;
    await stockHarness.load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext(quant, news);
    await cryptoHarness.load('src/lib/crypto-briefing/crypto-brief-generator.ts').generateCryptoDailyBriefing(cryptoFixture, { optimised: true });
    assert.ok(stockHarness.aiRequests.length > 0 && cryptoHarness.aiRequests.length > 0);
    for (const request of [...stockHarness.aiRequests, ...cryptoHarness.aiRequests]) {
      assert.ok(request.system.includes(shared));
      assert.match(request.system, /STYLE EXAMPLES ONLY/);
      assert.match(request.system, /never reuse their figures, dates or claims/);
    }
  });
  for (const testCase of cryptoCases) await check(`crypto ${testCase.name}: grounded bounded lead and tier-safe customer output`, async () => {
    const result = await cryptoPreviews(testCase);
    const lead = section(result.generated.newsletterCopy, 'REGIME STATUS');
    assert.ok(sentences(lead) >= 1 && sentences(lead) <= 3, 'lead must contain one to three sentences');
    assert.equal(result.input.score, testCase.score);
    for (const tier of ['premium', 'free']) customerInvariants(result[tier], 'crypto', testCase.score);
    if (testCase.move != null) {
      const change = `${Math.abs(testCase.move).toFixed(2)}%`;
      for (const value of [result.premium.text, readableHtml(result.premium.html)]) {
        assert.ok(value.includes(change), 'actual BTC move magnitude must remain available');
        const amount = change.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const move = testCase.move < 0
          ? `(?:\\b(?:fell|declined|down)\\s*(?:by\\s*)?-?${amount}|-${amount})`
          : `(?:\\b(?:rose|gained|up)\\s*(?:by\\s*)?\\+?${amount}|\\+${amount})`;
        // Currency decimal points are not sentence boundaries. Bind the direction
        // to BTC and the supplied move magnitude, rather than any signed number.
        const observation = new RegExp(`\\bBTC\\b[^\\n]{0,160}${move}`, 'i');
        assert.match(value, observation, 'BTC observation must retain the supplied move direction and amount');
      }
    }
    if (testCase.name === 'positive-score-falling-price') {
      assert.match(lead, /\bup\b|positive|bullish|risk.on/i, 'positive model direction is explicit');
      assert.match(lead, /fell|declin|down|against/i, 'opposing price move is explicit');
    }
    if (testCase.name === 'negative-score-rising-price') {
      assert.match(lead, /\bdown\b|lower|negative|bearish|risk.off/i, 'negative model direction is explicit');
      assert.match(lead, /rose|ris|\bup\b|gain/i, 'opposing price move is explicit');
    }
    if (testCase.missing || testCase.stale) {
      assert.match(result.premium.text, /not available|unavailable|not recorded/i);
      assert.ok(!result.premium.text.includes('85,786.59'), 'missing/stale quote must not be presented as current');
    }
    if (testCase.weak) assert.match(lead, /weak|insufficient|unreliable|cannot rely|can't rely|too poor/i);
    if (testCase.legacy) {
      assert.match(result.premium.text, /unavailable for this stored score/i);
      assert.ok(!result.premium.text.includes('agreement 0%'));
    }
    if (testCase.score === 0) assert.match(lead, /no direction|no directional|little direction|neutral/i);
    previews.push({ market: 'crypto', name: testCase.name, ...result });
  });
  for (const testCase of stockCases) await check(`stocks ${testCase.name}: score/news provenance and tier-safe customer output`, async () => {
    const result = await stockPreviews(testCase);
    const lead = section(result.generated.newsletterCopy, 'REGIME STATUS');
    assert.ok(sentences(lead) >= 1 && sentences(lead) <= 3, 'lead must contain one to three sentences');
    assert.equal(result.generated.quant.score, testCase.score);
    for (const tier of ['premium', 'free']) customerInvariants(result[tier], 'stocks', testCase.score);
    if (testCase.missingNews) {
      assert.equal(result.generated.news.status, 'unavailable');
      assert.match(result.premium.text, /news.*unavailable|news.*not.*assess/i);
      assert.equal(result.generated.isOverrideActive, false);
    }
    if (testCase.override) {
      assert.equal(result.generated.isOverrideActive, true);
      assert.match(result.premium.subject, /override/i);
      assert.match(result.premium.text, /override active/i);
    }
    if (testCase.weak) assert.match(result.premium.text, /weak|insufficient|cannot rely|can't rely|too poor/i);
    if (testCase.score === 0) assert.match(lead, /no direction|no directional|little direction|neutral/i);
    previews.push({ market: 'stocks', name: testCase.name, ...result });
  });
  await check('both AI parsers accept one-, two- and three-sentence leads without fixed opening slogans', async () => {
    const leads = ['The latest observations are mixed.', 'The latest observations are mixed. The supplied score is unchanged.',
      'The latest observations are mixed. The supplied score is unchanged. There is no new catalyst in these inputs.'];
    for (const [market, base, fixture] of [['stocks', cleanStock, quant], ['crypto', cleanCrypto, cryptoFixture]]) {
      for (const lead of leads) {
        const copy = base.replace(/REGIME STATUS\n[^\n]+/, `REGIME STATUS\n${lead}`);
        const h = harness({ now: NOW, aiResponse: { is_override_active: false, newsletter_copy: copy } });
        const result = market === 'stocks'
          ? await h.load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext(fixture, news)
          : await h.load('src/lib/crypto-briefing/crypto-brief-generator.ts').generateCryptoDailyBriefing(fixture, { optimised: true });
        assert.equal(result.generatedBy, 'anthropic', `${market} rejected ${sentences(lead)}-sentence lead: ${result.warnings}`);
      }
    }
  });
  await check('AI lead length stays bounded rather than accepting an empty or overlong introduction', async () => {
    for (const [market, base, fixture] of [['stocks', cleanStock, quant], ['crypto', cleanCrypto, cryptoFixture]]) {
      for (const lead of ['', 'First observation. Second observation. Third observation. Fourth observation.']) {
        const copy = base.replace(/REGIME STATUS\n[^\n]+/, `REGIME STATUS\n${lead}`);
        const h = harness({ now: NOW, aiResponse: { is_override_active: false, newsletter_copy: copy } });
        const result = market === 'stocks'
          ? await h.load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext(fixture, news)
          : await h.load('src/lib/crypto-briefing/crypto-brief-generator.ts').generateCryptoDailyBriefing(fixture, { optimised: true });
        assert.equal(result.generatedBy, 'fallback', `${market} accepted an empty or overlong lead`);
      }
    }
  });
  await check('crypto risk prose cannot inject unsupplied figures, invented headlines or false personal trades', async () => {
    const h = harness({ now: NOW, aiResponse: { is_override_active: true,
      newsletter_copy: withCryptoRisk(cleanCrypto,
        'I bought BTC at $99,999.99 after the emergency rate cut. ETH gained 99.99%, so a profit is guaranteed.') } });
    const generator = h.load('src/lib/crypto-briefing/crypto-brief-generator.ts');
    const generated = await generator.generateCryptoDailyBriefing(cryptoFixture, { optimised: true });
    const context = { scoreDate: cryptoFixture.tradeDate, marketDataDate: cryptoFixture.tradeDate, ...generator.buildCryptoEmailEvidence(cryptoFixture) };
    const mail = h.load('src/lib/marketing/crypto-email-content.ts').createCryptoBriefingEmailContent(generated.newsletterCopy,
      cryptoFixture.score, cryptoFixture.label, 'premium', context, cryptoFixture.signal);
    assert.equal(generated.isOverrideActive, false, 'no crypto news feed was supplied');
    for (const value of [mail.text, readableHtml(mail.html)]) {
      assert.ok(!value.includes('99,999.99'));
      assert.ok(!value.includes('99.99%'));
      assert.ok(!value.includes('emergency rate cut'));
      assert.ok(!value.includes('profit is guaranteed'));
    }
    customerInvariants(mail, 'crypto', cryptoFixture.score);
  });
  await check('crypto risk prose rejects invented personal experience even without made-up numbers', async () => {
    const h = harness({ now: NOW, aiResponse: { is_override_active: false,
      newsletter_copy: withCryptoRisk(cleanCrypto, 'I watched BTC all night. My position is up.') } });
    const generated = await h.load('src/lib/crypto-briefing/crypto-brief-generator.ts').generateCryptoDailyBriefing(cryptoFixture, { optimised: true });
    assert.equal(FAKE_PERSONAL_EXPERIENCE.test(generated.newsletterCopy), false);
    assert.ok(!generated.newsletterCopy.includes('all night'));
  });
  await check('a conditional cue cannot disguise an invented crypto team trade or observation', async () => {
    const h = harness({ now: NOW, aiResponse: { is_override_active: false,
      newsletter_copy: withCryptoRisk(cleanCrypto,
        'We watched **BTC** and **ETH** from our own position, which would support the reading.') } });
    const generated = await h.load('src/lib/crypto-briefing/crypto-brief-generator.ts').generateCryptoDailyBriefing(cryptoFixture, { optimised: true });
    assert.equal(FAKE_PERSONAL_EXPERIENCE.test(generated.newsletterCopy), false);
    assert.ok(!generated.newsletterCopy.includes('own position'));
  });
  await check('stock commentary cannot add unsupplied returns or personal trades when no override is requested', async () => {
    for (const injected of ['SPY gained 99.99% after one day. A gain is guaranteed.',
      'I bought SPY in my portfolio. My position is up.', 'We watched SPY all night. Our own position is up.']) {
      const h = harness({ now: NOW, aiResponse: { is_override_active: false,
        newsletter_copy: cleanStock.replace('The headline set does not overturn the historical pattern. A clearer direction would strengthen this read.', injected) } });
      const generated = await h.load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext(quant, news);
      const mail = h.load('src/lib/marketing/email-dispatch.ts').createQuantBriefingEmailContent(generated.newsletterCopy,
        quant.score, quant.label, generated.isOverrideActive, 'premium', null, signal,
        { scoreDate: quant.tradeDate, marketDataDate: quant.tradeDate });
      assert.equal(generated.quant.score, quant.score);
      assert.equal(generated.isOverrideActive, false);
      for (const value of [mail.text, readableHtml(mail.html)]) {
        assert.ok(!value.includes('99.99%'));
        assert.ok(!value.includes('gain is guaranteed'));
      }
      customerInvariants(mail, 'stocks', quant.score);
    }
  });
  await check('truthful service-we prose stays accepted rather than banning first-person grammar wholesale', async () => {
    const serviceCopy = cleanStock.replace('The headline set does not overturn the historical pattern. A clearer direction would strengthen this read.',
      'We compare this reading with recorded past sessions. We use the supplied headlines to check for disruptions.');
    const h = harness({ now: NOW, aiResponse: { is_override_active: false, newsletter_copy: serviceCopy } });
    const generated = await h.load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext(quant, news);
    assert.equal(generated.generatedBy, 'anthropic', JSON.stringify(generated.warnings));
    assert.ok(generated.newsletterCopy.includes('We compare this reading'));
    assert.ok(generated.newsletterCopy.includes('We use the supplied headlines'));
  });
  await check('stock AI cannot assert an event override without any supplied headline', async () => {
    const h = harness({ now: NOW, aiResponse: { is_override_active: true,
      newsletter_copy: cleanStock.replace('The headline set does not overturn the historical pattern. A clearer direction would strengthen this read.',
        'A bank collapsed overnight. The score does not include that event.') } });
    const generated = await h.load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext(quant, news);
    assert.equal(generated.isOverrideActive, false);
    assert.ok(!generated.newsletterCopy.includes('bank collapsed'));
    assert.equal(generated.quant.score, quant.score);
  });
  await check('an already-recorded crypto override survives rendering without inventing an event or changing the score', async () => {
    const h = harness({ now: NOW });
    const context = { scoreDate: cryptoFixture.tradeDate, marketDataDate: cryptoFixture.tradeDate, isOverrideActive: true };
    const mail = h.load('src/lib/marketing/crypto-email-content.ts').createCryptoBriefingEmailContent(cleanCrypto,
      cryptoFixture.score, cryptoFixture.label, 'premium', context, cryptoFixture.signal);
    assert.match(mail.subject, /override active/i);
    assert.match(mail.text, /override active/i);
    assert.match(readableHtml(mail.html), /override active/i);
    assert.ok(!mail.text.includes('emergency rate cut'));
    assert.ok(!mail.text.includes('bank collapsed'));
    customerInvariants(mail, 'crypto', cryptoFixture.score);
  });
  await check('sparse crypto measurements omit empty evidence rather than duplicating market moves or historical returns', async () => {
    const result = await cryptoPreviews(cryptoCases[0]);
    assert.equal(result.context.evidence.length, 0, 'generic fixture summaries contain no measured RSI, ratio or dollar inputs');
    const renderer = harness({ now: NOW }).load('src/lib/marketing/daily-email-template.ts');
    assert.equal(renderer.dailyEmailEvidenceHtml(result.context), '');
  });
  await check('coverage is shown once per format and premium-only detail remains private', async () => {
    for (const market of ['stocks', 'crypto']) {
      const h = harness({ now: NOW });
      const copy = market === 'stocks' ? cleanStock : cleanCrypto;
      const context = { scoreDate: '2026-10-06', marketDataDate: '2026-10-06',
        interpretation: 'The supplied observations are mixed.', evidence: ['PRIVATE_EVIDENCE marker'],
        historicalContext: 'PRIVATE_HISTORY marker', coverageNote: 'Coverage fixture: the supplied news feed is unavailable.' };
      const create = market === 'stocks' ? h.load('src/lib/marketing/email-dispatch.ts').createQuantBriefingEmailContent
        : h.load('src/lib/marketing/crypto-email-content.ts').createCryptoBriefingEmailContent;
      for (const tier of ['premium', 'free']) {
        const mail = market === 'stocks' ? create(copy, 5, 'NEUTRAL', false, tier, null, signal, context)
          : create(copy, 5, 'NEUTRAL', tier, context, signal);
        for (const value of [mail.text, readableHtml(mail.html)]) {
          assert.equal(occurrences(value, context.coverageNote), 1);
          assert.equal(value.includes('PRIVATE_EVIDENCE'), tier === 'premium');
          assert.equal(value.includes('PRIVATE_HISTORY'), tier === 'premium');
        }
      }
    }
  });
  await check('untrusted copy and metadata cannot introduce active HTML in either email', async () => {
    const attack = '<script>alert("fixture")</script><img src=x onerror="fixture=true">';
    for (const market of ['stocks', 'crypto']) {
      const h = harness({ now: NOW });
      const context = { scoreDate: '2026-10-06', interpretation: attack, evidence: [attack], historicalContext: attack, coverageNote: attack };
      const mail = market === 'stocks'
        ? h.load('src/lib/marketing/email-dispatch.ts').createQuantBriefingEmailContent(cleanStock, 5, 'NEUTRAL', false, 'premium', null, signal, context)
        : h.load('src/lib/marketing/crypto-email-content.ts').createCryptoBriefingEmailContent(cleanCrypto, 5, 'NEUTRAL', 'premium', context, signal);
      assert.equal(/<script\b|<img\b/i.test(mail.html), false);
      assert.ok(mail.html.includes('&lt;script&gt;'));
      assert.ok(mail.text.includes(attack));
    }
  });
  const index = process.argv.indexOf('--preview-dir');
  if (index !== -1) {
    const supplied = process.argv[index + 1] ?? '';
    assert.ok(path.isAbsolute(supplied), 'Preview destination must be absolute');
    const destination = path.resolve(supplied);
    const checkout = path.resolve(__dirname, '..');
    assert.ok(destination !== checkout && !destination.startsWith(checkout + path.sep), 'Previews must stay outside repo');
    fs.mkdirSync(destination, { recursive: true });
    const review = [];
    for (const preview of previews) {
      for (const tier of ['premium', 'free']) {
        const filename = `${preview.market}-${preview.name}-${tier}`;
        fs.writeFileSync(path.join(destination, `${filename}.html`), preview[tier].html);
        fs.writeFileSync(path.join(destination, `${filename}.txt`), preview[tier].text);
      }
      review.push({ market: preview.market, name: preview.name, score: preview.input.score,
        lead: section(preview.generated.newsletterCopy, 'REGIME STATUS'), premiumWords: preview.premium.text.split(/\s+/).length,
        freeWords: preview.free.text.split(/\s+/).length });
    }
    fs.writeFileSync(path.join(destination, 'review-cases.json'), JSON.stringify(review, null, 2));
    fs.writeFileSync(path.join(destination, 'preview-context.txt'),
      'Synthetic policy/provenance regression fixtures rendered with actual source. These figures are test data, not published scores or predictions. No email was sent. Review the whole set for useful lead selection and needless repetition; passing assertions cannot establish a human-authentic voice.\n');
    console.log(`Local editorial review fixtures written to ${destination}`);
  }
  console.log(`\n${passed} editorial policy/provenance scenarios passed. No network requests, real sends or authenticity guarantee.`);
  return { passed, previews };
}
module.exports = { run, cryptoPreviews, stockPreviews, cryptoCases, stockCases };
if (require.main === module) run().catch(error => { console.error(error.stack); process.exitCode = 1; });
