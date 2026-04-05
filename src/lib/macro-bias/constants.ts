// The model only scores these ETFs. Keeping the list in one place prevents drift
// between the schema, ingestion job, and API formatting.
export const TRACKED_TICKERS = ["SPY", "QQQ", "XLP", "TLT", "GLD"] as const;

// Pillar weights describe the high-level regime model.
// They sum to 100 and define how much each macro domain can influence the final score.
export const BIAS_PILLAR_WEIGHTS = {
  trendAndMomentum: 30,
  creditAndRiskSpreads: 40,
  volatility: 30,
} as const;

// Each component is normalized to [-1, 1] and then multiplied by its weight.
// The component weights sum to 100, so the final score naturally maps to [-100, 100].
// This lets the dashboard show both the fine-grained signals and the larger pillars.
export const BIAS_SIGNAL_WEIGHTS = {
  spyTrendVsSma: 18,
  spyRsiRegime: 12,
  hygVsTltSpread: 20,
  cperVsGldSpread: 20,
  vixLevelRegime: 24,
  vixTrend: 6,
} as const;

// These thresholds define how quickly raw market inputs saturate each signal.
// Symmetric thresholds mean that crossing the positive or negative band fully
// expresses that component at +1 or -1.
export const SIGNAL_NORMALIZATION_THRESHOLDS = {
  spyDistanceFromSma: 0.03,
  hygVsTltSpread: 1.5,
  hygAbsoluteMove: 1,
  cperVsGldSpread: 2,
  cperAbsoluteMove: 1.5,
  vixPercentChange: 15,
} as const;