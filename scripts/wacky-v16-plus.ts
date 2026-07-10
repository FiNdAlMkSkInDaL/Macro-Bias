/**
 * Stack ideas ON TOP of locked v16
 * (full pipeline + thr22). Product: next-session open→close.
 * Run: npx tsx scripts/wacky-v16-plus.ts
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
  applyLowNeighborVolFlat,
  applyOvernightVeto,
  applySoftOvernightAmp,
} from "../src/lib/macro-bias/calculate-daily-bias";
import {
  inverseDistanceWeight,
  stationarizeLevelFeatures,
  weightedMean,
} from "../src/lib/signal";
import { isUsEquityMonday } from "../src/utils/knn";

const THR = STRATEGY_RULES.scoreThreshold; // 22
const RSI = 14;
const START = "2020-01-01";
const W1 = ANALOG_MODEL_SETTINGS.oneDayBlendWeight;
const W3 = ANALOG_MODEL_SETTINGS.threeDayBlendWeight;

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
function tanhScore(b: number) {
  return clampScore(Math.tanh(b / 2.75) * 100);
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

function summarize(days: Day[], thr = THR) {
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
    features: string[] = prodF,
    k = 5,
    decay = ANALOG_MODEL_SETTINGS.temporalDecayLambda,
  ): Nb[] {
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
        raw: W1 * analog.f1 + W3 * (analog.f3 ?? analog.f1),
      });
    }
    out.sort((a, b) => a.distance - b.distance);
    return out.slice(0, k);
  }

  function knn(nbs: Nb[]) {
    if (!nbs.length) return 0;
    const w = nbs.map((n) => n.weight);
    return tanhScore(
      W1 * weightedMean(nbs.map((n) => n.f1), w) +
        W3 * weightedMean(nbs.map((n) => n.f3), w),
    );
  }

  /** Full v16 pipeline (score already continuous; thr applied at eval). */
  function v16(ti: number, nbs: Nb[]) {
    let s = knn(nbs);
    s = applyLowNeighborVolFlat(s, nbs.map((n) => n.raw));
    s = applyFadeBigDay(s, st[ti].ctc);
    s = applySoftOvernightAmp(s, st[ti].overnight, 20);
    s = applyOvernightVeto(s, st[ti].overnight, 20);
    if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
    return s;
  }

  type Idea = { name: string; thr?: number; fn: (ti: number) => number };
  const ideas: Idea[] = [
    { name: "V16 baseline", fn: (ti) => v16(ti, neighbors(ti)) },

    // thr
    { name: "v16 thr24", thr: 24, fn: (ti) => v16(ti, neighbors(ti)) },
    { name: "v16 thr23", thr: 23, fn: (ti) => v16(ti, neighbors(ti)) },
    { name: "v16 thr25", thr: 25, fn: (ti) => v16(ti, neighbors(ti)) },

    // K
    { name: "v16 K7", fn: (ti) => v16(ti, neighbors(ti, prodF, 7)) },
    { name: "v16 K6", fn: (ti) => v16(ti, neighbors(ti, prodF, 6)) },
    { name: "v16 K4", fn: (ti) => v16(ti, neighbors(ti, prodF, 4)) },
    {
      name: "v16 K7 thr22",
      fn: (ti) => v16(ti, neighbors(ti, prodF, 7)),
    },
    {
      name: "v16 K7 thr24",
      thr: 24,
      fn: (ti) => v16(ti, neighbors(ti, prodF, 7)),
    },

    // decay
    {
      name: "v16 heavy decay 0.002",
      fn: (ti) => v16(ti, neighbors(ti, prodF, 5, 0.002)),
    },
    {
      name: "v16 heavy decay thr24",
      thr: 24,
      fn: (ti) => v16(ti, neighbors(ti, prodF, 5, 0.002)),
    },
    {
      name: "v16 no decay",
      fn: (ti) => v16(ti, neighbors(ti, prodF, 5, 0)),
    },

    // fade
    {
      name: "v16 fade push 40",
      fn: (ti) => {
        const n = neighbors(ti);
        let s = applyLowNeighborVolFlat(knn(n), n.map((x) => x.raw));
        if (Math.abs(st[ti].ctc) > 1.5) {
          s = clampScore(s * 0.3 - Math.sign(st[ti].ctc) * 40);
        }
        s = applySoftOvernightAmp(s, st[ti].overnight, 20);
        s = applyOvernightVeto(s, st[ti].overnight, 20);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v16 fade push 40 thr24",
      thr: 24,
      fn: (ti) => {
        const n = neighbors(ti);
        let s = applyLowNeighborVolFlat(knn(n), n.map((x) => x.raw));
        if (Math.abs(st[ti].ctc) > 1.5) {
          s = clampScore(s * 0.3 - Math.sign(st[ti].ctc) * 40);
        }
        s = applySoftOvernightAmp(s, st[ti].overnight, 20);
        s = applyOvernightVeto(s, st[ti].overnight, 20);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v16 fade thr 1.2 push 35",
      fn: (ti) => {
        const n = neighbors(ti);
        let s = applyLowNeighborVolFlat(knn(n), n.map((x) => x.raw));
        if (Math.abs(st[ti].ctc) > 1.2) {
          s = clampScore(s * 0.3 - Math.sign(st[ti].ctc) * 35);
        }
        s = applySoftOvernightAmp(s, st[ti].overnight, 20);
        s = applyOvernightVeto(s, st[ti].overnight, 20);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },

    // soft amp knobs
    {
      name: "v16 soft amp 1.2/0.65",
      fn: (ti) => {
        const n = neighbors(ti);
        let s = applyLowNeighborVolFlat(knn(n), n.map((x) => x.raw));
        s = applyFadeBigDay(s, st[ti].ctc);
        const o = st[ti].overnight;
        if (s > 20 && o > 0.15) s = clampScore(s * 1.2);
        else if (s < -20 && o < -0.15) s = clampScore(s * 1.2);
        else if (s > 20 && o < -0.15) s = clampScore(s * 0.65);
        else if (s < -20 && o > 0.15) s = clampScore(s * 0.65);
        s = applyOvernightVeto(s, o, 20);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },

    // lowvol
    {
      name: "v16 lowvol thr 0.5",
      fn: (ti) => {
        const n = neighbors(ti);
        let s = knn(n);
        if (stdev(n.map((x) => x.raw)) < 0.5) s = 0;
        s = applyFadeBigDay(s, st[ti].ctc);
        s = applySoftOvernightAmp(s, st[ti].overnight, 20);
        s = applyOvernightVeto(s, st[ti].overnight, 20);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v16 lowvol thr 0.35",
      fn: (ti) => {
        const n = neighbors(ti);
        let s = knn(n);
        if (stdev(n.map((x) => x.raw)) < 0.35) s = 0;
        s = applyFadeBigDay(s, st[ti].ctc);
        s = applySoftOvernightAmp(s, st[ti].overnight, 20);
        s = applyOvernightVeto(s, st[ti].overnight, 20);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },

    // blend
    {
      name: "v16 blend 0.6/0.4",
      fn: (ti) => {
        const n = neighbors(ti);
        const w = n.map((x) => x.weight);
        let s = tanhScore(
          0.6 * weightedMean(n.map((x) => x.f1), w) +
            0.4 * weightedMean(n.map((x) => x.f3), w),
        );
        s = applyLowNeighborVolFlat(
          s,
          n.map((x) => 0.6 * x.f1 + 0.4 * x.f3),
        );
        s = applyFadeBigDay(s, st[ti].ctc);
        s = applySoftOvernightAmp(s, st[ti].overnight, 20);
        s = applyOvernightVeto(s, st[ti].overnight, 20);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v16 blend 0.5/0.5",
      fn: (ti) => {
        const n = neighbors(ti);
        const w = n.map((x) => x.weight);
        let s = tanhScore(
          0.5 * weightedMean(n.map((x) => x.f1), w) +
            0.5 * weightedMean(n.map((x) => x.f3), w),
        );
        s = applyLowNeighborVolFlat(
          s,
          n.map((x) => 0.5 * x.f1 + 0.5 * x.f3),
        );
        s = applyFadeBigDay(s, st[ti].ctc);
        s = applySoftOvernightAmp(s, st[ti].overnight, 20);
        s = applyOvernightVeto(s, st[ti].overnight, 20);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },

    // calendar
    {
      name: "v16 skip Friday",
      fn: (ti) => {
        if (dow(st[ti].tradeDate) === 5) return 0;
        return v16(ti, neighbors(ti));
      },
    },
    {
      name: "v16 skip Fri thr24",
      thr: 24,
      fn: (ti) => {
        if (dow(st[ti].tradeDate) === 5) return 0;
        return v16(ti, neighbors(ti));
      },
    },

    // features
    { name: "v16 + qqq5d", fn: (ti) => v16(ti, neighbors(ti, [...prodF, "qqq5d"])) },
    { name: "v16 + spy5d", fn: (ti) => v16(ti, neighbors(ti, [...prodF, "spy5d"])) },
    {
      name: "v16 drop uso",
      fn: (ti) =>
        v16(
          ti,
          neighbors(
            ti,
            prodF.filter((f) => f !== "usoMomentum"),
          ),
        ),
    },

    // agreement
    {
      name: "v16 require 4/5 sign agree",
      fn: (ti) => {
        const n = neighbors(ti);
        let s = v16(ti, n);
        if (s === 0) return 0;
        const sign = Math.sign(s);
        const agree = n.filter((x) => Math.sign(x.raw) === sign).length;
        if (agree < 4) return 0;
        return s;
      },
    },
    {
      name: "v16 unan sign boost 1.15",
      fn: (ti) => {
        const n = neighbors(ti);
        let s = v16(ti, n);
        if (s === 0) return 0;
        const signs = n.map((x) => Math.sign(x.raw));
        if (signs.every((x) => x > 0) && s > 0) s = clampScore(s * 1.15);
        if (signs.every((x) => x < 0) && s < 0) s = clampScore(s * 1.15);
        return s;
      },
    },

    // size-like: scale score by agreement
    {
      name: "v16 scale by neighbor agr",
      fn: (ti) => {
        const n = neighbors(ti);
        let s = v16(ti, n);
        if (s === 0) return 0;
        const sign = Math.sign(s);
        const agr = n.filter((x) => Math.sign(x.raw) === sign).length / n.length;
        // agr 0.6→1.0 maps scale 0.85→1.1
        const scale = 0.85 + 0.25 * ((agr - 0.6) / 0.4);
        return clampScore(s * Math.min(1.15, Math.max(0.75, scale)));
      },
    },

    // kitchen
    {
      name: "v16 fade40 + thr24",
      thr: 24,
      fn: (ti) => {
        const n = neighbors(ti);
        let s = applyLowNeighborVolFlat(knn(n), n.map((x) => x.raw));
        if (Math.abs(st[ti].ctc) > 1.5) {
          s = clampScore(s * 0.3 - Math.sign(st[ti].ctc) * 40);
        }
        s = applySoftOvernightAmp(s, st[ti].overnight, 20);
        s = applyOvernightVeto(s, st[ti].overnight, 20);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v16 heavy decay + thr24",
      thr: 24,
      fn: (ti) => v16(ti, neighbors(ti, prodF, 5, 0.002)),
    },
    {
      name: "v16 blend 0.6/0.4 thr24",
      thr: 24,
      fn: (ti) => {
        const n = neighbors(ti);
        const w = n.map((x) => x.weight);
        let s = tanhScore(
          0.6 * weightedMean(n.map((x) => x.f1), w) +
            0.4 * weightedMean(n.map((x) => x.f3), w),
        );
        s = applyLowNeighborVolFlat(
          s,
          n.map((x) => 0.6 * x.f1 + 0.4 * x.f3),
        );
        s = applyFadeBigDay(s, st[ti].ctc);
        s = applySoftOvernightAmp(s, st[ti].overnight, 20);
        s = applyOvernightVeto(s, st[ti].overnight, 20);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v16 + 5dMR 92/8",
      fn: (ti) => {
        let s = v16(ti, neighbors(ti));
        if (Math.abs(s) <= THR) return s;
        const m = tanhScore(-st[ti].vector.spy5d / 3);
        return clampScore(0.92 * s + 0.08 * m);
      },
    },
  ];

  console.log(`Points=${st.length} start=${st[start]?.tradeDate} thr=${THR}\n`);
  type Row = {
    name: string;
    thr: number;
    hit: number;
    edge: number;
    whenIn: number;
    cash: number;
    dir: number;
    fair: number;
    edgePos: number;
    hitPos: number;
    years: number;
    detail: string[];
  };
  const results: Row[] = [];

  for (const idea of ideas) {
    const thr = idea.thr ?? THR;
    const days: Day[] = [];
    for (let ti = start; ti < st.length; ti++) {
      days.push({
        date: st[ti].tradeDate,
        score: idea.fn(ti),
        nextOtc: st[ti].nextOtc,
      });
    }
    const s = summarize(days, thr);
    const y = yearStab(days, thr);
    results.push({
      name: idea.name,
      thr,
      ...s,
      edgePos: y.edgePos,
      hitPos: y.hitPos,
      years: y.years,
      detail: y.detail,
    });
    const mark =
      s.fair > 1.85 ? " ★★" : s.fair > 1.73 ? " ★" : s.fair > 1.65 ? " +" : "";
    console.log(
      `${idea.name.padEnd(32)} hit=${s.hit.toFixed(1)}% edge=${(s.edge >= 0 ? "+" : "") + s.edge.toFixed(3)} cash=${(s.cash * 100).toFixed(0)}% dir=${String(s.dir).padStart(4)} fair=${s.fair.toFixed(4)} yE+${y.edgePos}/${y.years} yH+${y.hitPos}/${y.years}${mark}`,
    );
  }

  const base = results.find((r) => r.name === "V16 baseline")!;
  results.sort((a, b) => b.fair - a.fair);

  console.log("\n########## TOP 12 ##########");
  for (const r of results.slice(0, 12)) {
    console.log(
      `${r.fair.toFixed(4)} hit=${r.hit.toFixed(1)} edge=${r.edge >= 0 ? "+" : ""}${r.edge.toFixed(3)} cash=${(r.cash * 100).toFixed(0)}% dir=${r.dir} yE+${r.edgePos}  ${r.name}`,
    );
  }

  const strict = results.filter(
    (r) =>
      r.name !== base.name &&
      r.fair > base.fair + 0.04 &&
      r.edge > base.edge &&
      r.hit >= base.hit - 0.3 &&
      r.dir >= 200 &&
      r.cash < 0.9 &&
      r.edgePos >= base.edgePos,
  );
  strict.sort((a, b) => b.fair - a.fair);

  console.log("\n########## STRICT BEATS V16 ##########");
  if (!strict.length) console.log("(none)");
  for (const r of strict) {
    console.log(
      `${r.name}\n  fair ${base.fair.toFixed(4)}→${r.fair.toFixed(4)} hit ${base.hit.toFixed(1)}→${r.hit.toFixed(1)} edge ${base.edge.toFixed(3)}→${r.edge.toFixed(3)} cash ${(base.cash * 100).toFixed(0)}→${(r.cash * 100).toFixed(0)}% dir ${base.dir}→${r.dir} yE+${r.edgePos}/${r.years}`,
    );
    console.log("  " + r.detail.join("  "));
  }

  const loose = results.filter(
    (r) =>
      r.name !== base.name &&
      r.fair > base.fair + 0.05 &&
      r.edge > base.edge + 0.01 &&
      r.dir >= 220 &&
      r.cash < 0.88 &&
      r.edgePos >= base.edgePos - 1 &&
      r.hitPos >= 5,
  );
  console.log("\n########## LOOSE BEATS ##########");
  for (const r of loose.sort((a, b) => b.fair - a.fair).slice(0, 10)) {
    console.log(
      `${r.name}: fair ${r.fair.toFixed(4)} hit ${r.hit.toFixed(1)} edge ${r.edge.toFixed(3)} cash ${(r.cash * 100).toFixed(0)}% dir ${r.dir} yE+${r.edgePos}`,
    );
  }

  const best = strict[0] ?? loose[0] ?? null;
  console.log("\n########## RECOMMENDED ##########");
  if (!best) console.log("Keep V16");
  else {
    console.log(`Ship: ${best.name}`);
    console.log(
      JSON.stringify(
        {
          name: best.name,
          thr: best.thr,
          hit: best.hit,
          edge: best.edge,
          cash: best.cash,
          dir: best.dir,
          fair: best.fair,
          edgePos: best.edgePos,
          hitPos: best.hitPos,
        },
        null,
        2,
      ),
    );
  }

  const fs = await import("fs");
  fs.writeFileSync(
    "scripts/.wacky-v16-plus-results.json",
    JSON.stringify({ base, top: results.slice(0, 15), strict, loose, best }, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
