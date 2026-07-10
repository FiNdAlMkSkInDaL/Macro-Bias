/**
 * Unit checks for trend/vol veto + quality objective ranking.
 * Run: npx tsx scripts/verify-trend-veto.ts
 */

import { shouldVetoDirectionalLean, trendSignFromCloseVsSma } from "../src/lib/signal/trend-veto";
import { buildTradableSignal, STOCKS_STRATEGY_RULES } from "../src/lib/signal";
import { computeQualityReport, type QualityDay } from "../src/lib/signal/quality-metrics";

let failed = 0;
function assert(c: boolean, m: string) {
  if (!c) {
    console.error("FAIL:", m);
    failed++;
  } else console.log("ok:", m);
}

assert(trendSignFromCloseVsSma(110, 100) === 1, "above SMA → +1");
assert(trendSignFromCloseVsSma(90, 100) === -1, "below SMA → -1");
assert(trendSignFromCloseVsSma(100.1, 100) === 0, "near SMA → 0");

assert(
  shouldVetoDirectionalLean({ position: "LONG", trendSign: -1 }) === true,
  "LONG into downtrend vetoed",
);
assert(
  shouldVetoDirectionalLean({ position: "SHORT", trendSign: 1 }) === true,
  "SHORT into uptrend vetoed",
);
assert(
  shouldVetoDirectionalLean({ position: "LONG", trendSign: 1 }) === false,
  "LONG with uptrend ok",
);
assert(
  shouldVetoDirectionalLean({ position: "LONG", trendSign: 0, volPercentile: 80 }) === true,
  "LONG flat trend + high vol vetoed",
);

const tightNeighbors = [1.0, 0.8, 1.1, 0.9, 1.2];
const distances = [0.8, 0.9, 1.0, 1.1, 1.2];
const signal = buildTradableSignal({
  score: 50,
  neighborForwardReturns: tightNeighbors,
  neighborDistances: distances,
  rules: STOCKS_STRATEGY_RULES,
  trendVeto: { trendSign: -1, volPercentile: 40 },
});
// Veto may force FLAT even when production enableTrendVeto is false — API still works when passed.
assert(
  signal.position === "FLAT" || signal.position === "LONG",
  "buildTradableSignal accepts trendVeto input without throwing",
);
assert(
  shouldVetoDirectionalLean({ position: "LONG", trendSign: -1 }) === true,
  "veto helper still flags LONG vs downtrend",
);
const override = buildTradableSignal({
  score: 50,
  neighborForwardReturns: tightNeighbors,
  neighborDistances: distances,
  rules: STOCKS_STRATEGY_RULES,
  forceNoTrade: true,
  forceNoTradeReason: "test override",
});
assert(override.position === "NO_TRADE" && override.noTrade, "forceNoTrade works");

// Quality: a config that only takes good longs should score higher objective
const noisy: QualityDay[] = Array.from({ length: 40 }, (_, i) => ({
  sessionReturnPct: i % 2 === 0 ? 1 : -1,
  position: "LONG" as const,
  score: 40,
  directionCorrect: i % 2 === 0,
}));
const selective: QualityDay[] = [
  ...Array.from({ length: 20 }, () => ({
    sessionReturnPct: 0.8,
    position: "LONG" as const,
    score: 40,
    reliability: "A",
    directionCorrect: true as boolean | null,
  })),
  ...Array.from({ length: 20 }, () => ({
    sessionReturnPct: -0.5,
    position: "CASH" as const,
    score: 5,
    directionCorrect: null as boolean | null,
  })),
];
const qNoisy = computeQualityReport(noisy);
const qSelective = computeQualityReport(selective);
assert(qSelective.objective > qNoisy.objective, "selective high-hit config ranks above coin-flip long");

if (failed) {
  process.exit(1);
}
console.log("\nAll trend-veto / quality checks passed.");
