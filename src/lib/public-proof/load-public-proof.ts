import 'server-only';

import { createSupabaseAdminClient } from '../supabase/admin';
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

export type Loaded<T> = {
  value: T | null;
  error: string | null;
};

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

export async function loadStoredStockScores(): Promise<Loaded<StoredStockScore[]>> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('macro_bias_scores')
      .select('trade_date, score, bias_label')
      .order('trade_date', { ascending: false })
      .limit(SCORE_LIMIT);

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
