import "server-only";

import { cache } from "react";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { BiasLabel } from "@/lib/macro-bias/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BacktestDay {
  tradeDate: string;
  score: number;
  biasLabel: BiasLabel;
  spyClose: number;
  spyChangePercent: number;
  spyForward1DReturn: number | null;
  sameDayCorrect: boolean | null;
  forward1DCorrect: boolean | null;
}

export interface BacktestSummary {
  days: BacktestDay[];
  totalDays: number;
  dateRange: { from: string; to: string } | null;
  sameDayHitRate: number | null;
  forward1DHitRate: number | null;
  avgReturnBullish: number | null;
  avgReturnBearish: number | null;
  edgeSpread: number | null;
  regimeDistribution: { label: BiasLabel; count: number; pct: number }[];
  /** Equity curves normalised to 100 on day 1 */
  equityCurve: { date: string; spy: number; strategy: number }[];
  /** Total strategy return (%) */
  strategyReturn: number | null;
  /** Total SPY buy-and-hold return (%) */
  spyReturn: number | null;
}

/* ------------------------------------------------------------------ */
/*  Model constants (mirrored from calculate-daily-bias.ts)            */
/* ------------------------------------------------------------------ */

const K = 5;
const BLENDED_RETURN_SCALE = 2.75;
const TEMPORAL_DECAY_LAMBDA = 0.001;
const USO_LOOKBACK = 5;
const VIX_ROC_LOOKBACK = 5;
const RSI_PERIOD = 14;

/** Backtest start date — first trading day of 2020. */
const BACKTEST_START = "2020-01-02";

/* ------------------------------------------------------------------ */
/*  Bias label thresholds                                              */
/* ------------------------------------------------------------------ */

function getBiasLabel(score: number): BiasLabel {
  if (score <= -60) return "EXTREME_RISK_OFF";
  if (score < -20) return "RISK_OFF";
  if (score <= 20) return "NEUTRAL";
  if (score < 60) return "RISK_ON";
  return "EXTREME_RISK_ON";
}

/* ------------------------------------------------------------------ */
/*  Math helpers                                                       */
/* ------------------------------------------------------------------ */

const MS_PER_DAY = 86_400_000;

function pctChange(from: number, to: number): number {
  return ((to - from) / from) * 100;
}

function calendarDaysBetween(a: string, b: string): number {
  return Math.abs(
    Math.round(
      (Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) -
        Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) /
        MS_PER_DAY,
    ),
  );
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function directionCorrect(score: number, ret: number): boolean | null {
  if (score === 0) return null;
  return score > 0 ? ret >= 0 : ret <= 0;
}

/* ------------------------------------------------------------------ */
/*  RSI-14 calculation                                                 */
/* ------------------------------------------------------------------ */

function computeRsiSeries(closes: number[]): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < RSI_PERIOD + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= RSI_PERIOD; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= RSI_PERIOD;
  avgLoss /= RSI_PERIOD;

  result[RSI_PERIOD] =
    avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = RSI_PERIOD + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (RSI_PERIOD - 1) + gain) / RSI_PERIOD;
    avgLoss = (avgLoss * (RSI_PERIOD - 1) + loss) / RSI_PERIOD;
    result[i] =
      avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Supabase row type                                                  */
/* ------------------------------------------------------------------ */

type PriceRow = { trade_date: string; close: number };

/* ------------------------------------------------------------------ */
/*  Main backtest function                                             */
/* ------------------------------------------------------------------ */

export const getBacktestData = cache(async (): Promise<BacktestSummary> => {
  const sb = createSupabaseAdminClient();

  /* ---- Fetch all price data for the 7 required tickers --------- */
  /* Supabase defaults to 1000 rows; we need ~2500 per ticker.     */

  const tickers = ["SPY", "TLT", "GLD", "USO", "HYG", "VIX", "CPER"] as const;

  async function fetchAllRows(ticker: string): Promise<PriceRow[]> {
    const all: PriceRow[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data } = await sb
        .from("etf_daily_prices")
        .select("trade_date, close")
        .eq("ticker", ticker)
        .order("trade_date", { ascending: true })
        .range(from, from + pageSize - 1);
      if (!data || data.length === 0) break;
      all.push(...(data as PriceRow[]));
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return all;
  }

  const results = await Promise.all(tickers.map((t) => fetchAllRows(t)));

  const pricesByTicker: Record<string, PriceRow[]> = {};
  tickers.forEach((t, i) => {
    pricesByTicker[t] = results[i];
  });

  /* ---- Build common trade-date intersection -------------------- */
  /* We need all 7 tickers present on each date to build features.  */

  const dateSets = tickers.map(
    (t) => new Set(pricesByTicker[t].map((r) => r.trade_date)),
  );
  const commonDates = [...dateSets[0]].filter((d) =>
    dateSets.every((s) => s.has(d)),
  );
  commonDates.sort();

  /* ---- Build fast lookup maps ---------------------------------- */

  const closeMap: Record<string, Map<string, number>> = {};
  for (const t of tickers) {
    closeMap[t] = new Map(pricesByTicker[t].map((r) => [r.trade_date, r.close]));
  }

  /* ---- Build per-ticker arrays aligned to commonDates ---------- */

  const spyCloses = commonDates.map((d) => closeMap.SPY.get(d)!);

  /* ---- Compute RSI series for SPY ------------------------------ */

  const rsiSeries = computeRsiSeries(spyCloses);

  /* ---- Build feature vectors for every date that has enough     */
  /*      lookback (RSI=14, USO momentum=5, VIX ROC=5)             */
  /* -------------------------------------------------------------- */

  type FeatureVector = {
    spyRsi: number;
    gammaExposure: number;
    hygTltRatio: number;
    cperGldRatio: number;
    usoMomentum: number;
    vixLevel: number;
  };

  type HistoricPoint = {
    tradeDate: string;
    vector: FeatureVector;
    spyClose: number;
    spyForward1DReturn: number | null;
    spyForward3DReturn: number | null;
    spyChangePercent: number;
  };

  const minLookback = Math.max(RSI_PERIOD, USO_LOOKBACK, VIX_ROC_LOOKBACK);
  const allPoints: HistoricPoint[] = [];

  for (let i = minLookback; i < commonDates.length; i++) {
    const date = commonDates[i];
    const rsi = rsiSeries[i];
    if (rsi === null) continue;

    const vixClose = closeMap.VIX.get(date)!;
    const vixLookbackDate = commonDates[i - VIX_ROC_LOOKBACK];
    const vixPrev = closeMap.VIX.get(vixLookbackDate)!;
    const gammaExposure = vixPrev > 0 ? -pctChange(vixPrev, vixClose) : 0;

    const hygClose = closeMap.HYG.get(date)!;
    const tltClose = closeMap.TLT.get(date)!;
    const cperClose = closeMap.CPER.get(date)!;
    const gldClose = closeMap.GLD.get(date)!;

    const usoNow = closeMap.USO.get(date)!;
    const usoLookbackDate = commonDates[i - USO_LOOKBACK];
    const usoPrev = closeMap.USO.get(usoLookbackDate)!;
    const usoMomentum = usoPrev > 0 ? pctChange(usoPrev, usoNow) : 0;

    const spyClose = spyCloses[i];

    // Forward returns
    let fwd1d: number | null = null;
    let fwd3d: number | null = null;
    if (i + 1 < spyCloses.length) fwd1d = pctChange(spyClose, spyCloses[i + 1]);
    if (i + 3 < spyCloses.length) fwd3d = pctChange(spyClose, spyCloses[i + 3]);

    // Same-day change
    const spyPrevClose = spyCloses[i - 1];
    const spyChangePercent = pctChange(spyPrevClose, spyClose);

    allPoints.push({
      tradeDate: date,
      vector: {
        spyRsi: rsi,
        gammaExposure,
        hygTltRatio: tltClose > 0 ? hygClose / tltClose : 0,
        cperGldRatio: gldClose > 0 ? cperClose / gldClose : 0,
        usoMomentum,
        vixLevel: vixClose,
      },
      spyClose,
      spyForward1DReturn: fwd1d,
      spyForward3DReturn: fwd3d,
      spyChangePercent,
    });
  }

  if (allPoints.length < 30) {
    return emptyBacktest();
  }

  /* ---- Split: analog universe (pre-backtest) + backtest window -- */

  const backtestStartIdx = allPoints.findIndex(
    (p) => p.tradeDate >= BACKTEST_START,
  );
  if (backtestStartIdx < 20) {
    return emptyBacktest();
  }

  /* ---- Z-score statistics from the FULL dataset              --- */
  /* (production model uses population stats of the analog pool)    */

  const featureKeys: (keyof FeatureVector)[] = [
    "spyRsi",
    "gammaExposure",
    "hygTltRatio",
    "cperGldRatio",
    "usoMomentum",
    "vixLevel",
  ];

  function computeStats(pool: HistoricPoint[]) {
    const means: Record<string, number> = {};
    const stds: Record<string, number> = {};
    for (const k of featureKeys) {
      const vals = pool.map((p) => p.vector[k]);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const variance =
        vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
      means[k] = mean;
      stds[k] = Math.sqrt(variance) || 1;
    }
    return { means, stds };
  }

  /* ---- Score each backtest day --------------------------------- */

  const backtestDays: BacktestDay[] = [];

  for (let ti = backtestStartIdx; ti < allPoints.length; ti++) {
    const today = allPoints[ti];
    const analogPool = allPoints.slice(0, ti); // only past data

    if (analogPool.length < 20) continue;

    const { means, stds } = computeStats(analogPool);

    // Z-score today
    const todayZ: Record<string, number> = {};
    for (const k of featureKeys) {
      todayZ[k] = (today.vector[k] - means[k]) / stds[k];
    }

    // Z-score each analog and compute decayed distance
    const ranked = analogPool
      .filter((p) => p.spyForward1DReturn !== null) // must have known outcomes
      .map((analog) => {
        const analogZ: Record<string, number> = {};
        for (const k of featureKeys) {
          analogZ[k] = (analog.vector[k] - means[k]) / stds[k];
        }
        // Euclidean distance in z-space
        let sqDist = 0;
        for (const k of featureKeys) {
          sqDist += (todayZ[k] - analogZ[k]) ** 2;
        }
        const euclidean = Math.sqrt(sqDist);
        // Temporal decay
        const dayDiff = calendarDaysBetween(today.tradeDate, analog.tradeDate);
        const distance = euclidean * Math.exp(TEMPORAL_DECAY_LAMBDA * dayDiff);

        return { analog, distance };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, K);

    if (ranked.length < K) continue;

    // Blended forward return
    const avg1d =
      ranked.reduce((s, r) => s + (r.analog.spyForward1DReturn ?? 0), 0) /
      ranked.length;
    const avg3d =
      ranked.reduce((s, r) => s + (r.analog.spyForward3DReturn ?? 0), 0) /
      ranked.length;
    const blended = 0.4 * avg1d + 0.6 * avg3d;

    // tanh mapping
    const rawScore = Math.round(Math.tanh(blended / BLENDED_RETURN_SCALE) * 100);
    const score = Math.max(-100, Math.min(100, rawScore));
    const biasLabel = getBiasLabel(score);

    backtestDays.push({
      tradeDate: today.tradeDate,
      score,
      biasLabel,
      spyClose: Number(today.spyClose.toFixed(2)),
      spyChangePercent: Number(today.spyChangePercent.toFixed(4)),
      spyForward1DReturn:
        today.spyForward1DReturn !== null
          ? Number(today.spyForward1DReturn.toFixed(4))
          : null,
      sameDayCorrect: directionCorrect(score, today.spyChangePercent),
      forward1DCorrect:
        today.spyForward1DReturn !== null
          ? directionCorrect(score, today.spyForward1DReturn)
          : null,
    });
  }

  if (backtestDays.length === 0) return emptyBacktest();

  /* ---- Aggregate ------------------------------------------------ */

  const nonNeutral = backtestDays.filter((d) => d.score !== 0);
  const sameDayCorrectCount = nonNeutral.filter(
    (d) => d.sameDayCorrect === true,
  ).length;

  const with1D = nonNeutral.filter((d) => d.spyForward1DReturn !== null);
  const fwd1DCorrectCount = with1D.filter(
    (d) => d.forward1DCorrect === true,
  ).length;

  const bullish = backtestDays.filter((d) => d.score > 0);
  const bearish = backtestDays.filter((d) => d.score < 0);
  const avgBull = avg(bullish.map((d) => d.spyChangePercent));
  const avgBear = avg(bearish.map((d) => d.spyChangePercent));

  const ALL_LABELS: BiasLabel[] = [
    "EXTREME_RISK_ON",
    "RISK_ON",
    "NEUTRAL",
    "RISK_OFF",
    "EXTREME_RISK_OFF",
  ];

  const regimeDistribution = ALL_LABELS.map((label) => {
    const count = backtestDays.filter((d) => d.biasLabel === label).length;
    return {
      label,
      count,
      pct: backtestDays.length > 0 ? (count / backtestDays.length) * 100 : 0,
    };
  });

  /* ---- Build equity curves (long/short strategy vs buy-and-hold) */
  /*                                                                */
  /* Strategy rules (matches the published regime thresholds):      */
  /*  • LONG  when yesterday's score > 20  (RISK_ON / EXTREME_ON)  */
  /*  • SHORT when yesterday's score < -20 (RISK_OFF / EXTREME_OFF)*/
  /*  • CASH  when  -20 ≤ score ≤ 20       (NEUTRAL)               */
  /*                                                                */
  /* A flat per-trade friction of 5 bps is deducted on every       */
  /* position change to reflect SPY spread + slippage.              */

  const SCORE_THRESHOLD = 20;
  const FRICTION_BPS = 5; // basis points per trade
  const FRICTION = FRICTION_BPS / 10_000;

  const equityCurve: { date: string; spy: number; strategy: number }[] = [];
  let spyEquity = 100;
  let stratEquity = 100;
  let prevPosition: "LONG" | "SHORT" | "CASH" = "CASH";

  for (let i = 0; i < backtestDays.length; i++) {
    const day = backtestDays[i];
    const dailyReturn = day.spyChangePercent / 100;
    spyEquity *= 1 + dailyReturn;

    // Determine position from yesterday's score
    let position: "LONG" | "SHORT" | "CASH" = "CASH";
    if (i > 0) {
      const prevScore = backtestDays[i - 1].score;
      if (prevScore > SCORE_THRESHOLD) position = "LONG";
      else if (prevScore < -SCORE_THRESHOLD) position = "SHORT";
    }

    // Apply friction on position change
    if (position !== prevPosition && i > 0) {
      stratEquity *= 1 - FRICTION;
    }

    // Apply daily P&L
    if (position === "LONG") {
      stratEquity *= 1 + dailyReturn;
    } else if (position === "SHORT") {
      stratEquity *= 1 - dailyReturn;
    }

    prevPosition = position;

    equityCurve.push({
      date: day.tradeDate,
      spy: Number(spyEquity.toFixed(2)),
      strategy: Number(stratEquity.toFixed(2)),
    });
  }

  /* Downsample equity curve to weekly (every 5th trading day) +   */
  /* always keep first and last point for a clean chart.            */
  const sampledCurve =
    equityCurve.length <= 300
      ? equityCurve
      : equityCurve.filter(
          (_, i) =>
            i === 0 ||
            i === equityCurve.length - 1 ||
            i % 5 === 0,
        );

  return {
    days: [...backtestDays].reverse(),
    totalDays: backtestDays.length,
    dateRange: {
      from: backtestDays[0].tradeDate,
      to: backtestDays[backtestDays.length - 1].tradeDate,
    },
    sameDayHitRate:
      nonNeutral.length > 0
        ? (sameDayCorrectCount / nonNeutral.length) * 100
        : null,
    forward1DHitRate:
      with1D.length > 0 ? (fwd1DCorrectCount / with1D.length) * 100 : null,
    avgReturnBullish: avgBull,
    avgReturnBearish: avgBear,
    edgeSpread:
      avgBull !== null && avgBear !== null ? avgBull - avgBear : null,
    regimeDistribution,
    equityCurve: sampledCurve,
    strategyReturn: stratEquity - 100,
    spyReturn: spyEquity - 100,
  };
});

/* ------------------------------------------------------------------ */
/*  Empty fallback                                                     */
/* ------------------------------------------------------------------ */

function emptyBacktest(): BacktestSummary {
  const ALL_LABELS: BiasLabel[] = [
    "EXTREME_RISK_ON",
    "RISK_ON",
    "NEUTRAL",
    "RISK_OFF",
    "EXTREME_RISK_OFF",
  ];
  return {
    days: [],
    totalDays: 0,
    dateRange: null,
    sameDayHitRate: null,
    forward1DHitRate: null,
    avgReturnBullish: null,
    avgReturnBearish: null,
    edgeSpread: null,
    regimeDistribution: ALL_LABELS.map((label) => ({
      label,
      count: 0,
      pct: 0,
    })),
    equityCurve: [],
    strategyReturn: null,
    spyReturn: null,
  };
}
