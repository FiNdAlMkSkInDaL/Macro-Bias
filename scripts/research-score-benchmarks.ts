/** Read-only model research. Writes local price cache, predictions and aggregate evidence only.
 * npx tsx scripts/research-score-benchmarks.ts <output-directory> [--refresh]
 * No production writes, score generation jobs, posts, subscribers or orders. */
import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCompletedPriceDate, completedPriceDateCutoff } from '../src/lib/market-data/completed-price-bars';
import { stockSessionOpen } from '../src/lib/signal/publication-timing';
import { calculateDailyBias } from '../src/lib/macro-bias/calculate-daily-bias';
import { calculateCryptoDailyBias } from '../src/lib/crypto-bias/calculate-crypto-bias';
import { calculateRelativeStrengthIndex } from '../src/lib/macro-bias/technical-analysis';
import { STOCKS_LEVEL_FEATURES_FOR_PERCENTILE } from '../src/lib/macro-bias/constants';
import { CRYPTO_LEVEL_FEATURES_FOR_PERCENTILE } from '../src/lib/crypto-bias/constants';
import { stationarizeLevelFeatures, positionFromSignal, STOCKS_STRATEGY_RULES, CRYPTO_STRATEGY_RULES } from '../src/lib/signal';
import type { AnalogStateVector, TickerChangeMap } from '../src/lib/macro-bias/types';
import type { CryptoAnalogStateVector, CryptoTickerChangeMap } from '../src/lib/crypto-bias/types';
import { alignedTargetIndex, average, analogForecast, blockInterval, clamp, correlation, ewmaVariance, fitRidge, matureTraining, netReturn, predictRidge, round, tradingPosition, type FittedRidge, type ResearchRow } from './lib/scoring-research';

loadEnvConfig(process.cwd());
const recipeText = readFileSync('docs/scoring-research-recipe.json', 'utf8');
const recipe = JSON.parse(recipeText);
// The recipe remains fixed when later, explicitly dated shadow snapshots are collected.
const snapshotCutoff = process.argv.find(x => x.startsWith('--cutoff='))?.slice('--cutoff='.length) ?? recipe.completedPriceCutoff;
if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotCutoff) || !Number.isFinite(Date.parse(snapshotCutoff)) || new Date(Date.parse(snapshotCutoff)).toISOString().slice(0, 10) !== snapshotCutoff || snapshotCutoff > new Date().toISOString().slice(0, 10)) throw Error('Invalid or future snapshot cutoff');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const plusDays = (date: string, n: number) => new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
const pct = (a: number, b: number) => (b / a - 1) * 100;
const tickers = ['SPY', 'QQQ', 'TLT', 'GLD', 'USO', 'HYG', 'VIX', 'CPER', 'BTC-USD', 'ETH-USD', 'DXY'] as const;
type Price = { trade_date: string; open: number; close: number };
type Prices = Record<typeof tickers[number], Price[]>;
type Row = ResearchRow & { index: number; vector: Record<string, number>; rawVix: number; close: number; open: number; previousClose: number; forward1: number; forward3: number; mature3Date: string };
type Prediction = { score: number; position: number; expectedReturn: number | null; probabilityUp: number | null };
type Evaluation = { date: string; targetDate: string; outcome: number; predictions: Record<string, Prediction>; riskConstant: number; riskEwma: number };
const modelNames: string[] = [...recipe.baselines, ...recipe.challengers];
async function readPrices(directory: string): Promise<{ prices: Prices; fingerprint: string }> {
  const cachePath = join(directory, 'prices.json');
  let prices: Prices;
  if (existsSync(cachePath) && !process.argv.includes('--refresh')) {
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
    if (cache.cutoff !== snapshotCutoff) throw Error('Cache cutoff does not match requested snapshot; use a separate output directory');
    prices = cache.prices;
  } else {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Authorized price access unavailable');
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    prices = Object.fromEntries(await Promise.all(tickers.map(async ticker => {
      const rows: Price[] = [];
      for (let from = 0; ; from += 1000) {
        const completedCutoff = completedPriceDateCutoff(ticker.endsWith('-USD') ? 'BTC-USD' : 'SPY');
        const { data, error } = await db.from('etf_daily_prices').select('trade_date,open,close').eq('ticker', ticker).lte('trade_date', snapshotCutoff < completedCutoff ? snapshotCutoff : completedCutoff).order('trade_date').range(from, from + 999);
        if (error) throw Error(`Read unavailable: ${ticker}`);
        rows.push(...data ?? []);
        if (!data || data.length < 1000) break;
      }
      return [ticker, rows];
    }))) as Prices;
    writeFileSync(cachePath, JSON.stringify({ cutoff: snapshotCutoff, prices }) + '\n');
  }
  for (const ticker of tickers) {
    const rows = prices[ticker];
    // FX and volatility indices can have quotes on NYSE holidays. They do not
    // create equity target sessions; the primary SPY/BTC calendars determine those.
    const completedCutoff = completedPriceDateCutoff(ticker.endsWith('-USD') ? 'BTC-USD' : 'SPY');
    if (!Array.isArray(rows) || rows.length < 500 || rows.some((p, i) => !Number.isFinite(p.open) || !Number.isFinite(p.close) || p.open <= 0 || p.close <= 0 || p.trade_date > snapshotCutoff || p.trade_date > completedCutoff ||
      ((ticker === 'SPY' || ticker === 'BTC-USD') && !isCompletedPriceDate(ticker, p.trade_date)) || (i > 0 && p.trade_date <= rows[i - 1].trade_date))) throw Error(`Invalid, unfinished or incomplete price dataset: ${ticker}`);
  }
  return { prices, fingerprint: hash(JSON.stringify(prices)) };
}
function plannedStockTarget(sourceDate: string) {
  for (let offset = 1; offset <= 7; offset++) {
    const candidate = plusDays(sourceDate, offset);
    // Calendar eligibility only; never fabricate a future OHLC observation.
    if (isCompletedPriceDate('SPY', candidate, new Date(`${candidate}T23:00:00Z`))) return candidate;
  }
  throw Error('Next exchange session unavailable');
}
function ownFeatures(prices: Price[], i: number) {
  const returns = prices.slice(i - 20, i + 1).slice(1).map((p, j) => pct(prices[i - 20 + j].close, p.close));
  const m = average(returns), volatility20 = Math.max(0.01, Math.sqrt(average(returns.map(x => (x - m) ** 2))));
  const momentum20 = pct(prices[i - 20].close, prices[i].close), momentum60 = pct(prices[i - 60].close, prices[i].close);
  return { volatility20, momentum20, momentum60, features: [pct(prices[i - 1].close, prices[i].close), pct(prices[i - 5].close, prices[i].close), momentum20, momentum60, volatility20] };
}
function makeRows(prices: Prices, market: 'stocks' | 'crypto') {
  const stock = market === 'stocks', own = prices[stock ? 'SPY' : 'BTC-USD'];
  const maps = Object.fromEntries(tickers.map(t => [t, new Map(prices[t].map(p => [p.trade_date, p]))])) as Record<typeof tickers[number], Map<string, Price>>;
  const before = (ticker: typeof tickers[number], date: string) => {
    const series = prices[ticker]; let lo = 0, hi = series.length - 1, found = -1;
    while (lo <= hi) { const mid = (lo + hi) >>> 1; if (series[mid].trade_date <= date) { found = mid; lo = mid + 1; } else hi = mid - 1; }
    if (found < 0 || Date.parse(date) - Date.parse(series[found].trade_date) > 5 * 86400000) return null;
    return series[found];
  };
  const raw: (Row & { tradeDate: string })[] = [];
  let skippedFeatures = 0, missingTarget = 0;
  for (let i = 60; i < own.length; i++) {
    const date = own[i].trade_date;
    if (!stock && own.slice(i - 60, i + 1).some((p, j, a) => j > 0 && plusDays(a[j - 1].trade_date, 1) !== p.trade_date)) { skippedFeatures++; continue; }
    const targetIndex = alignedTargetIndex(market, own.map(p => p.trade_date), i), target = targetIndex === null ? undefined : own[targetIndex];
    if (targetIndex === null && i + (stock ? 1 : 2) < own.length) { missingTarget++; continue; }
    let vector: Record<string, number>, rawVix = 0;
    if (stock) {
      const get = (t: typeof tickers[number], lag = 0) => maps[t].get(own[i - lag].trade_date);
      if (['TLT', 'GLD', 'USO', 'HYG', 'VIX', 'CPER'].some(t => !get(t as typeof tickers[number]) || !get(t as typeof tickers[number], 5))) { skippedFeatures++; continue; }
      rawVix = get('VIX')!.close;
      vector = { spyRsi: calculateRelativeStrengthIndex(own.slice(0, i + 1).map(p => p.close), 14), vixMomentum: -pct(get('VIX', 5)!.close, rawVix), hygTltRatio: get('HYG')!.close / get('TLT')!.close,
        cperGldRatio: get('CPER')!.close / get('GLD')!.close, usoMomentum: pct(get('USO', 5)!.close, get('USO')!.close), vixLevel: rawVix };
    } else {
      const eth = maps['ETH-USD'].get(date), gold = before('GLD', date), dxy = before('DXY', date), oldDxy = before('DXY', own[i - 5].trade_date), tlt = before('TLT', date), oldTlt = before('TLT', own[i - 5].trade_date);
      if (!eth || !gold || !dxy || !oldDxy || !tlt || !oldTlt) { skippedFeatures++; continue; }
      const logs = own.slice(i - 20, i + 1).slice(1).map((p, j) => Math.log(p.close / own[i - 20 + j].close));
      const m = average(logs), vol = round(Math.sqrt(average(logs.map(x => (x - m) ** 2))) * Math.sqrt(365) * 100, 2);
      vector = { btcRsi: calculateRelativeStrengthIndex(own.slice(0, i + 1).map(p => p.close), 14), ethBtcRatio: eth.close / own[i].close, btcGldRatio: own[i].close / gold.close,
        dxyMomentum: pct(oldDxy.close, dxy.close), btcRealizedVol: vol, tltMomentum: pct(oldTlt.close, tlt.close) };
    }
    const extra = ownFeatures(own, i);
    raw.push({ date, tradeDate: date, index: i, vector, ...extra, rawVix, close: own[i].close, open: own[i].open, previousClose: own[i - 1].close,
      targetDate: target?.trade_date ?? (stock ? plannedStockTarget(date) : plusDays(date, 2)), outcome: target ? pct(target.open, target.close) : NaN,
      mature3Date: own[i + 3]?.trade_date ?? '9999-12-31', forward1: own[i + 1] ? pct(own[i].close, own[i + 1].close) : NaN,
      forward3: own[i + 3] ? pct(own[i].close, own[i + 3].close) : NaN });
  }
  const rows = stationarizeLevelFeatures(raw, stock ? STOCKS_LEVEL_FEATURES_FOR_PERCENTILE : CRYPTO_LEVEL_FEATURES_FOR_PERCENTILE, { window: 252, minHistory: 60 })
    .map(r => ({ ...r, features: [...Object.values(r.vector), ...r.features] }));
  return { rows, skippedFeatures, missingTarget };
}
function production(today: Row, rows: Row[], market: 'stocks' | 'crypto'): { score: number; position: number } {
  const history = rows.filter(r => r.date < today.date && r.mature3Date <= today.date && Number.isFinite(r.forward3));
  if (market === 'stocks') {
    const result = calculateDailyBias({ tradeDate: today.date, tickerChanges: { SPY: { ticker: 'SPY', tradeDate: today.date, close: today.close, previousClose: today.previousClose, percentChange: pct(today.previousClose, today.close), open: today.open } } as TickerChangeMap,
      expandedData: { historicalAnalogVectors: history.map(r => ({ tradeDate: r.date, vector: r.vector as AnalogStateVector, spyForward1DayReturn: r.forward1, spyForward3DayReturn: r.forward3 })),
        vix: { ticker: '^VIX', tradeDate: today.date, close: today.rawVix, previousClose: today.rawVix, percentChange: 0 }, spy14DayRsi: today.vector.spyRsi, vixMomentum: today.vector.vixMomentum, uso5DayMomentum: today.vector.usoMomentum,
        hygTltRatioPercentile: today.vector.hygTltRatio, cperGldRatioPercentile: today.vector.cperGldRatio, vixLevelPercentile: today.vector.vixLevel } });
    const p = positionFromSignal(result.signal, result.score, STOCKS_STRATEGY_RULES);
    return { score: result.score, position: p === 'LONG' ? 1 : p === 'SHORT' ? -1 : 0 };
  }
  const result = calculateCryptoDailyBias({ tradeDate: today.date, tickerChanges: {} as CryptoTickerChangeMap, expandedData: {
    historicalAnalogVectors: history.map(r => ({ tradeDate: r.date, vector: r.vector as CryptoAnalogStateVector, btcForward1DayReturn: r.forward1, btcForward3DayReturn: r.forward3 })),
    btc14DayRsi: today.vector.btcRsi, ethBtcRatioPercentile: today.vector.ethBtcRatio, btcGldRatioPercentile: today.vector.btcGldRatio, dxyMomentum: today.vector.dxyMomentum, btcRealizedVolPercentile: today.vector.btcRealizedVol, tltMomentum: today.vector.tltMomentum } });
  const p = positionFromSignal(result.signal, result.score, CRYPTO_STRATEGY_RULES);
  return { score: result.score, position: p === 'LONG' ? 1 : p === 'SHORT' ? -1 : 0 };
}
function evaluate(rows: Evaluation[], name: string, costPct: number) {
  const forecasts = rows.filter(r => r.predictions[name].expectedReturn !== null), probabilities = rows.filter(r => r.predictions[name].probabilityUp !== null);
  const returns = rows.map(r => netReturn(r.outcome, r.predictions[name].position, costPct));
  const positions = rows.map(r => r.predictions[name].position), active = rows.filter(r => r.predictions[name].position !== 0);
  let equity = 100, peak = 100, drawdown = 0;
  for (const r of returns) { equity *= 1 + r / 100; peak = Math.max(peak, equity); drawdown = Math.max(drawdown, 100 * (peak - equity) / peak); }
  const directional = rows.filter(r => r.predictions[name].score !== 0);
  return { sessions: rows.length, activeSessions: active.length, longPct: round(100 * positions.filter(p => p > 0).length / rows.length, 2), shortPct: round(100 * positions.filter(p => p < 0).length / rows.length, 2),
    directionalSessions: directional.length, directionHitPct: directional.length ? round(100 * directional.filter(r => Math.sign(r.predictions[name].score) === Math.sign(r.outcome)).length / directional.length, 2) : null,
    sameDirectionalSessionsAlwaysUpHitPct: directional.length ? round(100 * directional.filter(r => r.outcome > 0).length / directional.length, 2) : null,
    activeHitPct: active.length ? round(100 * active.filter(r => r.outcome * r.predictions[name].position > 0).length / active.length, 2) : null,
    returnMse: forecasts.length ? round(average(forecasts.map(r => (r.outcome - r.predictions[name].expectedReturn!) ** 2))) : null,
    brier: probabilities.length ? round(average(probabilities.map(r => (Number(r.outcome > 0) - r.predictions[name].probabilityUp!) ** 2))) : null,
    scoreReturnCorrelation: correlation(rows.map(r => r.predictions[name].score), rows.map(r => r.outcome)),
    meanNetSessionReturnPct: round(average(returns)), cumulativeUnitReturnPct: round(equity - 100, 2), maxDrawdownPct: round(drawdown, 2),
    meanNetSessionByCost: recipe.costSensitivityMultiples.map((multiple: number) => ({ roundTripCostBps: round(costPct * 100 * multiple), meanPct: round(average(rows.map(r => netReturn(r.outcome, r.predictions[name].position, costPct * multiple)))) })) };
}
function riskStats(rows: Evaluation[]) {
  const qlike = (variance: number, actual: number) => Math.log(variance) + actual ** 2 / variance;
  const differences = rows.map(r => qlike(r.riskEwma, r.outcome) - qlike(r.riskConstant, r.outcome));
  return { sessions: rows.length, constantQlike: round(average(rows.map(r => qlike(r.riskConstant, r.outcome)))), ewmaQlike: round(average(rows.map(r => qlike(r.riskEwma, r.outcome)))),
    ewmaMinusConstantQlike: round(average(differences)), paired95: blockInterval(differences, recipe.uncertainty.pairedMovingBlockSessions, recipe.uncertainty.replications, recipe.uncertainty.seed),
    constantAbsoluteReturnMae: round(average(rows.map(r => Math.abs(Math.abs(r.outcome) - Math.sqrt(r.riskConstant) * Math.sqrt(2 / Math.PI))))),
    ewmaAbsoluteReturnMae: round(average(rows.map(r => Math.abs(Math.abs(r.outcome) - Math.sqrt(r.riskEwma) * Math.sqrt(2 / Math.PI))))) };
}
function stats(rows: Evaluation[], costPct: number) {
  const models = Object.fromEntries(modelNames.map(name => [name, evaluate(rows, name, costPct)]));
  const challengers = Object.fromEntries(recipe.challengers.map((name: string) => {
    const mseDelta = rows.map(r => (r.outcome - r.predictions[name].expectedReturn!) ** 2 - (r.outcome - r.predictions.trailing_mean.expectedReturn!) ** 2);
    const brierDelta = rows.map(r => (Number(r.outcome > 0) - r.predictions[name].probabilityUp!) ** 2 - (Number(r.outcome > 0) - r.predictions.trailing_mean.probabilityUp!) ** 2);
    const netDelta = rows.map(r => netReturn(r.outcome, r.predictions[name].position, costPct) - netReturn(r.outcome, r.predictions.always_up.position, costPct));
    const netCash = rows.map(r => netReturn(r.outcome, r.predictions[name].position, costPct));
    const sameExposureDelta = rows.map(r => netReturn(r.outcome, r.predictions[name].position, costPct) - netReturn(r.outcome, Math.abs(r.predictions[name].position), costPct));
    return [name, { mseMinusTrailingMean: round(average(mseDelta)), msePaired95: blockInterval(mseDelta), brierMinusTrailingMean: round(average(brierDelta)), brierPaired95: blockInterval(brierDelta),
      netMinusAlwaysUpMeanPct: round(average(netDelta)), netPaired95: blockInterval(netDelta), netMinusCashMeanPct: round(average(netCash)), netMinusCashPaired95: blockInterval(netCash),
      netMinusSameExposureLongPct: round(average(sameExposureDelta)), netMinusSameExposureLongPaired95: blockInterval(sameExposureDelta) }];
  }));
  return { models, pairedComparisons: challengers, risk: riskStats(rows) };
}
async function main() {
  const directory = process.argv[2]; if (!directory) throw Error('Supply local output directory');
  mkdirSync(directory, { recursive: true });
  const { prices, fingerprint } = await readPrices(directory);
  const codeFiles = ['scripts/research-score-benchmarks.ts', 'scripts/lib/scoring-research.ts',
    'src/lib/macro-bias/calculate-daily-bias.ts', 'src/lib/macro-bias/constants.ts', 'src/lib/macro-bias/technical-analysis.ts',
    'src/lib/crypto-bias/calculate-crypto-bias.ts', 'src/lib/crypto-bias/constants.ts', 'src/lib/signal/strategy.ts',
    'src/lib/signal/rolling-percentile.ts', 'src/lib/signal/trend-veto.ts', 'src/utils/knn.ts', 'src/utils/regime-classifier.ts'];
  const fingerprints = { recipe: hash(recipeText), prices: fingerprint, code: hash(JSON.stringify(codeFiles.map(path => [path, readFileSync(path, 'utf8')]))),
    files: Object.fromEntries(codeFiles.map(path => [path, hash(readFileSync(path, 'utf8'))])) };
  const report: Record<string, unknown> = { generatedAt: new Date().toISOString(), snapshotCutoff, recipe, fingerprints,
    priceCoverage: Object.fromEntries(tickers.map(t => [t, { rows: prices[t].length, first: prices[t][0].trade_date, last: prices[t].at(-1)!.trade_date }])),
    caveats: ['Historical reconstruction from current stored, unadjusted open/close quotes, not original data vintages or actual executed trades. Publication timing is an explicit assumption, not historical delivery verification.',
      'All 2020-2026 periods have previously been inspected. Chronological fits prevent lookahead but do not remove historical model-selection bias.',
      'SPY open-close excludes overnight returns and dividends. BTC targets start at the first full UTC session after assumed next-day noon publication. This sacrifices freshness to avoid a fictional entry.',
      'Production scores target different one/three-close blends; only directional and trading diagnostics are comparable. They are not probabilities or return forecasts for this target; their Brier/MSE are unavailable.',
      'All models are evaluated on identical dates within a market. Cash earns zero; always-up reopens every target session and pays the same round-trip costs, not buy-and-hold. Gross result is also reported.',
      'Unit-exposure long/short diagnostics omit borrow, financing, variable spreads, taxes, position sizing and latency. Cash/exposure differ; cumulative returns do not establish investable superiority.',
      'Paired 20-session block intervals are descriptive, not multiple-testing-adjusted significance. Windows differ between markets and must not be combined.',
      'No production model change is selected by this report. Genuine prospective evidence requires predictions timestamped before future target opens. Local shadow locks are append-only files, not a hosted daily collection service.'] };
  for (const market of ['stocks', 'crypto'] as const) {
    const { rows, skippedFeatures, missingTarget } = makeRows(prices, market), costPct = recipe.roundTripCostBps[market] / 100;
    const evaluations: Evaluation[] = [], predictions: unknown[] = [];
    let returnModel: FittedRidge | undefined, probabilityModel: FittedRidge | undefined, fittedMonth = '', fitCount = 0, maxTrainingTargetDate = '', trainingCount = 0;
    for (const today of rows) {
      if (today.date < recipe.evaluationStart) continue;
      const train = matureTraining(rows, today.date, recipe.trainingCalendarDays);
      if (train.length < recipe.minimumTrainingRows) continue;
      const month = today.date.slice(0, 7);
      if (month !== fittedMonth) {
        returnModel = fitRidge(train, train.map(r => r.outcome / Math.max(r.volatility20, 0.01)), recipe.ridgePenaltyMeanLoss, recipe.featureClipStandardDeviations);
        probabilityModel = fitRidge(train, train.map(r => Number(r.outcome > 0)), recipe.ridgePenaltyMeanLoss, recipe.featureClipStandardDeviations);
        fittedMonth = month; fitCount++; maxTrainingTargetDate = train.at(-1)!.targetDate; trainingCount = train.length;
      }
      const base = average(train.map(r => r.outcome)), pBase = average(train.map(r => Number(r.outcome > 0)));
      const analog = analogForecast(train, today, recipe.analogueNeighbors, recipe.analoguePriorWeight, recipe.featureClipStandardDeviations);
      const ridge = { expectedReturn: predictRidge(returnModel!, today.features) * today.volatility20, probabilityUp: clamp(predictRidge(probabilityModel!, today.features), 0.01, 0.99) };
      const original = production(today, rows, market);
      const expected = (value: { expectedReturn: number; probabilityUp: number }): Prediction => ({ ...value, score: value.expectedReturn, position: tradingPosition(value.expectedReturn, costPct) });
      const entries: Record<string, Prediction> = {
        cash: { score: 0, position: 0, expectedReturn: 0, probabilityUp: 0.5 },
        always_up: { score: 1, position: 1, expectedReturn: null, probabilityUp: 1 },
        trailing_mean: expected({ expectedReturn: base, probabilityUp: pBase }),
        momentum_20: { score: today.momentum20, position: Math.sign(today.momentum20), expectedReturn: null, probabilityUp: null },
        momentum_60: { score: today.momentum60, position: Math.sign(today.momentum60), expectedReturn: null, probabilityUp: null },
        production_raw: { score: original.score, position: Math.abs(original.score) > 20 ? Math.sign(original.score) : 0, expectedReturn: null, probabilityUp: null },
        production_filtered: { score: original.score, position: original.position, expectedReturn: null, probabilityUp: null },
        aligned_shrunk_analog: expected(analog), aligned_ridge: expected(ridge),
      };
      if (maxTrainingTargetDate >= today.date) throw Error('Training label escaped embargo');
      const riskConstant = average(train.map(r => r.outcome ** 2)), riskEwma = ewmaVariance(train);
      predictions.push({ date: today.date, targetDate: today.targetDate || null, generatedAt: new Date().toISOString(), kind: 'historical_reconstruction_not_prospective',
        ridgeFitMonth: fittedMonth, ridgeTrainingRows: trainingCount, ridgeMaxTrainingTargetDate: maxTrainingTargetDate, analogTrainingRows: train.length, analogMaxTrainingTargetDate: train.at(-1)!.targetDate,
        predictions: entries, riskConstant, riskEwma, state: { momentum20: today.momentum20, momentum60: today.momentum60, dailyVolatility20Pct: today.volatility20 } });
      // Keep the original research evaluation fixed when taking later forward snapshots.
      if (!today.targetDate || today.targetDate > recipe.completedPriceCutoff || !Number.isFinite(today.outcome)) continue;
      evaluations.push({ date: today.date, targetDate: today.targetDate, outcome: today.outcome, predictions: entries, riskConstant, riskEwma });
      if (evaluations.length % 400 === 0) console.log(`${market}: ${evaluations.length} aligned sessions`);
    }
    if (!evaluations.length) throw Error(`No complete evaluation: ${market}`);
    const years = [...new Set(evaluations.map(r => r.targetDate.slice(0, 4)))];
    const annual = years.map(year => { const y = evaluations.filter(r => r.targetDate.startsWith(year)); return { year, sessions: y.length, models: Object.fromEntries(modelNames.map(name => [name, evaluate(y, name, costPct)])), risk: riskStats(y) }; });
    const overall = stats(evaluations, costPct), reviewed2026 = stats(evaluations.filter(r => r.targetDate >= '2026-01-01'), costPct);
    const decisions = Object.fromEntries(recipe.challengers.map((name: string) => {
      const checks = { improvesReturnMseOverall: overall.models[name].returnMse! < overall.models.trailing_mean.returnMse!,
        improvesReturnMse2026: reviewed2026.models[name].returnMse! < reviewed2026.models.trailing_mean.returnMse!,
        improvesBrierOverall: overall.models[name].brier! < overall.models.trailing_mean.brier!,
        improvesBrier2026: reviewed2026.models[name].brier! < reviewed2026.models.trailing_mean.brier!,
        positiveNetAtBaseCost: overall.models[name].meanNetSessionReturnPct > 0, positiveNetAtDoubleCost: overall.models[name].meanNetSessionByCost[2].meanPct > 0,
        positiveNet2026: reviewed2026.models[name].meanNetSessionReturnPct > 0, positiveNetEveryYear: annual.every(y => y.models[name].meanNetSessionReturnPct > 0),
        prospectiveValidationComplete: false };
      return [name, { decision: 'DO_NOT_PROMOTE', checks, failedChecks: Object.entries(checks).filter(([, pass]) => !pass).map(([key]) => key) }];
    }));
    const latest = predictions.at(-1) as { date: string; targetDate: string; [key: string]: unknown };
    const targetOpen = market === 'stocks' ? stockSessionOpen(latest.targetDate) : Date.parse(`${latest.targetDate}T00:00:00Z`);
    let forwardLock = { status: 'NO_ELIGIBLE_FUTURE_TARGET', path: null as string | null };
    if (process.argv.includes('--lock-forward') && targetOpen && Date.now() < targetOpen) {
      const lockDirectory = join(directory, 'shadow'); mkdirSync(lockDirectory, { recursive: true });
      const path = join(lockDirectory, `${market}-${latest.date}-${latest.targetDate}.json`);
      const lock = { ...latest, kind: 'prospective_shadow_before_target_open', lockedAt: new Date().toISOString(), targetOpen: new Date(targetOpen).toISOString(), fingerprints,
        productionDecision: 'UNCHANGED', note: 'No outcome known at lock time. Neither challenger is approved for production.' };
      if (existsSync(path)) {
        const prior = JSON.parse(readFileSync(path, 'utf8'));
        if (prior.fingerprints.code !== fingerprints.code || prior.fingerprints.recipe !== fingerprints.recipe) throw Error('Existing shadow lock belongs to a different frozen recipe/code; do not overwrite it');
        forwardLock = { status: 'EXISTING_LOCK_PRESERVED', path };
      } else { writeFileSync(path, JSON.stringify(lock, null, 2) + '\n', { flag: 'wx' }); forwardLock = { status: 'LOCKED_BEFORE_TARGET_OPEN', path }; }
    }
    const asset = prices[market === 'stocks' ? 'SPY' : 'BTC-USD'];
    const first = asset.find(p => p.trade_date === evaluations[0].targetDate)!, last = asset.find(p => p.trade_date === evaluations.at(-1)!.targetDate)!;
    let holdPeak = first.open, holdDrawdown = 0;
    for (const p of asset.filter(p => p.trade_date >= first.trade_date && p.trade_date <= last.trade_date)) { holdPeak = Math.max(holdPeak, p.close); holdDrawdown = Math.max(holdDrawdown, 100 * (holdPeak - p.close) / holdPeak); }
    const continuousHoldingContext = { firstTarget: first.trade_date, lastTarget: last.trade_date, grossPriceReturnPct: round(pct(first.open, last.close), 2),
      approximateNetAfterOneRoundTripPct: round(pct(first.open, last.close) - costPct, 2), closeObservedDrawdownPct: round(holdDrawdown, 2),
      caveat: 'Additional context, not matched target exposure: continuously invested including overnight/weekend gaps, one entry/exit, no dividends, financing or taxes. Daily intraday always-up is not buy-and-hold.' };
    report[market] = { sessions: evaluations.length, firstSource: evaluations[0].date, lastSource: evaluations.at(-1)!.date, lastTarget: evaluations.at(-1)!.targetDate,
      skippedFeatures, missingTarget, ridgeFits: fitCount, overall, reviewed2026, annual, decisions, continuousHoldingContext, forwardLock,
      latestReconstructedPrediction: predictions.at(-1), promotion: 'RESEARCH_ONLY_PENDING_PROSPECTIVE_VALIDATION' };
    writeFileSync(join(directory, `${market}-predictions.json`), JSON.stringify(predictions, null, 2) + '\n');
    writeFileSync(join(directory, `${market}-evaluations.json`), JSON.stringify(evaluations) + '\n');
    console.log(JSON.stringify({ market, sessions: evaluations.length, decisions, forwardLock }));
  }
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Saved aggregate report to ${join(directory, 'report.json')}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Research unavailable'); process.exitCode = 1; });
