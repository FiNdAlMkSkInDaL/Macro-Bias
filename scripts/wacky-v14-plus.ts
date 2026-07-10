/**
 * Stack ideas ON TOP of locked v14
 * (cosine + Mon + fade35 + overnight veto + low-vol flat + soft amp).
 * Product: next-session open→close.
 * Run: npx tsx scripts/wacky-v14-plus.ts
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

const THR = STRATEGY_RULES.scoreThreshold;
const RSI = 14;
const START = "2020-01-01";

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
  let edgePos = 0,
    hitPos = 0;
  const detail: string[] = [];
  for (const [y, ds] of [...by.entries()].sort()) {
    const s = summarize(ds);
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

  function neighbors(ti: number, features: string[], k = 5, decay?: number): Nb[] {
    const dec = decay ?? ANALOG_MODEL_SETTINGS.temporalDecayLambda;
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
      const distance = base * Math.exp(dec * gap);
      out.push({
        distance,
        weight: inverseDistanceWeight(distance, 0.05),
        f1: analog.f1,
        f3: analog.f3 ?? analog.f1,
        raw: 0.4 * analog.f1 + 0.6 * (analog.f3 ?? analog.f1),
      });
    }
    out.sort((a, b) => a.distance - b.distance);
    return out.slice(0, k);
  }

  function knn(nbs: Nb[]) {
    if (!nbs.length) return 0;
    const w = nbs.map((n) => n.weight);
    return tanhScore(
      0.4 * weightedMean(nbs.map((n) => n.f1), w) +
        0.6 * weightedMean(nbs.map((n) => n.f3), w),
    );
  }

  /** Full v14 pipeline. */
  function v14(ti: number, nbs: Nb[]) {
    const raws = nbs.map((n) => n.raw);
    let s = knn(nbs);
    s = applyLowNeighborVolFlat(s, raws);
    s = applyFadeBigDay(s, st[ti].ctc);
    s = applySoftOvernightAmp(s, st[ti].overnight, THR);
    s = applyOvernightVeto(s, st[ti].overnight, THR);
    if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
    return s;
  }

  type Idea = { name: string; fn: (ti: number) => number };
  const ideas: Idea[] = [
    { name: "V14 baseline", fn: (ti) => v14(ti, neighbors(ti, prodF)) },

    // K variants
    { name: "v14 K7", fn: (ti) => v14(ti, neighbors(ti, prodF, 7)) },
    { name: "v14 K3", fn: (ti) => v14(ti, neighbors(ti, prodF, 3)) },
    { name: "v14 K9", fn: (ti) => v14(ti, neighbors(ti, prodF, 9)) },
    { name: "v14 K6", fn: (ti) => v14(ti, neighbors(ti, prodF, 6)) },

    // low-vol threshold
    {
      name: "v14 lowvol thr 0.35",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        let s = knn(n);
        if (stdev(n.map((x) => x.raw)) < 0.35) s = 0;
        s = applyFadeBigDay(s, st[ti].ctc);
        s = applySoftOvernightAmp(s, st[ti].overnight, THR);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v14 lowvol thr 0.5",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        let s = knn(n);
        if (stdev(n.map((x) => x.raw)) < 0.5) s = 0;
        s = applyFadeBigDay(s, st[ti].ctc);
        s = applySoftOvernightAmp(s, st[ti].overnight, THR);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v14 shrink lowvol 0.5x not flat",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        let s = knn(n);
        if (stdev(n.map((x) => x.raw)) < 0.4) s = clampScore(s * 0.5);
        s = applyFadeBigDay(s, st[ti].ctc);
        s = applySoftOvernightAmp(s, st[ti].overnight, THR);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },

    // soft amp knobs
    {
      name: "v14 soft amp 1.25/0.6",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        let s = applyLowNeighborVolFlat(knn(n), n.map((x) => x.raw));
        s = applyFadeBigDay(s, st[ti].ctc);
        // custom amp
        const o = st[ti].overnight;
        if (s > THR && o > 0.15) s = clampScore(s * 1.25);
        else if (s < -THR && o < -0.15) s = clampScore(s * 1.25);
        else if (s > THR && o < -0.15) s = clampScore(s * 0.6);
        else if (s < -THR && o > 0.15) s = clampScore(s * 0.6);
        s = applyOvernightVeto(s, o, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v14 soft amp 1.1/0.8",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        let s = applyLowNeighborVolFlat(knn(n), n.map((x) => x.raw));
        s = applyFadeBigDay(s, st[ti].ctc);
        const o = st[ti].overnight;
        if (s > THR && o > 0.15) s = clampScore(s * 1.1);
        else if (s < -THR && o < -0.15) s = clampScore(s * 1.1);
        else if (s > THR && o < -0.15) s = clampScore(s * 0.8);
        else if (s < -THR && o > 0.15) s = clampScore(s * 0.8);
        s = applyOvernightVeto(s, o, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },

    // K7 combos (high fair earlier)
    {
      name: "v14 K7 + lowvol0.4 + softamp",
      fn: (ti) => v14(ti, neighbors(ti, prodF, 7)),
    },
    {
      name: "v14 K7 only no lowvol",
      fn: (ti) => {
        const n = neighbors(ti, prodF, 7);
        let s = knn(n);
        s = applyFadeBigDay(s, st[ti].ctc);
        s = applySoftOvernightAmp(s, st[ti].overnight, THR);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },

    // thr
    {
      name: "v14 thr25",
      fn: (ti) => {
        const s = v14(ti, neighbors(ti, prodF));
        return Math.abs(s) <= 25 ? 0 : s;
      },
    },
    {
      name: "v14 thr22",
      fn: (ti) => {
        const s = v14(ti, neighbors(ti, prodF));
        return Math.abs(s) <= 22 ? 0 : s;
      },
    },

    // calendar
    {
      name: "v14 skip Friday",
      fn: (ti) => {
        if (dow(st[ti].tradeDate) === 5) return 0;
        return v14(ti, neighbors(ti, prodF));
      },
    },
    {
      name: "v14 skip Fri + thr22",
      fn: (ti) => {
        if (dow(st[ti].tradeDate) === 5) return 0;
        const s = v14(ti, neighbors(ti, prodF));
        return Math.abs(s) <= 22 ? 0 : s;
      },
    },

    // features
    {
      name: "v14 + qqq5d",
      fn: (ti) => v14(ti, neighbors(ti, [...prodF, "qqq5d"])),
    },
    {
      name: "v14 + spy5d",
      fn: (ti) => v14(ti, neighbors(ti, [...prodF, "spy5d"])),
    },
    {
      name: "v14 drop uso",
      fn: (ti) =>
        v14(
          ti,
          neighbors(
            ti,
            prodF.filter((f) => f !== "usoMomentum"),
          ),
        ),
    },
    {
      name: "v14 drop cperGld",
      fn: (ti) =>
        v14(
          ti,
          neighbors(
            ti,
            prodF.filter((f) => f !== "cperGldRatio"),
          ),
        ),
    },
    {
      name: "v14 minimal3",
      fn: (ti) =>
        v14(ti, neighbors(ti, ["spyRsi", "vixMomentum", "hygTltRatio"])),
    },

    // decay
    {
      name: "v14 no decay",
      fn: (ti) => v14(ti, neighbors(ti, prodF, 5, 0)),
    },
    {
      name: "v14 heavy decay",
      fn: (ti) => v14(ti, neighbors(ti, prodF, 5, 0.002)),
    },

    // fade knobs
    {
      name: "v14 fade thr 1.2",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        let s = applyLowNeighborVolFlat(knn(n), n.map((x) => x.raw));
        if (Math.abs(st[ti].ctc) > 1.2) {
          s = clampScore(s * 0.3 - Math.sign(st[ti].ctc) * 35);
        }
        s = applySoftOvernightAmp(s, st[ti].overnight, THR);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v14 fade push 40",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        let s = applyLowNeighborVolFlat(knn(n), n.map((x) => x.raw));
        if (Math.abs(st[ti].ctc) > 1.5) {
          s = clampScore(s * 0.3 - Math.sign(st[ti].ctc) * 40);
        }
        s = applySoftOvernightAmp(s, st[ti].overnight, THR);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v14 fade scale 0.2 push 35",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        let s = applyLowNeighborVolFlat(knn(n), n.map((x) => x.raw));
        if (Math.abs(st[ti].ctc) > 1.5) {
          s = clampScore(s * 0.2 - Math.sign(st[ti].ctc) * 35);
        }
        s = applySoftOvernightAmp(s, st[ti].overnight, THR);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },

    // overnight veto thr
    {
      name: "v14 veto thr 0.25",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        let s = applyLowNeighborVolFlat(knn(n), n.map((x) => x.raw));
        s = applyFadeBigDay(s, st[ti].ctc);
        s = applySoftOvernightAmp(s, st[ti].overnight, THR);
        const o = st[ti].overnight;
        if (s > THR && o < -0.25) s = 0;
        if (s < -THR && o > 0.25) s = 0;
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v14 veto thr 0.4",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        let s = applyLowNeighborVolFlat(knn(n), n.map((x) => x.raw));
        s = applyFadeBigDay(s, st[ti].ctc);
        s = applySoftOvernightAmp(s, st[ti].overnight, THR);
        const o = st[ti].overnight;
        if (s > THR && o < -0.4) s = 0;
        if (s < -THR && o > 0.4) s = 0;
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },

    // blend 1d heavier after all
    {
      name: "v14 blend 0.55/0.45",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        const w = n.map((x) => x.weight);
        let s = tanhScore(
          0.55 * weightedMean(n.map((x) => x.f1), w) +
            0.45 * weightedMean(n.map((x) => x.f3), w),
        );
        s = applyLowNeighborVolFlat(
          s,
          n.map((x) => 0.55 * x.f1 + 0.45 * x.f3),
        );
        s = applyFadeBigDay(s, st[ti].ctc);
        s = applySoftOvernightAmp(s, st[ti].overnight, THR);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v14 blend 0.3/0.7",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        const w = n.map((x) => x.weight);
        let s = tanhScore(
          0.3 * weightedMean(n.map((x) => x.f1), w) +
            0.7 * weightedMean(n.map((x) => x.f3), w),
        );
        s = applyLowNeighborVolFlat(
          s,
          n.map((x) => 0.3 * x.f1 + 0.7 * x.f3),
        );
        s = applyFadeBigDay(s, st[ti].ctc);
        s = applySoftOvernightAmp(s, st[ti].overnight, THR);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },

    // kitchen sink of near-wins
    {
      name: "v14 K7 + thr22",
      fn: (ti) => {
        const s = v14(ti, neighbors(ti, prodF, 7));
        return Math.abs(s) <= 22 ? 0 : s;
      },
    },
    {
      name: "v14 K7 + fade push 40",
      fn: (ti) => {
        const n = neighbors(ti, prodF, 7);
        let s = applyLowNeighborVolFlat(knn(n), n.map((x) => x.raw));
        if (Math.abs(st[ti].ctc) > 1.5) {
          s = clampScore(s * 0.3 - Math.sign(st[ti].ctc) * 40);
        }
        s = applySoftOvernightAmp(s, st[ti].overnight, THR);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v14 + 5dMR 90/10 after pipeline",
      fn: (ti) => {
        let s = v14(ti, neighbors(ti, prodF));
        if (s === 0) return 0;
        const m = tanhScore(-st[ti].vector.spy5d / 3);
        return clampScore(0.9 * s + 0.1 * m);
      },
    },
    {
      name: "v14 sign-vote boost if unan",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        let s = v14(ti, n);
        if (s === 0) return 0;
        const signs = n.map((x) => Math.sign(x.raw));
        const allUp = signs.every((x) => x > 0);
        const allDn = signs.every((x) => x < 0);
        if (allUp && s > 0) s = clampScore(s * 1.2);
        if (allDn && s < 0) s = clampScore(s * 1.2);
        return s;
      },
    },
    {
      name: "v14 require 4/5 sign agree",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        let s = v14(ti, n);
        if (s === 0) return 0;
        const sign = Math.sign(s);
        const agree = n.filter((x) => Math.sign(x.raw) === sign).length;
        if (agree < 4) return 0;
        return s;
      },
    },
  ];

  console.log(`Points=${st.length} start=${st[start]?.tradeDate}\n`);
  type Row = {
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
    detail: string[];
  };
  const results: Row[] = [];

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
      detail: y.detail,
    });
    const mark =
      s.fair > 1.45 ? " ★★" : s.fair > 1.36 ? " ★" : s.fair > 1.3 ? " +" : "";
    console.log(
      `${idea.name.padEnd(36)} hit=${s.hit.toFixed(1)}% edge=${(s.edge >= 0 ? "+" : "") + s.edge.toFixed(3)} cash=${(s.cash * 100).toFixed(0)}% dir=${String(s.dir).padStart(4)} fair=${s.fair.toFixed(4)} yE+${y.edgePos}/${y.years} yH+${y.hitPos}/${y.years}${mark}`,
    );
  }

  const base = results.find((r) => r.name === "V14 baseline")!;
  results.sort((a, b) => b.fair - a.fair);

  console.log("\n########## TOP 12 ##########");
  for (const r of results.slice(0, 12)) {
    console.log(
      `${r.fair.toFixed(4)} hit=${r.hit.toFixed(1)} edge=${r.edge >= 0 ? "+" : ""}${r.edge.toFixed(3)} cash=${(r.cash * 100).toFixed(0)}% dir=${r.dir} yE+${r.edgePos} yH+${r.hitPos}  ${r.name}`,
    );
  }

  const strict = results.filter(
    (r) =>
      r.name !== base.name &&
      r.fair > base.fair + 0.04 &&
      r.edge > base.edge &&
      r.dir >= 250 &&
      r.cash < 0.88 &&
      r.edgePos >= base.edgePos,
  );
  strict.sort((a, b) => b.fair - a.fair);

  console.log("\n########## STRICT BEATS V14 (fair+0.04, edge+, yE+≥base, dir≥250, cash<88%) ##########");
  if (!strict.length) console.log("(none)");
  for (const r of strict) {
    console.log(
      `${r.name}\n  fair ${base.fair.toFixed(4)}→${r.fair.toFixed(4)} hit ${base.hit.toFixed(1)}→${r.hit.toFixed(1)} edge ${base.edge.toFixed(3)}→${r.edge.toFixed(3)} cash ${(base.cash * 100).toFixed(0)}→${(r.cash * 100).toFixed(0)}% dir ${base.dir}→${r.dir} yE+${r.edgePos}/${r.years}`,
    );
    console.log("  " + r.detail.join("  "));
  }

  // Looser: allow yE+ one less if fair lift is large
  const loose = results.filter(
    (r) =>
      r.name !== base.name &&
      r.fair > base.fair + 0.06 &&
      r.edge > base.edge + 0.02 &&
      r.dir >= 280 &&
      r.cash < 0.86 &&
      r.edgePos >= base.edgePos - 1 &&
      r.hitPos >= 5,
  );
  console.log("\n########## LOOSE BEATS (fair+0.06, allow -1 edge year) ##########");
  for (const r of loose.sort((a, b) => b.fair - a.fair).slice(0, 8)) {
    console.log(
      `${r.name}: fair ${r.fair.toFixed(4)} hit ${r.hit.toFixed(1)} edge ${r.edge.toFixed(3)} cash ${(r.cash * 100).toFixed(0)}% dir ${r.dir} yE+${r.edgePos}`,
    );
  }

  const best = strict[0] ?? loose[0] ?? null;
  console.log("\n########## RECOMMENDED ##########");
  if (!best) console.log("Keep V14");
  else {
    console.log(`Ship: ${best.name}`);
    console.log(
      JSON.stringify(
        {
          name: best.name,
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
    "scripts/.wacky-v14-plus-results.json",
    JSON.stringify({ base, top: results.slice(0, 15), strict, loose, best }, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
