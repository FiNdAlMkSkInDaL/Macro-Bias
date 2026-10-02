import 'server-only';

export type SupplementalQuote<Ticker extends string = string> = {
  currentPrice: number;
  dailyChangePercent: number;
  ticker: Ticker;
  tradeDate: string;
  dateSource: 'supplemental';
};

const QUOTE_TIMEOUT_MS = 2_000;
const QUOTE_REVALIDATE_SECONDS = 300;

type YahooChartResponse = {
  chart?: { result?: Array<{
    timestamp?: number[];
    indicators?: { quote?: Array<{ close?: Array<number | null> }> };
  }> };
};

function quoteUrl(ticker: string) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  // A stable, public-only URL lets both workspaces reuse the same short cache.
  url.searchParams.set('range', '1mo');
  url.searchParams.set('interval', '1d');
  url.searchParams.set('includeAdjustedClose', 'false');
  return url;
}

async function getSupplementalQuote<Ticker extends string>(sourceTicker: string, ticker: Ticker): Promise<SupplementalQuote<Ticker> | null> {
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
        cache: 'force-cache',
        next: { revalidate: QUOTE_REVALIDATE_SECONDS },
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const payload = await response.json() as YahooChartResponse;
      const result = payload.chart?.result?.[0];
      const timestamps = result?.timestamp ?? [];
      const closes = result?.indicators?.quote?.[0]?.close ?? [];
      const distinct = new Map<number, number>();
      for (const [index, timestamp] of timestamps.entries()) {
        const close = closes[index];
        if (Number.isFinite(timestamp) && timestamp > 0 && typeof close === 'number' && Number.isFinite(close) && close > 0) {
          distinct.set(timestamp, close);
        }
      }
      const points = [...distinct].sort(([left], [right]) => left - right);
      if (points.length < 2) return null;
      const [timestamp, latest] = points.at(-1)!;
      const previous = points.at(-2)![1];
      const date = new Date(timestamp * 1000);
      const change = ((latest - previous) / previous) * 100;
      if (!Number.isFinite(date.getTime()) || !Number.isFinite(change)) return null;
      return {
        currentPrice: Number(latest.toFixed(2)),
        dailyChangePercent: Number(change.toFixed(2)),
        ticker,
        tradeDate: date.toISOString().slice(0, 10),
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
