/**
 * Independent audit of the backtest engine.
 *
 * Run: npx tsx scripts/audit-backtest.ts
 *
 * Checks performed:
 * 1. SPY buy-and-hold from compounded daily returns vs first/last close
 * 2. Strategy return replication from scratch
 * 3. Signal distribution (long / short / neutral days)
 * 4. Year-by-year attribution
 * 5. Largest single-day strategy moves
 * 6. Transaction count (position flips)
 * 7. Max drawdown for both SPY and strategy
 * 8. Sanity: does compounding daily SPY returns reproduce actual price movement?
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/* ---------- helpers ---------- */

function pctChange(from: number, to: number) {
  return ((to - from) / from) * 100;
}

const MS_PER_DAY = 86_400_000;
function calDays(a: string, b: string) {
  return Math.abs(
    Math.round(
      (Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) -
        Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) /
        MS_PER_DAY,
    ),
  );
}

/* ---------- RSI ---------- */

function computeRsiSeries(closes: number[]): (number | null)[] {
  const RSI_PERIOD = 14;
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < RSI_PERIOD + 1) return result;
  let avgGain = 0,
    avgLoss = 0;
  for (let i = 1; i <= RSI_PERIOD; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d;
    else avgLoss += Math.abs(d);
  }
  avgGain /= RSI_PERIOD;
  avgLoss /= RSI_PERIOD;
  result[RSI_PERIOD] =
    avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = RSI_PERIOD + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (RSI_PERIOD - 1) + g) / RSI_PERIOD;
    avgLoss = (avgLoss * (RSI_PERIOD - 1) + l) / RSI_PERIOD;
    result[i] =
      avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

/* ---------- fetch all rows (paginated) ---------- */

async function fetchAllRows(ticker: string) {
  const all: { trade_date: string; close: number }[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data } = await sb
      .from("etf_daily_prices")
      .select("trade_date, close")
      .eq("ticker", ticker)
      .order("trade_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

/* ---------- main ---------- */

async function main() {
  console.log("=== BACKTEST AUDIT ===\n");

  /* ---- 1. Fetch data ---- */
  const tickers = ["SPY", "TLT", "GLD", "USO", "HYG", "VIX", "CPER"] as const;
  const results = await Promise.all(tickers.map((t) => fetchAllRows(t)));
  const pricesByTicker: Record<string, { trade_date: string; close: number }[]> = {};
  tickers.forEach((t, i) => (pricesByTicker[t] = results[i]));

  console.log("Rows per ticker:");
  for (const t of tickers) console.log(`  ${t}: ${pricesByTicker[t].length}`);

  /* ---- 2. Common dates ---- */
  const dateSets = tickers.map(
    (t) => new Set(pricesByTicker[t].map((r) => r.trade_date)),
  );
  const commonDates = [...dateSets[0]].filter((d) => dateSets.every((s) => s.has(d)));
  commonDates.sort();
  console.log(`\nCommon dates: ${commonDates.length} (${commonDates[0]} to ${commonDates[commonDates.length - 1]})`);

  /* ---- 3. Close maps ---- */
  const closeMap: Record<string, Map<string, number>> = {};
  for (const t of tickers) {
    closeMap[t] = new Map(pricesByTicker[t].map((r) => [r.trade_date, r.close]));
  }

  const spyCloses = commonDates.map((d) => closeMap.SPY.get(d)!);
  const rsiSeries = computeRsiSeries(spyCloses);

  /* ---- 4. Build feature points ---- */
  const K = 5;
  const LAMBDA = 0.001;
  const SCALE = 2.75;
  const VIX_LB = 5;
  const USO_LB = 5;
  const RSI_P = 14;
  const minLookback = Math.max(RSI_P, VIX_LB, USO_LB);

  type Vec = {
    spyRsi: number;
    gammaExposure: number;
    hygTltRatio: number;
    cperGldRatio: number;
    usoMomentum: number;
    vixLevel: number;
  };
  type HP = {
    date: string;
    vec: Vec;
    spyClose: number;
    spyChg: number;
    fwd1d: number | null;
    fwd3d: number | null;
  };

  const allPts: HP[] = [];
  for (let i = minLookback; i < commonDates.length; i++) {
    const d = commonDates[i];
    const rsi = rsiSeries[i];
    if (rsi === null) continue;
    const vixC = closeMap.VIX.get(d)!;
    const vixP = closeMap.VIX.get(commonDates[i - VIX_LB])!;
    const gamma = vixP > 0 ? -pctChange(vixP, vixC) : 0;
    const hygC = closeMap.HYG.get(d)!;
    const tltC = closeMap.TLT.get(d)!;
    const cperC = closeMap.CPER.get(d)!;
    const gldC = closeMap.GLD.get(d)!;
    const usoN = closeMap.USO.get(d)!;
    const usoP = closeMap.USO.get(commonDates[i - USO_LB])!;
    const usoM = usoP > 0 ? pctChange(usoP, usoN) : 0;
    const spyC = spyCloses[i];
    let f1: number | null = null;
    let f3: number | null = null;
    if (i + 1 < spyCloses.length) f1 = pctChange(spyC, spyCloses[i + 1]);
    if (i + 3 < spyCloses.length) f3 = pctChange(spyC, spyCloses[i + 3]);
    const prevC = spyCloses[i - 1];
    allPts.push({
      date: d,
      vec: {
        spyRsi: rsi,
        gammaExposure: gamma,
        hygTltRatio: tltC > 0 ? hygC / tltC : 0,
        cperGldRatio: gldC > 0 ? cperC / gldC : 0,
        usoMomentum: usoM,
        vixLevel: vixC,
      },
      spyClose: spyC,
      spyChg: pctChange(prevC, spyC),
      fwd1d: f1,
      fwd3d: f3,
    });
  }

  console.log(`Feature points: ${allPts.length}`);

  /* ---- 5. Backtest ---- */
  const BACKTEST_START = "2020-01-02";
  const startIdx = allPts.findIndex((p) => p.date >= BACKTEST_START);
  if (startIdx < 20) {
    console.error("Not enough pre-backtest data");
    return;
  }

  console.log(`\nBacktest starts at index ${startIdx}, date ${allPts[startIdx].date}`);
  console.log(`Analog pool before backtest: ${startIdx} points`);

  const featureKeys: (keyof Vec)[] = [
    "spyRsi",
    "gammaExposure",
    "hygTltRatio",
    "cperGldRatio",
    "usoMomentum",
    "vixLevel",
  ];

  type BacktestDay = {
    date: string;
    score: number;
    spyClose: number;
    spyChgPct: number;
    direction: "LONG" | "SHORT" | "CASH";
  };

  const days: BacktestDay[] = [];

  for (let ti = startIdx; ti < allPts.length; ti++) {
    const today = allPts[ti];
    const pool = allPts.slice(0, ti);
    if (pool.length < 20) continue;

    // Z-score stats from pool
    const means: Record<string, number> = {};
    const stds: Record<string, number> = {};
    for (const k of featureKeys) {
      const vals = pool.map((p) => p.vec[k]);
      const m = vals.reduce((s, v) => s + v, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length;
      means[k] = m;
      stds[k] = Math.sqrt(variance) || 1;
    }

    const tZ: Record<string, number> = {};
    for (const k of featureKeys) tZ[k] = (today.vec[k] - means[k]) / stds[k];

    const ranked = pool
      .filter((p) => p.fwd1d !== null)
      .map((a) => {
        const aZ: Record<string, number> = {};
        for (const k of featureKeys) aZ[k] = (a.vec[k] - means[k]) / stds[k];
        let sq = 0;
        for (const k of featureKeys) sq += (tZ[k] - aZ[k]) ** 2;
        const dist =
          Math.sqrt(sq) * Math.exp(LAMBDA * calDays(today.date, a.date));
        return { a, dist };
      })
      .sort((x, y) => x.dist - y.dist)
      .slice(0, K);

    if (ranked.length < K) continue;

    const avg1d =
      ranked.reduce((s, r) => s + (r.a.fwd1d ?? 0), 0) / ranked.length;
    const avg3d =
      ranked.reduce((s, r) => s + (r.a.fwd3d ?? 0), 0) / ranked.length;
    const blended = 0.4 * avg1d + 0.6 * avg3d;
    const score = Math.max(
      -100,
      Math.min(100, Math.round(Math.tanh(blended / SCALE) * 100)),
    );

    days.push({
      date: today.date,
      score,
      spyClose: today.spyClose,
      spyChgPct: today.spyChg,
      direction: score > 0 ? "LONG" : score < 0 ? "SHORT" : "CASH",
    });
  }

  console.log(`Backtest days: ${days.length}`);
  console.log(`Date range: ${days[0].date} to ${days[days.length - 1].date}\n`);

  /* ---- 6. Sanity check: SPY compounded vs actual ---- */
  const spyFirst = days[0].spyClose;
  const spyLast = days[days.length - 1].spyClose;
  const spyActualReturn = ((spyLast / spyFirst) * (1 + days[0].spyChgPct / 100) - 1) * 100;
  // Actually, day[0]'s spyChgPct moves SPY from prev close → day[0] close.
  // So the compounded return from equity=100 on close of day[-1] should equal last close / first prev close.
  // Let's just compound:
  let spyCompounded = 100;
  for (const d of days) {
    spyCompounded *= 1 + d.spyChgPct / 100;
  }
  const spyCompoundedReturn = spyCompounded - 100;

  // Also compute directly from first close before backtest and last close
  // day[0].spyChgPct = (day[0].spyClose - prevClose) / prevClose * 100
  // prevClose = day[0].spyClose / (1 + day[0].spyChgPct/100)
  const impliedPrevClose = days[0].spyClose / (1 + days[0].spyChgPct / 100);
  const directReturn = ((spyLast - impliedPrevClose) / impliedPrevClose) * 100;

  console.log("=== SPY SANITY CHECK ===");
  console.log(`First backtest day:  ${days[0].date}, close=${days[0].spyClose}, chg=${days[0].spyChgPct.toFixed(4)}%`);
  console.log(`Last backtest day:   ${days[days.length - 1].date}, close=${spyLast}`);
  console.log(`Implied prev close (day before backtest): ${impliedPrevClose.toFixed(2)}`);
  console.log(`Direct SPY return (last/first-1):         ${directReturn.toFixed(2)}%`);
  console.log(`Compounded SPY return:                    ${spyCompoundedReturn.toFixed(2)}%`);
  console.log(`Match: ${Math.abs(directReturn - spyCompoundedReturn) < 0.5 ? "YES ✓" : "NO ✗ — BUG!"}`);

  /* ---- 7. Strategy equity curve ---- */
  let stratEquity = 100;
  spyCompounded = 100;
  let maxSpy = 100;
  let maxStrat = 100;
  let maxSpyDD = 0;
  let maxStratDD = 0;

  const yearlyReturns: Record<string, { spyStart: number; spyEnd: number; stratStart: number; stratEnd: number }> = {};
  let prevYear = "";
  let longDays = 0,
    shortDays = 0,
    cashDays = 0;
  let flips = 0;
  let prevDir = "CASH";
  let bigDays: { date: string; stratReturn: number; dir: string; spyChg: number }[] = [];

  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const dr = d.spyChgPct / 100;
    spyCompounded *= 1 + dr;

    let stratReturn = 0;
    if (i > 0) {
      const prevScore = days[i - 1].score;
      if (prevScore > 0) {
        stratEquity *= 1 + dr;
        stratReturn = dr;
      } else if (prevScore < 0) {
        stratEquity *= 1 - dr;
        stratReturn = -dr;
      }
    }

    // Track signal distribution
    if (d.score > 0) longDays++;
    else if (d.score < 0) shortDays++;
    else cashDays++;

    // Track flips
    if (d.direction !== prevDir) flips++;
    prevDir = d.direction;

    // Track big single-day strategy moves
    if (Math.abs(stratReturn) > 0.03) {
      bigDays.push({
        date: d.date,
        stratReturn: stratReturn * 100,
        dir: i > 0 ? days[i - 1].direction : "CASH",
        spyChg: d.spyChgPct,
      });
    }

    // Max drawdown
    if (spyCompounded > maxSpy) maxSpy = spyCompounded;
    if (stratEquity > maxStrat) maxStrat = stratEquity;
    const spyDD = (spyCompounded - maxSpy) / maxSpy;
    const stratDD = (stratEquity - maxStrat) / maxStrat;
    if (spyDD < maxSpyDD) maxSpyDD = spyDD;
    if (stratDD < maxStratDD) maxStratDD = stratDD;

    // Yearly tracking
    const year = d.date.slice(0, 4);
    if (year !== prevYear) {
      yearlyReturns[year] = {
        spyStart: spyCompounded / (1 + dr),
        spyEnd: spyCompounded,
        stratStart: i > 0 ? stratEquity / (1 + stratReturn) : stratEquity,
        stratEnd: stratEquity,
      };
      prevYear = year;
    } else {
      yearlyReturns[year].spyEnd = spyCompounded;
      yearlyReturns[year].stratEnd = stratEquity;
    }
  }

  console.log(`\n=== STRATEGY RESULTS ===`);
  console.log(`SPY buy-and-hold:  ${(spyCompounded - 100).toFixed(2)}%  (equity: ${spyCompounded.toFixed(2)})`);
  console.log(`Strategy:          ${(stratEquity - 100).toFixed(2)}%  (equity: ${stratEquity.toFixed(2)})`);
  console.log(`Alpha:             ${(stratEquity - spyCompounded).toFixed(2)}%`);

  console.log(`\n=== SIGNAL DISTRIBUTION ===`);
  console.log(`Long days:    ${longDays}  (${((longDays / days.length) * 100).toFixed(1)}%)`);
  console.log(`Short days:   ${shortDays}  (${((shortDays / days.length) * 100).toFixed(1)}%)`);
  console.log(`Neutral days: ${cashDays}  (${((cashDays / days.length) * 100).toFixed(1)}%)`);
  console.log(`Position flips: ${flips}`);

  console.log(`\n=== YEAR-BY-YEAR ===`);
  for (const [year, r] of Object.entries(yearlyReturns).sort()) {
    const spyYr = ((r.spyEnd - r.spyStart) / r.spyStart) * 100;
    const stratYr = ((r.stratEnd - r.stratStart) / r.stratStart) * 100;
    console.log(
      `${year}:  SPY ${spyYr > 0 ? "+" : ""}${spyYr.toFixed(1)}%   Strategy ${stratYr > 0 ? "+" : ""}${stratYr.toFixed(1)}%   Alpha ${(stratYr - spyYr) > 0 ? "+" : ""}${(stratYr - spyYr).toFixed(1)}%`,
    );
  }

  console.log(`\n=== DRAWDOWNS ===`);
  console.log(`SPY max drawdown:      ${(maxSpyDD * 100).toFixed(1)}%`);
  console.log(`Strategy max drawdown: ${(maxStratDD * 100).toFixed(1)}%`);

  console.log(`\n=== LARGEST SINGLE-DAY STRATEGY MOVES (>3%) ===`);
  bigDays.sort((a, b) => Math.abs(b.stratReturn) - Math.abs(a.stratReturn));
  for (const bd of bigDays.slice(0, 20)) {
    console.log(
      `${bd.date}: Strategy ${bd.stratReturn > 0 ? "+" : ""}${bd.stratReturn.toFixed(2)}% (was ${bd.dir}, SPY ${bd.spyChg > 0 ? "+" : ""}${bd.spyChg.toFixed(2)}%)`,
    );
  }

  /* ---- 8. Check for data anomalies ---- */
  console.log(`\n=== DATA ANOMALIES ===`);
  let gapCount = 0;
  let dupCount = 0;
  for (let i = 1; i < days.length; i++) {
    const calGap = calDays(days[i - 1].date, days[i].date);
    if (calGap > 5) {
      if (gapCount < 5) console.log(`  Gap: ${days[i - 1].date} → ${days[i].date} (${calGap} calendar days)`);
      gapCount++;
    }
    if (days[i].date === days[i - 1].date) {
      console.log(`  DUPLICATE DATE: ${days[i].date}`);
      dupCount++;
    }
    if (Math.abs(days[i].spyChgPct) > 10) {
      console.log(`  HUGE SPY MOVE: ${days[i].date} ${days[i].spyChgPct.toFixed(2)}%`);
    }
  }
  console.log(`  Total gaps > 5 cal days: ${gapCount}`);
  console.log(`  Duplicate dates: ${dupCount}`);

  /* ---- 9. Score distribution histogram ---- */
  console.log(`\n=== SCORE DISTRIBUTION ===`);
  const bins: Record<string, number> = {
    "[-100,-60]": 0,
    "(-60,-20)": 0,
    "[-20,20]": 0,
    "(20,60)": 0,
    "[60,100]": 0,
  };
  for (const d of days) {
    if (d.score <= -60) bins["[-100,-60]"]++;
    else if (d.score < -20) bins["(-60,-20)"]++;
    else if (d.score <= 20) bins["[-20,20]"]++;
    else if (d.score < 60) bins["(20,60)"]++;
    else bins["[60,100]"]++;
  }
  for (const [range, count] of Object.entries(bins)) {
    console.log(`  ${range}: ${count} (${((count / days.length) * 100).toFixed(1)}%)`);
  }

  /* ---- 10. Annualized return ---- */
  const totalYears = calDays(days[0].date, days[days.length - 1].date) / 365.25;
  const annualizedSpy = (Math.pow(spyCompounded / 100, 1 / totalYears) - 1) * 100;
  const annualizedStrat = (Math.pow(stratEquity / 100, 1 / totalYears) - 1) * 100;
  console.log(`\n=== ANNUALIZED ===`);
  console.log(`Period: ${totalYears.toFixed(1)} years`);
  console.log(`SPY annualized:      ${annualizedSpy.toFixed(1)}%`);
  console.log(`Strategy annualized: ${annualizedStrat.toFixed(1)}%`);

  /* ---- 11. ALTERNATIVE SCENARIOS ---- */
  console.log(`\n\n${"=".repeat(60)}`);
  console.log("ALTERNATIVE STRATEGY SCENARIOS");
  console.log("=".repeat(60));

  function runScenario(
    label: string,
    threshold: number,
    costBps: number,
  ) {
    let eq = 100;
    let spy2 = 100;
    let prevPos: "LONG" | "SHORT" | "CASH" = "CASH";
    let trades = 0;
    let longD = 0, shortD = 0, cashD = 0;

    const yearData: Record<string, { start: number; end: number; spyS: number; spyE: number }> = {};
    let pYear = "";

    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      const dr = d.spyChgPct / 100;
      spy2 *= 1 + dr;

      // Determine today's position based on YESTERDAY's score
      let pos: "LONG" | "SHORT" | "CASH" = "CASH";
      if (i > 0) {
        const ps = days[i - 1].score;
        if (ps > threshold) pos = "LONG";
        else if (ps < -threshold) pos = "SHORT";
      }

      // Apply transaction cost on position change
      if (pos !== prevPos && i > 0) {
        eq *= 1 - costBps / 10000;
        trades++;
      }

      if (pos === "LONG") {
        eq *= 1 + dr;
        longD++;
      } else if (pos === "SHORT") {
        eq *= 1 - dr;
        shortD++;
      } else {
        cashD++;
      }
      prevPos = pos;

      const yr = d.date.slice(0, 4);
      if (yr !== pYear) {
        yearData[yr] = { start: eq / (pos === "LONG" ? 1 + dr : pos === "SHORT" ? 1 - dr : 1), end: eq, spyS: spy2 / (1 + dr), spyE: spy2 };
        pYear = yr;
      } else {
        yearData[yr].end = eq;
        yearData[yr].spyE = spy2;
      }
    }

    const ret = eq - 100;
    const spyRet = spy2 - 100;
    const yrs = calDays(days[0].date, days[days.length - 1].date) / 365.25;
    const annRet = (Math.pow(eq / 100, 1 / yrs) - 1) * 100;

    console.log(`\n--- ${label} ---`);
    console.log(`Threshold |score| > ${threshold}, cost ${costBps}bps/trade`);
    console.log(`Strategy: +${ret.toFixed(1)}%  SPY: +${spyRet.toFixed(1)}%  Alpha: +${(ret - spyRet).toFixed(1)}%`);
    console.log(`Annualized: ${annRet.toFixed(1)}%`);
    console.log(`Long: ${longD}, Short: ${shortD}, Cash: ${cashD}, Trades: ${trades}`);
    console.log(`Year-by-year:`);
    for (const [yr, r] of Object.entries(yearData).sort()) {
      const sR = ((r.spyE - r.spyS) / r.spyS) * 100;
      const tR = ((r.end - r.start) / r.start) * 100;
      console.log(`  ${yr}: SPY ${sR > 0 ? "+" : ""}${sR.toFixed(1)}%  Strat ${tR > 0 ? "+" : ""}${tR.toFixed(1)}%`);
    }
  }

  // Scenario A: Original (score>0 / <0) with 10bps cost
  runScenario("Original + 10bps cost", 0, 10);

  // Scenario B: Regime threshold (|score|>20) no cost
  runScenario("Regime threshold (|score|>20), no cost", 20, 0);

  // Scenario C: Regime threshold + 10bps cost
  runScenario("Regime threshold (|score|>20) + 10bps cost", 20, 10);

  // Scenario D: Higher threshold (|score|>40) + 10bps
  runScenario("High threshold (|score|>40) + 10bps", 40, 10);

  // Scenario E: Regime threshold + 20bps (more conservative)
  runScenario("Regime threshold (|score|>20) + 20bps cost", 20, 20);

  // Scenario F: Regime threshold + 5bps (realistic for SPY)
  runScenario("Regime threshold (|score|>20) + 5bps cost", 20, 5);

  // Scenario G: Regime threshold + 3bps (tight spread on SPY)
  runScenario("Regime threshold (|score|>20) + 3bps cost", 20, 3);
}

main().catch(console.error);
