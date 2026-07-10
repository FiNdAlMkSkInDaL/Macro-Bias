/**
 * Offline verification of published-score live evaluation.
 * Run: npx tsx scripts/verify-live-score-eval.ts
 */

import { evaluatePublishedScores } from "../src/lib/signal/live-score-evaluation";
import { STOCKS_STRATEGY_RULES, CRYPTO_STRATEGY_RULES } from "../src/lib/signal";
import type { TradableSignal } from "../src/lib/signal";

let failed = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed += 1;
  } else {
    console.log(`ok: ${message}`);
  }
}

function almostEqual(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

const longSignal: TradableSignal = {
  position: "LONG",
  size: 0.8,
  reliability: "A",
  neighborAgreement: 0.9,
  meanNeighborDistance: 0.8,
  distanceQuality: 0.7,
  noTrade: false,
  reason: "test long",
};

const shortSignal: TradableSignal = {
  position: "SHORT",
  size: 0.7,
  reliability: "B",
  neighborAgreement: 0.75,
  meanNeighborDistance: 1.0,
  distanceQuality: 0.55,
  noTrade: false,
  reason: "test short",
};

const noTradeSignal: TradableSignal = {
  position: "NO_TRADE",
  size: 0,
  reliability: "F",
  neighborAgreement: 0.2,
  meanNeighborDistance: 4.5,
  distanceQuality: 0.2,
  noTrade: true,
  reason: "refuse",
};

/* ---- lag: score day T grades session T+1 ---- */
{
  const evalResult = evaluatePublishedScores(
    [
      { tradeDate: "2024-01-02", score: 40, signal: longSignal },
      { tradeDate: "2024-01-03", score: -40, signal: shortSignal },
    ],
    [
      { tradeDate: "2024-01-02", changePercent: 5 },
      { tradeDate: "2024-01-03", changePercent: 2 },
      { tradeDate: "2024-01-04", changePercent: -3 },
    ],
    STOCKS_STRATEGY_RULES,
  );

  assert(evalResult.totalGraded === 2, "grades two sessions after first score");
  assert(evalResult.gradedSessions[0].sessionDate === "2024-01-03", "first graded is day after first score");
  assert(evalResult.gradedSessions[0].position === "LONG", "uses prior LONG signal");
  assert(evalResult.gradedSessions[0].directionCorrect === true, "LONG + up day = hit");
  assert(evalResult.gradedSessions[1].position === "SHORT", "uses prior SHORT signal");
  assert(evalResult.gradedSessions[1].directionCorrect === true, "SHORT + down day = hit");
  assert(evalResult.forwardHitRate !== null && almostEqual(evalResult.forwardHitRate, 100), "2/2 hit rate");
}

/* ---- NO_TRADE is cash, not graded for direction ---- */
{
  const evalResult = evaluatePublishedScores(
    [{ tradeDate: "2024-01-02", score: 80, signal: noTradeSignal }],
    [
      { tradeDate: "2024-01-02", changePercent: 0 },
      { tradeDate: "2024-01-03", changePercent: 4 },
    ],
    STOCKS_STRATEGY_RULES,
  );
  assert(evalResult.gradedSessions[0].position === "CASH", "NO_TRADE → CASH");
  assert(evalResult.gradedSessions[0].directionCorrect === null, "cash has no direction grade");
  assert(evalResult.forwardHitRate === null, "no directional sessions → null hit rate");
}

/* ---- reliability buckets split ---- */
{
  const evalResult = evaluatePublishedScores(
    [
      { tradeDate: "2024-01-02", score: 50, signal: longSignal },
      { tradeDate: "2024-01-03", score: -50, signal: { ...shortSignal, reliability: "F", noTrade: true, position: "NO_TRADE", size: 0 } },
    ],
    [
      { tradeDate: "2024-01-02", changePercent: 0 },
      { tradeDate: "2024-01-03", changePercent: 1 },
      { tradeDate: "2024-01-04", changePercent: -1 },
    ],
    STOCKS_STRATEGY_RULES,
  );
  const grades = evalResult.reliabilityBuckets.map((b) => b.reliability);
  assert(grades.includes("A"), "has A bucket");
  assert(grades.includes("F"), "has F bucket");
}

/* ---- long_only maps SHORT to cash ---- */
{
  const evalResult = evaluatePublishedScores(
    [{ tradeDate: "2024-01-02", score: -50, signal: shortSignal }],
    [
      { tradeDate: "2024-01-02", changePercent: 0 },
      { tradeDate: "2024-01-03", changePercent: -5 },
    ],
    CRYPTO_STRATEGY_RULES,
    "long_only",
  );
  assert(evalResult.gradedSessions[0].position === "CASH", "long_only converts SHORT to CASH");
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}

console.log("\nAll live score evaluation checks passed.");
