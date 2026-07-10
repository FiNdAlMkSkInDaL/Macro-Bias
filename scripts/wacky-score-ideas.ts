/**
 * Wacky / outside-the-box ideas for the *published daily score*.
 * Product metric only: next-session open→close (lag-1 morning permission).
 *
 * Run: npx tsx scripts/wacky-score-ideas.ts
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
  inverseDistanceWeight,
  stationarizeLevelFeatures,
  weightedMean,
} from "../src/lib/signal";

const BACKTEST_START = "2020-01-01";
const RSI = 14;
const THR = 20;

type FKey = string;

function pct(a: number, b: number) {
  return ((b - a) / a) * 100;
}
function avg(xs: number[]) {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
}
function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stdev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  return Math.sqrt(avg(xs.map((x) => (x - m) ** 2)));
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
function dow(d: string) {
  return new Date(d + "T12:00:00Z").getUTCDay(); // 0=Sun
}
function fairObj(hit: number, edge: number, whenIn: number, cash: number) {
  const pen = cash < 0.1 ? 0.15 : cash > 0.85 ? 0.25 : cash > 0.7 ? 0.05 : 0;
  return edge * 2 + ((hit - 50) / 100) * 1.5 + whenIn * 3 - pen;
}
function clampScore(x: number) {
  return Math.max(-100, Math.min(100, Math.round(x)));
}
function tanhScore(blended: number, scale = 2.75) {
  return clampScore(Math.tanh(blended / scale) * 100);
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

type Point = {
  tradeDate: string;
  vector: Record<string, number>;
  spyClose: number;
  spyOpen: number;
  ctc: number;
  otc: number;
  /** same-day overnight gap close_prev → open */
  overnight: number;
  f1Ctc: number | null;
  f3Ctc: number | null;
  f1Otc: number | null;
  f3Otc: number | null;
  /** next session OTC (evaluation target for lag) */
  nextOtc: number | null;
};

type IdeaResult = {
  name: string;
  family: string;
  hit: number;
  edge: number;
  whenIn: number;
  cash: number;
  dir: number;
  fair: number;
  longN: number;
  shortN: number;
};

function evalScores(scores: number[], nextOtcs: (number | null)[], thr = THR): IdeaResult {
  let dir = 0,
    hits = 0,
    cash = 0;
  const longs: number[] = [];
  const shorts: number[] = [];
  const when: number[] = [];
  // lag-1: score[i] applied to nextOtc[i] which is session i+1 open→close
  for (let i = 0; i < scores.length - 1; i++) {
    const score = scores[i];
    const ret = nextOtcs[i];
    if (ret == null || !Number.isFinite(ret)) continue;
    if (Math.abs(score) <= thr) {
      cash++;
      continue;
    }
    dir++;
    const long = score > 0;
    const ok = long ? ret >= 0 : ret <= 0;
    if (ok) hits++;
    if (long) {
      longs.push(ret);
      when.push(ret);
    } else {
      shorts.push(ret);
      when.push(-ret);
    }
  }
  const n = dir + cash;
  const hit = dir ? (hits / dir) * 100 : 50;
  const edge = longs.length && shorts.length ? avg(longs) - avg(shorts) : 0;
  const whenIn = when.length ? avg(when) : 0;
  const cashR = n ? cash / n : 1;
  return {
    name: "",
    family: "",
    hit,
    edge,
    whenIn,
    cash: cashR,
    dir,
    fair: fairObj(hit, edge, whenIn, cashR),
    longN: longs.length,
    shortN: shorts.length,
  };
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Extra tickers for wacky multi-asset ideas (QQQ if present).
  const tickers = ["SPY", "TLT", "GLD", "USO", "HYG", "VIX", "CPER", "QQQ"] as const;
  const series = await Promise.all(tickers.map((t) => fetchAll(sb, t)));
  const by: Record<string, any[]> = {};
  tickers.forEach((t, i) => {
    by[t] = series[i];
    console.log(`${t}: ${series[i].length} rows`);
  });

  const core = ["SPY", "TLT", "GLD", "USO", "HYG", "VIX", "CPER"] as const;
  const sets = core.map((t) => new Set(by[t].map((r) => r.trade_date)));
  const dates = [...sets[0]].filter((d) => sets.every((s) => s.has(d))).sort();
  const maps: Record<string, Map<string, any>> = {};
  for (const t of tickers) maps[t] = new Map((by[t] ?? []).map((r) => [r.trade_date, r]));

  const closes = dates.map((d) => maps.SPY.get(d).close);
  const rsi = rsiSeries(closes);
  const qqqCloses = dates.map((d) => maps.QQQ.get(d)?.close ?? null);
  const qqqRsi = rsiSeries(
    qqqCloses.map((c, i) => (c != null ? c : closes[i])),
  );

  const minLb = Math.max(RSI, 20);
  const raw: Point[] = [];
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
    const spy5 = maps.SPY.get(dates[i - 5]);
    const spy20 = maps.SPY.get(dates[i - 20]);
    const vix1 = maps.VIX.get(dates[i - 1]);

    raw.push({
      tradeDate: d,
      vector: {
        spyRsi: rsi[i]!,
        vixMomentum: vixP.close > 0 ? -pct(vixP.close, vix.close) : 0,
        hygTltRatio: tlt.close > 0 ? hyg.close / tlt.close : 0,
        cperGldRatio: gld.close > 0 ? cper.close / gld.close : 0,
        usoMomentum: usoP.close > 0 ? pct(usoP.close, uso.close) : 0,
        vixLevel: vix.close,
        // Extra research features (not in prod KNN unless selected)
        spy1d: pct(prev.close, spy.close),
        spy5d: spy5 ? pct(spy5.close, spy.close) : 0,
        spy20d: spy20 ? pct(spy20.close, spy.close) : 0,
        overnight: spy.open > 0 ? pct(prev.close, spy.open) : 0,
        otcSame: spy.open > 0 ? pct(spy.open, spy.close) : 0,
        vix1d: vix1 && vix1.close > 0 ? pct(vix1.close, vix.close) : 0,
        qqqRsi: qqqRsi[i] ?? rsi[i]!,
        qqqSpySpread:
          qqqCloses[i] != null && spy.close > 0 && qqqCloses[i]! > 0
            ? pct(spy.close, qqqCloses[i]!) - 0 // relative level proxy via 1d later
            : 0,
        creditMom:
          tlt.close > 0 && maps.HYG.get(dates[i - 5]) && maps.TLT.get(dates[i - 5])
            ? pct(
                maps.HYG.get(dates[i - 5]).close / maps.TLT.get(dates[i - 5]).close,
                hyg.close / tlt.close,
              )
            : 0,
      },
      spyClose: spy.close,
      spyOpen: spy.open,
      ctc: pct(prev.close, spy.close),
      otc: spy.open > 0 ? pct(spy.open, spy.close) : 0,
      overnight: spy.open > 0 ? pct(prev.close, spy.open) : 0,
      f1Ctc: n1 ? pct(spy.close, n1.close) : null,
      f3Ctc: n3 ? pct(spy.close, n3.close) : null,
      f1Otc: n1 && n1.open > 0 ? pct(n1.open, n1.close) : null,
      f3Otc: n1 && n3 && n1.open > 0 ? pct(n1.open, n3.close) : null,
      nextOtc: n1 && n1.open > 0 ? pct(n1.open, n1.close) : null,
    });
  }

  // Fix qqqSpySpread to 5d relative momentum
  for (let i = 5; i < raw.length; i++) {
    const cur = raw[i];
    const prev = raw[i - 5];
    const qNow = maps.QQQ.get(cur.tradeDate)?.close;
    const qPrev = maps.QQQ.get(prev.tradeDate)?.close;
    if (qNow && qPrev && prev.spyClose > 0) {
      cur.vector.qqqSpySpread = pct(qPrev, qNow) - pct(prev.spyClose, cur.spyClose);
    }
  }

  const st = stationarizeLevelFeatures(raw, STOCKS_LEVEL_FEATURES_FOR_PERCENTILE, {
    window: ANALOG_MODEL_SETTINGS.percentileWindowSessions,
    minHistory: ANALOG_MODEL_SETTINGS.percentileMinHistorySessions,
  }) as Point[];

  const start = st.findIndex((p) => p.tradeDate >= BACKTEST_START);
  console.log(`Points=${st.length} backtest from idx=${start} (${st[start]?.tradeDate})\n`);

  type Neighbor = {
    analog: Point;
    distance: number;
    weight: number;
    f1: number;
    f3: number;
  };

  function getNeighbors(
    ti: number,
    features: FKey[],
    opts: {
      k?: number;
      label?: "ctc" | "otc";
      decay?: number;
      minGap?: number;
      maxAgeYears?: number | null;
      minAgeYears?: number | null;
      poolFilter?: (p: Point, today: Point) => boolean;
      distanceMetric?: "euclidean" | "cosine" | "l1";
    } = {},
  ): Neighbor[] {
    const k = opts.k ?? 5;
    const label = opts.label ?? "ctc";
    const decay = opts.decay ?? ANALOG_MODEL_SETTINGS.temporalDecayLambda;
    const minGap = opts.minGap ?? 5;
    const today = st[ti];
    const pool = st.slice(0, ti);
    if (pool.length < 20) return [];

    const means: Record<string, number> = {};
    const stds: Record<string, number> = {};
    for (const f of features) {
      const vals = pool.map((p) => p.vector[f] ?? 0);
      const m = avg(vals);
      const s = Math.sqrt(avg(vals.map((v) => (v - m) ** 2))) || 1;
      means[f] = m;
      stds[f] = s;
    }
    const tz = features.map((f) => ((today.vector[f] ?? 0) - means[f]) / stds[f]);

    const ranked: Neighbor[] = [];
    for (const analog of pool) {
      const f1 = label === "otc" ? analog.f1Otc : analog.f1Ctc;
      const f3 = label === "otc" ? analog.f3Otc : analog.f3Ctc;
      if (f1 == null) continue;
      const gap = daysBetween(today.tradeDate, analog.tradeDate);
      if (gap < minGap) continue;
      if (opts.maxAgeYears != null && gap > opts.maxAgeYears * 365) continue;
      if (opts.minAgeYears != null && gap < opts.minAgeYears * 365) continue;
      if (opts.poolFilter && !opts.poolFilter(analog, today)) continue;

      const az = features.map((f) => ((analog.vector[f] ?? 0) - means[f]) / stds[f]);
      let rawDist = 0;
      if (opts.distanceMetric === "l1") {
        rawDist = features.reduce((s, _, i) => s + Math.abs(tz[i] - az[i]), 0);
      } else if (opts.distanceMetric === "cosine") {
        let dot = 0,
          nt = 0,
          na = 0;
        for (let i = 0; i < tz.length; i++) {
          dot += tz[i] * az[i];
          nt += tz[i] * tz[i];
          na += az[i] * az[i];
        }
        const cos = nt && na ? dot / (Math.sqrt(nt) * Math.sqrt(na)) : 0;
        rawDist = 1 - cos; // 0 = identical direction
      } else {
        rawDist = Math.sqrt(features.reduce((s, _, i) => s + (tz[i] - az[i]) ** 2, 0));
      }
      const distance = rawDist * Math.exp(decay * gap);
      ranked.push({
        analog,
        distance,
        weight: inverseDistanceWeight(distance, 0.05),
        f1,
        f3: f3 ?? f1,
      });
    }
    ranked.sort((a, b) => a.distance - b.distance);
    return ranked.slice(0, k);
  }

  function knnScore(
    neighbors: Neighbor[],
    opts: {
      w1?: number;
      w3?: number;
      scale?: number;
      mode?:
        | "weighted"
        | "median"
        | "sign_vote"
        | "closest_only"
        | "winsor"
        | "agree_only"
        | "inv_mag";
      agreeMin?: number;
    } = {},
  ): number {
    if (!neighbors.length) return 0;
    const w1 = opts.w1 ?? 0.4;
    const w3 = opts.w3 ?? 0.6;
    const scale = opts.scale ?? 2.75;
    const mode = opts.mode ?? "weighted";
    const blended = neighbors.map((n) => w1 * n.f1 + w3 * n.f3);

    if (mode === "closest_only") {
      return tanhScore(blended[0], scale);
    }
    if (mode === "median") {
      return tanhScore(median(blended), scale);
    }
    if (mode === "sign_vote") {
      const up = blended.filter((b) => b > 0).length;
      const down = blended.filter((b) => b < 0).length;
      if (up === down) return 0;
      const frac = Math.abs(up - down) / blended.length;
      return clampScore((up > down ? 1 : -1) * (30 + 70 * frac));
    }
    if (mode === "winsor") {
      const lo = -2,
        hi = 2;
      const clipped = neighbors.map((n) => ({
        ...n,
        f1: Math.max(lo, Math.min(hi, n.f1)),
        f3: Math.max(lo, Math.min(hi, n.f3)),
      }));
      const weights = clipped.map((n) => n.weight);
      const a1 = weightedMean(
        clipped.map((n) => n.f1),
        weights,
      );
      const a3 = weightedMean(
        clipped.map((n) => n.f3),
        weights,
      );
      return tanhScore(w1 * a1 + w3 * a3, scale);
    }
    if (mode === "agree_only") {
      const weights = neighbors.map((n) => n.weight);
      const a1 = weightedMean(
        neighbors.map((n) => n.f1),
        weights,
      );
      const a3 = weightedMean(
        neighbors.map((n) => n.f3),
        weights,
      );
      const b = w1 * a1 + w3 * a3;
      const score = tanhScore(b, scale);
      const sign = score > 0 ? 1 : score < 0 ? -1 : 0;
      const agr =
        sign === 0
          ? 1
          : blended.filter((x) => x * sign > 0).length / blended.length;
      if (agr < (opts.agreeMin ?? 0.6)) return 0;
      return score;
    }
    if (mode === "inv_mag") {
      // Weight neighbors by inverse |return| — trust quiet analogs more
      const w = neighbors.map((n) => 1 / (0.2 + Math.abs(w1 * n.f1 + w3 * n.f3)));
      const a1 = weightedMean(
        neighbors.map((n) => n.f1),
        w,
      );
      const a3 = weightedMean(
        neighbors.map((n) => n.f3),
        w,
      );
      return tanhScore(w1 * a1 + w3 * a3, scale);
    }
    // default weighted
    const weights = neighbors.map((n) => n.weight);
    const a1 = weightedMean(
      neighbors.map((n) => n.f1),
      weights,
    );
    const a3 = weightedMean(
      neighbors.map((n) => n.f3),
      weights,
    );
    return tanhScore(w1 * a1 + w3 * a3, scale);
  }

  const prodFeatures = [...STOCKS_KNN_FEATURE_KEYS] as FKey[];
  const results: IdeaResult[] = [];

  function runIdea(
    name: string,
    family: string,
    scoreFn: (ti: number) => number,
    thr = THR,
  ) {
    const scores: number[] = [];
    const nextOtcs: (number | null)[] = [];
    for (let ti = start; ti < st.length; ti++) {
      scores.push(scoreFn(ti));
      nextOtcs.push(st[ti].nextOtc);
    }
    const r = evalScores(scores, nextOtcs, thr);
    r.name = name;
    r.family = family;
    results.push(r);
    const mark =
      r.fair > 0.1 ? " ★" : r.fair > 0.05 ? " +" : r.fair < -0.1 ? " ✗" : "";
    console.log(
      `${name.padEnd(42)} hit=${r.hit.toFixed(1).padStart(5)}% edge=${(r.edge >= 0 ? "+" : "") + r.edge.toFixed(3)} whenIn=${(r.whenIn >= 0 ? "+" : "") + r.whenIn.toFixed(3)} cash=${(r.cash * 100).toFixed(0).padStart(2)}% dir=${String(r.dir).padStart(4)} fair=${r.fair.toFixed(4)}${mark}`,
    );
  }

  console.log("=== CONTROLS ===");
  runIdea("always_long", "control", () => 50);
  runIdea("always_short", "control", () => -50);
  runIdea("always_flat", "control", () => 0);
  runIdea("random_sign", "control", (ti) => {
    // deterministic pseudo-random from date hash
    const d = st[ti].tradeDate;
    let h = 0;
    for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) | 0;
    return h % 2 === 0 ? 40 : -40;
  });
  runIdea("mirror_prod_knn", "control", (ti) => {
    const n = getNeighbors(ti, prodFeatures);
    return -knnScore(n);
  });

  console.log("\n=== PRODUCTION BASELINE ===");
  runIdea("PROD v8 knn 0.4/0.6 K5 CTC", "prod", (ti) => {
    const n = getNeighbors(ti, prodFeatures);
    return knnScore(n);
  });

  console.log("\n=== NEIGHBOR AGGREGATION HACKS ===");
  runIdea("sign_vote_only", "agg", (ti) => knnScore(getNeighbors(ti, prodFeatures), { mode: "sign_vote" }));
  runIdea("median_neighbor", "agg", (ti) => knnScore(getNeighbors(ti, prodFeatures), { mode: "median" }));
  runIdea("closest_only_K1", "agg", (ti) => knnScore(getNeighbors(ti, prodFeatures, { k: 1 }), { mode: "closest_only" }));
  runIdea("winsor_returns_pm2", "agg", (ti) => knnScore(getNeighbors(ti, prodFeatures), { mode: "winsor" }));
  runIdea("agree_gate_0.6", "agg", (ti) => knnScore(getNeighbors(ti, prodFeatures), { mode: "agree_only", agreeMin: 0.6 }));
  runIdea("agree_gate_0.8", "agg", (ti) => knnScore(getNeighbors(ti, prodFeatures), { mode: "agree_only", agreeMin: 0.8 }));
  runIdea("inverse_magnitude_weights", "agg", (ti) => knnScore(getNeighbors(ti, prodFeatures), { mode: "inv_mag" }));
  runIdea("K3", "agg", (ti) => knnScore(getNeighbors(ti, prodFeatures, { k: 3 })));
  runIdea("K7", "agg", (ti) => knnScore(getNeighbors(ti, prodFeatures, { k: 7 })));
  runIdea("K11", "agg", (ti) => knnScore(getNeighbors(ti, prodFeatures, { k: 11 })));
  runIdea("blend_1d_only", "agg", (ti) => knnScore(getNeighbors(ti, prodFeatures), { w1: 1, w3: 0 }));
  runIdea("blend_3d_only", "agg", (ti) => knnScore(getNeighbors(ti, prodFeatures), { w1: 0, w3: 1 }));
  runIdea("scale_1.5_sharper", "agg", (ti) => knnScore(getNeighbors(ti, prodFeatures), { scale: 1.5 }));
  runIdea("scale_5_softer", "agg", (ti) => knnScore(getNeighbors(ti, prodFeatures), { scale: 5 }));

  console.log("\n=== DISTANCE / POOL WEIRDNESS ===");
  runIdea("cosine_distance", "dist", (ti) =>
    knnScore(getNeighbors(ti, prodFeatures, { distanceMetric: "cosine" })),
  );
  runIdea("L1_manhattan", "dist", (ti) =>
    knnScore(getNeighbors(ti, prodFeatures, { distanceMetric: "l1" })),
  );
  runIdea("no_temporal_decay", "dist", (ti) =>
    knnScore(getNeighbors(ti, prodFeatures, { decay: 0 })),
  );
  runIdea("heavy_temporal_decay", "dist", (ti) =>
    knnScore(getNeighbors(ti, prodFeatures, { decay: 0.002 })),
  );
  runIdea("only_analogs_3y_plus_old", "dist", (ti) =>
    knnScore(getNeighbors(ti, prodFeatures, { minAgeYears: 3 })),
  );
  runIdea("only_analogs_within_3y", "dist", (ti) =>
    knnScore(getNeighbors(ti, prodFeatures, { maxAgeYears: 3 })),
  );
  runIdea("same_dow_neighbors_only", "dist", (ti) =>
    knnScore(
      getNeighbors(ti, prodFeatures, {
        k: 8,
        poolFilter: (p, today) => dow(p.tradeDate) === dow(today.tradeDate),
      }),
    ),
  );
  runIdea("same_vix_regime_neighbors", "dist", (ti) =>
    knnScore(
      getNeighbors(ti, prodFeatures, {
        k: 7,
        poolFilter: (p, today) => {
          const hi = today.vector.vixLevel >= 20;
          return hi ? p.vector.vixLevel >= 20 : p.vector.vixLevel < 20;
        },
      }),
    ),
  );
  runIdea("opposite_vix_regime", "dist", (ti) =>
    knnScore(
      getNeighbors(ti, prodFeatures, {
        k: 7,
        poolFilter: (p, today) => {
          const hi = today.vector.vixLevel >= 20;
          return hi ? p.vector.vixLevel < 20 : p.vector.vixLevel >= 20;
        },
      }),
    ),
  );

  console.log("\n=== FEATURE MADNESS ===");
  runIdea("rsi_mean_reversion_only", "feat", (ti) => {
    const r = st[ti].vector.spyRsi;
    if (r > 70) return -50;
    if (r < 30) return 50;
    return 0;
  });
  runIdea("rsi_momentum_only", "feat", (ti) => {
    const r = st[ti].vector.spyRsi;
    if (r > 55) return 40;
    if (r < 45) return -40;
    return 0;
  });
  runIdea("credit_mom_only", "feat", (ti) => {
    const c = st[ti].vector.creditMom;
    return tanhScore(c / 2);
  });
  runIdea("vix_crush_only", "feat", (ti) => {
    // falling VIX → risk on
    return tanhScore(st[ti].vector.vixMomentum / 5);
  });
  runIdea("overnight_fade", "feat", (ti) => {
    // fade today's overnight gap into next session
    return tanhScore(-st[ti].overnight * 2);
  });
  runIdea("overnight_follow", "feat", (ti) => {
    return tanhScore(st[ti].overnight * 2);
  });
  runIdea("5d_mean_reversion", "feat", (ti) => {
    return tanhScore(-st[ti].vector.spy5d / 3);
  });
  runIdea("5d_momentum", "feat", (ti) => {
    return tanhScore(st[ti].vector.spy5d / 3);
  });
  runIdea("knn_plus_mean_reversion", "feat", (ti) => {
    const knn = knnScore(getNeighbors(ti, prodFeatures));
    const mr = tanhScore(-st[ti].vector.spy5d / 3);
    return clampScore(0.7 * knn + 0.3 * mr);
  });
  runIdea("knn_plus_momentum", "feat", (ti) => {
    const knn = knnScore(getNeighbors(ti, prodFeatures));
    const mom = tanhScore(st[ti].vector.spy5d / 3);
    return clampScore(0.7 * knn + 0.3 * mom);
  });
  runIdea("knn_plus_overnight_fade", "feat", (ti) => {
    const knn = knnScore(getNeighbors(ti, prodFeatures));
    const fade = tanhScore(-st[ti].overnight * 2);
    return clampScore(0.7 * knn + 0.3 * fade);
  });
  runIdea("knn_features_plus_spy5d", "feat", (ti) => {
    const feats = [...prodFeatures, "spy5d"];
    return knnScore(getNeighbors(ti, feats));
  });
  runIdea("knn_features_plus_overnight", "feat", (ti) => {
    const feats = [...prodFeatures, "overnight"];
    return knnScore(getNeighbors(ti, feats));
  });
  runIdea("knn_features_plus_creditMom", "feat", (ti) => {
    const feats = [...prodFeatures, "creditMom"];
    return knnScore(getNeighbors(ti, feats));
  });
  runIdea("knn_features_plus_qqqRsi", "feat", (ti) => {
    const feats = [...prodFeatures, "qqqRsi"];
    return knnScore(getNeighbors(ti, feats));
  });
  runIdea("knn_features_plus_qqqSpySpread", "feat", (ti) => {
    const feats = [...prodFeatures, "qqqSpySpread"];
    return knnScore(getNeighbors(ti, feats));
  });
  runIdea("minimal_rsi_vixMom_hyg", "feat", (ti) => {
    return knnScore(getNeighbors(ti, ["spyRsi", "vixMomentum", "hygTltRatio"]));
  });
  runIdea("credit_vol_only_3feat", "feat", (ti) => {
    return knnScore(getNeighbors(ti, ["hygTltRatio", "vixMomentum", "vixLevel"]));
  });

  console.log("\n=== CALENDAR / SKIP RULES ===");
  runIdea("prod_skip_mondays", "cal", (ti) => {
    if (dow(st[ti].tradeDate) === 1) return 0; // Monday score → Tuesday session? score on Mon for Tue
    // Actually lag: score on day D applies to D+1 session. Skip if D is Friday (weekend gap)?
    return knnScore(getNeighbors(ti, prodFeatures));
  });
  runIdea("prod_skip_friday_scores", "cal", (ti) => {
    // Friday score is for Monday open→close — often noisy
    if (dow(st[ti].tradeDate) === 5) return 0;
    return knnScore(getNeighbors(ti, prodFeatures));
  });
  runIdea("prod_skip_monday_scores", "cal", (ti) => {
    if (dow(st[ti].tradeDate) === 1) return 0;
    return knnScore(getNeighbors(ti, prodFeatures));
  });
  runIdea("prod_only_tue_wed_thu", "cal", (ti) => {
    const d = dow(st[ti].tradeDate);
    if (d === 1 || d === 5) return 0;
    return knnScore(getNeighbors(ti, prodFeatures));
  });
  runIdea("higher_threshold_30", "cal", (ti) => knnScore(getNeighbors(ti, prodFeatures)), 30);
  runIdea("higher_threshold_40", "cal", (ti) => knnScore(getNeighbors(ti, prodFeatures)), 40);
  runIdea("lower_threshold_10", "cal", (ti) => knnScore(getNeighbors(ti, prodFeatures)), 10);

  console.log("\n=== ENSEMBLES / CONTRARIAN ===");
  runIdea("ensemble_knn_median_sign", "ens", (ti) => {
    const n = getNeighbors(ti, prodFeatures);
    const a = knnScore(n);
    const b = knnScore(n, { mode: "median" });
    const c = knnScore(n, { mode: "sign_vote" });
    // only directional if all agree on sign
    if (a > THR && b > 0 && c > 0) return clampScore((a + b + c) / 3);
    if (a < -THR && b < 0 && c < 0) return clampScore((a + b + c) / 3);
    return 0;
  });
  runIdea("ensemble_require_2of3", "ens", (ti) => {
    const n = getNeighbors(ti, prodFeatures);
    const a = knnScore(n);
    const b = knnScore(n, { mode: "median" });
    const c = knnScore(getNeighbors(ti, prodFeatures, { k: 3 }));
    const votes = [a, b, c].map((s) => (s > THR ? 1 : s < -THR ? -1 : 0));
    const sum = votes.reduce((x, y) => x + y, 0);
    if (sum >= 2) return clampScore(avg([a, b, c].filter((s) => s > 0)));
    if (sum <= -2) return clampScore(avg([a, b, c].filter((s) => s < 0)));
    return 0;
  });
  runIdea("knn_flat_if_high_neighbor_vol", "ens", (ti) => {
    const n = getNeighbors(ti, prodFeatures);
    const b = n.map((x) => 0.4 * x.f1 + 0.6 * x.f3);
    if (stdev(b) > 1.2) return 0;
    return knnScore(n);
  });
  runIdea("knn_flat_if_low_neighbor_vol", "ens", (ti) => {
    // only trade when analogs are noisy (contrarian to consensus tightness)
    const n = getNeighbors(ti, prodFeatures);
    const b = n.map((x) => 0.4 * x.f1 + 0.6 * x.f3);
    if (stdev(b) < 0.4) return 0;
    return knnScore(n);
  });
  runIdea("dual_label_ctc_otc_agree", "ens", (ti) => {
    const ctc = knnScore(getNeighbors(ti, prodFeatures, { label: "ctc" }));
    const otc = knnScore(getNeighbors(ti, prodFeatures, { label: "otc" }));
    if (ctc > THR && otc > 0) return clampScore((ctc + otc) / 2);
    if (ctc < -THR && otc < 0) return clampScore((ctc + otc) / 2);
    return 0;
  });
  runIdea("shrink_score_by_dispersion", "ens", (ti) => {
    const n = getNeighbors(ti, prodFeatures);
    const score = knnScore(n);
    const b = n.map((x) => 0.4 * x.f1 + 0.6 * x.f3);
    const disp = stdev(b);
    const shrink = 1 / (1 + disp); // high dispersion → smaller score
    return clampScore(score * shrink);
  });

  console.log("\n=== WACKY COMBOS ===");
  runIdea("sign_vote_K7_agree0.7", "wacky", (ti) => {
    const n = getNeighbors(ti, prodFeatures, { k: 7 });
    return knnScore(n, { mode: "agree_only", agreeMin: 0.7 });
  });
  runIdea("median_K7_same_vix_regime", "wacky", (ti) => {
    const n = getNeighbors(ti, prodFeatures, {
      k: 7,
      poolFilter: (p, today) => {
        const hi = today.vector.vixLevel >= 20;
        return hi ? p.vector.vixLevel >= 20 : p.vector.vixLevel < 20;
      },
    });
    return knnScore(n, { mode: "median" });
  });
  runIdea("old_analogs_sign_vote", "wacky", (ti) => {
    const n = getNeighbors(ti, prodFeatures, { k: 7, minAgeYears: 2 });
    return knnScore(n, { mode: "sign_vote" });
  });
  runIdea("knn_fade_after_big_day", "wacky", (ti) => {
    const knn = knnScore(getNeighbors(ti, prodFeatures));
    const big = Math.abs(st[ti].ctc) > 1.5;
    if (big) return clampScore(knn * 0.3 - Math.sign(st[ti].ctc) * 20);
    return knn;
  });
  runIdea("prod_but_invert_when_rsi_extreme", "wacky", (ti) => {
    const knn = knnScore(getNeighbors(ti, prodFeatures));
    const r = st[ti].vector.spyRsi;
    if (r > 75 && knn > 0) return -Math.abs(knn) * 0.5;
    if (r < 25 && knn < 0) return Math.abs(knn) * 0.5;
    return knn;
  });

  // Rank and report
  results.sort((a, b) => b.fair - a.fair);
  console.log("\n\n########## TOP 15 BY FAIR OBJECTIVE (next-session OTC) ##########");
  for (const r of results.slice(0, 15)) {
    console.log(
      `${r.fair.toFixed(4)}  hit=${r.hit.toFixed(1)}% edge=${r.edge >= 0 ? "+" : ""}${r.edge.toFixed(3)} cash=${(r.cash * 100).toFixed(0)}% dir=${r.dir}  [${r.family}] ${r.name}`,
    );
  }
  console.log("\n########## BOTTOM 8 ##########");
  for (const r of results.slice(-8)) {
    console.log(
      `${r.fair.toFixed(4)}  hit=${r.hit.toFixed(1)}% edge=${r.edge >= 0 ? "+" : ""}${r.edge.toFixed(3)} cash=${(r.cash * 100).toFixed(0)}%  [${r.family}] ${r.name}`,
    );
  }

  const prod = results.find((r) => r.name.startsWith("PROD"));
  const better = results.filter(
    (r) =>
      prod &&
      r.name !== prod.name &&
      r.fair > prod.fair + 0.02 &&
      r.dir >= 100 &&
      r.cash < 0.85,
  );
  console.log("\n########## BEATS PROD (fair+0.02, dir≥100, cash<85%) ##########");
  if (!better.length) console.log("(none)");
  for (const r of better) {
    console.log(
      `${r.name}: fair ${prod!.fair.toFixed(4)} → ${r.fair.toFixed(4)} | hit ${prod!.hit.toFixed(1)}→${r.hit.toFixed(1)} | edge ${prod!.edge.toFixed(3)}→${r.edge.toFixed(3)} | cash ${(prod!.cash * 100).toFixed(0)}→${(r.cash * 100).toFixed(0)}%`,
    );
  }

  // Write JSON summary
  const fs = await import("fs");
  fs.writeFileSync(
    "scripts/.wacky-score-results.json",
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        horizon: "next_session_open_to_close",
        prod,
        top15: results.slice(0, 15),
        beatsProd: better,
        all: results,
      },
      null,
      2,
    ),
  );
  console.log("\nWrote scripts/.wacky-score-results.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
