/** Domain regression checks: no network, real recipients, account creation or writes. */
const assert = require('node:assert/strict');
const { harness, signal, quant, news } = require('./verify-readable-briefing-email.cjs');
const load = require('./distribution-loader.cjs')();
const { explainReading } = load('src/lib/signal/reading-explanation.ts');
const filtered = { ...signal, position: 'NO_TRADE', noTrade: true, reliability: 'F', neighborAgreement: 0,
  reason: 'adaptive K=5; low neighbor-vol flat (dispersion 0.32 < 0.5). Neighbor disagreement is high.' };
(async () => {
  let p = explainReading(0, filtered);
  assert.equal(p.status, 'withheld'); assert.equal(p.title, 'No clear directional signal');
  assert.match(p.reason, /low-variation filter/); assert.match(p.reason, /does not mean prices were unchanged/);
  assert(!/too weak|disagree|0%/.test(p.reason));
  p = explainReading(0, { ...filtered, reason: 'Monday dampener: low neighbor-vol flat' });
  assert.match(p.reason, /Monday/); assert.match(p.reason, /low-variation/);
  p = explainReading(0, { ...signal, position: 'FLAT', reason: 'Monday publish dampener.' }); assert.equal(p.status, 'withheld');
  p = explainReading(0, { ...signal, position: 'FLAT', reason: 'Score is inside the neutral dead zone.' });
  assert.equal(p.status, 'neutral'); assert.match(p.reason, /inside the neutral range/); assert(!p.reason.includes('filter'));
  p = explainReading(0, { ...filtered, reason: 'Stored rule', scoreContext: { rawScore: 31, suppressedBy: ['overnight_conflict'] } });
  assert.match(p.reason, /overnight price gap conflicts/);
  assert.equal(explainReading(0, null).status, 'unavailable');
  assert.match(explainReading(0, null).reason, /stored reason.*unavailable/i);
  assert.equal(explainReading(40, { ...signal, position: 'LONG' }).status, 'directional');
  assert.doesNotThrow(() => explainReading(0, { ...filtered, scoreContext: {} }));
  const h = harness({ now: '2026-10-22T14:00:00Z' });
  const template = h.load('src/lib/marketing/daily-email-template.ts');
  assert.equal(template.dailyEmailReliabilityText(filtered, 0), '');
  const context = { scoreDate: '2026-10-22', marketDataDate: '2026-10-21', stockFacts: {
    marketRows: ['**SPY:** $773.09, +0.53% from the prior close.'],
    watchPoints: ['**SPY trend:** The close is above its 20-session average. Check the next completed close.'] } };
  const mail = h.load('src/lib/marketing/email-dispatch.ts').createQuantBriefingEmailContent('REGIME STATUS: A misleading enthusiastic lead.', 0, 'NEUTRAL', false, 'premium', null, filtered, context);
  for (const content of [mail.html, mail.text]) {
    assert.match(content.replace(/<[^>]*>/g, ''), /NEUTRAL\s*\(0\)/); assert.match(content, /low-variation filter/);
    assert(!/Directional agreement[^<\n]*0%/.test(content)); assert(!content.includes('Insufficient historical fit'));
    assert(content.includes('$773.09')); assert(content.includes('Check the next completed close'));
    assert(!content.includes('misleading enthusiastic'));
  }
  assert.match(mail.subject, /NEUTRAL \(0\)/);
  const generated = await h.load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext({ ...quant, score: 0, label: 'NEUTRAL', signal: filtered }, news);
  assert.match(generated.newsletterCopy, /low-variation filter/); assert(!/historical match is too weak/.test(generated.newsletterCopy));
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const ProReading = require('./distribution-loader.cjs')({
    'react/jsx-runtime': require('react/jsx-runtime'), './ProReading.module.css': {},
  })('src/components/product/ProReading.tsx').ProReading;
  const proMarkup = renderToStaticMarkup(React.createElement(ProReading, { asset: 'stocks', tradeDate: '2026-10-22', score: 0,
    label: 'NEUTRAL', explanation: explainReading(0, filtered) }));
  assert.match(proMarkup, />Neutral</); assert.match(proMarkup, /low-variation filter/);
  assert(!proMarkup.includes('No clear directional signal'));
  // The stored regime and score remain the headline in both markets and tiers,
  // including nonzero withheld readings. Caution belongs in the body.
  const stock = h.load('src/lib/marketing/email-dispatch.ts').createQuantBriefingEmailContent;
  const crypto = h.load('src/lib/marketing/crypto-email-content.ts').createCryptoBriefingEmailContent;
  const regimes = [[-85, 'EXTREME_RISK_OFF'], [-40, 'RISK_OFF'], [0, 'NEUTRAL'], [40, 'RISK_ON'], [85, 'EXTREME_RISK_ON']];
  for (const [value, label] of regimes) {
    const signed = value > 0 ? `+${value}` : String(value);
    const headline = `${label.replaceAll('_', ' ')} (${signed})`;
    for (const tier of ['free', 'premium']) {
      const messages = [stock('', value, label, false, tier, null, filtered, context), crypto('', value, label, tier, context, filtered)];
      for (const message of messages) {
        assert(message.subject.includes(headline), message.subject);
        assert(message.text.includes(`BASE SCORE: ${headline}`));
        const h1 = message.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        assert.equal(h1, headline);
        assert.match(message.text, /low-variation filter/);
        assert(!message.subject.includes('No clear directional signal'));
      }
    }
    const rendered = renderToStaticMarkup(React.createElement(ProReading, { asset: 'stocks', tradeDate: '2026-10-22',
      score: value, label, explanation: explainReading(value, filtered) }));
    assert(rendered.includes(`>${signed}</p>`));
    assert(rendered.includes(`>${label.toLowerCase().split('_').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')}</span>`));
    assert.match(rendered, /low-variation filter/);
  }
  assert.equal(h.sends.length, 0); assert.equal(h.writes.length, 0);
  console.log('PASS reading display: all five published regimes and numbers in stock/crypto emails and Pro, filtering reasons retained, no misleading agreement or sends');
})().catch(error => { console.error(error); process.exitCode = 1; });
