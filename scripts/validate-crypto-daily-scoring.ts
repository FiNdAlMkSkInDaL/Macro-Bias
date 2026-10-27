/** Read-only causal reconstruction with the actual crypto engine. Never sends or stores scores. */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { calculateCryptoDailyBias } from '../src/lib/crypto-bias/calculate-crypto-bias';
import { CRYPTO_LEVEL_FEATURES_FOR_PERCENTILE, CRYPTO_ANALOG_MODEL_SETTINGS as settings } from '../src/lib/crypto-bias/constants';
import { calculateRelativeStrengthIndex } from '../src/lib/macro-bias/technical-analysis';
import { stationarizeLevelFeatures, positionFromSignal, CRYPTO_STRATEGY_RULES } from '../src/lib/signal';
import type { CryptoHistoricalAnalogVector, CryptoTickerChangeMap } from '../src/lib/crypto-bias/types';
type Price = { trade_date: string; close: number };
type Point = CryptoHistoricalAnalogVector & { index: number };
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const pct = (a: number, b: number) => (b / a - 1) * 100;
const round = (n: number, d = 4) => Number(n.toFixed(d));
async function main() {
  const output = process.argv[2], cutoff = process.argv[3] ?? '2026-10-26';
  if (!output || !/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) throw Error('Supply output and completed cutoff');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const tickers = ['BTC-USD', 'ETH-USD', 'GLD', 'DXY', 'TLT'] as const;
  const series = await Promise.all(tickers.map(async ticker => {
    const rows: Price[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('etf_daily_prices').select('trade_date,close').eq('ticker', ticker).lte('trade_date', cutoff).order('trade_date').range(from, from + 999);
      if (error) throw Error('Crypto validation price read unavailable');
      if ((data ?? []).some(p => !(p.close > 0))) throw Error('Invalid crypto validation price');
      rows.push(...data ?? []); if (!data || data.length < 1000) break;
    }
    if (!rows.length) throw Error(`No ${ticker} history`); return rows;
  }));
  const eth = new Map(series[1].map(p => [p.trade_date, p.close]));
  const btc = series[0].filter(p => eth.has(p.trade_date)), dates = btc.map(p => p.trade_date), closes = btc.map(p => p.close);
  const filled = series.slice(2).map(prices => { let at = -1; return dates.map(date => { while (at + 1 < prices.length && prices[at + 1].trade_date <= date) at++; return at < 0 ? null : prices[at].close; }); });
  const raw: Point[] = [];
  for (let i = 20; i < dates.length; i++) {
    if (filled.some(p => p[i] == null || p[i - 5] == null)) continue;
    const logs = closes.slice(i - 20, i + 1).slice(1).map((close, j) => Math.log(close / closes[i - 20 + j]));
    const m = mean(logs), vol = round(Math.sqrt(mean(logs.map(r => (r - m) ** 2))) * Math.sqrt(365) * 100, 2);
    raw.push({ tradeDate: dates[i], index: i, vector: { btcRsi: calculateRelativeStrengthIndex(closes.slice(0, i + 1), 14),
      ethBtcRatio: eth.get(dates[i])! / closes[i], btcGldRatio: closes[i] / filled[0][i]!,
      dxyMomentum: pct(filled[1][i - 5]!, filled[1][i]!), btcRealizedVol: vol, tltMomentum: pct(filled[2][i - 5]!, filled[2][i]!) },
      btcForward1DayReturn: i + 1 < dates.length ? pct(closes[i], closes[i + 1]) : NaN,
      btcForward3DayReturn: i + 3 < dates.length ? pct(closes[i], closes[i + 3]) : NaN });
  }
  const points = stationarizeLevelFeatures(raw, CRYPTO_LEVEL_FEATURES_FOR_PERCENTILE, { window: settings.percentileWindowSessions, minHistory: settings.percentileMinHistorySessions });
  const results: { date: string; score: number; position: string; forward1: number; forward3: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const today = points[i]; if (today.tradeDate < '2020-01-01' || !Number.isFinite(today.btcForward1DayReturn)) continue;
    const history = points.slice(0, i).filter(p => p.index + 3 <= today.index && Number.isFinite(p.btcForward3DayReturn));
    if (history.length < 20) continue;
    const result = calculateCryptoDailyBias({ tradeDate: today.tradeDate, tickerChanges: {} as CryptoTickerChangeMap,
      expandedData: { historicalAnalogVectors: history, btc14DayRsi: today.vector.btcRsi, ethBtcRatioPercentile: today.vector.ethBtcRatio, btcGldRatioPercentile: today.vector.btcGldRatio,
        dxyMomentum: today.vector.dxyMomentum, btcRealizedVolPercentile: today.vector.btcRealizedVol, tltMomentum: today.vector.tltMomentum } });
    results.push({ date: today.tradeDate, score: result.score, position: positionFromSignal(result.signal, result.score, CRYPTO_STRATEGY_RULES), forward1: today.btcForward1DayReturn, forward3: today.btcForward3DayReturn });
  }
  const correlation = (rows: typeof results, horizon: 'forward1' | 'forward3') => {
    const r = rows.filter(p => Number.isFinite(p[horizon])); if (r.length < 3) return null;
    const a = mean(r.map(p => p.score)), b = mean(r.map(p => p[horizon]));
    const denominator = Math.sqrt(r.reduce((s, p) => s + (p.score - a) ** 2, 0) * r.reduce((s, p) => s + (p[horizon] - b) ** 2, 0));
    return denominator ? round(r.reduce((s, p) => s + (p.score - a) * (p[horizon] - b), 0) / denominator) : null;
  };
  function stats(rows: typeof results) {
    return { sessions: rows.length, zeroScores: rows.filter(r => r.score === 0).length, neutralPct: round(100 * rows.filter(r => Math.abs(r.score) <= 20).length / rows.length, 2),
      correlation1: correlation(rows, 'forward1'), correlation3: correlation(rows, 'forward3'),
      buckets: [[-100, -21], [-20, 20], [21, 100]].map(([lo, hi]) => { const r = rows.filter(p => p.score >= lo && p.score <= hi); return { range: [lo, hi], count: r.length,
        meanForward1Pct: r.length ? round(mean(r.map(p => p.forward1))) : null,
        directionHitPct: r.length && (hi < 0 || lo > 0) ? round(100 * r.filter(p => hi < 0 ? p.forward1 < 0 : p.forward1 > 0).length / r.length, 2) : null,
        alwaysUpHitPct: r.length ? round(100 * r.filter(p => p.forward1 > 0).length / r.length, 2) : null }; }) };
  }
  const report = { generatedAt: new Date().toISOString(), cutoff,
    methodology: 'Actual crypto engine on a causal reconstruction: trailing ranks, past regimes and only matured three-day labels. Shared closes carried forward only from earlier dates. No parameter search. Score labels and trade permissions remain separate.',
    limitations: ['Current stored prices and historical warmup differ from each original live job; not point-in-time-vintage replay.', 'Historical periods were previously reviewed; no untouched holdout or predictive-edge claim.',
      'Crypto briefings publish after the source UTC close. Source-close-to-close outcomes measure historical association, not achievable live returns; do not call these trading profits.'],
    priceCoverage: Object.fromEntries(tickers.map((t, i) => [t, { rows: series[i].length, first: series[i][0]?.trade_date, last: series[i].at(-1)?.trade_date }])),
    overall: stats(results), reviewed2026: stats(results.filter(r => r.date >= '2026-01-01')),
    annual: [...new Set(results.map(r => r.date.slice(0, 4)))].map(year => ({ year, ...stats(results.filter(r => r.date.startsWith(year))) })), recent: results.slice(-20) };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, overall: report.overall, reviewed2026: report.reviewed2026 }, null, 2));
}
main().catch(e => { console.error(e instanceof Error ? e.message : 'Crypto validation unavailable'); process.exitCode = 1; });
