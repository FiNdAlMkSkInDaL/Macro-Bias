import { calculateDecayedDistance } from "../../utils/knn";
import { CRYPTO_ANALOG_MODEL_SETTINGS } from "./constants";
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

// macroCorrelation contains 3 features (btcGldRatio, dxyMomentum, tltMomentum) vs 1 each
// for the other pillars. Weight it proportionally to avoid diluting those signals.
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

function buildTodayStateVector(input: CryptoDailyBiasInput): CryptoAnalogStateVector {
  const d = input.expandedData;
  if (!d) throw new Error("The crypto KNN model requires expandedData.");

  return {
    btcRsi: assertFiniteNumber(d.btc14DayRsi, "BTC RSI"),
    ethBtcRatio: assertFiniteNumber(d.ethBtcRatio, "ETH/BTC ratio"),
    btcGldRatio: assertFiniteNumber(d.btcGldRatio, "BTC/GLD ratio"),
    dxyMomentum: assertFiniteNumber(d.dxyMomentum, "DXY momentum"),
    btcRealizedVol: assertFiniteNumber(d.btcRealizedVol, "BTC realized vol"),
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

function buildNeighborMatches(
  todayDate: string,
  todayVector: CryptoAnalogStateVector,
  analogs: CryptoHistoricalAnalogVector[],
) {
  const stats = buildFeatureStatistics(analogs);
  const zToday = standardizeVector(todayVector, stats);
  const todaySnapshot = { tradeDate: todayDate, vector: zToday };

  const neighbors = analogs
    .map<NeighborWithStandardizedVector>((analog) => {
      const zAnalog = standardizeVector(analog.vector, stats);
      return {
        analog,
        distance: calculateDecayedDistance(
          todaySnapshot,
          { tradeDate: analog.tradeDate, vector: zAnalog },
          CRYPTO_ANALOG_MODEL_SETTINGS.temporalDecayLambda,
        ),
        standardizedVector: zAnalog,
      };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, CRYPTO_ANALOG_MODEL_SETTINGS.nearestNeighborCount);

  if (neighbors.length < CRYPTO_ANALOG_MODEL_SETTINGS.nearestNeighborCount) {
    throw new Error(
      `Need ${CRYPTO_ANALOG_MODEL_SETTINGS.nearestNeighborCount} neighbors, got ${neighbors.length}.`,
    );
  }

  return { nearestNeighbors: neighbors, standardizedTodayVector: zToday };
}

function buildExpectancySummary(neighbors: NeighborWithStandardizedVector[]): ExpectancySummary {
  const avg1d = mean(neighbors.map((n) => n.analog.btcForward1DayReturn));
  const avg3d = mean(neighbors.map((n) => n.analog.btcForward3DayReturn));
  const bearish1d = neighbors.filter((n) => n.analog.btcForward1DayReturn < 0).length / neighbors.length;
  const bearish3d = neighbors.filter((n) => n.analog.btcForward3DayReturn < 0).length / neighbors.length;

  return {
    analogDates: neighbors.map((n) => n.analog.tradeDate),
    averageForward1DayReturn: roundTo(avg1d),
    averageForward3DayReturn: roundTo(avg3d),
    bearishHitRate1Day: roundTo(bearish1d, 4),
    bearishHitRate3Day: roundTo(bearish3d, 4),
    blendedForwardReturn: roundTo(avg1d * 0.4 + avg3d * 0.6),
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
      `ETH/BTC ratio is ${roundTo(todayVector.ethBtcRatio, 5)}. ` +
      `${todayVector.ethBtcRatio >= 0.055
        ? "Alts are gaining on Bitcoin, which usually signals broader risk appetite in crypto."
        : todayVector.ethBtcRatio <= 0.035
          ? "Bitcoin is dominating at the expense of alts, which tends to happen when the market is defensive or uncertain."
          : "The ratio is middle-of-the-road, so neither BTC dominance nor alt season is clearly in control."}`
    );
  }
  if (pillar === "macroCorrelation") {
    return (
      `BTC/GLD ratio is ${roundTo(todayVector.btcGldRatio, 2)}, DXY momentum is ${formatSignedPercent(todayVector.dxyMomentum)}, and TLT momentum is ${formatSignedPercent(todayVector.tltMomentum)}. ` +
      `A stronger dollar and rising rates tend to weigh on BTC, while gold strength relative to BTC usually flags a risk-off macro backdrop. ` +
      `In similar conditions, the blended forward move was ${formatSignedPercent(summary.blendedForwardReturn)}.`
    );
  }
  return (
    `BTC realized vol is ${roundTo(todayVector.btcRealizedVol, 1)}%. ` +
    `${todayVector.btcRealizedVol >= 80
      ? "That is elevated, which means bigger swings and more uncertainty. "
      : todayVector.btcRealizedVol >= 55
        ? "Vol is moderate, keeping BTC responsive to catalysts. "
        : "Vol is low by crypto standards, which usually gives trends a cleaner path. "}` +
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

  return {
    tradeDate: input.tradeDate,
    score,
    label: getBiasLabel(score),
    componentScores: components,
    tickerChanges: input.tickerChanges,
  };
}
