/**
 * Stack ideas ON TOP of locked v12
 * (cosine + Mon skip + fade-big-day + overnight veto).
 * Product metric: next-session open→close.
 * Run: npx tsx scripts/wacky-v12-plus.ts
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
} from "../src/lib/macro-bias/calculate-daily-bias";
import {
  inverseDistanceWeight,
  stationarizeLevelFeatures,
  weightedMean,
} from "../src/lib/signal";
import { isUsEquityMonday } from "../src/utils/knn";

const BACKTEST_START = "2020-01-01";
const RSI = 14;
const THR = STRATEGY_RULES.scoreThreshold;

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
  const detail: string[] = [];
  for (const [y, ds] of years) {
    const s = summarize(ds);
    if (s.edge > 0) edgePos++;
    if (s.hit > 50) hitPos++;
    detail.push(
      `${y}:${s.hit.toFixed(0)}%/e=${s.edge >= 0 ? "+" : ""}${s.edge.toFixed(2)}/n=${s.dir}`,
    );
  }
  return { years: years.length, edgePos, hitPos, detail };
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
        overnight: spy.open > 0 ? pct(prev.close, spy.open) : 0,
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
  const start = st.findIndex((p) => p.tradeDate >= BACKTEST_START);
  const prodF = [...STOCKS_KNN_FEATURE_KEYS];

  type Nb = { distance: number; weight: number; f1: number; f3: number; raw: number };

  function neighbors(
    ti: number,
    features: string[],
    opts: { k?: number; decay?: number } = {},
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

  function knn(nbs: Nb[]) {
    if (!nbs.length) return 0;
    const w = nbs.map((n) => n.weight);
    return tanhScore(
      0.4 * weightedMean(nbs.map((n) => n.f1), w) +
        0.6 * weightedMean(nbs.map((n) => n.f3), w),
    );
  }

  /** Full v12 pipeline ending (before optional extra layers). */
  function v12Core(ti: number, rawKnn: number) {
    let s = applyFadeBigDay(rawKnn, st[ti].ctc);
    s = applyOvernightVeto(s, st[ti].overnight, THR);
    if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
    return s;
  }

  function softAmp(score: number, overnight: number, up = 1.15, down = 0.7) {
    if (score > THR && overnight > 0.15) return clampScore(score * up);
    if (score < -THR && overnight < -0.15) return clampScore(score * up);
    if (score > THR && overnight < -0.15) return clampScore(score * down);
    if (score < -THR && overnight > 0.15) return clampScore(score * down);
    return score;
  }

  function hardAmp(score: number, overnight: number) {
    return softAmp(score, overnight, 1.25, 0.5);
  }

  type Idea = { name: string; fn: (ti: number) => number };
  const ideas: Idea[] = [
    {
      name: "V12 baseline",
      fn: (ti) => v12Core(ti, knn(neighbors(ti, prodF))),
    },
    // --- shelf items ---
    {
      name: "v12 + flat low neighbor vol",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        if (stdev(n.map((x) => x.raw)) < 0.4) return 0;
        return v12Core(ti, knn(n));
      },
    },
    {
      name: "v12 + flat low vol thr0.5",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        if (stdev(n.map((x) => x.raw)) < 0.5) return 0;
        return v12Core(ti, knn(n));
      },
    },
    {
      name: "v12 + flat low vol thr0.3",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        if (stdev(n.map((x) => x.raw)) < 0.3) return 0;
        return v12Core(ti, knn(n));
      },
    },
    {
      name: "v12 + soft ON amp after veto",
      fn: (ti) => {
        // amp only when veto didn't zero — applied before veto on faded score
        let s = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        s = softAmp(s, st[ti].overnight);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v12 + soft amp BEFORE veto",
      fn: (ti) => {
        let s = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        s = softAmp(s, st[ti].overnight, 1.15, 0.7);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v12 + hard amp then veto",
      fn: (ti) => {
        let s = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        s = hardAmp(s, st[ti].overnight);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v12 replace veto with 70/30 ON",
      fn: (ti) => {
        let s = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        const o = tanhScore(st[ti].overnight * 2);
        s = clampScore(0.7 * s + 0.3 * o);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v12 veto thr 0.2 (tighter)",
      fn: (ti) => {
        let s = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        const o = st[ti].overnight;
        if (s > THR && o < -0.2) s = 0;
        if (s < -THR && o > 0.2) s = 0;
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v12 veto thr 0.5 (looser)",
      fn: (ti) => {
        let s = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        const o = st[ti].overnight;
        if (s > THR && o < -0.5) s = 0;
        if (s < -THR && o > 0.5) s = 0;
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    // --- calendar ---
    {
      name: "v12 + skip Friday",
      fn: (ti) => {
        if (dow(st[ti].tradeDate) === 5) return 0;
        return v12Core(ti, knn(neighbors(ti, prodF)));
      },
    },
    {
      name: "v12 + low vol + skip Fri",
      fn: (ti) => {
        if (dow(st[ti].tradeDate) === 5) return 0;
        const n = neighbors(ti, prodF);
        if (stdev(n.map((x) => x.raw)) < 0.4) return 0;
        return v12Core(ti, knn(n));
      },
    },
    // --- K / features ---
    {
      name: "v12 K7",
      fn: (ti) => v12Core(ti, knn(neighbors(ti, prodF, { k: 7 }))),
    },
    {
      name: "v12 K7 + low vol",
      fn: (ti) => {
        const n = neighbors(ti, prodF, { k: 7 });
        if (stdev(n.map((x) => x.raw)) < 0.4) return 0;
        return v12Core(ti, knn(n));
      },
    },
    {
      name: "v12 + qqq5d feat",
      fn: (ti) => v12Core(ti, knn(neighbors(ti, [...prodF, "qqq5d"]))),
    },
    {
      name: "v12 drop uso",
      fn: (ti) =>
        v12Core(
          ti,
          knn(neighbors(ti, prodF.filter((f) => f !== "usoMomentum"))),
        ),
    },
    {
      name: "v12 + 5dMR 85/15",
      fn: (ti) => {
        let s = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        const m = tanhScore(-st[ti].vector.spy5d / 3);
        s = clampScore(0.85 * s + 0.15 * m);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    // --- thr ---
    {
      name: "v12 thr25",
      fn: (ti) => {
        const s = v12Core(ti, knn(neighbors(ti, prodF)));
        return Math.abs(s) <= 25 ? 0 : s;
      },
    },
    {
      name: "v12 thr30",
      fn: (ti) => {
        const s = v12Core(ti, knn(neighbors(ti, prodF)));
        return Math.abs(s) <= 30 ? 0 : s;
      },
    },
    {
      name: "v12 low vol + thr25",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        if (stdev(n.map((x) => x.raw)) < 0.4) return 0;
        const s = v12Core(ti, knn(n));
        return Math.abs(s) <= 25 ? 0 : s;
      },
    },
    {
      name: "v12 soft amp + low vol",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        if (stdev(n.map((x) => x.raw)) < 0.4) return 0;
        let s = applyFadeBigDay(knn(n), st[ti].ctc);
        s = softAmp(s, st[ti].overnight);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v12 low vol thr0.4 + soft amp",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        if (stdev(n.map((x) => x.raw)) < 0.4) return 0;
        let s = applyFadeBigDay(knn(n), st[ti].ctc);
        s = softAmp(s, st[ti].overnight, 1.15, 0.7);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    // --- shrink by dispersion instead of hard flat ---
    {
      name: "v12 shrink by neighbor vol",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        let s = knn(n);
        const sd = stdev(n.map((x) => x.raw));
        // low dispersion → shrink (consensus may be noise/overfit)
        const shrink = sd < 0.4 ? 0.5 : sd < 0.6 ? 0.75 : 1;
        s = clampScore(s * shrink);
        s = applyFadeBigDay(s, st[ti].ctc);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v12 boost high neighbor vol",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        let s = knn(n);
        const sd = stdev(n.map((x) => x.raw));
        if (sd > 0.8) s = clampScore(s * 1.15);
        s = applyFadeBigDay(s, st[ti].ctc);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    // --- fade threshold sensitivity ---
    {
      name: "v12 fade thr 1.0",
      fn: (ti) => {
        let s = knn(neighbors(ti, prodF));
        if (Math.abs(st[ti].ctc) > 1.0) {
          s = clampScore(s * 0.3 - Math.sign(st[ti].ctc) * 25);
        }
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v12 fade thr 2.0",
      fn: (ti) => {
        let s = knn(neighbors(ti, prodF));
        if (Math.abs(st[ti].ctc) > 2.0) {
          s = clampScore(s * 0.3 - Math.sign(st[ti].ctc) * 25);
        }
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    {
      name: "v12 fade push 35",
      fn: (ti) => {
        let s = knn(neighbors(ti, prodF));
        if (Math.abs(st[ti].ctc) > 1.5) {
          s = clampScore(s * 0.3 - Math.sign(st[ti].ctc) * 35);
        }
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return s;
      },
    },
    // kitchen sink of top shelf
    {
      name: "v12 low vol + soft amp + thr25",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        if (stdev(n.map((x) => x.raw)) < 0.4) return 0;
        let s = applyFadeBigDay(knn(n), st[ti].ctc);
        s = softAmp(s, st[ti].overnight);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return Math.abs(s) <= 25 ? 0 : s;
      },
    },
    {
      name: "v12 no decay + low vol",
      fn: (ti) => {
        const n = neighbors(ti, prodF, { decay: 0 });
        if (stdev(n.map((x) => x.raw)) < 0.4) return 0;
        return v12Core(ti, knn(n));
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
    const mark = s.fair > 1.2 ? " ★★" : s.fair > 1.11 ? " ★" : s.fair > 1.05 ? " +" : "";
    console.log(
      `${idea.name.padEnd(40)} hit=${s.hit.toFixed(1)}% edge=${(s.edge >= 0 ? "+" : "") + s.edge.toFixed(3)} cash=${(s.cash * 100).toFixed(0)}% dir=${String(s.dir).padStart(4)} fair=${s.fair.toFixed(4)} yE+${y.edgePos}/${y.years} yH+${y.hitPos}/${y.years}${mark}`,
    );
  }

  const base = results.find((r) => r.name === "V12 baseline")!;
  results.sort((a, b) => b.fair - a.fair);

  console.log("\n########## TOP 12 ##########");
  for (const r of results.slice(0, 12)) {
    console.log(
      `${r.fair.toFixed(4)} hit=${r.hit.toFixed(1)} edge=${r.edge >= 0 ? "+" : ""}${r.edge.toFixed(3)} cash=${(r.cash * 100).toFixed(0)}% dir=${r.dir} yE+${r.edgePos} yH+${r.hitPos}  ${r.name}`,
    );
  }

  // Prefer activity: cash < 85%, dir >= 250, fair lift, edge lift, year stability
  const strict = results.filter(
    (r) =>
      r.name !== base.name &&
      r.fair > base.fair + 0.04 &&
      r.edge > base.edge &&
      r.dir >= 250 &&
      r.cash < 0.88 &&
      r.edgePos >= base.edgePos,
  );
  strict.sort((a, b) => {
    // Prefer higher fair, then more activity (lower cash), then more edge+ years
    if (Math.abs(b.fair - a.fair) > 0.02) return b.fair - a.fair;
    if (a.cash !== b.cash) return a.cash - b.cash;
    return b.edgePos - a.edgePos;
  });

  console.log("\n########## STRICT BEATS V12 ##########");
  if (!strict.length) console.log("(none)");
  for (const r of strict) {
    console.log(
      `${r.name}\n  fair ${base.fair.toFixed(4)}→${r.fair.toFixed(4)} hit ${base.hit.toFixed(1)}→${r.hit.toFixed(1)} edge ${base.edge.toFixed(3)}→${r.edge.toFixed(3)} cash ${(base.cash * 100).toFixed(0)}→${(r.cash * 100).toFixed(0)}% dir ${base.dir}→${r.dir} yE+${r.edgePos}/${r.years} yH+${r.hitPos}/${r.years}`,
    );
    console.log("  " + r.detail.join("  "));
  }

  // Product-friendly: also list high-activity beaters (cash not much worse)
  const active = results.filter(
    (r) =>
      r.name !== base.name &&
      r.fair > base.fair + 0.02 &&
      r.edge >= base.edge - 0.01 &&
      r.dir >= 400 &&
      r.cash < base.cash + 0.05 &&
      r.edgePos >= 5,
  );
  console.log("\n########## HIGH-ACTIVITY IMPROVERS (dir≥400, cash≤v12+5pp) ##########");
  if (!active.length) console.log("(none)");
  for (const r of active.sort((a, b) => b.fair - a.fair)) {
    console.log(
      `${r.name}: fair ${r.fair.toFixed(4)} hit ${r.hit.toFixed(1)} edge ${r.edge.toFixed(3)} cash ${(r.cash * 100).toFixed(0)}% dir ${r.dir}`,
    );
  }

  const best = strict[0] ?? null;
  console.log("\n########## RECOMMENDED ##########");
  if (!best) {
    console.log("Keep V12 — nothing clear enough to ship.");
  } else {
    console.log(`Ship candidate: ${best.name}`);
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
    "scripts/.wacky-v12-plus-results.json",
    JSON.stringify({ base, top: results.slice(0, 15), strict, active, best }, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
