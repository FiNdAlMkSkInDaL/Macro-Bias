import { CRYPTO_STRATEGY_RULES } from "../signal";

export const CRYPTO_TRACKED_TICKERS = ["BTC-USD", "ETH-USD", "SOL-USD"] as const;

export const CRYPTO_ANALOG_MODEL_SETTINGS = {
  blendedReturnScale: 3.5,
  minimumHistoricalAnalogs: 20,
  nearestNeighborCount: 5,
  maxNeighborCount: 5,
  neighborRadiusMultiplier: 1.0,
  temporalDecayLambda: 0.0015,
  dxyMomentumLookbackSessions: 5,
  tltMomentumLookbackSessions: 5,
  btcRealizedVolWindow: 20,
  distanceWeightEpsilon: 0.05,
  distanceQualityScale: 2.0,
  /** Aligned with stocks measurement: classic 1d/3d blend. */
  oneDayBlendWeight: 0.4,
  threeDayBlendWeight: 0.6,
  minAnalogCalendarGapDays: 3,
  percentileWindowSessions: 252,
  percentileMinHistorySessions: 60,
  enableTrendVeto: false,
} as const;

/**
 * Level / trending crypto features converted to walk-forward percentiles.
 * Momentum and RSI stay raw.
 */
export const CRYPTO_LEVEL_FEATURES_FOR_PERCENTILE = [
  "ethBtcRatio",
  "btcGldRatio",
  "btcRealizedVol",
] as const;

export const CRYPTO_STRATEGY_RULES_EXPORT = CRYPTO_STRATEGY_RULES;

export const CRYPTO_MODEL_VERSION = "crypto-model-v4-calibrated-gates";
