import { calculateRelativeStrengthIndex } from "../macro-bias/technical-analysis";
import { calculateCryptoDailyBias } from "../crypto-bias/calculate-crypto-bias";
import {
  CRYPTO_ANALOG_MODEL_SETTINGS,
  CRYPTO_TRACKED_TICKERS,
} from "../crypto-bias/constants";
import type {
  CryptoDailyBiasResult,
  CryptoDailyPriceInsert,
  CryptoExpandedDailyBiasData,
  CryptoHistoricalAnalogVector,
  CryptoTickerChangeMap,
  CryptoTrackedTicker,
} from "../crypto-bias/types";
import { createSupabaseAdminClient } from "../supabase/admin";

type CryptoSyncOptions = {
  lookbackDays?: number;
  asOfDate?: Date;
  /** When true, write all fetched history to etf_daily_prices instead of just the last 30 days. Use for first-run backfills. */
  writeFullHistory?: boolean;
};

type CryptoMarketDataTicker = string;

type HistoricalPriceRow = {
  ticker: string;
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

type MacroBiasAdminClient = ReturnType<typeof createSupabaseAdminClient>;

const CRYPTO_ONLY_TICKERS = ["BTC-USD", "ETH-USD", "SOL-USD", "DX-Y.NYB"] as const;
const SHARED_TICKERS = ["GLD", "TLT"] as const;
const MODEL_VERSION = "crypto-model-v1";
const MAX_ANALOG_LOOKBACK_YEARS = 10;
const DEFAULT_ANALOG_LOOKBACK_DAYS = 3653;
const MIN_ANALOG_LOOKBACK_DAYS = 45;
const PRICE_UPSERT_LOOKBACK_DAYS = 30;
const UPSERT_BATCH_SIZE = 1000;
const YAHOO_FETCH_MAX_ATTEMPTS = 3;
const YAHOO_FETCH_BASE_DELAY_MS = 1_500;
const STAGGER_DELAY_MS = 250;

function getLogTimestamp() {
  return new Date().toTimeString().slice(0, 8);
}

function log(message: string) {
  console.log(`[${getLogTimestamp()}] [crypto-market-data] ${message}`);
}

function roundPrice(value: number) {
  return Number(value.toFixed(4));
}

function formatTradeDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function subtractDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() - days);
  return next;
}

function subtractYears(date: Date, years: number) {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() - years);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function calculateCalendarDayDifference(startDate: Date, endDate: Date) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((endDate.getTime() - startDate.getTime()) / msPerDay);
}

function normalizeTickerForStorage(ticker: string) {
  if (ticker === "^VIX") return "VIX";
  if (ticker === "DX-Y.NYB") return "DXY";
  return ticker;
}

function calculatePercentChange(currentValue: number, previousValue: number) {
  return Number((((currentValue - previousValue) / previousValue) * 100).toFixed(2));
}

function chunkValues<T>(values: readonly T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchTickerHistory(
  ticker: string,
  period1: Date,
  period2: Date,
): Promise<HistoricalPriceRow[]> {
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
  );
  url.searchParams.set("interval", "1d");
  url.searchParams.set("includeAdjustedClose", "true");
  url.searchParams.set("period1", String(Math.floor(period1.getTime() / 1000)));
  url.searchParams.set("period2", String(Math.floor(period2.getTime() / 1000)));

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= YAHOO_FETCH_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      const delayMs = YAHOO_FETCH_BASE_DELAY_MS * Math.pow(2, attempt - 2);
      await sleep(delayMs);
      log(`Retrying ${ticker} (attempt ${attempt}/${YAHOO_FETCH_MAX_ATTEMPTS})...`);
    }

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });

      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        lastError = new Error(`Yahoo chart API request failed for ${ticker}: ${response.status}.`);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Yahoo chart API request failed for ${ticker}: ${response.status}.`);
      }

      return parseYahooChartResponse(ticker, await response.json());
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(`Unknown fetch error for ${ticker}`);
      if (attempt < YAHOO_FETCH_MAX_ATTEMPTS) continue;
    }
  }

  throw lastError ?? new Error(`Yahoo chart API failed for ${ticker} after ${YAHOO_FETCH_MAX_ATTEMPTS} attempts.`);
}

function parseYahooChartResponse(
  ticker: string,
  payload: YahooChartResponse,
): HistoricalPriceRow[] {
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
      if (closeValue == null) return null;
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
      } satisfies HistoricalPriceRow;
    })
    .filter((row): row is HistoricalPriceRow => row !== null)
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date));
}

async function fetchTickerHistoryWithLogging(
  ticker: string,
  period1: Date,
  period2: Date,
): Promise<HistoricalPriceRow[]> {
  log(`Fetching ticker: ${ticker}...`);
  const history = await fetchTickerHistory(ticker, period1, period2);
  log(`Finished ticker: ${ticker} (${history.length} rows).`);
  return history;
}

async function fetchSharedTickerFromDb(
  supabase: MacroBiasAdminClient,
  ticker: string,
  period1: Date,
  period2: Date,
): Promise<HistoricalPriceRow[]> {
  const storedTicker = normalizeTickerForStorage(ticker);
  const minDate = formatTradeDate(period1);
  const maxDate = formatTradeDate(period2);
  const all: HistoricalPriceRow[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("etf_daily_prices")
      .select("ticker, trade_date, open, high, low, close, adjusted_close, volume, source")
      .eq("ticker", storedTicker)
      .gte("trade_date", minDate)
      .lte("trade_date", maxDate)
      .order("trade_date", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Failed to fetch ${storedTicker} from DB: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as HistoricalPriceRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

function buildTradeDateLookup(history: HistoricalPriceRow[]) {
  return new Map(history.map((row) => [row.trade_date, row]));
}

function buildSessionPercentChangeByTradeDate(
  history: HistoricalPriceRow[],
  sortedDates: string[],
  lookbackSessions: number,
) {
  const byDate = buildTradeDateLookup(history);
  const result: Record<string, number> = {};

  for (let i = lookbackSessions; i < sortedDates.length; i += 1) {
    const tradeDate = sortedDates[i];
    const lookbackDate = sortedDates[i - lookbackSessions];
    const current = byDate.get(tradeDate);
    const previous = byDate.get(lookbackDate);
    if (!current || !previous) continue;
    result[tradeDate] = calculatePercentChange(current.close, previous.close);
  }

  return result;
}

function computeBtcRealizedVol(
  btcHistory: HistoricalPriceRow[],
  sortedDates: string[],
  window: number,
): Record<string, number> {
  const byDate = buildTradeDateLookup(btcHistory);
  const result: Record<string, number> = {};

  for (let i = window; i < sortedDates.length; i += 1) {
    const tradeDate = sortedDates[i];
    const logReturns: number[] = [];

    for (let j = i - window + 1; j <= i; j += 1) {
      const today = byDate.get(sortedDates[j]);
      const yesterday = byDate.get(sortedDates[j - 1]);
      if (today && yesterday && yesterday.close > 0) {
        logReturns.push(Math.log(today.close / yesterday.close));
      }
    }

    if (logReturns.length >= window - 1) {
      const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
      const variance = logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / logReturns.length;
      const dailyStdDev = Math.sqrt(variance);
      // Annualize by sqrt(365) because crypto trades every day
      result[tradeDate] = Number((dailyStdDev * Math.sqrt(365) * 100).toFixed(2));
    }
  }

  return result;
}

function buildBtcTechnicalIndicatorsByTradeDate(btcHistory: HistoricalPriceRow[]) {
  const sorted = [...btcHistory].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const closes: number[] = [];
  const result: Record<string, { rsi14?: number }> = {};

  for (const row of sorted) {
    closes.push(row.close);
    const indicators: { rsi14?: number } = {};
    if (closes.length >= 15) {
      indicators.rsi14 = calculateRelativeStrengthIndex(closes, 14);
    }
    result[row.trade_date] = indicators;
  }

  return result;
}

function buildCryptoHistoricalAnalogVectors(
  btcHistory: HistoricalPriceRow[],
  ethHistory: HistoricalPriceRow[],
  gldHistory: HistoricalPriceRow[],
  dxyHistory: HistoricalPriceRow[],
  tltHistory: HistoricalPriceRow[],
  btcTechnicalsByDate: Record<string, { rsi14?: number }>,
  btcRealizedVolByDate: Record<string, number>,
  dxyMomentumByDate: Record<string, number>,
  tltMomentumByDate: Record<string, number>,
  sortedCommonDates: string[],
): CryptoHistoricalAnalogVector[] {
  const btcByDate = buildTradeDateLookup(btcHistory);
  const ethByDate = buildTradeDateLookup(ethHistory);
  const gldByDate = buildTradeDateLookup(gldHistory);

  const minLookback = Math.max(
    CRYPTO_ANALOG_MODEL_SETTINGS.dxyMomentumLookbackSessions,
    CRYPTO_ANALOG_MODEL_SETTINGS.tltMomentumLookbackSessions,
    CRYPTO_ANALOG_MODEL_SETTINGS.btcRealizedVolWindow,
  );

  const vectors: CryptoHistoricalAnalogVector[] = [];

  for (let i = minLookback; i < sortedCommonDates.length - 3; i += 1) {
    const tradeDate = sortedCommonDates[i];
    const nextDate = sortedCommonDates[i + 1];
    const thirdForwardDate = sortedCommonDates[i + 3];

    const btcRow = btcByDate.get(tradeDate);
    const nextBtcRow = btcByDate.get(nextDate);
    const thirdBtcRow = btcByDate.get(thirdForwardDate);
    const ethRow = ethByDate.get(tradeDate);
    const gldRow = gldByDate.get(tradeDate);

    const btcRsi = btcTechnicalsByDate[tradeDate]?.rsi14;
    const btcRealizedVol = btcRealizedVolByDate[tradeDate];
    const dxyMomentum = dxyMomentumByDate[tradeDate];
    const tltMomentum = tltMomentumByDate[tradeDate];

    if (
      !btcRow || !nextBtcRow || !thirdBtcRow || !ethRow || !gldRow ||
      btcRsi == null || btcRealizedVol == null ||
      dxyMomentum == null || tltMomentum == null
    ) {
      continue;
    }

    vectors.push({
      tradeDate,
      vector: {
        btcRsi,
        ethBtcRatio: ethRow.close / btcRow.close,
        btcGldRatio: btcRow.close / gldRow.close,
        dxyMomentum,
        btcRealizedVol,
        tltMomentum,
      },
      btcForward1DayReturn: calculatePercentChange(nextBtcRow.close, btcRow.close),
      btcForward3DayReturn: calculatePercentChange(thirdBtcRow.close, btcRow.close),
    });
  }

  return vectors;
}

function buildSortedCommonTradeDates(
  seriesByTicker: Record<string, HistoricalPriceRow[]>,
) {
  const intersection = Object.values(seriesByTicker).reduce<Set<string> | null>(
    (acc, rows) => {
      const dates = new Set(rows.map((r) => r.trade_date));
      if (!acc) return dates;
      return new Set([...acc].filter((d) => dates.has(d)));
    },
    null,
  );
  return [...(intersection ?? [])].sort((a, b) => a.localeCompare(b));
}

function buildSortedBtcEthTradeDates(
  btcHistory: HistoricalPriceRow[],
  ethHistory: HistoricalPriceRow[],
) {
  // For weekend dates, DXY and TLT will be missing. We use all BTC dates
  // and carry forward the last known close for missing tickers.
  const btcDates = new Set(btcHistory.map((r) => r.trade_date));
  const ethDates = new Set(ethHistory.map((r) => r.trade_date));
  // Use the union of BTC dates where both BTC and ETH are available
  const commonDates = [...btcDates].filter((d) => ethDates.has(d));
  return commonDates.sort((a, b) => a.localeCompare(b));
}

function carryForwardFill(
  history: HistoricalPriceRow[],
  targetDates: string[],
): HistoricalPriceRow[] {
  const byDate = buildTradeDateLookup(history);
  const sorted = [...history].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const filled: HistoricalPriceRow[] = [];
  let lastKnown: HistoricalPriceRow | null = null;

  let histIdx = 0;
  for (const date of targetDates) {
    // Advance histIdx to find the latest row on or before date
    while (histIdx < sorted.length && sorted[histIdx].trade_date <= date) {
      lastKnown = sorted[histIdx];
      histIdx += 1;
    }

    const existing = byDate.get(date);
    if (existing) {
      filled.push(existing);
    } else if (lastKnown) {
      filled.push({ ...lastKnown, trade_date: date });
    }
  }

  return filled;
}

async function upsertRowsInBatches(
  supabase: MacroBiasAdminClient,
  tableName: string,
  rows: readonly Record<string, unknown>[],
  onConflict: string,
) {
  if (rows.length === 0) {
    log(`No rows to upsert for ${tableName}.`);
    return null;
  }

  const batches = chunkValues(rows, UPSERT_BATCH_SIZE);

  for (let i = 0; i < batches.length; i += 1) {
    log(`Upserting batch ${i + 1} of ${batches.length} to ${tableName}...`);
    const { error } = await supabase.from(tableName).upsert(batches[i], { onConflict });
    if (error) return error;
  }

  return null;
}

export async function upsertCryptoMarketData(
  options: CryptoSyncOptions = {},
): Promise<CryptoDailyBiasResult> {
  log("Entering upsertCryptoMarketData().");
  const supabase = createSupabaseAdminClient();
  const asOfDate = options.asOfDate ?? new Date();
  const writeFullHistory = options.writeFullHistory ?? false;
  const requestedLookbackDays = Math.max(
    options.lookbackDays ?? DEFAULT_ANALOG_LOOKBACK_DAYS,
    MIN_ANALOG_LOOKBACK_DAYS,
  );
  const maxRollingWindowStart = subtractYears(asOfDate, MAX_ANALOG_LOOKBACK_YEARS);
  const requestedWindowStart = subtractDays(asOfDate, requestedLookbackDays);
  const period1 = requestedWindowStart < maxRollingWindowStart
    ? maxRollingWindowStart
    : requestedWindowStart;
  const period2 = addDays(asOfDate, 1);

  log(`Lookback from ${formatTradeDate(period1)} to ${formatTradeDate(asOfDate)}.`);

  // Fetch crypto-only tickers from Yahoo Finance with staggered requests
  const cryptoHistories: Record<string, HistoricalPriceRow[]> = {};
  for (const ticker of CRYPTO_ONLY_TICKERS) {
    cryptoHistories[ticker] = await fetchTickerHistoryWithLogging(ticker, period1, period2);
    await sleep(STAGGER_DELAY_MS);
  }

  // Fetch shared tickers from DB first; fall back to Yahoo if missing
  const sharedHistories: Record<string, HistoricalPriceRow[]> = {};
  for (const ticker of SHARED_TICKERS) {
    log(`Checking DB for shared ticker: ${ticker}...`);
    const dbRows = await fetchSharedTickerFromDb(supabase, ticker, period1, period2);
    if (dbRows.length > 0) {
      log(`Found ${dbRows.length} rows for ${ticker} in DB.`);
      sharedHistories[ticker] = dbRows;
    } else {
      log(`No DB data for ${ticker}, fetching from Yahoo Finance...`);
      sharedHistories[ticker] = await fetchTickerHistoryWithLogging(ticker, period1, period2);
      await sleep(STAGGER_DELAY_MS);
    }
  }

  const btcHistory = cryptoHistories["BTC-USD"];
  const ethHistory = cryptoHistories["ETH-USD"];
  const solHistory = cryptoHistories["SOL-USD"];
  const dxyHistory = cryptoHistories["DX-Y.NYB"];
  const gldHistory = sharedHistories["GLD"];
  const tltHistory = sharedHistories["TLT"];

  if (!btcHistory?.length || !ethHistory?.length) {
    throw new Error("Yahoo Finance returned no BTC or ETH data.");
  }

  // Build the common dates where both BTC and ETH trade
  const btcEthDates = buildSortedBtcEthTradeDates(btcHistory, ethHistory);

  // Carry forward DXY and TLT for weekends
  const dxyFilled = carryForwardFill(dxyHistory, btcEthDates);
  const tltFilled = carryForwardFill(tltHistory, btcEthDates);
  const gldFilled = carryForwardFill(gldHistory, btcEthDates);

  // Build sorted common dates across all filled series
  const sortedCommonDates = buildSortedCommonTradeDates({
    "BTC-USD": btcHistory.filter((r) => btcEthDates.includes(r.trade_date)),
    "ETH-USD": ethHistory.filter((r) => btcEthDates.includes(r.trade_date)),
    GLD: gldFilled,
    DXY: dxyFilled,
    TLT: tltFilled,
  });

  if (sortedCommonDates.length < 2) {
    throw new Error("Not enough overlapping crypto market sessions to score the day.");
  }

  const latestTradeDate = sortedCommonDates.at(-1)!;
  const previousTradeDate = sortedCommonDates.at(-2)!;

  log(`Latest trade date: ${latestTradeDate}, previous: ${previousTradeDate}.`);

  // Build technical indicators
  const btcTechnicalsByDate = buildBtcTechnicalIndicatorsByTradeDate(btcHistory);
  const btcRealizedVolByDate = computeBtcRealizedVol(
    btcHistory,
    sortedCommonDates,
    CRYPTO_ANALOG_MODEL_SETTINGS.btcRealizedVolWindow,
  );
  const dxyMomentumByDate = buildSessionPercentChangeByTradeDate(
    dxyFilled,
    sortedCommonDates,
    CRYPTO_ANALOG_MODEL_SETTINGS.dxyMomentumLookbackSessions,
  );
  const tltMomentumByDate = buildSessionPercentChangeByTradeDate(
    tltFilled,
    sortedCommonDates,
    CRYPTO_ANALOG_MODEL_SETTINGS.tltMomentumLookbackSessions,
  );

  // Build historical analog vectors
  const historicalAnalogVectors = buildCryptoHistoricalAnalogVectors(
    btcHistory,
    ethHistory,
    gldFilled,
    dxyFilled,
    tltFilled,
    btcTechnicalsByDate,
    btcRealizedVolByDate,
    dxyMomentumByDate,
    tltMomentumByDate,
    sortedCommonDates,
  );

  // Build today's expanded data
  const btcRsi = btcTechnicalsByDate[latestTradeDate]?.rsi14;
  const btcRealizedVol = btcRealizedVolByDate[latestTradeDate];
  const dxyMomentum = dxyMomentumByDate[latestTradeDate];
  const tltMomentum = tltMomentumByDate[latestTradeDate];
  const btcRow = buildTradeDateLookup(btcHistory).get(latestTradeDate);
  const ethRow = buildTradeDateLookup(ethHistory).get(latestTradeDate);
  const gldRow = buildTradeDateLookup(gldFilled).get(latestTradeDate);

  if (
    btcRsi == null || btcRealizedVol == null ||
    dxyMomentum == null || tltMomentum == null ||
    !btcRow || !ethRow || !gldRow
  ) {
    throw new Error("Not enough data to compute crypto bias features for today.");
  }

  const expandedData: CryptoExpandedDailyBiasData = {
    btc14DayRsi: btcRsi,
    ethBtcRatio: ethRow.close / btcRow.close,
    btcGldRatio: btcRow.close / gldRow.close,
    dxyMomentum,
    btcRealizedVol,
    tltMomentum,
    historicalAnalogVectors,
  };

  // Build ticker changes for tracked tickers
  const tickerChanges = {} as CryptoTickerChangeMap;
  const allTrackedHistories: Record<string, HistoricalPriceRow[]> = {
    "BTC-USD": btcHistory,
    "ETH-USD": ethHistory,
    "SOL-USD": solHistory,
  };

  for (const ticker of CRYPTO_TRACKED_TICKERS) {
    const history = allTrackedHistories[ticker];
    const prev = history?.find((r) => r.trade_date === previousTradeDate);
    const latest = history?.find((r) => r.trade_date === latestTradeDate);

    if (prev && latest) {
      tickerChanges[ticker] = {
        ticker,
        tradeDate: latestTradeDate,
        close: latest.close,
        previousClose: prev.close,
        percentChange: calculatePercentChange(latest.close, prev.close),
      };
    } else {
      // SOL may be missing on early dates; use a zero-change placeholder
      const latestRow = history?.at(-1);
      tickerChanges[ticker] = {
        ticker,
        tradeDate: latestTradeDate,
        close: latestRow?.close ?? 0,
        previousClose: latestRow?.close ?? 0,
        percentChange: 0,
      };
    }
  }

  // Calculate crypto bias
  log("Starting calculateCryptoDailyBias().");
  const biasResult = calculateCryptoDailyBias({
    tradeDate: latestTradeDate,
    expandedData,
    tickerChanges,
  });
  log(`Finished calculateCryptoDailyBias() with score ${biasResult.score}.`);

  // Upsert price rows to DB
  const allPriceRows = [
    ...btcHistory, ...ethHistory, ...solHistory,
    ...dxyHistory.map((r) => ({ ...r, ticker: normalizeTickerForStorage(r.ticker) })),
  ];

  const minUpsertDate = writeFullHistory
    ? "2000-01-01"
    : formatTradeDate(subtractDays(new Date(`${latestTradeDate}T00:00:00Z`), PRICE_UPSERT_LOOKBACK_DAYS));
  const recentPriceRows = allPriceRows
    .filter((r) => r.trade_date >= minUpsertDate)
    .map((r) => ({
      ticker: normalizeTickerForStorage(r.ticker),
      trade_date: r.trade_date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      adjusted_close: r.adjusted_close,
      volume: r.volume,
      source: r.source,
    }));

  log(`Upserting ${recentPriceRows.length} crypto price rows.`);
  const priceError = await upsertRowsInBatches(
    supabase,
    "etf_daily_prices",
    recentPriceRows,
    "ticker,trade_date",
  );
  if (priceError) throw priceError;
  log("Finished crypto price upsert.");

  // Upsert crypto bias score
  const scoreRows = [
    {
      trade_date: biasResult.tradeDate,
      score: biasResult.score,
      bias_label: biasResult.label,
      component_scores: biasResult.componentScores,
      ticker_changes: biasResult.tickerChanges,
      engine_inputs: expandedData,
      technical_indicators: { BTC: btcTechnicalsByDate[latestTradeDate] ?? {} },
    },
  ];

  log("Starting crypto_bias_scores upsert.");
  const scoreError = await upsertRowsInBatches(
    supabase,
    "crypto_bias_scores",
    scoreRows,
    "trade_date",
  );
  if (scoreError) throw scoreError;
  log("Finished crypto_bias_scores upsert.");

  return biasResult;
}
