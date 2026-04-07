export type QuantitativePillarKey = "volatility" | "credit" | "trend" | "positioning";

export interface QuantitativePillarValues {
  volatility: number;
  credit: number;
  trend: number;
  positioning: number;
}

export interface HistoricalMarketDataRow extends QuantitativePillarValues {
  gammaExposure: number;
}

export interface QuantitativePillarStatistics {
  mean: QuantitativePillarValues;
  stdDev: QuantitativePillarValues;
}

export type NormalizedHistoricalMarketDataRow<T extends HistoricalMarketDataRow> = T & {
  z_scores: QuantitativePillarValues;
};

const QUANTITATIVE_PILLAR_KEYS: readonly QuantitativePillarKey[] = [
  "volatility",
  "credit",
  "trend",
  "positioning",
];

const MIN_STANDARD_DEVIATION = 1e-12;

function assertFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function calculateMean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("Cannot calculate a mean for an empty array.");
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function calculatePopulationStandardDeviation(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("Cannot calculate a standard deviation for an empty array.");
  }

  const average = calculateMean(values);
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length;

  return Math.sqrt(variance);
}

function getPillarSeries<T extends HistoricalMarketDataRow>(
  dataset: readonly T[],
  pillar: QuantitativePillarKey,
): number[] {
  return dataset.map((row, index) => assertFiniteNumber(row[pillar], `dataset[${index}].${pillar}`));
}

function calculatePillarStatistics<T extends HistoricalMarketDataRow>(
  dataset: readonly T[],
): QuantitativePillarStatistics {
  if (dataset.length === 0) {
    throw new Error("Cannot normalize an empty dataset.");
  }

  const mean: QuantitativePillarValues = {
    volatility: 0,
    credit: 0,
    trend: 0,
    positioning: 0,
  };
  const stdDev: QuantitativePillarValues = {
    volatility: 0,
    credit: 0,
    trend: 0,
    positioning: 0,
  };

  for (const pillar of QUANTITATIVE_PILLAR_KEYS) {
    const values = getPillarSeries(dataset, pillar);

    mean[pillar] = calculateMean(values);
    stdDev[pillar] = calculatePopulationStandardDeviation(values);
  }

  return {
    mean,
    stdDev,
  };
}

export function calculateZScore(value: number, mean: number, stdDev: number): number {
  const safeValue = assertFiniteNumber(value, "value");
  const safeMean = assertFiniteNumber(mean, "mean");
  const safeStdDev = assertFiniteNumber(stdDev, "stdDev");

  if (safeStdDev < 0) {
    throw new RangeError("stdDev cannot be negative.");
  }

  if (safeStdDev < MIN_STANDARD_DEVIATION) {
    return 0;
  }

  return (safeValue - safeMean) / safeStdDev;
}

export function normalizeDataset<T extends HistoricalMarketDataRow>(
  dataset: readonly T[],
): Array<NormalizedHistoricalMarketDataRow<T>> {
  const { mean, stdDev } = calculatePillarStatistics(dataset);

  return dataset.map((row) => ({
    ...row,
    z_scores: {
      volatility: calculateZScore(row.volatility, mean.volatility, stdDev.volatility),
      credit: calculateZScore(row.credit, mean.credit, stdDev.credit),
      trend: calculateZScore(row.trend, mean.trend, stdDev.trend),
      positioning: calculateZScore(row.positioning, mean.positioning, stdDev.positioning),
    },
  }));
}