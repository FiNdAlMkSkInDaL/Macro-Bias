/**
 * Verify v13 (fade push 35) beats v12 (fade push 25) on next-session OTC.
 * Run: npx tsx scripts/verify-v13-fade-push35.ts
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
import { applyOvernightVeto } from "../src/lib/macro-bias/calculate-daily-bias";
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

function fade(score: number, ctc: number, push: number) {
  if (Math.abs(ctc) <= 1.5) return score;
  return clampScore(score * 0.3 - Math.sign(ctc) * push);
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
  for (const [, ds] of [...by.entries()].sort()) {
    const s = summarize(ds);
    if (s.edge > 0) edgePos++;
    if (s.hit > 50) hitPos++;
  }
  return { years: by.size, edgePos, hitPos };
}

async function main() {
  if (ANALOG_MODEL_SETTINGS.fadeBigDayPushPoints !== 35) {
    throw new Error(
      `expected fadeBigDayPushPoints=35, got ${ANALOG_MODEL_SETTINGS.fadeBigDayPushPoints}`,
    );
  }
  if (!MODEL_VERSION.includes("v13")) {
    throw new Error(`expected v13 model, got ${MODEL_VERSION}`);
  }
  // unit: push 35 vs 25
  {
    const s25 = fade(40, 2, 25); // 12-25 = -13
    const s35 = fade(40, 2, 35); // 12-35 = -23
    if (s25 !== -13 || s35 !== -23) throw new Error(`fade unit fail ${s25} ${s35}`);
    console.log("ok: fade push unit");
  }

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
  const start = st.findIndex((p) => p.tradeDate >= BACKTEST_START);
  const feats = [...STOCKS_KNN_FEATURE_KEYS];

  function knnScore(ti: number) {
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
        };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5);
    if (ranked.length < 5) return 0;
    const w = ranked.map((r) => r.weight);
    return tanhScore(
      0.4 * weightedMean(ranked.map((r) => r.f1), w) +
        0.6 * weightedMean(ranked.map((r) => r.f3), w),
    );
  }

  function run(push: number): Day[] {
    const days: Day[] = [];
    for (let ti = start; ti < st.length; ti++) {
      let s = knnScore(ti);
      s = fade(s, st[ti].ctc, push);
      s = applyOvernightVeto(s, st[ti].overnight, THR);
      if (isUsEquityMonday(st[ti].tradeDate)) s = 0;
      days.push({ score: s, nextOtc: st[ti].nextOtc, date: st[ti].tradeDate });
    }
    return days;
  }

  const d12 = run(25);
  const d13 = run(35);
  const v12 = summarize(d12);
  const v13 = summarize(d13);
  const y12 = yearStab(d12);
  const y13 = yearStab(d13);

  console.log("\n========== NEXT-SESSION OTC ==========");
  console.log(
    `v12 push25   hit=${v12.hit.toFixed(1)}% edge=${v12.edge.toFixed(3)} cash=${(v12.cash * 100).toFixed(0)}% dir=${v12.dir} fair=${v12.fair.toFixed(4)} yE+${y12.edgePos}/${y12.years}`,
  );
  console.log(
    `v13 push35   hit=${v13.hit.toFixed(1)}% edge=${v13.edge.toFixed(3)} cash=${(v13.cash * 100).toFixed(0)}% dir=${v13.dir} fair=${v13.fair.toFixed(4)} yE+${y13.edgePos}/${y13.years}`,
  );

  const pass =
    v13.fair > v12.fair + 0.03 &&
    v13.edge > v12.edge &&
    v13.hit >= v12.hit &&
    v13.dir >= 300 &&
    v13.cash <= v12.cash + 0.02 &&
    y13.edgePos >= 5;

  console.log("\n========== VERDICT ==========");
  if (!pass) {
    console.log("FAIL: v13 does not clearly beat v12");
    process.exit(2);
  }
  console.log(`PASS: lock ${MODEL_VERSION}`);
  console.log(
    `  fair ${v12.fair.toFixed(4)} → ${v13.fair.toFixed(4)} | hit ${v12.hit.toFixed(1)}→${v13.hit.toFixed(1)} | edge ${v12.edge.toFixed(3)}→${v13.edge.toFixed(3)}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
