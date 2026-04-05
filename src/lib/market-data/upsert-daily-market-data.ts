import { calculateDailyBias } from "../macro-bias/calculate-daily-bias";
import { TRACKED_TICKERS } from "../macro-bias/constants";
import type {
  DailyBiasResult,
  DailyPriceInsert,
  TickerChangeMap,
  TrackedTicker,
} from "../macro-bias/types";
import { createSupabaseAdminClient } from "../supabase/admin";

type DailySyncOptions = {
  lookbackDays?: number;
  asOfDate?: Date;
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

async function fetchTickerHistory(
  ticker: TrackedTicker,
  period1: Date,
  period2: Date,
): Promise<DailyPriceInsert[]> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`);

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

      return {
        ticker,
        trade_date: formatTradeDate(new Date(timestamp * 1000)),
        open: roundPrice(quote.open?.[index] ?? close),
        high: roundPrice(quote.high?.[index] ?? close),
        low: roundPrice(quote.low?.[index] ?? close),
        close,
        adjusted_close: roundPrice(adjustedCloses[index] ?? close),
        volume: Math.round(quote.volume?.[index] ?? 0),
        source: "yahoo-chart-api",
      } satisfies DailyPriceInsert;
    })
    .filter((row): row is DailyPriceInsert => row !== null)
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

// This service is designed for a daily cron job.
// It backfills a short lookback window on every run so a missed day can self-heal,
// then recomputes the latest common-session macro bias from the stored ETF data.
export async function upsertDailyMarketData(
  options: DailySyncOptions = {},
): Promise<DailyBiasResult> {
  const supabase = await ensureMacroBiasTablesExist();
  const lookbackDays = options.lookbackDays ?? 14;
  const asOfDate = options.asOfDate ?? new Date();
  const period1 = subtractDays(asOfDate, lookbackDays);
  const period2 = addDays(asOfDate, 1);

  const historyEntries = await Promise.all(
    TRACKED_TICKERS.map(async (ticker) => {
      const history = await fetchTickerHistory(ticker, period1, period2);
      return [ticker, history] as const;
    }),
  );

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
  const biasResult = calculateDailyBias({
    tradeDate: latestTradeDate,
    tickerChanges,
  });

  const { error: priceError } = await supabase.from("etf_daily_prices").upsert(allRows, {
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