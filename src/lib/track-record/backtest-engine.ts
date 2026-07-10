import "server-only";

import { cache } from "react";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  ANALOG_MODEL_SETTINGS,
  STOCKS_KNN_FEATURE_KEYS,
  STOCKS_LEVEL_FEATURES_FOR_PERCENTILE,
  STRATEGY_RULES,
} from "@/lib/macro-bias/constants";
import type { BiasLabel } from "@/lib/macro-bias/types";
import {
  buildTradableSignal,
  inverseDistanceWeight,
  positionFromSignal,
  stationarizeLevelFeatures,
  type TradableSignal,
  weightedMean,
} from "@/lib/signal";
import { trendSignFromCloseVsSma } from "@/lib/signal/trend-veto";
import {
  computeQualityReport,
  type QualityDay,
  type QualityReport,
} from "@/lib/signal/quality-metrics";

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
  /** @deprecated Prefer forward1DCorrect — same-day is not a tradable metric. */
  sameDayCorrect: boolean | null;
  forward1DCorrect: boolean | null;
  signal: TradableSignal;
}

export interface BacktestSummary {
  days: BacktestDay[];
  totalDays: number;
  dateRange: { from: string; to: string } | null;
  /** @deprecated Prefer forward1DHitRate. */
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
  /** Share of days the model issued NO_TRADE. */
  noTradeRate: number | null;
  maxDrawdownStrategy: number | null;
  maxDrawdownSpy: number | null;
  /** Next-session quality under lagged tradable signals. */
  quality: QualityReport | null;
  /** Naive score±threshold quality (no reliability/veto) for comparison. */
  baselineQuality: QualityReport | null;
}

/* ------------------------------------------------------------------ */
/*  Model constants (aligned with macro-model-v5)                      */
/* ------------------------------------------------------------------ */

const K_MIN = ANALOG_MODEL_SETTINGS.nearestNeighborCount;
const K_MAX = ANALOG_MODEL_SETTINGS.maxNeighborCount;
const RADIUS_MULT = ANALOG_MODEL_SETTINGS.neighborRadiusMultiplier;
const BLENDED_RETURN_SCALE = ANALOG_MODEL_SETTINGS.blendedReturnScale;
const TEMPORAL_DECAY_LAMBDA = ANALOG_MODEL_SETTINGS.temporalDecayLambda;
const USO_LOOKBACK = ANALOG_MODEL_SETTINGS.usoMomentumLookbackSessions;
const VIX_ROC_LOOKBACK = ANALOG_MODEL_SETTINGS.usoMomentumLookbackSessions;
const RSI_PERIOD = 14;
const MIN_ANALOG_GAP = ANALOG_MODEL_SETTINGS.minAnalogCalendarGapDays;
const DISTANCE_EPS = ANALOG_MODEL_SETTINGS.distanceWeightEpsilon;
const W1 = ANALOG_MODEL_SETTINGS.oneDayBlendWeight;
const W3 = ANALOG_MODEL_SETTINGS.threeDayBlendWeight;

/** Backtest start date — first trading day of 2020. */
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
/*  Supabase row type                                                  */
/* ------------------------------------------------------------------ */

type PriceRow = { trade_date: string; open: number; close: number };

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
  const openMap: Record<string, Map<string, number>> = {};
  for (const t of tickers) {
    closeMap[t] = new Map(pricesByTicker[t].map((r) => [r.trade_date, r.close]));
    openMap[t] = new Map(pricesByTicker[t].map((r) => [r.trade_date, r.open]));
  }

  /* ---- Build per-ticker arrays aligned to commonDates ---------- */

  const spyCloses = commonDates.map((d) => closeMap.SPY.get(d)!);
  const spyOpens = commonDates.map((d) => openMap.SPY.get(d)!);

  /* ---- Compute RSI series for SPY ------------------------------ */

  const rsiSeries = computeRsiSeries(spyCloses);

  /* ---- Build feature vectors for every date that has enough     */
  /*      lookback (RSI=14, USO momentum=5, VIX ROC=5)             */
  /* -------------------------------------------------------------- */

  type FeatureVector = {
    spyRsi: number;
    vixMomentum: number;
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
    // Honest name: −(VIX 5-session % change). Not dealer gamma.
    const vixMomentum = vixPrev > 0 ? -pctChange(vixPrev, vixClose) : 0;

    const hygClose = closeMap.HYG.get(date)!;
    const tltClose = closeMap.TLT.get(date)!;
    const cperClose = closeMap.CPER.get(date)!;
    const gldClose = closeMap.GLD.get(date)!;

    const usoNow = closeMap.USO.get(date)!;
    const usoLookbackDate = commonDates[i - USO_LOOKBACK];
    const usoPrev = closeMap.USO.get(usoLookbackDate)!;
    const usoMomentum = usoPrev > 0 ? pctChange(usoPrev, usoNow) : 0;

    const spyClose = spyCloses[i];
    const spyOpen = spyOpens[i];

    // Neighbor training labels: close→close (OTC training failed fair metrics).
    let fwd1d: number | null = null;
    let fwd3d: number | null = null;
    if (i + 1 < spyCloses.length) fwd1d = pctChange(spyClose, spyCloses[i + 1]);
    if (i + 3 < spyCloses.length) fwd3d = pctChange(spyClose, spyCloses[i + 3]);

    // Session P&L for evaluation: open→close (morning-permission product horizon).
    const spyChangePercent =
      spyOpen > 0 ? pctChange(spyOpen, spyClose) : pctChange(spyCloses[i - 1], spyClose);

    allPoints.push({
      tradeDate: date,
      vector: {
        spyRsi: rsi,
        vixMomentum,
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

  /* ---- Stationarize level features (walk-forward percentiles) --- */
  /* Raw hygTlt / cperGld / vix levels are replaced by 0–100 ranks. */

  const stationarizedPoints = stationarizeLevelFeatures(
    allPoints,
    STOCKS_LEVEL_FEATURES_FOR_PERCENTILE,
    {
      window: ANALOG_MODEL_SETTINGS.percentileWindowSessions,
      minHistory: ANALOG_MODEL_SETTINGS.percentileMinHistorySessions,
    },
  );

  if (stationarizedPoints.length < 30) {
    return emptyBacktest();
  }

  /* ---- Split: analog universe (pre-backtest) + backtest window -- */

  const backtestStartIdx = stationarizedPoints.findIndex(
    (p) => p.tradeDate >= BACKTEST_START,
  );
  if (backtestStartIdx < 20) {
    return emptyBacktest();
  }

  /* ---- Z-score statistics from the FULL dataset              --- */
  /* (production model uses population stats of the analog pool)    */

  // KNN distance features only (v8: vixLevel ablated)
  const featureKeys = [...STOCKS_KNN_FEATURE_KEYS] as (keyof FeatureVector)[];

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

  for (let ti = backtestStartIdx; ti < stationarizedPoints.length; ti++) {
    const today = stationarizedPoints[ti];
    const analogPool = stationarizedPoints.slice(0, ti); // only past data

    if (analogPool.length < 20) continue;

    const { means, stds } = computeStats(analogPool);

    // Z-score today
    const todayZ: Record<string, number> = {};
    for (const k of featureKeys) {
      todayZ[k] = (today.vector[k] - means[k]) / stds[k];
    }

    // Z-score each analog, enforce min calendar gap, compute decayed distance
    const rankedAll = analogPool
      .filter((p) => p.spyForward1DReturn !== null)
      .filter(
        (p) => calendarDaysBetween(today.tradeDate, p.tradeDate) >= MIN_ANALOG_GAP,
      )
      .map((analog) => {
        const analogZ: Record<string, number> = {};
        for (const k of featureKeys) {
          analogZ[k] = (analog.vector[k] - means[k]) / stds[k];
        }
        let baseDist = 0;
        if (ANALOG_MODEL_SETTINGS.distanceMetric === "cosine") {
          let dot = 0,
            nt = 0,
            na = 0;
          for (const k of featureKeys) {
            dot += todayZ[k] * analogZ[k];
            nt += todayZ[k] * todayZ[k];
            na += analogZ[k] * analogZ[k];
          }
          const cos = nt > 0 && na > 0 ? dot / (Math.sqrt(nt) * Math.sqrt(na)) : 0;
          baseDist = 1 - Math.min(1, Math.max(-1, cos));
        } else {
          let sqDist = 0;
          for (const k of featureKeys) {
            sqDist += (todayZ[k] - analogZ[k]) ** 2;
          }
          baseDist = Math.sqrt(sqDist);
        }
        const dayDiff = calendarDaysBetween(today.tradeDate, analog.tradeDate);
        const distance = baseDist * Math.exp(TEMPORAL_DECAY_LAMBDA * dayDiff);
        const distanceNoDecay = baseDist; // v18 dual arm
        const weight = inverseDistanceWeight(distance, DISTANCE_EPS);

        return { analog, distance, distanceNoDecay, weight };
      })
      .sort((a, b) => a.distance - b.distance);

    // v18 adaptive K: high VIX → 5, calm → 7
    const kUse = ANALOG_MODEL_SETTINGS.adaptiveNeighborKEnabled
      ? today.vector.vixLevel >= ANALOG_MODEL_SETTINGS.adaptiveKVixThreshold
        ? ANALOG_MODEL_SETTINGS.adaptiveKHighVix
        : ANALOG_MODEL_SETTINGS.adaptiveKLowVix
      : K_MIN;

    if (rankedAll.length < kUse) continue;

    const ranked = rankedAll.slice(0, kUse);
    const rankedNoDecay = [...rankedAll]
      .sort((a, b) => a.distanceNoDecay - b.distanceNoDecay)
      .slice(0, kUse);

    function armScore(
      slice: Array<{
        analog: (typeof stationarizedPoints)[number];
        distance: number;
        weight: number;
      }>,
    ) {
      const weights = slice.map((r) => r.weight);
      const avg1d = weightedMean(
        slice.map((r) => r.analog.spyForward1DReturn ?? 0),
        weights,
      );
      const avg3d = weightedMean(
        slice.map((r) => r.analog.spyForward3DReturn ?? 0),
        weights,
      );
      const blended = W1 * avg1d + W3 * avg3d;
      let s = Math.max(
        -100,
        Math.min(100, Math.round(Math.tanh(blended / BLENDED_RETURN_SCALE) * 100)),
      );
      const rets = slice.map(
        (r) =>
          (r.analog.spyForward1DReturn ?? 0) * W1 +
          (r.analog.spyForward3DReturn ?? 0) * W3,
      );
      if (ANALOG_MODEL_SETTINGS.flatLowNeighborVolEnabled && rets.length >= 2) {
        const m = rets.reduce((a, v) => a + v, 0) / rets.length;
        const sd = Math.sqrt(rets.reduce((a, v) => a + (v - m) ** 2, 0) / rets.length);
        if (sd < ANALOG_MODEL_SETTINGS.flatLowNeighborVolThreshold) s = 0;
      }
      if (ANALOG_MODEL_SETTINGS.fadeBigDayEnabled && ti > 0 && s !== 0) {
        const prevClose = stationarizedPoints[ti - 1]?.spyClose;
        const ctc =
          prevClose > 0 ? pctChange(prevClose, today.spyClose) : today.spyChangePercent;
        if (Math.abs(ctc) > ANALOG_MODEL_SETTINGS.fadeBigDayThresholdPct) {
          s = Math.max(
            -100,
            Math.min(
              100,
              Math.round(
                s * ANALOG_MODEL_SETTINGS.fadeBigDayScoreScale -
                  Math.sign(ctc) * ANALOG_MODEL_SETTINGS.fadeBigDayPushPoints,
              ),
            ),
          );
        }
      }
      if (ti > 0) {
        const prevClose = stationarizedPoints[ti - 1]?.spyClose;
        const open = openMap.SPY.get(today.tradeDate) ?? 0;
        if (prevClose > 0 && open > 0) {
          const overnight = pctChange(prevClose, open);
          const gap = ANALOG_MODEL_SETTINGS.softOvernightAmpGapPct;
          if (ANALOG_MODEL_SETTINGS.softOvernightAmpEnabled && s !== 0) {
            if (s > STRATEGY_RULES.scoreThreshold && overnight > gap) {
              s = Math.max(
                -100,
                Math.min(100, Math.round(s * ANALOG_MODEL_SETTINGS.softOvernightAmpUp)),
              );
            } else if (s < -STRATEGY_RULES.scoreThreshold && overnight < -gap) {
              s = Math.max(
                -100,
                Math.min(100, Math.round(s * ANALOG_MODEL_SETTINGS.softOvernightAmpUp)),
              );
            } else if (s > STRATEGY_RULES.scoreThreshold && overnight < -gap) {
              s = Math.max(
                -100,
                Math.min(100, Math.round(s * ANALOG_MODEL_SETTINGS.softOvernightAmpDown)),
              );
            } else if (s < -STRATEGY_RULES.scoreThreshold && overnight > gap) {
              s = Math.max(
                -100,
                Math.min(100, Math.round(s * ANALOG_MODEL_SETTINGS.softOvernightAmpDown)),
              );
            }
          }
          if (ANALOG_MODEL_SETTINGS.overnightVetoEnabled) {
            const thr = ANALOG_MODEL_SETTINGS.overnightVetoThresholdPct;
            if (s > STRATEGY_RULES.scoreThreshold && overnight < -thr) s = 0;
            if (s < -STRATEGY_RULES.scoreThreshold && overnight > thr) s = 0;
          }
        }
      }
      return s;
    }

    const scoreDecay = armScore(ranked);
    const scoreNoDecay = armScore(
      rankedNoDecay.map((r) => ({
        analog: r.analog,
        distance: r.distanceNoDecay,
        weight: inverseDistanceWeight(r.distanceNoDecay, DISTANCE_EPS),
      })),
    );

    let score = scoreDecay;
    if (ANALOG_MODEL_SETTINGS.dualNoDecayAgreeEnabled) {
      if (scoreDecay === 0 || scoreNoDecay === 0) score = 0;
      else if (Math.sign(scoreDecay) !== Math.sign(scoreNoDecay)) score = 0;
      else score = Math.max(-100, Math.min(100, Math.round((scoreDecay + scoreNoDecay) / 2)));
    }

    const blendedNeighborReturns = ranked.map(
      (r) =>
        (r.analog.spyForward1DReturn ?? 0) * W1 +
        (r.analog.spyForward3DReturn ?? 0) * W3,
    );

    // SMA20 for trend veto from prior spy closes in the stationarized window
    const lookbackCloses = stationarizedPoints
      .slice(Math.max(0, ti - 19), ti + 1)
      .map((p) => p.spyClose);
    const sma20 =
      lookbackCloses.length >= 20
        ? lookbackCloses.reduce((s, v) => s + v, 0) / lookbackCloses.length
        : null;
    const trendSign = ANALOG_MODEL_SETTINGS.enableTrendVeto
      ? trendSignFromCloseVsSma(today.spyClose, sma20)
      : 0;

    let signal = buildTradableSignal({
      score,
      neighborForwardReturns: blendedNeighborReturns,
      neighborDistances: ranked.map((r) => r.distance),
      rules: STRATEGY_RULES,
      trendVeto: ANALOG_MODEL_SETTINGS.enableTrendVeto
        ? {
            trendSign,
            volPercentile: today.vector.vixLevel,
          }
        : undefined,
    });

    // Monday dampener (v10): neutral score + FLAT
    if (ANALOG_MODEL_SETTINGS.skipMondayScores) {
      const dow = new Date(today.tradeDate + "T12:00:00Z").getUTCDay();
      if (dow === 1) {
        score = 0;
        if (signal.position !== "NO_TRADE") {
          signal = {
            ...signal,
            position: "FLAT",
            size: 0,
            noTrade: false,
            reason: "Monday publish dampener.",
          };
        }
      }
    }

    const biasLabel = getBiasLabel(score, signal);

    // Forward accuracy uses the raw score sign (diagnostic). Trading uses signal.
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
      signal,
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
  /* Strategy rules (unified STOCKS_STRATEGY_RULES):                */
  /*  • Use yesterday's tradable signal (permission + reliability) */
  /*  • NO_TRADE / FLAT → cash                                      */
  /*  • LONG / SHORT → full unit exposure (size reserved for live) */
  /*  • Friction on every position change                           */

  const FRICTION = STRATEGY_RULES.frictionBps / 10_000;

  const equityCurve: { date: string; spy: number; strategy: number }[] = [];
  let spyEquity = 100;
  let stratEquity = 100;
  let prevPosition: "LONG" | "SHORT" | "CASH" = "CASH";
  let peakSpy = 100;
  let peakStrat = 100;
  let maxDdSpy = 0;
  let maxDdStrat = 0;

  for (let i = 0; i < backtestDays.length; i++) {
    const day = backtestDays[i];
    const dailyReturn = day.spyChangePercent / 100;
    spyEquity *= 1 + dailyReturn;

    // Position from yesterday's tradable signal (not raw score alone)
    let position: "LONG" | "SHORT" | "CASH" = "CASH";
    if (i > 0) {
      const prev = backtestDays[i - 1];
      position = positionFromSignal(prev.signal, prev.score, STRATEGY_RULES);
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

    if (spyEquity > peakSpy) peakSpy = spyEquity;
    if (stratEquity > peakStrat) peakStrat = stratEquity;
    const ddSpy = (spyEquity - peakSpy) / peakSpy;
    const ddStrat = (stratEquity - peakStrat) / peakStrat;
    if (ddSpy < maxDdSpy) maxDdSpy = ddSpy;
    if (ddStrat < maxDdStrat) maxDdStrat = ddStrat;

    equityCurve.push({
      date: day.tradeDate,
      spy: Number(spyEquity.toFixed(2)),
      strategy: Number(stratEquity.toFixed(2)),
    });
  }

  const noTradeDays = backtestDays.filter((d) => d.signal.noTrade).length;

  /* ---- Next-session quality: lagged signal vs naive score ------ */

  const qualityDays: QualityDay[] = [];
  const baselineQualityDays: QualityDay[] = [];
  for (let i = 1; i < backtestDays.length; i++) {
    const session = backtestDays[i];
    const prior = backtestDays[i - 1];
    const pos = positionFromSignal(prior.signal, prior.score, STRATEGY_RULES);
    let directionCorrect: boolean | null = null;
    if (pos === "LONG") directionCorrect = session.spyChangePercent >= 0;
    else if (pos === "SHORT") directionCorrect = session.spyChangePercent <= 0;
    qualityDays.push({
      sessionReturnPct: session.spyChangePercent,
      position: pos,
      score: prior.score,
      reliability: prior.signal.reliability,
      directionCorrect,
    });

    let basePos: "LONG" | "SHORT" | "CASH" = "CASH";
    if (prior.score > 20) basePos = "LONG";
    else if (prior.score < -20) basePos = "SHORT";
    let baseCorrect: boolean | null = null;
    if (basePos === "LONG") baseCorrect = session.spyChangePercent >= 0;
    else if (basePos === "SHORT") baseCorrect = session.spyChangePercent <= 0;
    baselineQualityDays.push({
      sessionReturnPct: session.spyChangePercent,
      position: basePos,
      score: prior.score,
      directionCorrect: baseCorrect,
    });
  }
  const quality = computeQualityReport(qualityDays);
  const baselineQuality = computeQualityReport(baselineQualityDays);

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
    noTradeRate:
      backtestDays.length > 0 ? (noTradeDays / backtestDays.length) * 100 : null,
    maxDrawdownStrategy: maxDdStrat * 100,
    maxDrawdownSpy: maxDdSpy * 100,
    quality,
    baselineQuality,
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
    noTradeRate: null,
    maxDrawdownStrategy: null,
    maxDrawdownSpy: null,
    quality: null,
    baselineQuality: null,
  };
}
