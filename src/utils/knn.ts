export type KnnDistanceVector = Record<string, number>;

export type KnnSnapshot<TVector extends KnnDistanceVector = KnnDistanceVector> = {
  tradeDate: string;
  vector: TVector;
};

export const DEFAULT_TEMPORAL_DECAY_LAMBDA = 0.001;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function parseCalendarDateToUtcTimestamp(tradeDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tradeDate);

  if (!match) {
    throw new Error(`Expected an ISO trade date in YYYY-MM-DD format, received "${tradeDate}".`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  return Date.UTC(year, month - 1, day);
}

function assertFiniteNumber(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`Expected ${label} to be a finite number.`);
  }

  return value;
}

function getComparableFeatureKeys<TVector extends KnnDistanceVector>(
  currentSnapshot: KnnSnapshot<TVector>,
  historicalSnapshot: KnnSnapshot<TVector>,
) {
  const featureKeys = Object.keys(currentSnapshot.vector) as Array<keyof TVector>;

  if (featureKeys.length === 0) {
    throw new Error("Cannot calculate KNN distance for an empty feature vector.");
  }

  for (const featureKey of featureKeys) {
    if (!(featureKey in historicalSnapshot.vector)) {
      throw new Error(`Historical snapshot is missing the "${String(featureKey)}" feature.`);
    }
  }

  return featureKeys;
}

function getCalendarDayDifference(currentTradeDate: string, historicalTradeDate: string) {
  const currentTimestamp = parseCalendarDateToUtcTimestamp(currentTradeDate);
  const historicalTimestamp = parseCalendarDateToUtcTimestamp(historicalTradeDate);

  return Math.abs(Math.round((currentTimestamp - historicalTimestamp) / MILLISECONDS_PER_DAY));
}

export function calculateEuclideanDistance<TVector extends KnnDistanceVector>(
  currentSnapshot: KnnSnapshot<TVector>,
  historicalSnapshot: KnnSnapshot<TVector>,
) {
  const featureKeys = getComparableFeatureKeys(currentSnapshot, historicalSnapshot);
  const squaredDistance = featureKeys.reduce((total, featureKey) => {
    const currentValue = assertFiniteNumber(
      currentSnapshot.vector[featureKey],
      `current snapshot ${String(featureKey)}`,
    );
    const historicalValue = assertFiniteNumber(
      historicalSnapshot.vector[featureKey],
      `historical snapshot ${String(featureKey)}`,
    );
    const delta = currentValue - historicalValue;

    return total + delta ** 2;
  }, 0);

  return Math.sqrt(squaredDistance);
}

export function calculateDecayedDistance<TVector extends KnnDistanceVector>(
  currentSnapshot: KnnSnapshot<TVector>,
  historicalSnapshot: KnnSnapshot<TVector>,
  lambda = DEFAULT_TEMPORAL_DECAY_LAMBDA,
) {
  if (!Number.isFinite(lambda) || lambda < 0) {
    throw new Error("Temporal decay lambda must be a finite number greater than or equal to zero.");
  }

  const baseDistance = calculateEuclideanDistance(currentSnapshot, historicalSnapshot);
  const calendarDayDifference = getCalendarDayDifference(
    currentSnapshot.tradeDate,
    historicalSnapshot.tradeDate,
  );

  return baseDistance * Math.exp(lambda * calendarDayDifference);
}