/** Read-only fixed-policy ablation; never writes scores or sends anything.
 * npx tsx scripts/evaluate-stock-lowvol-filter.ts <output.json> [completed-cutoff-YYYY-MM-DD]
 * Reconstructed history is not an out-of-sample live trading record. */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { ANALOG_MODEL_SETTINGS as settings, STOCKS_LEVEL_FEATURES_FOR_PERCENTILE, STOCKS_KNN_FEATURE_KEYS, STRATEGY_RULES } from '../src/lib/macro-bias/constants';
import { applyFadeBigDay, applyOvernightVeto, applySoftOvernightAmp, calculateDailyBias, neighborReturnDispersion, selectNeighborK } from '../src/lib/macro-bias/calculate-daily-bias';
import { buildTradableSignal, inverseDistanceWeight, positionFromSignal, stationarizeLevelFeatures, weightedMean } from '../src/lib/signal';
import { classifyRegime, resolveThresholds } from '../src/utils/regime-classifier';
import { isUsEquityMonday, calculateBaseDistance } from '../src/utils/knn';
import type { AnalogStateVector, DailyBiasInput, HistoricalAnalogVector, TickerChangeMap } from '../src/lib/macro-bias/types';

const cutoff = process.argv[3] ?? '2026-10-21'; // Explicit completed-session cutoff; never infer unfinished outcomes.
if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff) || !Number.isFinite(Date.parse(`${cutoff}T00:00:00Z`))) throw Error('Supply cutoff as YYYY-MM-DD');
const tickers = ['SPY', 'QQQ', 'TLT', 'GLD', 'USO', 'HYG', 'VIX', 'CPER'] as const;
type Price = { trade_date: string; open: number; close: number };
type Point = HistoricalAnalogVector & { index: number; close: number; open: number; ctc: number; overnight: number; outcomeDate: string | null; outcome: number | null };
const mean = (v: number[]) => v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
const pct = (a: number, b: number) => (b / a - 1) * 100;
const round = (n: number, digits = 2) => Number(n.toFixed(digits));
const dayGap = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86_400_000;
const scoreOf = (n: { analog: Point; weight: number }[]) => {
  const w = n.map(x => x.weight);
  const blend = round(weightedMean(n.map(x => x.analog.spyForward1DayReturn), w) * settings.oneDayBlendWeight
    + weightedMean(n.map(x => x.analog.spyForward3DayReturn), w) * settings.threeDayBlendWeight);
  return Math.round(Math.tanh(blend / settings.blendedReturnScale) * 100);
};
function rsiSeries(closes: number[]) {
  const out: (number | null)[] = closes.map(() => null);
  let gain = 0, loss = 0;
  for (let i = 1; i <= 14; i++) { const d = closes[i] - closes[i - 1]; gain += Math.max(0, d); loss += Math.max(0, -d); }
  gain /= 14; loss /= 14;
  out[14] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = 15; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]; gain = (gain * 13 + Math.max(0, d)) / 14; loss = (loss * 13 + Math.max(0, -d)) / 14;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}
type Decision = { score: number; position: string; zero: boolean };
type Day = { date: string; outcomeDate: string; outcome: number; filterTriggered: boolean; on: Decision; off: Decision };
function summary(days: Day[], variant: 'on' | 'off') {
  const active = days.filter(d => ['LONG', 'SHORT'].includes(d[variant].position));
  const returns = days.map(d => d[variant].position === 'LONG' ? d.outcome : d[variant].position === 'SHORT' ? -d.outcome : 0);
  const activeReturns = active.map(d => d[variant].position === 'LONG' ? d.outcome : -d.outcome);
  const net = days.map((d, i) => returns[i] - (['LONG', 'SHORT'].includes(d[variant].position) ? 2 * STRATEGY_RULES.frictionBps / 100 : 0));
  let equity = 100, peak = 100, drawdown = 0;
  for (const r of net) { equity *= 1 + r / 100; peak = Math.max(peak, equity); drawdown = Math.max(drawdown, (peak - equity) / peak * 100); }
  return { sessions: days.length, activeSessions: active.length, cashPct: round(100 * (days.length - active.length) / days.length),
    zeroScorePct: round(100 * days.filter(d => d[variant].zero).length / days.length),
    hitRatePct: active.length ? round(100 * activeReturns.filter(x => x > 0).length / active.length) : null,
    meanGrossActiveReturnPct: active.length ? round(mean(activeReturns), 4) : null,
    meanNetReturnAllSessionsPct: round(mean(net), 4), netCumulativeUnitReturnPct: round(equity - 100), maxDrawdownPct: round(drawdown) };
}
async function main() {
  const output = process.argv[2]; if (!output) throw Error('Supply an output JSON path outside the repository.');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const series = await Promise.all(tickers.map(async ticker => {
    const rows: Price[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.from('etf_daily_prices').select('trade_date,open,close').eq('ticker', ticker)
        .lte('trade_date', cutoff).order('trade_date').range(offset, offset + 999);
      if (error) throw Error(`Price read failed for ${ticker}`);
      for (const row of data ?? []) { if (!(row.close > 0) || !(row.open > 0)) throw Error(`Invalid price for ${ticker}`); rows.push(row); }
      if (!data || data.length < 1000) break;
    }
    return rows;
  }));
  const maps = Object.fromEntries(tickers.map((t, i) => [t, new Map(series[i].map(p => [p.trade_date, p]))])) as Record<typeof tickers[number], Map<string, Price>>;
  const dates = series[0].map(p => p.trade_date).filter(d => tickers.every(t => maps[t].has(d)));
  const closes = dates.map(d => maps.SPY.get(d)!.close), rsi = rsiSeries(closes);
  const raw: Point[] = [];
  for (let i = 14; i < dates.length; i++) {
    const get = (ticker: typeof tickers[number], at = i) => maps[ticker].get(dates[at])!;
    const current = get('SPY'), previous = get('SPY', i - 1);
    raw.push({ tradeDate: dates[i], index: i, vector: { spyRsi: rsi[i]!, vixMomentum: -pct(get('VIX', i - 5).close, get('VIX').close),
      hygTltRatio: get('HYG').close / get('TLT').close, cperGldRatio: get('CPER').close / get('GLD').close,
      usoMomentum: pct(get('USO', i - 5).close, get('USO').close), vixLevel: get('VIX').close },
      spyForward1DayReturn: i + 1 < dates.length ? pct(current.close, get('SPY', i + 1).close) : NaN,
      spyForward3DayReturn: i + 3 < dates.length ? pct(current.close, get('SPY', i + 3).close) : NaN,
      close: current.close, open: current.open, ctc: pct(previous.close, current.close), overnight: pct(previous.close, current.open),
      outcomeDate: dates[i + 1] ?? null, outcome: i + 1 < dates.length ? pct(get('SPY', i + 1).open, get('SPY', i + 1).close) : null });
  }
  const points = stationarizeLevelFeatures(raw, STOCKS_LEVEL_FEATURES_FOR_PERCENTILE, { window: settings.percentileWindowSessions, minHistory: settings.percentileMinHistorySessions });
  const days: Day[] = []; let parityChecks = 0;
  for (let ti = 0; ti < points.length; ti++) {
    const today = points[ti];
    if (today.tradeDate < '2020-01-01' || !today.outcomeDate || today.outcome == null) continue;
    // Only mature three-session labels available at the source close enter calibration or matching.
    const history = points.slice(0, ti).filter(p => p.index + 3 <= today.index && Number.isFinite(p.spyForward3DayReturn));
    if (history.length < 20) continue;
    const thresholds = resolveThresholds({ calibrationDataset: history });
    const regime = classifyRegime(today.vector, { thresholds });
    const same = history.filter(p => classifyRegime(p.vector, { thresholds }) === regime);
    const pool = same.length >= 20 ? same : history;
    const stats = Object.fromEntries(STOCKS_KNN_FEATURE_KEYS.map(k => {
      const values = pool.map(p => p.vector[k]), m = mean(values);
      return [k, { mean: m, sd: Math.sqrt(mean(values.map(v => (v - m) ** 2))) || 1 }];
    }));
    const z = (v: AnalogStateVector) => Object.fromEntries(STOCKS_KNN_FEATURE_KEYS.map(k => [k, (v[k] - stats[k].mean) / stats[k].sd]));
    const tz = z(today.vector);
    const neighbors = pool.filter(p => dayGap(today.tradeDate, p.tradeDate) >= settings.minAnalogCalendarGapDays).map(analog => {
      const distance = calculateBaseDistance({ tradeDate: today.tradeDate, vector: tz }, { tradeDate: analog.tradeDate, vector: z(analog.vector) }, settings.distanceMetric, [...STOCKS_KNN_FEATURE_KEYS])
        * Math.exp(settings.temporalDecayLambda * dayGap(today.tradeDate, analog.tradeDate));
      return { analog, distance, weight: inverseDistanceWeight(distance, settings.distanceWeightEpsilon) };
    }).sort((a, b) => a.distance - b.distance).slice(0, selectNeighborK(today.vector.vixLevel));
    const blended = neighbors.map(n => n.analog.spyForward1DayReturn * settings.oneDayBlendWeight + n.analog.spyForward3DayReturn * settings.threeDayBlendWeight);
    const rawScore = scoreOf(neighbors), triggered = neighborReturnDispersion(blended) < settings.flatLowNeighborVolThreshold;
    const decision = (enabled: boolean): Decision => {
      let score = enabled && triggered ? 0 : rawScore;
      score = applyFadeBigDay(score, today.ctc); score = applySoftOvernightAmp(score, today.overnight); score = applyOvernightVeto(score, today.overnight);
      const signal = buildTradableSignal({ score, neighborForwardReturns: blended, neighborDistances: neighbors.map(n => n.distance), rules: STRATEGY_RULES });
      if (settings.skipMondayScores && isUsEquityMonday(today.tradeDate)) { score = 0; if (signal.position !== 'NO_TRADE') { signal.position = 'FLAT'; signal.size = 0; } }
      return { score, position: positionFromSignal(signal, score, STRATEGY_RULES), zero: score === 0 };
    };
    const on = decision(true), off = decision(false);
    if (ti % 140 === 0 || today.tradeDate >= '2026-10-19') {
      const input = { tradeDate: today.tradeDate, tickerChanges: { SPY: { ticker: 'SPY', tradeDate: today.tradeDate, close: today.close, previousClose: today.close / (1 + today.ctc / 100), percentChange: today.ctc, open: today.open } } as TickerChangeMap,
        expandedData: { historicalAnalogVectors: history, spy14DayRsi: today.vector.spyRsi, vixMomentum: today.vector.vixMomentum, uso5DayMomentum: today.vector.usoMomentum,
          hygTltRatioPercentile: today.vector.hygTltRatio, cperGldRatioPercentile: today.vector.cperGldRatio, vixLevelPercentile: today.vector.vixLevel } } satisfies DailyBiasInput;
      const actual = calculateDailyBias(input);
      if (actual.score !== on.score || positionFromSignal(actual.signal, actual.score, STRATEGY_RULES) !== on.position) throw Error(`Production parity failed on ${today.tradeDate}`);
      parityChecks++;
    }
    days.push({ date: today.tradeDate, outcomeDate: today.outcomeDate, outcome: today.outcome, filterTriggered: triggered, on, off });
  }
  const affected = days.filter(d => d.on.position !== d.off.position);
  const blocked = affected.filter(d => d.on.position === 'CASH' && d.off.position !== 'CASH');
  const years = [...new Set(days.map(d => d.outcomeDate.slice(0, 4)))].map(year => {
    const group = days.filter(d => d.outcomeDate.startsWith(year)); return { year, on: summary(group, 'on'), off: summary(group, 'off') };
  });
  const report = { generatedAt: new Date().toISOString(), cutoff, model: 'macro-model-v18-adaptive-k', threshold: settings.flatLowNeighborVolThreshold,
    methodology: { comparison: 'Only the low-neighbor-return-dispersion filter differs; other scoring/permission rules fixed.',
      horizon: 'Next completed SPY session open-to-close, unit directional exposure, flat overnight.',
      cost: `Round trip ${2 * STRATEGY_RULES.frictionBps} basis points on every active session.`,
      causal: 'Trailing feature ranks; only matured three-session labels in calibration and neighbors; minimum calendar gap; past-only regime/stats.',
      caveats: ['Reconstructed prices and current scoring rules, not live out-of-sample performance.', 'Reconstruction uses the available historical warmup/window rather than reproducing each original ten-year data fetch. Parity checks validate the engine on reconstructed inputs, not against original historical publications.', '2020–2026 influenced prior model selection; yearly slices are descriptive, not untouched holdouts.', 'No threshold search; transaction-cost assumption excludes variable slippage/borrowing costs.', 'Results do not establish future returns or marketing ROI.'] },
    priceCoverage: Object.fromEntries(tickers.map((t, i) => [t, { rows: series[i].length, first: series[i][0]?.trade_date, last: series[i].at(-1)?.trade_date }])),
    parityChecks, filterTriggeredSessions: days.filter(d => d.filterTriggered).length, changedDecisions: affected.length,
    blockedTrades: { count: blocked.length, off: summary(blocked, 'off') }, overall: { on: summary(days, 'on'), off: summary(days, 'off') }, years,
    recent: { on: summary(days.filter(d => d.date >= '2025-01-01'), 'on'), off: summary(days.filter(d => d.date >= '2025-01-01'), 'off') },
    lastSessions: days.slice(-15) };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, parityChecks, changedDecisions: report.changedDecisions, filterTriggeredSessions: report.filterTriggeredSessions,
    overall: report.overall, blockedTrades: report.blockedTrades, years: years.map(y => ({ year: y.year, onNet: y.on.meanNetReturnAllSessionsPct, offNet: y.off.meanNetReturnAllSessionsPct, onActive: y.on.activeSessions, offActive: y.off.activeSessions })) }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Filter evaluation failed'); process.exitCode = 1; });
