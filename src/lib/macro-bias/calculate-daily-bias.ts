import { classifyRegime, type RegimeState } from "../../utils/regime-classifier";
import { calculateBaseDistance, isUsEquityMonday } from "../../utils/knn";
import {
  buildTradableSignal,
  inverseDistanceWeight,
  weightedMean,
} from "../signal";
import type { TradableSignal } from "../signal";
import { trendSignFromCloseVsSma } from "../signal/trend-veto";
import {
  ANALOG_MODEL_SETTINGS,
  BIAS_SIGNAL_WEIGHTS,
  MODEL_VERSION,
  STOCKS_KNN_FEATURE_KEYS,
  STRATEGY_RULES,
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

/** Full vector keys (includes vixLevel for regime/display). */
const FEATURE_ORDER: AnalogFeatureKey[] = [
  "spyRsi",
  "vixMomentum",
  "hygTltRatio",
  "cperGldRatio",
  "usoMomentum",
  "vixLevel",
];

/** KNN distance keys only (v8 ablation). */
const KNN_FEATURE_ORDER: AnalogFeatureKey[] = [...STOCKS_KNN_FEATURE_KEYS];

const PILLAR_ORDER: BiasPillarKey[] = [
  "trendAndMomentum",
  "creditAndRiskSpreads",
  "volatility",
  "positioning",
];

const FEATURE_TO_PILLAR: Record<AnalogFeatureKey, BiasPillarKey> = {
  spyRsi: "trendAndMomentum",
  vixMomentum: "volatility",
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
  weight: number;
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

/**
 * Resolve vixMomentum with legacy gammaExposure fallback so older payloads still score.
 */
function resolveVixMomentum(expandedData: NonNullable<DailyBiasInput["expandedData"]>): number {
  if (expandedData.vixMomentum != null && Number.isFinite(expandedData.vixMomentum)) {
    return expandedData.vixMomentum;
  }

  if (expandedData.gammaExposure != null && Number.isFinite(expandedData.gammaExposure)) {
    return expandedData.gammaExposure;
  }

  return 0;
}

// Today's vector is the market fingerprint the engine will match against history.
// Ratios are level-based because they describe cross-asset leadership right now,
// vixMomentum captures short-horizon vol impulse (honestly named; not dealer GEX),
// and USO uses a 5-session momentum term to reduce daily noise in the energy tape.
function buildTodayStateVector(input: DailyBiasInput): AnalogStateVector {
  const expandedData = input.expandedData;

  if (!expandedData) {
    throw new Error("The KNN model requires expandedData inputs to build today's vector.");
  }

  // Level features: prefer walk-forward percentiles (model v6+) when present.
  const hygTltRatio =
    expandedData.hygTltRatioPercentile != null &&
    Number.isFinite(expandedData.hygTltRatioPercentile)
      ? expandedData.hygTltRatioPercentile
      : assertFiniteNumber(expandedData.hyg?.close, "HYG close") /
        assertFiniteNumber(input.tickerChanges.TLT.close, "TLT close");

  const cperGldRatio =
    expandedData.cperGldRatioPercentile != null &&
    Number.isFinite(expandedData.cperGldRatioPercentile)
      ? expandedData.cperGldRatioPercentile
      : assertFiniteNumber(expandedData.cper?.close, "CPER close") /
        assertFiniteNumber(input.tickerChanges.GLD.close, "GLD close");

  const vixLevel =
    expandedData.vixLevelPercentile != null && Number.isFinite(expandedData.vixLevelPercentile)
      ? expandedData.vixLevelPercentile
      : assertFiniteNumber(expandedData.vix?.close, "VIX close");

  return {
    spyRsi: assertFiniteNumber(expandedData.spy14DayRsi, "SPY RSI"),
    vixMomentum: resolveVixMomentum(expandedData),
    hygTltRatio,
    cperGldRatio,
    usoMomentum: assertFiniteNumber(expandedData.uso5DayMomentum, "USO 5-day momentum"),
    vixLevel,
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

  // Normalize legacy gammaExposure key on vectors if present.
  return historicalAnalogVectors.map((analog) => {
    const vector = analog.vector as AnalogStateVector & { gammaExposure?: number };
    if (vector.vixMomentum == null && vector.gammaExposure != null) {
      return {
        ...analog,
        vector: {
          spyRsi: vector.spyRsi,
          vixMomentum: vector.gammaExposure,
          hygTltRatio: vector.hygTltRatio,
          cperGldRatio: vector.cperGldRatio,
          usoMomentum: vector.usoMomentum,
          vixLevel: vector.vixLevel,
        },
      };
    }

    return analog;
  });
}

function buildFeatureStatistics(historicalAnalogs: HistoricalAnalogVector[]): FeatureStatistics {
  // Z-score only KNN features used in distance; still fill full vector keys for safety.
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

/** Distance on ablated KNN feature set only (cosine in v10, was Euclidean in v8). */
function knnDistance(a: AnalogStateVector, b: AnalogStateVector): number {
  return calculateBaseDistance(
    { tradeDate: "1970-01-01", vector: a },
    { tradeDate: "1970-01-01", vector: b },
    ANALOG_MODEL_SETTINGS.distanceMetric,
    KNN_FEATURE_ORDER,
  );
}

/**
 * After a large same-day SPY move, shrink the analog score and fade the day
 * (mean-reversion nudge). Measured v11 on next-session open→close.
 */
export function applyFadeBigDay(
  score: number,
  sameDayCtcPct: number | null | undefined,
): number {
  if (!ANALOG_MODEL_SETTINGS.fadeBigDayEnabled) return score;
  if (sameDayCtcPct == null || !Number.isFinite(sameDayCtcPct)) return score;
  const thr = ANALOG_MODEL_SETTINGS.fadeBigDayThresholdPct;
  if (Math.abs(sameDayCtcPct) <= thr) return score;
  const scaled = score * ANALOG_MODEL_SETTINGS.fadeBigDayScoreScale;
  const push =
    -Math.sign(sameDayCtcPct) * ANALOG_MODEL_SETTINGS.fadeBigDayPushPoints;
  return clamp(Math.round(scaled + push), -100, 100);
}

/**
 * Overnight gap = open vs prior close (%). Positive = gap up.
 * Returns null when open/previousClose unavailable.
 */
export function computeOvernightGapPct(
  open: number | null | undefined,
  previousClose: number | null | undefined,
): number | null {
  if (
    open == null ||
    previousClose == null ||
    !Number.isFinite(open) ||
    !Number.isFinite(previousClose) ||
    previousClose <= 0
  ) {
    return null;
  }
  return ((open - previousClose) / previousClose) * 100;
}

/**
 * If KNN lean fights the overnight gap by more than threshold, zero the score.
 * Measured v12: hit ~55% edge ~+0.31 on next-session OTC (yE+/yH+ 6/7).
 */
export function applyOvernightVeto(
  score: number,
  overnightGapPct: number | null | undefined,
  scoreThreshold = STRATEGY_RULES.scoreThreshold,
): number {
  if (!ANALOG_MODEL_SETTINGS.overnightVetoEnabled) return score;
  if (overnightGapPct == null || !Number.isFinite(overnightGapPct)) return score;
  const thr = ANALOG_MODEL_SETTINGS.overnightVetoThresholdPct;
  if (score > scoreThreshold && overnightGapPct < -thr) return 0;
  if (score < -scoreThreshold && overnightGapPct > thr) return 0;
  return score;
}

/** Population stdev of neighbor blended forward returns. */
export function neighborReturnDispersion(blendedReturns: number[]): number {
  if (blendedReturns.length < 2) return 0;
  const m = mean(blendedReturns);
  const variance =
    blendedReturns.reduce((sum, value) => sum + (value - m) ** 2, 0) /
    blendedReturns.length;
  return Math.sqrt(variance);
}

/**
 * Force flat when the neighbor cluster is suspiciously tight (low return dispersion).
 * Measured v14 on next-session OTC.
 */
export function applyLowNeighborVolFlat(
  score: number,
  blendedReturns: number[],
): number {
  if (!ANALOG_MODEL_SETTINGS.flatLowNeighborVolEnabled) return score;
  const sd = neighborReturnDispersion(blendedReturns);
  if (sd < ANALOG_MODEL_SETTINGS.flatLowNeighborVolThreshold) return 0;
  return score;
}

/**
 * Soft overnight amplify: ×up when gap agrees with lean, ×down when it mildly
 * disagrees. Hard overnight veto still applied separately for big fights.
 * Measured v14.
 */
export function applySoftOvernightAmp(
  score: number,
  overnightGapPct: number | null | undefined,
  scoreThreshold = STRATEGY_RULES.scoreThreshold,
): number {
  if (!ANALOG_MODEL_SETTINGS.softOvernightAmpEnabled) return score;
  if (overnightGapPct == null || !Number.isFinite(overnightGapPct)) return score;
  const gap = ANALOG_MODEL_SETTINGS.softOvernightAmpGapPct;
  const up = ANALOG_MODEL_SETTINGS.softOvernightAmpUp;
  const down = ANALOG_MODEL_SETTINGS.softOvernightAmpDown;
  if (score > scoreThreshold && overnightGapPct > gap) {
    return clamp(Math.round(score * up), -100, 100);
  }
  if (score < -scoreThreshold && overnightGapPct < -gap) {
    return clamp(Math.round(score * up), -100, 100);
  }
  if (score > scoreThreshold && overnightGapPct < -gap) {
    return clamp(Math.round(score * down), -100, 100);
  }
  if (score < -scoreThreshold && overnightGapPct > gap) {
    return clamp(Math.round(score * down), -100, 100);
  }
  return score;
}

/** Monday publish dampener: neutral score + FLAT (measured v10 package). */
function applyMondayDampener(
  tradeDate: string,
  score: number,
  signal: TradableSignal,
): { score: number; signal: TradableSignal } {
  if (!ANALOG_MODEL_SETTINGS.skipMondayScores || !isUsEquityMonday(tradeDate)) {
    return { score, signal };
  }

  if (signal.position === "NO_TRADE") {
    return {
      score: 0,
      signal: {
        ...signal,
        reason: `Monday dampener: ${signal.reason}`,
      },
    };
  }

  return {
    score: 0,
    signal: {
      ...signal,
      position: "FLAT",
      size: 0,
      noTrade: false,
      reason:
        "Monday publish dampener. Analogs may lean, but Monday scores are withheld (measured noise).",
    },
  };
}

/**
 * Prefer same-regime analogs when enough exist; otherwise fall back to full history.
 */
function filterAnalogsByRegime(
  todayVector: AnalogStateVector,
  historicalAnalogs: HistoricalAnalogVector[],
): { pool: HistoricalAnalogVector[]; regime: RegimeState; regimeFiltered: boolean } {
  const regime = classifyRegime(todayVector, { calibrationDataset: historicalAnalogs });
  const sameRegime = historicalAnalogs.filter(
    (analog) => classifyRegime(analog.vector, { calibrationDataset: historicalAnalogs }) === regime,
  );

  if (sameRegime.length >= ANALOG_MODEL_SETTINGS.minimumHistoricalAnalogs) {
    return { pool: sameRegime, regime, regimeFiltered: true };
  }

  return { pool: historicalAnalogs, regime, regimeFiltered: false };
}

/** VIX-regime adaptive K (v18): high vol → K=5, calm → K=7. */
export function selectNeighborK(vixLevel: number): number {
  if (!ANALOG_MODEL_SETTINGS.adaptiveNeighborKEnabled) {
    return ANALOG_MODEL_SETTINGS.nearestNeighborCount;
  }
  return vixLevel >= ANALOG_MODEL_SETTINGS.adaptiveKVixThreshold
    ? ANALOG_MODEL_SETTINGS.adaptiveKHighVix
    : ANALOG_MODEL_SETTINGS.adaptiveKLowVix;
}

/**
 * Dual-arm agreement (v18): only keep a lean when temporal-decay and no-decay
 * scores share a sign. Average magnitudes when they agree.
 */
export function applyDualNoDecayAgree(
  scoreWithDecay: number,
  scoreNoDecay: number,
): number {
  if (!ANALOG_MODEL_SETTINGS.dualNoDecayAgreeEnabled) {
    return scoreWithDecay;
  }
  if (scoreWithDecay === 0 || scoreNoDecay === 0) return 0;
  if (Math.sign(scoreWithDecay) !== Math.sign(scoreNoDecay)) return 0;
  return clamp(Math.round((scoreWithDecay + scoreNoDecay) / 2), -100, 100);
}

function buildNeighborMatches(
  todayTradeDate: string,
  todayVector: AnalogStateVector,
  historicalAnalogs: HistoricalAnalogVector[],
  options?: {
    temporalDecayLambda?: number;
    neighborCount?: number;
  },
) {
  const { pool, regime, regimeFiltered } = filterAnalogsByRegime(todayVector, historicalAnalogs);
  const featureStatistics = buildFeatureStatistics(pool);
  const standardizedTodayVector = standardizeVector(todayVector, featureStatistics);

  const minGap = ANALOG_MODEL_SETTINGS.minAnalogCalendarGapDays;
  const lambda =
    options?.temporalDecayLambda ?? ANALOG_MODEL_SETTINGS.temporalDecayLambda;
  const k = options?.neighborCount ?? selectNeighborK(todayVector.vixLevel);

  const ranked = pool
    .filter(
      (analog) => calendarDaysBetween(todayTradeDate, analog.tradeDate) >= minGap,
    )
    .map<NeighborWithStandardizedVector>((analog) => {
      const standardizedVector = standardizeVector(analog.vector, featureStatistics);
      // Distance on KNN features only (not full vector / not vixLevel).
      const base = knnDistance(standardizedTodayVector, standardizedVector);
      const dayDiff = calendarDaysBetween(todayTradeDate, analog.tradeDate);
      const distance = base * Math.exp(lambda * dayDiff);

      return {
        analog,
        distance,
        weight: inverseDistanceWeight(
          distance,
          ANALOG_MODEL_SETTINGS.distanceWeightEpsilon,
        ),
        standardizedVector,
      };
    })
    .sort((leftNeighbor, rightNeighbor) => leftNeighbor.distance - rightNeighbor.distance);

  if (ranked.length < k) {
    throw new Error(
      `The KNN model requires at least ${k} nearest neighbors, but only ${ranked.length} were available.`,
    );
  }

  // Fixed K slice (radius expansion disabled when kMax === kMin historically).
  const nearestNeighbors = ranked.slice(0, k);

  return {
    nearestNeighbors,
    standardizedTodayVector,
    regime,
    regimeFiltered,
  };
}

/** Full post-processing chain from a neighbor set → pre-Monday score. */
function scoreFromNeighborArm(
  nearestNeighbors: NeighborWithStandardizedVector[],
  sameDayCtc: number | null | undefined,
  overnightGap: number | null,
): number {
  const expectancySummary = buildExpectancySummary(nearestNeighbors);
  const w1 = ANALOG_MODEL_SETTINGS.oneDayBlendWeight;
  const w3 = ANALOG_MODEL_SETTINGS.threeDayBlendWeight;
  const blendedNeighborReturns = nearestNeighbors.map(
    (neighbor) =>
      neighbor.analog.spyForward1DayReturn * w1 + neighbor.analog.spyForward3DayReturn * w3,
  );

  let score = mapExpectancyToScore(expectancySummary);
  score = applyLowNeighborVolFlat(score, blendedNeighborReturns);
  score = applyFadeBigDay(score, sameDayCtc);
  score = applySoftOvernightAmp(score, overnightGap);
  score = applyOvernightVeto(score, overnightGap);
  return score;
}

function buildExpectancySummary(nearestNeighbors: NeighborWithStandardizedVector[]): ExpectancySummary {
  const weights = nearestNeighbors.map((neighbor) => neighbor.weight);
  const forward1d = nearestNeighbors.map((neighbor) => neighbor.analog.spyForward1DayReturn);
  const forward3d = nearestNeighbors.map((neighbor) => neighbor.analog.spyForward3DayReturn);

  const averageForward1DayReturn = weightedMean(forward1d, weights);
  const averageForward3DayReturn = weightedMean(forward3d, weights);

  // Unweighted hit rates for interpretability.
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
    blendedForwardReturn: roundTo(
      averageForward1DayReturn * ANALOG_MODEL_SETTINGS.oneDayBlendWeight +
        averageForward3DayReturn * ANALOG_MODEL_SETTINGS.threeDayBlendWeight,
    ),
  };
}

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
    weight: roundTo(neighbor.weight, 4),
  }));
}

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
      `HYG/TLT percentile is ${roundTo(todayVector.hygTltRatio, 1)}, CPER/GLD percentile is ${roundTo(todayVector.cperGldRatio, 1)}, and USO momentum is ${formatSignedPercent(todayVector.usoMomentum)}. ` +
      `Percentile ranks compare credit and commodity risk appetite to the last year of history, so drifting ratio levels do not dominate the match. ` +
      `In similar sessions, downside showed up ${roundTo(expectancySummary.bearishHitRate1Day * 100, 0)}% of the time over 1 day and ${roundTo(expectancySummary.bearishHitRate3Day * 100, 0)}% of the time over 3 days.`
    );
  }

  if (pillar === "positioning") {
    return (
      `VIX 5-session momentum proxy is ${roundTo(todayVector.vixMomentum, 2)} (negative of VIX % change; not dealer gamma). ` +
      `${todayVector.vixMomentum > 0
        ? "Vol impulse is cooling, which often favors mean reversion and tighter ranges."
        : todayVector.vixMomentum < 0
          ? "Vol impulse is rising, which raises the odds of fast trend days and wider ranges."
          : "Vol impulse is near flat, so price is more likely to respond directly to flow and headlines."}`
    );
  }

  return (
    `Vol impulse (VIX momentum proxy) is ${roundTo(todayVector.vixMomentum, 2)}; VIX level percentile is ${roundTo(todayVector.vixLevel, 1)} for context. ` +
    `${todayVector.vixMomentum < 0
      ? "Vol is rising, so ranges can stay wide. "
      : todayVector.vixMomentum > 0
        ? "Vol is cooling, which often favors cleaner follow-through. "
        : "Vol impulse is flat. "}` +
    `In similar conditions, the blended short-term move leaned ${formatSignedPercent(expectancySummary.blendedForwardReturn)}.`
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

/**
 * Historical analog engine (model v18):
 * 1. Build today's factor vector.
 * 2. Regime pool + cosine distance; adaptive K by VIX.
 * 3. Dual arms: temporal-decay KNN + no-decay KNN; require sign agreement.
 * 4. Per-arm: low-vol flat, fade big day, soft overnight amp, hard overnight veto.
 * 5. Tradable permission + Monday dampener.
 */
export function calculateDailyBias(input: DailyBiasInput): DailyBiasResult {
  const todayVector = buildTodayStateVector(input);
  const historicalAnalogs = getHistoricalAnalogVectors(input);
  const k = selectNeighborK(todayVector.vixLevel);

  const primary = buildNeighborMatches(input.tradeDate, todayVector, historicalAnalogs, {
    temporalDecayLambda: ANALOG_MODEL_SETTINGS.temporalDecayLambda,
    neighborCount: k,
  });
  const { nearestNeighbors, standardizedTodayVector } = primary;

  const sameDayCtc = input.tickerChanges.SPY?.percentChange;
  const spySnap = input.tickerChanges.SPY;
  const overnightGap = computeOvernightGapPct(spySnap?.open, spySnap?.previousClose);

  const scoreWithDecay = scoreFromNeighborArm(
    nearestNeighbors,
    sameDayCtc,
    overnightGap,
  );

  let vetoedScore = scoreWithDecay;
  let dualNote: string | null = null;
  if (ANALOG_MODEL_SETTINGS.dualNoDecayAgreeEnabled) {
    const noDecayNeighbors = buildNeighborMatches(
      input.tradeDate,
      todayVector,
      historicalAnalogs,
      { temporalDecayLambda: 0, neighborCount: k },
    ).nearestNeighbors;
    const scoreNoDecay = scoreFromNeighborArm(
      noDecayNeighbors,
      sameDayCtc,
      overnightGap,
    );
    const dualScore = applyDualNoDecayAgree(scoreWithDecay, scoreNoDecay);
    if (dualScore === 0 && (scoreWithDecay !== 0 || scoreNoDecay !== 0)) {
      dualNote = `dual no-decay disagree (decay=${scoreWithDecay}, noDecay=${scoreNoDecay})`;
    } else if (
      dualScore !== 0 &&
      dualScore !== scoreWithDecay &&
      scoreWithDecay !== 0 &&
      scoreNoDecay !== 0
    ) {
      dualNote = `dual no-decay agree (avg of ${scoreWithDecay} and ${scoreNoDecay})`;
    }
    vetoedScore = dualScore;
  }

  const expectancySummary = buildExpectancySummary(nearestNeighbors);
  const w1 = ANALOG_MODEL_SETTINGS.oneDayBlendWeight;
  const w3 = ANALOG_MODEL_SETTINGS.threeDayBlendWeight;
  const blendedNeighborReturns = nearestNeighbors.map(
    (neighbor) =>
      neighbor.analog.spyForward1DayReturn * w1 + neighbor.analog.spyForward3DayReturn * w3,
  );
  const dispersion = neighborReturnDispersion(blendedNeighborReturns);

  const spyClose = spySnap?.close;
  const spySma = input.expandedData?.spy20DaySma;
  const trendSign = ANALOG_MODEL_SETTINGS.enableTrendVeto
    ? trendSignFromCloseVsSma(spyClose ?? Number.NaN, spySma)
    : 0;
  const volPercentile =
    todayVector.vixLevel >= 0 && todayVector.vixLevel <= 100 ? todayVector.vixLevel : null;

  const rawSignal = buildTradableSignal({
    score: vetoedScore,
    neighborForwardReturns: blendedNeighborReturns,
    neighborDistances: nearestNeighbors.map((neighbor) => neighbor.distance),
    rules: STRATEGY_RULES,
    trendVeto: ANALOG_MODEL_SETTINGS.enableTrendVeto
      ? { trendSign, volPercentile }
      : undefined,
  });

  // Annotate structural post-processing for the glass box.
  let signalForPublish = rawSignal;
  const notes: string[] = [];
  if (ANALOG_MODEL_SETTINGS.adaptiveNeighborKEnabled) {
    notes.push(`adaptive K=${k} (VIX level ${roundTo(todayVector.vixLevel, 1)})`);
  }
  if (dualNote) notes.push(dualNote);
  if (
    dispersion < ANALOG_MODEL_SETTINGS.flatLowNeighborVolThreshold &&
    scoreWithDecay === 0
  ) {
    notes.push(
      `low neighbor-vol flat (dispersion ${dispersion.toFixed(2)} < ${ANALOG_MODEL_SETTINGS.flatLowNeighborVolThreshold})`,
    );
  }
  if (notes.length > 0) {
    signalForPublish = {
      ...rawSignal,
      reason: `${notes.join("; ")}. ${rawSignal.reason}`,
    };
  }

  const { score, signal } = applyMondayDampener(
    input.tradeDate,
    vetoedScore,
    signalForPublish,
  );

  // Component glass-box uses the published (possibly dampened) score so pillars match UI.
  const componentScores = buildComponentScores(
    score,
    todayVector,
    nearestNeighbors,
    standardizedTodayVector,
    expectancySummary,
  );

  // Keep the published score for delivery. Trading permission lives on `signal`.
  // When the model refuses a trade, surface NEUTRAL so UI does not imply a lean.
  const label = signal.position === "NO_TRADE" ? "NEUTRAL" : getBiasLabel(score);

  return {
    tradeDate: input.tradeDate,
    score,
    label,
    componentScores,
    tickerChanges: input.tickerChanges,
    signal,
    blendedForwardReturn: expectancySummary.blendedForwardReturn,
    modelVersion: MODEL_VERSION,
  };
}
