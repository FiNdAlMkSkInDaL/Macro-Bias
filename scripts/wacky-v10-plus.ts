/**
 * Wacky ideas ON TOP of locked v10 (cosine + Monday dampener).
 * Product metric: next-session open→close, lag-1, thr±20.
 * Run: npx tsx scripts/wacky-v10-plus.ts
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
import { isUsEquityMonday } from "../src/utils/knn";

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

type Day = { date: string; score: number; nextOtc: number | null };

function summarize(days: Day[]) {
  let dir = 0,
    hits = 0,
    cash = 0;
  const longs: number[] = [];
  const shorts: number[] = [];
  const when: number[] = [];
  for (const d of days) {
    if (d.nextOtc == null) continue;
    if (Math.abs(d.score) <= THR) {
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

function yearStab(days: Day[]) {
  const by = new Map<string, Day[]>();
  for (const d of days) {
    if (d.nextOtc == null) continue;
    const y = d.date.slice(0, 4);
    if (!by.has(y)) by.set(y, []);
    by.get(y)!.push(d);
  }
  const years = [...by.entries()].sort();
  let edgePos = 0,
    hitPos = 0;
  for (const [, ds] of years) {
    const s = summarize(ds);
    if (s.edge > 0) edgePos++;
    if (s.hit > 50) hitPos++;
  }
  return { years: years.length, edgePos, hitPos };
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
        spy20d: spy20 ? pct(spy20.close, spy.close) : 0,
        overnight: spy.open > 0 ? pct(prev.close, spy.open) : 0,
        qqq5d: qqq && qqq5 ? pct(qqq5.close, qqq.close) : 0,
        hygTltMom:
          maps.HYG.get(dates[i - 5]) && maps.TLT.get(dates[i - 5])
            ? pct(
                maps.HYG.get(dates[i - 5]).close / maps.TLT.get(dates[i - 5]).close,
                hyg.close / tlt.close,
              )
            : 0,
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
  const start = st.findIndex((p) => p.tradeDate >= BACKTEST_START);
  const prodF = [...STOCKS_KNN_FEATURE_KEYS];

  type Nb = { distance: number; weight: number; f1: number; f3: number; raw: number };

  function neighbors(
    ti: number,
    features: string[],
    opts: {
      k?: number;
      decay?: number;
      metric?: "cosine" | "euclidean";
      minAgeY?: number | null;
      maxAgeY?: number | null;
      poolFilter?: (p: Point, today: Point) => boolean;
    } = {},
  ): Nb[] {
    const k = opts.k ?? 5;
    const decay = opts.decay ?? ANALOG_MODEL_SETTINGS.temporalDecayLambda;
    const metric = opts.metric ?? "cosine";
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
      if (opts.minAgeY != null && gap < opts.minAgeY * 365) continue;
      if (opts.maxAgeY != null && gap > opts.maxAgeY * 365) continue;
      if (opts.poolFilter && !opts.poolFilter(analog, today)) continue;
      const az = features.map((f) => ((analog.vector[f] ?? 0) - means[f]) / stds[f]);
      let base = 0;
      if (metric === "cosine") {
        let dot = 0,
          nt = 0,
          na = 0;
        for (let i = 0; i < tz.length; i++) {
          dot += tz[i] * az[i];
          nt += tz[i] * tz[i];
          na += az[i] * az[i];
        }
        const cos = nt && na ? dot / (Math.sqrt(nt) * Math.sqrt(na)) : 0;
        base = 1 - Math.min(1, Math.max(-1, cos));
      } else {
        base = Math.sqrt(features.reduce((s, _, i) => s + (tz[i] - az[i]) ** 2, 0));
      }
      const distance = base * Math.exp(decay * gap);
      const f1 = analog.f1;
      const f3 = analog.f3 ?? f1;
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
    return tanhScore(
      0.4 *
        weightedMean(
          nbs.map((n) => n.f1),
          w,
        ) +
        0.6 *
          weightedMean(
            nbs.map((n) => n.f3),
            w,
          ),
      scale,
    );
  }

  /** v10 base score (cosine K5, then Monday zero). */
  function v10Score(ti: number, raw: number) {
    if (isUsEquityMonday(st[ti].tradeDate)) return 0;
    return raw;
  }

  type Idea = { name: string; fn: (ti: number) => number };
  const ideas: Idea[] = [
    {
      name: "V10 baseline",
      fn: (ti) => v10Score(ti, knn(neighbors(ti, prodF))),
    },
    // --- overnight ---
    {
      name: "v10 + overnight 70/30",
      fn: (ti) => {
        const k = knn(neighbors(ti, prodF));
        const o = tanhScore(st[ti].overnight * 2);
        return v10Score(ti, clampScore(0.7 * k + 0.3 * o));
      },
    },
    {
      name: "v10 + overnight 50/50",
      fn: (ti) => {
        const k = knn(neighbors(ti, prodF));
        const o = tanhScore(st[ti].overnight * 2);
        return v10Score(ti, clampScore(0.5 * k + 0.5 * o));
      },
    },
    {
      name: "v10 + overnight agree only",
      fn: (ti) => {
        const k = knn(neighbors(ti, prodF));
        const o = tanhScore(st[ti].overnight * 2);
        if (k > THR && o > 0) return v10Score(ti, clampScore((k + o) / 2));
        if (k < -THR && o < 0) return v10Score(ti, clampScore((k + o) / 2));
        return 0;
      },
    },
    {
      name: "v10 + overnight veto disagree",
      fn: (ti) => {
        const k = knn(neighbors(ti, prodF));
        const o = st[ti].overnight;
        // if overnight gap fights KNN lean by >0.3%, flatten
        if (k > THR && o < -0.3) return 0;
        if (k < -THR && o > 0.3) return 0;
        return v10Score(ti, k);
      },
    },
    {
      name: "v10 + overnight amplify agree",
      fn: (ti) => {
        const k = knn(neighbors(ti, prodF));
        const o = st[ti].overnight;
        if (k > THR && o > 0.15) return v10Score(ti, clampScore(k * 1.25));
        if (k < -THR && o < -0.15) return v10Score(ti, clampScore(k * 1.25));
        if (k > THR && o < -0.15) return v10Score(ti, clampScore(k * 0.5));
        if (k < -THR && o > 0.15) return v10Score(ti, clampScore(k * 0.5));
        return v10Score(ti, k);
      },
    },
    // --- mean reversion ---
    {
      name: "v10 + 5dMR 70/30",
      fn: (ti) => {
        const k = knn(neighbors(ti, prodF));
        const m = tanhScore(-st[ti].vector.spy5d / 3);
        return v10Score(ti, clampScore(0.7 * k + 0.3 * m));
      },
    },
    {
      name: "v10 + fade big day",
      fn: (ti) => {
        const k = knn(neighbors(ti, prodF));
        if (Math.abs(st[ti].ctc) > 1.5) {
          return v10Score(ti, clampScore(k * 0.3 - Math.sign(st[ti].ctc) * 25));
        }
        return v10Score(ti, k);
      },
    },
    // --- features ---
    {
      name: "v10 feats + overnight in knn",
      fn: (ti) => v10Score(ti, knn(neighbors(ti, [...prodF, "overnight"]))),
    },
    {
      name: "v10 feats + spy5d",
      fn: (ti) => v10Score(ti, knn(neighbors(ti, [...prodF, "spy5d"]))),
    },
    {
      name: "v10 feats + hygTltMom",
      fn: (ti) => v10Score(ti, knn(neighbors(ti, [...prodF, "hygTltMom"]))),
    },
    {
      name: "v10 feats + qqq5d",
      fn: (ti) => v10Score(ti, knn(neighbors(ti, [...prodF, "qqq5d"]))),
    },
    {
      name: "v10 drop usoMomentum",
      fn: (ti) =>
        v10Score(
          ti,
          knn(neighbors(ti, prodF.filter((f) => f !== "usoMomentum"))),
        ),
    },
    {
      name: "v10 drop cperGld",
      fn: (ti) =>
        v10Score(
          ti,
          knn(neighbors(ti, prodF.filter((f) => f !== "cperGldRatio"))),
        ),
    },
    {
      name: "v10 minimal3",
      fn: (ti) =>
        v10Score(ti, knn(neighbors(ti, ["spyRsi", "vixMomentum", "hygTltRatio"]))),
    },
    // --- pool / distance ---
    {
      name: "v10 no decay",
      fn: (ti) => v10Score(ti, knn(neighbors(ti, prodF, { decay: 0 }))),
    },
    {
      name: "v10 heavy decay",
      fn: (ti) => v10Score(ti, knn(neighbors(ti, prodF, { decay: 0.002 }))),
    },
    {
      name: "v10 only analogs ≥3y old",
      fn: (ti) => v10Score(ti, knn(neighbors(ti, prodF, { minAgeY: 3, k: 7 }))),
    },
    {
      name: "v10 dual pool 50/50 old+new",
      fn: (ti) => {
        const oldN = neighbors(ti, prodF, { minAgeY: 3, k: 5 });
        const newN = neighbors(ti, prodF, { maxAgeY: 3, k: 5 });
        const kOld = knn(oldN);
        const kNew = knn(newN);
        if (!oldN.length) return v10Score(ti, kNew);
        if (!newN.length) return v10Score(ti, kOld);
        return v10Score(ti, clampScore(0.5 * kOld + 0.5 * kNew));
      },
    },
    {
      name: "v10 opposite VIX regime",
      fn: (ti) =>
        v10Score(
          ti,
          knn(
            neighbors(ti, prodF, {
              k: 7,
              poolFilter: (p, today) => {
                const hi = today.vector.vixLevel >= 20;
                return hi ? p.vector.vixLevel < 20 : p.vector.vixLevel >= 20;
              },
            }),
          ),
        ),
    },
    {
      name: "v10 same VIX regime",
      fn: (ti) =>
        v10Score(
          ti,
          knn(
            neighbors(ti, prodF, {
              k: 7,
              poolFilter: (p, today) => {
                const hi = today.vector.vixLevel >= 20;
                return hi ? p.vector.vixLevel >= 20 : p.vector.vixLevel < 20;
              },
            }),
          ),
        ),
    },
    {
      name: "v10 K3",
      fn: (ti) => v10Score(ti, knn(neighbors(ti, prodF, { k: 3 }))),
    },
    {
      name: "v10 K7",
      fn: (ti) => v10Score(ti, knn(neighbors(ti, prodF, { k: 7 }))),
    },
    {
      name: "v10 flat low neighbor vol",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        if (stdev(n.map((x) => x.raw)) < 0.4) return 0;
        return v10Score(ti, knn(n));
      },
    },
    {
      name: "v10 flat high neighbor vol",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        if (stdev(n.map((x) => x.raw)) > 1.0) return 0;
        return v10Score(ti, knn(n));
      },
    },
    // --- calendar ---
    {
      name: "v10 also skip Friday scores",
      fn: (ti) => {
        if (dow(st[ti].tradeDate) === 5) return 0;
        return v10Score(ti, knn(neighbors(ti, prodF)));
      },
    },
    {
      name: "v10 only TueWedThu",
      fn: (ti) => {
        const d = dow(st[ti].tradeDate);
        if (d === 1 || d === 5) return 0;
        return knn(neighbors(ti, prodF)); // Mon already in v10Score path but Fri too
      },
    },
    {
      name: "v10 thr30",
      fn: (ti) => {
        const s = v10Score(ti, knn(neighbors(ti, prodF)));
        return Math.abs(s) <= 30 ? 0 : s;
      },
    },
    // --- blends / ensembles ---
    {
      name: "v10 + overnight + 5dMR 60/20/20",
      fn: (ti) => {
        const k = knn(neighbors(ti, prodF));
        const o = tanhScore(st[ti].overnight * 2);
        const m = tanhScore(-st[ti].vector.spy5d / 3);
        return v10Score(ti, clampScore(0.6 * k + 0.2 * o + 0.2 * m));
      },
    },
    {
      name: "v10 cosine × overnight sign vote",
      fn: (ti) => {
        const k = knn(neighbors(ti, prodF));
        const oSign = Math.sign(st[ti].overnight);
        if (k > THR && oSign > 0) return v10Score(ti, k);
        if (k < -THR && oSign < 0) return v10Score(ti, k);
        if (Math.abs(k) > THR && oSign !== 0 && Math.sign(k) !== oSign) return 0;
        return v10Score(ti, k);
      },
    },
    {
      name: "v10 dual pool + overnight 70/30",
      fn: (ti) => {
        const oldN = neighbors(ti, prodF, { minAgeY: 3, k: 5 });
        const newN = neighbors(ti, prodF, { maxAgeY: 3, k: 5 });
        const k =
          oldN.length && newN.length
            ? clampScore(0.5 * knn(oldN) + 0.5 * knn(newN))
            : knn(neighbors(ti, prodF));
        const o = tanhScore(st[ti].overnight * 2);
        return v10Score(ti, clampScore(0.7 * k + 0.3 * o));
      },
    },
    {
      name: "v10 drop uso + overnight 70/30",
      fn: (ti) => {
        const k = knn(neighbors(ti, prodF.filter((f) => f !== "usoMomentum")));
        const o = tanhScore(st[ti].overnight * 2);
        return v10Score(ti, clampScore(0.7 * k + 0.3 * o));
      },
    },
    {
      name: "v10 no decay + overnight 70/30",
      fn: (ti) => {
        const k = knn(neighbors(ti, prodF, { decay: 0 }));
        const o = tanhScore(st[ti].overnight * 2);
        return v10Score(ti, clampScore(0.7 * k + 0.3 * o));
      },
    },
    {
      name: "v10 + overnight 80/20",
      fn: (ti) => {
        const k = knn(neighbors(ti, prodF));
        const o = tanhScore(st[ti].overnight * 2);
        return v10Score(ti, clampScore(0.8 * k + 0.2 * o));
      },
    },
    {
      name: "pure overnight (Mon skip)",
      fn: (ti) => v10Score(ti, tanhScore(st[ti].overnight * 2)),
    },
    {
      name: "v10 invert RSI extreme",
      fn: (ti) => {
        let k = knn(neighbors(ti, prodF));
        const r = st[ti].vector.spyRsi;
        if (r > 75 && k > 0) k = -Math.abs(k) * 0.5;
        if (r < 25 && k < 0) k = Math.abs(k) * 0.5;
        return v10Score(ti, clampScore(k));
      },
    },
  ];

  console.log(`Points=${st.length} start=${st[start]?.tradeDate}\n`);
  const results: Array<{
    name: string;
    hit: number;
    edge: number;
    whenIn: number;
    cash: number;
    dir: number;
    fair: number;
    edgePos: number;
    hitPos: number;
    years: number;
  }> = [];

  for (const idea of ideas) {
    const days: Day[] = [];
    for (let ti = start; ti < st.length; ti++) {
      days.push({
        date: st[ti].tradeDate,
        score: idea.fn(ti),
        nextOtc: st[ti].nextOtc,
      });
    }
    const s = summarize(days);
    const y = yearStab(days);
    results.push({
      name: idea.name,
      ...s,
      edgePos: y.edgePos,
      hitPos: y.hitPos,
      years: y.years,
    });
    const mark = s.fair > 0.65 ? " ★" : s.fair > 0.57 ? " +" : "";
    console.log(
      `${idea.name.padEnd(38)} hit=${s.hit.toFixed(1)}% edge=${(s.edge >= 0 ? "+" : "") + s.edge.toFixed(3)} cash=${(s.cash * 100).toFixed(0)}% dir=${String(s.dir).padStart(4)} fair=${s.fair.toFixed(4)} yE+${y.edgePos}/${y.years}${mark}`,
    );
  }

  const base = results.find((r) => r.name === "V10 baseline")!;
  results.sort((a, b) => b.fair - a.fair);

  console.log("\n########## TOP 12 ##########");
  for (const r of results.slice(0, 12)) {
    console.log(
      `${r.fair.toFixed(4)} hit=${r.hit.toFixed(1)} edge=${r.edge >= 0 ? "+" : ""}${r.edge.toFixed(3)} cash=${(r.cash * 100).toFixed(0)}% dir=${r.dir} yE+${r.edgePos}/${r.years}  ${r.name}`,
    );
  }

  const beats = results.filter(
    (r) =>
      r.name !== base.name &&
      r.fair > base.fair + 0.03 &&
      r.dir >= 200 &&
      r.cash < 0.85 &&
      r.edgePos >= base.edgePos,
  );
  console.log("\n########## BEATS V10 (fair+0.03, dir≥200, cash<85%, edge+ years ≥ v10) ##########");
  if (!beats.length) console.log("(none strict)");
  for (const r of beats) {
    console.log(
      `${r.name}: fair ${base.fair.toFixed(4)}→${r.fair.toFixed(4)} hit ${base.hit.toFixed(1)}→${r.hit.toFixed(1)} edge ${base.edge.toFixed(3)}→${r.edge.toFixed(3)} cash ${(base.cash * 100).toFixed(0)}→${(r.cash * 100).toFixed(0)}% yE+${r.edgePos}/${r.years}`,
    );
  }

  // Looser: fair better + dir ok, even if year edge slightly worse
  const loose = results.filter(
    (r) =>
      r.name !== base.name &&
      r.fair > base.fair + 0.05 &&
      r.dir >= 250 &&
      r.cash < 0.8 &&
      r.edge > base.edge,
  );
  console.log("\n########## LOOSE BEATS (fair+0.05, better edge, dir≥250, cash<80%) ##########");
  for (const r of loose) {
    console.log(
      `${r.name}: fair ${base.fair.toFixed(4)}→${r.fair.toFixed(4)} hit ${base.hit.toFixed(1)}→${r.hit.toFixed(1)} edge ${base.edge.toFixed(3)}→${r.edge.toFixed(3)} yE+${r.edgePos}/${r.years}`,
    );
  }

  const fs = await import("fs");
  fs.writeFileSync(
    "scripts/.wacky-v10-plus-results.json",
    JSON.stringify({ base, top: results.slice(0, 15), beats, loose, all: results }, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
