import 'server-only';

import { getLatestBiasSnapshot } from '../market-data/get-latest-bias-snapshot';
import type { BiasLabel } from '../macro-bias/types';
import { createSupabaseAdminClient } from '../supabase/admin';
import { CORE_ASSET_TICKERS, type AssetTicker } from '../../types';
import { asFiniteNumber, extractBottomLine, extractDayType } from './format';

export type StoredStockScore = {
  tradeDate: string;
  score: number;
  biasLabel: string;
};

export type PaperSnapshot = {
  pricingTradeDate: string;
  equity: number;
  totalReturnPct: number;
  sessionsTracked: number;
  cashWeight: number;
  spyMarkReturnPct: number | null;
  spyFromDate: string | null;
  spyToDate: string | null;
};

export type BriefingCall = {
  briefingDate: string;
  tradeDate: string;
  dayType: string;
  bottomLine: string;
};

export type RegimeAsset = {
  ticker: AssetTicker;
  dailyChangePercent: number;
};

export type LatestRegimeRead = {
  tradeDate: string;
  score: number;
  biasLabel: BiasLabel;
  assets: RegimeAsset[];
};

export type Loaded<T> = {
  value: T | null;
  error: string | null;
};

const BIAS_LABELS = new Set<BiasLabel>([
  'EXTREME_RISK_OFF',
  'RISK_OFF',
  'NEUTRAL',
  'RISK_ON',
  'EXTREME_RISK_ON',
]);

function isBiasLabel(value: unknown): value is BiasLabel {
  return typeof value === 'string' && BIAS_LABELS.has(value as BiasLabel);
}

function readCoreAssets(tickerChanges: unknown): RegimeAsset[] {
  if (!tickerChanges || typeof tickerChanges !== 'object') {
    return [];
  }

  const changes = tickerChanges as Record<string, unknown>;

  return CORE_ASSET_TICKERS.flatMap((ticker) => {
    const change = changes[ticker];

    if (!change || typeof change !== 'object') {
      return [];
    }

    const dailyChangePercent = asFiniteNumber((change as { percentChange?: unknown }).percentChange);

    if (dailyChangePercent == null) {
      return [];
    }

    return [{ ticker, dailyChangePercent }];
  });
}

function thrownMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return '';
}

const SCORE_LIMIT = 80;

function loadError(scope: string, message: string) {
  const detail = /<!DOCTYPE|522|timed out|PGRST002|schema cache/i.test(message)
    ? 'the database timed out'
    : message.slice(0, 300) || 'the database timed out';

  return `Failed to load ${scope}: ${detail}`;
}

function scoreRow(row: { trade_date?: unknown; score?: unknown; bias_label?: unknown }): StoredStockScore | null {
  if (typeof row.trade_date !== 'string' || typeof row.bias_label !== 'string') {
    return null;
  }

  const score = asFiniteNumber(row.score);

  if (score == null) {
    return null;
  }

  return {
    tradeDate: row.trade_date,
    score,
    biasLabel: row.bias_label,
  };
}

export async function loadStoredStockScores(limit = SCORE_LIMIT): Promise<Loaded<StoredStockScore[]>> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('macro_bias_scores')
      .select('trade_date, score, bias_label')
      .order('trade_date', { ascending: false })
      .limit(limit);

    if (error) {
      return { value: null, error: loadError('macro_bias_scores', error.message) };
    }

    const scores = ((data as Array<{ trade_date?: unknown; score?: unknown; bias_label?: unknown }> | null) ?? [])
      .map(scoreRow)
      .filter((row): row is StoredStockScore => row != null);

    return { value: scores, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return { value: null, error: loadError('macro_bias_scores', message) };
  }
}

export type StoredCandle = {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

function candleRow(row: {
  trade_date?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
}): StoredCandle | null {
  if (typeof row.trade_date !== 'string') {
    return null;
  }

  const open = asFiniteNumber(row.open);
  const high = asFiniteNumber(row.high);
  const low = asFiniteNumber(row.low);
  const close = asFiniteNumber(row.close);

  if (open == null || high == null || low == null || close == null) {
    return null;
  }

  if (high < low || high < Math.max(open, close) || low > Math.min(open, close)) {
    return null;
  }

  return { tradeDate: row.trade_date, open, high, low, close };
}

/** Latest stored SPY daily bars. Empty when that equity series has no usable OHLC. */
export async function loadStoredSpyCandles(limit = 120): Promise<Loaded<StoredCandle[]>> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('etf_daily_prices')
      .select('trade_date, open, high, low, close')
      .eq('ticker', 'SPY')
      .order('trade_date', { ascending: false })
      .limit(limit);

    if (error) {
      return { value: null, error: loadError('etf_daily_prices', error.message) };
    }

    const candles = ((data as Array<{
      trade_date?: unknown;
      open?: unknown;
      high?: unknown;
      low?: unknown;
      close?: unknown;
    }> | null) ?? [])
      .map(candleRow)
      .filter((row): row is StoredCandle => row != null)
      .reverse();

    return { value: candles, error: null };
  } catch (error) {
    return { value: null, error: loadError('etf_daily_prices', thrownMessage(error)) };
  }
}

export async function loadLatestRegimeRead(): Promise<Loaded<LatestRegimeRead>> {
  try {
    const snapshot = await getLatestBiasSnapshot();

    if (!snapshot) {
      return { value: null, error: null };
    }

    const score = asFiniteNumber(snapshot.score);

    if (score == null || typeof snapshot.trade_date !== 'string' || !isBiasLabel(snapshot.bias_label)) {
      return { value: null, error: loadError('macro_bias_scores', 'latest score was incomplete') };
    }

    return {
      value: {
        tradeDate: snapshot.trade_date,
        score,
        biasLabel: snapshot.bias_label,
        assets: readCoreAssets(snapshot.ticker_changes),
      },
      error: null,
    };
  } catch (error) {
    return { value: null, error: loadError('macro_bias_scores', thrownMessage(error)) };
  }
}

export async function loadPaperSnapshot(): Promise<Loaded<PaperSnapshot>> {
  try {
    const supabase = createSupabaseAdminClient();
    const [latestResult, earliestResult, countResult] = await Promise.all([
      supabase
        .from('paper_trading_portfolio_snapshots')
        .select('pricing_trade_date, total_equity, total_return_pct, cash_weight, mark_price')
        .eq('asset', 'SPY')
        .order('pricing_trade_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('paper_trading_portfolio_snapshots')
        .select('pricing_trade_date, mark_price')
        .eq('asset', 'SPY')
        .order('pricing_trade_date', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('paper_trading_portfolio_snapshots')
        .select('id', { count: 'exact', head: true })
        .eq('asset', 'SPY'),
    ]);

    const failed = latestResult.error ?? earliestResult.error ?? countResult.error;

    if (failed) {
      return { value: null, error: loadError('paper_trading_portfolio_snapshots', failed.message) };
    }

    if (!latestResult.data || countResult.count == null) {
      return { value: null, error: null };
    }

    const equity = asFiniteNumber(latestResult.data.total_equity);
    const totalReturnPct = asFiniteNumber(latestResult.data.total_return_pct);
    const cashWeight = asFiniteNumber(latestResult.data.cash_weight);
    const latestMark = asFiniteNumber(latestResult.data.mark_price);
    const earliestMark = asFiniteNumber(earliestResult.data?.mark_price);
    const pricingTradeDate = latestResult.data.pricing_trade_date;
    const earliestDate = earliestResult.data?.pricing_trade_date;

    if (
      equity == null ||
      totalReturnPct == null ||
      cashWeight == null ||
      typeof pricingTradeDate !== 'string'
    ) {
      return { value: null, error: loadError('paper_trading_portfolio_snapshots', 'latest snapshot was incomplete') };
    }

    const spyMarkReturnPct =
      latestMark != null && earliestMark != null && earliestMark > 0
        ? ((latestMark / earliestMark) - 1) * 100
        : null;

    return {
      value: {
        pricingTradeDate,
        equity,
        totalReturnPct,
        sessionsTracked: countResult.count,
        cashWeight,
        spyMarkReturnPct,
        spyFromDate: typeof earliestDate === 'string' ? earliestDate : null,
        spyToDate: pricingTradeDate,
      },
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return { value: null, error: loadError('paper_trading_portfolio_snapshots', message) };
  }
}

export async function loadBriefingCallForTradeDate(tradeDate: string): Promise<Loaded<BriefingCall>> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('daily_market_briefings')
      .select('briefing_date, trade_date, bias_label, brief_content')
      .eq('trade_date', tradeDate)
      .order('briefing_date', { ascending: false })
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return { value: null, error: loadError('daily_market_briefings', error.message) };
    }

    if (!data || data.trade_date !== tradeDate) {
      return { value: null, error: null };
    }

    const content = typeof data.brief_content === 'string' ? data.brief_content : '';
    const bottomLine = extractBottomLine(content);

    if (
      typeof data.briefing_date !== 'string' ||
      typeof data.trade_date !== 'string' ||
      typeof data.bias_label !== 'string' ||
      !bottomLine
    ) {
      return { value: null, error: null };
    }

    return {
      value: {
        briefingDate: data.briefing_date,
        tradeDate: data.trade_date,
        dayType: extractDayType(content, data.bias_label),
        bottomLine,
      },
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return { value: null, error: loadError('daily_market_briefings', message) };
  }
}
