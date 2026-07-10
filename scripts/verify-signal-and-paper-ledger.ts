/**
 * Offline verification of signal + paper ledger pure logic.
 * Run: npx tsx scripts/verify-signal-and-paper-ledger.ts
 */

import {
  buildPaperLedger,
  buildTradableSignal,
  STOCKS_STRATEGY_RULES,
  CRYPTO_STRATEGY_RULES,
  inverseDistanceWeight,
  weightedMean,
  positionFromSignal,
} from "../src/lib/signal";

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

/* ---- inverse distance weights ---- */
{
  const wClose = inverseDistanceWeight(0.1, 0.05);
  const wFar = inverseDistanceWeight(2.0, 0.05);
  assert(wClose > wFar, "closer neighbors get higher inverse-distance weight");
  assert(almostEqual(weightedMean([10, 0], [1, 1]), 5), "equal weights mean is arithmetic mean");
  assert(weightedMean([10, 0], [3, 1]) > 5, "heavier weight on 10 pulls mean up");
}

/* ---- tradable signal gates ---- */
{
  const strong = buildTradableSignal({
    score: 55,
    neighborForwardReturns: [1.2, 0.8, 1.0, 0.5, 0.9],
    neighborDistances: [0.8, 0.9, 1.0, 1.1, 1.2],
    rules: STOCKS_STRATEGY_RULES,
  });
  assert(strong.position === "LONG", "strong bullish agreement → LONG");
  assert(strong.size > 0, "LONG has positive size");
  assert(strong.reliability !== "F", "tight cluster is not F");

  const loose = buildTradableSignal({
    score: 55,
    neighborForwardReturns: [1, -1, 1, -1, 0],
    // Mean distance > maxMeanNeighborDistance (4.5) forces F → NO_TRADE
    neighborDistances: [5.0, 5.2, 5.5, 5.8, 6.0],
    rules: STOCKS_STRATEGY_RULES,
  });
  assert(loose.position === "NO_TRADE", "loose + disagreement → NO_TRADE");
  assert(loose.size === 0, "NO_TRADE size is 0");
  assert(loose.reliability === "F", "over-max mean distance is F");

  const flat = buildTradableSignal({
    score: 10,
    neighborForwardReturns: [0.2, 0.1, -0.1, 0.05, 0],
    neighborDistances: [1.0, 1.1, 1.2, 1.0, 0.9],
    rules: STOCKS_STRATEGY_RULES,
  });
  assert(flat.position === "FLAT", "score inside dead zone → FLAT");
}

/* ---- C/D can still be directional (A/B-only was measured and rejected) ---- */
{
  const mid = buildTradableSignal({
    score: 55,
    neighborForwardReturns: [0.5, 0.3, 0.2, -0.1, 0.4],
    neighborDistances: [1.8, 2.0, 2.1, 1.9, 2.2],
    rules: STOCKS_STRATEGY_RULES,
  });
  if (mid.reliability !== "F" && Math.abs(55) > STOCKS_STRATEGY_RULES.scoreThreshold) {
    assert(
      mid.position === "LONG" || mid.position === "SHORT",
      "non-F reliability with large score may be directional",
    );
  }
}

/* ---- positionFromSignal ---- */
{
  assert(
    positionFromSignal(
      {
        position: "NO_TRADE",
        size: 0,
        reliability: "F",
        neighborAgreement: 0.2,
        meanNeighborDistance: 5,
        distanceQuality: 0.1,
        noTrade: true,
        reason: "test",
      },
      80,
      STOCKS_STRATEGY_RULES,
    ) === "CASH",
    "NO_TRADE maps to CASH even if score is large",
  );
}

/* ---- paper ledger: lag + long/short + friction ---- */
{
  const scores = [
    { tradeDate: "2024-01-02", score: 40 }, // → LONG next day
    { tradeDate: "2024-01-03", score: 40 },
    { tradeDate: "2024-01-04", score: -40 }, // → SHORT after
    { tradeDate: "2024-01-05", score: 0 },
  ];
  const sessions = [
    { tradeDate: "2024-01-02", changePercent: 1.0 },
    { tradeDate: "2024-01-03", changePercent: 2.0 }, // long: +2
    { tradeDate: "2024-01-04", changePercent: -1.0 }, // long: -1
    { tradeDate: "2024-01-05", changePercent: 3.0 }, // short: -3
    { tradeDate: "2024-01-08", changePercent: 1.0 }, // cash after score 0
  ];

  const ledger = buildPaperLedger(scores, sessions, {
    rules: { ...STOCKS_STRATEGY_RULES, frictionBps: 0 },
    mode: "long_short",
  });

  assert(ledger.totalSessions === 4, "sessions after first score date only (4)");
  assert(ledger.days[0].tradeDate === "2024-01-03", "first tradable session is day after first score");
  assert(ledger.days[0].position === "LONG", "day after score +40 is LONG");
  assert(almostEqual(ledger.days[0].strategyReturnPct, 2.0), "long captures +2% session");

  const shortDay = ledger.days.find((d) => d.tradeDate === "2024-01-05");
  assert(shortDay?.position === "SHORT", "after score -40, next session is SHORT");
  assert(almostEqual(shortDay?.strategyReturnPct ?? 0, -3.0), "short P&L is inverse of +3%");

  const cashDay = ledger.days.find((d) => d.tradeDate === "2024-01-08");
  assert(cashDay?.position === "CASH", "score 0 → CASH next session");
}

/* ---- size-scaled path ---- */
{
  const scores = [
    {
      tradeDate: "2024-01-02",
      score: 50,
      signal: {
        position: "LONG" as const,
        size: 0.5,
        reliability: "B" as const,
        neighborAgreement: 0.8,
        meanNeighborDistance: 1.0,
        distanceQuality: 0.6,
        noTrade: false,
        reason: "half size",
      },
    },
  ];
  const sessions = [
    { tradeDate: "2024-01-02", changePercent: 0 },
    { tradeDate: "2024-01-03", changePercent: 10 },
  ];
  const ledger = buildPaperLedger(scores, sessions, {
    rules: { ...STOCKS_STRATEGY_RULES, frictionBps: 0 },
  });
  assert(ledger.days.length === 1, "one tradable session");
  assert(almostEqual(ledger.days[0].strategyReturnPct, 10), "full unit long gets 10%");
  assert(almostEqual(ledger.days[0].sizeScaledReturnPct, 5), "size 0.5 scales return to 5%");
  assert(
    almostEqual(ledger.sizeScaledReturn ?? 0, 5, 0.01),
    "size-scaled total return ≈ +5%",
  );
}

/* ---- long-only mode suppresses shorts ---- */
{
  const scores = [{ tradeDate: "2024-01-02", score: -50 }];
  const sessions = [
    { tradeDate: "2024-01-02", changePercent: 0 },
    { tradeDate: "2024-01-03", changePercent: -4 },
  ];
  const ledger = buildPaperLedger(scores, sessions, {
    rules: CRYPTO_STRATEGY_RULES,
    mode: "long_only",
  });
  assert(ledger.days[0].position === "CASH", "long-only converts SHORT to CASH");
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}

console.log("\nAll signal + paper ledger checks passed.");
