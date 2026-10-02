/** Actual briefing generators, email builders and scheduled publishers, with isolated
 * AI/database/delivery fixtures. No credentials, network requests or live writes.
 * Run: node scripts/verify-readable-briefing-email.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const CONTROL_FIELDS = /\b(?:NO_TRADE|Permission\s*:|Reliability\s+[A-F]\b|rel\s+[A-F]\b|Size\s+\d+%)/i;

function harness(options = {}) {
  const cache = new Map();
  const sends = [];
  const aiRequests = [];
  const writes = [];
  const logs = [];
  const env = { CRON_SECRET: 'fixture-cron-secret', RESEND_API_KEY: 'fixture-send-key', ...options.env };
  class FixtureDate extends Date {
    constructor(...args) { args.length ? super(...args) : super('2026-10-02T12:45:00Z'); }
    static now() { return Date.parse('2026-10-02T12:45:00Z'); }
  }
  const tables = options.tables ?? {};
  const database = { from(table) {
    const state = { filters: [], offset: 0, end: Infinity, single: false };
    const query = {
      select() { return query; }, order() { return query; }, limit(n) { state.end = n - 1; return query; },
      eq(k, v) { state.filters.push(row => row[k] === v); return query; },
      in(k, v) { state.filters.push(row => v.includes(row[k])); return query; },
      not(k, op, v) { state.filters.push(row => row[k] !== v); return query; },
      gte(k, v) { state.filters.push(row => row[k] >= v); return query; },
      lte(k, v) { state.filters.push(row => row[k] <= v); return query; },
      range(start, end) { state.offset = start; state.end = end; return query; },
      maybeSingle() { state.single = true; return query; },
      insert(rows) { writes.push({ table, rows }); return query; },
      upsert(rows) { writes.push({ table, rows }); return query; },
      update(rows) { writes.push({ table, rows }); return query; },
      then(resolve, reject) {
        const rows = (tables[table] ?? []).filter(row => state.filters.every(filter => filter(row)))
          .slice(state.offset, state.end + 1);
        return Promise.resolve({ data: state.single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
      },
    };
    return query;
  }};
  class Anthropic {
    constructor() { this.messages = { create: async request => {
      aiRequests.push(request);
      if (!options.aiResponse) throw new Error('Fixture AI unavailable');
      return { content: [{ type: 'text', text: JSON.stringify(options.aiResponse) }] };
    }}; }
  }
  class Resend {
    constructor() {
      this.batch = { send: async messages => {
        sends.push(...messages);
        return { data: { data: messages.map((_, index) => ({ id: `fixture-${index}` })) }, error: null };
      }};
      this.emails = { send: async message => { sends.push(message); return { data: { id: 'fixture-alert' }, error: null }; }};
    }
  }
  const mocks = {
    'server-only': {}, '@anthropic-ai/sdk': Anthropic, resend: { Resend },
    'twitter-api-v2': { TwitterApi: class {} },
    'next/server': { NextResponse: { json: (data, init = {}) => ({ data, status: init.status ?? 200 }) } },
    'src/lib/server-env.ts': { getAppUrl: () => 'https://www.macro-bias.com', getRequiredServerEnv: () => 'fixture-key' },
    'src/lib/supabase/admin.ts': { createSupabaseAdminClient: () => database },
    'src/lib/supabase/server.ts': { createSupabaseServerClient: async () => database },
    'src/lib/briefing/retry.ts': { withExponentialBackoff: fn => fn() },
    'src/lib/market-data/derive-historical-analogs.ts': { deriveHistoricalAnalogs: () => null },
    'src/lib/market-data/fetch-morning-news.ts': { fetchMorningNews: async () => options.headlines ?? [] },
    'src/lib/market-data/upsert-daily-market-data.ts': { upsertDailyMarketData: async () => ({ tradeDate: '2026-10-01' }) },
    'src/lib/crypto-market-data/upsert-crypto-market-data.ts': { upsertCryptoMarketData: async () => ({ tradeDate: '2026-10-01' }) },
    'src/lib/marketing/email-preferences.ts': { filterSubscribedEmailRecipients: async (_, emails) => ({ deliverableEmails: emails, unsubscribedEmails: [] }) },
    'src/lib/referral/premium-unlock.ts': { partitionUnlockedSubscribers: async (_, emails) => ({ unlockedEmails: [], regularFreeEmails: emails }) },
    'src/lib/referral/verify-referrals.ts': { verifyPendingReferrals: async () => {} },
    'src/lib/briefing/weekly-digest-data.ts': { getWeeklyDigestData: async () => null },
    'src/lib/social/bluesky.ts': { isBlueskyConfigured: () => false },
    'src/lib/social/telegram.ts': { isTelegramConfigured: () => false },
    'src/lib/social/threads.ts': { isThreadsConfigured: () => false },
    ...(options.mocks ?? {}),
  };
  function load(relative) {
    const file = relative.replaceAll('\\', '/');
    if (file in mocks) return mocks[file];
    if (cache.has(file)) return cache.get(file).exports;
    const filename = path.join(root, file);
    let source = options.sources?.[file] ?? fs.readFileSync(filename, 'utf8');
    if (file === 'src/app/api/cron/crypto-publish/route.ts') {
      source += '\nexport { buildCryptoBriefingEmailHtml, buildFreeTierCryptoBriefingEmailHtml, buildCryptoBriefingEmailText };';
    }
    const compiled = ts.transpileModule(source, { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} };
    cache.set(file, module);
    const localRequire = name => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('node:')) return require(name);
      const next = name.startsWith('@/') ? 'src/' + name.slice(2)
        : name.startsWith('.') ? path.relative(root, path.resolve(path.dirname(filename), name)).replaceAll('\\', '/') : null;
      if (next) return load(next.endsWith('.ts') ? next : next + '.ts');
      throw new Error(`Unmocked external dependency: ${name}`);
    };
    vm.runInNewContext(`(function(exports, require, module) {${compiled}\n})`, {
      Date: FixtureDate, Error, Intl, Buffer, URL, process: { env }, console: { log() {}, warn: (...args) => logs.push(args.map(String).join(' ')), error: (...args) => logs.push(args.map(String).join(' ')) },
      setTimeout: fn => { fn(); return 0; }, clearTimeout() {},
    }, { filename })(module.exports, localRequire, module);
    return module.exports;
  }
  return { load, sends, aiRequests, writes, logs };
}

const signal = { position: 'FLAT', reliability: 'A', size: 0, noTrade: false, neighborAgreement: 0.8, meanNeighborDistance: 0.2, distanceQuality: 0.99, reason: 'Fixture supporting context' };
const quant = { tradeDate: '2026-10-01', label: 'NEUTRAL', score: 5, analogReference: '2026-09-24', historicalAnalogs: null,
  analogs: [{ tradeDate: '2026-09-24', nextSessionDate: '2026-09-25', score: 34, biasLabel: 'RISK_ON', matchConfidence: 99, intradayNet: 0.33, sessionRange: 0.78, overnightGap: 0.01 }], signal };
const news = { status: 'available', disclaimer: null, headlines: [], summary: 'No material disruption in the fixture news context.' };
const crypto = { tradeDate: '2026-10-01', score: -10, label: 'NEUTRAL', signal,
  tickerChanges: { 'BTC-USD': { close: 84853.1016, percentChange: 0.46 } },
  componentScores: [{ analogDates: ['2026-09-24'], summary: 'A neutral fixture pattern.', averageForward1DayReturn: 0.1, averageForward3DayReturn: 0.2 }],
};
const cleanStock = `REGIME STATUS
Pattern intact: the score deserves weight today.
TRADING IMPLICATION
- **Setup:** The score describes a neutral market.
- **Focus:** Medium conviction favors relative strength.
- **Risk:** Broad weakness would challenge this read.
BASE SCORE
Base model score: NEUTRAL (+5), and the setup remains intact.
WHY IT MATTERS
The headline set does not overturn the historical pattern. A clearer direction would strengthen this read.
MODEL CONTEXT
The closest match is 2026-09-24.
That comparison provides context rather than a precise forecast.
Model Diagnostics: Closest Match 2026-09-24 | Match Confidence 99% | Override INACTIVE.`;
const cleanCrypto = `REGIME STATUS
Crypto is in a neutral regime, and the score remains useful context.
MARKET MAP
- **Bitcoin**: Neutral -- **BTC** reflects a balanced fixture market.
- **Altcoins (ETH-led)**: Neutral -- The fixture does not show clear leadership.
- **DeFi/L1s**: Neutral -- The fixture does not show a broad expansion.
- **Stablecoins/Flows**: Neutral -- The fixture has no flow disruption.
RISK FRAME
The wider backdrop matters more than a single close. Consistent relative strength would support this read.
MODEL CONTEXT
The nearest analog is 2026-09-24.
It provides context rather than a precise forecast.
Model Diagnostics: Score -10 | Analogs 2026-09-24.`;
function readable(content) { assert.equal(CONTROL_FIELDS.test(content), false, 'email exposes technical control fields'); }

async function run() {
  let passed = 0;
  async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
  await check('stock AI accepts readable sections while retaining internal model inputs', async () => {
    const h = harness({ aiResponse: { is_override_active: false, newsletter_copy: cleanStock } });
    const result = await h.load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext(quant, news);
    assert.equal(result.generatedBy, 'anthropic'); readable(result.newsletterCopy);
    assert.ok(h.aiRequests[0].system.includes('Do not print model control fields'));
    assert.ok(h.aiRequests[0].messages[0].content.includes('"tradableSignal"'));
  });
  await check('stock AI control-field leakage rejects into readable fallback', async () => {
    const h = harness({ aiResponse: { is_override_active: false, newsletter_copy: cleanStock.replace('Pattern intact:', 'Permission: FLAT · Reliability A · Size 0%. Pattern intact:') } });
    const result = await h.load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext(quant, news);
    assert.equal(result.generatedBy, 'fallback'); readable(result.newsletterCopy);
    assert.ok(result.warnings.some(x => x.includes('exposed model control fields')));
  });
  await check('stock inline colon headers and a two-sentence paragraph accept AI copy with factual diagnostics', async () => {
    const inline = cleanStock.replace(/^(REGIME STATUS|TRADING IMPLICATION|BASE SCORE|WHY IT MATTERS|MODEL CONTEXT)\n/gm, '$1: ')
      .replace('2026-09-24.\nThat comparison', '2026-09-24. That comparison')
      .replace(/Model Diagnostics:.*/, '  Model Diagnostics: analog confidence low, invented commentary.');
    const result = await harness({ aiResponse: { is_override_active: false, newsletter_copy: inline } })
      .load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext(quant, news);
    assert.equal(result.generatedBy, 'anthropic'); readable(result.newsletterCopy);
    assert.ok(result.newsletterCopy.includes('Match Confidence 99%'));
    assert.ok(!result.newsletterCopy.includes('invented commentary'));
  });
  await check('stock near-neutral fallback explains the recorded historical context without recalculating the score', async () => {
    const q = { ...quant, publishedScoreContext: {
      averageForward1DayReturn: 0.26, averageForward3DayReturn: -0.04, blendedForwardReturn: 0.13,
      componentSummaries: ['Recorded fixture momentum is mixed.'], marketDataDate: '2026-10-01',
    }};
    const h = harness();
    const result = await h.load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext(q, news);
    assert.equal(result.quant.score, 5); assert.ok(result.newsletterCopy.includes('close to zero with only a small positive lean'));
    assert.ok(result.newsletterCopy.includes('+0.26% after one day and -0.04% after three days'));
    assert.ok(h.aiRequests[0].messages[0].content.includes('"publishedScoreContext"'));
    const draft = cleanStock.replace('The closest match is 2026-09-24.\nThat comparison provides context rather than a precise forecast.',
      'The closest match is 2026-09-24, when current fixture momentum was mixed. That session averaged +0.26% after one day and -0.04% after three days.')
      .replace('Base model score: NEUTRAL (+5), and the setup remains intact.',
        'The neutral score is de-emphasized due to headlines (5, blended forward +0.13%).');
    const ai = harness({ aiResponse: { is_override_active: false, newsletter_copy: draft } });
    const accepted = await ai.load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext(q, news);
    assert.equal(accepted.generatedBy, 'anthropic');
    assert.ok(accepted.newsletterCopy.includes('wider set of similar sessions averaged +0.26%'));
    assert.ok(!accepted.newsletterCopy.includes('That session averaged'));
    assert.ok(!accepted.newsletterCopy.includes('when current fixture momentum'));
    assert.ok(accepted.newsletterCopy.includes('Match Confidence 99%'));
    assert.ok(accepted.newsletterCopy.includes('NEUTRAL (+5) is close to zero with only a small positive lean'));
    assert.ok(!accepted.newsletterCopy.includes('blended forward'));
    assert.ok(ai.aiRequests[0].system.includes('Component summaries describe current market inputs'));
    const override = await harness({ aiResponse: { is_override_active: true, newsletter_copy: draft } })
      .load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext(q, news);
    assert.equal(override.generatedBy, 'anthropic');
    assert.ok(override.newsletterCopy.includes("but today's headlines reduce its weight"));
    assert.ok(override.newsletterCopy.includes('The headline set does not overturn the historical pattern.'));
    const reordered = draft.replace(/(WHY IT MATTERS\n[\s\S]*?)(MODEL CONTEXT\n[\s\S]*)$/, '$2\n$1');
    const rejected = await harness({ aiResponse: { is_override_active: false, newsletter_copy: reordered } })
      .load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext(q, news);
    assert.equal(rejected.generatedBy, 'fallback');
    assert.ok(rejected.newsletterCopy.includes('WHY IT MATTERS'));
  });
  await check('stock fallback preserves override, missing-news and unsuitable-model limits in plain English', async () => {
    for (const [q, n, phrase] of [
      [quant, { ...news, headlines: ['Missile strike disrupts shipping in a fixture headline'] }, 'Override active:'],
      [quant, { ...news, status: 'unavailable' }, 'missing news read lowers confidence'],
      [{ ...quant, signal: { ...signal, noTrade: true, position: 'NO_TRADE', reliability: 'F' } }, news, 'historical match is too weak'],
      [{ ...quant, signal: { ...signal, noTrade: true, position: 'NO_TRADE', reliability: 'F' } }, { ...news, status: 'unavailable' }, 'live news read is unavailable'],
    ]) {
      const result = await harness().load('src/lib/briefing/daily-brief-generator.ts').generateDailyBriefingFromContext(q, n);
      assert.equal(result.generatedBy, 'fallback'); assert.ok(result.newsletterCopy.includes(phrase)); readable(result.newsletterCopy);
      assert.equal(result.quant.score, 5);
      if (q.signal.noTrade) {
        const content = harness().load('src/lib/marketing/email-dispatch.ts').createQuantBriefingEmailContent(result.newsletterCopy, 5, 'NEUTRAL', false, 'premium', null, q.signal);
        assert.ok(content.html.includes('Background context today'));
        assert.ok(!content.html.includes('Score is in play'));
        if (n.status === 'unavailable') assert.ok(content.text.includes('live news read is unavailable'));
      }
      if (q.signal.noTrade && n.status === 'available') {
        assert.ok(!result.newsletterCopy.includes('still deserves weight'));
        assert.ok(result.newsletterCopy.includes('Low conviction'));
      }
    }
  });
  await check('stock established subjects, score-first header, section order and Monday chart remain', async () => {
    const builder = harness().load('src/lib/marketing/email-dispatch.ts');
    for (const tier of ['premium', 'free']) {
      const normal = builder.createQuantBriefingEmailContent(cleanStock, 5, 'NEUTRAL', false, tier, null, signal);
      assert.equal(normal.subject, 'NEUTRAL (+5)'); readable(normal.html); readable(normal.text);
      assert.ok(normal.html.includes('font-size: 28px')); assert.ok(normal.text.includes('BASE SCORE: NEUTRAL (+5)'));
      assert.ok(normal.html.includes('Unsubscribe')); assert.ok(normal.text.includes('{{UNSUBSCRIBE_URL}}'));
      assert.ok(normal.html.includes('href="https://www.macro-bias.com/dashboard"'));
      assert.ok(!normal.html.includes('>macro-bias.com/crypto</a>'));
      const override = builder.createQuantBriefingEmailContent(cleanStock, 5, 'NEUTRAL', true, tier, null, signal);
      assert.equal(override.subject, 'Override Active | NEUTRAL (+5)'); readable(override.html);
    }
    const recap = builder.createQuantBriefingEmailContent(cleanStock, 5, 'NEUTRAL', false, 'premium', {
      sessionCount: 1, avgScore: 5, dominantRegime: 'NEUTRAL', trendDirection: 'flat', overrideCount: 0,
      weekStart: '2026-09-21', weekEnd: '2026-09-25', briefings: [{ briefing_date: '2026-09-25', bias_label: 'NEUTRAL', quant_score: 5, is_override_active: false }],
    }, signal);
    assert.ok(recap.subject.includes('Weekly Recap')); assert.ok(recap.html.includes('height: 8px')); readable(recap.text);
  });
  await check('crypto AI and degraded fallback keep readable context and unsuitable-model limits', async () => {
    const h = harness({ aiResponse: { is_override_active: false, newsletter_copy: cleanCrypto } });
    const result = await h.load('src/lib/crypto-briefing/crypto-brief-generator.ts').generateCryptoDailyBriefing(crypto);
    assert.equal(result.generatedBy, 'anthropic'); readable(result.newsletterCopy);
    const inline = cleanCrypto.replace(/^(REGIME STATUS|MARKET MAP|RISK FRAME|MODEL CONTEXT)\n/gm, '$1: ')
      .replace('2026-09-24.\nIt provides', '2026-09-24. It provides')
      .replace(/Model Diagnostics:.*/, '  Model Diagnostics: invented confidence low.');
    const inlineResult = await harness({ aiResponse: { is_override_active: false, newsletter_copy: inline } })
      .load('src/lib/crypto-briefing/crypto-brief-generator.ts').generateCryptoDailyBriefing(crypto);
    assert.equal(inlineResult.generatedBy, 'anthropic'); readable(inlineResult.newsletterCopy);
    assert.ok(!inlineResult.newsletterCopy.includes('invented confidence'));
    assert.ok(inlineResult.newsletterCopy.includes('BTC Close'));
    const reordered = cleanCrypto.replace(/(RISK FRAME\n[\s\S]*?)(MODEL CONTEXT\n[\s\S]*)$/, '$2\n$1');
    const rejected = await harness({ aiResponse: { is_override_active: false, newsletter_copy: reordered } })
      .load('src/lib/crypto-briefing/crypto-brief-generator.ts').generateCryptoDailyBriefing(crypto);
    assert.equal(rejected.generatedBy, 'fallback');
    const bad = harness({ aiResponse: { is_override_active: false, newsletter_copy: cleanCrypto.replace('Crypto is', 'Permission: FLAT. Crypto is') } });
    const fallback = await bad.load('src/lib/crypto-briefing/crypto-brief-generator.ts').generateCryptoDailyBriefing({ ...crypto, signal: { ...signal, noTrade: true } });
    assert.equal(fallback.generatedBy, 'fallback'); readable(fallback.newsletterCopy);
    assert.ok(fallback.newsletterCopy.includes('historical match is too weak'));
  });
  for (const asset of ['stock', 'crypto']) await check(`${asset} real scheduled publisher delivers established subject, matching score, HTML/text and unsubscribe headers to mock provider`, async () => {
    const stockRow = { trade_date: '2026-10-01', score: 5, bias_label: 'NEUTRAL', component_scores: [], engine_inputs: { tradableSignal: signal }, technical_indicators: {} };
    const h = harness({ tables: {
      macro_bias_scores: [stockRow], daily_market_briefings: [],
      crypto_bias_scores: [{ ...stockRow, score: -10, ticker_changes: crypto.tickerChanges, component_scores: crypto.componentScores }], crypto_daily_briefings: [],
      etf_daily_prices: [{ ticker: 'BTC-USD', trade_date: '2026-10-01' }],
      users: [{ email: 'paid@macro-bias.com', subscription_status: 'active' }],
      free_subscribers: [{ email: 'free@macro-bias.com', status: 'active', tier: 'free', stocks_opted_in: true, crypto_opted_in: true }],
    }});
    const route = h.load(asset === 'stock' ? 'src/app/api/cron/publish/route.ts' : 'src/app/api/cron/crypto-publish/route.ts');
    const result = await route.GET({ headers: { get: key => key === 'authorization' ? 'Bearer fixture-cron-secret' : null }, nextUrl: new URL(`https://www.macro-bias.com/api/cron/${asset === 'stock' ? 'publish' : 'crypto-publish'}`) });
    assert.equal(result.status, 200, JSON.stringify({ data: result.data, logs: h.logs })); assert.equal(result.data.emailSent, true);
    assert.equal(h.sends.length, 2); assert.equal(h.writes.length, 1, 'only fixture briefing persistence expected');
    for (const message of h.sends) {
      assert.equal(message.subject, asset === 'stock' ? 'NEUTRAL (+5)' : 'Crypto Bias: NEUTRAL (-10)');
      readable(message.subject); readable(message.html); readable(message.text);
      assert.ok(message.html.includes('Unsubscribe')); assert.ok(message.text.includes('Unsubscribe: https://'));
      assert.equal(message.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
      assert.ok(!message.html.includes('{{UNSUBSCRIBE_URL}}'));
    }
  });
  console.log(`\n${passed} readable briefing email scenarios passed. Actual source; isolated AI, database and delivery only.`);
  return { passed };
}
module.exports = { harness, quant, news, crypto, signal, cleanStock, cleanCrypto, run };
if (require.main === module) run().catch(error => { console.error(error.stack); process.exitCode = 1; });
