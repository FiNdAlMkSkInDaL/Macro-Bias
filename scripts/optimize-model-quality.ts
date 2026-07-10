/**
 * Full quality optimization pipeline with measurement at every step.
 *
 * 1) Fair production vs baseline (no highRel bias in ranking)
 * 2) Feature ablation (drop features one at a time)
 * 3) Reliability threshold recalibration for A/B > D/F
 * 4) Open→close next-session labels vs close→close
 *
 * Run: npx tsx scripts/optimize-model-quality.ts
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
  distanceQualityFromMean,
  inverseDistanceWeight,
  positionFromSignal,
  reliabilityFromMetrics,
  roundTo,
  stationarizeLevelFeatures,
  weightedMean,
  STOCKS_STRATEGY_RULES,
} from "../src/lib/signal";
import type { StrategyRules, TradableSignal } from "../src/lib/signal/types";

const BACKTEST_START = "2020-01-01";
const RSI_PERIOD = 14;
const ALL_FEATURES = [
  "spyRsi",
  "vixMomentum",
  "hygTltRatio",
  "cperGldRatio",
  "usoMomentum",
  "vixLevel",
] as const;
type FeatureKey = (typeof ALL_FEATURES)[number];

type PriceRow = {
  trade_date: string;
  open: number;
  close: number;
};

type Point = {
  tradeDate: string;
  vector: Record<FeatureKey, number>;
  spyClose: number;
  spyOpen: number;
  /** close[t]/close[t-1] */
  closeToClosePct: number;
  /** close[t]/open[t]  (intraday session) */
  openToClosePct: number;
  spyForward1DCtc: number | null;
  spyForward3DCtc: number | null;
  /** next session open-to-close */
  spyForward1DOtc: number | null;
  /** next open → third close (morning multi-day hold) */
  spyForward3DOtc: number | null;
};

type ScoredDay = {
  tradeDate: string;
  score: number;
  signal: TradableSignal;
  meanDistance: number;
  neighborAgreement: number;
  distanceQuality: number;
  closeToClosePct: number;
  openToClosePct: number;
  nextCtc: number | null;
  nextOtc: number | null;
};

type FairReport = {
  label: string;
  sessions: number;
  directional: number;
  cashRate: number;
  hitRate: number;
  edge: number;
  avgWhenIn: number;
  /** Primary fair score: no highRel bonus */
  fairObjective: number;
  highRelHit: number | null;
  highRelN: number;
  lowRelHit: number | null;
  lowRelN: number;
  relSeparation: number | null;
};

function pct(from: number, to: number) {
  return ((to - from) / from) * 100;
}

function avg(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function calDays(a: string, b: string) {
  return Math.abs(
    Math.round(
      (Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) -
        Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) /
        86_400_000,
    ),
  );
}

function computeRsi(closes: number[]): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < RSI_PERIOD + 1) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= RSI_PERIOD; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d;
    else l += -d;
  }
  g /= RSI_PERIOD;
  l /= RSI_PERIOD;
  out[RSI_PERIOD] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = RSI_PERIOD + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    g = (g * (RSI_PERIOD - 1) + gain) / RSI_PERIOD;
    l = (l * (RSI_PERIOD - 1) + loss) / RSI_PERIOD;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

function fairObjective(hitRate: number, edge: number, avgWhenIn: number, cashRate: number) {
  const cashPenalty =
    cashRate < 0.1 ? 0.15 : cashRate > 0.85 ? 0.25 : cashRate > 0.7 ? 0.05 : 0;
  return edge * 2 + ((hitRate - 50) / 100) * 1.5 + avgWhenIn * 3 - cashPenalty;
}

function reportFromLagged(
  label: string,
  days: ScoredDay[],
  mode: "ctc" | "otc",
  useSignal: boolean,
  rules: StrategyRules,
): FairReport {
  let directional = 0;
  let hits = 0;
  let cash = 0;
  const longR: number[] = [];
  const shortR: number[] = [];
  const whenIn: number[] = [];
  let highRelHits = 0;
  let highRelN = 0;
  let lowRelHits = 0;
  let lowRelN = 0;

  for (let i = 1; i < days.length; i++) {
    const prior = days[i - 1];
    const session = days[i];
    const ret = mode === "ctc" ? session.closeToClosePct : session.openToClosePct;

    let pos: "LONG" | "SHORT" | "CASH";
    if (useSignal) {
      pos = positionFromSignal(prior.signal, prior.score, rules);
    } else {
      pos = prior.score > 20 ? "LONG" : prior.score < -20 ? "SHORT" : "CASH";
    }

    if (pos === "CASH") {
      cash++;
      continue;
    }

    directional++;
    const correct = pos === "LONG" ? ret >= 0 : ret <= 0;
    if (correct) hits++;
    if (pos === "LONG") {
      longR.push(ret);
      whenIn.push(ret);
    } else {
      shortR.push(ret);
      whenIn.push(-ret);
    }

    if (useSignal) {
      const rel = prior.signal.reliability;
      if (rel === "A" || rel === "B") {
        highRelN++;
        if (correct) highRelHits++;
      } else if (rel === "D" || rel === "F") {
        lowRelN++;
        if (correct) lowRelHits++;
      }
    }
  }

  const sessions = days.length - 1;
  const hitRate = directional > 0 ? (hits / directional) * 100 : 50;
  const avgLong = avg(longR) ?? 0;
  const avgShort = avg(shortR) ?? 0;
  const edge = longR.length && shortR.length ? avgLong - avgShort : 0;
  const avgWhenIn = avg(whenIn) ?? 0;
  const cashRate = sessions > 0 ? cash / sessions : 1;
  const highRelHit = highRelN >= 20 ? (highRelHits / highRelN) * 100 : null;
  const lowRelHit = lowRelN >= 20 ? (lowRelHits / lowRelN) * 100 : null;

  return {
    label,
    sessions,
    directional,
    cashRate,
    hitRate,
    edge,
    avgWhenIn,
    fairObjective: fairObjective(hitRate, edge, avgWhenIn, cashRate),
    highRelHit,
    highRelN,
    lowRelHit,
    lowRelN,
    relSeparation:
      highRelHit != null && lowRelHit != null ? highRelHit - lowRelHit : null,
  };
}

function printReport(r: FairReport) {
  console.log(`=== ${r.label} ===`);
  console.log(
    `sessions=${r.sessions} dir=${r.directional} cash=${(r.cashRate * 100).toFixed(1)}% hit=${r.hitRate.toFixed(1)}% edge=${r.edge >= 0 ? "+" : ""}${r.edge.toFixed(3)}% whenIn=${r.avgWhenIn >= 0 ? "+" : ""}${r.avgWhenIn.toFixed(3)}% fairObj=${r.fairObjective.toFixed(4)}`,
  );
  if (r.highRelN || r.lowRelN) {
    console.log(
      `  highRel(A/B) hit=${r.highRelHit?.toFixed(1) ?? "n/a"}% n=${r.highRelN} | lowRel(D/F) hit=${r.lowRelHit?.toFixed(1) ?? "n/a"}% n=${r.lowRelN} | sep=${r.relSeparation?.toFixed(1) ?? "n/a"}pp`,
    );
  }
}

async function fetchPrices(sb: any, ticker: string): Promise<PriceRow[]> {
  const all: PriceRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("etf_daily_prices")
      .select("trade_date, open, close")
      .eq("ticker", ticker)
      .order("trade_date", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`${ticker}: ${error.message}`);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

function walkForward(
  points: Point[],
  features: FeatureKey[],
  rules: StrategyRules,
  blend: { w1: number; w3: number },
  reliabilityOverride?: {
    grade: (meanDist: number, agr: number, dq: number) => TradableSignal["reliability"];
  },
  /** Train score on OTC neighbor labels. Default false (CTC locked after v9 reject). */
  useOtcLabels = false,
): ScoredDay[] {
  const startIdx = points.findIndex((p) => p.tradeDate >= BACKTEST_START);
  const days: ScoredDay[] = [];

  for (let ti = startIdx; ti < points.length; ti++) {
    const today = points[ti];
    const pool = points.slice(0, ti);
    if (pool.length < 20) continue;

    const means: Record<string, number> = {};
    const stds: Record<string, number> = {};
    for (const k of features) {
      const vals = pool.map((p) => p.vector[k]);
      const m = vals.reduce((s, v) => s + v, 0) / vals.length;
      const v = vals.reduce((s, x) => s + (x - m) ** 2, 0) / vals.length;
      means[k] = m;
      stds[k] = Math.sqrt(v) || 1;
    }

    const todayZ: Record<string, number> = {};
    for (const k of features) todayZ[k] = (today.vector[k] - means[k]) / stds[k];

    const f1 = (p: Point) =>
      useOtcLabels ? p.spyForward1DOtc : p.spyForward1DCtc;
    const f3 = (p: Point) =>
      useOtcLabels ? p.spyForward3DOtc : p.spyForward3DCtc;

    const ranked = pool
      .filter((p) => f1(p) !== null)
      .filter(
        (p) =>
          calDays(today.tradeDate, p.tradeDate) >=
          ANALOG_MODEL_SETTINGS.minAnalogCalendarGapDays,
      )
      .map((analog) => {
        let sq = 0;
        for (const k of features) {
          const z = (analog.vector[k] - means[k]) / stds[k];
          sq += (todayZ[k] - z) ** 2;
        }
        const eucl = Math.sqrt(sq);
        const dist =
          eucl *
          Math.exp(
            ANALOG_MODEL_SETTINGS.temporalDecayLambda *
              calDays(today.tradeDate, analog.tradeDate),
          );
        return {
          analog,
          distance: dist,
          weight: inverseDistanceWeight(dist, ANALOG_MODEL_SETTINGS.distanceWeightEpsilon),
        };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5);

    if (ranked.length < 5) continue;

    const weights = ranked.map((r) => r.weight);
    const avg1d = weightedMean(
      ranked.map((r) => f1(r.analog) ?? 0),
      weights,
    );
    const avg3d = weightedMean(
      ranked.map((r) => f3(r.analog) ?? 0),
      weights,
    );
    const blended = blend.w1 * avg1d + blend.w3 * avg3d;
    const score = Math.max(
      -100,
      Math.min(
        100,
        Math.round(Math.tanh(blended / ANALOG_MODEL_SETTINGS.blendedReturnScale) * 100),
      ),
    );

    const neighborReturns = ranked.map(
      (r) => (f1(r.analog) ?? 0) * blend.w1 + (f3(r.analog) ?? 0) * blend.w3,
    );
    const distances = ranked.map((r) => r.distance);
    const meanDistance = distances.reduce((s, d) => s + d, 0) / distances.length;
    const scoreSign = score > 0 ? 1 : score < 0 ? -1 : 0;
    const agr =
      scoreSign === 0
        ? neighborReturns.filter((v) => Math.abs(v) < 0.15).length / neighborReturns.length
        : neighborReturns.filter((v) => v * scoreSign > 0).length / neighborReturns.length;
    const dq = distanceQualityFromMean(meanDistance);

    let signal = buildTradableSignal({
      score,
      neighborForwardReturns: neighborReturns,
      neighborDistances: distances,
      rules,
    });

    // Optional reliability regrade (keep position logic from rules, only re-label grade for analysis)
    if (reliabilityOverride) {
      const grade = reliabilityOverride.grade(meanDistance, agr, dq);
      signal = { ...signal, reliability: grade };
      // Re-apply F → NO_TRADE if regrade says F and rules would refuse
      if (grade === "F" && signal.position !== "NO_TRADE") {
        // only force if agreement/distance truly bad under override thresholds
        // leave as-is for measurement of grade separation first
      }
    }

    days.push({
      tradeDate: today.tradeDate,
      score,
      signal,
      meanDistance,
      neighborAgreement: roundTo(agr, 4),
      distanceQuality: dq,
      closeToClosePct: today.closeToClosePct,
      openToClosePct: today.openToClosePct,
      nextCtc: today.spyForward1DCtc,
      nextOtc: today.spyForward1DOtc,
    });
  }

  return days;
}

/** Empirical reliability bands from scored days so A/B outpredict D/F. */
function calibrateReliability(
  days: ScoredDay[],
  mode: "ctc" | "otc",
  rules: StrategyRules,
): {
  grade: (meanDist: number, agr: number, dq: number) => TradableSignal["reliability"];
  report: string;
} {
  // Collect directional outcomes with metrics
  type Row = { agr: number; dist: number; dq: number; correct: boolean };
  const rows: Row[] = [];
  for (let i = 1; i < days.length; i++) {
    const prior = days[i - 1];
    const session = days[i];
    const ret = mode === "ctc" ? session.closeToClosePct : session.openToClosePct;
    const pos = positionFromSignal(prior.signal, prior.score, rules);
    if (pos === "CASH") continue;
    const correct = pos === "LONG" ? ret >= 0 : ret <= 0;
    rows.push({
      agr: prior.neighborAgreement,
      dist: prior.meanDistance,
      dq: prior.distanceQuality,
      correct,
    });
  }

  if (rows.length < 100) {
    return {
      grade: (d, a, q) => reliabilityFromMetrics(d, a, q, rules),
      report: "Not enough directional rows to recalibrate reliability.",
    };
  }

  // Search thresholds: A requires high agr + high dq; F requires low agr or high dist
  let bestSep = -999;
  let best = { agrA: 0.8, dqA: 0.55, agrB: 0.6, dqB: 0.45, agrF: 0.35, distF: 4.0 };
  let bestStats = { aHit: 0, aN: 0, fHit: 0, fN: 0 };

  for (const agrA of [0.7, 0.75, 0.8, 0.85]) {
    for (const dqA of [0.5, 0.55, 0.6]) {
      for (const agrF of [0.25, 0.3, 0.35, 0.4]) {
        for (const distF of [3.5, 4.0, 4.5, 5.0]) {
          let aH = 0,
            aN = 0,
            fH = 0,
            fN = 0;
          for (const r of rows) {
            if (r.agr >= agrA && r.dq >= dqA) {
              aN++;
              if (r.correct) aH++;
            } else if (r.agr < agrF || r.dist > distF) {
              fN++;
              if (r.correct) fH++;
            }
          }
          if (aN < 30 || fN < 30) continue;
          const aHit = aH / aN;
          const fHit = fH / fN;
          const sep = aHit - fHit;
          // Prefer separation with reasonable samples
          const score = sep * 100 + Math.min(aN, 200) * 0.001;
          if (sep > bestSep && aHit > fHit) {
            bestSep = sep;
            best = {
              agrA,
              dqA,
              agrB: agrA - 0.15,
              dqB: dqA - 0.1,
              agrF,
              distF,
            };
            bestStats = { aHit, aN, fHit, fN };
          }
          void score;
        }
      }
    }
  }

  if (bestSep <= 0) {
    return {
      grade: (d, a, q) => reliabilityFromMetrics(d, a, q, rules),
      report: `No positive A vs F separation found (bestSep=${bestSep.toFixed(3)}). Keeping default grades.`,
    };
  }

  const gradeFn = (meanDist: number, agr: number, dq: number): TradableSignal["reliability"] => {
    if (agr < best.agrF || meanDist > best.distF) return "F";
    if (agr >= best.agrA && dq >= best.dqA) return "A";
    if (agr >= best.agrB && dq >= best.dqB) return "B";
    if (agr >= best.agrF + 0.1) return "C";
    return "D";
  };

  return {
    grade: gradeFn,
    report: `Calibrated reliability: A(agr>=${best.agrA},dq>=${best.dqA}) hit=${(bestStats.aHit * 100).toFixed(1)}% n=${bestStats.aN}; F(agr<${best.agrF}|dist>${best.distF}) hit=${(bestStats.fHit * 100).toFixed(1)}% n=${bestStats.fN}; sep=+${(bestSep * 100).toFixed(1)}pp`,
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("Loading OHLCV...");
  const tickers = ["SPY", "TLT", "GLD", "USO", "HYG", "VIX", "CPER"] as const;
  const loaded = await Promise.all(tickers.map((t) => fetchPrices(sb, t)));
  const byT: Record<string, PriceRow[]> = {};
  tickers.forEach((t, i) => {
    byT[t] = loaded[i];
    console.log(`  ${t}: ${loaded[i].length}`);
  });

  const sets = tickers.map((t) => new Set(byT[t].map((r) => r.trade_date)));
  const dates = [...sets[0]].filter((d) => sets.every((s) => s.has(d))).sort();
  const cmap: Record<string, Map<string, PriceRow>> = {};
  for (const t of tickers) {
    cmap[t] = new Map(byT[t].map((r) => [r.trade_date, r]));
  }

  const spyCloses = dates.map((d) => cmap.SPY.get(d)!.close);
  const rsi = computeRsi(spyCloses);
  const minLb = Math.max(RSI_PERIOD, 5);

  const rawPoints: Point[] = [];
  for (let i = minLb; i < dates.length; i++) {
    const d = dates[i];
    if (rsi[i] == null) continue;
    const spy = cmap.SPY.get(d)!;
    const prevSpy = cmap.SPY.get(dates[i - 1])!;
    const vix = cmap.VIX.get(d)!;
    const vixPrev = cmap.VIX.get(dates[i - 5])!;
    const hyg = cmap.HYG.get(d)!;
    const tlt = cmap.TLT.get(d)!;
    const cper = cmap.CPER.get(d)!;
    const gld = cmap.GLD.get(d)!;
    const uso = cmap.USO.get(d)!;
    const usoPrev = cmap.USO.get(dates[i - 5])!;

    const next = i + 1 < dates.length ? cmap.SPY.get(dates[i + 1]) : null;
    const next3 = i + 3 < dates.length ? cmap.SPY.get(dates[i + 3]) : null;

    rawPoints.push({
      tradeDate: d,
      vector: {
        spyRsi: rsi[i]!,
        vixMomentum: vixPrev.close > 0 ? -pct(vixPrev.close, vix.close) : 0,
        hygTltRatio: tlt.close > 0 ? hyg.close / tlt.close : 0,
        cperGldRatio: gld.close > 0 ? cper.close / gld.close : 0,
        usoMomentum: usoPrev.close > 0 ? pct(usoPrev.close, uso.close) : 0,
        vixLevel: vix.close,
      },
      spyClose: spy.close,
      spyOpen: spy.open,
      closeToClosePct: pct(prevSpy.close, spy.close),
      openToClosePct: spy.open > 0 ? pct(spy.open, spy.close) : 0,
      spyForward1DCtc: next ? pct(spy.close, next.close) : null,
      spyForward3DCtc: next3 ? pct(spy.close, next3.close) : null,
      spyForward1DOtc: next && next.open > 0 ? pct(next.open, next.close) : null,
      spyForward3DOtc:
        next && next3 && next.open > 0 ? pct(next.open, next3.close) : null,
    });
  }

  const stationarized = stationarizeLevelFeatures(
    rawPoints,
    STOCKS_LEVEL_FEATURES_FOR_PERCENTILE,
    {
      window: ANALOG_MODEL_SETTINGS.percentileWindowSessions,
      minHistory: ANALOG_MODEL_SETTINGS.percentileMinHistorySessions,
    },
  ) as Point[];
  console.log(`Stationarized points: ${stationarized.length}\n`);

  const blend = {
    w1: ANALOG_MODEL_SETTINGS.oneDayBlendWeight,
    w3: ANALOG_MODEL_SETTINGS.threeDayBlendWeight,
  };
  const rules = STOCKS_STRATEGY_RULES;

  // ========== STEP 0: Fair production vs baseline ==========
  console.log("########## STEP 0: Fair production vs baseline (close→close) ##########\n");
  const fullFeatures = [...ALL_FEATURES];
  const prodDays = walkForward(stationarized, fullFeatures, rules, blend);
  const baseCtc = reportFromLagged("BASELINE score±20 CTC", prodDays, "ctc", false, rules);
  const prodCtc = reportFromLagged("PRODUCTION soft-gates CTC", prodDays, "ctc", true, rules);
  printReport(baseCtc);
  printReport(prodCtc);

  const improvedCtc =
    prodCtc.fairObjective > baseCtc.fairObjective ||
    (prodCtc.hitRate >= baseCtc.hitRate - 0.2 && prodCtc.edge >= baseCtc.edge);
  console.log(
    improvedCtc
      ? `\nFair CTC: production is competitive/better (fairObj ${baseCtc.fairObjective.toFixed(4)} → ${prodCtc.fairObjective.toFixed(4)})`
      : `\nFair CTC: production does NOT beat baseline on fair objective`,
  );

  // ========== STEP 1: Feature ablation ==========
  console.log("\n########## STEP 1: Feature ablation ##########\n");
  const ablationResults: { features: FeatureKey[]; dropped: string; report: FairReport }[] = [
    {
      features: fullFeatures,
      dropped: "(none)",
      report: prodCtc,
    },
  ];

  for (const drop of ALL_FEATURES) {
    const feats = ALL_FEATURES.filter((f) => f !== drop);
    // Need at least 3 features
    if (feats.length < 3) continue;
    console.log(`  ablating ${drop}...`);
    const days = walkForward(stationarized, [...feats], rules, blend);
    const rep = reportFromLagged(`drop ${drop}`, days, "ctc", true, rules);
    ablationResults.push({ features: [...feats], dropped: drop, report: rep });
  }

  // Also try dropping weak pairs
  for (const pair of [
    ["usoMomentum", "cperGldRatio"],
    ["usoMomentum", "vixMomentum"],
    ["cperGldRatio", "vixMomentum"],
  ] as FeatureKey[][]) {
    const feats = ALL_FEATURES.filter((f) => !pair.includes(f));
    console.log(`  ablating ${pair.join("+")}...`);
    const days = walkForward(stationarized, [...feats], rules, blend);
    const rep = reportFromLagged(`drop ${pair.join("+")}`, days, "ctc", true, rules);
    ablationResults.push({
      features: [...feats],
      dropped: pair.join("+"),
      report: rep,
    });
  }

  ablationResults.sort((a, b) => b.report.fairObjective - a.report.fairObjective);
  console.log("\nAblation ranking (fair objective):");
  for (const a of ablationResults.slice(0, 8)) {
    console.log(
      `  drop=${a.dropped.padEnd(24)} fairObj=${a.report.fairObjective.toFixed(4)} hit=${a.report.hitRate.toFixed(1)}% edge=${a.report.edge.toFixed(3)} whenIn=${a.report.avgWhenIn.toFixed(3)}`,
    );
  }

  const bestAblation = ablationResults[0];
  const ablationImproved =
    bestAblation.report.fairObjective > prodCtc.fairObjective + 0.005;
  console.log(
    ablationImproved
      ? `\nABLATION WINNER: drop ${bestAblation.dropped} (fairObj ${prodCtc.fairObjective.toFixed(4)} → ${bestAblation.report.fairObjective.toFixed(4)})`
      : `\nABLATION: no material improvement over full feature set`,
  );

  const bestFeatures = bestAblation.features;
  const bestDays = ablationImproved
    ? walkForward(stationarized, bestFeatures, rules, blend)
    : prodDays;
  const bestCtc = reportFromLagged(
    "BEST FEATURES CTC",
    bestDays,
    "ctc",
    true,
    rules,
  );

  // ========== STEP 2: Reliability recalibration ==========
  console.log("\n########## STEP 2: Reliability recalibration ##########\n");
  const defaultRel = reportFromLagged("default grades", bestDays, "ctc", true, rules);
  printReport(defaultRel);

  const cal = calibrateReliability(bestDays, "ctc", rules);
  console.log(cal.report);

  // Re-score grades on same days with calibrated thresholds (position unchanged)
  const regradedDays = bestDays.map((d) => ({
    ...d,
    signal: {
      ...d.signal,
      reliability: cal.grade(d.meanDistance, d.neighborAgreement, d.distanceQuality),
    },
  }));
  const calRel = reportFromLagged("calibrated grades", regradedDays, "ctc", true, rules);
  printReport(calRel);

  const relImproved =
    (calRel.relSeparation ?? -999) > (defaultRel.relSeparation ?? -999) + 1 &&
    (calRel.highRelHit ?? 0) > (calRel.lowRelHit ?? 100);

  console.log(
    relImproved
      ? `\nRELIABILITY: calibrated separation improved (${defaultRel.relSeparation?.toFixed(1) ?? "n/a"} → ${calRel.relSeparation?.toFixed(1)}pp)`
      : `\nRELIABILITY: calibration did not meaningfully improve A/B vs D/F separation`,
  );

  // ========== STEP 3: Open→close labels ==========
  console.log("\n########## STEP 3: Open→close vs close→close labels ##########\n");
  // For OTC we still build score from CTC forward returns in neighbors historically
  // but evaluate lag positions on next session open→close (tradable morning session)
  const otcBase = reportFromLagged("BASELINE OTC eval", bestDays, "otc", false, rules);
  const otcProd = reportFromLagged("BEST FEATURES OTC eval", bestDays, "otc", true, rules);
  printReport(otcBase);
  printReport(otcProd);

  const otcBetterThanCtc =
    otcProd.fairObjective > bestCtc.fairObjective + 0.01 ||
    (otcProd.hitRate > bestCtc.hitRate + 0.5 && otcProd.edge >= bestCtc.edge - 0.01);

  console.log(
    otcBetterThanCtc
      ? `\nOTC: open→close evaluation looks BETTER for product (fairObj CTC ${bestCtc.fairObjective.toFixed(4)} vs OTC ${otcProd.fairObjective.toFixed(4)})`
      : `\nOTC: open→close not clearly better than CTC for ranking; still switch product eval to OTC as correct tradable horizon if hit/edge not worse`,
  );

  // Prefer OTC for product if not materially worse
  const otcAcceptable =
    otcProd.hitRate >= bestCtc.hitRate - 1.0 &&
    otcProd.avgWhenIn >= bestCtc.avgWhenIn - 0.02;

  // ========== FINAL VERDICT ==========
  console.log("\n########## FINAL VERDICT ##########\n");

  const finalVsBaseline = reportFromLagged(
    "FINAL package vs baseline",
    bestDays,
    otcAcceptable ? "otc" : "ctc",
    true,
    rules,
  );
  const finalBaseline = reportFromLagged(
    "baseline same horizon",
    bestDays,
    otcAcceptable ? "otc" : "ctc",
    false,
    rules,
  );
  printReport(finalBaseline);
  printReport(finalVsBaseline);

  const packageImproved =
    finalVsBaseline.fairObjective >= finalBaseline.fairObjective - 0.02 &&
    (ablationImproved ||
      relImproved ||
      finalVsBaseline.fairObjective > finalBaseline.fairObjective ||
      (finalVsBaseline.hitRate >= finalBaseline.hitRate &&
        finalVsBaseline.edge >= finalBaseline.edge));

  const summary = {
    improved: packageImproved,
    horizon: otcAcceptable ? "open_to_close" : "close_to_close",
    featuresToDrop: ablationImproved
      ? ALL_FEATURES.filter((f) => !bestFeatures.includes(f))
      : [],
    featuresKeep: bestFeatures,
    reliability: relImproved ? cal.report : "keep_default",
    metrics: {
      baseline: finalBaseline,
      final: finalVsBaseline,
      defaultRelSeparation: defaultRel.relSeparation,
      calibratedRelSeparation: calRel.relSeparation,
    },
    calibratedThresholds: relImproved ? cal.report : null,
  };

  console.log("\nAPPLY_SUMMARY_JSON=");
  console.log(JSON.stringify(summary, null, 2));

  // Write a small machine-readable result for apply step
  const fs = await import("fs");
  fs.writeFileSync(
    "scripts/.quality-optimize-result.json",
    JSON.stringify(
      {
        ...summary,
        calReport: cal.report,
        // Parse thresholds from calibration for apply (store raw best from calibrate function)
        productionRules: rules,
        blend,
      },
      null,
      2,
    ),
  );

  process.exit(packageImproved ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
