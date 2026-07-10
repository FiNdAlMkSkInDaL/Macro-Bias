import type { PositionPermission, ReliabilityGrade, StrategyRules, TradableSignal } from "./types";
import { shouldVetoDirectionalLean, type TrendVetoInput } from "./trend-veto";

/**
 * Stocks strategy rules — calibrated via walk-forward on 2020–present SPY.
 *
 * Soft gates: refuse only when analogs are clearly bad.
 * Aggressive gates (agr≥0.5 / dist≤3 / trend veto) destroy edge (cash 85–94%).
 * v16: scoreThreshold 22 (was 20) — measured on v15 package: hit ~55.8→57.4%,
 * edge +0.44→+0.48, fair 1.56→1.72 on next-session OTC.
 */
export const STOCKS_STRATEGY_RULES: StrategyRules = {
  scoreThreshold: 22,
  frictionBps: 5,
  maxMeanNeighborDistance: 4.5,
  minNeighborAgreement: 0.3,
};

/** Crypto mirrors stocks agreement/distance; wider friction for spreads. */
export const CRYPTO_STRATEGY_RULES: StrategyRules = {
  scoreThreshold: 20,
  frictionBps: 15,
  maxMeanNeighborDistance: 4.5,
  minNeighborAgreement: 0.3,
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function roundTo(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

/**
 * Inverse-distance weight. Closer neighbors dominate expectancy.
 * epsilon avoids division by zero on exact matches.
 */
export function inverseDistanceWeight(distance: number, epsilon = 0.05) {
  return 1 / (distance + epsilon);
}

export function weightedMean(values: number[], weights: number[]) {
  if (values.length === 0 || values.length !== weights.length) {
    throw new Error("weightedMean requires non-empty equal-length arrays.");
  }

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  return values.reduce((sum, value, index) => sum + value * weights[index], 0) / totalWeight;
}

/**
 * Distance quality maps mean neighbor distance into (0, 1].
 * scale is roughly the distance at which quality ≈ 0.5.
 */
export function distanceQualityFromMean(meanDistance: number, scale = 2.0) {
  if (!Number.isFinite(meanDistance) || meanDistance < 0) {
    return 0;
  }

  return roundTo(1 / (1 + meanDistance / scale), 4);
}

/**
 * Reliability grades from composite quality Q = agreement × distanceQuality.
 * Thresholds tightened after measurement showed default A/B was ~90% of days
 * and inverted vs D/F. A/B is now a selective top band.
 *
 * Directional policy (locked after v9 reject): F → NO_TRADE; A–D may LONG/SHORT
 * when |score| > threshold. A/B-only directional was measured and rejected
 * (cashRate ~73–78%, negative edge on open→close).
 */
export function reliabilityFromMetrics(
  meanNeighborDistance: number,
  neighborAgreement: number,
  distanceQuality: number,
  rules: StrategyRules,
): ReliabilityGrade {
  if (
    meanNeighborDistance > rules.maxMeanNeighborDistance ||
    neighborAgreement < rules.minNeighborAgreement * 0.75
  ) {
    return "F";
  }

  const quality = neighborAgreement * distanceQuality;

  // Selective top band (was too loose: agr≥0.8 & dq≥0.65 matched almost everything)
  if (quality >= 0.55 && neighborAgreement >= 0.8 && distanceQuality >= 0.6) {
    return "A";
  }

  if (quality >= 0.4 && neighborAgreement >= 0.65 && distanceQuality >= 0.5) {
    return "B";
  }

  if (quality >= 0.28 && neighborAgreement >= rules.minNeighborAgreement) {
    return "C";
  }

  if (neighborAgreement >= rules.minNeighborAgreement * 0.9) {
    return "D";
  }

  return "F";
}

/**
 * True when reliability is the selective high band (A/B).
 * Analytics / UI only — not a hard directional veto (A/B-only failed fair metrics).
 */
export function allowsDirectionalPermission(reliability: ReliabilityGrade): boolean {
  return reliability === "A" || reliability === "B";
}

/**
 * Build the tradable permission layer from raw score + analog diagnostics.
 * This is the only path that should decide LONG/SHORT/FLAT/NO_TRADE.
 *
 * Policy (macro-model-v8, retained after v9 reject):
 * - F → NO_TRADE
 * - A–D → LONG/SHORT when |score| > threshold, else FLAT
 */
export function buildTradableSignal(input: {
  score: number;
  neighborForwardReturns: number[];
  neighborDistances: number[];
  rules: StrategyRules;
  /** Optional hard ensemble veto inputs (trend/vol). */
  trendVeto?: Omit<TrendVetoInput, "position">;
  /** When true (news override), force NO_TRADE. */
  forceNoTrade?: boolean;
  forceNoTradeReason?: string;
}): TradableSignal {
  const { score, neighborForwardReturns, neighborDistances, rules } = input;

  if (input.forceNoTrade) {
    return {
      position: "NO_TRADE",
      size: 0,
      reliability: "F",
      neighborAgreement: 0,
      meanNeighborDistance: Number.POSITIVE_INFINITY,
      distanceQuality: 0,
      noTrade: true,
      reason: input.forceNoTradeReason ?? "External override forced NO_TRADE.",
    };
  }

  if (neighborForwardReturns.length === 0 || neighborDistances.length === 0) {
    return {
      position: "NO_TRADE",
      size: 0,
      reliability: "F",
      neighborAgreement: 0,
      meanNeighborDistance: Number.POSITIVE_INFINITY,
      distanceQuality: 0,
      noTrade: true,
      reason: "No historical analogs available.",
    };
  }

  const meanNeighborDistance = roundTo(
    neighborDistances.reduce((sum, distance) => sum + distance, 0) / neighborDistances.length,
    4,
  );
  const distanceQuality = distanceQualityFromMean(meanNeighborDistance);

  const scoreSign = score > 0 ? 1 : score < 0 ? -1 : 0;
  const agreementCount =
    scoreSign === 0
      ? neighborForwardReturns.filter((value) => Math.abs(value) < 0.15).length
      : neighborForwardReturns.filter((value) => value * scoreSign > 0).length;
  const neighborAgreement = roundTo(agreementCount / neighborForwardReturns.length, 4);

  const reliability = reliabilityFromMetrics(
    meanNeighborDistance,
    neighborAgreement,
    distanceQuality,
    rules,
  );

  if (reliability === "F") {
    return {
      position: "NO_TRADE",
      size: 0,
      reliability,
      neighborAgreement,
      meanNeighborDistance,
      distanceQuality,
      noTrade: true,
      reason:
        meanNeighborDistance > rules.maxMeanNeighborDistance
          ? "Analog cluster is too loose. History is not a reliable guide today."
          : "Neighbor disagreement is high. Model refuses a directional call.",
    };
  }

  if (Math.abs(score) <= rules.scoreThreshold) {
    return {
      position: "FLAT",
      size: 0,
      reliability,
      neighborAgreement,
      meanNeighborDistance,
      distanceQuality,
      noTrade: false,
      reason: "Score is inside the neutral dead zone. Stay in cash.",
    };
  }

  let position: PositionPermission = score > 0 ? "LONG" : "SHORT";

  if (
    input.trendVeto &&
    shouldVetoDirectionalLean({
      position,
      trendSign: input.trendVeto.trendSign,
      volPercentile: input.trendVeto.volPercentile,
      volStressThreshold: input.trendVeto.volStressThreshold,
    })
  ) {
    return {
      position: "FLAT",
      size: 0,
      reliability,
      neighborAgreement,
      meanNeighborDistance,
      distanceQuality,
      noTrade: false,
      reason:
        "Analog lean fights the trend/vol ensemble. Forced FLAT until structure agrees.",
    };
  }

  const magnitude = clamp(Math.abs(score) / 100, 0, 1);
  const size = roundTo(clamp(magnitude * neighborAgreement * distanceQuality, 0, 1), 4);

  return {
    position,
    size,
    reliability,
    neighborAgreement,
    meanNeighborDistance,
    distanceQuality,
    noTrade: false,
    reason:
      position === "LONG"
        ? `Risk-on lean with reliability ${reliability} and size ${Math.round(size * 100)}%.`
        : `Risk-off lean with reliability ${reliability} and size ${Math.round(size * 100)}%.`,
  };
}

/**
 * Map a tradable signal (or a lagged score under legacy rules) into a backtest position.
 * Prefer signal.position when available; fall back to threshold-on-score for historical rows.
 */
export function positionFromScore(score: number, rules: StrategyRules): "LONG" | "SHORT" | "CASH" {
  if (score > rules.scoreThreshold) return "LONG";
  if (score < -rules.scoreThreshold) return "SHORT";
  return "CASH";
}

export function positionFromSignal(signal: TradableSignal | null | undefined, score: number, rules: StrategyRules): "LONG" | "SHORT" | "CASH" {
  if (signal) {
    if (signal.position === "LONG") return "LONG";
    if (signal.position === "SHORT") return "SHORT";
    return "CASH";
  }

  return positionFromScore(score, rules);
}
