import { isCompletedPriceDate } from '../market-data/completed-price-bars';
import { calculateDailyBias } from '../macro-bias/calculate-daily-bias';
import { calculateCryptoDailyBias } from '../crypto-bias/calculate-crypto-bias';
import { STOCKS_LEVEL_FEATURES_FOR_PERCENTILE } from '../macro-bias/constants';
import { CRYPTO_LEVEL_FEATURES_FOR_PERCENTILE } from '../crypto-bias/constants';
import { stationarizeLevelFeatures } from '../signal/rolling-percentile';
import { positionFromSignal, STOCKS_STRATEGY_RULES, CRYPTO_STRATEGY_RULES } from '../signal/strategy';
import type { AnalogStateVector, TickerChangeMap } from '../macro-bias/types';
import type { CryptoAnalogStateVector, CryptoTickerChangeMap } from '../crypto-bias/types';
import { alignedTargetIndex, average, round, type ResearchRow } from './math';
const plusDays = (date: string, n: number) => new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
const pct = (a: number, b: number) => (b / a - 1) * 100;
export const tickers = ['SPY', 'QQQ', 'TLT', 'GLD', 'USO', 'HYG', 'VIX', 'CPER', 'BTC-USD', 'ETH-USD', 'DXY'] as const;
export type Price = { trade_date: string; open: number; close: number };
export type Prices = Record<typeof tickers[number], Price[]>;
export type Row = ResearchRow & { index: number; vector: Record<string, number>; rawVix: number; close: number; open: number; previousClose: number; forward1: number; forward3: number; mature3Date: string };
/** Same Wilder recurrence and two-decimal output as the daily technical helper. */
export function relativeStrengthSeries(closes: number[]) {
  const result = closes.map(() => NaN);
  if (closes.length < 15) return result;
  let gain = 0, loss = 0;
  for (let i = 1; i <= 14; i++) { const d = closes[i] - closes[i - 1]; gain += Math.max(d, 0); loss += Math.max(-d, 0); }
  gain /= 14; loss /= 14;
  const value = () => loss === 0 ? 100 : gain === 0 ? 0 : round(100 - 100 / (1 + gain / loss), 2);
  result[14] = value();
  for (let i = 15; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]; gain = (gain * 13 + Math.max(d, 0)) / 14; loss = (loss * 13 + Math.max(-d, 0)) / 14;
    result[i] = value();
  }
  return result;
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
export function makeRows(prices: Prices, market: 'stocks' | 'crypto') {
  const stock = market === 'stocks', own = prices[stock ? 'SPY' : 'BTC-USD'];
  const dates = own.map(p => p.trade_date), rsi = relativeStrengthSeries(own.map(p => p.close));
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
    const targetIndex = alignedTargetIndex(market, dates, i), target = targetIndex === null ? undefined : own[targetIndex];
    if (targetIndex === null && i + (stock ? 1 : 2) < own.length) { missingTarget++; continue; }
    let vector: Record<string, number>, rawVix = 0;
    if (stock) {
      const get = (t: typeof tickers[number], lag = 0) => maps[t].get(own[i - lag].trade_date);
      if (['TLT', 'GLD', 'USO', 'HYG', 'VIX', 'CPER'].some(t => !get(t as typeof tickers[number]) || !get(t as typeof tickers[number], 5))) { skippedFeatures++; continue; }
      rawVix = get('VIX')!.close;
      vector = { spyRsi: rsi[i], vixMomentum: -pct(get('VIX', 5)!.close, rawVix), hygTltRatio: get('HYG')!.close / get('TLT')!.close,
        cperGldRatio: get('CPER')!.close / get('GLD')!.close, usoMomentum: pct(get('USO', 5)!.close, get('USO')!.close), vixLevel: rawVix };
    } else {
      const eth = maps['ETH-USD'].get(date), gold = before('GLD', date), dxy = before('DXY', date), oldDxy = before('DXY', own[i - 5].trade_date), tlt = before('TLT', date), oldTlt = before('TLT', own[i - 5].trade_date);
      if (!eth || !gold || !dxy || !oldDxy || !tlt || !oldTlt) { skippedFeatures++; continue; }
      const logs = own.slice(i - 20, i + 1).slice(1).map((p, j) => Math.log(p.close / own[i - 20 + j].close));
      const m = average(logs), vol = round(Math.sqrt(average(logs.map(x => (x - m) ** 2))) * Math.sqrt(365) * 100, 2);
      vector = { btcRsi: rsi[i], ethBtcRatio: eth.close / own[i].close, btcGldRatio: own[i].close / gold.close,
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
export function production(today: Row, rows: Row[], market: 'stocks' | 'crypto'): { score: number; position: number } {
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
