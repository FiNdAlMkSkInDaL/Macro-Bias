import 'server-only';

import { getLatestBiasSnapshot } from '@/lib/market-data/get-latest-bias-snapshot';

import { getRegimeResearchMatrix } from './regime-map';

type HistoricalArrayPoint = {
  adjustedClose: number;
  close: number;
  high?: number;
  low?: number;
  open?: number;
  percentChangeFromPreviousClose: number | null;
  tradeDate: string;
};

type RelativeLensDefinition = {
  id: string;
  label: string;
  summary: string;
  ticker: string;
  benchmark: string;
};

export type CrossSectionalLensSummary = {
  averageBenchmarkReturn: number;
  averageExcessReturn: number;
  averageTickerReturn: number;
  benchmark: string;
  id: string;
  label: string;
  sampleCount: number;
  summary: string;
  ticker: string;
};

export type CrossSectionalPreviewData = {
  clusterLabel: string;
  currentTradeDate: string;
  leadingLenses: CrossSectionalLensSummary[];
  laggingLenses: CrossSectionalLensSummary[];
  sourceTradeDate: string;
};

const CROSS_SECTIONAL_LENSES: RelativeLensDefinition[] = [
  {
    id: 'qqq-vs-spy',
    label: 'Growth Leadership',
    summary: 'Tracks whether growth-heavy leadership outperforms the broad equity tape.',
    ticker: 'QQQ',
    benchmark: 'SPY',
  },
  {
    id: 'xlp-vs-spy',
    label: 'Defensive Leadership',
    summary: 'Shows whether defensives are beating the broad market inside the regime.',
    ticker: 'XLP',
    benchmark: 'SPY',
  },
  {
    id: 'gld-vs-spy',
    label: 'Safety Demand',
    summary: 'Measures whether defensive hard-asset demand is beating equities.',
    ticker: 'GLD',
    benchmark: 'SPY',
  },
  {
    id: 'tlt-vs-spy',
    label: 'Duration Versus Equities',
    summary: 'Shows whether duration is acting better than stocks.',
    ticker: 'TLT',
    benchmark: 'SPY',
  },
  {
    id: 'uso-vs-spy',
    label: 'Energy Impulse',
    summary: 'Captures whether energy beta leads or lags the broad tape.',
    ticker: 'USO',
    benchmark: 'SPY',
  },
  {
    id: 'hyg-vs-tlt',
    label: 'Credit Over Duration',
    summary: 'Measures risk appetite through credit beating or lagging duration.',
    ticker: 'HYG',
    benchmark: 'TLT',
  },
  {
    id: 'cper-vs-gld',
    label: 'Cyclical Commodity Bid',
    summary: 'Shows whether cyclical commodity demand beats defensive metal demand.',
    ticker: 'CPER',
    benchmark: 'GLD',
  },
] as const;

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

function calculatePercentChange(currentValue: number, previousValue: number) {
  if (previousValue === 0) {
    return null;
  }

  return roundTo(((currentValue - previousValue) / previousValue) * 100);
}

function buildHistoricalPriceArrays(engineInputs: Record<string, unknown> | null | undefined) {
  const analogModelUniverse = engineInputs?.analogModelUniverse;
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

function buildForwardReturnMap(series: HistoricalArrayPoint[]) {
  const result = new Map<string, number>();

  for (let index = 0; index < series.length - 1; index += 1) {
    const current = series[index];
    const next = series[index + 1];
    const forwardReturn = calculatePercentChange(next.close, current.close);

    if (forwardReturn == null) {
      continue;
    }

    result.set(current.tradeDate, forwardReturn);
  }

  return result;
}

export async function getCrossSectionalPreviewData(): Promise<CrossSectionalPreviewData | null> {
  const [matrix, latestSnapshot] = await Promise.all([
    getRegimeResearchMatrix(),
    getLatestBiasSnapshot(),
  ]);

  if (!matrix || !matrix.currentSnapshot || !latestSnapshot?.engine_inputs) {
    return null;
  }

  const historicalArrays = buildHistoricalPriceArrays(latestSnapshot.engine_inputs);

  if (!historicalArrays) {
    return null;
  }

  const clusterTradeDates = new Set(
    matrix.allSnapshots
      .filter((snapshot) => snapshot.clusterId === matrix.currentSnapshot?.clusterId)
      .map((snapshot) => snapshot.tradeDate),
  );

  const summaries = CROSS_SECTIONAL_LENSES.flatMap((lens) => {
    const tickerSeries = historicalArrays[lens.ticker];
    const benchmarkSeries = historicalArrays[lens.benchmark];

    if (!tickerSeries || !benchmarkSeries) {
      return [];
    }

    const tickerForwardReturns = buildForwardReturnMap(tickerSeries);
    const benchmarkForwardReturns = buildForwardReturnMap(benchmarkSeries);
    const overlappingTradeDates = [...clusterTradeDates].filter(
      (tradeDate) => tickerForwardReturns.has(tradeDate) && benchmarkForwardReturns.has(tradeDate),
    );

    if (overlappingTradeDates.length < 5) {
      return [];
    }

    const tickerReturns = overlappingTradeDates.map((tradeDate) => tickerForwardReturns.get(tradeDate)!);
    const benchmarkReturns = overlappingTradeDates.map(
      (tradeDate) => benchmarkForwardReturns.get(tradeDate)!,
    );
    const excessReturns = tickerReturns.map((value, index) => value - benchmarkReturns[index]);

    return [
      {
        id: lens.id,
        label: lens.label,
        summary: lens.summary,
        ticker: lens.ticker,
        benchmark: lens.benchmark,
        sampleCount: overlappingTradeDates.length,
        averageTickerReturn: roundTo(mean(tickerReturns), 2),
        averageBenchmarkReturn: roundTo(mean(benchmarkReturns), 2),
        averageExcessReturn: roundTo(mean(excessReturns), 2),
      } satisfies CrossSectionalLensSummary,
    ];
  }).sort((left, right) => right.averageExcessReturn - left.averageExcessReturn);

  if (summaries.length === 0) {
    return null;
  }

  return {
    sourceTradeDate: latestSnapshot.trade_date,
    currentTradeDate: matrix.currentSnapshot.tradeDate,
    clusterLabel: matrix.currentSnapshot.clusterLabel,
    leadingLenses: summaries.slice(0, 3),
    laggingLenses: [...summaries].reverse().slice(0, 3),
  };
}
