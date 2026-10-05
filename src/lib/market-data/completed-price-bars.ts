export type ChartPriceTicker = 'SPY' | 'BTC-USD';
export type CompletedPriceTicker = ChartPriceTicker | 'ETH-USD' | 'SOL-USD' | 'QQQ' | 'XLP' | 'TLT' | 'GLD' | 'IWM' | 'HYG' | '^VIX' | 'UUP' | 'USO';

export type CompletedPriceRow = {
  ticker: CompletedPriceTicker;
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjusted_close: number;
  volume: number;
  source: 'yahoo-chart-api';
};

type YahooChartPayload = {
  chart?: {
    error?: { description?: string } | null;
    result?: Array<{
      meta?: { symbol?: string; exchangeTimezoneName?: string };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    }>;
  };
};

function isoDate(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function previousCalendarDate(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** NYSE cash holidays; early-close days remain sessions. */
function nyseHoliday(tradeDate: string) {
  const year = Number(tradeDate.slice(0, 4));
  const date = (month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
  const format = (value: Date) => value.toISOString().slice(0, 10);
  const observed = (month: number, day: number) => {
    const value = date(month, day);
    value.setUTCDate(value.getUTCDate() + (value.getUTCDay() === 6 ? -1 : value.getUTCDay() === 0 ? 1 : 0));
    return format(value);
  };
  const weekday = (month: number, dayOfWeek: number, occurrence: number) => {
    const first = date(month, 1);
    return format(date(month, 1 + ((dayOfWeek - first.getUTCDay() + 7) % 7) + (occurrence - 1) * 7));
  };
  const mayEnd = date(6, 0);
  mayEnd.setUTCDate(mayEnd.getUTCDate() - ((mayEnd.getUTCDay() + 6) % 7));
  // Gregorian Easter gives the exchange's Good Friday closure.
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easter = date(Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
  easter.setUTCDate(easter.getUTCDate() - 2);
  const newYear = date(1, 1);
  // NYSE does not observe a Saturday New Year's Day on the prior Friday.
  const holidays = new Set([
    newYear.getUTCDay() === 6 ? '' : observed(1, 1), weekday(1, 1, 3), weekday(2, 1, 3),
    format(easter), format(mayEnd), year >= 2022 ? observed(6, 19) : '', observed(7, 4),
    weekday(9, 1, 1), weekday(11, 4, 4), observed(12, 25),
  ]);
  return holidays.has(tradeDate);
}

/** A bound, not an invented session: provider rows determine holidays and gaps. */
export function completedPriceDateCutoff(ticker: CompletedPriceTicker, now = new Date()) {
  if (ticker.endsWith('-USD')) return previousCalendarDate(now.toISOString().slice(0, 10));
  const date = isoDate(now, 'America/New_York');
  const parts = new Map(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(now).map((part) => [part.type, part.value]));
  // Conservative finality buffer also safely covers early-close sessions.
  const minutes = Number(parts.get('hour')) * 60 + Number(parts.get('minute'));
  return minutes >= 16 * 60 + 15 ? date : previousCalendarDate(date);
}

export function isCompletedPriceDate(ticker: CompletedPriceTicker, tradeDate: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return false;
  const date = new Date(`${tradeDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== tradeDate) return false;
  if (!ticker.endsWith('-USD') && (date.getUTCDay() === 0 || date.getUTCDay() === 6 || nyseHoliday(tradeDate))) return false;
  return tradeDate <= completedPriceDateCutoff(ticker, now);
}

export function latestCompletedPriceDate(ticker: CompletedPriceTicker, now = new Date()) {
  let candidate = completedPriceDateCutoff(ticker, now);
  while (!isCompletedPriceDate(ticker, candidate, now)) candidate = previousCalendarDate(candidate);
  return candidate;
}

/** Preserve Yahoo's quoted OHLC and separate adjusted close; never synthesize a bar. */
export function parseCompletedYahooPrices(ticker: CompletedPriceTicker, payload: YahooChartPayload, now = new Date()): CompletedPriceRow[] {
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const adjusted = result?.indicators?.adjclose?.[0]?.adjclose;
  const zone = ticker.endsWith('-USD') ? 'UTC' : 'America/New_York';
  if (!quote || result?.meta?.symbol !== ticker || result.meta.exchangeTimezoneName !== zone) {
    throw new Error(payload.chart?.error?.description || `Invalid Yahoo daily source for ${ticker}.`);
  }
  const rows = (result.timestamp ?? []).flatMap((timestamp, index) => {
    if (!Number.isFinite(timestamp)) return [];
    const trade_date = isoDate(new Date(timestamp * 1000), zone);
    if (!isCompletedPriceDate(ticker, trade_date, now)) return [];
    const values = [quote.open?.[index], quote.high?.[index], quote.low?.[index], quote.close?.[index], adjusted?.[index]];
    if (!values.every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) return [];
    const [open, high, low, close, adjusted_close] = values.map((value) => Number(value!.toFixed(4)));
    const volume = quote.volume?.[index];
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low || !Number.isSafeInteger(volume) || volume! < 0) return [];
    return [{ ticker, trade_date, open, high, low, close, adjusted_close, volume: volume!, source: 'yahoo-chart-api' as const }];
  }).sort((left, right) => left.trade_date.localeCompare(right.trade_date));
  const unique = new Map<string, CompletedPriceRow>();
  for (const row of rows) {
    const previous = unique.get(row.trade_date);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error(`Conflicting daily source rows for ${ticker}.`);
    unique.set(row.trade_date, row);
  }
  return [...unique.values()];
}

export async function fetchCompletedYahooPrices(ticker: CompletedPriceTicker, now = new Date(), options: { deadlineAt?: number } = {}) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`);
  url.searchParams.set('interval', '1d');
  url.searchParams.set('includeAdjustedClose', 'true');
  url.searchParams.set('includePrePost', 'false');
  url.searchParams.set('period1', String(Math.floor((now.getTime() - 10 * 86_400_000) / 1000)));
  url.searchParams.set('period2', String(Math.floor(now.getTime() / 1000)));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const remaining = options.deadlineAt ? options.deadlineAt - Date.now() : 20_000;
      if (remaining <= 0) throw new Error('Completed-price sync time budget exceeded.');
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' },
        cache: 'no-store', signal: AbortSignal.timeout(Math.max(1, Math.min(20_000, remaining))),
      });
      if (!response.ok) throw new Error(`Yahoo completed-price request failed for ${ticker}: ${response.status}.`);
      const minimumDate = new Date(now.getTime() - 10 * 86_400_000).toISOString().slice(0, 10);
      return parseCompletedYahooPrices(ticker, await response.json(), now).filter(row => row.trade_date >= minimumDate);
    } catch (error) {
      const delay = 1_500 * 2 ** attempt;
      if (attempt === 2 || (options.deadlineAt && options.deadlineAt - Date.now() <= delay)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return [];
}
