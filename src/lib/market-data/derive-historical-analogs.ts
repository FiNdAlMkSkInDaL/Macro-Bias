const FEATURE_TICKERS = ["SPY", "QQQ", "XLP", "TLT", "GLD", "USO", "VIX", "HYG", "CPER"] as const;

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

function roundTo(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
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

function getStandardDeviation(points: HistoricalArrayPoint[]) {
  const values = points
    .map((point) => point.percentChangeFromPreviousClose)
    .filter((value): value is number => typeof value === "number");

  if (values.length < 2) {
    return 1;
  }

  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1);

  return Math.max(Math.sqrt(variance), 0.35);
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

export function deriveHistoricalAnalogs(engineInputs: unknown): HistoricalAnalogsPayload | null {
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

  const latestSnapshots = {
    ...collectSnapshots(engineInputs.coreTickerChanges),
    ...collectSnapshots(engineInputs.supplementalTickerChanges),
  };

  const featureTickers = FEATURE_TICKERS.filter(
    (ticker) => historicalArrays[ticker]?.length && latestSnapshots[ticker],
  );

  if (featureTickers.length < 4) {
    return null;
  }

  const nextTradeDateByTradeDate = new Map<string, string>();
  const spySeries = historicalArrays.SPY ?? [];

  for (let index = 0; index < spySeries.length - 1; index += 1) {
    const currentPoint = spySeries[index];
    const nextPoint = spySeries[index + 1];

    if (currentPoint && nextPoint) {
      nextTradeDateByTradeDate.set(currentPoint.tradeDate, nextPoint.tradeDate);
    }
  }

  const currentVector = Object.fromEntries(
    featureTickers.map((ticker) => [ticker, latestSnapshots[ticker]!.percentChange]),
  ) as Record<string, number>;
  const stdDevByTicker = Object.fromEntries(
    featureTickers.map((ticker) => [ticker, getStandardDeviation(historicalArrays[ticker])]),
  ) as Record<string, number>;
  const pointsByTicker = Object.fromEntries(
    featureTickers
      .filter((ticker, index, tickers) => tickers.indexOf(ticker) === index)
      .map((ticker) => [
        ticker,
        new Map(
          (historicalArrays[ticker] ?? []).map((point) => [point.tradeDate, point] as const),
        ),
      ]),
  ) as Record<string, Map<string, HistoricalArrayPoint>>;
  const latestTradeDate =
    isRecord(engineInputs.tradeWindow) && typeof engineInputs.tradeWindow.latestTradeDate === "string"
      ? engineInputs.tradeWindow.latestTradeDate
      : null;

  const commonFeatureDates = featureTickers.reduce<Set<string> | null>((intersection, ticker) => {
    const dates = new Set(historicalArrays[ticker].map((point) => point.tradeDate));

    if (!intersection) {
      return dates;
    }

    return new Set([...intersection].filter((tradeDate) => dates.has(tradeDate)));
  }, null);

  const matches = [...(commonFeatureDates ?? [])]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((tradeDate) => {
      if (tradeDate === latestTradeDate) {
        return [];
      }

      const nextSessionDate = nextTradeDateByTradeDate.get(tradeDate);

      if (!nextSessionDate) {
        return [];
      }

      const currentSpyPoint = pointsByTicker.SPY.get(tradeDate);
      const nextSpyPoint = pointsByTicker.SPY.get(nextSessionDate);

      if (!currentSpyPoint || !nextSpyPoint) {
        return [];
      }

      const nextSessionMetrics = buildSpyNextSessionMetrics(currentSpyPoint, nextSpyPoint);

      if (!nextSessionMetrics) {
        return [];
      }

      let distanceSquared = 0;

      for (const ticker of featureTickers) {
        const historicalPoint = pointsByTicker[ticker].get(tradeDate);

        if (!historicalPoint || typeof historicalPoint.percentChangeFromPreviousClose !== "number") {
          return [];
        }

        const normalizedDifference =
          (currentVector[ticker] - historicalPoint.percentChangeFromPreviousClose) /
          stdDevByTicker[ticker];

        distanceSquared += normalizedDifference ** 2;
      }

      return [
        {
          distanceSquared,
          intradayNet: nextSessionMetrics.intradayNet,
          nextSessionDate,
          overnightGap: nextSessionMetrics.overnightGap,
          sessionRange: nextSessionMetrics.sessionRange,
          tradeDate,
        },
      ];
    });

  const topMatches = matches
    .sort((left, right) => left.distanceSquared - right.distanceSquared)
    .slice(0, 5)
    .map((match) => ({
      intradayNet: match.intradayNet,
      matchConfidence: Math.max(
        1,
        Math.min(
          99,
          Math.round(
            100 * Math.exp(-match.distanceSquared / (2 * Math.max(featureTickers.length, 1))),
          ),
        ),
      ),
      nextSessionDate: match.nextSessionDate,
      overnightGap: match.overnightGap,
      sessionRange: match.sessionRange,
      tradeDate: match.tradeDate,
    }));

  return {
    alignedSessionCount: getAlignedSessionCount(engineInputs, matches.length),
    candidateCount: matches.length,
    clusterAveragePlaybook: {
      intradayNet: averageNullable(topMatches.map((match) => match.intradayNet)),
      overnightGap: averageNullable(topMatches.map((match) => match.overnightGap)),
      sessionRange: averageNullable(topMatches.map((match) => match.sessionRange)),
    },
    featureTickers: [...featureTickers],
    topMatches,
  };
}