export const CRYPTO_REGIME_STATES = ["EXPANSION", "NEUTRAL", "CONTRACTION"] as const;

export type CryptoRegimeState = (typeof CRYPTO_REGIME_STATES)[number];

export type CryptoRegimeFeatureVector = {
  btcRealizedVol: number;
  ethBtcRatio: number;
};

export type CryptoRegimeClassifiableSnapshot =
  | CryptoRegimeFeatureVector
  | { vector: CryptoRegimeFeatureVector };

export type CryptoRegimeThresholds = {
  expansion: { maxBtcRealizedVol: number; minEthBtcRatio: number };
  contraction: { minBtcRealizedVol: number; maxEthBtcRatio: number };
};

export type CryptoRegimeClassifierOptions = {
  calibrationDataset?: readonly CryptoRegimeClassifiableSnapshot[];
  thresholds?: CryptoRegimeThresholds;
};

const DEFAULT_CRYPTO_REGIME_THRESHOLDS: CryptoRegimeThresholds = {
  expansion: { maxBtcRealizedVol: 55, minEthBtcRatio: 0.055 },
  contraction: { minBtcRealizedVol: 80, maxEthBtcRatio: 0.035 },
};

const MINIMUM_CALIBRATION_SAMPLE_SIZE = 30;
const EXPANSION_QUANTILE = 0.35;
const CONTRACTION_QUANTILE = 0.65;

type RegimeSignal = -1 | 0 | 1;

function assertFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Expected ${label} to be a finite number.`);
  }
  return value;
}

function hasNestedVector(
  snapshot: CryptoRegimeClassifiableSnapshot,
): snapshot is { vector: CryptoRegimeFeatureVector } {
  return "vector" in snapshot;
}

function getFeatureVector(snapshot: CryptoRegimeClassifiableSnapshot): CryptoRegimeFeatureVector {
  if (hasNestedVector(snapshot)) {
    return {
      btcRealizedVol: assertFiniteNumber(snapshot.vector.btcRealizedVol, "btcRealizedVol"),
      ethBtcRatio: assertFiniteNumber(snapshot.vector.ethBtcRatio, "ethBtcRatio"),
    };
  }
  return {
    btcRealizedVol: assertFiniteNumber(snapshot.btcRealizedVol, "btcRealizedVol"),
    ethBtcRatio: assertFiniteNumber(snapshot.ethBtcRatio, "ethBtcRatio"),
  };
}

function calculateQuantile(sortedValues: number[], quantile: number): number {
  if (sortedValues.length === 0) throw new Error("Cannot calculate quantile of empty array.");
  const index = quantile * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const fraction = index - lower;
  return sortedValues[lower] * (1 - fraction) + sortedValues[upper] * fraction;
}

function areThresholdsSeparated(thresholds: CryptoRegimeThresholds): boolean {
  return (
    thresholds.expansion.maxBtcRealizedVol < thresholds.contraction.minBtcRealizedVol &&
    thresholds.contraction.maxEthBtcRatio < thresholds.expansion.minEthBtcRatio
  );
}

function resolveThresholds(options?: CryptoRegimeClassifierOptions): CryptoRegimeThresholds {
  if (options?.thresholds) return options.thresholds;

  const dataset = options?.calibrationDataset;
  if (!dataset || dataset.length < MINIMUM_CALIBRATION_SAMPLE_SIZE) {
    return DEFAULT_CRYPTO_REGIME_THRESHOLDS;
  }

  const volValues = dataset
    .map((s) => getFeatureVector(s).btcRealizedVol)
    .sort((a, b) => a - b);
  const ratioValues = dataset
    .map((s) => getFeatureVector(s).ethBtcRatio)
    .sort((a, b) => a - b);

  const calibrated: CryptoRegimeThresholds = {
    expansion: {
      maxBtcRealizedVol: calculateQuantile(volValues, EXPANSION_QUANTILE),
      minEthBtcRatio: calculateQuantile(ratioValues, CONTRACTION_QUANTILE),
    },
    contraction: {
      minBtcRealizedVol: calculateQuantile(volValues, CONTRACTION_QUANTILE),
      maxEthBtcRatio: calculateQuantile(ratioValues, EXPANSION_QUANTILE),
    },
  };

  return areThresholdsSeparated(calibrated) ? calibrated : DEFAULT_CRYPTO_REGIME_THRESHOLDS;
}

function getVolatilitySignal(btcRealizedVol: number, thresholds: CryptoRegimeThresholds): RegimeSignal {
  if (btcRealizedVol <= thresholds.expansion.maxBtcRealizedVol) return 1;
  if (btcRealizedVol >= thresholds.contraction.minBtcRealizedVol) return -1;
  return 0;
}

function getStructureSignal(ethBtcRatio: number, thresholds: CryptoRegimeThresholds): RegimeSignal {
  if (ethBtcRatio >= thresholds.expansion.minEthBtcRatio) return 1;
  if (ethBtcRatio <= thresholds.contraction.maxEthBtcRatio) return -1;
  return 0;
}

export function classifyCryptoRegime(
  snapshot: CryptoRegimeClassifiableSnapshot,
  options?: CryptoRegimeClassifierOptions,
): CryptoRegimeState {
  const { btcRealizedVol, ethBtcRatio } = getFeatureVector(snapshot);
  const thresholds = resolveThresholds(options);
  const volSignal = getVolatilitySignal(btcRealizedVol, thresholds);
  const structureSignal = getStructureSignal(ethBtcRatio, thresholds);

  if (volSignal === 1 && structureSignal >= 0) return "EXPANSION";
  if (structureSignal === 1 && volSignal >= 0) return "EXPANSION";
  if (volSignal === -1 && structureSignal <= 0) return "CONTRACTION";
  if (structureSignal === -1 && volSignal <= 0) return "CONTRACTION";
  return "NEUTRAL";
}

export function filterCryptoDatasetByRegime<
  TSnapshot extends CryptoRegimeClassifiableSnapshot,
>(
  currentSnapshot: TSnapshot,
  historicalDataset: readonly TSnapshot[],
): TSnapshot[] {
  const options: CryptoRegimeClassifierOptions = { calibrationDataset: historicalDataset };
  const currentRegime = classifyCryptoRegime(currentSnapshot, options);
  return historicalDataset.filter(
    (s) => classifyCryptoRegime(s, options) === currentRegime,
  );
}
