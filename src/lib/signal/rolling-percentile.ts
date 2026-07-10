/**
 * Walk-forward rolling percentile ranks for non-stationary level features.
 *
 * For index i, the rank is computed only over [i - window + 1, i] (inclusive).
 * That is causal at end-of-day: all values through session i are known.
 */

export type PercentileOptions = {
  /** Lookback window in sessions (default 252 ≈ 1 trading year). */
  window: number;
  /** Minimum observations required before a rank is emitted. */
  minHistory: number;
};

export const DEFAULT_PERCENTILE_OPTIONS: PercentileOptions = {
  window: 252,
  minHistory: 60,
};

/**
 * Midrank percentile of series[index] within the trailing window ending at index.
 * Returns a value in (0, 100]. Returns null if history is too short.
 */
export function rollingPercentileRank(
  series: readonly number[],
  index: number,
  options: PercentileOptions = DEFAULT_PERCENTILE_OPTIONS,
): number | null {
  if (index < 0 || index >= series.length) {
    throw new Error(`rollingPercentileRank index ${index} out of bounds for series length ${series.length}.`);
  }

  if (index + 1 < options.minHistory) {
    return null;
  }

  const start = Math.max(0, index - options.window + 1);
  const windowSlice = series.slice(start, index + 1);
  const current = series[index];

  if (!Number.isFinite(current)) {
    return null;
  }

  let less = 0;
  let equal = 0;
  let finiteCount = 0;

  for (const value of windowSlice) {
    if (!Number.isFinite(value)) continue;
    finiteCount += 1;
    if (value < current) less += 1;
    else if (value === current) equal += 1;
  }

  if (finiteCount === 0) {
    return null;
  }

  // Midrank: (count_strictly_below + 0.5 * count_equal) / n
  const rank = (less + 0.5 * equal) / finiteCount;
  return Number((rank * 100).toFixed(2));
}

/**
 * Map an entire series to rolling percentiles (null where minHistory not met).
 */
export function rollingPercentileSeries(
  series: readonly number[],
  options: PercentileOptions = DEFAULT_PERCENTILE_OPTIONS,
): Array<number | null> {
  return series.map((_, index) => rollingPercentileRank(series, index, options));
}

/**
 * Replace selected keys on ordered points with walk-forward percentile ranks.
 * Points that cannot yet be ranked (insufficient history) are dropped.
 */
export function stationarizeLevelFeatures<
  TPoint extends { vector: Record<string, number> },
>(
  points: readonly TPoint[],
  levelKeys: readonly string[],
  options: PercentileOptions = DEFAULT_PERCENTILE_OPTIONS,
): TPoint[] {
  if (points.length === 0 || levelKeys.length === 0) {
    return [...points];
  }

  const percentileByKey: Record<string, Array<number | null>> = {};

  for (const key of levelKeys) {
    const rawSeries = points.map((point) => {
      const value = point.vector[key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return Number.NaN;
      }
      return value;
    });
    percentileByKey[key] = rollingPercentileSeries(rawSeries, options);
  }

  const result: TPoint[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const ranks = levelKeys.map((key) => percentileByKey[key][index]);
    if (ranks.some((rank) => rank == null || !Number.isFinite(rank))) {
      continue;
    }

    const nextVector = { ...points[index].vector };
    levelKeys.forEach((key, keyIndex) => {
      nextVector[key] = ranks[keyIndex] as number;
    });

    result.push({
      ...points[index],
      vector: nextVector,
    });
  }

  return result;
}

/**
 * Compute percentile of the last value in a raw series (for "today" after history is built).
 */
export function latestRollingPercentile(
  series: readonly number[],
  options: PercentileOptions = DEFAULT_PERCENTILE_OPTIONS,
): number | null {
  if (series.length === 0) return null;
  return rollingPercentileRank(series, series.length - 1, options);
}
