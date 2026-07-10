/**
 * Verify walk-forward percentile ranks (causality + basic properties).
 * Run: npx tsx scripts/verify-percentiles.ts
 */

import {
  rollingPercentileRank,
  rollingPercentileSeries,
  stationarizeLevelFeatures,
} from "../src/lib/signal/rolling-percentile";

let failed = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed += 1;
  } else {
    console.log(`ok: ${message}`);
  }
}

function almostEqual(a: number, b: number, eps = 0.6) {
  return Math.abs(a - b) <= eps;
}

/* ---- basic rank properties ---- */
{
  const series = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const opts = { window: 10, minHistory: 5 };

  const last = rollingPercentileRank(series, 9, opts);
  const firstEligible = rollingPercentileRank(series, 4, opts);
  const tooEarly = rollingPercentileRank(series, 2, opts);

  assert(tooEarly === null, "returns null before minHistory");
  assert(last != null && last > 90, "max of window ranks near top");
  assert(firstEligible != null && firstEligible > 80, "local max ranks high");
}

/* ---- min of window ranks near bottom ---- */
{
  const series = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const opts = { window: 10, minHistory: 5 };
  const last = rollingPercentileRank(series, 9, opts);
  assert(last != null && last < 15, "min of window ranks near bottom");
}

/* ---- causality: future values must not change past ranks ---- */
{
  const base = Array.from({ length: 80 }, (_, i) => Math.sin(i / 7) * 10 + i * 0.01);
  const opts = { window: 30, minHistory: 20 };
  const ranksBase = rollingPercentileSeries(base, opts);

  const extended = [...base, 999, -999, 50];
  const ranksExtended = rollingPercentileSeries(extended, opts);

  let allMatch = true;
  for (let i = 0; i < base.length; i++) {
    if (ranksBase[i] !== ranksExtended[i]) {
      allMatch = false;
      break;
    }
  }
  assert(allMatch, "extending the series does not change prior percentile ranks");
}

/* ---- stationarizeLevelFeatures drops short history and rewrites keys ---- */
{
  const points = Array.from({ length: 80 }, (_, i) => ({
    tradeDate: `2020-01-${String((i % 28) + 1).padStart(2, "0")}`,
    vector: {
      keepMe: 1.5,
      levelA: i + 1,
      levelB: 100 - i,
    },
  }));

  const result = stationarizeLevelFeatures(points, ["levelA", "levelB"], {
    window: 40,
    minHistory: 30,
  });

  assert(result.length === 80 - 29, "drops first minHistory-1 points");
  assert(result[0].vector.keepMe === 1.5, "non-level features preserved");
  assert(
    result.every((p) => p.vector.levelA >= 0 && p.vector.levelA <= 100),
    "levelA mapped into 0–100",
  );
  assert(
    result.every((p) => p.vector.levelB >= 0 && p.vector.levelB <= 100),
    "levelB mapped into 0–100",
  );

  // Rising levelA should tend to high percentile at the end
  const last = result[result.length - 1];
  assert(last.vector.levelA > 70, "rising series ends in high percentile");
  assert(last.vector.levelB < 30, "falling series ends in low percentile");
}

/* ---- midrank stability with ties ---- */
{
  const series = [5, 5, 5, 5, 5, 5];
  const rank = rollingPercentileRank(series, 5, { window: 6, minHistory: 3 });
  assert(rank != null && almostEqual(rank, 50, 1), "all-ties series ranks ~50");
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}

console.log("\nAll percentile checks passed.");
