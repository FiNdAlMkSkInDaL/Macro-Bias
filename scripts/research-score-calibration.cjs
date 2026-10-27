/** Offline research from existing public-price reconstructions. No providers or production writes. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { calibrateScore } = require('./lib/private-score-calibration.cjs');
const load = require('./distribution-loader.cjs')();
const math = load('src/lib/model-forward/math');
const recipePath = 'docs/score-calibration-recipe-20261027.json';
const recipe = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Supply existing research directory and a NEW local output directory');
if (fs.existsSync(output)) throw Error('Preserve prior results; output directory must be new');
fs.mkdirSync(output, { recursive: true });
const fingerprint = text => createHash('sha256').update(text).digest('hex');
function stats(rows, cost) {
  if (!rows.length) return { sessions: 0, available: false };
  const { average, round, blockInterval, tradingPosition, netReturn } = math;
  const brier = (f, y) => (Number(y > 0) - f.probabilityUp) ** 2;
  const squared = (f, y) => (y - f.expectedReturn) ** 2;
  const pDelta = rows.map(r => brier(r.candidate, r.outcome) - brier(r.base, r.outcome));
  const zeroDelta = rows.map(r => brier(r.candidate, r.outcome) - 0.25);
  const retDelta = rows.map(r => squared(r.candidate, r.outcome) - squared(r.base, r.outcome));
  return { sessions: rows.length, firstTarget: rows[0].targetDate, lastTarget: rows.at(-1).targetDate,
    candidateBrier: round(average(rows.map(r => brier(r.candidate, r.outcome)))), baseFrequencyBrier: round(average(rows.map(r => brier(r.base, r.outcome)))),
    brierMinusBase: round(average(pDelta)), brierPaired95: blockInterval(pDelta), brierMinusHalf: round(average(zeroDelta)), halfPaired95: blockInterval(zeroDelta),
    candidateReturnMse: round(average(rows.map(r => squared(r.candidate, r.outcome)))), baseReturnMse: round(average(rows.map(r => squared(r.base, r.outcome)))),
    mseMinusBase: round(average(retDelta)), msePaired95: blockInterval(retDelta),
    active: rows.filter(r => tradingPosition(r.candidate.expectedReturn, cost) !== 0).length,
    meanNetAtCostPct: [0, 1, 2].map(multiple => ({ multiple, mean: round(average(rows.map(r => netReturn(r.outcome, tradingPosition(r.candidate.expectedReturn, cost), cost * multiple)))) })) };
}
const sourceHashes = {}, markets = {};
for (const market of ['stocks', 'crypto']) {
  const evaluationText = fs.readFileSync(path.join(input, market + '-evaluations.json'), 'utf8');
  const forecastText = fs.readFileSync(path.join(input, market + '-predictions.json'), 'utf8');
  sourceHashes[market] = { evaluations: fingerprint(evaluationText), predictions: fingerprint(forecastText) };
  const forecasts = new Map(JSON.parse(forecastText).map(r => [r.date, r]));
  const rows = JSON.parse(evaluationText).map(r => ({ date: r.date, targetDate: r.targetDate, outcome: r.outcome,
    score: r.predictions.production_raw.score, volatility20: forecasts.get(r.date)?.state.dailyVolatility20Pct }));
  if (!rows.length || rows.some((r, i) => !Number.isFinite(r.outcome) || !Number.isFinite(r.score) || Math.abs(r.score) > 100 ||
    !Number.isFinite(r.volatility20) || r.volatility20 <= 0 || r.targetDate > recipe.historicalCutoff || r.targetDate <= r.date ||
    (i > 0 && (r.date <= rows[i - 1].date || r.targetDate <= rows[i - 1].targetDate)))) throw Error('Invalid calibration inputs');
  const evaluations = calibrateScore(rows, recipe, math), cost = market === 'stocks' ? 0.1 : 0.3;
  const overall = stats(evaluations, cost), recent = stats(evaluations.filter(r => r.targetDate >= '2026-01-01'), cost);
  const annual = [...new Set(evaluations.map(r => r.targetDate.slice(0, 4)))].map(year => ({ year, ...stats(evaluations.filter(r => r.targetDate.startsWith(year)), cost) }));
  const exploratoryChecks = { improvesBrierOverall: overall.brierMinusBase < 0, improvesHalfOverall: overall.brierMinusHalf < 0,
    improvesBrierRecent: recent.brierMinusBase < 0, improvesHalfRecent: recent.brierMinusHalf < 0,
    improvesReturnMseOverall: overall.mseMinusBase < 0, improvesReturnMseRecent: recent.mseMinusBase < 0,
    probabilityEveryYear: annual.every(r => r.brierMinusBase < 0), positiveDoubleCost: overall.meanNetAtCostPct[2].mean > 0,
    prospectiveValidationComplete: false };
  markets[market] = { overall, reviewed2026: recent, annual, decision: 'DO_NOT_PROMOTE', exploratoryChecks };
  fs.writeFileSync(path.join(output, market + '-calibrated.json'), JSON.stringify(evaluations) + '\n', { flag: 'wx' });
}
const report = { generatedAt: new Date().toISOString(), recipe, sourceHashes, codeHash: fingerprint(fs.readFileSync(__filename) + fs.readFileSync('scripts/lib/private-score-calibration.cjs')),
  status: 'PRIVATE_RESEARCH_NO_SUBSCRIBER_OR_FORWARD_COHORT_CHANGES', markets };
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, markets: Object.fromEntries(Object.entries(markets).map(([market, r]) => [market, { overall: r.overall, reviewed2026: r.reviewed2026, decision: r.decision }])) }, null, 2));
