/**
 * Quick stacks on locked v15. Run: npx tsx scripts/wacky-v15-quick.ts
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
const W1 = ANALOG_MODEL_SETTINGS.oneDayBlendWeight;
const W3 = ANALOG_MODEL_SETTINGS.threeDayBlendWeight;

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

function summarize(days: Array<{ score: number; nextOtc: number | null; date: string }>) {
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
  const by = new Map<string, typeof days>();
  for (const d of days) {
    if (d.nextOtc == null) continue;
    const y = d.date.slice(0, 4);
    if (!by.has(y)) by.set(y, []);
    by.get(y)!.push(d);
  }
  let edgePos = 0,
    hitPos = 0;
  for (const [, ds] of by) {
    let ddir = 0,
      dh = 0;
    const L: number[] = [],
      S: number[] = [];
    for (const d of ds) {
      if (Math.abs(d.score) <= THR || d.nextOtc == null) continue;
      ddir++;
      const long = d.score > 0;
      if ((long && d.nextOtc >= 0) || (!long && d.nextOtc <= 0)) dh++;
      if (long) L.push(d.nextOtc);
      else S.push(d.nextOtc);
    }
    const e = L.length && S.length ? avg(L) - avg(S) : 0;
    if (e > 0) edgePos++;
    if (ddir && dh / ddir > 0.5) hitPos++;
  }
  return {
    hit,
    edge,
    whenIn,
    cash: cashR,
    dir,
    fair: fairObj(hit, edge, whenIn, cashR),
    edgePos,
    hitPos,
    years: by.size,
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
    ctc: number;
    overnight: number;
    f1: number | null;
    f3: number | null;
    nextOtc: number | null;
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
      overnight: spy.open > 0 ? pct(prev.close, spy.open) : 0,
      f1: n1 ? pct(spy.close, n1.close) : null,
      f3: n3 ? pct(spy.close, n3.close) : null,
      nextOtc: n1 && n1.open > 0 ? pct(n1.open, n1.close) : null,
    });
  }
  const st = stationarizeLevelFeatures(pts, STOCKS_LEVEL_FEATURES_FOR_PERCENTILE, {
    window: ANALOG_MODEL_SETTINGS.percentileWindowSessions,
    minHistory: ANALOG_MODEL_SETTINGS.percentileMinHistorySessions,
  }) as P[];
  const start = st.findIndex((p) => p.tradeDate >= START);
  const feats = [...STOCKS_KNN_FEATURE_KEYS];

  type Nb = { distance: number; weight: number; f1: number; f3: number; raw: number };
  function neighbors(ti: number, k = 5, decay = ANALOG_MODEL_SETTINGS.temporalDecayLambda): Nb[] {
    const today = st[ti];
    const pool = st.slice(0, ti);
    const means: Record<string, number> = {};
    const stds: Record<string, number> = {};
    for (const f of feats) {
      const vals = pool.map((p) => p.vector[f]);
      const m = avg(vals);
      means[f] = m;
      stds[f] = Math.sqrt(avg(vals.map((v) => (v - m) ** 2))) || 1;
    }
    const tz = feats.map((f) => (today.vector[f] - means[f]) / stds[f]);
    const out: Nb[] = [];
    for (const analog of pool) {
      if (analog.f1 == null) continue;
      const gap = daysBetween(today.tradeDate, analog.tradeDate);
      if (gap < 5) continue;
      const az = feats.map((f) => (analog.vector[f] - means[f]) / stds[f]);
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
      const dist = base * Math.exp(decay * gap);
      out.push({
        distance: dist,
        weight: inverseDistanceWeight(dist, 0.05),
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
  function v15(ti: number, nbs: Nb[]) {
    let s = knn(nbs);
    s = applyLowNeighborVolFlat(s, nbs.map((n) => n.raw));
    s = applyFadeBigDay(s, st[ti].ctc);
    s = applySoftOvernightAmp(s, st[ti].overnight, THR);
    s = applyOvernightVeto(s, st[ti].overnight, THR);
    if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
    return s;
  }

  const ideas: Array<{ name: string; fn: (ti: number) => number }> = [
    { name: "V15 base", fn: (ti) => v15(ti, neighbors(ti)) },
    {
      name: "v15 thr22",
      fn: (ti) => {
        const s = v15(ti, neighbors(ti));
        return Math.abs(s) <= 22 ? 0 : s;
      },
    },
    {
      name: "v15 thr25",
      fn: (ti) => {
        const s = v15(ti, neighbors(ti));
        return Math.abs(s) <= 25 ? 0 : s;
      },
    },
    {
      name: "v15 heavy decay",
      fn: (ti) => v15(ti, neighbors(ti, 5, 0.002)),
    },
    {
      name: "v15 thr22 + heavy decay",
      fn: (ti) => {
        const s = v15(ti, neighbors(ti, 5, 0.002));
        return Math.abs(s) <= 22 ? 0 : s;
      },
    },
    {
      name: "v15 fade push 40",
      fn: (ti) => {
        const n = neighbors(ti);
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
    { name: "v15 K7", fn: (ti) => v15(ti, neighbors(ti, 7)) },
    {
      name: "v15 thr22 + fade push 40",
      fn: (ti) => {
        const n = neighbors(ti);
        let s = applyLowNeighborVolFlat(knn(n), n.map((x) => x.raw));
        if (Math.abs(st[ti].ctc) > 1.5) {
          s = clampScore(s * 0.3 - Math.sign(st[ti].ctc) * 40);
        }
        s = applySoftOvernightAmp(s, st[ti].overnight, THR);
        s = applyOvernightVeto(s, st[ti].overnight, THR);
        if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
        return Math.abs(s) <= 22 ? 0 : s;
      },
    },
  ];

  console.log("Stacks on V15:\n");
  const rows = [];
  for (const idea of ideas) {
    const days = [];
    for (let ti = start; ti < st.length; ti++) {
      days.push({
        score: idea.fn(ti),
        nextOtc: st[ti].nextOtc,
        date: st[ti].tradeDate,
      });
    }
    const s = summarize(days);
    rows.push({ name: idea.name, ...s });
    console.log(
      idea.name.padEnd(28),
      `hit=${s.hit.toFixed(1)}% edge=${(s.edge >= 0 ? "+" : "") + s.edge.toFixed(3)} cash=${(s.cash * 100).toFixed(0)}% dir=${s.dir} fair=${s.fair.toFixed(4)} yE+${s.edgePos}/${s.years}`,
    );
  }
  const base = rows[0];
  console.log("\nStrict beats V15 (fair+0.04, edge+, yE+≥7, dir≥220, cash<88%):");
  for (const r of rows.slice(1)) {
    if (
      r.fair > base.fair + 0.04 &&
      r.edge > base.edge &&
      r.edgePos >= 7 &&
      r.dir >= 220 &&
      r.cash < 0.88
    ) {
      console.log("  SHIP?", r.name, `fair=${r.fair.toFixed(4)} hit=${r.hit.toFixed(1)} edge=${r.edge.toFixed(3)}`);
    }
  }
  console.log("\nLoose (fair+0.04, edge+, yE+≥6, dir≥240):");
  for (const r of rows.slice(1)) {
    if (
      r.fair > base.fair + 0.04 &&
      r.edge > base.edge &&
      r.edgePos >= 6 &&
      r.dir >= 240 &&
      r.cash < 0.88
    ) {
      console.log(
        " ",
        r.name,
        `fair=${r.fair.toFixed(4)} hit=${r.hit.toFixed(1)} edge=${r.edge.toFixed(3)} cash=${(r.cash * 100).toFixed(0)}% dir=${r.dir} yE+${r.edgePos}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
