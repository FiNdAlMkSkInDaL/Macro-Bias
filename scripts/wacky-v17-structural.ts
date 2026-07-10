/**
 * Structural experiments on locked v17:
 * size scaling, dual models, regime-split K, ensembles.
 * Product: next-session open→close thr=22.
 * Run: npx tsx scripts/wacky-v17-structural.ts
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";
import {
  ANALOG_MODEL_SETTINGS,
  STOCKS_KNN_FEATURE_KEYS,
  STOCKS_LEVEL_FEATURES_FOR_PERCENTILE,
  STRATEGY_RULES,
} from "../src/lib/macro-bias/constants";
import {
  applyFadeBigDay,
  applyOvernightVeto,
  applySoftOvernightAmp,
} from "../src/lib/macro-bias/calculate-daily-bias";
import {
  inverseDistanceWeight,
  stationarizeLevelFeatures,
  weightedMean,
} from "../src/lib/signal";
import { isUsEquityMonday } from "../src/utils/knn";

const THR = STRATEGY_RULES.scoreThreshold;
const RSI = 14;
const START = "2020-01-01";
const W1 = ANALOG_MODEL_SETTINGS.oneDayBlendWeight;
const W3 = ANALOG_MODEL_SETTINGS.threeDayBlendWeight;
const LOWVOL = ANALOG_MODEL_SETTINGS.flatLowNeighborVolThreshold;

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
/** Product objective without 85% cash cliff. */
function prodObj(hit: number, edge: number, whenIn: number, cash: number) {
  const pen = cash > 0.7 ? (cash - 0.7) * 0.5 : 0;
  return edge * 2 + ((hit - 50) / 100) * 1.5 + whenIn * 3 - pen;
}
function clampScore(x: number) {
  return Math.max(-100, Math.min(100, Math.round(x)));
}
function tanhScore(b: number, scale = 2.75) {
  return clampScore(Math.tanh(b / scale) * 100);
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
  f1: number | null;
  f3: number | null;
  nextOtc: number | null;
};

type Day = { date: string; score: number; nextOtc: number | null; size?: number };

function summarize(days: Day[], thr = THR, useSize = false) {
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
    const sz = useSize ? (d.size ?? 1) : 1;
    const ret = d.nextOtc * sz;
    const ok = long ? d.nextOtc >= 0 : d.nextOtc <= 0;
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
    hit,
    edge,
    whenIn,
    cash: cashR,
    dir,
    prod: prodObj(hit, edge, whenIn, cashR),
  };
}

function yearStab(days: Day[], thr = THR) {
  const by = new Map<string, Day[]>();
  for (const d of days) {
    if (d.nextOtc == null) continue;
    const y = d.date.slice(0, 4);
    if (!by.has(y)) by.set(y, []);
    by.get(y)!.push(d);
  }
  let edgePos = 0,
    hitPos = 0;
  const detail: string[] = [];
  for (const [y, ds] of [...by.entries()].sort()) {
    const s = summarize(ds, thr);
    if (s.edge > 0) edgePos++;
    if (s.hit > 50) hitPos++;
    detail.push(
      `${y}:${s.hit.toFixed(0)}%/e=${s.edge >= 0 ? "+" : ""}${s.edge.toFixed(2)}/n=${s.dir}`,
    );
  }
  return { years: by.size, edgePos, hitPos, detail };
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const tickers = ["SPY", "TLT", "GLD", "USO", "HYG", "VIX", "CPER", "QQQ"] as const;
  const series = await Promise.all(tickers.map((t) => fetchAll(sb, t)));
  const by: Record<string, any[]> = {};
  tickers.forEach((t, i) => (by[t] = series[i]));
  const core = ["SPY", "TLT", "GLD", "USO", "HYG", "VIX", "CPER"] as const;
  const sets = core.map((t) => new Set(by[t].map((r) => r.trade_date)));
  const dates = [...sets[0]].filter((d) => sets.every((s) => s.has(d))).sort();
  const maps: Record<string, Map<string, any>> = {};
  for (const t of tickers) maps[t] = new Map((by[t] ?? []).map((r) => [r.trade_date, r]));

  const closes = dates.map((d) => maps.SPY.get(d).close);
  const rsi = rsiSeries(closes);
  const minLb = Math.max(RSI, 5);
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
    const qqq = maps.QQQ.get(d);
    const qqq5 = maps.QQQ.get(dates[i - 5]);
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
        qqq5d: qqq && qqq5 ? pct(qqq5.close, qqq.close) : 0,
      },
      overnight: spy.open > 0 ? pct(prev.close, spy.open) : 0,
      ctc: pct(prev.close, spy.close),
      f1: n1 ? pct(spy.close, n1.close) : null,
      f3: n3 ? pct(spy.close, n3.close) : null,
      nextOtc: n1 && n1.open > 0 ? pct(n1.open, n1.close) : null,
    });
  }

  const st = stationarizeLevelFeatures(raw, STOCKS_LEVEL_FEATURES_FOR_PERCENTILE, {
    window: ANALOG_MODEL_SETTINGS.percentileWindowSessions,
    minHistory: ANALOG_MODEL_SETTINGS.percentileMinHistorySessions,
  }) as Point[];
  const start = st.findIndex((p) => p.tradeDate >= START);
  const prodF = [...STOCKS_KNN_FEATURE_KEYS];

  type Nb = { distance: number; weight: number; f1: number; f3: number; raw: number };

  function neighbors(
    ti: number,
    opts: {
      features?: string[];
      k?: number;
      decay?: number;
      poolFilter?: (p: Point, today: Point) => boolean;
      w1?: number;
      w3?: number;
    } = {},
  ): Nb[] {
    const features = opts.features ?? prodF;
    const k = opts.k ?? 5;
    const decay = opts.decay ?? ANALOG_MODEL_SETTINGS.temporalDecayLambda;
    const w1 = opts.w1 ?? W1;
    const w3 = opts.w3 ?? W3;
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
      if (analog.f1 == null) continue;
      const gap = daysBetween(today.tradeDate, analog.tradeDate);
      if (gap < 5) continue;
      if (opts.poolFilter && !opts.poolFilter(analog, today)) continue;
      const az = features.map((f) => ((analog.vector[f] ?? 0) - means[f]) / stds[f]);
      let dot = 0,
        nt = 0,
        na = 0;
      for (let i = 0; i < tz.length; i++) {
        dot += tz[i] * az[i];
        nt += tz[i] * tz[i];
        na += az[i] * az[i];
      }
      const cos = nt && na ? dot / (Math.sqrt(nt) * Math.sqrt(na)) : 0;
      const base = 1 - Math.min(1, Math.max(-1, cos));
      const distance = base * Math.exp(decay * gap);
      out.push({
        distance,
        weight: inverseDistanceWeight(distance, 0.05),
        f1: analog.f1,
        f3: analog.f3 ?? analog.f1,
        raw: w1 * analog.f1 + w3 * (analog.f3 ?? analog.f1),
      });
    }
    out.sort((a, b) => a.distance - b.distance);
    return out.slice(0, k);
  }

  function knn(nbs: Nb[], w1 = W1, w3 = W3, scale = 2.75) {
    if (!nbs.length) return 0;
    const w = nbs.map((n) => n.weight);
    return tanhScore(
      w1 * weightedMean(nbs.map((n) => n.f1), w) +
        w3 * weightedMean(nbs.map((n) => n.f3), w),
      scale,
    );
  }

  function postProcess(ti: number, score: number, raws: number[], lowVol = LOWVOL) {
    let s = score;
    if (stdev(raws) < lowVol) s = 0;
    s = applyFadeBigDay(s, st[ti].ctc);
    s = applySoftOvernightAmp(s, st[ti].overnight, 20);
    s = applyOvernightVeto(s, st[ti].overnight, 20);
    if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
    return s;
  }

  function v17(ti: number, nbs: Nb[]) {
    return postProcess(
      ti,
      knn(nbs),
      nbs.map((n) => n.raw),
    );
  }

  function agr(nbs: Nb[], score: number) {
    if (!nbs.length || score === 0) return 0.5;
    const sign = Math.sign(score);
    return nbs.filter((n) => Math.sign(n.raw) === sign).length / nbs.length;
  }

  type Idea = {
    name: string;
    useSize?: boolean;
    thr?: number;
    fn: (ti: number) => { score: number; size?: number };
  };

  const ideas: Idea[] = [
    {
      name: "V17 baseline",
      fn: (ti) => ({ score: v17(ti, neighbors(ti)) }),
    },

    // ---- SIZE SCALING (eval with size-weighted returns) ----
    {
      name: "v17 size=agr",
      useSize: true,
      fn: (ti) => {
        const n = neighbors(ti);
        const score = v17(ti, n);
        return { score, size: Math.max(0.25, Math.min(1, agr(n, score))) };
      },
    },
    {
      name: "v17 size=agr*dq",
      useSize: true,
      fn: (ti) => {
        const n = neighbors(ti);
        const score = v17(ti, n);
        const meanD = avg(n.map((x) => x.distance));
        const dq = 1 / (1 + meanD / 2);
        const size = Math.max(0.2, Math.min(1, agr(n, score) * dq));
        return { score, size };
      },
    },
    {
      name: "v17 size=|score|/100",
      useSize: true,
      fn: (ti) => {
        const n = neighbors(ti);
        const score = v17(ti, n);
        return { score, size: Math.max(0.25, Math.min(1, Math.abs(score) / 100)) };
      },
    },
    {
      name: "v17 size=agr*|score|/80",
      useSize: true,
      fn: (ti) => {
        const n = neighbors(ti);
        const score = v17(ti, n);
        const size = Math.max(
          0.2,
          Math.min(1, agr(n, score) * (Math.abs(score) / 80)),
        );
        return { score, size };
      },
    },
    // size as score shrink (hard thr still applies to shrunk score)
    {
      name: "v17 shrink score by agr",
      fn: (ti) => {
        const n = neighbors(ti);
        let s = v17(ti, n);
        if (s !== 0) s = clampScore(s * (0.7 + 0.3 * agr(n, s)));
        return { score: s };
      },
    },
    {
      name: "v17 shrink score by agr strict",
      thr: 22,
      fn: (ti) => {
        const n = neighbors(ti);
        let s = v17(ti, n);
        if (s !== 0) {
          const a = agr(n, s);
          s = clampScore(s * a);
          // if agr low, may fall under thr
        }
        return { score: s };
      },
    },

    // ---- REGIME-SPLIT K ----
    {
      name: "v17 K=7 if VIX>20 else K=5",
      fn: (ti) => {
        const k = st[ti].vector.vixLevel >= 20 ? 7 : 5;
        return { score: v17(ti, neighbors(ti, { k })) };
      },
    },
    {
      name: "v17 K=5 if VIX>20 else K=7",
      fn: (ti) => {
        const k = st[ti].vector.vixLevel >= 20 ? 5 : 7;
        return { score: v17(ti, neighbors(ti, { k })) };
      },
    },
    {
      name: "v17 K=3 high VIX / K=7 low VIX",
      fn: (ti) => {
        const k = st[ti].vector.vixLevel >= 25 ? 3 : st[ti].vector.vixLevel >= 18 ? 5 : 7;
        return { score: v17(ti, neighbors(ti, { k })) };
      },
    },
    {
      name: "v17 same-VIX-regime pool K7",
      fn: (ti) => {
        const n = neighbors(ti, {
          k: 7,
          poolFilter: (p, today) => {
            const hi = today.vector.vixLevel >= 20;
            return hi ? p.vector.vixLevel >= 20 : p.vector.vixLevel < 20;
          },
        });
        // fallback if thin
        if (n.length < 5) return { score: v17(ti, neighbors(ti)) };
        return { score: v17(ti, n) };
      },
    },
    {
      name: "v17 opposite-VIX pool K7",
      fn: (ti) => {
        const n = neighbors(ti, {
          k: 7,
          poolFilter: (p, today) => {
            const hi = today.vector.vixLevel >= 20;
            return hi ? p.vector.vixLevel < 20 : p.vector.vixLevel >= 20;
          },
        });
        if (n.length < 5) return { score: v17(ti, neighbors(ti)) };
        return { score: v17(ti, n) };
      },
    },

    // ---- DUAL / ENSEMBLE ----
    {
      name: "v17 dual: full + minimal3 agree",
      fn: (ti) => {
        const a = v17(ti, neighbors(ti));
        const b = v17(
          ti,
          neighbors(ti, { features: ["spyRsi", "vixMomentum", "hygTltRatio"] }),
        );
        if (a === 0 || b === 0) return { score: 0 };
        if (Math.sign(a) !== Math.sign(b)) return { score: 0 };
        return { score: clampScore((a + b) / 2) };
      },
    },
    {
      name: "v17 dual: full + overnight follow agree",
      fn: (ti) => {
        const a = v17(ti, neighbors(ti));
        const o = tanhScore(st[ti].overnight * 2);
        if (a === 0) return { score: 0 };
        if (Math.abs(o) > 15 && Math.sign(a) !== Math.sign(o)) return { score: 0 };
        return { score: a };
      },
    },
    {
      name: "v17 dual: K5 + K7 average if same sign",
      fn: (ti) => {
        const a = v17(ti, neighbors(ti, { k: 5 }));
        const b = v17(ti, neighbors(ti, { k: 7 }));
        if (a === 0 && b === 0) return { score: 0 };
        if (a === 0) return { score: b };
        if (b === 0) return { score: a };
        if (Math.sign(a) !== Math.sign(b)) return { score: 0 };
        return { score: clampScore((a + b) / 2) };
      },
    },
    {
      name: "v17 dual: cosine K5 + no-decay K5 agree",
      fn: (ti) => {
        const a = v17(ti, neighbors(ti, { decay: ANALOG_MODEL_SETTINGS.temporalDecayLambda }));
        const b = v17(ti, neighbors(ti, { decay: 0 }));
        if (a === 0 || b === 0) return { score: 0 };
        if (Math.sign(a) !== Math.sign(b)) return { score: 0 };
        return { score: clampScore(0.6 * a + 0.4 * b) };
      },
    },
    {
      name: "v17 ensemble: avg of K5 and credit-only",
      fn: (ti) => {
        const a = v17(ti, neighbors(ti));
        const b = v17(
          ti,
          neighbors(ti, { features: ["hygTltRatio", "vixMomentum", "vixLevel"] }),
        );
        if (Math.abs(a) <= THR && Math.abs(b) <= THR) return { score: 0 };
        // only if same sign or one zero
        if (a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b)) return { score: 0 };
        if (a === 0) return { score: b };
        if (b === 0) return { score: a };
        return { score: clampScore((a + b) / 2) };
      },
    },
    {
      name: "v17 1d-only model vs 3d-only agree",
      fn: (ti) => {
        const n = neighbors(ti);
        const s1 = postProcess(
          ti,
          knn(n, 1, 0),
          n.map((x) => x.f1),
        );
        const s3 = postProcess(
          ti,
          knn(n, 0, 1),
          n.map((x) => x.f3),
        );
        if (s1 === 0 || s3 === 0) return { score: 0 };
        if (Math.sign(s1) !== Math.sign(s3)) return { score: 0 };
        return { score: clampScore(0.55 * s1 + 0.45 * s3) };
      },
    },

    // ---- STRUCTURAL POST ----
    {
      name: "v17 require agr>=0.6",
      fn: (ti) => {
        const n = neighbors(ti);
        const s = v17(ti, n);
        if (s !== 0 && agr(n, s) < 0.6) return { score: 0 };
        return { score: s };
      },
    },
    {
      name: "v17 require agr>=0.8",
      fn: (ti) => {
        const n = neighbors(ti);
        const s = v17(ti, n);
        if (s !== 0 && agr(n, s) < 0.8) return { score: 0 };
        return { score: s };
      },
    },
    {
      name: "v17 thr24",
      thr: 24,
      fn: (ti) => ({ score: v17(ti, neighbors(ti)) }),
    },
    {
      name: "v17 thr24 + agr>=0.6",
      thr: 24,
      fn: (ti) => {
        const n = neighbors(ti);
        const s = v17(ti, n);
        if (s !== 0 && agr(n, s) < 0.6) return { score: 0 };
        return { score: s };
      },
    },
    {
      name: "v17 boost when agr=1.0",
      fn: (ti) => {
        const n = neighbors(ti);
        let s = v17(ti, n);
        if (s !== 0 && agr(n, s) >= 0.99) s = clampScore(s * 1.2);
        return { score: s };
      },
    },
    {
      name: "v17 dual pool old/new avg same sign",
      fn: (ti) => {
        const oldN = neighbors(ti, {
          k: 5,
          poolFilter: (p, today) =>
            daysBetween(today.tradeDate, p.tradeDate) >= 3 * 365,
        });
        const newN = neighbors(ti, {
          k: 5,
          poolFilter: (p, today) =>
            daysBetween(today.tradeDate, p.tradeDate) < 3 * 365,
        });
        if (oldN.length < 5 || newN.length < 5) {
          return { score: v17(ti, neighbors(ti)) };
        }
        const a = v17(ti, oldN);
        const b = v17(ti, newN);
        if (a === 0 || b === 0) return { score: 0 };
        if (Math.sign(a) !== Math.sign(b)) return { score: 0 };
        return { score: clampScore(0.5 * a + 0.5 * b) };
      },
    },
    {
      name: "v17 median neighbor blend score",
      fn: (ti) => {
        const n = neighbors(ti);
        if (!n.length) return { score: 0 };
        const blends = n.map((x) => x.raw).sort((a, b) => a - b);
        const med = blends[Math.floor(blends.length / 2)];
        const score = tanhScore(med);
        return { score: postProcess(ti, score, blends) };
      },
    },
    {
      name: "v17 tanh scale 2.0 sharper",
      fn: (ti) => {
        const n = neighbors(ti);
        return {
          score: postProcess(ti, knn(n, W1, W3, 2.0), n.map((x) => x.raw)),
        };
      },
    },
    {
      name: "v17 tanh scale 3.5 softer",
      fn: (ti) => {
        const n = neighbors(ti);
        return {
          score: postProcess(ti, knn(n, W1, W3, 3.5), n.map((x) => x.raw)),
        };
      },
    },
    // structural: VIX-regime different blend
    {
      name: "v17 highVIX blend 0.7/0.3 else 0.55/0.45",
      fn: (ti) => {
        const hi = st[ti].vector.vixLevel >= 22;
        const w1 = hi ? 0.7 : 0.55;
        const w3 = hi ? 0.3 : 0.45;
        const n = neighbors(ti, { w1, w3 });
        // rebuild raws
        const n2 = n.map((x) => ({ ...x, raw: w1 * x.f1 + w3 * x.f3 }));
        return {
          score: postProcess(ti, knn(n2, w1, w3), n2.map((x) => x.raw)),
        };
      },
    },
    {
      name: "v17 highVIX K3 else K5",
      fn: (ti) => {
        const k = st[ti].vector.vixLevel >= 22 ? 3 : 5;
        return { score: v17(ti, neighbors(ti, { k })) };
      },
    },
    // size + structural
    {
      name: "v17 agr shrink + thr22",
      fn: (ti) => {
        const n = neighbors(ti);
        let s = v17(ti, n);
        if (s !== 0) s = clampScore(s * (0.5 + 0.5 * agr(n, s)));
        return { score: s };
      },
    },
    {
      name: "v17 dual K5/K7 agree + size=agr",
      useSize: true,
      fn: (ti) => {
        const a = v17(ti, neighbors(ti, { k: 5 }));
        const b = v17(ti, neighbors(ti, { k: 7 }));
        if (a === 0 || b === 0) return { score: 0, size: 0 };
        if (Math.sign(a) !== Math.sign(b)) return { score: 0, size: 0 };
        const score = clampScore((a + b) / 2);
        const n = neighbors(ti);
        return { score, size: Math.max(0.3, Math.min(1, agr(n, score))) };
      },
    },
  ];

  console.log(`Points=${st.length} start=${st[start]?.tradeDate} thr=${THR}\n`);

  type Row = {
    name: string;
    hit: number;
    edge: number;
    whenIn: number;
    cash: number;
    dir: number;
    prod: number;
    edgePos: number;
    hitPos: number;
    years: number;
    useSize: boolean;
    detail: string[];
  };
  const results: Row[] = [];

  for (const idea of ideas) {
    const thr = idea.thr ?? THR;
    const days: Day[] = [];
    for (let ti = start; ti < st.length; ti++) {
      const r = idea.fn(ti);
      days.push({
        date: st[ti].tradeDate,
        score: r.score,
        size: r.size,
        nextOtc: st[ti].nextOtc,
      });
    }
    const s = summarize(days, thr, idea.useSize === true);
    const y = yearStab(days, thr);
    results.push({
      name: idea.name,
      ...s,
      edgePos: y.edgePos,
      hitPos: y.hitPos,
      years: y.years,
      useSize: !!idea.useSize,
      detail: y.detail,
    });
    const mark =
      s.prod > 2.0 ? " ★★" : s.prod > 1.9 ? " ★" : s.prod > 1.85 ? " +" : "";
    console.log(
      `${idea.name.padEnd(42)} hit=${s.hit.toFixed(1)}% edge=${(s.edge >= 0 ? "+" : "") + s.edge.toFixed(3)} cash=${(s.cash * 100).toFixed(0)}% dir=${String(s.dir).padStart(4)} prod=${s.prod.toFixed(4)} yE+${y.edgePos}/${y.years}${mark}`,
    );
  }

  const base = results.find((r) => r.name === "V17 baseline")!;
  results.sort((a, b) => b.prod - a.prod);

  console.log("\n########## TOP 12 by product obj ##########");
  for (const r of results.slice(0, 12)) {
    console.log(
      `${r.prod.toFixed(4)} hit=${r.hit.toFixed(1)} edge=${r.edge >= 0 ? "+" : ""}${r.edge.toFixed(3)} cash=${(r.cash * 100).toFixed(0)}% dir=${r.dir} yE+${r.edgePos}  ${r.name}${r.useSize ? " [size]" : ""}`,
    );
  }

  const strict = results.filter(
    (r) =>
      r.name !== base.name &&
      r.prod > base.prod + 0.04 &&
      r.edge > base.edge &&
      r.hit >= base.hit - 0.5 &&
      r.dir >= 180 &&
      r.cash < 0.92 &&
      r.edgePos >= base.edgePos,
  );

  console.log("\n########## STRICT BEATS V17 ##########");
  if (!strict.length) console.log("(none)");
  for (const r of strict) {
    console.log(
      `${r.name}\n  prod ${base.prod.toFixed(4)}→${r.prod.toFixed(4)} hit ${base.hit.toFixed(1)}→${r.hit.toFixed(1)} edge ${base.edge.toFixed(3)}→${r.edge.toFixed(3)} cash ${(base.cash * 100).toFixed(0)}→${(r.cash * 100).toFixed(0)}% dir ${base.dir}→${r.dir} yE+${r.edgePos}/${r.years}${r.useSize ? " [SIZE-SCALED P&L]" : ""}`,
    );
    console.log("  " + r.detail.join("  "));
  }

  const loose = results.filter(
    (r) =>
      r.name !== base.name &&
      r.prod > base.prod + 0.03 &&
      r.edge > base.edge + 0.01 &&
      r.dir >= 180 &&
      r.edgePos >= base.edgePos - 1 &&
      r.hitPos >= 5,
  );

  console.log("\n########## LOOSE BEATS ##########");
  for (const r of loose.sort((a, b) => b.prod - a.prod).slice(0, 10)) {
    console.log(
      `${r.name}: prod ${r.prod.toFixed(4)} hit ${r.hit.toFixed(1)} edge ${r.edge.toFixed(3)} dir ${r.dir} yE+${r.edgePos}${r.useSize ? " [size]" : ""}`,
    );
  }

  const best = strict[0] ?? null;
  console.log("\n########## RECOMMENDED ##########");
  if (!best) console.log("Keep V17 — structural ideas need more work or different eval");
  else {
    console.log(`Ship: ${best.name}`);
    console.log(JSON.stringify(best, null, 2));
  }

  const fs = await import("fs");
  fs.writeFileSync(
    "scripts/.wacky-v17-structural-results.json",
    JSON.stringify({ base, top: results.slice(0, 15), strict, loose, best }, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
