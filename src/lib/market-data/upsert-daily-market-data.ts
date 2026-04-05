import { calculateDailyBias } from "../macro-bias/calculate-daily-bias";
import { TRACKED_TICKERS } from "../macro-bias/constants";
import {
  calculateRelativeStrengthIndex,
  calculateSimpleMovingAverage,
} from "../macro-bias/technical-analysis";
import type {
  DailyBiasResult,
  DailyPriceInsert,
  ExpandedDailyBiasData,
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

const SUPPLEMENTAL_TICKERS = ["^VIX", "HYG", "CPER"] as const satisfies readonly SupplementalTicker[];
const MODEL_VERSION = "macro-model-v2";

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

function findLatestCommonTradeDates(rowsByTicker: Record<TrackedTicker, DailyPriceInsert[]>) {
  const commonDates = TRACKED_TICKERS.reduce<Set<string> | null>((intersection, ticker) => {
    const tickerDates = new Set(rowsByTicker[ticker].map((row) => row.trade_date));

    if (!intersection) {
      return tickerDates;
    }

    return new Set([...intersection].filter((date) => tickerDates.has(date)));
  }, null);

  const sortedDates = [...(commonDates ?? [])].sort((left, right) => left.localeCompare(right));

  if (sortedDates.length < 2) {
    throw new Error("Not enough overlapping market sessions were returned to score the day.");
  }

  return {
    previousTradeDate: sortedDates.at(-2)!,
    latestTradeDate: sortedDates.at(-1)!,
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

function buildSupplementalSnapshot<TTicker extends SupplementalTicker>(
  history: HistoricalPriceRow<TTicker>[],
  previousTradeDate: string,
  latestTradeDate: string,
): SupplementalTickerSnapshot<TTicker> | undefined {
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
    percentChange: Number(
      (((latestRow.close - previousRow.close) / previousRow.close) * 100).toFixed(2),
    ),
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

function buildExpandedDailyBiasData(
  spyTechnicalIndicatorsByTradeDate: Record<string, PersistedTechnicalIndicators>,
  supplementalHistory: {
    cper: HistoricalPriceRow<"CPER">[];
    hyg: HistoricalPriceRow<"HYG">[];
    vix: HistoricalPriceRow<"^VIX">[];
  },
  previousTradeDate: string,
  latestTradeDate: string,
): ExpandedDailyBiasData {
  const latestSpyIndicators = spyTechnicalIndicatorsByTradeDate[latestTradeDate] ?? {};

  const spy20DaySma = getNumericTechnicalIndicator(latestSpyIndicators, "sma20");
  const spy14DayRsi = getNumericTechnicalIndicator(latestSpyIndicators, "rsi14");

  if (spy20DaySma == null || spy14DayRsi == null) {
    throw new Error("Not enough SPY history to calculate the required 20-day SMA and 14-day RSI.");
  }

  return {
    cper: buildSupplementalSnapshot(
      supplementalHistory.cper,
      previousTradeDate,
      latestTradeDate,
    ),
    hyg: buildSupplementalSnapshot(
      supplementalHistory.hyg,
      previousTradeDate,
      latestTradeDate,
    ),
    spy14DayRsi,
    spy20DaySma,
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
  previousTradeDate: string,
  latestTradeDate: string,
  lookbackDays: number,
) {
  return {
    tradeWindow: {
      lookbackDays,
      latestTradeDate,
      previousTradeDate,
    },
    coreTickerChanges: tickerChanges,
    supplementalTickerChanges: {
      CPER: expandedData.cper ?? null,
      HYG: expandedData.hyg ?? null,
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
  const lookbackDays = Math.max(options.lookbackDays ?? 60, 45);
  const asOfDate = options.asOfDate ?? new Date();
  const period1 = subtractDays(asOfDate, lookbackDays);
  const period2 = addDays(asOfDate, 1);

  const [historyEntries, vixHistory, hygHistory, cperHistory] = await Promise.all([
    Promise.all(
      TRACKED_TICKERS.map(async (ticker) => {
        const history = await fetchTickerHistory(ticker, period1, period2);
        return [ticker, history] as const;
      }),
    ),
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

  const { previousTradeDate, latestTradeDate } = findLatestCommonTradeDates(rowsByTicker);
  const tickerChanges = buildTickerChangeMap(rowsByTicker, previousTradeDate, latestTradeDate);
  const spyTechnicalIndicatorsByTradeDate = buildSpyTechnicalIndicatorsByTradeDate(rowsByTicker.SPY);
  const expandedData = buildExpandedDailyBiasData(
    spyTechnicalIndicatorsByTradeDate,
    {
      cper: cperHistory,
      hyg: hygHistory,
      vix: vixHistory,
    },
    previousTradeDate,
    latestTradeDate,
  );
  const persistedPriceRows = buildPersistedPriceRows(
    historyEntries,
    {
      cper: cperHistory,
      hyg: hygHistory,
      vix: vixHistory,
    },
    spyTechnicalIndicatorsByTradeDate,
  );
  const engineInputs = buildEngineInputsPayload(
    tickerChanges,
    expandedData,
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
    throw priceError;
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