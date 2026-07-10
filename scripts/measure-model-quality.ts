/**
 * Standalone walk-forward quality measurement + gate grid search.
 * Run: npx tsx scripts/measure-model-quality.ts
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";
import {
  ANALOG_MODEL_SETTINGS,
  STOCKS_LEVEL_FEATURES_FOR_PERCENTILE,
} from "../src/lib/macro-bias/constants";
import {
  buildTradableSignal,
  inverseDistanceWeight,
  positionFromSignal,
  stationarizeLevelFeatures,
  weightedMean,
} from "../src/lib/signal";
import {
  computeQualityReport,
  formatQualityReport,
  type QualityDay,
  type QualityReport,
} from "../src/lib/signal/quality-metrics";
import { trendSignFromCloseVsSma } from "../src/lib/signal/trend-veto";
import type { StrategyRules } from "../src/lib/signal/types";

const BACKTEST_START = "2020-01-01";
const RSI_PERIOD = 14;

type PriceRow = { trade_date: string; open: number; close: number };

function pctChange(from: number, to: number) {
  return ((to - from) / from) * 100;
}

function computeRsiSeries(closes: number[]): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < RSI_PERIOD + 1) return result;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= RSI_PERIOD; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d;
    else avgLoss += Math.abs(d);
  }
  avgGain /= RSI_PERIOD;
  avgLoss /= RSI_PERIOD;
  result[RSI_PERIOD] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = RSI_PERIOD + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (RSI_PERIOD - 1) + g) / RSI_PERIOD;
    avgLoss = (avgLoss * (RSI_PERIOD - 1) + l) / RSI_PERIOD;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

async function fetchAll(sb: { from: (t: string) => any }, ticker: string) {
  const all: PriceRow[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb
      .from("etf_daily_prices")
      .select("trade_date, open, close")
      .eq("ticker", ticker)
      .order("trade_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${ticker}: ${error.message}`);
    if (!data?.length) break;
    all.push(...(data as PriceRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

type ModelCfg = {
  label: string;
  w1: number;
  w3: number;
  kMin: number;
  kMax: number;
  radiusMult: number;
  rules: StrategyRules;
  enableTrendVeto: boolean;
  useSignalGates: boolean;
};

type Point = {
  tradeDate: string;
  vector: {
    spyRsi: number;
    vixMomentum: number;
    hygTltRatio: number;
    cperGldRatio: number;
    usoMomentum: number;
    vixLevel: number;
  };
  spyClose: number;
  spyChangePercent: number;
  spyForward1DReturn: number | null;
  spyForward3DReturn: number | null;
};

function calendarDaysBetween(a: string, b: string) {
  return Math.abs(
    Math.round(
      (Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) -
        Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) /
        86_400_000,
    ),
  );
}

function runWalkForward(stationarizedPoints: Point[], cfg: ModelCfg): QualityReport {
  const featureKeys = [
    "spyRsi",
    "vixMomentum",
    "hygTltRatio",
    "cperGldRatio",
    "usoMomentum",
    "vixLevel",
  ] as const;

  const startIdx = stationarizedPoints.findIndex((p) => p.tradeDate >= BACKTEST_START);
  if (startIdx < 20) throw new Error("Not enough pre-2020 history");

  type Day = {
    score: number;
    signal: ReturnType<typeof buildTradableSignal> | null;
    spyChangePercent: number;
  };
  const days: Day[] = [];

  for (let ti = startIdx; ti < stationarizedPoints.length; ti++) {
    const today = stationarizedPoints[ti];
    const pool = stationarizedPoints.slice(0, ti);
    if (pool.length < 20) continue;

    const means: Record<string, number> = {};
    const stds: Record<string, number> = {};
    for (const k of featureKeys) {
      const vals = pool.map((p) => p.vector[k]);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
      means[k] = mean;
      stds[k] = Math.sqrt(variance) || 1;
    }

    const todayZ: Record<string, number> = {};
    for (const k of featureKeys) {
      todayZ[k] = (today.vector[k] - means[k]) / stds[k];
    }

    const rankedAll = pool
      .filter((p) => p.spyForward1DReturn !== null)
      .filter(
        (p) =>
          calendarDaysBetween(today.tradeDate, p.tradeDate) >=
          ANALOG_MODEL_SETTINGS.minAnalogCalendarGapDays,
      )
      .map((analog) => {
        const analogZ: Record<string, number> = {};
        for (const k of featureKeys) {
          analogZ[k] = (analog.vector[k] - means[k]) / stds[k];
        }
        let sq = 0;
        for (const k of featureKeys) sq += (todayZ[k] - analogZ[k]) ** 2;
        const euclidean = Math.sqrt(sq);
        const dayDiff = calendarDaysBetween(today.tradeDate, analog.tradeDate);
        const distance =
          euclidean * Math.exp(ANALOG_MODEL_SETTINGS.temporalDecayLambda * dayDiff);
        return {
          analog,
          distance,
          weight: inverseDistanceWeight(distance, ANALOG_MODEL_SETTINGS.distanceWeightEpsilon),
        };
      })
      .sort((a, b) => a.distance - b.distance);

    if (rankedAll.length < cfg.kMin) continue;

    const kth = rankedAll[cfg.kMin - 1].distance;
    const radius = kth * cfg.radiusMult;
    const ranked =
      cfg.kMax === cfg.kMin
        ? rankedAll.slice(0, cfg.kMin)
        : rankedAll
            .filter((r, i) => i < cfg.kMin || r.distance <= radius)
            .slice(0, cfg.kMax);

    const weights = ranked.map((r) => r.weight);
    const avg1d = weightedMean(
      ranked.map((r) => r.analog.spyForward1DReturn ?? 0),
      weights,
    );
    const avg3d = weightedMean(
      ranked.map((r) => r.analog.spyForward3DReturn ?? 0),
      weights,
    );
    const blended = cfg.w1 * avg1d + cfg.w3 * avg3d;
    const score = Math.max(
      -100,
      Math.min(
        100,
        Math.round(Math.tanh(blended / ANALOG_MODEL_SETTINGS.blendedReturnScale) * 100),
      ),
    );

    const neighborReturns = ranked.map(
      (r) =>
        (r.analog.spyForward1DReturn ?? 0) * cfg.w1 +
        (r.analog.spyForward3DReturn ?? 0) * cfg.w3,
    );

    let signal: ReturnType<typeof buildTradableSignal> | null = null;
    if (cfg.useSignalGates) {
      const lookback = stationarizedPoints
        .slice(Math.max(0, ti - 19), ti + 1)
        .map((p) => p.spyClose);
      const sma20 =
        lookback.length >= 20
          ? lookback.reduce((s, v) => s + v, 0) / lookback.length
          : null;
      const trendSign = cfg.enableTrendVeto
        ? trendSignFromCloseVsSma(today.spyClose, sma20)
        : 0;
      signal = buildTradableSignal({
        score,
        neighborForwardReturns: neighborReturns,
        neighborDistances: ranked.map((r) => r.distance),
        rules: cfg.rules,
        trendVeto: cfg.enableTrendVeto
          ? { trendSign, volPercentile: today.vector.vixLevel }
          : undefined,
      });
    }

    days.push({
      score,
      signal,
      spyChangePercent: today.spyChangePercent,
    });
  }

  const qualityDays: QualityDay[] = [];
  for (let i = 1; i < days.length; i++) {
    const session = days[i];
    const prior = days[i - 1];
    let position: "LONG" | "SHORT" | "CASH";
    if (cfg.useSignalGates && prior.signal) {
      position = positionFromSignal(prior.signal, prior.score, cfg.rules);
    } else {
      position = prior.score > 20 ? "LONG" : prior.score < -20 ? "SHORT" : "CASH";
    }
    let directionCorrect: boolean | null = null;
    if (position === "LONG") directionCorrect = session.spyChangePercent >= 0;
    else if (position === "SHORT") directionCorrect = session.spyChangePercent <= 0;
    qualityDays.push({
      sessionReturnPct: session.spyChangePercent,
      position,
      score: prior.score,
      reliability: prior.signal?.reliability,
      directionCorrect,
    });
  }

  return computeQualityReport(qualityDays);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase env");
  }
  const sb = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("Fetching prices...");
  const tickers = ["SPY", "TLT", "GLD", "USO", "HYG", "VIX", "CPER"] as const;
  const series = await Promise.all(tickers.map((t) => fetchAll(sb, t)));
  const byTicker: Record<string, PriceRow[]> = {};
  tickers.forEach((t, i) => {
    byTicker[t] = series[i];
    console.log(`  ${t}: ${series[i].length}`);
  });

  const dateSets = tickers.map((t) => new Set(byTicker[t].map((r) => r.trade_date)));
  const commonDates = [...dateSets[0]]
    .filter((d) => dateSets.every((s) => s.has(d)))
    .sort();

  const closeMap: Record<string, Map<string, number>> = {};
  const openMap: Record<string, Map<string, number>> = {};
  for (const t of tickers) {
    closeMap[t] = new Map(byTicker[t].map((r) => [r.trade_date, r.close]));
    openMap[t] = new Map(byTicker[t].map((r) => [r.trade_date, r.open]));
  }
  const spyCloses = commonDates.map((d) => closeMap.SPY.get(d)!);
  const spyOpens = commonDates.map((d) => openMap.SPY.get(d)!);
  const rsiSeries = computeRsiSeries(spyCloses);
  const minLookback = Math.max(RSI_PERIOD, 5);

  const allPoints: Point[] = [];
  for (let i = minLookback; i < commonDates.length; i++) {
    const date = commonDates[i];
    const rsi = rsiSeries[i];
    if (rsi === null) continue;
    const vixClose = closeMap.VIX.get(date)!;
    const vixPrev = closeMap.VIX.get(commonDates[i - 5])!;
    const vixMomentum = vixPrev > 0 ? -pctChange(vixPrev, vixClose) : 0;
    const hyg = closeMap.HYG.get(date)!;
    const tlt = closeMap.TLT.get(date)!;
    const cper = closeMap.CPER.get(date)!;
    const gld = closeMap.GLD.get(date)!;
    const usoNow = closeMap.USO.get(date)!;
    const usoPrev = closeMap.USO.get(commonDates[i - 5])!;
    const usoMomentum = usoPrev > 0 ? pctChange(usoPrev, usoNow) : 0;
    const spyClose = spyCloses[i];
    const spyOpen = spyOpens[i];
    // Neighbor training labels: close→close (locked after OTC-train reject).
    let fwd1d: number | null = null;
    let fwd3d: number | null = null;
    if (i + 1 < spyCloses.length) fwd1d = pctChange(spyClose, spyCloses[i + 1]);
    if (i + 3 < spyCloses.length) fwd3d = pctChange(spyClose, spyCloses[i + 3]);

    allPoints.push({
      tradeDate: date,
      vector: {
        spyRsi: rsi,
        vixMomentum,
        hygTltRatio: tlt > 0 ? hyg / tlt : 0,
        cperGldRatio: gld > 0 ? cper / gld : 0,
        usoMomentum,
        vixLevel: vixClose,
      },
      spyClose,
      // Evaluate lag positions on open→close (product morning-permission horizon).
      spyChangePercent:
        spyOpen > 0 ? pctChange(spyOpen, spyClose) : pctChange(spyCloses[i - 1], spyClose),
      spyForward1DReturn: fwd1d,
      spyForward3DReturn: fwd3d,
    });
  }

  const stationarized = stationarizeLevelFeatures(
    allPoints,
    STOCKS_LEVEL_FEATURES_FOR_PERCENTILE,
    {
      window: ANALOG_MODEL_SETTINGS.percentileWindowSessions,
      minHistory: ANALOG_MODEL_SETTINGS.percentileMinHistorySessions,
    },
  );
  console.log(`Stationarized: ${stationarized.length}`);

  // --- Config grid (lightweight gate search on top of production engine choices) ---
  const configs: ModelCfg[] = [];

  // Pure baseline
  configs.push({
    label: "BASELINE fixedK5 blend0.4/0.6 score±20 no-gates",
    w1: 0.4,
    w3: 0.6,
    kMin: 5,
    kMax: 5,
    radiusMult: 1,
    rules: {
      scoreThreshold: 20,
      frictionBps: 5,
      maxMeanNeighborDistance: 99,
      minNeighborAgreement: 0,
    },
    enableTrendVeto: false,
    useSignalGates: false,
  });

  // Compact grid: prioritize learning which knobs matter
  const candidates: Array<Omit<ModelCfg, "label"> & { name: string }> = [
    // 1d-primary, fixed K, soft gates, no veto
    {
      name: "0.7/0.3 K5 thr20 softGates noVeto",
      w1: 0.7,
      w3: 0.3,
      kMin: 5,
      kMax: 5,
      radiusMult: 1,
      rules: {
        scoreThreshold: 20,
        frictionBps: 5,
        maxMeanNeighborDistance: 4.5,
        minNeighborAgreement: 0.3,
      },
      enableTrendVeto: false,
      useSignalGates: true,
    },
    // 1d-primary, adaptive K, soft gates
    {
      name: "0.7/0.3 Kadapt thr20 softGates noVeto",
      w1: 0.7,
      w3: 0.3,
      kMin: 5,
      kMax: 12,
      radiusMult: 1.35,
      rules: {
        scoreThreshold: 20,
        frictionBps: 5,
        maxMeanNeighborDistance: 4.5,
        minNeighborAgreement: 0.3,
      },
      enableTrendVeto: false,
      useSignalGates: true,
    },
    // classic blend + soft gates
    {
      name: "0.4/0.6 K5 thr20 softGates noVeto",
      w1: 0.4,
      w3: 0.6,
      kMin: 5,
      kMax: 5,
      radiusMult: 1,
      rules: {
        scoreThreshold: 20,
        frictionBps: 5,
        maxMeanNeighborDistance: 4.5,
        minNeighborAgreement: 0.3,
      },
      enableTrendVeto: false,
      useSignalGates: true,
    },
    // only refuse on very bad agreement
    {
      name: "0.7/0.3 K5 thr20 refuseOnly agr0.2 dist99 noVeto",
      w1: 0.7,
      w3: 0.3,
      kMin: 5,
      kMax: 5,
      radiusMult: 1,
      rules: {
        scoreThreshold: 20,
        frictionBps: 5,
        maxMeanNeighborDistance: 99,
        minNeighborAgreement: 0.2,
      },
      enableTrendVeto: false,
      useSignalGates: true,
    },
    // mild veto + soft gates
    {
      name: "0.7/0.3 K5 thr20 softGates mildVeto",
      w1: 0.7,
      w3: 0.3,
      kMin: 5,
      kMax: 5,
      radiusMult: 1,
      rules: {
        scoreThreshold: 20,
        frictionBps: 5,
        maxMeanNeighborDistance: 4.5,
        minNeighborAgreement: 0.3,
      },
      enableTrendVeto: true,
      useSignalGates: true,
    },
    // adaptive + 1d + refuse only
    {
      name: "0.7/0.3 Kadapt thr18 refuseOnly noVeto",
      w1: 0.7,
      w3: 0.3,
      kMin: 5,
      kMax: 12,
      radiusMult: 1.35,
      rules: {
        scoreThreshold: 18,
        frictionBps: 5,
        maxMeanNeighborDistance: 99,
        minNeighborAgreement: 0.2,
      },
      enableTrendVeto: false,
      useSignalGates: true,
    },
    // previous aggressive (known bad — keep for reference)
    {
      name: "LEGACY_AGGRESSIVE thr22 agr0.5 dist3.0 vetoY",
      w1: 0.7,
      w3: 0.3,
      kMin: 5,
      kMax: 12,
      radiusMult: 1.35,
      rules: {
        scoreThreshold: 22,
        frictionBps: 5,
        maxMeanNeighborDistance: 3.0,
        minNeighborAgreement: 0.5,
      },
      enableTrendVeto: true,
      useSignalGates: true,
    },
  ];

  for (const c of candidates) {
    configs.push({
      label: c.name,
      w1: c.w1,
      w3: c.w3,
      kMin: c.kMin,
      kMax: c.kMax,
      radiusMult: c.radiusMult,
      rules: c.rules,
      enableTrendVeto: c.enableTrendVeto,
      useSignalGates: c.useSignalGates,
    });
  }

  console.log(`\nEvaluating ${configs.length} configs (may take several minutes)...\n`);

  const results: { cfg: ModelCfg; report: QualityReport }[] = [];
  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i];
    if (i % 10 === 0) console.log(`  [${i + 1}/${configs.length}] ${cfg.label}`);
    results.push({ cfg, report: runWalkForward(stationarized, cfg) });
  }

  results.sort((a, b) => b.report.objective - a.report.objective);

  console.log("\n########## TOP 10 ##########\n");
  for (const r of results.slice(0, 10)) {
    console.log(formatQualityReport(r.cfg.label, r.report));
    console.log("");
  }

  const baseline = results.find((r) => r.cfg.label.startsWith("BASELINE"))!;
  const best = results[0];

  console.log("########## VERDICT ##########");
  console.log(`Baseline obj=${baseline.report.objective.toFixed(4)}`);
  console.log(`Best     obj=${best.report.objective.toFixed(4)}  ${best.cfg.label}`);
  console.log(
    best.report.objective > baseline.report.objective
      ? "PASS: found config that beats baseline"
      : "FAIL: no config beat baseline",
  );

  // Print JSON for applying to constants
  console.log("\nBEST_CONFIG_JSON=");
  console.log(
    JSON.stringify(
      {
        w1: best.cfg.w1,
        w3: best.cfg.w3,
        kMin: best.cfg.kMin,
        kMax: best.cfg.kMax,
        radiusMult: best.cfg.radiusMult,
        rules: best.cfg.rules,
        enableTrendVeto: best.cfg.enableTrendVeto,
        objective: best.report.objective,
        hitRate: best.report.hitRate,
        edgeSpread: best.report.edgeSpread,
        cashRate: best.report.cashRate,
        highRelHitRate: best.report.highRelHitRate,
      },
      null,
      2,
    ),
  );

  process.exit(best.report.objective > baseline.report.objective ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
