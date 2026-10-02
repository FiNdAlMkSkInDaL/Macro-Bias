import 'server-only';

import { createSupabaseAdminClient } from '../supabase/admin';
import { completedPriceDateCutoff, isCompletedPriceDate, latestCompletedPriceDate } from '../market-data/completed-price-bars';
import { getViewerScore, type ProductAsset, type ProductScore, type ViewerScore } from './score-access';

export type PublicDailyHistoryScore = {
  tradeDate: string;
  score: number;
  biasLabel: string;
};

export type PublicDailyCandle = {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type AvailabilityStatus = 'available' | 'empty' | 'unavailable';

export type PublicDailyData = {
  asset: ProductAsset;
  ticker: 'SPY' | 'BTC-USD';
  score: ViewerScore | null;
  missingSessionDate: string | null;
  loadError: string | null;
  history: PublicDailyHistoryScore[];
  candles: PublicDailyCandle[];
  historyNotice: string | null;
  priceNotice: string | null;
  availability: {
    windowStart: string | null;
    windowEnd: string | null;
    scoreStatus: AvailabilityStatus;
    priceStatus: AvailabilityStatus;
    scoreCount: number;
    candleCount: number;
    firstScoreDate: string | null;
    lastScoreDate: string | null;
    firstCandleDate: string | null;
    lastCandleDate: string | null;
  };
};

const HISTORY_LIMIT = 120;
const BIAS_LABELS = new Set(['EXTREME_RISK_OFF', 'RISK_OFF', 'NEUTRAL', 'RISK_ON', 'EXTREME_RISK_ON']);
const SCORE_LOAD_ERROR = 'The daily score is temporarily unavailable. Please try again.';
const HISTORY_LOAD_ERROR = 'Score history is temporarily unavailable. Please try again.';

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function finiteNumber(value: unknown) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function threeMonthsBefore(tradeDate: string) {
  const end = new Date(`${tradeDate}T00:00:00Z`);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 3, 1));
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(end.getUTCDate(), lastDay));
  return start.toISOString().slice(0, 10);
}

function scoreFromRow(row: Record<string, unknown>, start: string, end: string): PublicDailyHistoryScore | null {
  const score = finiteNumber(row.score);
  if (
    !validDate(row.trade_date) || row.trade_date < start || row.trade_date > end ||
    score == null || score < -100 || score > 100 ||
    typeof row.bias_label !== 'string' || !BIAS_LABELS.has(row.bias_label)
  ) return null;

  return { tradeDate: row.trade_date, score, biasLabel: row.bias_label };
}

function candleFromRow(row: Record<string, unknown>, start: string, end: string): PublicDailyCandle | null {
  const open = finiteNumber(row.open);
  const high = finiteNumber(row.high);
  const low = finiteNumber(row.low);
  const close = finiteNumber(row.close);
  if (
    !validDate(row.trade_date) || row.trade_date < start || row.trade_date > end ||
    open == null || high == null || low == null || close == null ||
    open <= 0 || high <= 0 || low <= 0 || close <= 0 ||
    high < low || high < Math.max(open, close) || low > Math.min(open, close)
  ) return null;

  return { tradeDate: row.trade_date, open, high, low, close };
}

function emptyData(asset: ProductAsset): PublicDailyData {
  return {
    asset,
    ticker: asset === 'stocks' ? 'SPY' : 'BTC-USD',
    score: null,
    missingSessionDate: null,
    loadError: null,
    history: [],
    candles: [],
    historyNotice: null,
    priceNotice: null,
    availability: {
      windowStart: null, windowEnd: null,
      scoreStatus: 'empty', priceStatus: 'empty',
      scoreCount: 0, candleCount: 0,
      firstScoreDate: null, lastScoreDate: null, firstCandleDate: null, lastCandleDate: null,
    },
  };
}

/**
 * Scores stop at the selected publication; completed quotes can advance on their
 * independent schedule. Exact-date joins never substitute a newer score.
 * Paid signal and briefing fields come exclusively
 * from getViewerScore's existing subscription checks.
 * Routes that already checked access can reuse that ProductScore result.
 */
export async function loadPublicDailyData(asset: ProductAsset, preloadedScore?: ProductScore): Promise<PublicDailyData> {
  const result = emptyData(asset);
  let viewer;
  try {
    viewer = preloadedScore ?? await getViewerScore(asset, undefined, 'latest-publication');
  } catch {
    result.loadError = SCORE_LOAD_ERROR;
    result.availability.scoreStatus = 'unavailable';
  }

  result.missingSessionDate = validDate(viewer?.missingSessionDate) ? viewer.missingSessionDate : null;
  if (viewer?.loadError) {
    result.loadError = SCORE_LOAD_ERROR;
    result.availability.scoreStatus = 'unavailable';
  }

  let score = viewer?.loadError ? null : viewer?.score ?? null;
  if (score && (score.asset !== asset || !validDate(score.tradeDate) || !Number.isFinite(score.score) || Math.abs(score.score) > 100 || !BIAS_LABELS.has(score.label))) {
    result.loadError = SCORE_LOAD_ERROR;
    result.availability.scoreStatus = 'unavailable';
    score = null;
  }

  result.score = score ? score.paid ? score : { ...score, permission: null, grade: null, sizePct: null, sentence: null } : null;
  const now = new Date();
  const scoreEnd = score?.tradeDate ?? null;
  const priceEnd = completedPriceDateCutoff(result.ticker, now);
  const end = scoreEnd && scoreEnd > priceEnd ? scoreEnd : priceEnd;
  // Fetch enough data for either end, then use the latest actually stored date.
  const start = threeMonthsBefore(scoreEnd && scoreEnd < priceEnd ? scoreEnd : priceEnd);
  result.availability.windowStart = start;
  result.availability.windowEnd = end;

  try {
    const supabase = createSupabaseAdminClient();
    const scoreTable = asset === 'stocks' ? 'macro_bias_scores' : 'crypto_bias_scores';
    const [history, prices] = await Promise.allSettled([
      scoreEnd ? supabase.from(scoreTable)
        .select('trade_date, score, bias_label')
        .gte('trade_date', start).lte('trade_date', scoreEnd)
        .order('trade_date', { ascending: true }).limit(HISTORY_LIMIT) : Promise.resolve({ data: [], error: null }),
      supabase.from('etf_daily_prices')
        .select('trade_date, open, high, low, close').eq('ticker', result.ticker)
        .gte('trade_date', start).lte('trade_date', priceEnd)
        .order('trade_date', { ascending: false }).limit(HISTORY_LIMIT),
    ]);

    if (history.status === 'rejected' || history.value.error) {
      result.historyNotice = HISTORY_LOAD_ERROR;
      result.availability.scoreStatus = 'unavailable';
    } else {
      result.history = (history.value.data ?? [])
        .map((row: Record<string, unknown>) => scoreFromRow(row, start, end))
        .filter((row): row is PublicDailyHistoryScore => row != null);
      if (scoreEnd) {
        result.availability.scoreStatus = result.history.length ? 'available' : 'empty';
        if (!result.history.length) result.historyNotice = 'Score history is not available for this date range yet.';
      }
    }

    if (prices.status === 'rejected' || prices.value.error) {
      result.priceNotice = 'Price history is temporarily unavailable. Please try again.';
      result.availability.priceStatus = 'unavailable';
    } else {
      result.candles = (prices.value.data ?? [])
        .map((row: Record<string, unknown>) => candleFromRow(row, start, priceEnd))
        .filter((row): row is PublicDailyCandle => row != null && isCompletedPriceDate(result.ticker, row.tradeDate, now))
        .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
      result.availability.priceStatus = result.candles.length ? 'available' : 'empty';
      if (!result.candles.length) result.priceNotice = 'Price history is not available for this date range yet.';
    }
  } catch {
    result.historyNotice = HISTORY_LOAD_ERROR;
    result.priceNotice = 'Price history is temporarily unavailable. Please try again.';
    if (scoreEnd) result.availability.scoreStatus = 'unavailable';
    result.availability.priceStatus = 'unavailable';
  }

  const lastPrice = result.candles.at(-1)?.tradeDate;
  const actualEnd = lastPrice && (!scoreEnd || lastPrice > scoreEnd) ? lastPrice : scoreEnd;
  const actualStart = actualEnd ? threeMonthsBefore(actualEnd) : null;
  result.history = result.history.filter((row) => actualStart && row.tradeDate >= actualStart);
  result.candles = result.candles.filter((row) => actualStart && row.tradeDate >= actualStart);
  result.availability.windowStart = actualStart;
  result.availability.windowEnd = actualEnd;
  result.availability.scoreCount = result.history.length;
  result.availability.candleCount = result.candles.length;
  result.availability.firstScoreDate = result.history[0]?.tradeDate ?? null;
  result.availability.lastScoreDate = result.history.at(-1)?.tradeDate ?? null;
  result.availability.firstCandleDate = result.candles[0]?.tradeDate ?? null;
  result.availability.lastCandleDate = result.candles.at(-1)?.tradeDate ?? null;
  const expectedPriceDate = latestCompletedPriceDate(result.ticker, now);
  if (!result.priceNotice && result.availability.lastCandleDate && result.availability.lastCandleDate < expectedPriceDate) {
    const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${expectedPriceDate}T00:00:00Z`));
    result.priceNotice = `Completed ${asset === 'stocks' ? 'SPY' : 'BTC'} close pending for ${date}.`;
  }
  return result;
}
