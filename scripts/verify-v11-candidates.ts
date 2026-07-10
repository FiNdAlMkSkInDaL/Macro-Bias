/**
 * Validate v11 candidates on top of v10 (cosine + Mon skip).
 * Product: next-session OTC. Year stability required.
 * Run: npx tsx scripts/verify-v11-candidates.ts
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
function tanhScore(b: number, scale = 2.75) {
  return clampScore(Math.tanh(b / scale) * 100);
}
function dow(d: string) {
  return new Date(d + "T12:00:00Z").getUTCDay();
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

function byYear(days: Day[]) {
  const m = new Map<string, Day[]>();
  for (const d of days) {
    if (d.nextOtc == null) continue;
    const y = d.date.slice(0, 4);
    if (!m.has(y)) m.set(y, []);
    m.get(y)!.push(d);
  }
  return [...m.entries()]
    .sort()
    .map(([y, ds]) => ({ y, ...summarize(ds) }));
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
    raw.push({
      tradeDate: d,
      vector: {
        spyRsi: rsi[i]!,
        vixMomentum: vixP.close > 0 ? -pct(vixP.close, vix.close) : 0,
        hygTltRatio: tlt.close > 0 ? hyg.close / tlt.close : 0,
        cperGldRatio: gld.close > 0 ? cper.close / gld.close : 0,
        usoMomentum: usoP.close > 0 ? pct(usoP.close, uso.close) : 0,
        vixLevel: vix.close,
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
  const feats = [...STOCKS_KNN_FEATURE_KEYS];

  type Nb = { distance: number; weight: number; f1: number; f3: number };

  function neighbors(ti: number, decay = ANALOG_MODEL_SETTINGS.temporalDecayLambda, k = 5): Nb[] {
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
      const distance = base * Math.exp(decay * gap);
      out.push({
        distance,
        weight: inverseDistanceWeight(distance, 0.05),
        f1: analog.f1,
        f3: analog.f3 ?? analog.f1,
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

  /** After |same-day CTC| > threshold, shrink KNN and fade the big day. */
  function fadeBigDay(score: number, ctc: number, thr = 1.5) {
    if (Math.abs(ctc) <= thr) return score;
    return clampScore(score * 0.3 - Math.sign(ctc) * 25);
  }

  function overnightAmp(score: number, overnight: number) {
    if (score > THR && overnight > 0.15) return clampScore(score * 1.25);
    if (score < -THR && overnight < -0.15) return clampScore(score * 1.25);
    if (score > THR && overnight < -0.15) return clampScore(score * 0.5);
    if (score < -THR && overnight > 0.15) return clampScore(score * 0.5);
    return score;
  }

  function applyCalendar(ti: number, score: number, skipFri: boolean) {
    if (isUsEquityMonday(st[ti].tradeDate)) return 0;
    if (skipFri && dow(st[ti].tradeDate) === 5) return 0;
    return score;
  }

  type Cfg = {
    name: string;
    decay: number;
    k: number;
    fade: boolean;
    overnight: "none" | "amp" | "70/30" | "none_decay_70";
    skipFri: boolean;
  };

  const cfgs: Cfg[] = [
    {
      name: "V10 baseline",
      decay: ANALOG_MODEL_SETTINGS.temporalDecayLambda,
      k: 5,
      fade: false,
      overnight: "none",
      skipFri: false,
    },
    {
      name: "V11 fade_big_day",
      decay: ANALOG_MODEL_SETTINGS.temporalDecayLambda,
      k: 5,
      fade: true,
      overnight: "none",
      skipFri: false,
    },
    {
      name: "V11 fade + overnight amp",
      decay: ANALOG_MODEL_SETTINGS.temporalDecayLambda,
      k: 5,
      fade: true,
      overnight: "amp",
      skipFri: false,
    },
    {
      name: "V11 fade + skip Fri",
      decay: ANALOG_MODEL_SETTINGS.temporalDecayLambda,
      k: 5,
      fade: true,
      overnight: "none",
      skipFri: true,
    },
    {
      name: "V11 fade + amp + skip Fri",
      decay: ANALOG_MODEL_SETTINGS.temporalDecayLambda,
      k: 5,
      fade: true,
      overnight: "amp",
      skipFri: true,
    },
    {
      name: "V11 noDecay + overnight 70/30",
      decay: 0,
      k: 5,
      fade: false,
      overnight: "70/30",
      skipFri: false,
    },
    {
      name: "V11 fade + noDecay + ON 70/30",
      decay: 0,
      k: 5,
      fade: true,
      overnight: "70/30",
      skipFri: false,
    },
    {
      name: "V11 fade + K7",
      decay: ANALOG_MODEL_SETTINGS.temporalDecayLambda,
      k: 7,
      fade: true,
      overnight: "none",
      skipFri: false,
    },
  ];

  function run(cfg: Cfg): Day[] {
    const days: Day[] = [];
    for (let ti = start; ti < st.length; ti++) {
      let s = knn(neighbors(ti, cfg.decay, cfg.k));
      if (cfg.fade) s = fadeBigDay(s, st[ti].ctc);
      if (cfg.overnight === "amp") s = overnightAmp(s, st[ti].overnight);
      if (cfg.overnight === "70/30") {
        const o = tanhScore(st[ti].overnight * 2);
        s = clampScore(0.7 * s + 0.3 * o);
      }
      s = applyCalendar(ti, s, cfg.skipFri);
      days.push({ date: st[ti].tradeDate, score: s, nextOtc: st[ti].nextOtc });
    }
    return days;
  }

  console.log("=== FULL SAMPLE OTC ===");
  const rows = cfgs.map((cfg) => {
    const days = run(cfg);
    const s = summarize(days);
    const years = byYear(days);
    const edgePos = years.filter((y) => y.edge > 0).length;
    const hitPos = years.filter((y) => y.hit > 50).length;
    console.log(
      `${cfg.name.padEnd(32)} hit=${s.hit.toFixed(1)}% edge=${(s.edge >= 0 ? "+" : "") + s.edge.toFixed(3)} cash=${(s.cash * 100).toFixed(0)}% dir=${s.dir} fair=${s.fair.toFixed(4)} yE+${edgePos}/${years.length} yH+${hitPos}/${years.length}`,
    );
    console.log(
      "  " +
        years
          .map(
            (y) =>
              `${y.y}:${y.hit.toFixed(0)}%/e=${y.edge >= 0 ? "+" : ""}${y.edge.toFixed(2)}`,
          )
          .join("  "),
    );
    return { cfg, s, edgePos, hitPos, years: years.length, days };
  });

  const base = rows[0];
  const candidates = rows.slice(1).filter(
    (r) =>
      r.s.fair > base.s.fair + 0.05 &&
      r.s.edge > base.s.edge &&
      r.s.dir >= 350 &&
      r.s.cash < 0.8 &&
      r.edgePos >= 5,
  );
  candidates.sort((a, b) => b.s.fair - a.s.fair);

  console.log("\n=== SHIP CANDIDATES (fair+0.05, better edge, dir≥350, cash<80%, edge+ ≥5yrs) ===");
  if (!candidates.length) {
    console.log("NONE — keep v10");
    process.exit(2);
  }
  for (const c of candidates) {
    console.log(
      `SHIP? ${c.cfg.name}: fair ${base.s.fair.toFixed(4)}→${c.s.fair.toFixed(4)} hit ${base.s.hit.toFixed(1)}→${c.s.hit.toFixed(1)} edge ${base.s.edge.toFixed(3)}→${c.s.edge.toFixed(3)}`,
    );
  }
  const winner = candidates[0];
  console.log(`\nWINNER: ${winner.cfg.name}`);
  console.log(JSON.stringify({ winner: winner.cfg, metrics: winner.s }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
