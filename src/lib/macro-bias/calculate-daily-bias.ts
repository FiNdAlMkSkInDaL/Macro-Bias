import { calculateDecayedDistance } from "../../utils/knn";
import {
  ANALOG_MODEL_SETTINGS,
  BIAS_SIGNAL_WEIGHTS,
} from "./constants";
import type {
  AnalogFeatureKey,
  AnalogStateVector,
  BiasComponentResult,
  BiasLabel,
  BiasPillarKey,
  DailyBiasInput,
  DailyBiasResult,
  HistoricalAnalogMatch,
  HistoricalAnalogVector,
} from "./types";

const FEATURE_ORDER: AnalogFeatureKey[] = [
  "spyRsi",
  "gammaExposure",
  "hygTltRatio",
  "cperGldRatio",
  "usoMomentum",
  "vixLevel",
];

const PILLAR_ORDER: BiasPillarKey[] = [
  "trendAndMomentum",
  "creditAndRiskSpreads",
  "volatility",
  "positioning",
];

const FEATURE_TO_PILLAR: Record<AnalogFeatureKey, BiasPillarKey> = {
  spyRsi: "trendAndMomentum",
  gammaExposure: "positioning",
  hygTltRatio: "creditAndRiskSpreads",
  cperGldRatio: "creditAndRiskSpreads",
  usoMomentum: "creditAndRiskSpreads",
  vixLevel: "volatility",
};

type FeatureStatistics = Record<
  AnalogFeatureKey,
  {
    mean: number;
    standardDeviation: number;
  }
>;

type NeighborWithStandardizedVector = {
  analog: HistoricalAnalogVector;
  distance: number;
  standardizedVector: AnalogStateVector;
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
  if (values.length === 0) {
    throw new Error("Cannot calculate a mean from an empty array.");
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function populationStandardDeviation(values: number[]) {
  if (values.length === 0) {
    throw new Error("Cannot calculate a standard deviation from an empty array.");
  }

  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));

  return Math.sqrt(variance);
}

function formatSignedPercent(value: number, decimals = 2) {
  return `${value > 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

function getBiasLabel(score: number): BiasLabel {
  if (score <= -60) {
    return "EXTREME_RISK_OFF";
  }

  if (score < -20) {
    return "RISK_OFF";
  }

  if (score <= 20) {
    return "NEUTRAL";
  }

  if (score < 60) {
    return "RISK_ON";
  }

  return "EXTREME_RISK_ON";
}

function assertFiniteNumber(value: number | undefined, label: string): number {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`Missing or invalid numeric input for ${label}.`);
  }

  return value;
}

// Today's vector is the market fingerprint the engine will match against history.
// Ratios are level-based because they describe cross-asset leadership right now,
// gamma captures market-plumbing positioning, and USO uses a 5-session momentum
// term to reduce daily noise in the energy tape.
function buildTodayStateVector(input: DailyBiasInput): AnalogStateVector {
  const expandedData = input.expandedData;

  if (!expandedData) {
    throw new Error("The KNN model requires expandedData inputs to build today's vector.");
  }

  return {
    spyRsi: assertFiniteNumber(expandedData.spy14DayRsi, "SPY RSI"),
    gammaExposure:
      expandedData.gammaExposure == null
        ? 0
        : assertFiniteNumber(expandedData.gammaExposure, "dealer gamma exposure"),
    hygTltRatio:
      assertFiniteNumber(expandedData.hyg?.close, "HYG close") /
      assertFiniteNumber(input.tickerChanges.TLT.close, "TLT close"),
    cperGldRatio:
      assertFiniteNumber(expandedData.cper?.close, "CPER close") /
      assertFiniteNumber(input.tickerChanges.GLD.close, "GLD close"),
    usoMomentum: assertFiniteNumber(expandedData.uso5DayMomentum, "USO 5-day momentum"),
    vixLevel: assertFiniteNumber(expandedData.vix?.close, "VIX close"),
  };
}

function getHistoricalAnalogVectors(input: DailyBiasInput): HistoricalAnalogVector[] {
  const historicalAnalogVectors = input.expandedData?.historicalAnalogVectors;

  if (!historicalAnalogVectors || historicalAnalogVectors.length === 0) {
    throw new Error("The KNN model requires a populated historicalAnalogVectors array.");
  }

  if (historicalAnalogVectors.length < ANALOG_MODEL_SETTINGS.minimumHistoricalAnalogs) {
    throw new Error(
      `The KNN model needs at least ${ANALOG_MODEL_SETTINGS.minimumHistoricalAnalogs} historical analogs; only ${historicalAnalogVectors.length} were provided.`,
    );
  }

  return historicalAnalogVectors;
}

// Euclidean distance only makes sense if each dimension lives on a comparable scale.
// The engine therefore z-scores every feature using the historical sample before
// comparing today's vector to the past.
function buildFeatureStatistics(historicalAnalogs: HistoricalAnalogVector[]): FeatureStatistics {
  return FEATURE_ORDER.reduce<FeatureStatistics>((statistics, feature) => {
    const values = historicalAnalogs.map((analog) => analog.vector[feature]);
    const standardDeviation = populationStandardDeviation(values);

    statistics[feature] = {
      mean: mean(values),
      standardDeviation: standardDeviation > 1e-9 ? standardDeviation : 1,
    };

    return statistics;
  }, {} as FeatureStatistics);
}

function standardizeVector(
  vector: AnalogStateVector,
  featureStatistics: FeatureStatistics,
): AnalogStateVector {
  return FEATURE_ORDER.reduce<AnalogStateVector>((standardizedVector, feature) => {
    standardizedVector[feature] =
      (vector[feature] - featureStatistics[feature].mean) /
      featureStatistics[feature].standardDeviation;

    return standardizedVector;
  }, {} as AnalogStateVector);
}

function buildNeighborMatches(
  todayTradeDate: string,
  todayVector: AnalogStateVector,
  historicalAnalogs: HistoricalAnalogVector[],
) {
  const featureStatistics = buildFeatureStatistics(historicalAnalogs);
  const standardizedTodayVector = standardizeVector(todayVector, featureStatistics);
  const standardizedTodaySnapshot = {
    tradeDate: todayTradeDate,
    vector: standardizedTodayVector,
  };

  const nearestNeighbors = historicalAnalogs
    .map<NeighborWithStandardizedVector>((analog) => {
      const standardizedVector = standardizeVector(analog.vector, featureStatistics);

      return {
        analog,
        distance: calculateDecayedDistance(
          standardizedTodaySnapshot,
          {
            tradeDate: analog.tradeDate,
            vector: standardizedVector,
          },
          ANALOG_MODEL_SETTINGS.temporalDecayLambda,
        ),
        standardizedVector,
      };
    })
    .sort((leftNeighbor, rightNeighbor) => leftNeighbor.distance - rightNeighbor.distance)
    .slice(0, ANALOG_MODEL_SETTINGS.nearestNeighborCount);

  if (nearestNeighbors.length < ANALOG_MODEL_SETTINGS.nearestNeighborCount) {
    throw new Error(
      `The KNN model requires ${ANALOG_MODEL_SETTINGS.nearestNeighborCount} nearest neighbors, but only ${nearestNeighbors.length} were available.`,
    );
  }

  return {
    nearestNeighbors,
    standardizedTodayVector,
  };
}

function buildExpectancySummary(nearestNeighbors: NeighborWithStandardizedVector[]): ExpectancySummary {
  const averageForward1DayReturn = mean(
    nearestNeighbors.map((neighbor) => neighbor.analog.spyForward1DayReturn),
  );
  const averageForward3DayReturn = mean(
    nearestNeighbors.map((neighbor) => neighbor.analog.spyForward3DayReturn),
  );
  const bearishHitRate1Day =
    nearestNeighbors.filter((neighbor) => neighbor.analog.spyForward1DayReturn < 0).length /
    nearestNeighbors.length;
  const bearishHitRate3Day =
    nearestNeighbors.filter((neighbor) => neighbor.analog.spyForward3DayReturn < 0).length /
    nearestNeighbors.length;

  return {
    analogDates: nearestNeighbors.map((neighbor) => neighbor.analog.tradeDate),
    averageForward1DayReturn: roundTo(averageForward1DayReturn),
    averageForward3DayReturn: roundTo(averageForward3DayReturn),
    bearishHitRate1Day: roundTo(bearishHitRate1Day, 4),
    bearishHitRate3Day: roundTo(bearishHitRate3Day, 4),
    blendedForwardReturn: roundTo(averageForward1DayReturn * 0.4 + averageForward3DayReturn * 0.6),
  };
}

// The analog engine is nonlinear by design. We first translate the 5-neighbor
// forward-return expectancy into a blended percentage return, then pass it through
// tanh so outsized analog clusters saturate gracefully toward +/-100.
function mapExpectancyToScore(expectancySummary: ExpectancySummary) {
  const normalizedExpectancy =
    expectancySummary.blendedForwardReturn / ANALOG_MODEL_SETTINGS.blendedReturnScale;

  return clamp(Math.round(Math.tanh(normalizedExpectancy) * 100), -100, 100);
}

function buildNeighborCentroid(
  nearestNeighbors: NeighborWithStandardizedVector[],
  vectorAccessor: (neighbor: NeighborWithStandardizedVector) => AnalogStateVector,
): AnalogStateVector {
  return FEATURE_ORDER.reduce<AnalogStateVector>((centroid, feature) => {
    centroid[feature] = mean(
      nearestNeighbors.map((neighbor) => vectorAccessor(neighbor)[feature]),
    );

    return centroid;
  }, {} as AnalogStateVector);
}

function buildAnalogMatches(nearestNeighbors: NeighborWithStandardizedVector[]): HistoricalAnalogMatch[] {
  return nearestNeighbors.map((neighbor) => ({
    distance: roundTo(neighbor.distance, 4),
    spyForward1DayReturn: roundTo(neighbor.analog.spyForward1DayReturn),
    spyForward3DayReturn: roundTo(neighbor.analog.spyForward3DayReturn),
    tradeDate: neighbor.analog.tradeDate,
  }));
}

// Even though the final score comes from KNN expectancy, the dashboard still needs
// four Glass Box diagnostics. We allocate the final score across pillars according
// to how closely each pillar's feature block aligns with the centroid of the nearest
// analog cluster in standardized feature space.
function buildPillarSimilarityShares(
  standardizedTodayVector: AnalogStateVector,
  standardizedNeighborCentroid: AnalogStateVector,
) {
  const rawSimilarityByPillar = PILLAR_ORDER.reduce<Record<BiasPillarKey, number>>(
    (similarities, pillar) => {
      const featureKeys = FEATURE_ORDER.filter((feature) => FEATURE_TO_PILLAR[feature] === pillar);
      const pillarDistance = Math.sqrt(
        featureKeys.reduce((total, feature) => {
          const delta =
            standardizedTodayVector[feature] - standardizedNeighborCentroid[feature];

          return total + delta ** 2;
        }, 0),
      );

      similarities[pillar] = 1 / (1 + pillarDistance);

      return similarities;
    },
    {} as Record<BiasPillarKey, number>,
  );

  const totalSimilarity = Object.values(rawSimilarityByPillar).reduce(
    (total, value) => total + value,
    0,
  );

  return PILLAR_ORDER.reduce<Record<BiasPillarKey, number>>((shares, pillar) => {
    shares[pillar] =
      totalSimilarity > 0 ? rawSimilarityByPillar[pillar] / totalSimilarity : 1 / PILLAR_ORDER.length;

    return shares;
  }, {} as Record<BiasPillarKey, number>);
}

function allocatePillarContributions(score: number, similarityShares: Record<BiasPillarKey, number>) {
  const roundedContributions = PILLAR_ORDER.map((pillar) =>
    roundTo(score * similarityShares[pillar]),
  );
  const roundedTotal = roundedContributions.reduce((total, contribution) => total + contribution, 0);
  const residual = roundTo(score - roundedTotal);

  roundedContributions[roundedContributions.length - 1] = roundTo(
    roundedContributions[roundedContributions.length - 1] + residual,
  );

  return Object.fromEntries(
    PILLAR_ORDER.map((pillar, index) => [pillar, roundedContributions[index]]),
  ) as Record<BiasPillarKey, number>;
}

function buildPillarSummary(
  pillar: BiasPillarKey,
  todayVector: AnalogStateVector,
  expectancySummary: ExpectancySummary,
) {
  if (pillar === "trendAndMomentum") {
    return (
      `SPY RSI is ${roundTo(todayVector.spyRsi, 1)}, which ` +
      `${todayVector.spyRsi >= 60
        ? "shows buyers still have control and keeps continuation setups in play. "
        : todayVector.spyRsi <= 40
          ? "shows momentum is soft, which raises the risk of failed bounces and heavier selling pressure. "
          : "shows a mixed momentum backdrop, so follow-through may need stronger confirmation from price. "}` +
      `In similar sessions, SPY averaged ${formatSignedPercent(expectancySummary.averageForward1DayReturn)} over 1 day and ${formatSignedPercent(expectancySummary.averageForward3DayReturn)} over 3 days.`
    );
  }

  if (pillar === "creditAndRiskSpreads") {
    return (
      `HYG/TLT is ${roundTo(todayVector.hygTltRatio, 4)}, CPER/GLD is ${roundTo(todayVector.cperGldRatio, 4)}, and USO momentum is ${formatSignedPercent(todayVector.usoMomentum)}. ` +
      `That mix helps show whether risk appetite is broadening or fading beneath the index. Firmer readings usually help breakouts hold, while weaker readings tend to produce thinner rallies and more defensive rotation. ` +
      `In similar sessions, downside showed up ${roundTo(expectancySummary.bearishHitRate1Day * 100, 0)}% of the time over 1 day and ${roundTo(expectancySummary.bearishHitRate3Day * 100, 0)}% of the time over 3 days.`
    );
  }

  if (pillar === "positioning") {
    return (
      `Dealer gamma exposure is ${roundTo(todayVector.gammaExposure, 2)}. ` +
      `${todayVector.gammaExposure > 0
        ? "That usually means options positioning is more likely to absorb moves, which can keep intraday swings tighter and favor mean reversion."
        : todayVector.gammaExposure < 0
          ? "That usually means options positioning can amplify moves, which raises the odds of fast trend days and wider intraday ranges."
          : "That leaves options positioning close to neutral, so price is more likely to respond directly to incoming flow and headlines."}`
    );
  }

  return (
    `VIX is ${roundTo(todayVector.vixLevel, 2)}. ` +
    `${todayVector.vixLevel >= 25
      ? "That points to a stressed tape where intraday ranges can stay wide and reversals can come fast. "
      : todayVector.vixLevel >= 18
        ? "That keeps the tape sensitive, so moves may need wider risk limits and quicker profit-taking. "
        : "That points to a calmer tape, which usually gives continuation setups a cleaner path. "}` +
    `In similar volatility conditions, the blended short-term move leaned ${formatSignedPercent(expectancySummary.blendedForwardReturn)}.`
  );
}

function buildComponentScores(
  score: number,
  todayVector: AnalogStateVector,
  nearestNeighbors: NeighborWithStandardizedVector[],
  standardizedTodayVector: AnalogStateVector,
  expectancySummary: ExpectancySummary,
) {
  const standardizedNeighborCentroid = buildNeighborCentroid(
    nearestNeighbors,
    (neighbor) => neighbor.standardizedVector,
  );
  const similarityShares = buildPillarSimilarityShares(
    standardizedTodayVector,
    standardizedNeighborCentroid,
  );
  const contributionsByPillar = allocatePillarContributions(score, similarityShares);
  const analogMatches = buildAnalogMatches(nearestNeighbors);

  return PILLAR_ORDER.map<BiasComponentResult>((pillar) => {
    const weight = BIAS_SIGNAL_WEIGHTS[pillar];
    const contribution = contributionsByPillar[pillar];
    const signal = clamp(contribution / weight, -1, 1);

    return {
      analogDates: expectancySummary.analogDates,
      analogMatches,
      averageForward1DayReturn: expectancySummary.averageForward1DayReturn,
      averageForward3DayReturn: expectancySummary.averageForward3DayReturn,
      bearishHitRate1Day: expectancySummary.bearishHitRate1Day,
      bearishHitRate3Day: expectancySummary.bearishHitRate3Day,
      contribution,
      key: pillar,
      pillar,
      signal: roundTo(signal, 4),
      summary: buildPillarSummary(pillar, todayVector, expectancySummary),
      weight,
    };
  });
}

// Historical analog engine:
// 1. Build today's 6-factor vector.
// 2. Standardize it against the historical distribution.
// 3. Measure Euclidean distance in z-scored space and apply temporal decay.
// 4. Take the 5 nearest adjusted matches.
// 5. Average their 1-day and 3-day forward SPY returns.
// 6. Map that forward-return expectancy back onto the legacy -100 to +100 score scale.
export function calculateDailyBias(input: DailyBiasInput): DailyBiasResult {
  const todayVector = buildTodayStateVector(input);
  const historicalAnalogs = getHistoricalAnalogVectors(input);
  const { nearestNeighbors, standardizedTodayVector } = buildNeighborMatches(
    input.tradeDate,
    todayVector,
    historicalAnalogs,
  );
  const expectancySummary = buildExpectancySummary(nearestNeighbors);
  const score = mapExpectancyToScore(expectancySummary);
  const componentScores = buildComponentScores(
    score,
    todayVector,
    nearestNeighbors,
    standardizedTodayVector,
    expectancySummary,
  );

  return {
    tradeDate: input.tradeDate,
    score,
    label: getBiasLabel(score),
    componentScores,
    tickerChanges: input.tickerChanges,
  };
}