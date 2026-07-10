export type KnnDistanceVector = Record<string, number>;

export type KnnSnapshot<TVector extends KnnDistanceVector = KnnDistanceVector> = {
  tradeDate: string;
  vector: TVector;
};

/** Distance geometry for analog matching. Cosine = 1 − cos(sim) on feature vectors. */
export type KnnDistanceMetric = "euclidean" | "cosine";

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
  featureKeys?: ReadonlyArray<keyof TVector & string>,
) {
  const keys = (featureKeys?.length
    ? [...featureKeys]
    : (Object.keys(currentSnapshot.vector) as Array<keyof TVector & string>)) as Array<
    keyof TVector & string
  >;

  if (keys.length === 0) {
    throw new Error("Cannot calculate KNN distance for an empty feature vector.");
  }

  for (const featureKey of keys) {
    if (!(featureKey in historicalSnapshot.vector)) {
      throw new Error(`Historical snapshot is missing the "${String(featureKey)}" feature.`);
    }
    if (!(featureKey in currentSnapshot.vector)) {
      throw new Error(`Current snapshot is missing the "${String(featureKey)}" feature.`);
    }
  }

  return keys;
}

function getCalendarDayDifference(currentTradeDate: string, historicalTradeDate: string) {
  const currentTimestamp = parseCalendarDateToUtcTimestamp(currentTradeDate);
  const historicalTimestamp = parseCalendarDateToUtcTimestamp(historicalTradeDate);

  return Math.abs(Math.round((currentTimestamp - historicalTimestamp) / MILLISECONDS_PER_DAY));
}

export function calculateEuclideanDistance<TVector extends KnnDistanceVector>(
  currentSnapshot: KnnSnapshot<TVector>,
  historicalSnapshot: KnnSnapshot<TVector>,
  featureKeys?: ReadonlyArray<keyof TVector & string>,
) {
  const keys = getComparableFeatureKeys(currentSnapshot, historicalSnapshot, featureKeys);
  const squaredDistance = keys.reduce((total, featureKey) => {
    const currentValue = assertFiniteNumber(
      currentSnapshot.vector[featureKey] as number,
      `current snapshot ${String(featureKey)}`,
    );
    const historicalValue = assertFiniteNumber(
      historicalSnapshot.vector[featureKey] as number,
      `historical snapshot ${String(featureKey)}`,
    );
    const delta = currentValue - historicalValue;

    return total + delta ** 2;
  }, 0);

  return Math.sqrt(squaredDistance);
}

/**
 * Cosine distance = 1 − cosine similarity on the selected features.
 * Range [0, 2]. Zero vectors are treated as distance 1 (neutral mid).
 * Measured (v10): beats Euclidean on next-session open→close fair metrics.
 */
export function calculateCosineDistance<TVector extends KnnDistanceVector>(
  currentSnapshot: KnnSnapshot<TVector>,
  historicalSnapshot: KnnSnapshot<TVector>,
  featureKeys?: ReadonlyArray<keyof TVector & string>,
) {
  const keys = getComparableFeatureKeys(currentSnapshot, historicalSnapshot, featureKeys);

  let dot = 0;
  let normCurrent = 0;
  let normHistorical = 0;

  for (const featureKey of keys) {
    const currentValue = assertFiniteNumber(
      currentSnapshot.vector[featureKey] as number,
      `current snapshot ${String(featureKey)}`,
    );
    const historicalValue = assertFiniteNumber(
      historicalSnapshot.vector[featureKey] as number,
      `historical snapshot ${String(featureKey)}`,
    );
    dot += currentValue * historicalValue;
    normCurrent += currentValue * currentValue;
    normHistorical += historicalValue * historicalValue;
  }

  if (normCurrent <= 0 || normHistorical <= 0) {
    return 1;
  }

  const cosine = dot / (Math.sqrt(normCurrent) * Math.sqrt(normHistorical));
  // Numerical clamp into [-1, 1]
  const clipped = Math.min(1, Math.max(-1, cosine));
  return 1 - clipped;
}

export function calculateBaseDistance<TVector extends KnnDistanceVector>(
  currentSnapshot: KnnSnapshot<TVector>,
  historicalSnapshot: KnnSnapshot<TVector>,
  metric: KnnDistanceMetric = "euclidean",
  featureKeys?: ReadonlyArray<keyof TVector & string>,
) {
  if (metric === "cosine") {
    return calculateCosineDistance(currentSnapshot, historicalSnapshot, featureKeys);
  }
  return calculateEuclideanDistance(currentSnapshot, historicalSnapshot, featureKeys);
}

export function calculateDecayedDistance<TVector extends KnnDistanceVector>(
  currentSnapshot: KnnSnapshot<TVector>,
  historicalSnapshot: KnnSnapshot<TVector>,
  lambda = DEFAULT_TEMPORAL_DECAY_LAMBDA,
  metric: KnnDistanceMetric = "euclidean",
  featureKeys?: ReadonlyArray<keyof TVector & string>,
) {
  if (!Number.isFinite(lambda) || lambda < 0) {
    throw new Error("Temporal decay lambda must be a finite number greater than or equal to zero.");
  }

  const baseDistance = calculateBaseDistance(
    currentSnapshot,
    historicalSnapshot,
    metric,
    featureKeys,
  );
  const calendarDayDifference = getCalendarDayDifference(
    currentSnapshot.tradeDate,
    historicalSnapshot.tradeDate,
  );

  return baseDistance * Math.exp(lambda * calendarDayDifference);
}

/** True when tradeDate (YYYY-MM-DD, US equity session) falls on Monday UTC. */
export function isUsEquityMonday(tradeDate: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tradeDate);
  if (!match) return false;
  const day = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0),
  ).getUTCDay();
  return day === 1;
}
