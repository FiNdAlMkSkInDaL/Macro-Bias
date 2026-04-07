import type { AnalogStateVector } from "../lib/macro-bias/types";

export const REGIME_STATES = ["EXPANSION", "NEUTRAL", "CONTRACTION"] as const;

export type RegimeState = (typeof REGIME_STATES)[number];

export type RegimeFeatureVector = Pick<AnalogStateVector, "hygTltRatio" | "vixLevel">;

export type RegimeClassifiableSnapshot =
  | RegimeFeatureVector
  | {
      vector: RegimeFeatureVector;
    };

export type RegimeThresholds = {
  expansion: {
    maxVixLevel: number;
    minHygTltRatio: number;
  };
  contraction: {
    minVixLevel: number;
    maxHygTltRatio: number;
  };
};

export type RegimeClassifierOptions = {
  calibrationDataset?: readonly RegimeClassifiableSnapshot[];
  thresholds?: RegimeThresholds;
};

const DEFAULT_REGIME_THRESHOLDS: RegimeThresholds = {
  expansion: {
    maxVixLevel: 18,
    minHygTltRatio: 0.88,
  },
  contraction: {
    minVixLevel: 24,
    maxHygTltRatio: 0.82,
  },
};

const MINIMUM_CALIBRATION_SAMPLE_SIZE = 30;
const EXPANSION_QUANTILE = 0.35;
const CONTRACTION_QUANTILE = 0.65;

type RegimeSignal = -1 | 0 | 1;

function assertFiniteNumber(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`Expected ${label} to be a finite number.`);
  }

  return value;
}

function hasNestedVector(
  snapshot: RegimeClassifiableSnapshot,
): snapshot is Extract<RegimeClassifiableSnapshot, { vector: RegimeFeatureVector }> {
  return "vector" in snapshot;
}

function getRegimeFeatureVector(snapshot: RegimeClassifiableSnapshot): RegimeFeatureVector {
  const source = hasNestedVector(snapshot) ? snapshot.vector : snapshot;

  return {
    hygTltRatio: assertFiniteNumber(source.hygTltRatio, "HYG/TLT ratio"),
    vixLevel: assertFiniteNumber(source.vixLevel, "VIX level"),
  };
}

function calculateQuantile(values: readonly number[], percentile: number) {
  if (values.length === 0) {
    throw new Error("Cannot calculate a quantile from an empty dataset.");
  }

  if (percentile < 0 || percentile > 1) {
    throw new Error("Quantile percentile must be between 0 and 1.");
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const position = (sortedValues.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const weight = position - lowerIndex;
  const lowerValue = sortedValues[lowerIndex];
  const upperValue = sortedValues[upperIndex];

  return lowerValue + (upperValue - lowerValue) * weight;
}

function areThresholdsSeparated(thresholds: RegimeThresholds) {
  return (
    thresholds.expansion.maxVixLevel < thresholds.contraction.minVixLevel &&
    thresholds.contraction.maxHygTltRatio < thresholds.expansion.minHygTltRatio
  );
}

// HYG/TLT is level-sensitive across long spans, so filtering calibrates coarse
// regime bands from the supplied history instead of relying only on static cuts.
function resolveThresholds(options?: RegimeClassifierOptions): RegimeThresholds {
  if (options?.thresholds) {
    return options.thresholds;
  }

  if (
    !options?.calibrationDataset ||
    options.calibrationDataset.length < MINIMUM_CALIBRATION_SAMPLE_SIZE
  ) {
    return DEFAULT_REGIME_THRESHOLDS;
  }

  const metrics = options.calibrationDataset.map(getRegimeFeatureVector);
  const dynamicThresholds: RegimeThresholds = {
    expansion: {
      maxVixLevel: calculateQuantile(
        metrics.map((metric) => metric.vixLevel),
        EXPANSION_QUANTILE,
      ),
      minHygTltRatio: calculateQuantile(
        metrics.map((metric) => metric.hygTltRatio),
        CONTRACTION_QUANTILE,
      ),
    },
    contraction: {
      minVixLevel: calculateQuantile(
        metrics.map((metric) => metric.vixLevel),
        CONTRACTION_QUANTILE,
      ),
      maxHygTltRatio: calculateQuantile(
        metrics.map((metric) => metric.hygTltRatio),
        EXPANSION_QUANTILE,
      ),
    },
  };

  return areThresholdsSeparated(dynamicThresholds)
    ? dynamicThresholds
    : DEFAULT_REGIME_THRESHOLDS;
}

function getVolatilitySignal(
  vixLevel: number,
  thresholds: RegimeThresholds,
): RegimeSignal {
  if (vixLevel <= thresholds.expansion.maxVixLevel) {
    return 1;
  }

  if (vixLevel >= thresholds.contraction.minVixLevel) {
    return -1;
  }

  return 0;
}

function getCreditSignal(
  hygTltRatio: number,
  thresholds: RegimeThresholds,
): RegimeSignal {
  if (hygTltRatio >= thresholds.expansion.minHygTltRatio) {
    return 1;
  }

  if (hygTltRatio <= thresholds.contraction.maxHygTltRatio) {
    return -1;
  }

  return 0;
}

export function classifyRegime<TSnapshot extends RegimeClassifiableSnapshot>(
  snapshot: TSnapshot,
  options?: RegimeClassifierOptions,
): RegimeState {
  const { hygTltRatio, vixLevel } = getRegimeFeatureVector(snapshot);
  const thresholds = resolveThresholds(options);
  const volatilitySignal = getVolatilitySignal(vixLevel, thresholds);
  const creditSignal = getCreditSignal(hygTltRatio, thresholds);

  if (volatilitySignal === 1 && creditSignal >= 0) {
    return "EXPANSION";
  }

  if (creditSignal === 1 && volatilitySignal >= 0) {
    return "EXPANSION";
  }

  if (volatilitySignal === -1 && creditSignal <= 0) {
    return "CONTRACTION";
  }

  if (creditSignal === -1 && volatilitySignal <= 0) {
    return "CONTRACTION";
  }

  return "NEUTRAL";
}

export function filterDatasetByRegime<
  TCurrentSnapshot extends RegimeClassifiableSnapshot,
  THistoricalSnapshot extends RegimeClassifiableSnapshot,
>(
  currentSnapshot: TCurrentSnapshot,
  historicalDataset: readonly THistoricalSnapshot[],
): THistoricalSnapshot[] {
  const classifierOptions: RegimeClassifierOptions = {
    calibrationDataset: historicalDataset,
  };
  const currentRegime = classifyRegime(currentSnapshot, classifierOptions);

  return historicalDataset.filter(
    (historicalSnapshot) =>
      classifyRegime(historicalSnapshot, classifierOptions) === currentRegime,
  );
}