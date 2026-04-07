import {
  DEFAULT_TEMPORAL_DECAY_LAMBDA,
  calculateDecayedDistance,
} from "../../utils/knn";
import { filterDatasetByRegime } from "../../utils/regime-classifier";
import { ANALOG_MODEL_SETTINGS } from "../macro-bias/constants";
import { calculateRelativeStrengthIndex } from "../macro-bias/technical-analysis";
import type {
  AnalogStateVector,
  HistoricalAnalogMatch as PersistedHistoricalAnalogMatch,
  HistoricalAnalogVector,
} from "../macro-bias/types";

const FEATURE_TICKERS = ["SPY", "QQQ", "XLP", "TLT", "GLD", "USO", "VIX", "HYG", "CPER"] as const;
const ANALOG_FEATURE_COUNT = 6;

type HistoricalArrayPoint = {
  adjustedClose: number;
  close: number;
  high?: number;
  low?: number;
  open?: number;
  percentChangeFromPreviousClose: number | null;
  tradeDate: string;
};

type TickerSnapshotLike = {
  close: number;
  percentChange: number;
  previousClose: number;
  ticker: string;
  tradeDate: string;
};

type RankedAnalogMatch = {
  distance: number;
  tradeDate: string;
};

type FeatureStatistics = Record<
  keyof AnalogStateVector,
  {
    mean: number;
    standardDeviation: number;
  }
>;

export type HistoricalAnalogMatch = {
  intradayNet: number | null;
  matchConfidence: number;
  nextSessionDate: string;
  overnightGap: number | null;
  sessionRange: number | null;
  tradeDate: string;
};

export type HistoricalAnalogsPayload = {
  alignedSessionCount: number;
  candidateCount: number;
  clusterAveragePlaybook: {
    intradayNet: number | null;
    overnightGap: number | null;
    sessionRange: number | null;
  };
  featureTickers: string[];
  topMatches: HistoricalAnalogMatch[];
};

type DeriveHistoricalAnalogsOptions = {
  applyRegimeFilter?: boolean;
  allowedTradeDates?: ReadonlySet<string>;
  disablePersistedMatchFallback?: boolean;
  rollingWindowStartDate?: string;
};

const MAX_ANALOG_LOOKBACK_YEARS = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHistoricalArrayPoint(value: unknown): value is HistoricalArrayPoint {
  return (
    isRecord(value) &&
    typeof value.adjustedClose === "number" &&
    typeof value.close === "number" &&
    (value.high === undefined || typeof value.high === "number") &&
    (value.low === undefined || typeof value.low === "number") &&
    (value.open === undefined || typeof value.open === "number") &&
    typeof value.tradeDate === "string" &&
    (value.percentChangeFromPreviousClose === null ||
      typeof value.percentChangeFromPreviousClose === "number")
  );
}

function isTickerSnapshotLike(value: unknown): value is TickerSnapshotLike {
  return (
    isRecord(value) &&
    typeof value.close === "number" &&
    typeof value.percentChange === "number" &&
    typeof value.previousClose === "number" &&
    typeof value.ticker === "string" &&
    typeof value.tradeDate === "string"
  );
}

function isPersistedHistoricalAnalogMatch(
  value: unknown,
): value is PersistedHistoricalAnalogMatch {
  return (
    isRecord(value) &&
    typeof value.distance === "number" &&
    typeof value.spyForward1DayReturn === "number" &&
    typeof value.spyForward3DayReturn === "number" &&
    typeof value.tradeDate === "string"
  );
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

function calculatePercentChange(currentValue: number, previousValue: number) {
  if (previousValue === 0) {
    return null;
  }

  return roundTo(((currentValue - previousValue) / previousValue) * 100);
}

function averageNullable(values: Array<number | null>) {
  const numericValues = values.filter((value): value is number => typeof value === "number");

  if (numericValues.length === 0) {
    return null;
  }

  return roundTo(
    numericValues.reduce((total, value) => total + value, 0) / numericValues.length,
  );
}

function getNumericValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function collectSnapshots(source: unknown) {
  if (!isRecord(source)) {
    return {} as Record<string, TickerSnapshotLike>;
  }

  return Object.entries(source).reduce<Record<string, TickerSnapshotLike>>(
    (snapshots, [ticker, value]) => {
      if (!isTickerSnapshotLike(value)) {
        return snapshots;
      }

      snapshots[ticker] = value;
      return snapshots;
    },
    {},
  );
}

function getAlignedSessionCount(engineInputs: Record<string, unknown>, fallbackCount: number) {
  const analogModelUniverse = engineInputs.analogModelUniverse;

  if (!isRecord(analogModelUniverse)) {
    return fallbackCount;
  }

  const historicalSeriesSummary = analogModelUniverse.historicalSeriesSummary;

  if (!isRecord(historicalSeriesSummary)) {
    return fallbackCount;
  }

  const commonSessionCoverage = historicalSeriesSummary.commonSessionCoverage;

  if (!isRecord(commonSessionCoverage) || typeof commonSessionCoverage.sessionCount !== "number") {
    return fallbackCount;
  }

  return commonSessionCoverage.sessionCount;
}

function getFeatureTickers(
  engineInputs: Record<string, unknown>,
  historicalArrays: Record<string, HistoricalArrayPoint[]>,
) {
  const analogModelUniverse = engineInputs.analogModelUniverse;

  if (isRecord(analogModelUniverse) && Array.isArray(analogModelUniverse.tickers)) {
    const persistedTickers = analogModelUniverse.tickers.filter(
      (ticker): ticker is string => typeof ticker === "string",
    );

    if (persistedTickers.length > 0) {
      return persistedTickers;
    }
  }

  return FEATURE_TICKERS.filter((ticker) => historicalArrays[ticker]?.length);
}

function getTemporalDecayLambda(engineInputs: Record<string, unknown>) {
  const metadata = engineInputs.metadata;

  if (!isRecord(metadata)) {
    return DEFAULT_TEMPORAL_DECAY_LAMBDA;
  }

  const decayLambda = getNumericValue(metadata.decay_lambda);

  return decayLambda ?? DEFAULT_TEMPORAL_DECAY_LAMBDA;
}

function buildTradeDateLookup(points: HistoricalArrayPoint[]) {
  return new Map(points.map((point) => [point.tradeDate, point] as const));
}

function buildSortedCommonTradeDates(historicalArrays: Record<string, HistoricalArrayPoint[]>) {
  const commonTradeDates = FEATURE_TICKERS.reduce<Set<string> | null>((intersection, ticker) => {
    const series = historicalArrays[ticker];

    if (!series || series.length === 0) {
      return new Set<string>();
    }

    const tradeDates = new Set(series.map((point) => point.tradeDate));

    if (!intersection) {
      return tradeDates;
    }

    return new Set([...intersection].filter((tradeDate) => tradeDates.has(tradeDate)));
  }, null);

  return [...(commonTradeDates ?? [])].sort((left, right) => left.localeCompare(right));
}

function buildSpyRsiByTradeDate(spySeries: HistoricalArrayPoint[]) {
  const closes: number[] = [];
  const spyRsiByTradeDate: Record<string, number> = {};

  for (const point of spySeries) {
    closes.push(point.close);

    if (closes.length >= 15) {
      spyRsiByTradeDate[point.tradeDate] = calculateRelativeStrengthIndex(closes, 14);
    }
  }

  return spyRsiByTradeDate;
}

function buildUsoMomentumByTradeDate(
  usoSeries: HistoricalArrayPoint[],
  sortedCommonTradeDates: string[],
) {
  const usoHistoryByTradeDate = buildTradeDateLookup(usoSeries);
  const usoMomentumByTradeDate: Record<string, number> = {};

  for (
    let index = ANALOG_MODEL_SETTINGS.usoMomentumLookbackSessions;
    index < sortedCommonTradeDates.length;
    index += 1
  ) {
    const tradeDate = sortedCommonTradeDates[index];
    const lookbackTradeDate =
      sortedCommonTradeDates[index - ANALOG_MODEL_SETTINGS.usoMomentumLookbackSessions];
    const latestUsoPoint = usoHistoryByTradeDate.get(tradeDate);
    const previousUsoPoint = usoHistoryByTradeDate.get(lookbackTradeDate);

    if (!latestUsoPoint || !previousUsoPoint) {
      continue;
    }

    const momentum = calculatePercentChange(latestUsoPoint.close, previousUsoPoint.close);

    if (momentum === null) {
      continue;
    }

    usoMomentumByTradeDate[tradeDate] = momentum;
  }

  return usoMomentumByTradeDate;
}

function buildGammaExposureByTradeDate(
  vixSeries: HistoricalArrayPoint[],
  sortedCommonTradeDates: string[],
) {
  const vixHistoryByTradeDate = buildTradeDateLookup(vixSeries);
  const gammaExposureByTradeDate: Record<string, number> = {};

  for (
    let index = ANALOG_MODEL_SETTINGS.usoMomentumLookbackSessions;
    index < sortedCommonTradeDates.length;
    index += 1
  ) {
    const tradeDate = sortedCommonTradeDates[index];
    const lookbackTradeDate =
      sortedCommonTradeDates[index - ANALOG_MODEL_SETTINGS.usoMomentumLookbackSessions];
    const latestVixPoint = vixHistoryByTradeDate.get(tradeDate);
    const previousVixPoint = vixHistoryByTradeDate.get(lookbackTradeDate);

    if (!latestVixPoint || !previousVixPoint) {
      continue;
    }

    const vixRateOfChange = calculatePercentChange(latestVixPoint.close, previousVixPoint.close);

    if (vixRateOfChange === null) {
      continue;
    }

    gammaExposureByTradeDate[tradeDate] = roundTo(-vixRateOfChange);
  }

  return gammaExposureByTradeDate;
}

function buildHistoricalAnalogVectors(
  historicalArrays: Record<string, HistoricalArrayPoint[]>,
  sortedCommonTradeDates: string[],
) {
  const spyHistoryByTradeDate = buildTradeDateLookup(historicalArrays.SPY ?? []);
  const tltHistoryByTradeDate = buildTradeDateLookup(historicalArrays.TLT ?? []);
  const gldHistoryByTradeDate = buildTradeDateLookup(historicalArrays.GLD ?? []);
  const hygHistoryByTradeDate = buildTradeDateLookup(historicalArrays.HYG ?? []);
  const cperHistoryByTradeDate = buildTradeDateLookup(historicalArrays.CPER ?? []);
  const vixHistoryByTradeDate = buildTradeDateLookup(historicalArrays.VIX ?? []);
  const spyRsiByTradeDate = buildSpyRsiByTradeDate(historicalArrays.SPY ?? []);
  const usoMomentumByTradeDate = buildUsoMomentumByTradeDate(
    historicalArrays.USO ?? [],
    sortedCommonTradeDates,
  );
  const gammaExposureByTradeDate = buildGammaExposureByTradeDate(
    historicalArrays.VIX ?? [],
    sortedCommonTradeDates,
  );
  const historicalAnalogVectors: HistoricalAnalogVector[] = [];

  for (
    let index = ANALOG_MODEL_SETTINGS.usoMomentumLookbackSessions;
    index < sortedCommonTradeDates.length - 3;
    index += 1
  ) {
    const tradeDate = sortedCommonTradeDates[index];
    const nextTradeDate = sortedCommonTradeDates[index + 1];
    const thirdForwardTradeDate = sortedCommonTradeDates[index + 3];
    const currentSpyPoint = spyHistoryByTradeDate.get(tradeDate);
    const nextSpyPoint = spyHistoryByTradeDate.get(nextTradeDate);
    const thirdForwardSpyPoint = spyHistoryByTradeDate.get(thirdForwardTradeDate);
    const hygPoint = hygHistoryByTradeDate.get(tradeDate);
    const tltPoint = tltHistoryByTradeDate.get(tradeDate);
    const cperPoint = cperHistoryByTradeDate.get(tradeDate);
    const gldPoint = gldHistoryByTradeDate.get(tradeDate);
    const vixPoint = vixHistoryByTradeDate.get(tradeDate);
    const gammaExposure = gammaExposureByTradeDate[tradeDate];
    const spyRsi = spyRsiByTradeDate[tradeDate];
    const usoMomentum = usoMomentumByTradeDate[tradeDate];
    const spyForward1DayReturn =
      currentSpyPoint && nextSpyPoint
        ? calculatePercentChange(nextSpyPoint.close, currentSpyPoint.close)
        : null;
    const spyForward3DayReturn =
      currentSpyPoint && thirdForwardSpyPoint
        ? calculatePercentChange(thirdForwardSpyPoint.close, currentSpyPoint.close)
        : null;

    if (
      !currentSpyPoint ||
      !nextSpyPoint ||
      !thirdForwardSpyPoint ||
      !hygPoint ||
      !tltPoint ||
      !cperPoint ||
      !gldPoint ||
      !vixPoint ||
      gammaExposure == null ||
      spyRsi == null ||
      usoMomentum == null ||
      spyForward1DayReturn == null ||
      spyForward3DayReturn == null
    ) {
      continue;
    }

    historicalAnalogVectors.push({
      tradeDate,
      vector: {
        spyRsi,
        gammaExposure,
        hygTltRatio: hygPoint.close / tltPoint.close,
        cperGldRatio: cperPoint.close / gldPoint.close,
        usoMomentum,
        vixLevel: vixPoint.close,
      },
      spyForward1DayReturn,
      spyForward3DayReturn,
    });
  }

  return {
    gammaExposureByTradeDate,
    historicalAnalogVectors,
    usoMomentumByTradeDate,
  };
}

function buildCurrentAnalogStateVector(
  engineInputs: Record<string, unknown>,
  technicalIndicators: unknown,
  latestTradeDate: string,
  usoMomentumByTradeDate: Record<string, number>,
  gammaExposureByTradeDate: Record<string, number>,
) {
  const latestSnapshots = {
    ...collectSnapshots(engineInputs.coreTickerChanges),
    ...collectSnapshots(engineInputs.supplementalTickerChanges),
  };
  const marketPlumbing = isRecord(engineInputs.marketPlumbing) ? engineInputs.marketPlumbing : null;
  const spyIndicators = isRecord(technicalIndicators) ? technicalIndicators.SPY : null;
  const spyRsi = isRecord(spyIndicators) ? getNumericValue(spyIndicators.rsi14) : null;
  const usoMomentum = usoMomentumByTradeDate[latestTradeDate] ?? null;
  const hygClose = latestSnapshots.HYG?.close ?? null;
  const tltClose = latestSnapshots.TLT?.close ?? null;
  const cperClose = latestSnapshots.CPER?.close ?? null;
  const gldClose = latestSnapshots.GLD?.close ?? null;
  const vixClose = latestSnapshots.VIX?.close ?? null;
  const persistedGammaExposure = marketPlumbing ? getNumericValue(marketPlumbing.gammaExposure) : null;
  const gammaExposure = gammaExposureByTradeDate[latestTradeDate] ?? persistedGammaExposure;

  if (
    spyRsi == null ||
    usoMomentum == null ||
    hygClose == null ||
    tltClose == null ||
    cperClose == null ||
    gldClose == null ||
    vixClose == null
  ) {
    return null;
  }

  return {
    spyRsi,
    gammaExposure: gammaExposure ?? 0,
    hygTltRatio: hygClose / tltClose,
    cperGldRatio: cperClose / gldClose,
    usoMomentum,
    vixLevel: vixClose,
  } satisfies AnalogStateVector;
}

function subtractYearsFromTradeDate(tradeDate: string, years: number) {
  const referenceDate = new Date(`${tradeDate}T00:00:00Z`);
  referenceDate.setUTCFullYear(referenceDate.getUTCFullYear() - years);
  return referenceDate.toISOString().slice(0, 10);
}

function filterHistoricalArraysByStartDate(
  historicalArrays: Record<string, HistoricalArrayPoint[]>,
  startDate: string,
) {
  return Object.fromEntries(
    Object.entries(historicalArrays).map(([ticker, points]) => [
      ticker,
      points.filter((point) => point.tradeDate >= startDate),
    ]),
  ) as Record<string, HistoricalArrayPoint[]>;
}

function buildFeatureStatistics(historicalAnalogs: HistoricalAnalogVector[]): FeatureStatistics {
  const featureKeys = Object.keys(historicalAnalogs[0]?.vector ?? {}) as Array<
    keyof AnalogStateVector
  >;

  return featureKeys.reduce<FeatureStatistics>((statistics, featureKey) => {
    const values = historicalAnalogs.map((analog) => analog.vector[featureKey]);
    const standardDeviation = populationStandardDeviation(values);

    statistics[featureKey] = {
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
  const featureKeys = Object.keys(vector) as Array<keyof AnalogStateVector>;

  return featureKeys.reduce<AnalogStateVector>((standardizedVector, featureKey) => {
    standardizedVector[featureKey] =
      (vector[featureKey] - featureStatistics[featureKey].mean) /
      featureStatistics[featureKey].standardDeviation;

    return standardizedVector;
  }, {} as AnalogStateVector);
}

function buildReconstructedRankedMatches(
  engineInputs: Record<string, unknown>,
  historicalArrays: Record<string, HistoricalArrayPoint[]>,
  technicalIndicators: unknown,
  applyRegimeFilter?: boolean,
  allowedTradeDates?: ReadonlySet<string>,
) {
  const latestTradeDate =
    isRecord(engineInputs.tradeWindow) && typeof engineInputs.tradeWindow.latestTradeDate === "string"
      ? engineInputs.tradeWindow.latestTradeDate
      : null;

  if (!latestTradeDate) {
    return {
      candidateCount: 0,
      matches: [] as RankedAnalogMatch[],
    };
  }

  const sortedCommonTradeDates = buildSortedCommonTradeDates(historicalArrays);
  const {
    gammaExposureByTradeDate,
    historicalAnalogVectors,
    usoMomentumByTradeDate,
  } = buildHistoricalAnalogVectors(
    historicalArrays,
    sortedCommonTradeDates,
  );
  const filteredHistoricalAnalogVectors = historicalAnalogVectors.filter(
    (analog) => !allowedTradeDates || allowedTradeDates.has(analog.tradeDate),
  );
  const currentVector = buildCurrentAnalogStateVector(
    engineInputs,
    technicalIndicators,
    latestTradeDate,
    usoMomentumByTradeDate,
    gammaExposureByTradeDate,
  );

  if (!currentVector) {
    return {
      candidateCount: filteredHistoricalAnalogVectors.length,
      matches: [] as RankedAnalogMatch[],
    };
  }

  const regimeFilteredHistoricalAnalogVectors =
    applyRegimeFilter === true
      ? filterDatasetByRegime(currentVector, filteredHistoricalAnalogVectors)
      : filteredHistoricalAnalogVectors;

  const candidateHistoricalAnalogVectors =
    applyRegimeFilter === true &&
    regimeFilteredHistoricalAnalogVectors.length >= ANALOG_MODEL_SETTINGS.minimumHistoricalAnalogs
      ? regimeFilteredHistoricalAnalogVectors
      : filteredHistoricalAnalogVectors;

  if (candidateHistoricalAnalogVectors.length < ANALOG_MODEL_SETTINGS.nearestNeighborCount) {
    return {
      candidateCount: candidateHistoricalAnalogVectors.length,
      matches: [] as RankedAnalogMatch[],
    };
  }

  const featureStatistics = buildFeatureStatistics(candidateHistoricalAnalogVectors);
  const standardizedTodaySnapshot = {
    tradeDate: latestTradeDate,
    vector: standardizeVector(currentVector, featureStatistics),
  };
  const lambda = getTemporalDecayLambda(engineInputs);

  return {
    candidateCount: candidateHistoricalAnalogVectors.length,
    matches: candidateHistoricalAnalogVectors
      .map<RankedAnalogMatch>((analog) => ({
        distance: calculateDecayedDistance(
          standardizedTodaySnapshot,
          {
            tradeDate: analog.tradeDate,
            vector: standardizeVector(analog.vector, featureStatistics),
          },
          lambda,
        ),
        tradeDate: analog.tradeDate,
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, ANALOG_MODEL_SETTINGS.nearestNeighborCount),
  };
}

function extractPersistedAnalogMatches(componentScores: unknown) {
  if (!Array.isArray(componentScores)) {
    return [] as RankedAnalogMatch[];
  }

  const deduplicatedMatches = componentScores.reduce<Map<string, RankedAnalogMatch>>(
    (matchesByTradeDate, componentScore) => {
      if (!isRecord(componentScore) || !Array.isArray(componentScore.analogMatches)) {
        return matchesByTradeDate;
      }

      for (const analogMatch of componentScore.analogMatches) {
        if (!isPersistedHistoricalAnalogMatch(analogMatch)) {
          continue;
        }

        const existingMatch = matchesByTradeDate.get(analogMatch.tradeDate);

        if (!existingMatch || analogMatch.distance < existingMatch.distance) {
          matchesByTradeDate.set(analogMatch.tradeDate, {
            distance: analogMatch.distance,
            tradeDate: analogMatch.tradeDate,
          });
        }
      }

      return matchesByTradeDate;
    },
    new Map<string, RankedAnalogMatch>(),
  );

  return [...deduplicatedMatches.values()]
    .sort((left, right) => left.distance - right.distance)
    .slice(0, ANALOG_MODEL_SETTINGS.nearestNeighborCount);
}

function chooseRankedMatches(
  reconstructedMatches: RankedAnalogMatch[],
  persistedMatches: RankedAnalogMatch[],
) {
  if (reconstructedMatches.length === 0) {
    return persistedMatches;
  }

  if (persistedMatches.length !== ANALOG_MODEL_SETTINGS.nearestNeighborCount) {
    return reconstructedMatches;
  }

  const reconstructedSignature = reconstructedMatches
    .map((match) => match.tradeDate)
    .join("|");
  const persistedSignature = persistedMatches.map((match) => match.tradeDate).join("|");

  return reconstructedSignature === persistedSignature ? reconstructedMatches : persistedMatches;
}

function buildSpyNextSessionMetrics(
  currentSession: HistoricalArrayPoint,
  nextSession: HistoricalArrayPoint,
) {
  if (
    typeof nextSession.open !== "number" ||
    typeof nextSession.high !== "number" ||
    typeof nextSession.low !== "number"
  ) {
    return null;
  }

  const overnightGap = calculatePercentChange(nextSession.open, currentSession.close);
  const intradayNet = calculatePercentChange(nextSession.close, nextSession.open);
  const sessionRange = calculatePercentChange(nextSession.high, nextSession.low);

  if (overnightGap === null || intradayNet === null || sessionRange === null) {
    return null;
  }

  return {
    intradayNet,
    overnightGap,
    sessionRange,
  };
}

function buildMatchConfidence(distance: number) {
  return Math.max(
    1,
    Math.min(
      99,
      Math.round(
        100 * Math.exp(-(distance ** 2) / (2 * ANALOG_FEATURE_COUNT)),
      ),
    ),
  );
}

function buildTopMatches(
  rankedMatches: RankedAnalogMatch[],
  spySeries: HistoricalArrayPoint[],
): HistoricalAnalogMatch[] {
  const spyPointsByTradeDate = buildTradeDateLookup(spySeries);
  const nextTradeDateByTradeDate = new Map<string, string>();

  for (let index = 0; index < spySeries.length - 1; index += 1) {
    const currentPoint = spySeries[index];
    const nextPoint = spySeries[index + 1];

    if (currentPoint && nextPoint) {
      nextTradeDateByTradeDate.set(currentPoint.tradeDate, nextPoint.tradeDate);
    }
  }

  return rankedMatches.flatMap((match) => {
    const nextSessionDate = nextTradeDateByTradeDate.get(match.tradeDate);

    if (!nextSessionDate) {
      return [];
    }

    const currentSpyPoint = spyPointsByTradeDate.get(match.tradeDate);
    const nextSpyPoint = spyPointsByTradeDate.get(nextSessionDate);

    if (!currentSpyPoint || !nextSpyPoint) {
      return [];
    }

    const nextSessionMetrics = buildSpyNextSessionMetrics(currentSpyPoint, nextSpyPoint);

    if (!nextSessionMetrics) {
      return [];
    }

    return [
      {
        intradayNet: nextSessionMetrics.intradayNet,
        matchConfidence: buildMatchConfidence(match.distance),
        nextSessionDate,
        overnightGap: nextSessionMetrics.overnightGap,
        sessionRange: nextSessionMetrics.sessionRange,
        tradeDate: match.tradeDate,
      },
    ];
  });
}

export function deriveHistoricalAnalogs(
  engineInputs: unknown,
  componentScores?: unknown,
  technicalIndicators?: unknown,
  options: DeriveHistoricalAnalogsOptions = {},
): HistoricalAnalogsPayload | null {
  if (!isRecord(engineInputs)) {
    return null;
  }

  const analogModelUniverse = engineInputs.analogModelUniverse;

  if (!isRecord(analogModelUniverse) || !isRecord(analogModelUniverse.historicalPriceArrays)) {
    return null;
  }

  const historicalArrays = Object.entries(analogModelUniverse.historicalPriceArrays).reduce<
    Record<string, HistoricalArrayPoint[]>
  >((arrays, [ticker, value]) => {
    if (!Array.isArray(value)) {
      return arrays;
    }

    const points = value
      .filter(isHistoricalArrayPoint)
      .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));

    if (points.length > 0) {
      arrays[ticker] = points;
    }

    return arrays;
  }, {});
  const latestTradeDate =
    isRecord(engineInputs.tradeWindow) && typeof engineInputs.tradeWindow.latestTradeDate === "string"
      ? engineInputs.tradeWindow.latestTradeDate
      : null;
  const rollingWindowStartDate =
    options.rollingWindowStartDate ??
    (latestTradeDate ? subtractYearsFromTradeDate(latestTradeDate, MAX_ANALOG_LOOKBACK_YEARS) : null);
  const filteredHistoricalArrays = rollingWindowStartDate
    ? filterHistoricalArraysByStartDate(historicalArrays, rollingWindowStartDate)
    : historicalArrays;

  const spySeries = filteredHistoricalArrays.SPY ?? [];

  if (spySeries.length === 0) {
    return null;
  }

  const persistedMatches = extractPersistedAnalogMatches(componentScores);
  const { candidateCount, matches: reconstructedMatches } = buildReconstructedRankedMatches(
    engineInputs,
    filteredHistoricalArrays,
    technicalIndicators,
    options.applyRegimeFilter,
    options.allowedTradeDates,
  );
  const rankedMatches =
    options.disablePersistedMatchFallback === true
      ? reconstructedMatches
      : chooseRankedMatches(reconstructedMatches, persistedMatches);
  const topMatches = buildTopMatches(rankedMatches, spySeries);
  const effectiveCandidateCount = candidateCount > 0 ? candidateCount : persistedMatches.length;

  if (topMatches.length === 0) {
    return null;
  }

  return {
    alignedSessionCount: getAlignedSessionCount(engineInputs, effectiveCandidateCount),
    candidateCount: effectiveCandidateCount,
    clusterAveragePlaybook: {
      intradayNet: averageNullable(topMatches.map((match) => match.intradayNet)),
      overnightGap: averageNullable(topMatches.map((match) => match.overnightGap)),
      sessionRange: averageNullable(topMatches.map((match) => match.sessionRange)),
    },
    featureTickers: getFeatureTickers(engineInputs, filteredHistoricalArrays),
    topMatches,
  };
}