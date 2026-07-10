/**
 * Stack leftover ideas ON TOP of locked v11
 * (cosine + Mon skip + fade-big-day).
 * Product metric: next-session open→close.
 * Run: npx tsx scripts/wacky-v11-plus.ts
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";
import {
  ANALOG_MODEL_SETTINGS,
  STOCKS_KNN_FEATURE_KEYS,
  STOCKS_LEVEL_FEATURES_FOR_PERCENTILE,
} from "../src/lib/macro-bias/constants";
import { applyFadeBigDay } from "../src/lib/macro-bias/calculate-daily-bias";
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
    opts: {
      k?: number;
      decay?: number;
      minAgeY?: number | null;
      maxAgeY?: number | null;
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
      if (analog.f1 == null) continue;
      const gap = daysBetween(today.tradeDate, analog.tradeDate);
      if (gap < 5) continue;
      if (opts.minAgeY != null && gap < opts.minAgeY * 365) continue;
      if (opts.maxAgeY != null && gap > opts.maxAgeY * 365) continue;
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

  /** Full v11 base: cosine KNN → fade big day → Mon zero */
  function v11Base(ti: number, rawKnn: number) {
    let s = applyFadeBigDay(rawKnn, st[ti].ctc);
    if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
    return s;
  }

  function overnightAmp(score: number, overnight: number) {
    if (score > THR && overnight > 0.15) return clampScore(score * 1.25);
    if (score < -THR && overnight < -0.15) return clampScore(score * 1.25);
    if (score > THR && overnight < -0.15) return clampScore(score * 0.5);
    if (score < -THR && overnight > 0.15) return clampScore(score * 0.5);
    return score;
  }

  function overnightVeto(score: number, overnight: number) {
    if (score > THR && overnight < -0.3) return 0;
    if (score < -THR && overnight > 0.3) return 0;
    return score;
  }

  function overnightAgree(score: number, overnight: number) {
    const o = tanhScore(overnight * 2);
    if (score > THR && o > 0) return clampScore((score + o) / 2);
    if (score < -THR && o < 0) return clampScore((score + o) / 2);
    return 0;
  }

  type Idea = { name: string; fn: (ti: number) => number };
  const ideas: Idea[] = [
    {
      name: "V11 baseline",
      fn: (ti) => v11Base(ti, knn(neighbors(ti, prodF))),
    },
    // --- overnight family ---
    {
      name: "v11 + overnight amp",
      fn: (ti) => {
        const k = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        const s = overnightAmp(k, st[ti].overnight);
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : s;
      },
    },
    {
      name: "v11 + overnight veto",
      fn: (ti) => {
        const k = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        const s = overnightVeto(k, st[ti].overnight);
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : s;
      },
    },
    {
      name: "v11 + overnight agree only",
      fn: (ti) => {
        const k = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        const s = overnightAgree(k, st[ti].overnight);
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : s;
      },
    },
    {
      name: "v11 + overnight 70/30",
      fn: (ti) => {
        const k = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        const o = tanhScore(st[ti].overnight * 2);
        const s = clampScore(0.7 * k + 0.3 * o);
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : s;
      },
    },
    {
      name: "v11 + overnight 80/20",
      fn: (ti) => {
        const k = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        const o = tanhScore(st[ti].overnight * 2);
        const s = clampScore(0.8 * k + 0.2 * o);
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : s;
      },
    },
    {
      name: "v11 + overnight sign match",
      fn: (ti) => {
        let k = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        const oSign = Math.sign(st[ti].overnight);
        if (Math.abs(k) > THR && oSign !== 0 && Math.sign(k) !== oSign) k = 0;
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : k;
      },
    },
    // --- calendar ---
    {
      name: "v11 + skip Friday",
      fn: (ti) => {
        if (dow(st[ti].tradeDate) === 5) return 0;
        return v11Base(ti, knn(neighbors(ti, prodF)));
      },
    },
    {
      name: "v11 + overnight amp + skip Fri",
      fn: (ti) => {
        if (dow(st[ti].tradeDate) === 5) return 0;
        const k = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        const s = overnightAmp(k, st[ti].overnight);
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : s;
      },
    },
    // --- K / decay ---
    {
      name: "v11 K7",
      fn: (ti) => v11Base(ti, knn(neighbors(ti, prodF, { k: 7 }))),
    },
    {
      name: "v11 K7 + overnight amp",
      fn: (ti) => {
        const k = applyFadeBigDay(knn(neighbors(ti, prodF, { k: 7 })), st[ti].ctc);
        const s = overnightAmp(k, st[ti].overnight);
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : s;
      },
    },
    {
      name: "v11 no decay",
      fn: (ti) => v11Base(ti, knn(neighbors(ti, prodF, { decay: 0 }))),
    },
    {
      name: "v11 no decay + overnight 70/30",
      fn: (ti) => {
        const k = applyFadeBigDay(knn(neighbors(ti, prodF, { decay: 0 })), st[ti].ctc);
        const o = tanhScore(st[ti].overnight * 2);
        const s = clampScore(0.7 * k + 0.3 * o);
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : s;
      },
    },
    {
      name: "v11 no decay + overnight amp",
      fn: (ti) => {
        const k = applyFadeBigDay(knn(neighbors(ti, prodF, { decay: 0 })), st[ti].ctc);
        const s = overnightAmp(k, st[ti].overnight);
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : s;
      },
    },
    // --- dispersion ---
    {
      name: "v11 flat if low neighbor vol",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        if (stdev(n.map((x) => x.raw)) < 0.4) return 0;
        return v11Base(ti, knn(n));
      },
    },
    {
      name: "v11 flat if high neighbor vol",
      fn: (ti) => {
        const n = neighbors(ti, prodF);
        if (stdev(n.map((x) => x.raw)) > 1.0) return 0;
        return v11Base(ti, knn(n));
      },
    },
    // --- features ---
    {
      name: "v11 + hygTltMom feature",
      fn: (ti) => {
        // use qqq5d as proxy extra if hygTltMom not precomputed — use overnight in knn instead
        return v11Base(ti, knn(neighbors(ti, [...prodF, "overnight"])));
      },
    },
    {
      name: "v11 + qqq5d feature",
      fn: (ti) => v11Base(ti, knn(neighbors(ti, [...prodF, "qqq5d"]))),
    },
    {
      name: "v11 + spy5d feature",
      fn: (ti) => v11Base(ti, knn(neighbors(ti, [...prodF, "spy5d"]))),
    },
    {
      name: "v11 drop uso",
      fn: (ti) =>
        v11Base(
          ti,
          knn(neighbors(ti, prodF.filter((f) => f !== "usoMomentum"))),
        ),
    },
    // --- thr / size ---
    {
      name: "v11 thr30 soft (score zero if |s|<=30)",
      fn: (ti) => {
        const s = v11Base(ti, knn(neighbors(ti, prodF)));
        return Math.abs(s) <= 30 ? 0 : s;
      },
    },
    {
      name: "v11 + 5dMR 80/20",
      fn: (ti) => {
        const k = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        const m = tanhScore(-st[ti].vector.spy5d / 3);
        const s = clampScore(0.8 * k + 0.2 * m);
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : s;
      },
    },
    {
      name: "v11 + overnight amp + 5dMR 70/15/15",
      fn: (ti) => {
        let k = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        k = overnightAmp(k, st[ti].overnight);
        const m = tanhScore(-st[ti].vector.spy5d / 3);
        const o = tanhScore(st[ti].overnight * 2);
        // already amped; mild MR blend
        const s = clampScore(0.85 * k + 0.15 * m);
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : s;
      },
    },
    // --- dual pool ---
    {
      name: "v11 dual pool old/new 50/50",
      fn: (ti) => {
        const oldN = neighbors(ti, prodF, { minAgeY: 3, k: 5 });
        const newN = neighbors(ti, prodF, { maxAgeY: 3, k: 5 });
        const raw =
          oldN.length && newN.length
            ? clampScore(0.5 * knn(oldN) + 0.5 * knn(newN))
            : knn(neighbors(ti, prodF));
        return v11Base(ti, raw);
      },
    },
    {
      name: "v11 dual + overnight amp",
      fn: (ti) => {
        const oldN = neighbors(ti, prodF, { minAgeY: 3, k: 5 });
        const newN = neighbors(ti, prodF, { maxAgeY: 3, k: 5 });
        let raw =
          oldN.length && newN.length
            ? clampScore(0.5 * knn(oldN) + 0.5 * knn(newN))
            : knn(neighbors(ti, prodF));
        raw = applyFadeBigDay(raw, st[ti].ctc);
        raw = overnightAmp(raw, st[ti].overnight);
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : raw;
      },
    },
    // --- opposite VIX ---
    {
      name: "v11 opposite VIX regime",
      fn: (ti) =>
        v11Base(
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
    // --- combo kitchen sink of winners ---
    {
      name: "v11 + ON amp + noDecay",
      fn: (ti) => {
        let k = knn(neighbors(ti, prodF, { decay: 0 }));
        k = applyFadeBigDay(k, st[ti].ctc);
        k = overnightAmp(k, st[ti].overnight);
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : k;
      },
    },
    {
      name: "v11 + ON veto + skip Fri",
      fn: (ti) => {
        if (dow(st[ti].tradeDate) === 5) return 0;
        let k = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        k = overnightVeto(k, st[ti].overnight);
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : k;
      },
    },
    {
      name: "v11 + ON amp softer (1.15/0.7)",
      fn: (ti) => {
        let k = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        const o = st[ti].overnight;
        if (k > THR && o > 0.15) k = clampScore(k * 1.15);
        else if (k < -THR && o < -0.15) k = clampScore(k * 1.15);
        else if (k > THR && o < -0.15) k = clampScore(k * 0.7);
        else if (k < -THR && o > 0.15) k = clampScore(k * 0.7);
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : k;
      },
    },
    {
      name: "v11 + ON amp harder (1.4/0.35)",
      fn: (ti) => {
        let k = applyFadeBigDay(knn(neighbors(ti, prodF)), st[ti].ctc);
        const o = st[ti].overnight;
        if (k > THR && o > 0.15) k = clampScore(k * 1.4);
        else if (k < -THR && o < -0.15) k = clampScore(k * 1.4);
        else if (k > THR && o < -0.15) k = clampScore(k * 0.35);
        else if (k < -THR && o > 0.15) k = clampScore(k * 0.35);
        return isUsEquityMonday(st[ti].tradeDate) ? 0 : k;
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
    const mark = s.fair > 1.0 ? " ★★" : s.fair > 0.9 ? " ★" : s.fair > 0.87 ? " +" : "";
    console.log(
      `${idea.name.padEnd(40)} hit=${s.hit.toFixed(1)}% edge=${(s.edge >= 0 ? "+" : "") + s.edge.toFixed(3)} cash=${(s.cash * 100).toFixed(0)}% dir=${String(s.dir).padStart(4)} fair=${s.fair.toFixed(4)} yE+${y.edgePos}/${y.years} yH+${y.hitPos}/${y.years}${mark}`,
    );
  }

  const base = results.find((r) => r.name === "V11 baseline")!;
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
      r.fair > base.fair + 0.05 &&
      r.edge > base.edge &&
      r.dir >= 300 &&
      r.cash < 0.85 &&
      r.edgePos >= 5,
  );
  console.log("\n########## STRICT BEATS V11 ##########");
  if (!strict.length) console.log("(none)");
  for (const r of strict) {
    console.log(
      `${r.name}\n  fair ${base.fair.toFixed(4)}→${r.fair.toFixed(4)} hit ${base.hit.toFixed(1)}→${r.hit.toFixed(1)} edge ${base.edge.toFixed(3)}→${r.edge.toFixed(3)} cash ${(base.cash * 100).toFixed(0)}→${(r.cash * 100).toFixed(0)}% dir ${base.dir}→${r.dir} yE+${r.edgePos}/${r.years} yH+${r.hitPos}/${r.years}`,
    );
    console.log("  " + r.detail.join("  "));
  }

  const best = strict[0] ?? null;
  console.log("\n########## RECOMMENDED ##########");
  if (!best) {
    console.log("Keep V11 — nothing clear enough to ship.");
  } else {
    console.log(`Ship candidate: ${best.name}`);
    console.log(JSON.stringify(best, null, 2));
  }

  const fs = await import("fs");
  fs.writeFileSync(
    "scripts/.wacky-v11-plus-results.json",
    JSON.stringify({ base, top: results.slice(0, 15), strict, best }, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
