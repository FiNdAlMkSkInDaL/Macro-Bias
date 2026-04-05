// The model only scores these ETFs. Keeping the list in one place prevents drift
// between the schema, ingestion job, and API formatting.
export const TRACKED_TICKERS = ["SPY", "QQQ", "XLP", "TLT", "GLD"] as const;

// Each signal is normalized to [-1, 1] and then multiplied by its weight.
// The total weight sums to 100, so the final score naturally maps to [-100, 100].
export const BIAS_SIGNAL_WEIGHTS = {
  growthLeadership: 30,
  equityDirection: 20,
  defensiveRotation: 25,
  flightToSafety: 25,
} as const;

// These thresholds define how quickly a raw market move saturates each signal.
// Example: if QQQ outperforms SPY by 1.5% or more, the growth-leadership signal
// maxes out at +1 for that day.
export const SIGNAL_NORMALIZATION_THRESHOLDS = {
  growthLeadership: 1.5,
  equityDirection: 2,
  defensiveRotation: 1.25,
  flightToSafety: 2,
} as const;