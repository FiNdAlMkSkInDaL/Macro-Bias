/**
 * Verify locked v10 package (cosine distance + Monday dampener)
 * beats v8 Euclidean and baseline on next-session open→close.
 *
 * Run: npx tsx scripts/verify-v10-cosine-skipmon.ts
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
import { isUsEquityMonday } from "../src/utils/knn";
import type { TradableSignal } from "../src/lib/signal/types";

const BACKTEST_START = "2020-01-01";
const RSI = 14;

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
function fairObj(hit: number, edge: number, whenIn: number, cash: number) {
  const pen = cash < 0.1 ? 0.15 : cash > 0.85 ? 0.25 : cash > 0.7 ? 0.05 : 0;
  return edge * 2 + ((hit - 50) / 100) * 1.5 + whenIn * 3 - pen;
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

type Day = { score: number; signal: TradableSignal; otc: number; ctc: number; date: string };

function evalLagged(days: Day[], mode: "ctc" | "otc", useSignal: boolean) {
  let dir = 0,
    hits = 0,
    cash = 0;
  const longs: number[] = [];
  const shorts: number[] = [];
  const when: number[] = [];
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
  }
  const n = days.length - 1;
  const hit = dir ? (hits / dir) * 100 : 50;
  const edge = longs.length && shorts.length ? avg(longs) - avg(shorts) : 0;
  const whenIn = when.length ? avg(when) : 0;
  const cashR = n ? cash / n : 1;
  return { hit, edge, whenIn, cashR, dir, fair: fairObj(hit, edge, whenIn, cashR) };
}

async function main() {
  // Unit checks for cosine helper
  {
    const { calculateCosineDistance, calculateEuclideanDistance, isUsEquityMonday } =
      await import("../src/utils/knn");
    const a = { tradeDate: "2020-01-02", vector: { x: 1, y: 0 } };
    const b = { tradeDate: "2020-01-03", vector: { x: 1, y: 0 } };
    const c = { tradeDate: "2020-01-03", vector: { x: -1, y: 0 } };
    const cosSame = calculateCosineDistance(a, b);
    const cosOpp = calculateCosineDistance(a, c);
    if (cosSame > 1e-9) throw new Error(`identical vectors cosine dist should be 0, got ${cosSame}`);
    if (Math.abs(cosOpp - 2) > 1e-9) throw new Error(`opposite cosine dist should be 2, got ${cosOpp}`);
    const eu = calculateEuclideanDistance(a, b);
    if (eu > 1e-9) throw new Error("identical euclidean should be 0");
    if (!isUsEquityMonday("2020-01-06")) throw new Error("2020-01-06 was Monday");
    if (isUsEquityMonday("2020-01-07")) throw new Error("2020-01-07 was Tuesday");
    console.log("ok: cosine / Monday unit checks");
  }

  if (ANALOG_MODEL_SETTINGS.distanceMetric !== "cosine") {
    throw new Error("Expected ANALOG_MODEL_SETTINGS.distanceMetric === cosine");
  }
  if (!ANALOG_MODEL_SETTINGS.skipMondayScores) {
    throw new Error("Expected skipMondayScores true");
  }

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
    ctc: number;
    otc: number;
    f1: number | null;
    f3: number | null;
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
      ctc: pct(prev.close, spy.close),
      otc: spy.open > 0 ? pct(spy.open, spy.close) : 0,
      f1: n1 ? pct(spy.close, n1.close) : null,
      f3: n3 ? pct(spy.close, n3.close) : null,
    });
  }

  const st = stationarizeLevelFeatures(pts, STOCKS_LEVEL_FEATURES_FOR_PERCENTILE, {
    window: ANALOG_MODEL_SETTINGS.percentileWindowSessions,
    minHistory: ANALOG_MODEL_SETTINGS.percentileMinHistorySessions,
  }) as P[];

  const knnKeys = [...STOCKS_KNN_FEATURE_KEYS];
  const allKeys = [...knnKeys, "vixLevel"];

  function run(
    features: string[],
    opts: {
      metric: "euclidean" | "cosine";
      skipMonday: boolean;
      useGates: boolean;
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
        const m = avg(vals);
        const v = vals.reduce((s, x) => s + (x - m) ** 2, 0) / vals.length;
        means[k] = m;
        stds[k] = Math.sqrt(v) || 1;
      }
      const tz: Record<string, number> = {};
      for (const k of features) tz[k] = (today.vector[k] - means[k]) / stds[k];

      const ranked = pool
        .filter((p) => p.f1 != null)
        .filter((p) => daysBetween(today.tradeDate, p.tradeDate) >= 5)
        .map((analog) => {
          const az: Record<string, number> = {};
          for (const k of features) az[k] = (analog.vector[k] - means[k]) / stds[k];
          let base = 0;
          if (opts.metric === "cosine") {
            let dot = 0,
              nt = 0,
              na = 0;
            for (const k of features) {
              dot += tz[k] * az[k];
              nt += tz[k] * tz[k];
              na += az[k] * az[k];
            }
            const cos = nt && na ? dot / (Math.sqrt(nt) * Math.sqrt(na)) : 0;
            base = 1 - Math.min(1, Math.max(-1, cos));
          } else {
            let sq = 0;
            for (const k of features) sq += (tz[k] - az[k]) ** 2;
            base = Math.sqrt(sq);
          }
          const dist =
            base *
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
        ranked.map((r) => r.analog.f1 ?? 0),
        w,
      );
      const a3 = weightedMean(
        ranked.map((r) => r.analog.f3 ?? 0),
        w,
      );
      const blended = 0.4 * a1 + 0.6 * a3;
      let score = Math.max(
        -100,
        Math.min(100, Math.round(Math.tanh(blended / 2.75) * 100)),
      );
      const nret = ranked.map((r) => (r.analog.f1 ?? 0) * 0.4 + (r.analog.f3 ?? 0) * 0.6);
      const ndist = ranked.map((r) => r.distance);

      let signal: TradableSignal;
      if (!opts.useGates) {
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
      } else {
        signal = buildTradableSignal({
          score,
          neighborForwardReturns: nret,
          neighborDistances: ndist,
          rules: STOCKS_STRATEGY_RULES,
        });
      }

      if (opts.skipMonday && isUsEquityMonday(today.tradeDate)) {
        score = 0;
        if (signal.position !== "NO_TRADE") {
          signal = {
            ...signal,
            position: "FLAT",
            size: 0,
            noTrade: false,
            reason: "Monday dampener",
          };
        }
      }

      days.push({
        score,
        signal,
        otc: today.otc,
        ctc: today.ctc,
        date: today.tradeDate,
      });
    }
    return days;
  }

  console.log("Walk-forward packages...");
  const baseline = run(allKeys, {
    metric: "euclidean",
    skipMonday: false,
    useGates: false,
  });
  const v8 = run(knnKeys, {
    metric: "euclidean",
    skipMonday: false,
    useGates: true,
  });
  const cosineOnly = run(knnKeys, {
    metric: "cosine",
    skipMonday: false,
    useGates: true,
  });
  const v10 = run(knnKeys, {
    metric: "cosine",
    skipMonday: true,
    useGates: true,
  });

  console.log("\n========== NEXT-SESSION OTC (product) ==========");
  for (const [name, days, useSig] of [
    ["BASELINE", baseline, false],
    ["v8 Euclidean gates", v8, true],
    ["cosine only + gates", cosineOnly, true],
    ["v10 cosine+skipMon", v10, true],
  ] as const) {
    const r = evalLagged(days, "otc", useSig);
    console.log(
      `${name.padEnd(22)} hit=${r.hit.toFixed(1)}% edge=${r.edge.toFixed(3)} whenIn=${r.whenIn.toFixed(3)} cash=${(r.cashR * 100).toFixed(1)}% dir=${r.dir} fair=${r.fair.toFixed(4)}`,
    );
  }

  console.log("\n========== CTC (diagnostic) ==========");
  for (const [name, days, useSig] of [
    ["BASELINE", baseline, false],
    ["v8", v8, true],
    ["v10", v10, true],
  ] as const) {
    const r = evalLagged(days, "ctc", useSig);
    console.log(
      `${name.padEnd(22)} hit=${r.hit.toFixed(1)}% edge=${r.edge.toFixed(3)} fair=${r.fair.toFixed(4)}`,
    );
  }

  const baseOtc = evalLagged(baseline, "otc", false);
  const v8Otc = evalLagged(v8, "otc", true);
  const cosOtc = evalLagged(cosineOnly, "otc", true);
  const v10Otc = evalLagged(v10, "otc", true);
  const v10Ctc = evalLagged(v10, "ctc", true);
  const baseCtc = evalLagged(baseline, "ctc", false);
  const v8Ctc = evalLagged(v8, "ctc", true);

  const beatsV8Otc =
    v10Otc.fair > v8Otc.fair + 0.01 ||
    (v10Otc.hit > v8Otc.hit + 0.3 && v10Otc.edge >= v8Otc.edge - 0.01);
  const beatsBaseOtc =
    v10Otc.fair > baseOtc.fair ||
    (v10Otc.hit >= baseOtc.hit && v10Otc.edge > baseOtc.edge);
  const cosineHelps = cosOtc.fair > v8Otc.fair + 0.01;
  const stillOkCtc = v10Ctc.fair >= v8Ctc.fair - 0.05 || v10Ctc.hit >= v8Ctc.hit - 1;

  console.log("\n========== VERDICT ==========");
  console.log(
    cosineHelps
      ? `cosine alone BEATS v8 on OTC fair (${v8Otc.fair.toFixed(4)} → ${cosOtc.fair.toFixed(4)})`
      : `cosine alone does not clearly beat v8 on OTC`,
  );
  console.log(
    beatsV8Otc
      ? `v10 BEATS v8 on OTC fair (${v8Otc.fair.toFixed(4)} → ${v10Otc.fair.toFixed(4)})`
      : `v10 does not beat v8 on OTC`,
  );
  console.log(
    beatsBaseOtc
      ? `v10 BEATS baseline on OTC`
      : `v10 does not beat baseline on OTC`,
  );
  console.log(
    stillOkCtc
      ? `v10 CTC remains acceptable vs v8`
      : `v10 CTC regressed badly vs v8`,
  );

  if (!beatsV8Otc || !beatsBaseOtc) {
    console.log("\nFAIL: do not lock v10");
    process.exit(2);
  }
  console.log("\nPASS: lock macro-model-v10-cosine-skipmon");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
