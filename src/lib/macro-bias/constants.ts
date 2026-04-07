import { DEFAULT_TEMPORAL_DECAY_LAMBDA } from "../../utils/knn";

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

// KNN engine settings.
// The scales below are percentage-return bands used only when mapping forward
// expectancy back to the legacy -100 to +100 UI score.
export const ANALOG_MODEL_SETTINGS = {
  blendedReturnScale: 2.75,
  minimumHistoricalAnalogs: 20,
  nearestNeighborCount: 5,
  temporalDecayLambda: DEFAULT_TEMPORAL_DECAY_LAMBDA,
  oneDayReturnScale: 2.5,
  threeDayReturnScale: 4.5,
  usoMomentumLookbackSessions: 5,
} as const;