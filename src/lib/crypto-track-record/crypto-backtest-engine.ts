import "server-only";

import { cache } from "react";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  CRYPTO_ANALOG_MODEL_SETTINGS,
  CRYPTO_LEVEL_FEATURES_FOR_PERCENTILE,
} from "@/lib/crypto-bias/constants";
import type { BiasLabel } from "@/lib/crypto-bias/types";
import {
  buildTradableSignal,
  CRYPTO_STRATEGY_RULES,
  inverseDistanceWeight,
  positionFromSignal,
  stationarizeLevelFeatures,
  type TradableSignal,
  weightedMean,
} from "@/lib/signal";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CryptoBacktestDay {
  tradeDate: string;
  score: number;
  biasLabel: BiasLabel;
  btcClose: number;
  btcChangePercent: number;
  btcForward1DReturn: number | null;
  /** @deprecated Prefer forward1DCorrect. */
  sameDayCorrect: boolean | null;
  forward1DCorrect: boolean | null;
  signal: TradableSignal;
}

export interface CryptoEquityCurvePoint {
  date: string;
  btc: number;
  strategy: number;
  longOnly: number;
}

export interface CryptoBacktestSummary {
  days: CryptoBacktestDay[];
  totalDays: number;
  dateRange: { from: string; to: string } | null;
  /** @deprecated Prefer forward1DHitRate. */
  sameDayHitRate: number | null;
  forward1DHitRate: number | null;
  avgReturnBullish: number | null;
  avgReturnBearish: number | null;
  edgeSpread: number | null;
  regimeDistribution: { label: BiasLabel; count: number; pct: number }[];
  equityCurve: CryptoEquityCurvePoint[];
  strategyReturn: number | null;
  longOnlyReturn: number | null;
  btcReturn: number | null;
  noTradeRate: number | null;
  maxDrawdownLongOnly: number | null;
  maxDrawdownBtc: number | null;
}

/* ------------------------------------------------------------------ */
/*  Model constants (aligned with crypto-model-v2)                     */
/* ------------------------------------------------------------------ */

const K_MIN = CRYPTO_ANALOG_MODEL_SETTINGS.nearestNeighborCount;
const K_MAX = CRYPTO_ANALOG_MODEL_SETTINGS.maxNeighborCount;
const RADIUS_MULT = CRYPTO_ANALOG_MODEL_SETTINGS.neighborRadiusMultiplier;
const BLENDED_RETURN_SCALE = CRYPTO_ANALOG_MODEL_SETTINGS.blendedReturnScale;
const TEMPORAL_DECAY_LAMBDA = CRYPTO_ANALOG_MODEL_SETTINGS.temporalDecayLambda;
const DXY_LOOKBACK = CRYPTO_ANALOG_MODEL_SETTINGS.dxyMomentumLookbackSessions;
const TLT_LOOKBACK = CRYPTO_ANALOG_MODEL_SETTINGS.tltMomentumLookbackSessions;
const BTC_VOL_WINDOW = CRYPTO_ANALOG_MODEL_SETTINGS.btcRealizedVolWindow;
const RSI_PERIOD = 14;
const MIN_ANALOG_GAP = CRYPTO_ANALOG_MODEL_SETTINGS.minAnalogCalendarGapDays;
const DISTANCE_EPS = CRYPTO_ANALOG_MODEL_SETTINGS.distanceWeightEpsilon;
const W1 = CRYPTO_ANALOG_MODEL_SETTINGS.oneDayBlendWeight;
const W3 = CRYPTO_ANALOG_MODEL_SETTINGS.threeDayBlendWeight;

const BACKTEST_START = "2020-01-01";

/* ------------------------------------------------------------------ */
/*  Bias label thresholds                                              */
/* ------------------------------------------------------------------ */

function getBiasLabel(score: number, signal: TradableSignal): BiasLabel {
  if (signal.position === "NO_TRADE") return "NEUTRAL";
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
/*  Realized Vol                                                       */
/* ------------------------------------------------------------------ */

function computeRealizedVolSeries(closes: number[]): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < BTC_VOL_WINDOW + 1) return result;

  for (let i = BTC_VOL_WINDOW; i < closes.length; i++) {
    const logReturns: number[] = [];
    for (let j = i - BTC_VOL_WINDOW + 1; j <= i; j++) {
      if (closes[j - 1] > 0) {
        logReturns.push(Math.log(closes[j] / closes[j - 1]));
      }
    }
    if (logReturns.length >= BTC_VOL_WINDOW - 1) {
      const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
      const variance = logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / logReturns.length;
      result[i] = Math.sqrt(variance) * Math.sqrt(365) * 100;
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Supabase row type                                                  */
/* ------------------------------------------------------------------ */

type PriceRow = { trade_date: string; open: number; close: number };

/* ------------------------------------------------------------------ */
/*  Main backtest function                                             */
/* ------------------------------------------------------------------ */

export const getCryptoBacktestData = cache(async (): Promise<CryptoBacktestSummary> => {
  const sb = createSupabaseAdminClient();

  const tickers = ["BTC-USD", "ETH-USD", "GLD", "DXY", "TLT"] as const;

  async function fetchAllRows(ticker: string): Promise<PriceRow[]> {
    const all: PriceRow[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data } = await sb
        .from("etf_daily_prices")
        .select("trade_date, open, close")
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

  /* ---- Build common trade dates with carry-forward for DXY/TLT -- */

  const btcDates = new Set(pricesByTicker["BTC-USD"].map((r) => r.trade_date));
  const ethDates = new Set(pricesByTicker["ETH-USD"].map((r) => r.trade_date));
  const cryptoDates = [...btcDates].filter((d) => ethDates.has(d)).sort();

  // Build fast close/open maps
  const closeMap: Record<string, Map<string, number>> = {};
  const openMap: Record<string, Map<string, number>> = {};
  for (const t of tickers) {
    closeMap[t] = new Map(pricesByTicker[t].map((r) => [r.trade_date, r.close]));
    openMap[t] = new Map(pricesByTicker[t].map((r) => [r.trade_date, r.open]));
  }

  // Carry forward fill for GLD, DXY, TLT
  function getCloseWithFill(ticker: string, date: string, lastKnown: Map<string, number>): number {
    const val = closeMap[ticker].get(date);
    if (val !== undefined) {
      lastKnown.set(ticker, val);
      return val;
    }
    return lastKnown.get(ticker) ?? 0;
  }

  const lastKnown = new Map<string, number>();
  const commonDates: string[] = [];
  const filledCloses: Record<string, number[]> = {};
  const filledOpens: Record<string, number[]> = {};
  for (const t of tickers) {
    filledCloses[t] = [];
    filledOpens[t] = [];
  }

  for (const date of cryptoDates) {
    const btcClose = closeMap["BTC-USD"].get(date);
    const ethClose = closeMap["ETH-USD"].get(date);
    const btcOpen = openMap["BTC-USD"].get(date);
    if (btcClose === undefined || ethClose === undefined) continue;

    const gldClose = getCloseWithFill("GLD", date, lastKnown);
    const dxyClose = getCloseWithFill("DXY", date, lastKnown);
    const tltClose = getCloseWithFill("TLT", date, lastKnown);

    if (gldClose === 0 || dxyClose === 0 || tltClose === 0) continue;

    commonDates.push(date);
    filledCloses["BTC-USD"].push(btcClose);
    filledCloses["ETH-USD"].push(ethClose);
    filledCloses["GLD"].push(gldClose);
    filledCloses["DXY"].push(dxyClose);
    filledCloses["TLT"].push(tltClose);
    filledOpens["BTC-USD"].push(btcOpen && btcOpen > 0 ? btcOpen : btcClose);
  }

  /* ---- Compute feature series ---------------------------------- */

  const btcCloses = filledCloses["BTC-USD"];
  const btcOpens = filledOpens["BTC-USD"];
  const ethCloses = filledCloses["ETH-USD"];
  const gldCloses = filledCloses["GLD"];
  const dxyCloses = filledCloses["DXY"];
  const tltCloses = filledCloses["TLT"];

  const rsiSeries = computeRsiSeries(btcCloses);
  const volSeries = computeRealizedVolSeries(btcCloses);

  /* ---- Build feature vectors ----------------------------------- */

  type FeatureVector = {
    btcRsi: number;
    ethBtcRatio: number;
    btcGldRatio: number;
    dxyMomentum: number;
    btcRealizedVol: number;
    tltMomentum: number;
  };

  type HistoricPoint = {
    tradeDate: string;
    vector: FeatureVector;
    btcClose: number;
    btcForward1DReturn: number | null;
    btcForward3DReturn: number | null;
    btcChangePercent: number;
  };

  const minLookback = Math.max(RSI_PERIOD, DXY_LOOKBACK, TLT_LOOKBACK, BTC_VOL_WINDOW);
  const allPoints: HistoricPoint[] = [];

  for (let i = minLookback; i < commonDates.length; i++) {
    const date = commonDates[i];
    const rsi = rsiSeries[i];
    const vol = volSeries[i];
    if (rsi === null || vol === null) continue;

    const btcClose = btcCloses[i];
    const ethClose = ethCloses[i];
    const gldClose = gldCloses[i];
    const dxyNow = dxyCloses[i];
    const dxyPrev = dxyCloses[i - DXY_LOOKBACK];
    const tltNow = tltCloses[i];
    const tltPrev = tltCloses[i - TLT_LOOKBACK];

    const dxyMomentum = dxyPrev > 0 ? pctChange(dxyPrev, dxyNow) : 0;
    const tltMomentum = tltPrev > 0 ? pctChange(tltPrev, tltNow) : 0;

    // Neighbor training labels: close→close (OTC training failed fair metrics).
    let fwd1d: number | null = null;
    let fwd3d: number | null = null;
    if (i + 1 < btcCloses.length) fwd1d = pctChange(btcClose, btcCloses[i + 1]);
    if (i + 3 < btcCloses.length) fwd3d = pctChange(btcClose, btcCloses[i + 3]);

    // Session P&L for evaluation: open→close (morning-permission product horizon).
    const btcOpen = btcOpens[i];
    const btcChangePercent =
      btcOpen > 0 ? pctChange(btcOpen, btcClose) : pctChange(btcCloses[i - 1], btcClose);

    allPoints.push({
      tradeDate: date,
      vector: {
        btcRsi: rsi,
        ethBtcRatio: btcClose > 0 ? ethClose / btcClose : 0,
        btcGldRatio: gldClose > 0 ? btcClose / gldClose : 0,
        dxyMomentum,
        btcRealizedVol: vol,
        tltMomentum,
      },
      btcClose,
      btcForward1DReturn: fwd1d,
      btcForward3DReturn: fwd3d,
      btcChangePercent,
    });
  }

  if (allPoints.length < 30) return emptyCryptoBacktest();

  /* ---- Stationarize level features (walk-forward percentiles) --- */

  const stationarizedPoints = stationarizeLevelFeatures(
    allPoints,
    CRYPTO_LEVEL_FEATURES_FOR_PERCENTILE,
    {
      window: CRYPTO_ANALOG_MODEL_SETTINGS.percentileWindowSessions,
      minHistory: CRYPTO_ANALOG_MODEL_SETTINGS.percentileMinHistorySessions,
    },
  );

  if (stationarizedPoints.length < 30) return emptyCryptoBacktest();

  /* ---- Split: analog pool vs backtest window ------------------- */

  const backtestStartIdx = stationarizedPoints.findIndex(
    (p) => p.tradeDate >= BACKTEST_START,
  );
  if (backtestStartIdx < 20) return emptyCryptoBacktest();

  const featureKeys: (keyof FeatureVector)[] = [
    "btcRsi",
    "ethBtcRatio",
    "btcGldRatio",
    "dxyMomentum",
    "btcRealizedVol",
    "tltMomentum",
  ];

  function computeStats(pool: HistoricPoint[]) {
    const means: Record<string, number> = {};
    const stds: Record<string, number> = {};
    for (const k of featureKeys) {
      const vals = pool.map((p) => p.vector[k]);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
      means[k] = mean;
      stds[k] = Math.sqrt(variance) || 1;
    }
    return { means, stds };
  }

  /* ---- Score each backtest day --------------------------------- */

  const backtestDays: CryptoBacktestDay[] = [];

  for (let ti = backtestStartIdx; ti < stationarizedPoints.length; ti++) {
    const today = stationarizedPoints[ti];
    const analogPool = stationarizedPoints.slice(0, ti);

    if (analogPool.length < 20) continue;

    const { means, stds } = computeStats(analogPool);

    const todayZ: Record<string, number> = {};
    for (const k of featureKeys) {
      todayZ[k] = (today.vector[k] - means[k]) / stds[k];
    }

    const rankedAll = analogPool
      .filter((p) => p.btcForward1DReturn !== null)
      .filter(
        (p) => calendarDaysBetween(today.tradeDate, p.tradeDate) >= MIN_ANALOG_GAP,
      )
      .map((analog) => {
        const analogZ: Record<string, number> = {};
        for (const k of featureKeys) {
          analogZ[k] = (analog.vector[k] - means[k]) / stds[k];
        }
        let sqDist = 0;
        for (const k of featureKeys) {
          sqDist += (todayZ[k] - analogZ[k]) ** 2;
        }
        const euclidean = Math.sqrt(sqDist);
        const dayDiff = calendarDaysBetween(today.tradeDate, analog.tradeDate);
        const distance = euclidean * Math.exp(TEMPORAL_DECAY_LAMBDA * dayDiff);
        const weight = inverseDistanceWeight(distance, DISTANCE_EPS);
        return { analog, distance, weight };
      })
      .sort((a, b) => a.distance - b.distance);

    if (rankedAll.length < K_MIN) continue;

    const kthDistance = rankedAll[K_MIN - 1].distance;
    const radius = kthDistance * RADIUS_MULT;
    const ranked = rankedAll
      .filter((r, index) => index < K_MIN || r.distance <= radius)
      .slice(0, K_MAX);

    const weights = ranked.map((r) => r.weight);
    const avg1d = weightedMean(
      ranked.map((r) => r.analog.btcForward1DReturn ?? 0),
      weights,
    );
    const avg3d = weightedMean(
      ranked.map((r) => r.analog.btcForward3DReturn ?? 0),
      weights,
    );
    const blended = W1 * avg1d + W3 * avg3d;

    const rawScore = Math.round(Math.tanh(blended / BLENDED_RETURN_SCALE) * 100);
    const score = Math.max(-100, Math.min(100, rawScore));

    const blendedNeighborReturns = ranked.map(
      (r) =>
        (r.analog.btcForward1DReturn ?? 0) * W1 +
        (r.analog.btcForward3DReturn ?? 0) * W3,
    );

    const trendSign =
      today.vector.btcRsi >= 55 ? 1 : today.vector.btcRsi <= 45 ? -1 : 0;

    const signal = buildTradableSignal({
      score,
      neighborForwardReturns: blendedNeighborReturns,
      neighborDistances: ranked.map((r) => r.distance),
      rules: CRYPTO_STRATEGY_RULES,
      trendVeto: CRYPTO_ANALOG_MODEL_SETTINGS.enableTrendVeto
        ? {
            trendSign: trendSign as -1 | 0 | 1,
            volPercentile: today.vector.btcRealizedVol,
          }
        : undefined,
    });
    const biasLabel = getBiasLabel(score, signal);

    backtestDays.push({
      tradeDate: today.tradeDate,
      score,
      biasLabel,
      btcClose: Number(today.btcClose.toFixed(2)),
      btcChangePercent: Number(today.btcChangePercent.toFixed(4)),
      btcForward1DReturn:
        today.btcForward1DReturn !== null
          ? Number(today.btcForward1DReturn.toFixed(4))
          : null,
      sameDayCorrect: directionCorrect(score, today.btcChangePercent),
      forward1DCorrect:
        today.btcForward1DReturn !== null
          ? directionCorrect(score, today.btcForward1DReturn)
          : null,
      signal,
    });
  }

  if (backtestDays.length === 0) return emptyCryptoBacktest();

  /* ---- Aggregate ------------------------------------------------ */

  const nonNeutral = backtestDays.filter((d) => d.score !== 0);
  const sameDayCorrectCount = nonNeutral.filter((d) => d.sameDayCorrect === true).length;
  const with1D = nonNeutral.filter((d) => d.btcForward1DReturn !== null);
  const fwd1DCorrectCount = with1D.filter((d) => d.forward1DCorrect === true).length;

  const bullish = backtestDays.filter((d) => d.score > 0);
  const bearish = backtestDays.filter((d) => d.score < 0);
  const avgBull = avg(bullish.map((d) => d.btcChangePercent));
  const avgBear = avg(bearish.map((d) => d.btcChangePercent));

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

  /* ---- Build equity curves ------------------------------------- */
  /* Primary public benchmark: long-only + cash (no short fantasy)  */
  /* Long/short kept for research; both use tradable signal + 15bp */

  const FRICTION = CRYPTO_STRATEGY_RULES.frictionBps / 10_000;

  const equityCurve: CryptoEquityCurvePoint[] = [];
  let btcEquity = 100;
  let stratEquity = 100;
  let longOnlyEquity = 100;
  let prevPosition: "LONG" | "SHORT" | "CASH" = "CASH";
  let prevLongOnlyPosition: "LONG" | "CASH" = "CASH";
  let peakBtc = 100;
  let peakLongOnly = 100;
  let maxDdBtc = 0;
  let maxDdLongOnly = 0;

  for (let i = 0; i < backtestDays.length; i++) {
    const day = backtestDays[i];
    const dailyReturn = day.btcChangePercent / 100;
    btcEquity *= 1 + dailyReturn;

    let position: "LONG" | "SHORT" | "CASH" = "CASH";
    if (i > 0) {
      const prev = backtestDays[i - 1];
      position = positionFromSignal(prev.signal, prev.score, CRYPTO_STRATEGY_RULES);
    }

    if (position !== prevPosition && i > 0) {
      stratEquity *= 1 - FRICTION;
    }

    if (position === "LONG") {
      stratEquity *= 1 + dailyReturn;
    } else if (position === "SHORT") {
      stratEquity *= 1 - dailyReturn;
    }

    prevPosition = position;

    // Long-only: only take LONG permission; FLAT/NO_TRADE/SHORT → cash
    let longOnlyPosition: "LONG" | "CASH" = "CASH";
    if (i > 0) {
      const prev = backtestDays[i - 1];
      const prevPos = positionFromSignal(prev.signal, prev.score, CRYPTO_STRATEGY_RULES);
      if (prevPos === "LONG") longOnlyPosition = "LONG";
    }

    if (longOnlyPosition !== prevLongOnlyPosition && i > 0) {
      longOnlyEquity *= 1 - FRICTION;
    }

    if (longOnlyPosition === "LONG") {
      longOnlyEquity *= 1 + dailyReturn;
    }

    prevLongOnlyPosition = longOnlyPosition;

    if (btcEquity > peakBtc) peakBtc = btcEquity;
    if (longOnlyEquity > peakLongOnly) peakLongOnly = longOnlyEquity;
    const ddBtc = (btcEquity - peakBtc) / peakBtc;
    const ddLo = (longOnlyEquity - peakLongOnly) / peakLongOnly;
    if (ddBtc < maxDdBtc) maxDdBtc = ddBtc;
    if (ddLo < maxDdLongOnly) maxDdLongOnly = ddLo;

    equityCurve.push({
      date: day.tradeDate,
      btc: Number(btcEquity.toFixed(2)),
      strategy: Number(stratEquity.toFixed(2)),
      longOnly: Number(longOnlyEquity.toFixed(2)),
    });
  }

  const noTradeDays = backtestDays.filter((d) => d.signal.noTrade).length;

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
    longOnlyReturn: longOnlyEquity - 100,
    btcReturn: btcEquity - 100,
    noTradeRate:
      backtestDays.length > 0 ? (noTradeDays / backtestDays.length) * 100 : null,
    maxDrawdownLongOnly: maxDdLongOnly * 100,
    maxDrawdownBtc: maxDdBtc * 100,
  };
});

/* ------------------------------------------------------------------ */
/*  Empty fallback                                                     */
/* ------------------------------------------------------------------ */

function emptyCryptoBacktest(): CryptoBacktestSummary {
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
    longOnlyReturn: null,
    btcReturn: null,
    noTradeRate: null,
    maxDrawdownLongOnly: null,
    maxDrawdownBtc: null,
  };
}
