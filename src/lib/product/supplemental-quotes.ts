import 'server-only';
import { latestCompletedPriceDate, parseCompletedYahooPrices, type CompletedPriceTicker } from '../market-data/completed-price-bars';

export type SupplementalQuote<Ticker extends string = string> = {
  currentPrice: number;
  dailyChangePercent: number;
  ticker: Ticker;
  tradeDate: string;
  dateSource: 'supplemental';
};

const QUOTE_TIMEOUT_MS = 2_000;
const SOURCE_TICKERS = new Set<CompletedPriceTicker>(['SPY', 'QQQ', 'XLP', 'TLT', 'GLD', 'IWM', 'HYG', '^VIX', 'UUP', 'USO', 'BTC-USD', 'ETH-USD', 'SOL-USD']);

function quoteUrl(ticker: string) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  // Public price data only; never use a cached forming candle as a daily close.
  url.searchParams.set('range', '1mo');
  url.searchParams.set('interval', '1d');
  url.searchParams.set('includeAdjustedClose', 'true');
  url.searchParams.set('includePrePost', 'false');
  return url;
}

async function getSupplementalQuote<Ticker extends string>(sourceTicker: string, ticker: Ticker): Promise<SupplementalQuote<Ticker> | null> {
  if (!SOURCE_TICKERS.has(sourceTicker as CompletedPriceTicker)) return null;
  const source = sourceTicker as CompletedPriceTicker;
  const now = new Date();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, QUOTE_TIMEOUT_MS);
  });
  const request = (async (): Promise<SupplementalQuote<Ticker> | null> => {
    try {
      const response = await fetch(quoteUrl(sourceTicker), {
        cache: 'no-store',
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const payload = await response.json() as Parameters<typeof parseCompletedYahooPrices>[1];
      const rows = parseCompletedYahooPrices(source, payload, now);
      const points = [...new Map(rows.map(row => [row.trade_date, row])).values()];
      if (points.length < 2) return null;
      const latestRow = points.at(-1)!;
      if (latestRow.trade_date !== latestCompletedPriceDate(source, now)) return null;
      const latest = latestRow.close;
      const previous = points.at(-2)!.close;
      const change = ((latest - previous) / previous) * 100;
      if (!Number.isFinite(change)) return null;
      return {
        currentPrice: Number(latest.toFixed(2)),
        dailyChangePercent: Number(change.toFixed(2)),
        ticker,
        tradeDate: latestRow.trade_date,
        dateSource: 'supplemental',
      };
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([request, expired]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** Public market prices only. Never pass account, subscription or session data. */
export async function getSupplementalQuotes<Ticker extends string>(tickers: readonly (readonly [sourceTicker: string, ticker: Ticker])[]): Promise<SupplementalQuote<Ticker>[]> {
  const quotes = await Promise.all(tickers.map(([source, ticker]) => getSupplementalQuote(source, ticker)));
  return quotes.filter((quote): quote is SupplementalQuote<Ticker> => quote !== null);
}
