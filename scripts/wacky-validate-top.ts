/**
 * Validate top wacky ideas: year-by-year stability + simple combos.
 * Product metric: next-session open→close.
 * Run: npx tsx scripts/wacky-validate-top.ts
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

function pct(a: number, b: number) {
  return ((b - a) / a) * 100;
}
function avg(xs: number[]) {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
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
  return new Date(d + "T12:00:00Z").getUTCDay();
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
  overnight: number;
  ctc: number;
  f1Ctc: number | null;
  f3Ctc: number | null;
  nextOtc: number | null;
};

type DayScore = { date: string; score: number; nextOtc: number | null };

function summarize(days: DayScore[], thr = THR) {
  let dir = 0,
    hits = 0,
    cash = 0;
  const longs: number[] = [];
  const shorts: number[] = [];
  const when: number[] = [];
  for (const d of days) {
    if (d.nextOtc == null) continue;
    if (Math.abs(d.score) <= thr) {
      cash++;
      continue;
    }
    dir++;
    const long = d.score > 0;
    const ok = long ? d.nextOtc >= 0 : d.nextOtc <= 0;
    if (ok) hits++;
    if (long) {
      longs.push(d.nextOtc);
      when.push(d.nextOtc);
    } else {
      shorts.push(d.nextOtc);
      when.push(-d.nextOtc);
    }
  }
  const n = dir + cash;
  const hit = dir ? (hits / dir) * 100 : 50;
  const edge = longs.length && shorts.length ? avg(longs) - avg(shorts) : 0;
  const whenIn = when.length ? avg(when) : 0;
  const cashR = n ? cash / n : 1;
  return {
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

function byYear(days: DayScore[]) {
  const years = new Map<string, DayScore[]>();
  for (const d of days) {
    if (d.nextOtc == null) continue;
    const y = d.date.slice(0, 4);
    if (!years.has(y)) years.set(y, []);
    years.get(y)!.push(d);
  }
  const out: Record<string, ReturnType<typeof summarize>> = {};
  for (const [y, ds] of [...years.entries()].sort()) {
    out[y] = summarize(ds);
  }
  return out;
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
    raw.push({
      tradeDate: d,
      vector: {
        spyRsi: rsi[i]!,
        vixMomentum: vixP.close > 0 ? -pct(vixP.close, vix.close) : 0,
        hygTltRatio: tlt.close > 0 ? hyg.close / tlt.close : 0,
        cperGldRatio: gld.close > 0 ? cper.close / gld.close : 0,
        usoMomentum: usoP.close > 0 ? pct(usoP.close, uso.close) : 0,
        vixLevel: vix.close,
        spy5d: spy5 ? pct(spy5.close, spy.close) : 0,
      },
      overnight: spy.open > 0 ? pct(prev.close, spy.open) : 0,
      ctc: pct(prev.close, spy.close),
      f1Ctc: n1 ? pct(spy.close, n1.close) : null,
      f3Ctc: n3 ? pct(spy.close, n3.close) : null,
      nextOtc: n1 && n1.open > 0 ? pct(n1.open, n1.close) : null,
    });
  }
  const st = stationarizeLevelFeatures(raw, STOCKS_LEVEL_FEATURES_FOR_PERCENTILE, {
    window: ANALOG_MODEL_SETTINGS.percentileWindowSessions,
    minHistory: ANALOG_MODEL_SETTINGS.percentileMinHistorySessions,
  }) as Point[];
  const start = st.findIndex((p) => p.tradeDate >= BACKTEST_START);
  const prodF = [...STOCKS_KNN_FEATURE_KEYS];
  const min3 = ["spyRsi", "vixMomentum", "hygTltRatio"];

  type Nb = { distance: number; weight: number; f1: number; f3: number; raw: number };

  function neighbors(
    ti: number,
    features: string[],
    opts: {
      metric?: "euclidean" | "cosine";
      decay?: number;
      k?: number;
      poolFilter?: (p: Point, today: Point) => boolean;
    } = {},
  ): Nb[] {
    const k = opts.k ?? 5;
    const decay = opts.decay ?? ANALOG_MODEL_SETTINGS.temporalDecayLambda;
    const today = st[ti];
    const pool = st.slice(0, ti);
    const means: Record<string, number> = {};
    const stds: Record<string, number> = {};
    for (const f of features) {
      const vals = pool.map((p) => p.vector[f] ?? 0);
      const m = avg(vals);
      means[f] = m;
      stds[f] = Math.sqrt(avg(vals.map((v) => (v - m) ** 2))) || 1;
    }
    const tz = features.map((f) => ((today.vector[f] ?? 0) - means[f]) / stds[f]);
    const out: Nb[] = [];
    for (const analog of pool) {
      if (analog.f1Ctc == null) continue;
      const gap = daysBetween(today.tradeDate, analog.tradeDate);
      if (gap < 5) continue;
      if (opts.poolFilter && !opts.poolFilter(analog, today)) continue;
      const az = features.map((f) => ((analog.vector[f] ?? 0) - means[f]) / stds[f]);
      let rawDist = 0;
      if (opts.metric === "cosine") {
        let dot = 0,
          nt = 0,
          na = 0;
        for (let i = 0; i < tz.length; i++) {
          dot += tz[i] * az[i];
          nt += tz[i] * tz[i];
          na += az[i] * az[i];
        }
        const cos = nt && na ? dot / (Math.sqrt(nt) * Math.sqrt(na)) : 0;
        rawDist = 1 - cos;
      } else {
        rawDist = Math.sqrt(features.reduce((s, _, i) => s + (tz[i] - az[i]) ** 2, 0));
      }
      const distance = rawDist * Math.exp(decay * gap);
      const f1 = analog.f1Ctc;
      const f3 = analog.f3Ctc ?? f1;
      out.push({
        distance,
        weight: inverseDistanceWeight(distance, 0.05),
        f1,
        f3,
        raw: 0.4 * f1 + 0.6 * f3,
      });
    }
    out.sort((a, b) => a.distance - b.distance);
    return out.slice(0, k);
  }

  function knn(nbs: Nb[], scale = 2.75) {
    if (!nbs.length) return 0;
    const w = nbs.map((n) => n.weight);
    const a1 = weightedMean(
      nbs.map((n) => n.f1),
      w,
    );
    const a3 = weightedMean(
      nbs.map((n) => n.f3),
      w,
    );
    return tanhScore(0.4 * a1 + 0.6 * a3, scale);
  }

  type Idea = { name: string; fn: (ti: number) => number };
  const ideas: Idea[] = [
    {
      name: "PROD euclidean",
      fn: (ti) => knn(neighbors(ti, prodF)),
    },
    {
      name: "cosine_distance",
      fn: (ti) => knn(neighbors(ti, prodF, { metric: "cosine" })),
    },
    {
      name: "cosine + no_decay",
      fn: (ti) => knn(neighbors(ti, prodF, { metric: "cosine", decay: 0 })),
    },
    {
      name: "cosine + skip Mon scores",
      fn: (ti) => {
        if (dow(st[ti].tradeDate) === 1) return 0;
        return knn(neighbors(ti, prodF, { metric: "cosine" }));
      },
    },
    {
      name: "minimal3 euclidean",
      fn: (ti) => knn(neighbors(ti, min3)),
    },
    {
      name: "minimal3 cosine",
      fn: (ti) => knn(neighbors(ti, min3, { metric: "cosine" })),
    },
    {
      name: "overnight_follow",
      fn: (ti) => tanhScore(st[ti].overnight * 2),
    },
    {
      name: "5d_mean_reversion",
      fn: (ti) => tanhScore(-st[ti].vector.spy5d / 3),
    },
    {
      name: "cosine + overnight 70/30",
      fn: (ti) => {
        const k = knn(neighbors(ti, prodF, { metric: "cosine" }));
        const o = tanhScore(st[ti].overnight * 2);
        return clampScore(0.7 * k + 0.3 * o);
      },
    },
    {
      name: "cosine + 5dMR 70/30",
      fn: (ti) => {
        const k = knn(neighbors(ti, prodF, { metric: "cosine" }));
        const m = tanhScore(-st[ti].vector.spy5d / 3);
        return clampScore(0.7 * k + 0.3 * m);
      },
    },
    {
      name: "cosine + overnight agree",
      fn: (ti) => {
        const k = knn(neighbors(ti, prodF, { metric: "cosine" }));
        const o = tanhScore(st[ti].overnight * 2);
        if (k > THR && o > 0) return clampScore((k + o) / 2);
        if (k < -THR && o < 0) return clampScore((k + o) / 2);
        return 0;
      },
    },
    {
      name: "opposite_vix_regime",
      fn: (ti) =>
        knn(
          neighbors(ti, prodF, {
            k: 7,
            poolFilter: (p, today) => {
              const hi = today.vector.vixLevel >= 20;
              return hi ? p.vector.vixLevel < 20 : p.vector.vixLevel >= 20;
            },
          }),
        ),
    },
    {
      name: "no_temporal_decay",
      fn: (ti) => knn(neighbors(ti, prodF, { decay: 0 })),
    },
    {
      name: "flat_if_low_neighbor_vol",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        const s = stdev(n.map((x) => x.raw));
        if (s < 0.4) return 0;
        return knn(n);
      },
    },
    {
      name: "cosine + skip Mon + overnight agree",
      fn: (ti) => {
        if (dow(st[ti].tradeDate) === 1) return 0;
        const k = knn(neighbors(ti, prodF, { metric: "cosine" }));
        const o = tanhScore(st[ti].overnight * 2);
        if (k > THR && o > 0) return clampScore((k + o) / 2);
        if (k < -THR && o < 0) return clampScore((k + o) / 2);
        return 0;
      },
    },
    {
      name: "PROD skip Mon",
      fn: (ti) => {
        if (dow(st[ti].tradeDate) === 1) return 0;
        return knn(neighbors(ti, prodF));
      },
    },
  ];

  console.log("Scoring all ideas...");
  const scored: Record<string, DayScore[]> = {};
  for (const idea of ideas) {
    const days: DayScore[] = [];
    for (let ti = start; ti < st.length; ti++) {
      days.push({
        date: st[ti].tradeDate,
        score: idea.fn(ti),
        nextOtc: st[ti].nextOtc,
      });
    }
    scored[idea.name] = days;
  }

  console.log("\n=== FULL SAMPLE (next-session OTC) ===");
  const rows = ideas.map((idea) => {
    const s = summarize(scored[idea.name]);
    return { name: idea.name, ...s };
  });
  rows.sort((a, b) => b.fair - a.fair);
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(36)} hit=${r.hit.toFixed(1)}% edge=${(r.edge >= 0 ? "+" : "") + r.edge.toFixed(3)} whenIn=${(r.whenIn >= 0 ? "+" : "") + r.whenIn.toFixed(3)} cash=${(r.cash * 100).toFixed(0)}% dir=${r.dir} L/S=${r.longN}/${r.shortN} fair=${r.fair.toFixed(4)}`,
    );
  }

  console.log("\n=== YEAR-BY-YEAR HIT% (directional only) ===");
  const focus = [
    "PROD euclidean",
    "cosine_distance",
    "cosine + skip Mon scores",
    "minimal3 cosine",
    "overnight_follow",
    "cosine + overnight 70/30",
    "cosine + overnight agree",
    "no_temporal_decay",
  ];
  for (const name of focus) {
    const y = byYear(scored[name]);
    const parts = Object.entries(y)
      .map(
        ([yr, s]) =>
          `${yr}:${s.hit.toFixed(0)}%/${s.dir} e=${s.edge >= 0 ? "+" : ""}${s.edge.toFixed(2)}`,
      )
      .join("  ");
    console.log(`\n${name}`);
    console.log("  " + parts);
    const hits = Object.values(y).map((s) => s.hit);
    const edges = Object.values(y).map((s) => s.edge);
    console.log(
      `  years_hit>50: ${hits.filter((h) => h > 50).length}/${hits.length}  mean_edge=${avg(edges).toFixed(3)}  edge_positive_years=${edges.filter((e) => e > 0).length}/${edges.length}`,
    );
  }

  // Consistency score: prefer positive edge in ≥4/6 years and overall fair>prod
  console.log("\n=== STABILITY RANK (edge>0 in most years, dir≥80/yr avg) ===");
  const stab = focus.map((name) => {
    const y = byYear(scored[name]);
    const vals = Object.values(y);
    const edgePos = vals.filter((s) => s.edge > 0).length;
    const hitPos = vals.filter((s) => s.hit > 50).length;
    const overall = summarize(scored[name]);
    return {
      name,
      edgePos,
      hitPos,
      years: vals.length,
      overall,
      stabScore: edgePos + hitPos * 0.5 + overall.fair * 2,
    };
  });
  stab.sort((a, b) => b.stabScore - a.stabScore);
  for (const s of stab) {
    console.log(
      `${s.name.padEnd(36)} edge+yrs=${s.edgePos}/${s.years} hit+yrs=${s.hitPos}/${s.years} fair=${s.overall.fair.toFixed(4)} hit=${s.overall.hit.toFixed(1)}% edge=${s.overall.edge.toFixed(3)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
