import { calculateDailyBias } from "../macro-bias/calculate-daily-bias";
import {
  ANALOG_MODEL_SETTINGS,
  TRACKED_TICKERS,
} from "../macro-bias/constants";
import {
  calculateRelativeStrengthIndex,
  calculateSimpleMovingAverage,
} from "../macro-bias/technical-analysis";
import type {
  DailyBiasResult,
  DailyPriceInsert,
  ExpandedDailyBiasData,
  HistoricalAnalogVector,
  SupplementalTicker,
  SupplementalTickerSnapshot,
  TickerChangeMap,
  TrackedTicker,
} from "../macro-bias/types";
import { createSupabaseAdminClient } from "../supabase/admin";

type DailySyncOptions = {
  lookbackDays?: number;
  asOfDate?: Date;
};

type MarketDataTicker = TrackedTicker | SupplementalTicker;

type HistoricalPriceRow<TTicker extends MarketDataTicker = MarketDataTicker> = {
  ticker: TTicker;
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjusted_close: number;
  volume: number;
  source: string;
};

type YahooChartQuote = {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
  volume?: Array<number | null>;
};

type YahooChartAdjClose = {
  adjclose?: Array<number | null>;
};

type YahooChartResult = {
  timestamp?: number[];
  indicators?: {
    quote?: YahooChartQuote[];
    adjclose?: YahooChartAdjClose[];
  };
};

type YahooChartResponse = {
  chart?: {
    result?: YahooChartResult[];
    error?: {
      code?: string;
      description?: string;
    } | null;
  };
};

type SupabaseTableProbeResult = {
  error: {
    code?: string;
    message: string;
  } | null;
};

type PersistedTechnicalIndicators = Record<string, unknown>;

type PersistedDailyPriceRow = {
  ticker: string;
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjusted_close: number;
  volume: number;
  source: string;
  technical_indicators: PersistedTechnicalIndicators;
};

const SUPPLEMENTAL_TICKERS = ["^VIX", "HYG", "CPER", "USO"] as const satisfies readonly SupplementalTicker[];
const ANALOG_CORE_TICKERS = ["USO"] as const satisfies readonly SupplementalTicker[];
const MODEL_VERSION = "macro-model-v4-regime-gex";
const MAX_ANALOG_LOOKBACK_YEARS = 10;
const DEFAULT_ANALOG_LOOKBACK_DAYS = 3653;
const MIN_ANALOG_LOOKBACK_DAYS = 45;

function roundPrice(value: number) {
  return Number(value.toFixed(4));
}

function formatTradeDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function subtractDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() - days);
  return nextDate;
}

function subtractYears(date: Date, years: number) {
  const nextDate = new Date(date);
  nextDate.setUTCFullYear(nextDate.getUTCFullYear() - years);
  return nextDate;
}

function calculateCalendarDayDifference(startDate: Date, endDate: Date) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((endDate.getTime() - startDate.getTime()) / millisecondsPerDay);
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function normalizeTickerForStorage(ticker: MarketDataTicker) {
  return ticker === "^VIX" ? "VIX" : ticker;
}

function getNumericTechnicalIndicator(
  indicators: PersistedTechnicalIndicators,
  key: string,
): number | undefined {
  const value = indicators[key];

  return typeof value === "number" ? value : undefined;
}

function calculatePercentChange(currentValue: number, previousValue: number) {
  return Number((((currentValue - previousValue) / previousValue) * 100).toFixed(2));
}

function buildSortedCommonTradeDates(
  seriesByTicker: Record<string, HistoricalPriceRow[] | DailyPriceInsert[]>,
) {
  const commonTradeDates = Object.values(seriesByTicker).reduce<Set<string> | null>(
    (intersection, rows) => {
      const tradeDates = new Set(rows.map((row) => row.trade_date));

      if (!intersection) {
        return tradeDates;
      }

      return new Set([...intersection].filter((tradeDate) => tradeDates.has(tradeDate)));
    },
    null,
  );

  return [...(commonTradeDates ?? [])].sort((left, right) => left.localeCompare(right));
}

function isTickerConstraintCompatibilityError(error: { code?: string; message?: string }) {
  return (
    error.code === "23514" &&
    error.message?.includes("etf_daily_prices_ticker_check") === true
  );
}

function buildHistoricalArrayPayload(
  seriesByTicker: Record<string, HistoricalPriceRow[] | DailyPriceInsert[]>,
) {
  return Object.fromEntries(
    Object.entries(seriesByTicker).map(([ticker, rows]) => [
      ticker,
      rows.map((row, index) => {
        const previousRow = index > 0 ? rows[index - 1] : null;

        return {
          adjustedClose: row.adjusted_close,
          close: row.close,
          high: row.high,
          low: row.low,
          open: row.open,
          percentChangeFromPreviousClose: previousRow
            ? Number((((row.close - previousRow.close) / previousRow.close) * 100).toFixed(2))
            : null,
          tradeDate: row.trade_date,
        };
      }),
    ]),
  );
}

function buildHistoricalSeriesSummary(
  seriesByTicker: Record<string, HistoricalPriceRow[] | DailyPriceInsert[]>,
) {
  const sortedCommonTradeDates = buildSortedCommonTradeDates(seriesByTicker);

  return {
    commonSessionCoverage: {
      earliestTradeDate: sortedCommonTradeDates[0] ?? null,
      latestTradeDate: sortedCommonTradeDates.at(-1) ?? null,
      sessionCount: sortedCommonTradeDates.length,
    },
    perTicker: Object.fromEntries(
      Object.entries(seriesByTicker).map(([ticker, rows]) => [
        ticker,
        {
          earliestTradeDate: rows[0]?.trade_date ?? null,
          latestTradeDate: rows.at(-1)?.trade_date ?? null,
          observations: rows.length,
        },
      ]),
    ),
  };
}

async function ensureMacroBiasTablesExist() {
  const supabase = createSupabaseAdminClient();
  const [pricesProbe, scoresProbe] = (await Promise.all([
    supabase.from("etf_daily_prices").select("id").limit(1),
    supabase.from("macro_bias_scores").select("id").limit(1),
  ])) as [SupabaseTableProbeResult, SupabaseTableProbeResult];

  const missingTableError = [pricesProbe.error, scoresProbe.error].find(
    (error) => error?.code === "PGRST205",
  );

  if (missingTableError) {
    throw new Error(
      "Missing required Supabase tables for macro-bias sync. Apply supabase/migrations/20260405_init_macro_bias.sql to the project configured in NEXT_PUBLIC_SUPABASE_URL before running this command.",
    );
  }

  const unexpectedError = [pricesProbe.error, scoresProbe.error].find(Boolean);

  if (unexpectedError) {
    throw unexpectedError;
  }

  return supabase;
}

async function fetchTickerHistory<TTicker extends MarketDataTicker>(
  ticker: TTicker,
  period1: Date,
  period2: Date,
): Promise<HistoricalPriceRow<TTicker>[]> {
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
  );

  url.searchParams.set("interval", "1d");
  url.searchParams.set("includeAdjustedClose", "true");
  url.searchParams.set("period1", String(Math.floor(period1.getTime() / 1000)));
  url.searchParams.set("period2", String(Math.floor(period2.getTime() / 1000)));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Yahoo chart API request failed for ${ticker}: ${response.status}.`);
  }

  const payload = (await response.json()) as YahooChartResponse;
  const errorMessage = payload.chart?.error?.description;
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  const adjustedCloses = result?.indicators?.adjclose?.[0]?.adjclose ?? [];

  if (!quote) {
    throw new Error(errorMessage || `Yahoo chart API returned no price series for ${ticker}.`);
  }

  return timestamps
    .map((timestamp, index) => {
      const closeValue = quote.close?.[index];

      if (closeValue == null) {
        return null;
      }

      const close = roundPrice(closeValue);

      const row: HistoricalPriceRow<TTicker> = {
        ticker,
        trade_date: formatTradeDate(new Date(timestamp * 1000)),
        open: roundPrice(quote.open?.[index] ?? close),
        high: roundPrice(quote.high?.[index] ?? close),
        low: roundPrice(quote.low?.[index] ?? close),
        close,
        adjusted_close: roundPrice(adjustedCloses[index] ?? close),
        volume: Math.round(quote.volume?.[index] ?? 0),
        source: "yahoo-chart-api",
      };

      return row;
    })
    .filter((row): row is HistoricalPriceRow<TTicker> => row !== null)
    .sort((left, right) => left.trade_date.localeCompare(right.trade_date));
}

function findLatestCommonTradeDates(
  seriesByTicker: Record<string, HistoricalPriceRow[] | DailyPriceInsert[]>,
) {
  const sortedDates = buildSortedCommonTradeDates(seriesByTicker);

  if (sortedDates.length < 2) {
    throw new Error("Not enough overlapping market sessions were returned to score the day.");
  }

  return {
    previousTradeDate: sortedDates.at(-2)!,
    latestTradeDate: sortedDates.at(-1)!,
    sortedCommonTradeDates: sortedDates,
  };
}

function buildTickerChangeMap(
  rowsByTicker: Record<TrackedTicker, DailyPriceInsert[]>,
  previousTradeDate: string,
  latestTradeDate: string,
): TickerChangeMap {
  const changes = {} as TickerChangeMap;

  for (const ticker of TRACKED_TICKERS) {
    const previousRow = rowsByTicker[ticker].find((row) => row.trade_date === previousTradeDate);
    const latestRow = rowsByTicker[ticker].find((row) => row.trade_date === latestTradeDate);

    if (!previousRow || !latestRow) {
      throw new Error(`Missing aligned market data for ${ticker}.`);
    }

    const percentChange = Number(
      (((latestRow.close - previousRow.close) / previousRow.close) * 100).toFixed(2),
    );

    changes[ticker] = {
      ticker,
      tradeDate: latestTradeDate,
      close: latestRow.close,
      previousClose: previousRow.close,
      percentChange,
    };
  }

  return changes;
}

function buildSupplementalSnapshot<TTicker extends MarketDataTicker>(
  history: HistoricalPriceRow<TTicker>[],
  previousTradeDate: string,
  latestTradeDate: string,
): {
  ticker: TTicker;
  tradeDate: string;
  close: number;
  previousClose: number;
  percentChange: number;
} | undefined {
  const previousRow = history.find((row) => row.trade_date === previousTradeDate);
  const latestRow = history.find((row) => row.trade_date === latestTradeDate);

  if (!previousRow || !latestRow) {
    return undefined;
  }

  return {
    ticker: latestRow.ticker,
    tradeDate: latestTradeDate,
    close: latestRow.close,
    previousClose: previousRow.close,
    percentChange: calculatePercentChange(latestRow.close, previousRow.close),
  };
}

function buildSpyTechnicalIndicatorsByTradeDate(spyHistory: DailyPriceInsert[]) {
  const sortedHistory = [...spyHistory].sort((left, right) =>
    left.trade_date.localeCompare(right.trade_date),
  );
  const closes: number[] = [];
  const technicalIndicatorsByTradeDate: Record<string, PersistedTechnicalIndicators> = {};

  for (const row of sortedHistory) {
    closes.push(row.close);

    const indicators: PersistedTechnicalIndicators = {};

    if (closes.length >= 20) {
      const sma20 = calculateSimpleMovingAverage(closes, 20);
      indicators.sma20 = sma20;
      indicators.distanceFromSmaPercent = Number(
        (((row.close - sma20) / sma20) * 100).toFixed(2),
      );
      indicators.isAboveSma20 = row.close >= sma20;
    }

    if (closes.length >= 15) {
      indicators.rsi14 = calculateRelativeStrengthIndex(closes, 14);
    }

    technicalIndicatorsByTradeDate[row.trade_date] = indicators;
  }

  return technicalIndicatorsByTradeDate;
}

function buildTradeDateLookup<TTicker extends MarketDataTicker>(
  history: HistoricalPriceRow<TTicker>[] | DailyPriceInsert[],
) {
  return new Map(history.map((row) => [row.trade_date, row]));
}

function buildSessionPercentChangeByTradeDate<TTicker extends MarketDataTicker>(
  history: HistoricalPriceRow<TTicker>[] | DailyPriceInsert[],
  sortedCommonTradeDates: string[],
  lookbackSessions: number,
) {
  const historyByTradeDate = buildTradeDateLookup(history);
  const percentChangeByTradeDate: Record<string, number> = {};

  for (let index = lookbackSessions; index < sortedCommonTradeDates.length; index += 1) {
    const tradeDate = sortedCommonTradeDates[index];
    const lookbackTradeDate = sortedCommonTradeDates[index - lookbackSessions];
    const latestRow = historyByTradeDate.get(tradeDate);
    const previousRow = historyByTradeDate.get(lookbackTradeDate);

    if (!latestRow || !previousRow) {
      continue;
    }

    percentChangeByTradeDate[tradeDate] = calculatePercentChange(
      latestRow.close,
      previousRow.close,
    );
  }

  return percentChangeByTradeDate;
}

function buildUsoMomentumByTradeDate(
  usoHistory: HistoricalPriceRow<"USO">[],
  sortedCommonTradeDates: string[],
) {
  return buildSessionPercentChangeByTradeDate(
    usoHistory,
    sortedCommonTradeDates,
    ANALOG_MODEL_SETTINGS.usoMomentumLookbackSessions,
  );
}

function buildGammaExposureByTradeDate(
  vixHistory: HistoricalPriceRow<"^VIX">[],
  sortedCommonTradeDates: string[],
) {
  const vixRateOfChangeByTradeDate = buildSessionPercentChangeByTradeDate(
    vixHistory,
    sortedCommonTradeDates,
    ANALOG_MODEL_SETTINGS.usoMomentumLookbackSessions,
  );

  return Object.fromEntries(
    Object.entries(vixRateOfChangeByTradeDate).map(([tradeDate, value]) => [
      tradeDate,
      Number((-value).toFixed(2)),
    ]),
  );
}

function buildHistoricalAnalogVectors(
  rowsByTicker: Record<TrackedTicker, DailyPriceInsert[]>,
  supplementalHistory: {
    cper: HistoricalPriceRow<"CPER">[];
    hyg: HistoricalPriceRow<"HYG">[];
    uso: HistoricalPriceRow<"USO">[];
    vix: HistoricalPriceRow<"^VIX">[];
  },
  spyTechnicalIndicatorsByTradeDate: Record<string, PersistedTechnicalIndicators>,
  sortedCommonTradeDates: string[],
  gammaExposureByTradeDate: Record<string, number>,
  usoMomentumByTradeDate: Record<string, number>,
): HistoricalAnalogVector[] {
  const spyHistoryByTradeDate = buildTradeDateLookup(rowsByTicker.SPY);
  const tltHistoryByTradeDate = buildTradeDateLookup(rowsByTicker.TLT);
  const gldHistoryByTradeDate = buildTradeDateLookup(rowsByTicker.GLD);
  const hygHistoryByTradeDate = buildTradeDateLookup(supplementalHistory.hyg);
  const cperHistoryByTradeDate = buildTradeDateLookup(supplementalHistory.cper);
  const vixHistoryByTradeDate = buildTradeDateLookup(supplementalHistory.vix);
  const historicalAnalogVectors: HistoricalAnalogVector[] = [];

  for (
    let index = ANALOG_MODEL_SETTINGS.usoMomentumLookbackSessions;
    index < sortedCommonTradeDates.length - 3;
    index += 1
  ) {
    const tradeDate = sortedCommonTradeDates[index];
    const nextTradeDate = sortedCommonTradeDates[index + 1];
    const thirdForwardTradeDate = sortedCommonTradeDates[index + 3];
    const currentSpyRow = spyHistoryByTradeDate.get(tradeDate);
    const nextSpyRow = spyHistoryByTradeDate.get(nextTradeDate);
    const thirdForwardSpyRow = spyHistoryByTradeDate.get(thirdForwardTradeDate);
    const hygRow = hygHistoryByTradeDate.get(tradeDate);
    const tltRow = tltHistoryByTradeDate.get(tradeDate);
    const cperRow = cperHistoryByTradeDate.get(tradeDate);
    const gldRow = gldHistoryByTradeDate.get(tradeDate);
    const vixRow = vixHistoryByTradeDate.get(tradeDate);
    const spyIndicators = spyTechnicalIndicatorsByTradeDate[tradeDate] ?? {};
    const gammaExposure = gammaExposureByTradeDate[tradeDate];
    const spyRsi = getNumericTechnicalIndicator(spyIndicators, "rsi14");
    const uso5DayMomentum = usoMomentumByTradeDate[tradeDate];

    if (
      !currentSpyRow ||
      !nextSpyRow ||
      !thirdForwardSpyRow ||
      !hygRow ||
      !tltRow ||
      !cperRow ||
      !gldRow ||
      !vixRow ||
      gammaExposure == null ||
      spyRsi == null ||
      uso5DayMomentum == null
    ) {
      continue;
    }

    historicalAnalogVectors.push({
      tradeDate,
      vector: {
        spyRsi,
        gammaExposure,
        hygTltRatio: hygRow.close / tltRow.close,
        cperGldRatio: cperRow.close / gldRow.close,
        usoMomentum: uso5DayMomentum,
        vixLevel: vixRow.close,
      },
      spyForward1DayReturn: calculatePercentChange(nextSpyRow.close, currentSpyRow.close),
      spyForward3DayReturn: calculatePercentChange(
        thirdForwardSpyRow.close,
        currentSpyRow.close,
      ),
    });
  }

  return historicalAnalogVectors;
}

function buildExpandedDailyBiasData(
  spyTechnicalIndicatorsByTradeDate: Record<string, PersistedTechnicalIndicators>,
  supplementalHistory: {
    cper: HistoricalPriceRow<"CPER">[];
    hyg: HistoricalPriceRow<"HYG">[];
    uso: HistoricalPriceRow<"USO">[];
    vix: HistoricalPriceRow<"^VIX">[];
  },
  gammaExposureByTradeDate: Record<string, number>,
  historicalAnalogVectors: HistoricalAnalogVector[],
  usoMomentumByTradeDate: Record<string, number>,
  previousTradeDate: string,
  latestTradeDate: string,
): ExpandedDailyBiasData {
  const latestSpyIndicators = spyTechnicalIndicatorsByTradeDate[latestTradeDate] ?? {};

  const spy20DaySma = getNumericTechnicalIndicator(latestSpyIndicators, "sma20");
  const spy14DayRsi = getNumericTechnicalIndicator(latestSpyIndicators, "rsi14");
  const gammaExposure = gammaExposureByTradeDate[latestTradeDate];
  const uso5DayMomentum = usoMomentumByTradeDate[latestTradeDate];

  if (
    spy20DaySma == null ||
    spy14DayRsi == null ||
    gammaExposure == null ||
    uso5DayMomentum == null
  ) {
    throw new Error(
      "Not enough history to calculate SPY 20-day SMA, SPY 14-day RSI, synthetic gamma exposure, and USO 5-day momentum.",
    );
  }

  return {
    cper: buildSupplementalSnapshot(
      supplementalHistory.cper,
      previousTradeDate,
      latestTradeDate,
    ),
    gammaExposure,
    hyg: buildSupplementalSnapshot(
      supplementalHistory.hyg,
      previousTradeDate,
      latestTradeDate,
    ),
    historicalAnalogVectors,
    spy14DayRsi,
    spy20DaySma,
    uso: buildSupplementalSnapshot(
      supplementalHistory.uso,
      previousTradeDate,
      latestTradeDate,
    ),
    uso5DayMomentum,
    vix: buildSupplementalSnapshot(
      supplementalHistory.vix,
      previousTradeDate,
      latestTradeDate,
    ),
  };
}

function buildPersistedPriceRows(
  historyEntries: ReadonlyArray<readonly [TrackedTicker, DailyPriceInsert[]]>,
  supplementalHistory: {
    cper: HistoricalPriceRow<"CPER">[];
    hyg: HistoricalPriceRow<"HYG">[];
    uso: HistoricalPriceRow<"USO">[];
    vix: HistoricalPriceRow<"^VIX">[];
  },
  spyTechnicalIndicatorsByTradeDate: Record<string, PersistedTechnicalIndicators>,
): PersistedDailyPriceRow[] {
  const coreRows = historyEntries.flatMap(([ticker, rows]) =>
    rows.map((row) => ({
      ...row,
      technical_indicators:
        ticker === "SPY" ? spyTechnicalIndicatorsByTradeDate[row.trade_date] ?? {} : {},
    })),
  );

  const supplementalRows = [
    ...supplementalHistory.vix,
    ...supplementalHistory.hyg,
    ...supplementalHistory.cper,
    ...supplementalHistory.uso,
  ].map((row) => ({
    ...row,
    ticker: normalizeTickerForStorage(row.ticker),
    technical_indicators: {},
  }));

  return [...coreRows, ...supplementalRows];
}

function buildEngineInputsPayload(
  tickerChanges: TickerChangeMap,
  expandedData: ExpandedDailyBiasData,
  analogInputs: {
    historicalArrayPayload: ReturnType<typeof buildHistoricalArrayPayload>;
    historicalSeriesSummary: ReturnType<typeof buildHistoricalSeriesSummary>;
  },
  previousTradeDate: string,
  latestTradeDate: string,
  lookbackDays: number,
) {
  return {
    metadata: {
      decay_lambda: ANALOG_MODEL_SETTINGS.temporalDecayLambda,
      rolling_window_years: MAX_ANALOG_LOOKBACK_YEARS,
    },
    marketPlumbing: {
      gammaExposure: expandedData.gammaExposure ?? 0,
    },
    tradeWindow: {
      lookbackDays,
      latestTradeDate,
      previousTradeDate,
    },
    analogModelUniverse: {
      historicalAnalogCount: expandedData.historicalAnalogVectors?.length ?? 0,
      historicalPriceArrays: analogInputs.historicalArrayPayload,
      historicalSeriesSummary: analogInputs.historicalSeriesSummary,
      tickers: [...TRACKED_TICKERS, "VIX", "HYG", "CPER", "USO"],
    },
    coreTickerChanges: tickerChanges,
    supplementalTickerChanges: {
      CPER: expandedData.cper ?? null,
      HYG: expandedData.hyg ?? null,
      USO: expandedData.uso ?? null,
      VIX: expandedData.vix
        ? {
            ...expandedData.vix,
            ticker: "VIX",
          }
        : null,
    },
  };
}

function buildScoreTechnicalIndicatorsPayload(
  latestTradeDate: string,
  spyTechnicalIndicatorsByTradeDate: Record<string, PersistedTechnicalIndicators>,
) {
  return {
    SPY: {
      ...(spyTechnicalIndicatorsByTradeDate[latestTradeDate] ?? {}),
      tradeDate: latestTradeDate,
    },
  };
}

// This service is designed for a daily cron job.
// It backfills enough history to calculate SPY SMA/RSI while also fetching the
// supplemental macro series used by the expanded quant model.
export async function upsertDailyMarketData(
  options: DailySyncOptions = {},
): Promise<DailyBiasResult> {
  const supabase = await ensureMacroBiasTablesExist();
  const asOfDate = options.asOfDate ?? new Date();
  const requestedLookbackDays = Math.max(
    options.lookbackDays ?? DEFAULT_ANALOG_LOOKBACK_DAYS,
    MIN_ANALOG_LOOKBACK_DAYS,
  );
  const maxRollingWindowStart = subtractYears(asOfDate, MAX_ANALOG_LOOKBACK_YEARS);
  const requestedWindowStart = subtractDays(asOfDate, requestedLookbackDays);
  const period1 = requestedWindowStart < maxRollingWindowStart
    ? maxRollingWindowStart
    : requestedWindowStart;
  const lookbackDays = Math.max(
    calculateCalendarDayDifference(period1, asOfDate),
    MIN_ANALOG_LOOKBACK_DAYS,
  );
  const period2 = addDays(asOfDate, 1);

  const [historyEntries, usoHistory, vixHistory, hygHistory, cperHistory] = await Promise.all([
    Promise.all(
      TRACKED_TICKERS.map(async (ticker) => {
        const history = await fetchTickerHistory(ticker, period1, period2);
        return [ticker, history] as const;
      }),
    ),
    fetchTickerHistory("USO", period1, period2),
    fetchTickerHistory("^VIX", period1, period2),
    fetchTickerHistory("HYG", period1, period2),
    fetchTickerHistory("CPER", period1, period2),
  ]);

  const rowsByTicker = Object.fromEntries(historyEntries) as Record<
    TrackedTicker,
    DailyPriceInsert[]
  >;

  const allRows = historyEntries.flatMap(([, rows]) => rows);

  if (allRows.length === 0) {
    throw new Error("The market data provider returned no daily rows.");
  }

  const { previousTradeDate, latestTradeDate, sortedCommonTradeDates } =
    findLatestCommonTradeDates({
      CPER: cperHistory,
      GLD: rowsByTicker.GLD,
      HYG: hygHistory,
      QQQ: rowsByTicker.QQQ,
      SPY: rowsByTicker.SPY,
      TLT: rowsByTicker.TLT,
      USO: usoHistory,
      VIX: vixHistory,
      XLP: rowsByTicker.XLP,
    });
  const tickerChanges = buildTickerChangeMap(rowsByTicker, previousTradeDate, latestTradeDate);
  const spyTechnicalIndicatorsByTradeDate = buildSpyTechnicalIndicatorsByTradeDate(rowsByTicker.SPY);
  const gammaExposureByTradeDate = buildGammaExposureByTradeDate(vixHistory, sortedCommonTradeDates);
  const usoMomentumByTradeDate = buildUsoMomentumByTradeDate(usoHistory, sortedCommonTradeDates);
  const historicalSeriesSummary = buildHistoricalSeriesSummary({
    CPER: cperHistory,
    GLD: rowsByTicker.GLD,
    HYG: hygHistory,
    QQQ: rowsByTicker.QQQ,
    SPY: rowsByTicker.SPY,
    TLT: rowsByTicker.TLT,
    USO: usoHistory,
    VIX: vixHistory,
    XLP: rowsByTicker.XLP,
  });
  const historicalAnalogVectors = buildHistoricalAnalogVectors(
    rowsByTicker,
    {
      cper: cperHistory,
      hyg: hygHistory,
      uso: usoHistory,
      vix: vixHistory,
    },
    spyTechnicalIndicatorsByTradeDate,
    sortedCommonTradeDates,
    gammaExposureByTradeDate,
    usoMomentumByTradeDate,
  );
  const historicalArrayPayload = buildHistoricalArrayPayload({
    CPER: cperHistory,
    GLD: rowsByTicker.GLD,
    HYG: hygHistory,
    QQQ: rowsByTicker.QQQ,
    SPY: rowsByTicker.SPY,
    TLT: rowsByTicker.TLT,
    USO: usoHistory,
    VIX: vixHistory,
    XLP: rowsByTicker.XLP,
  });
  const expandedData = buildExpandedDailyBiasData(
    spyTechnicalIndicatorsByTradeDate,
    {
      cper: cperHistory,
      hyg: hygHistory,
      uso: usoHistory,
      vix: vixHistory,
    },
    gammaExposureByTradeDate,
    historicalAnalogVectors,
    usoMomentumByTradeDate,
    previousTradeDate,
    latestTradeDate,
  );
  const persistedPriceRows = buildPersistedPriceRows(
    historyEntries,
    {
      cper: cperHistory,
      hyg: hygHistory,
      uso: usoHistory,
      vix: vixHistory,
    },
    spyTechnicalIndicatorsByTradeDate,
  );
  const engineInputs = buildEngineInputsPayload(
    tickerChanges,
    expandedData,
    {
      historicalArrayPayload,
      historicalSeriesSummary,
    },
    previousTradeDate,
    latestTradeDate,
    lookbackDays,
  );
  const technicalIndicators = buildScoreTechnicalIndicatorsPayload(
    latestTradeDate,
    spyTechnicalIndicatorsByTradeDate,
  );
  const biasResult = calculateDailyBias({
    tradeDate: latestTradeDate,
    expandedData,
    tickerChanges,
  });

  const { error: priceError } = await supabase.from("etf_daily_prices").upsert(persistedPriceRows, {
    onConflict: "ticker,trade_date",
  });

  if (priceError) {
    // The migration that widens the ticker constraint to include USO may not be
    // applied in every environment yet. Keep the sync operational by retrying the
    // raw price upsert without USO while still preserving its historical array in
    // macro_bias_scores.engine_inputs for the analog model.
    if (isTickerConstraintCompatibilityError(priceError)) {
      const fallbackRows = persistedPriceRows.filter((row) => row.ticker !== "USO");
      const { error: fallbackPriceError } = await supabase.from("etf_daily_prices").upsert(
        fallbackRows,
        {
          onConflict: "ticker,trade_date",
        },
      );

      if (fallbackPriceError) {
        throw fallbackPriceError;
      }
    } else {
      throw priceError;
    }
  }

  const { error: scoreError } = await supabase.from("macro_bias_scores").upsert(
    {
      trade_date: biasResult.tradeDate,
      score: biasResult.score,
      bias_label: biasResult.label,
      component_scores: biasResult.componentScores,
      ticker_changes: biasResult.tickerChanges,
      model_version: MODEL_VERSION,
      engine_inputs: engineInputs,
      technical_indicators: technicalIndicators,
    },
    {
      onConflict: "trade_date",
    },
  );

  if (scoreError) {
    throw scoreError;
  }

  return biasResult;
}