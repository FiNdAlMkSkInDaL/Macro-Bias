/** Real content builders with mocked providers: no network, accounts or sends. */
const assert = require('node:assert/strict');
const { harness, signal } = require('./verify-readable-briefing-email.cjs');
const h = harness({ now: '2026-10-27T17:00:00Z' });
const stock = h.load('src/lib/marketing/email-dispatch.ts').createQuantBriefingEmailContent;
const crypto = h.load('src/lib/marketing/crypto-email-content.ts').createCryptoBriefingEmailContent;
const template = h.load('src/lib/marketing/daily-email-template.ts');
const filtered = { ...signal, position: 'NO_TRADE', noTrade: true, size: 0,
  scoreContext: { semantics: 'daily_reading_v1', rawScore: 71, tradeScore: 0, sourceTradeDate: '2026-10-26', suppressedBy: ['monday'], filters: [{ code: 'monday_source', before: 71, after: 0 }] } };
const context = { scoreDate: '2026-10-27', marketDataDate: '2026-10-26', previousScoreDate: '2026-10-26', previousScore: 0,
  scoreVersion: 'macro-model-v19-daily-reading-raw-vix', previousScoreVersion: 'macro-model-v18-adaptive-k', interpretation: 'The historical reading is positive.' };
for (const tier of ['free', 'premium']) {
  for (const message of [stock('', 71, 'EXTREME_RISK_ON', false, tier, null, filtered, context), crypto('', 71, 'EXTREME_RISK_ON', tier, context, filtered)]) {
    assert.match(message.subject, /EXTREME RISK ON \(\+71\)/);
    assert.match(message.text, /DAILY MARKET SCORE: EXTREME RISK ON \(\+71\)/);
    assert.match(message.text, /Trading filters:.*Monday/);
    assert(!message.text.includes('Change: +71'));
    assert(message.html.indexOf('<h1') < message.html.indexOf('<strong>Trading filters</strong>'));
    assert(!message.html.includes('NO CLEAR DIRECTIONAL SIGNAL'));
    assert(!message.text.includes('71% chance'));
    assert(!message.text.includes('rawScore'));
  }
}
assert.equal(template.dailyEmailDeltaText(71, context), '');
assert.match(template.dailyEmailDeltaText(71, { ...context, previousScoreVersion: context.scoreVersion }), /Change: \+71/);
console.log('PASS stock/crypto Free/Pro HTML, plain text and subjects retain the market reading, show filters separately, omit cross-version deltas and keep internal controls private.');
