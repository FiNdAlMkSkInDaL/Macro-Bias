import { calculateDecayedDistance } from "../../utils/knn";
import {
  buildTradableSignal,
  CRYPTO_STRATEGY_RULES,
  inverseDistanceWeight,
  weightedMean,
} from "../signal";
import { CRYPTO_ANALOG_MODEL_SETTINGS, CRYPTO_MODEL_VERSION } from "./constants";
import type {
  BiasLabel,
  CryptoAnalogFeatureKey,
  CryptoAnalogStateVector,
  CryptoBiasComponentResult,
  CryptoDailyBiasInput,
  CryptoDailyBiasResult,
  CryptoHistoricalAnalogMatch,
  CryptoHistoricalAnalogVector,
} from "./types";

const FEATURE_ORDER: CryptoAnalogFeatureKey[] = [
  "btcRsi",
  "ethBtcRatio",
  "btcGldRatio",
  "dxyMomentum",
  "btcRealizedVol",
  "tltMomentum",
];

const PILLAR_ORDER = [
  "trendAndMomentum",
  "cryptoStructure",
  "macroCorrelation",
  "volatility",
] as const;

type CryptoPillarKey = (typeof PILLAR_ORDER)[number];

const FEATURE_TO_PILLAR: Record<CryptoAnalogFeatureKey, CryptoPillarKey> = {
  btcRsi: "trendAndMomentum",
  ethBtcRatio: "cryptoStructure",
  btcGldRatio: "macroCorrelation",
  dxyMomentum: "macroCorrelation",
  btcRealizedVol: "volatility",
  tltMomentum: "macroCorrelation",
};

const PILLAR_WEIGHTS: Record<CryptoPillarKey, number> = {
  trendAndMomentum: 20,
  cryptoStructure: 20,
  macroCorrelation: 40,
  volatility: 20,
};

type FeatureStatistics = Record<
  CryptoAnalogFeatureKey,
  { mean: number; standardDeviation: number }
>;

type NeighborWithStandardizedVector = {
  analog: CryptoHistoricalAnalogVector;
  distance: number;
  weight: number;
  standardizedVector: CryptoAnalogStateVector;
};

type ExpectancySummary = {
  analogDates: string[];
  averageForward1DayReturn: number;
  averageForward3DayReturn: number;
  bearishHitRate1Day: number;
  bearishHitRate3Day: number;
  blendedForwardReturn: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function mean(values: number[]) {
  if (values.length === 0) throw new Error("Cannot calculate mean from empty array.");
  return values.reduce((t, v) => t + v, 0) / values.length;
}

function populationStandardDeviation(values: number[]) {
  if (values.length === 0) throw new Error("Cannot calculate stddev from empty array.");
  const avg = mean(values);
  const variance = mean(values.map((v) => (v - avg) ** 2));
  return Math.sqrt(variance);
}

function formatSignedPercent(value: number, decimals = 2) {
  return `${value > 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

function getBiasLabel(score: number): BiasLabel {
  if (score <= -60) return "EXTREME_RISK_OFF";
  if (score < -20) return "RISK_OFF";
  if (score <= 20) return "NEUTRAL";
  if (score < 60) return "RISK_ON";
  return "EXTREME_RISK_ON";
}

function assertFiniteNumber(value: number | undefined, label: string): number {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`Missing or invalid numeric input for ${label}.`);
  }
  return value;
}

const MS_PER_DAY = 86_400_000;

function calendarDaysBetween(a: string, b: string): number {
  return Math.abs(
    Math.round(
      (Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) -
        Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) /
        MS_PER_DAY,
    ),
  );
}

function buildTodayStateVector(input: CryptoDailyBiasInput): CryptoAnalogStateVector {
  const d = input.expandedData;
  if (!d) throw new Error("The crypto KNN model requires expandedData.");

  // Prefer walk-forward percentiles for trending level features (model v3+).
  const ethBtcRatio =
    d.ethBtcRatioPercentile != null && Number.isFinite(d.ethBtcRatioPercentile)
      ? d.ethBtcRatioPercentile
      : assertFiniteNumber(d.ethBtcRatio, "ETH/BTC ratio");
  const btcGldRatio =
    d.btcGldRatioPercentile != null && Number.isFinite(d.btcGldRatioPercentile)
      ? d.btcGldRatioPercentile
      : assertFiniteNumber(d.btcGldRatio, "BTC/GLD ratio");
  const btcRealizedVol =
    d.btcRealizedVolPercentile != null && Number.isFinite(d.btcRealizedVolPercentile)
      ? d.btcRealizedVolPercentile
      : assertFiniteNumber(d.btcRealizedVol, "BTC realized vol");

  return {
    btcRsi: assertFiniteNumber(d.btc14DayRsi, "BTC RSI"),
    ethBtcRatio,
    btcGldRatio,
    dxyMomentum: assertFiniteNumber(d.dxyMomentum, "DXY momentum"),
    btcRealizedVol,
    tltMomentum: assertFiniteNumber(d.tltMomentum, "TLT momentum"),
  };
}

function getHistoricalAnalogVectors(input: CryptoDailyBiasInput): CryptoHistoricalAnalogVector[] {
  const vectors = input.expandedData?.historicalAnalogVectors;
  if (!vectors || vectors.length === 0) {
    throw new Error("The crypto KNN model requires historicalAnalogVectors.");
  }
  if (vectors.length < CRYPTO_ANALOG_MODEL_SETTINGS.minimumHistoricalAnalogs) {
    throw new Error(
      `Need at least ${CRYPTO_ANALOG_MODEL_SETTINGS.minimumHistoricalAnalogs} analogs; got ${vectors.length}.`,
    );
  }
  return vectors;
}

function buildFeatureStatistics(analogs: CryptoHistoricalAnalogVector[]): FeatureStatistics {
  return FEATURE_ORDER.reduce<FeatureStatistics>((stats, feature) => {
    const values = analogs.map((a) => a.vector[feature]);
    const stdDev = populationStandardDeviation(values);
    stats[feature] = {
      mean: mean(values),
      standardDeviation: stdDev > 1e-9 ? stdDev : 1,
    };
    return stats;
  }, {} as FeatureStatistics);
}

function standardizeVector(
  vector: CryptoAnalogStateVector,
  stats: FeatureStatistics,
): CryptoAnalogStateVector {
  return FEATURE_ORDER.reduce<CryptoAnalogStateVector>((z, feature) => {
    z[feature] = (vector[feature] - stats[feature].mean) / stats[feature].standardDeviation;
    return z;
  }, {} as CryptoAnalogStateVector);
}

/**
 * Coarse crypto regime from RSI + realized vol so neighbors share market character.
 */
function classifyCryptoRegime(vector: CryptoAnalogStateVector): "HIGH_VOL" | "TREND" | "RANGE" {
  if (vector.btcRealizedVol >= 70) return "HIGH_VOL";
  if (vector.btcRsi >= 58 || vector.btcRsi <= 42) return "TREND";
  return "RANGE";
}

function filterAnalogsByRegime(
  todayVector: CryptoAnalogStateVector,
  analogs: CryptoHistoricalAnalogVector[],
) {
  const regime = classifyCryptoRegime(todayVector);
  const sameRegime = analogs.filter((a) => classifyCryptoRegime(a.vector) === regime);
  if (sameRegime.length >= CRYPTO_ANALOG_MODEL_SETTINGS.minimumHistoricalAnalogs) {
    return sameRegime;
  }
  return analogs;
}

function buildNeighborMatches(
  todayDate: string,
  todayVector: CryptoAnalogStateVector,
  analogs: CryptoHistoricalAnalogVector[],
) {
  const pool = filterAnalogsByRegime(todayVector, analogs);
  const stats = buildFeatureStatistics(pool);
  const zToday = standardizeVector(todayVector, stats);
  const todaySnapshot = { tradeDate: todayDate, vector: zToday };
  const minGap = CRYPTO_ANALOG_MODEL_SETTINGS.minAnalogCalendarGapDays;

  const ranked = pool
    .filter((analog) => calendarDaysBetween(todayDate, analog.tradeDate) >= minGap)
    .map<NeighborWithStandardizedVector>((analog) => {
      const zAnalog = standardizeVector(analog.vector, stats);
      const distance = calculateDecayedDistance(
        todaySnapshot,
        { tradeDate: analog.tradeDate, vector: zAnalog },
        CRYPTO_ANALOG_MODEL_SETTINGS.temporalDecayLambda,
      );
      return {
        analog,
        distance,
        weight: inverseDistanceWeight(
          distance,
          CRYPTO_ANALOG_MODEL_SETTINGS.distanceWeightEpsilon,
        ),
        standardizedVector: zAnalog,
      };
    })
    .sort((a, b) => a.distance - b.distance);

  const kMin = CRYPTO_ANALOG_MODEL_SETTINGS.nearestNeighborCount;
  const kMax = CRYPTO_ANALOG_MODEL_SETTINGS.maxNeighborCount;
  if (ranked.length < kMin) {
    throw new Error(`Need at least ${kMin} neighbors, got ${ranked.length}.`);
  }

  const kthDistance = ranked[kMin - 1].distance;
  const radius = kthDistance * CRYPTO_ANALOG_MODEL_SETTINGS.neighborRadiusMultiplier;
  const neighbors = ranked
    .filter((n, index) => index < kMin || n.distance <= radius)
    .slice(0, kMax);

  return { nearestNeighbors: neighbors, standardizedTodayVector: zToday };
}

function buildExpectancySummary(neighbors: NeighborWithStandardizedVector[]): ExpectancySummary {
  const weights = neighbors.map((n) => n.weight);
  const fwd1d = neighbors.map((n) => n.analog.btcForward1DayReturn);
  const fwd3d = neighbors.map((n) => n.analog.btcForward3DayReturn);
  const avg1d = weightedMean(fwd1d, weights);
  const avg3d = weightedMean(fwd3d, weights);
  const bearish1d = neighbors.filter((n) => n.analog.btcForward1DayReturn < 0).length / neighbors.length;
  const bearish3d = neighbors.filter((n) => n.analog.btcForward3DayReturn < 0).length / neighbors.length;

  return {
    analogDates: neighbors.map((n) => n.analog.tradeDate),
    averageForward1DayReturn: roundTo(avg1d),
    averageForward3DayReturn: roundTo(avg3d),
    bearishHitRate1Day: roundTo(bearish1d, 4),
    bearishHitRate3Day: roundTo(bearish3d, 4),
    blendedForwardReturn: roundTo(
      avg1d * CRYPTO_ANALOG_MODEL_SETTINGS.oneDayBlendWeight +
        avg3d * CRYPTO_ANALOG_MODEL_SETTINGS.threeDayBlendWeight,
    ),
  };
}

function mapExpectancyToScore(summary: ExpectancySummary) {
  const normalized = summary.blendedForwardReturn / CRYPTO_ANALOG_MODEL_SETTINGS.blendedReturnScale;
  return clamp(Math.round(Math.tanh(normalized) * 100), -100, 100);
}

function buildNeighborCentroid(
  neighbors: NeighborWithStandardizedVector[],
): CryptoAnalogStateVector {
  return FEATURE_ORDER.reduce<CryptoAnalogStateVector>((centroid, feature) => {
    centroid[feature] = mean(neighbors.map((n) => n.standardizedVector[feature]));
    return centroid;
  }, {} as CryptoAnalogStateVector);
}

function buildAnalogMatches(neighbors: NeighborWithStandardizedVector[]): CryptoHistoricalAnalogMatch[] {
  return neighbors.map((n) => ({
    distance: roundTo(n.distance, 4),
    btcForward1DayReturn: roundTo(n.analog.btcForward1DayReturn),
    btcForward3DayReturn: roundTo(n.analog.btcForward3DayReturn),
    tradeDate: n.analog.tradeDate,
    weight: roundTo(n.weight, 4),
  }));
}

function buildPillarSimilarityShares(
  zToday: CryptoAnalogStateVector,
  zCentroid: CryptoAnalogStateVector,
) {
  const raw = PILLAR_ORDER.reduce<Record<CryptoPillarKey, number>>((sims, pillar) => {
    const features = FEATURE_ORDER.filter((f) => FEATURE_TO_PILLAR[f] === pillar);
    const dist = Math.sqrt(
      features.reduce((t, f) => t + (zToday[f] - zCentroid[f]) ** 2, 0),
    );
    sims[pillar] = 1 / (1 + dist);
    return sims;
  }, {} as Record<CryptoPillarKey, number>);

  const total = Object.values(raw).reduce((t, v) => t + v, 0);
  return PILLAR_ORDER.reduce<Record<CryptoPillarKey, number>>((shares, pillar) => {
    shares[pillar] = total > 0 ? raw[pillar] / total : 1 / PILLAR_ORDER.length;
    return shares;
  }, {} as Record<CryptoPillarKey, number>);
}

function allocatePillarContributions(score: number, shares: Record<CryptoPillarKey, number>) {
  const contributions = PILLAR_ORDER.map((p) => roundTo(score * shares[p]));
  const roundedTotal = contributions.reduce((t, c) => t + c, 0);
  contributions[contributions.length - 1] = roundTo(contributions[contributions.length - 1] + (score - roundedTotal));

  return Object.fromEntries(
    PILLAR_ORDER.map((p, i) => [p, contributions[i]]),
  ) as Record<CryptoPillarKey, number>;
}

function buildPillarSummary(
  pillar: CryptoPillarKey,
  todayVector: CryptoAnalogStateVector,
  summary: ExpectancySummary,
) {
  if (pillar === "trendAndMomentum") {
    return (
      `BTC RSI is ${roundTo(todayVector.btcRsi, 1)}, which ` +
      `${todayVector.btcRsi >= 60
        ? "shows buyers are still pushing and continuation setups are in play. "
        : todayVector.btcRsi <= 40
          ? "shows momentum is fading, which raises the odds of more downside pressure. "
          : "is in a neutral range, so BTC could go either way from here. "}` +
      `In similar sessions, BTC averaged ${formatSignedPercent(summary.averageForward1DayReturn)} over 1 day and ${formatSignedPercent(summary.averageForward3DayReturn)} over 3 days.`
    );
  }
  if (pillar === "cryptoStructure") {
    return (
      `ETH/BTC percentile is ${roundTo(todayVector.ethBtcRatio, 1)} (rank vs ~1y history). ` +
      `${todayVector.ethBtcRatio >= 65
        ? "Alts are relatively strong versus Bitcoin, which usually signals broader risk appetite in crypto."
        : todayVector.ethBtcRatio <= 35
          ? "Bitcoin is relatively dominant versus alts, which tends to happen when the market is defensive or uncertain."
          : "Relative alt strength is middle-of-the-road, so neither BTC dominance nor alt season is clearly extreme."}`
    );
  }
  if (pillar === "macroCorrelation") {
    return (
      `BTC/GLD percentile is ${roundTo(todayVector.btcGldRatio, 1)}, DXY momentum is ${formatSignedPercent(todayVector.dxyMomentum)}, and TLT momentum is ${formatSignedPercent(todayVector.tltMomentum)}. ` +
      `Percentile ranks keep the BTC/gold relationship comparable across years instead of letting the absolute ratio trend dominate. ` +
      `In similar conditions, the blended forward move was ${formatSignedPercent(summary.blendedForwardReturn)}.`
    );
  }
  return (
    `BTC realized-vol percentile is ${roundTo(todayVector.btcRealizedVol, 1)}. ` +
    `${todayVector.btcRealizedVol >= 75
      ? "That is elevated versus recent history, which means bigger swings and more uncertainty. "
      : todayVector.btcRealizedVol >= 45
        ? "Vol is moderate relative to history, keeping BTC responsive to catalysts. "
        : "Vol is low relative to history, which usually gives trends a cleaner path. "}` +
    `In similar vol conditions, downside showed up ${roundTo(summary.bearishHitRate1Day * 100, 0)}% of the time over 1 day and ${roundTo(summary.bearishHitRate3Day * 100, 0)}% over 3 days.`
  );
}

function buildComponentScores(
  score: number,
  todayVector: CryptoAnalogStateVector,
  neighbors: NeighborWithStandardizedVector[],
  zToday: CryptoAnalogStateVector,
  summary: ExpectancySummary,
): CryptoBiasComponentResult[] {
  const zCentroid = buildNeighborCentroid(neighbors);
  const shares = buildPillarSimilarityShares(zToday, zCentroid);
  const contributions = allocatePillarContributions(score, shares);
  const analogMatches = buildAnalogMatches(neighbors);

  return PILLAR_ORDER.map<CryptoBiasComponentResult>((pillar) => {
    const weight = PILLAR_WEIGHTS[pillar];
    const contribution = contributions[pillar];
    const signal = clamp(contribution / weight, -1, 1);

    return {
      analogDates: summary.analogDates,
      analogMatches,
      averageForward1DayReturn: summary.averageForward1DayReturn,
      averageForward3DayReturn: summary.averageForward3DayReturn,
      bearishHitRate1Day: summary.bearishHitRate1Day,
      bearishHitRate3Day: summary.bearishHitRate3Day,
      contribution,
      key: pillar,
      pillar,
      signal: roundTo(signal, 4),
      summary: buildPillarSummary(pillar, todayVector, summary),
      weight,
    };
  });
}

export function calculateCryptoDailyBias(input: CryptoDailyBiasInput): CryptoDailyBiasResult {
  const todayVector = buildTodayStateVector(input);
  const analogs = getHistoricalAnalogVectors(input);
  const { nearestNeighbors, standardizedTodayVector } = buildNeighborMatches(
    input.tradeDate,
    todayVector,
    analogs,
  );
  const summary = buildExpectancySummary(nearestNeighbors);
  const score = mapExpectancyToScore(summary);
  const components = buildComponentScores(
    score,
    todayVector,
    nearestNeighbors,
    standardizedTodayVector,
    summary,
  );

  const w1 = CRYPTO_ANALOG_MODEL_SETTINGS.oneDayBlendWeight;
  const w3 = CRYPTO_ANALOG_MODEL_SETTINGS.threeDayBlendWeight;
  const blendedNeighborReturns = nearestNeighbors.map(
    (n) => n.analog.btcForward1DayReturn * w1 + n.analog.btcForward3DayReturn * w3,
  );

  // Trend proxy from RSI when no SMA is on the vector: oversold/overbought as soft trend.
  const trendSign =
    todayVector.btcRsi >= 55 ? 1 : todayVector.btcRsi <= 45 ? -1 : 0;
  const volPercentile =
    todayVector.btcRealizedVol >= 0 && todayVector.btcRealizedVol <= 100
      ? todayVector.btcRealizedVol
      : null;

  const signal = buildTradableSignal({
    score,
    neighborForwardReturns: blendedNeighborReturns,
    neighborDistances: nearestNeighbors.map((n) => n.distance),
    rules: CRYPTO_STRATEGY_RULES,
    trendVeto: CRYPTO_ANALOG_MODEL_SETTINGS.enableTrendVeto
      ? {
          trendSign: trendSign as -1 | 0 | 1,
          volPercentile,
          volStressThreshold: 75,
        }
      : undefined,
  });

  const label = signal.position === "NO_TRADE" ? "NEUTRAL" : getBiasLabel(score);

  return {
    tradeDate: input.tradeDate,
    score,
    label,
    componentScores: components,
    tickerChanges: input.tickerChanges,
    signal,
    blendedForwardReturn: summary.blendedForwardReturn,
    modelVersion: CRYPTO_MODEL_VERSION,
  };
}
