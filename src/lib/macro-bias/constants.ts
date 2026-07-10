import { DEFAULT_TEMPORAL_DECAY_LAMBDA } from "../../utils/knn";
import { STOCKS_STRATEGY_RULES } from "../signal";

// The model only scores these ETFs. Keeping the list in one place prevents drift
// between the schema, ingestion job, and API formatting.
export const TRACKED_TICKERS = ["SPY", "QQQ", "XLP", "TLT", "GLD"] as const;

// Pillar weights describe the high-level regime model.
// They sum to 100 and define how much each macro domain can influence the final score.
export const BIAS_PILLAR_WEIGHTS = {
  trendAndMomentum: 25,
  creditAndRiskSpreads: 25,
  volatility: 25,
  positioning: 25,
} as const;

// The Glass Box API still expects componentScores, so the KNN engine publishes
// one diagnostic component per pillar. Their weights mirror the visual pillar
// weights even though the final score itself now comes from historical analog
// forward-return expectancy rather than a linear weighted average.
export const BIAS_SIGNAL_WEIGHTS = {
  trendAndMomentum: 25,
  creditAndRiskSpreads: 25,
  volatility: 25,
  positioning: 25,
} as const;

// KNN engine settings (model v18 — measured against walk-forward next-session OTC).
// Level features: walk-forward percentile ranks.
// v8–v17: cosine, Mon skip, fade, overnight veto/amp, low-vol flat, blend 0.55/0.45, thr22, lowvol0.5.
// v18: adaptive K by VIX — K=5 when VIX≥20, else K=7 (broader calm-market memory).
//      Dual no-decay agree looked good alone but failed re-lock / stack checks; left off.
// Measured on v17: hit ~58.7→58.5%, edge +0.52→+0.55, prod 1.85→1.94, yE+ 7/7.
export const ANALOG_MODEL_SETTINGS = {
  blendedReturnScale: 2.75,
  minimumHistoricalAnalogs: 20,
  nearestNeighborCount: 5,
  maxNeighborCount: 5,
  neighborRadiusMultiplier: 1.0,
  temporalDecayLambda: DEFAULT_TEMPORAL_DECAY_LAMBDA,
  oneDayReturnScale: 2.5,
  threeDayReturnScale: 4.5,
  /** v15: 0.55/0.45 beat classic 0.4/0.6 on next-session OTC fair/edge (7/7 years). */
  oneDayBlendWeight: 0.55,
  threeDayBlendWeight: 0.45,
  usoMomentumLookbackSessions: 5,
  distanceWeightEpsilon: 0.05,
  distanceQualityScale: 2.0,
  minAnalogCalendarGapDays: 5,
  percentileWindowSessions: 252,
  percentileMinHistorySessions: 60,
  /** Measured: hard trend veto reduced edge; keep off until re-proven. */
  enableTrendVeto: false,
  /**
   * Cosine (1 − cos sim) on z-scored KNN features.
   * Measured walk-forward next-session OTC: hit ~51.9% edge ~+0.12 vs Euclidean ~49.9%/+0.03.
   */
  distanceMetric: "cosine" as const,
  /**
   * Monday publish dampener: force neutral score + FLAT permission.
   * Measured: cosine + skip Mon → hit ~52.1% edge ~+0.17 on next-session OTC.
   */
  skipMondayScores: true,
  /**
   * After a large same-day SPY move (|close→close| > thr%), dampen the analog
   * score and push a fade: score' = 0.3·score − sign(day) · fadePoints.
   * Measured v11 package on next-session OTC.
   */
  fadeBigDayEnabled: true,
  fadeBigDayThresholdPct: 1.5,
  fadeBigDayScoreScale: 0.3,
  /** v13: 35 measured better than 25 on next-session OTC fair/edge. */
  fadeBigDayPushPoints: 35,
  /**
   * If analog lean fights the same-day overnight gap (open vs prior close)
   * by more than this %, zero the published score (FLAT). Measured v12.
   */
  overnightVetoEnabled: true,
  overnightVetoThresholdPct: 0.3,
  /**
   * When neighbor blended forward returns are too tightly clustered (low stdev),
   * treat the analog set as uninformative and force flat. Measured v14.
   */
  flatLowNeighborVolEnabled: true,
  /** v17: 0.5 measured better than 0.4 on hit/edge/year stability. */
  flatLowNeighborVolThreshold: 0.5,
  /**
   * Soft overnight amplify before hard veto: boost when gap agrees with lean,
   * shrink when it mildly disagrees (hard veto still zeros big fights).
   */
  softOvernightAmpEnabled: true,
  softOvernightAmpUp: 1.15,
  softOvernightAmpDown: 0.7,
  softOvernightAmpGapPct: 0.15,
  /**
   * Dual no-decay agree: off in v18 lock (failed clean re-measure / stack checks).
   * Helpers retained for future experiments.
   */
  dualNoDecayAgreeEnabled: false,
  /**
   * v18: VIX-regime adaptive neighbor count.
   * High vol (VIX≥20) → K=5; calm → K=7.
   */
  adaptiveNeighborKEnabled: true,
  adaptiveKVixThreshold: 20,
  adaptiveKHighVix: 5,
  adaptiveKLowVix: 7,
} as const;

/**
 * Feature keys stored as raw levels that must be converted to 0–100 percentile
 * ranks before KNN. Momentum / RSI-like features stay as-is.
 * Note: vixLevel is still stored for regime diagnostics but is NOT used in KNN
 * distance (measured ablation: dropping it raised next-session hit ~49.3%→51.3%).
 */
export const STOCKS_LEVEL_FEATURES_FOR_PERCENTILE = [
  "hygTltRatio",
  "cperGldRatio",
  "vixLevel",
] as const;

/**
 * Features used in Euclidean KNN distance (model v8).
 * Excludes vixLevel — walk-forward ablation ranked "drop vixLevel" best.
 */
export const STOCKS_KNN_FEATURE_KEYS = [
  "spyRsi",
  "vixMomentum",
  "hygTltRatio",
  "cperGldRatio",
  "usoMomentum",
] as const;

/** Re-export unified strategy rules so callers need one import surface. */
export const STRATEGY_RULES = STOCKS_STRATEGY_RULES;

export const MODEL_VERSION = "macro-model-v18-adaptive-k";
