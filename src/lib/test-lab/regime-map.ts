import 'server-only';

import type { MacroBiasScoreRow } from '@/lib/macro-bias/types';
import { calculateRelativeStrengthIndex } from '@/lib/macro-bias/technical-analysis';
import { getLatestBiasSnapshot } from '@/lib/market-data/get-latest-bias-snapshot';
import { getPersistedRegimeArtifact, persistRegimeArtifact } from './persistence';

type HistoricalArrayPoint = {
  adjustedClose: number;
  close: number;
  high?: number;
  low?: number;
  open?: number;
  percentChangeFromPreviousClose: number | null;
  tradeDate: string;
};

type RegimeFeatureKey =
  | 'spyRsi'
  | 'gammaExposure'
  | 'hygTltRatio'
  | 'cperGldRatio'
  | 'usoMomentum'
  | 'vixLevel';

type StandardizedRegimeVector = Record<RegimeFeatureKey, number>;

export type RegimeFeatureSnapshot = {
  clusterId: string;
  clusterLabel: string;
  cperGldRatio: number;
  featureX: number;
  featureY: number;
  gammaExposure: number;
  hygTltRatio: number;
  spyForward1DayReturn: number;
  spyForward3DayReturn: number;
  spyRsi: number;
  standardizedVector: StandardizedRegimeVector;
  tradeDate: string;
  usoMomentum: number;
  vixLevel: number;
};

type FeatureSummary = {
  key: RegimeFeatureKey;
  label: string;
  max: number;
  mean: number;
  min: number;
  standardDeviation: number;
};

export type RegimeClusterSummary = {
  averageForward1DayReturn: number;
  averageForward3DayReturn: number;
  averageVixLevel: number;
  centroidX: number;
  centroidY: number;
  description: string;
  id: string;
  label: string;
  representativeDates: string[];
  sampleCount: number;
};

export type RegimeEngineDiagnostics = {
  clusterCohesion: number;
  currentClusterStability: number | null;
  currentClusterWindowAgreement: number | null;
  nearestClusterSeparation: number;
  rollingWindowCount: number;
};

export type TransitionSummary = {
  averageForward1DayReturn: number;
  averageForward3DayReturn: number;
  averageVixLevel: number;
  currentClusterId: string;
  currentClusterLabel: string;
  nextClusterId: string;
  nextClusterLabel: string;
  sampleCount: number;
  transitionShare: number;
};

export type ConfidencePreviewData = {
  analogAgreement: {
    averageDistance: number;
    clusterConcentration: number;
    directionConsensus1Day: number;
    directionConsensus3Day: number;
    topNeighborCount: number;
  };
  clusterFit: {
    currentClusterDistance: number;
    currentClusterId: string;
    currentClusterLabel: string;
  };
  currentSnapshot: RegimeFeatureSnapshot;
  driftPressure: {
    featureXZScore: number;
    featureYZScore: number;
  };
  signalStrength: {
    normalizedMagnitude: number;
    stateMagnitude: number;
  };
};

export type RegimeMapPreviewData = {
  clusterSummaries: RegimeClusterSummary[];
  coverage: {
    earliestTradeDate: string | null;
    latestTradeDate: string | null;
    sessionCount: number;
  };
  currentSnapshot: RegimeFeatureSnapshot | null;
  diagnostics: RegimeEngineDiagnostics;
  exploratoryPoints: Array<{
    clusterId: string;
    clusterLabel: string;
    featureX: number;
    featureY: number;
    isLatest: boolean;
    tradeDate: string;
  }>;
  featureSummaries: FeatureSummary[];
  recentSnapshots: RegimeFeatureSnapshot[];
  sourceTradeDate: string;
};

export type RegimeResearchMatrix = {
  allSnapshots: RegimeFeatureSnapshot[];
  clusterSummaries: RegimeClusterSummary[];
  confidencePreview: ConfidencePreviewData | null;
  coverage: {
    earliestTradeDate: string | null;
    latestTradeDate: string | null;
    sessionCount: number;
  };
  currentSnapshot: RegimeFeatureSnapshot | null;
  exploratoryPoints: Array<{
    clusterId: string;
    clusterLabel: string;
    featureX: number;
    featureY: number;
    isLatest: boolean;
    tradeDate: string;
  }>;
  featureSummaries: FeatureSummary[];
  diagnostics: RegimeEngineDiagnostics;
  nearestAnalogs: Array<{
    distance: number;
    snapshot: RegimeFeatureSnapshot;
  }>;
  recentSnapshots: RegimeFeatureSnapshot[];
  sourceTradeDate: string;
  transitionSummaries: TransitionSummary[];
};

const FEATURE_LABELS: Record<RegimeFeatureKey, string> = {
  spyRsi: 'SPY RSI',
  gammaExposure: 'Dealer Gamma Exposure',
  hygTltRatio: 'HYG / TLT',
  cperGldRatio: 'CPER / GLD',
  usoMomentum: 'USO 5-Day Momentum',
  vixLevel: 'VIX Level',
};

const FEATURE_KEYS: RegimeFeatureKey[] = [
  'spyRsi',
  'gammaExposure',
  'hygTltRatio',
  'cperGldRatio',
  'usoMomentum',
  'vixLevel',
];

const COMMON_TICKERS = ['SPY', 'TLT', 'GLD', 'HYG', 'CPER', 'USO', 'VIX'] as const;
const MOMENTUM_LOOKBACK = 5;
const EXPLORATORY_POINT_LIMIT = 220;
const RECENT_SNAPSHOT_LIMIT = 12;
const NEAREST_ANALOG_LIMIT = 8;
const CLUSTER_K = 5;
const KMEANS_MAX_ITERATIONS = 30;
const ROLLING_STABILITY_WINDOWS = [0.55, 0.7, 0.85] as const;

type FeatureStats = Record<
  RegimeFeatureKey,
  {
    max: number;
    mean: number;
    min: number;
    standardDeviation: number;
  }
>;

type BaseSnapshot = Omit<RegimeFeatureSnapshot, 'clusterId' | 'clusterLabel'>;

type ClusterAssignment = {
  centroidVector: StandardizedRegimeVector;
  centroidX: number;
  centroidY: number;
  clusterId: string;
  label: string;
  snapshots: RegimeFeatureSnapshot[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHistoricalArrayPoint(value: unknown): value is HistoricalArrayPoint {
  return (
    isRecord(value) &&
    typeof value.adjustedClose === 'number' &&
    typeof value.close === 'number' &&
    (value.high === undefined || typeof value.high === 'number') &&
    (value.low === undefined || typeof value.low === 'number') &&
    (value.open === undefined || typeof value.open === 'number') &&
    typeof value.tradeDate === 'string' &&
    (value.percentChangeFromPreviousClose === null ||
      typeof value.percentChangeFromPreviousClose === 'number')
  );
}

function roundTo(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function mean(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function populationStandardDeviation(values: number[]) {
  if (values.length === 0) {
    return 0;
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

function euclideanDistance(left: number[], right: number[]) {
  return Math.sqrt(
    left.reduce((total, value, index) => total + (value - right[index]) ** 2, 0),
  );
}

function vectorToArray(vector: StandardizedRegimeVector) {
  return FEATURE_KEYS.map((key) => vector[key]);
}

function buildTradeDateLookup(points: HistoricalArrayPoint[]) {
  return new Map(points.map((point) => [point.tradeDate, point] as const));
}

function buildSortedCommonTradeDates(historicalArrays: Record<string, HistoricalArrayPoint[]>) {
  const commonTradeDates = COMMON_TICKERS.reduce<Set<string> | null>((intersection, ticker) => {
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
      spyRsiByTradeDate[point.tradeDate] = roundTo(calculateRelativeStrengthIndex(closes, 14), 2);
    }
  }

  return spyRsiByTradeDate;
}

function buildLookbackPercentChangeByTradeDate(
  series: HistoricalArrayPoint[],
  sortedCommonTradeDates: string[],
) {
  const historyByTradeDate = buildTradeDateLookup(series);
  const result: Record<string, number> = {};

  for (let index = MOMENTUM_LOOKBACK; index < sortedCommonTradeDates.length; index += 1) {
    const tradeDate = sortedCommonTradeDates[index];
    const lookbackTradeDate = sortedCommonTradeDates[index - MOMENTUM_LOOKBACK];
    const latestPoint = historyByTradeDate.get(tradeDate);
    const previousPoint = historyByTradeDate.get(lookbackTradeDate);

    if (!latestPoint || !previousPoint) {
      continue;
    }

    const percentChange = calculatePercentChange(latestPoint.close, previousPoint.close);

    if (percentChange === null) {
      continue;
    }

    result[tradeDate] = percentChange;
  }

  return result;
}

function buildHistoricalPriceArrays(snapshot: MacroBiasScoreRow) {
  const analogModelUniverse = snapshot.engine_inputs?.analogModelUniverse;
  const historicalPriceArraysSource = isRecord(analogModelUniverse)
    ? analogModelUniverse.historicalPriceArrays
    : null;

  if (!isRecord(historicalPriceArraysSource)) {
    return null;
  }

  return Object.entries(historicalPriceArraysSource).reduce<Record<string, HistoricalArrayPoint[]>>(
    (acc, [ticker, value]) => {
      if (!Array.isArray(value)) {
        return acc;
      }

      const points = value
        .filter(isHistoricalArrayPoint)
        .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));

      if (points.length > 0) {
        acc[ticker] = points;
      }

      return acc;
    },
    {},
  );
}

function buildBaseSnapshots(historicalArrays: Record<string, HistoricalArrayPoint[]>) {
  const sortedCommonTradeDates = buildSortedCommonTradeDates(historicalArrays);
  const spyHistoryByTradeDate = buildTradeDateLookup(historicalArrays.SPY ?? []);
  const tltHistoryByTradeDate = buildTradeDateLookup(historicalArrays.TLT ?? []);
  const gldHistoryByTradeDate = buildTradeDateLookup(historicalArrays.GLD ?? []);
  const hygHistoryByTradeDate = buildTradeDateLookup(historicalArrays.HYG ?? []);
  const cperHistoryByTradeDate = buildTradeDateLookup(historicalArrays.CPER ?? []);
  const vixHistoryByTradeDate = buildTradeDateLookup(historicalArrays.VIX ?? []);
  const spyRsiByTradeDate = buildSpyRsiByTradeDate(historicalArrays.SPY ?? []);
  const usoMomentumByTradeDate = buildLookbackPercentChangeByTradeDate(
    historicalArrays.USO ?? [],
    sortedCommonTradeDates,
  );
  const gammaExposureByTradeDate = Object.fromEntries(
    Object.entries(
      buildLookbackPercentChangeByTradeDate(historicalArrays.VIX ?? [], sortedCommonTradeDates),
    ).map(([tradeDate, value]) => [tradeDate, roundTo(-value, 2)]),
  ) as Record<string, number>;

  const snapshots: Array<Omit<BaseSnapshot, 'featureX' | 'featureY' | 'standardizedVector'>> = [];

  for (let index = MOMENTUM_LOOKBACK; index < sortedCommonTradeDates.length - 3; index += 1) {
    const tradeDate = sortedCommonTradeDates[index];
    const nextTradeDate = sortedCommonTradeDates[index + 1];
    const thirdForwardTradeDate = sortedCommonTradeDates[index + 3];
    const spyPoint = spyHistoryByTradeDate.get(tradeDate);
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
      spyPoint && nextSpyPoint ? calculatePercentChange(nextSpyPoint.close, spyPoint.close) : null;
    const spyForward3DayReturn =
      spyPoint && thirdForwardSpyPoint
        ? calculatePercentChange(thirdForwardSpyPoint.close, spyPoint.close)
        : null;

    if (
      !spyPoint ||
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

    snapshots.push({
      tradeDate,
      spyRsi,
      gammaExposure,
      hygTltRatio: roundTo(hygPoint.close / tltPoint.close, 4),
      cperGldRatio: roundTo(cperPoint.close / gldPoint.close, 4),
      usoMomentum,
      vixLevel: roundTo(vixPoint.close, 2),
      spyForward1DayReturn,
      spyForward3DayReturn,
    });
  }

  return {
    coverage: {
      earliestTradeDate: sortedCommonTradeDates[0] ?? null,
      latestTradeDate: sortedCommonTradeDates.at(-1) ?? null,
      sessionCount: sortedCommonTradeDates.length,
    },
    snapshots,
  };
}

function standardizeSnapshots(
  snapshots: Array<Omit<BaseSnapshot, 'featureX' | 'featureY' | 'standardizedVector'>>,
) {
  const featureStats = Object.fromEntries(
    FEATURE_KEYS.map((key) => {
      const values = snapshots.map((snapshot) => snapshot[key]);
      const standardDeviation = populationStandardDeviation(values);

      return [
        key,
        {
          mean: mean(values),
          standardDeviation: standardDeviation > 1e-9 ? standardDeviation : 1,
          min: Math.min(...values),
          max: Math.max(...values),
        },
      ];
    }),
  ) as FeatureStats;

  const standardizedSnapshots: BaseSnapshot[] = snapshots.map((snapshot) => {
    const standardizedVector = FEATURE_KEYS.reduce<StandardizedRegimeVector>((acc, key) => {
      acc[key] =
        (snapshot[key] - featureStats[key].mean) / featureStats[key].standardDeviation;
      return acc;
    }, {} as StandardizedRegimeVector);

    const featureX = roundTo(
      mean([
        standardizedVector.spyRsi,
        standardizedVector.hygTltRatio,
        standardizedVector.cperGldRatio,
        standardizedVector.usoMomentum,
      ]),
      3,
    );
    const featureY = roundTo(mean([standardizedVector.vixLevel, -standardizedVector.gammaExposure]), 3);

    return {
      ...snapshot,
      standardizedVector,
      featureX,
      featureY,
    };
  });

  const featureSummaries: FeatureSummary[] = FEATURE_KEYS.map((key) => ({
    key,
    label: FEATURE_LABELS[key],
    mean: roundTo(featureStats[key].mean, 3),
    standardDeviation: roundTo(featureStats[key].standardDeviation, 3),
    min: roundTo(featureStats[key].min, 3),
    max: roundTo(featureStats[key].max, 3),
  }));

  return {
    featureSummaries,
    snapshots: standardizedSnapshots,
  };
}

function sortSnapshotsForSeeds(snapshots: BaseSnapshot[]) {
  return [...snapshots].sort((left, right) => {
    if (left.featureX !== right.featureX) {
      return left.featureX - right.featureX;
    }

    return left.featureY - right.featureY;
  });
}

function buildInitialCentroids(snapshots: BaseSnapshot[], k: number) {
  const sorted = sortSnapshotsForSeeds(snapshots);

  return Array.from({ length: k }, (_, index) => {
    const rawIndex = Math.round((index / Math.max(k - 1, 1)) * (sorted.length - 1));
    return vectorToArray(sorted[rawIndex].standardizedVector);
  });
}

function meanVector(vectors: number[][]) {
  if (vectors.length === 0) {
    return FEATURE_KEYS.map(() => 0);
  }

  return FEATURE_KEYS.map((_, featureIndex) =>
    mean(vectors.map((vector) => vector[featureIndex])),
  );
}

function assignClusters(snapshots: BaseSnapshot[], centroids: number[][]) {
  return snapshots.map((snapshot) => {
    const vector = vectorToArray(snapshot.standardizedVector);
    let bestClusterIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    centroids.forEach((centroid, index) => {
      const distance = euclideanDistance(vector, centroid);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestClusterIndex = index;
      }
    });

    return {
      snapshot,
      clusterIndex: bestClusterIndex,
      distance: bestDistance,
    };
  });
}

function recalculateCentroids(
  assignments: Array<{ clusterIndex: number; distance: number; snapshot: BaseSnapshot }>,
  previousCentroids: number[][],
  k: number,
) {
  return Array.from({ length: k }, (_, clusterIndex) => {
    const vectors = assignments
      .filter((assignment) => assignment.clusterIndex === clusterIndex)
      .map((assignment) => vectorToArray(assignment.snapshot.standardizedVector));

    return vectors.length > 0 ? meanVector(vectors) : previousCentroids[clusterIndex];
  });
}

function arraysAlmostEqual(left: number[][], right: number[][]) {
  return left.every((leftRow, rowIndex) =>
    leftRow.every((value, columnIndex) => Math.abs(value - right[rowIndex][columnIndex]) < 1e-6),
  );
}

function centroidToVector(centroid: number[]) {
  return FEATURE_KEYS.reduce<StandardizedRegimeVector>((acc, key, index) => {
    acc[key] = roundTo(centroid[index], 4);
    return acc;
  }, {} as StandardizedRegimeVector);
}

function buildClusterLabel(centroidX: number, centroidY: number) {
  const riskText = centroidX >= 0.4 ? 'Risk-On' : centroidX <= -0.4 ? 'Risk-Fragile' : 'Balanced';
  const stressText = centroidY >= 0.35 ? 'Stress' : centroidY <= -0.35 ? 'Calm' : 'Mixed';

  return `${riskText} / ${stressText}`;
}

function buildClusterDescription(centroidX: number, centroidY: number) {
  const riskSentence =
    centroidX >= 0.4
      ? 'Cross-asset features lean supportive of risk.'
      : centroidX <= -0.4
        ? 'Cross-asset features lean defensive and fragile.'
        : 'Cross-asset features are mixed rather than decisive.';
  const stressSentence =
    centroidY >= 0.35
      ? 'Volatility and positioning imply a stressed tape.'
      : centroidY <= -0.35
        ? 'Volatility and positioning imply a calmer tape.'
        : 'Stress signals are neither calm nor fully stressed.';

  return `${riskSentence} ${stressSentence}`;
}

function runDeterministicKMeans(snapshots: BaseSnapshot[], k: number) {
  let centroids = buildInitialCentroids(snapshots, k);
  let assignments = assignClusters(snapshots, centroids);

  for (let iteration = 0; iteration < KMEANS_MAX_ITERATIONS; iteration += 1) {
    const nextCentroids = recalculateCentroids(assignments, centroids, k);

    if (arraysAlmostEqual(nextCentroids, centroids)) {
      break;
    }

    centroids = nextCentroids;
    assignments = assignClusters(snapshots, centroids);
  }

  return centroids.map((centroid, clusterIndex) => {
    const clusterSnapshots = assignments
      .filter((assignment) => assignment.clusterIndex === clusterIndex)
      .map((assignment) => assignment.snapshot);
    const centroidX = roundTo(mean(clusterSnapshots.map((snapshot) => snapshot.featureX)), 3);
    const centroidY = roundTo(mean(clusterSnapshots.map((snapshot) => snapshot.featureY)), 3);
    const label = buildClusterLabel(centroidX, centroidY);
    const clusterId = `cluster-${clusterIndex + 1}`;

    return {
      clusterId,
      label,
      centroidX,
      centroidY,
      centroidVector: centroidToVector(centroid),
      snapshots: clusterSnapshots.map((snapshot) => ({
        ...snapshot,
        clusterId,
        clusterLabel: label,
      })),
    } satisfies ClusterAssignment;
  });
}

function buildClusterSummaries(clusters: ClusterAssignment[]) {
  return clusters
    .filter((cluster) => cluster.snapshots.length > 0)
    .map((cluster) => ({
      id: cluster.clusterId,
      label: cluster.label,
      description: buildClusterDescription(cluster.centroidX, cluster.centroidY),
      sampleCount: cluster.snapshots.length,
      centroidX: cluster.centroidX,
      centroidY: cluster.centroidY,
      averageForward1DayReturn: roundTo(
        mean(cluster.snapshots.map((snapshot) => snapshot.spyForward1DayReturn)),
        2,
      ),
      averageForward3DayReturn: roundTo(
        mean(cluster.snapshots.map((snapshot) => snapshot.spyForward3DayReturn)),
        2,
      ),
      averageVixLevel: roundTo(mean(cluster.snapshots.map((snapshot) => snapshot.vixLevel)), 2),
      representativeDates: cluster.snapshots.slice(0, 3).map((snapshot) => snapshot.tradeDate),
    }))
    .sort((left, right) => right.sampleCount - left.sampleCount);
}

function buildClusterDiagnostics(
  clusters: ClusterAssignment[],
  currentSnapshot: RegimeFeatureSnapshot | null,
  fullSnapshots: BaseSnapshot[],
) {
  const clusterCohesion = roundTo(
    mean(
      clusters
        .filter((cluster) => cluster.snapshots.length > 0)
        .map((cluster) =>
          mean(
            cluster.snapshots.map((snapshot) =>
              euclideanDistance(
                vectorToArray(snapshot.standardizedVector),
                vectorToArray(cluster.centroidVector),
              ),
            ),
          ),
        ),
    ),
    4,
  );

  const centroidPairs: number[] = [];
  for (let index = 0; index < clusters.length; index += 1) {
    for (let innerIndex = index + 1; innerIndex < clusters.length; innerIndex += 1) {
      centroidPairs.push(
        euclideanDistance(
          vectorToArray(clusters[index].centroidVector),
          vectorToArray(clusters[innerIndex].centroidVector),
        ),
      );
    }
  }

  const nearestClusterSeparation = roundTo(Math.min(...centroidPairs), 4);

  if (!currentSnapshot) {
    return {
      clusterCohesion,
      nearestClusterSeparation,
      currentClusterStability: null,
      currentClusterWindowAgreement: null,
      rollingWindowCount: 0,
    } satisfies RegimeEngineDiagnostics;
  }

  const windows = ROLLING_STABILITY_WINDOWS.flatMap((ratio) => {
    const windowSize = Math.max(CLUSTER_K * 10, Math.floor(fullSnapshots.length * ratio));
    const windowSnapshots = fullSnapshots.slice(-windowSize);

    if (windowSnapshots.length < CLUSTER_K || !windowSnapshots.some((snapshot) => snapshot.tradeDate === currentSnapshot.tradeDate)) {
      return [];
    }

    const windowClusters = runDeterministicKMeans(windowSnapshots, CLUSTER_K);
    const windowCurrentCluster = windowClusters.find((cluster) =>
      cluster.snapshots.some((snapshot) => snapshot.tradeDate === currentSnapshot.tradeDate),
    );

    if (!windowCurrentCluster) {
      return [];
    }

    const matchingFullCluster = clusters.find(
      (cluster) => cluster.clusterId === currentSnapshot.clusterId,
    );

    if (!matchingFullCluster) {
      return [];
    }

    const centroidDistance = euclideanDistance(
      vectorToArray(windowCurrentCluster.centroidVector),
      vectorToArray(matchingFullCluster.centroidVector),
    );

    return [
      {
        centroidDistance,
        labelMatches: windowCurrentCluster.label === matchingFullCluster.label,
      },
    ];
  });

  return {
    clusterCohesion,
    nearestClusterSeparation,
    currentClusterStability:
      windows.length > 0 ? roundTo(mean(windows.map((window) => window.centroidDistance)), 4) : null,
    currentClusterWindowAgreement:
      windows.length > 0
        ? roundTo(
            windows.filter((window) => window.labelMatches).length / windows.length,
            3,
          )
        : null,
    rollingWindowCount: windows.length,
  } satisfies RegimeEngineDiagnostics;
}

function flattenClusterSnapshots(clusters: ClusterAssignment[]) {
  return clusters
    .flatMap((cluster) => cluster.snapshots)
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
}

function buildNearestAnalogs(
  snapshots: RegimeFeatureSnapshot[],
  currentSnapshot: RegimeFeatureSnapshot | null,
) {
  if (!currentSnapshot) {
    return [] as Array<{ distance: number; snapshot: RegimeFeatureSnapshot }>;
  }

  return snapshots
    .filter((snapshot) => snapshot.tradeDate !== currentSnapshot.tradeDate)
    .map((snapshot) => ({
      snapshot,
      distance: euclideanDistance(
        vectorToArray(snapshot.standardizedVector),
        vectorToArray(currentSnapshot.standardizedVector),
      ),
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, NEAREST_ANALOG_LIMIT)
    .map((entry) => ({
      ...entry,
      distance: roundTo(entry.distance, 4),
    }));
}

function buildTransitionSummaries(snapshots: RegimeFeatureSnapshot[]) {
  const transitions = new Map<
    string,
    {
      currentClusterId: string;
      currentClusterLabel: string;
      nextClusterId: string;
      nextClusterLabel: string;
      returns1Day: number[];
      returns3Day: number[];
      sampleCount: number;
      vixLevels: number[];
    }
  >();
  const totalsByCluster = new Map<string, number>();

  for (let index = 0; index < snapshots.length - 1; index += 1) {
    const current = snapshots[index];
    const next = snapshots[index + 1];
    const key = `${current.clusterId}__${next.clusterId}`;
    const existing = transitions.get(key);

    totalsByCluster.set(current.clusterId, (totalsByCluster.get(current.clusterId) ?? 0) + 1);

    if (existing) {
      existing.sampleCount += 1;
      existing.returns1Day.push(current.spyForward1DayReturn);
      existing.returns3Day.push(current.spyForward3DayReturn);
      existing.vixLevels.push(current.vixLevel);
      continue;
    }

    transitions.set(key, {
      currentClusterId: current.clusterId,
      currentClusterLabel: current.clusterLabel,
      nextClusterId: next.clusterId,
      nextClusterLabel: next.clusterLabel,
      sampleCount: 1,
      returns1Day: [current.spyForward1DayReturn],
      returns3Day: [current.spyForward3DayReturn],
      vixLevels: [current.vixLevel],
    });
  }

  return [...transitions.values()]
    .map((transition) => ({
      currentClusterId: transition.currentClusterId,
      currentClusterLabel: transition.currentClusterLabel,
      nextClusterId: transition.nextClusterId,
      nextClusterLabel: transition.nextClusterLabel,
      sampleCount: transition.sampleCount,
      transitionShare: roundTo(
        transition.sampleCount / (totalsByCluster.get(transition.currentClusterId) ?? 1),
        3,
      ),
      averageForward1DayReturn: roundTo(mean(transition.returns1Day), 2),
      averageForward3DayReturn: roundTo(mean(transition.returns3Day), 2),
      averageVixLevel: roundTo(mean(transition.vixLevels), 2),
    }))
    .sort((left, right) => right.sampleCount - left.sampleCount);
}

function buildConfidencePreview(
  currentSnapshot: RegimeFeatureSnapshot | null,
  nearestAnalogs: Array<{ distance: number; snapshot: RegimeFeatureSnapshot }>,
  clusters: ClusterAssignment[],
) {
  if (!currentSnapshot || nearestAnalogs.length === 0) {
    return null;
  }

  const currentCluster = clusters.find((cluster) => cluster.clusterId === currentSnapshot.clusterId);

  if (!currentCluster) {
    return null;
  }

  const topNeighborCount = Math.min(5, nearestAnalogs.length);
  const topNeighbors = nearestAnalogs.slice(0, topNeighborCount);
  const forward1DaySigns = topNeighbors.map((entry) => Math.sign(entry.snapshot.spyForward1DayReturn));
  const forward3DaySigns = topNeighbors.map((entry) => Math.sign(entry.snapshot.spyForward3DayReturn));
  const directionConsensus1Day =
    Math.max(
      forward1DaySigns.filter((value) => value >= 0).length,
      forward1DaySigns.filter((value) => value < 0).length,
    ) / topNeighborCount;
  const directionConsensus3Day =
    Math.max(
      forward3DaySigns.filter((value) => value >= 0).length,
      forward3DaySigns.filter((value) => value < 0).length,
    ) / topNeighborCount;
  const clusterMatches = topNeighbors.filter(
    (entry) => entry.snapshot.clusterId === currentSnapshot.clusterId,
  ).length;
  const stateMagnitude = Math.sqrt(currentSnapshot.featureX ** 2 + currentSnapshot.featureY ** 2);
  const currentClusterDistance = euclideanDistance(
    vectorToArray(currentSnapshot.standardizedVector),
    vectorToArray(currentCluster.centroidVector),
  );

  return {
    signalStrength: {
      stateMagnitude: roundTo(stateMagnitude, 3),
      normalizedMagnitude: roundTo(Math.min(stateMagnitude / 2.5, 1), 3),
    },
    analogAgreement: {
      topNeighborCount,
      averageDistance: roundTo(mean(topNeighbors.map((entry) => entry.distance)), 4),
      directionConsensus1Day: roundTo(directionConsensus1Day, 3),
      directionConsensus3Day: roundTo(directionConsensus3Day, 3),
      clusterConcentration: roundTo(clusterMatches / topNeighborCount, 3),
    },
    clusterFit: {
      currentClusterId: currentCluster.clusterId,
      currentClusterLabel: currentCluster.label,
      currentClusterDistance: roundTo(currentClusterDistance, 4),
    },
    driftPressure: {
      featureXZScore: roundTo(currentSnapshot.featureX, 3),
      featureYZScore: roundTo(currentSnapshot.featureY, 3),
    },
    currentSnapshot,
  };
}

export async function getRegimeResearchMatrix(): Promise<RegimeResearchMatrix | null> {
  const latestSnapshot = await getLatestBiasSnapshot();

  if (!latestSnapshot || !latestSnapshot.engine_inputs) {
    return null;
  }

  const persistedMatrix = await getPersistedRegimeArtifact<RegimeResearchMatrix>(latestSnapshot.trade_date);

  if (persistedMatrix) {
    return persistedMatrix;
  }

  const historicalArrays = buildHistoricalPriceArrays(latestSnapshot);

  if (!historicalArrays) {
    return null;
  }

  const { coverage, snapshots } = buildBaseSnapshots(historicalArrays);

  if (snapshots.length < CLUSTER_K) {
    return null;
  }

  const { featureSummaries, snapshots: standardizedSnapshots } = standardizeSnapshots(snapshots);
  const clusters = runDeterministicKMeans(standardizedSnapshots, CLUSTER_K);
  const clusteredSnapshots = flattenClusterSnapshots(clusters);
  const clusterSummaries = buildClusterSummaries(clusters);
  const currentSnapshot = clusteredSnapshots.at(-1) ?? null;
  const diagnostics = buildClusterDiagnostics(clusters, currentSnapshot, standardizedSnapshots);
  const nearestAnalogs = buildNearestAnalogs(clusteredSnapshots, currentSnapshot);
  const transitionSummaries = buildTransitionSummaries(clusteredSnapshots);
  const confidencePreview = buildConfidencePreview(currentSnapshot, nearestAnalogs, clusters);
  const exploratoryPoints = clusteredSnapshots.slice(-EXPLORATORY_POINT_LIMIT).map((snapshot) => ({
    tradeDate: snapshot.tradeDate,
    featureX: snapshot.featureX,
    featureY: snapshot.featureY,
    clusterId: snapshot.clusterId,
    clusterLabel: snapshot.clusterLabel,
    isLatest: snapshot.tradeDate === currentSnapshot?.tradeDate,
  }));

  const matrix = {
    allSnapshots: clusteredSnapshots,
    sourceTradeDate: latestSnapshot.trade_date,
    coverage,
    currentSnapshot,
    exploratoryPoints,
    featureSummaries,
    diagnostics,
    nearestAnalogs,
    recentSnapshots: [...clusteredSnapshots].slice(-RECENT_SNAPSHOT_LIMIT).reverse(),
    transitionSummaries,
    confidencePreview,
    clusterSummaries,
  };

  await persistRegimeArtifact(latestSnapshot.trade_date, matrix);

  return matrix;
}

export async function getRegimeMapPreviewData(): Promise<RegimeMapPreviewData | null> {
  const matrix = await getRegimeResearchMatrix();

  if (!matrix) {
    return null;
  }

  return {
    sourceTradeDate: matrix.sourceTradeDate,
    coverage: matrix.coverage,
    currentSnapshot: matrix.currentSnapshot,
    diagnostics: matrix.diagnostics,
    exploratoryPoints: matrix.exploratoryPoints,
    featureSummaries: matrix.featureSummaries,
    recentSnapshots: matrix.recentSnapshots,
    clusterSummaries: matrix.clusterSummaries,
  };
}
