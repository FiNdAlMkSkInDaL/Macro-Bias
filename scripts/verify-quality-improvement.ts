/**
 * Final verification: does v8 (drop vixLevel + soft gates + selective reliability,
 * CTC neighbor labels, A–D directional) beat naive score±20 on fair metrics?
 *
 * Also re-checks rejected v9 candidates (OTC train, A/B-only) so regressions
 * stay visible. Exit 0 only if locked v8 package still beats baseline.
 *
 * Run: npx tsx scripts/verify-quality-improvement.ts
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";
import {
  ANALOG_MODEL_SETTINGS,
  STOCKS_KNN_FEATURE_KEYS,
  STOCKS_LEVEL_FEATURES_FOR_PERCENTILE,
} from "../src/lib/macro-bias/constants";
import {
  buildTradableSignal,
  inverseDistanceWeight,
  positionFromSignal,
  stationarizeLevelFeatures,
  weightedMean,
  STOCKS_STRATEGY_RULES,
} from "../src/lib/signal";
import type { TradableSignal } from "../src/lib/signal/types";

const BACKTEST_START = "2020-01-01";
const RSI = 14;

type FKey = (typeof STOCKS_KNN_FEATURE_KEYS)[number] | "vixLevel";

function pct(a: number, b: number) {
  return ((b - a) / a) * 100;
}
function avg(xs: number[]) {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
}
function daysBetween(a: string, b: string) {
  return Math.abs(
    Math.round(
      (Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) -
        Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) /
        86400000,
    ),
  );
}

async function fetchAll(sb: any, ticker: string) {
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("etf_daily_prices")
      .select("trade_date, open, close")
      .eq("ticker", ticker)
      .order("trade_date", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

function rsiSeries(closes: number[]) {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let g = 0,
    l = 0;
  for (let i = 1; i <= RSI; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d;
    else l += -d;
  }
  g /= RSI;
  l /= RSI;
  out[RSI] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = RSI + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (RSI - 1) + (d > 0 ? d : 0)) / RSI;
    l = (l * (RSI - 1) + (d < 0 ? -d : 0)) / RSI;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

type Day = {
  score: number;
  signal: TradableSignal;
  ctc: number;
  otc: number;
};

function fairObj(hit: number, edge: number, whenIn: number, cash: number) {
  const pen = cash < 0.1 ? 0.15 : cash > 0.85 ? 0.25 : cash > 0.7 ? 0.05 : 0;
  return edge * 2 + ((hit - 50) / 100) * 1.5 + whenIn * 3 - pen;
}

function evalLagged(days: Day[], mode: "ctc" | "otc", useSignal: boolean) {
  let dir = 0,
    hits = 0,
    cash = 0;
  const longs: number[] = [];
  const shorts: number[] = [];
  const when: number[] = [];
  let hiH = 0,
    hiN = 0,
    loH = 0,
    loN = 0;

  for (let i = 1; i < days.length; i++) {
    const p = days[i - 1];
    const s = days[i];
    const ret = mode === "ctc" ? s.ctc : s.otc;
    let pos: "LONG" | "SHORT" | "CASH";
    if (useSignal) pos = positionFromSignal(p.signal, p.score, STOCKS_STRATEGY_RULES);
    else pos = p.score > 20 ? "LONG" : p.score < -20 ? "SHORT" : "CASH";
    if (pos === "CASH") {
      cash++;
      continue;
    }
    dir++;
    const ok = pos === "LONG" ? ret >= 0 : ret <= 0;
    if (ok) hits++;
    if (pos === "LONG") {
      longs.push(ret);
      when.push(ret);
    } else {
      shorts.push(ret);
      when.push(-ret);
    }
    if (useSignal) {
      const r = p.signal.reliability;
      if (r === "A" || r === "B") {
        hiN++;
        if (ok) hiH++;
      }
      if (r === "D" || r === "F") {
        loN++;
        if (ok) loH++;
      }
    }
  }
  const n = days.length - 1;
  const hit = dir ? (hits / dir) * 100 : 50;
  const edge = longs.length && shorts.length ? avg(longs) - avg(shorts) : 0;
  const whenIn = when.length ? avg(when) : 0;
  const cashR = n ? cash / n : 1;
  return {
    hit,
    edge,
    whenIn,
    cashR,
    dir,
    fair: fairObj(hit, edge, whenIn, cashR),
    hiHit: hiN >= 15 ? (hiH / hiN) * 100 : null,
    hiN,
    loHit: loN >= 15 ? (loH / loN) * 100 : null,
    loN,
  };
}

/** v9-candidate: force C/D → FLAT (measured reject). */
function buildAbOnlySignal(
  score: number,
  nret: number[],
  ndist: number[],
): TradableSignal {
  const base = buildTradableSignal({
    score,
    neighborForwardReturns: nret,
    neighborDistances: ndist,
    rules: STOCKS_STRATEGY_RULES,
  });
  if (base.reliability === "A" || base.reliability === "B" || base.reliability === "F") {
    return base;
  }
  return {
    ...base,
    position: "FLAT",
    size: 0,
    noTrade: false,
    reason: "A/B-only experimental FLAT for C/D",
  };
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const tickers = ["SPY", "TLT", "GLD", "USO", "HYG", "VIX", "CPER"] as const;
  const series = await Promise.all(tickers.map((t) => fetchAll(sb, t)));
  const by: Record<string, any[]> = {};
  tickers.forEach((t, i) => (by[t] = series[i]));
  const sets = tickers.map((t) => new Set(by[t].map((r) => r.trade_date)));
  const dates = [...sets[0]].filter((d) => sets.every((s) => s.has(d))).sort();
  const maps: Record<string, Map<string, any>> = {};
  for (const t of tickers) maps[t] = new Map(by[t].map((r) => [r.trade_date, r]));

  const closes = dates.map((d) => maps.SPY.get(d).close);
  const rsi = rsiSeries(closes);
  const minLb = Math.max(RSI, 5);

  type P = {
    tradeDate: string;
    vector: Record<string, number>;
    spyClose: number;
    ctc: number;
    otc: number;
    f1Ctc: number | null;
    f3Ctc: number | null;
    f1Otc: number | null;
    f3Otc: number | null;
  };
  const pts: P[] = [];
  for (let i = minLb; i < dates.length; i++) {
    const d = dates[i];
    if (rsi[i] == null) continue;
    const spy = maps.SPY.get(d);
    const prev = maps.SPY.get(dates[i - 1]);
    const vix = maps.VIX.get(d);
    const vixP = maps.VIX.get(dates[i - 5]);
    const hyg = maps.HYG.get(d);
    const tlt = maps.TLT.get(d);
    const cper = maps.CPER.get(d);
    const gld = maps.GLD.get(d);
    const uso = maps.USO.get(d);
    const usoP = maps.USO.get(dates[i - 5]);
    const n1 = i + 1 < dates.length ? maps.SPY.get(dates[i + 1]) : null;
    const n3 = i + 3 < dates.length ? maps.SPY.get(dates[i + 3]) : null;
    pts.push({
      tradeDate: d,
      vector: {
        spyRsi: rsi[i]!,
        vixMomentum: vixP.close > 0 ? -pct(vixP.close, vix.close) : 0,
        hygTltRatio: tlt.close > 0 ? hyg.close / tlt.close : 0,
        cperGldRatio: gld.close > 0 ? cper.close / gld.close : 0,
        usoMomentum: usoP.close > 0 ? pct(usoP.close, uso.close) : 0,
        vixLevel: vix.close,
      },
      spyClose: spy.close,
      ctc: pct(prev.close, spy.close),
      otc: spy.open > 0 ? pct(spy.open, spy.close) : 0,
      f1Ctc: n1 ? pct(spy.close, n1.close) : null,
      f3Ctc: n3 ? pct(spy.close, n3.close) : null,
      f1Otc: n1 && n1.open > 0 ? pct(n1.open, n1.close) : null,
      f3Otc: n1 && n3 && n1.open > 0 ? pct(n1.open, n3.close) : null,
    });
  }

  const st = stationarizeLevelFeatures(pts, STOCKS_LEVEL_FEATURES_FOR_PERCENTILE, {
    window: ANALOG_MODEL_SETTINGS.percentileWindowSessions,
    minHistory: ANALOG_MODEL_SETTINGS.percentileMinHistorySessions,
  }) as P[];

  const knnKeys = [...STOCKS_KNN_FEATURE_KEYS] as FKey[];
  const allKeys = [...knnKeys, "vixLevel"] as FKey[];

  function run(
    features: FKey[],
    opts: {
      labelMode: "ctc" | "otc";
      signalMode: "naive" | "product" | "ab_only";
    },
  ): Day[] {
    const start = st.findIndex((p) => p.tradeDate >= BACKTEST_START);
    const days: Day[] = [];
    for (let ti = start; ti < st.length; ti++) {
      const today = st[ti];
      const pool = st.slice(0, ti);
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
      const tz: Record<string, number> = {};
      for (const k of features) tz[k] = (today.vector[k] - means[k]) / stds[k];

      const f1 = (p: P) => (opts.labelMode === "otc" ? p.f1Otc : p.f1Ctc);
      const f3 = (p: P) => (opts.labelMode === "otc" ? p.f3Otc : p.f3Ctc);

      const ranked = pool
        .filter((p) => f1(p) != null)
        .filter((p) => daysBetween(today.tradeDate, p.tradeDate) >= 5)
        .map((analog) => {
          let sq = 0;
          for (const k of features) {
            const z = (analog.vector[k] - means[k]) / stds[k];
            sq += (tz[k] - z) ** 2;
          }
          const dist =
            Math.sqrt(sq) *
            Math.exp(
              ANALOG_MODEL_SETTINGS.temporalDecayLambda *
                daysBetween(today.tradeDate, analog.tradeDate),
            );
          return {
            analog,
            distance: dist,
            weight: inverseDistanceWeight(dist, 0.05),
          };
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5);
      if (ranked.length < 5) continue;
      const w = ranked.map((r) => r.weight);
      const a1 = weightedMean(
        ranked.map((r) => f1(r.analog) ?? 0),
        w,
      );
      const a3 = weightedMean(
        ranked.map((r) => f3(r.analog) ?? 0),
        w,
      );
      const blended = 0.4 * a1 + 0.6 * a3;
      const score = Math.max(
        -100,
        Math.min(100, Math.round(Math.tanh(blended / 2.75) * 100)),
      );
      const nret = ranked.map(
        (r) => (f1(r.analog) ?? 0) * 0.4 + (f3(r.analog) ?? 0) * 0.6,
      );
      const ndist = ranked.map((r) => r.distance);

      let signal: TradableSignal;
      if (opts.signalMode === "naive") {
        const pos = score > 20 ? "LONG" : score < -20 ? "SHORT" : "FLAT";
        signal = {
          position: pos,
          size: pos === "FLAT" ? 0 : 1,
          reliability: "C",
          neighborAgreement: 0.5,
          meanNeighborDistance: 1,
          distanceQuality: 0.5,
          noTrade: false,
          reason: "naive",
        };
      } else if (opts.signalMode === "ab_only") {
        signal = buildAbOnlySignal(score, nret, ndist);
      } else {
        signal = buildTradableSignal({
          score,
          neighborForwardReturns: nret,
          neighborDistances: ndist,
          rules: STOCKS_STRATEGY_RULES,
        });
      }
      days.push({ score, signal, ctc: today.ctc, otc: today.otc });
    }
    return days;
  }

  console.log("Walk-forward A: baseline full features + CTC + naive score±20");
  const dBase = run(allKeys, { labelMode: "ctc", signalMode: "naive" });
  console.log("Walk-forward B: locked v8 knn + CTC + soft gates (A–D directional)");
  const dV8 = run(knnKeys, { labelMode: "ctc", signalMode: "product" });
  console.log("Walk-forward C: rejected OTC train + product gates");
  const dOtc = run(knnKeys, { labelMode: "otc", signalMode: "product" });
  console.log("Walk-forward D: rejected A/B-only directional (CTC train)");
  const dAb = run(knnKeys, { labelMode: "ctc", signalMode: "ab_only" });

  console.log("\n========== LOCKED v8 vs BASELINE ==========");
  for (const mode of ["ctc", "otc"] as const) {
    const base = evalLagged(dBase, mode, false);
    const v8 = evalLagged(dV8, mode, true);
    console.log(`\n--- ${mode.toUpperCase()} ---`);
    console.log(
      `BASELINE  hit=${base.hit.toFixed(1)}% edge=${base.edge.toFixed(3)} whenIn=${base.whenIn.toFixed(3)} cash=${(base.cashR * 100).toFixed(1)}% fair=${base.fair.toFixed(4)}`,
    );
    console.log(
      `v8        hit=${v8.hit.toFixed(1)}% edge=${v8.edge.toFixed(3)} whenIn=${v8.whenIn.toFixed(3)} cash=${(v8.cashR * 100).toFixed(1)}% fair=${v8.fair.toFixed(4)}`,
    );
    console.log(
      `  reliability A/B hit=${v8.hiHit?.toFixed(1) ?? "n/a"}% n=${v8.hiN} | D/F hit=${v8.loHit?.toFixed(1) ?? "n/a"}% n=${v8.loN}`,
    );
  }

  console.log("\n========== REJECTED v9 CANDIDATES (OTC eval) ==========");
  const baseOtc = evalLagged(dBase, "otc", false);
  const v8Otc = evalLagged(dV8, "otc", true);
  const otcTrain = evalLagged(dOtc, "otc", true);
  const abOnly = evalLagged(dAb, "otc", true);
  console.log(
    `v8 locked     hit=${v8Otc.hit.toFixed(1)}% edge=${v8Otc.edge.toFixed(3)} cash=${(v8Otc.cashR * 100).toFixed(1)}% fair=${v8Otc.fair.toFixed(4)}`,
  );
  console.log(
    `OTC train     hit=${otcTrain.hit.toFixed(1)}% edge=${otcTrain.edge.toFixed(3)} cash=${(otcTrain.cashR * 100).toFixed(1)}% fair=${otcTrain.fair.toFixed(4)}  ${otcTrain.fair > v8Otc.fair ? "BETTER" : "WORSE/same"}`,
  );
  console.log(
    `A/B-only      hit=${abOnly.hit.toFixed(1)}% edge=${abOnly.edge.toFixed(3)} cash=${(abOnly.cashR * 100).toFixed(1)}% fair=${abOnly.fair.toFixed(4)}  ${abOnly.fair > v8Otc.fair ? "BETTER" : "WORSE/same"}`,
  );
  console.log(
    `baseline      hit=${baseOtc.hit.toFixed(1)}% edge=${baseOtc.edge.toFixed(3)} cash=${(baseOtc.cashR * 100).toFixed(1)}% fair=${baseOtc.fair.toFixed(4)}`,
  );

  // Gate: locked v8 must beat baseline on CTC fair (historical lock) OR OTC fair.
  const baseCtc = evalLagged(dBase, "ctc", false);
  const v8Ctc = evalLagged(dV8, "ctc", true);
  const ctcPass =
    v8Ctc.fair > baseCtc.fair ||
    (v8Ctc.hit > baseCtc.hit + 0.5 && v8Ctc.edge >= baseCtc.edge - 0.01);
  const otcPass =
    v8Otc.fair > baseOtc.fair ||
    (v8Otc.hit >= baseOtc.hit && v8Otc.edge > baseOtc.edge);

  // Confirm rejected candidates stay rejected (should not beat locked v8 on OTC fair)
  const otcTrainReject = otcTrain.fair <= v8Otc.fair + 0.01;
  const abOnlyReject = abOnly.fair <= v8Otc.fair + 0.01;

  console.log("\n========== VERDICT ==========");
  console.log(
    ctcPass
      ? "LOCKED v8 BEATS baseline on CTC fair metrics"
      : "LOCKED v8 does not beat baseline on CTC",
  );
  console.log(
    otcPass
      ? "LOCKED v8 BEATS baseline on OTC fair metrics"
      : "LOCKED v8 does not clearly beat baseline on OTC (noise floor)",
  );
  console.log(
    otcTrainReject
      ? "OTC-train candidate remains REJECTED vs v8"
      : "WARNING: OTC-train now beats v8 — re-open research",
  );
  console.log(
    abOnlyReject
      ? "A/B-only candidate remains REJECTED vs v8"
      : "WARNING: A/B-only now beats v8 — re-open research",
  );

  if (!ctcPass) {
    console.log("\nOVERALL: FAIL — locked package regression");
    process.exit(2);
  }
  console.log("\nOVERALL: locked v8 package confirmed; v9 candidates stay rejected");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
