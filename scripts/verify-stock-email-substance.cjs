/** Dated stock facts and meaningful fallback sends. Isolated provider fixtures only. */
const assert = require('node:assert/strict');
const { harness, signal, cleanStock, news } = require('./verify-readable-briefing-email.cjs');
const clone = value => structuredClone(value);
const snapshot = {
  trade_date: '2026-10-16', score: 0, bias_label: 'NEUTRAL', model_version: 'fixture',
  component_scores: [{summary: 'SPY RSI is 51.8. HYG/TLT percentile is 84.3.', averageForward1DayReturn: -0.04,
    averageForward3DayReturn: 0.16, analogMatches: [
      { tradeDate: '2026-09-01', spyForward1DayReturn: -0.48, spyForward3DayReturn: -0.8 },
      { tradeDate: '2026-09-02', spyForward1DayReturn: 0.85, spyForward3DayReturn: 1.2 },
      { tradeDate: '2026-09-02', spyForward1DayReturn: 0.85, spyForward3DayReturn: 1.2 },
    ]}],
  engine_inputs: { tradeWindow: { latestTradeDate: '2026-10-15', previousTradeDate: '2026-10-14' }, tradableSignal: signal,
    coreTickerChanges: Object.fromEntries([
      ['SPY', 771.79, 769.6, 0.28], ['QQQ', 728, 728.95, -0.13], ['TLT', 79.97, 78.89, 1.37], ['GLD', 382.71, 375.99, 1.79],
    ].map(([ticker, close, previousClose, percentChange]) => [ticker, { ticker, close, previousClose, percentChange, tradeDate: '2026-10-15' }])),
    supplementalTickerChanges: Object.fromEntries([
      ['VIX', 16.46, 16.87, -2.43], ['HYG', 77.13, 76.81, 0.42], ['USO', 157.31, 153.56, 2.44],
    ].map(([ticker, close, previousClose, percentChange]) => [ticker, { ticker, close, previousClose, percentChange, tradeDate: '2026-10-15' }])),
  }, technical_indicators: { SPY: { tradeDate: '2026-10-15', rsi14: 51.8, sma20: 771.106 } },
};

async function previews(input = snapshot, headlines = []) {
  const h = harness({ now: '2026-10-16T13:30:00Z', headlines });
  const generated = await h.load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefing(input, [input]);
  const context = h.load('src/lib/marketing/daily-email-context.ts').buildStockEmailContext(generated, input,
    { trade_date: '2026-10-15', score: -9 });
  const create = h.load('src/lib/marketing/email-dispatch.ts').createQuantBriefingEmailContent;
  const result = { h, generated, context,
    premium: create(generated.newsletterCopy, input.score, input.bias_label, generated.isOverrideActive, 'premium', null, signal, context),
    free: create(generated.newsletterCopy, input.score, input.bias_label, generated.isOverrideActive, 'free', null, signal, context) };
  assert.equal(h.sends.length, 0); assert.equal(h.writes.length, 0);
  return result;
}

async function run() {
  let passed = 0;
  const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
  await check('fallback uses completed ETF closes, VIX points and dated comparisons in HTML and text', async () => {
    const p = await previews();
    assert.equal(p.generated.generatedBy, 'fallback');
    for (const copy of [p.premium.text, p.premium.html]) {
      for (const fact of ['$771.79', '+0.28%', '$728.00', '-0.13%', '$79.97', '$77.13', '$382.71', '$157.31', '16.46', '$771.11', '0.09%', '0.41 percentage points']) assert.ok(copy.includes(fact), fact);
      assert.ok(!copy.includes('$16.46'), 'VIX is an index level, not a dollar price');
      assert.ok(!/supplied event|reassess the index view|Today’s setup|TODAY’S SETUP/.test(copy));
      assert.ok(copy.includes('15 Oct 2026'));
      assert.ok(copy.includes('2 past sessions'), 'historical dates must be deduplicated');
      assert.ok(copy.includes('-0.80% to +1.20%'), 'include the actual three-session outcome spread');
    }
    assert.equal(p.generated.quant.score, 0);
    assert.match(p.generated.newsletterCopy, /SPY\*\* rose 0.28%/);
    assert.ok(p.generated.quant.publishedScoreContext.marketSnapshot.marketRows.length > 0, 'AI receives the same price evidence');
    assert.ok(!p.premium.text.includes('Completed-session quotes are unavailable'));
  });
  await check('free subscribers receive the SPY close without leaking paid detail', async () => {
    const p = await previews();
    for (const copy of [p.free.text, p.free.html]) {
      assert.ok(copy.includes('$771.79'));
      for (const premium of ['$728.00', '$771.11', '0.41 percentage points', '2 past sessions', '84th percentile']) assert.ok(!copy.includes(premium), premium);
      assert.ok(copy.includes('Explore Pro'));
    }
  });
  await check('stale, future, mismatched ticker, inconsistent return and invalid price rows are omitted', async () => {
    for (const mutation of [
      q => { q.tradeDate = '2026-10-14'; }, q => { q.tradeDate = '2026-10-16'; }, q => { q.ticker = 'QQQ'; },
      q => { q.close = -1; }, q => { q.previousClose = 0; }, q => { q.percentChange = NaN; }, q => { q.percentChange = 20; },
    ]) {
      const input = clone(snapshot); mutation(input.engine_inputs.coreTickerChanges.SPY);
      const p = await previews(input);
      assert.ok(!p.premium.text.includes('$771.79'));
      assert.ok(!p.premium.text.includes('$771.11'), 'no SPY watch level without a valid close');
      assert.ok(p.premium.text.includes('unavailable or inconsistent for SPY'));
      assert.ok(p.premium.text.includes('$728.00'), 'other valid dated rows remain');
      assert.ok(!p.free.text.includes('$728.00'), 'missing SPY must not substitute a paid row into the free preview');
    }
  });
  await check('invalid/future cutoffs and stale technicals cannot create current market facts', async () => {
    for (const cutoff of ['2026-10-17', '2026-02-31', null]) {
      const input = clone(snapshot); input.engine_inputs.tradeWindow.latestTradeDate = cutoff;
      const p = await previews(input); assert.equal(p.context.stockFacts.marketRows.length, 0);
      assert.ok(!p.premium.text.includes('$771.79'));
    }
    const input = clone(snapshot); input.technical_indicators.SPY.tradeDate = '2026-10-14';
    const p = await previews(input);
    assert.ok(!p.premium.text.includes('$771.11'));
  });
  await check('ongoing war coverage does not trigger an override, but a new invasion or emergency does', async () => {
    const detect = harness().load('src/lib/briefing/daily-brief-generator.ts').detectOverrideCatalyst;
    for (const headline of ['Mideast war alters global bunker buying patterns, industry execs say - Reuters', 'Companies review nuclear energy investment', 'Investors discuss last year’s invasion', 'Fed holds its scheduled rate meeting']) assert.equal(detect([headline]), null, headline);
    for (const headline of ['Country launches invasion overnight', 'War escalates after new attacks', 'Bank collapse triggers emergency action', 'Central bank announces emergency rate cut']) assert.equal(detect([headline]), headline);
    const p = await previews(snapshot, ['Mideast war alters global bunker buying patterns, industry execs say - Reuters']);
    assert.equal(p.generated.isOverrideActive, false);
    assert.ok(!p.premium.subject.includes('Override'));
    const override = await previews(snapshot, ['Central bank announces emergency rate cut']);
    assert.equal(override.generated.isOverrideActive, true);
    assert.match(override.premium.subject, /Override/);
    assert.ok(override.premium.text.includes('$771.79'));
  });
  await check('AI cannot manufacture an override from ordinary headlines', async () => {
    const h = harness({ now: '2026-10-16T13:30:00Z', aiResponse: {is_override_active: true, newsletter_copy: cleanStock} });
    const generated = await h.load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext(
      {tradeDate:'2026-10-16',score:0,label:'NEUTRAL',signal,analogs:[],historicalAnalogs:null,analogReference:null},
      {...news, status:'available', headlines:['Companies report quarterly earnings'], summary:'Quarterly earnings coverage'});
    assert.equal(generated.isOverrideActive, false);
  });
  console.log(`\n${passed} stock substance scenarios passed, no network or real sends.`);
}
module.exports = { run, previews, snapshot };
if (require.main === module) run().catch(error => { console.error(error.stack); process.exitCode = 1; });
