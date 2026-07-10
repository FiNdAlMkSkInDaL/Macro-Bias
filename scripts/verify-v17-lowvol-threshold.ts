/**
 * Verify v17 lowvol thr 0.5 beats v16 thr 0.4 on next-session OTC.
 * Run: npx tsx scripts/verify-v17-lowvol-threshold.ts
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";
import {
  ANALOG_MODEL_SETTINGS,
  MODEL_VERSION,
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
function productObj(hit: number, edge: number, whenIn: number, cash: number) {
  const pen = cash > 0.7 ? (cash - 0.7) * 0.5 : 0;
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

type Day = { score: number; nextOtc: number | null; date: string };

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
    prod: productObj(hit, edge, whenIn, cashR),
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
  for (const [, ds] of [...by.entries()].sort()) {
    const s = summarize(ds);
    if (s.edge > 0) edgePos++;
    if (s.hit > 50) hitPos++;
  }
  return { years: by.size, edgePos, hitPos };
}

async function main() {
  if (Math.abs(ANALOG_MODEL_SETTINGS.flatLowNeighborVolThreshold - 0.5) > 1e-9) {
    throw new Error(
      `expected lowvol thr 0.5, got ${ANALOG_MODEL_SETTINGS.flatLowNeighborVolThreshold}`,
    );
  }
  if (!MODEL_VERSION.includes("v17")) {
    throw new Error(`expected v17, got ${MODEL_VERSION}`);
  }
  console.log("ok: flatLowNeighborVolThreshold=0.5");

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

  function pipeline(ti: number, lowVolThr: number): number {
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
    const ranked = pool
      .filter((p) => p.f1 != null)
      .filter((p) => daysBetween(today.tradeDate, p.tradeDate) >= 5)
      .map((analog) => {
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
        const dist =
          base *
          Math.exp(
            ANALOG_MODEL_SETTINGS.temporalDecayLambda *
              daysBetween(today.tradeDate, analog.tradeDate),
          );
        return {
          f1: analog.f1!,
          f3: analog.f3 ?? analog.f1!,
          weight: inverseDistanceWeight(dist, 0.05),
          dist,
          raw: W1 * analog.f1! + W3 * (analog.f3 ?? analog.f1!),
        };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5);
    if (ranked.length < 5) return 0;
    const w = ranked.map((r) => r.weight);
    let s = tanhScore(
      W1 * weightedMean(ranked.map((r) => r.f1), w) +
        W3 * weightedMean(ranked.map((r) => r.f3), w),
    );
    if (stdev(ranked.map((r) => r.raw)) < lowVolThr) s = 0;
    s = applyFadeBigDay(s, today.ctc);
    s = applySoftOvernightAmp(s, today.overnight, 20);
    s = applyOvernightVeto(s, today.overnight, 20);
    if (isUsEquityMonday(today.tradeDate)) s = 0;
    return s;
  }

  function run(lowVolThr: number): Day[] {
    const days: Day[] = [];
    for (let ti = start; ti < st.length; ti++) {
      days.push({
        score: pipeline(ti, lowVolThr),
        nextOtc: st[ti].nextOtc,
        date: st[ti].tradeDate,
      });
    }
    return days;
  }

  const d16 = run(0.4);
  const d17 = run(0.5);
  const v16 = summarize(d16);
  const v17 = summarize(d17);
  const y16 = yearStab(d16);
  const y17 = yearStab(d17);

  console.log("\n========== NEXT-SESSION OTC ==========");
  console.log(
    `v16 lowvol0.4  hit=${v16.hit.toFixed(1)}% edge=${v16.edge.toFixed(3)} cash=${(v16.cash * 100).toFixed(1)}% dir=${v16.dir} prod=${v16.prod.toFixed(4)} yE+${y16.edgePos}/${y16.years}`,
  );
  console.log(
    `v17 lowvol0.5  hit=${v17.hit.toFixed(1)}% edge=${v17.edge.toFixed(3)} cash=${(v17.cash * 100).toFixed(1)}% dir=${v17.dir} prod=${v17.prod.toFixed(4)} yE+${y17.edgePos}/${y17.years}`,
  );

  const pass =
    v17.hit >= v16.hit &&
    v17.edge > v16.edge + 0.01 &&
    v17.prod > v16.prod &&
    y17.edgePos >= y16.edgePos &&
    v17.dir >= 200;

  console.log("\n========== VERDICT ==========");
  if (!pass) {
    console.log("FAIL: v17 does not beat v16");
    process.exit(2);
  }
  console.log(`PASS: lock ${MODEL_VERSION}`);
  console.log(
    `  hit ${v16.hit.toFixed(1)}→${v17.hit.toFixed(1)} | edge ${v16.edge.toFixed(3)}→${v17.edge.toFixed(3)} | prod ${v16.prod.toFixed(4)}→${v17.prod.toFixed(4)} | yE+ ${y16.edgePos}→${y17.edgePos}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
