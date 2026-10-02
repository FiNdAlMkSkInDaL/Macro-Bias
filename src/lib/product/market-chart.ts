export type MarketChartScore = { tradeDate: string; score: number; biasLabel: string };
export type MarketChartCandle = { tradeDate: string; open: number; high: number; low: number; close: number };
export type MarketChartSession = { tradeDate: string; candle: MarketChartCandle | null; mark: MarketChartScore | null };
export type MarketChartSeries = { sessions: MarketChartSession[]; latestMark: MarketChartScore | null; anchorDate: string | null };

const TRADE_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validTradeDate(value: string) {
  if (!TRADE_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validScore(mark: MarketChartScore) {
  return validTradeDate(mark.tradeDate) && Number.isFinite(mark.score) && Math.abs(mark.score) <= 100
    && typeof mark.biasLabel === 'string' && mark.biasLabel.trim().length > 0;
}

function validCandle(candle: MarketChartCandle) {
  return validTradeDate(candle.tradeDate)
    && [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0)
    && candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close);
}

/** Calendar subtraction, clamped to the target month's final day in UTC. */
export function marketHistoryStart(tradeDate: string): string | null {
  if (!validTradeDate(tradeDate)) return null;
  const end = new Date(`${tradeDate}T00:00:00Z`);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 3, 1));
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(end.getUTCDate(), lastDay));
  return start.toISOString().slice(0, 10);
}

/** Exact-date join; missing values remain null. Entitlement filtering stays on server. */
export function buildMarketChartSeries(candles: readonly MarketChartCandle[], marks: readonly MarketChartScore[], latest: MarketChartScore | null): MarketChartSeries {
  const candleMap = new Map(candles.filter(validCandle).map((candle) => [candle.tradeDate, candle]));
  const scoreMap = new Map(marks.filter(validScore).map((mark) => [mark.tradeDate, mark]));
  if (latest && validScore(latest)) scoreMap.set(latest.tradeDate, latest);
  const dates = Array.from(new Set([...candleMap.keys(), ...scoreMap.keys()])).sort();
  const latestScoreDate = Array.from(scoreMap.keys()).sort().at(-1);
  const latestMark = latestScoreDate ? scoreMap.get(latestScoreDate) ?? null : null;
  return {
    sessions: dates.map((tradeDate) => ({ tradeDate, candle: candleMap.get(tradeDate) ?? null, mark: scoreMap.get(tradeDate) ?? null })),
    latestMark,
    anchorDate: dates.at(-1) ?? null,
  };
}

export function windowMarketChartSeries(series: MarketChartSeries) {
  const windowStart = series.anchorDate ? marketHistoryStart(series.anchorDate) : null;
  const windowEnd = series.anchorDate;
  const sessions = windowStart && windowEnd
    ? series.sessions.filter((session) => session.tradeDate >= windowStart && session.tradeDate <= windowEnd)
    : [];
  const candles = sessions.flatMap((session) => session.candle ? [session.candle] : []);
  const marks = sessions.flatMap((session) => session.mark ? [session.mark] : []);
  return { sessions, candles, marks, windowStart, windowEnd, firstDate: sessions[0]?.tradeDate ?? null, lastDate: sessions.at(-1)?.tradeDate ?? null, latestCandle: candles.at(-1) ?? null, latestMark: marks.at(-1) ?? null };
}

export function marketChartPriceBounds(candles: readonly MarketChartCandle[]) {
  if (!candles.length) return { minPrice: 0, maxPrice: 1, priceSpan: 1 };
  let low = Infinity;
  let high = -Infinity;
  for (const candle of candles) { low = Math.min(low, candle.low); high = Math.max(high, candle.high); }
  const rawSpan = high - low;
  const padding = rawSpan > 0 ? rawSpan * 0.12 : Math.max(Math.abs(high) * 0.005, 1);
  const minPrice = low - padding;
  const maxPrice = high + padding;
  return { minPrice, maxPrice, priceSpan: maxPrice - minPrice };
}
