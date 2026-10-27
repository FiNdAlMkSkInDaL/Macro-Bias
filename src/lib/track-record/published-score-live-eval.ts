import "server-only";

import { cache } from "react";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  evaluatePublishedScores,
  type LiveScoreEvaluation,
  type PublishedScoreForEval,
  type SessionReturnForEval,
} from "@/lib/signal/live-score-evaluation";
import { latestPublicationTime, stockLiveSession } from "@/lib/signal/publication-timing";
import type { TradableSignal } from "@/lib/signal/types";
import { STOCKS_STRATEGY_RULES } from "@/lib/signal";

type ScoreRow = {
  trade_date: string;
  score: number;
  signal: TradableSignal | null;
  source_date: string | null;
  created_at: string;
  updated_at: string | null;
};

type PriceRow = {
  trade_date: string;
  open: number;
  close: number;
};

async function fetchAllPublishedScores(
  sb: ReturnType<typeof createSupabaseAdminClient>,
): Promise<ScoreRow[]> {
  const all: ScoreRow[] = [];
  const pageSize = 50;
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("macro_bias_scores")
      .select("trade_date, score, created_at, updated_at, signal:engine_inputs->tradableSignal, source_date:engine_inputs->tradeWindow->>latestTradeDate")
      .order("trade_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error("Published live evaluation is unavailable");
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as ScoreRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function fetchAllSpyOhlc(
  sb: ReturnType<typeof createSupabaseAdminClient>,
): Promise<PriceRow[]> {
  const all: PriceRow[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("etf_daily_prices")
      .select("trade_date, open, close")
      .eq("ticker", "SPY")
      .order("trade_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error("Published live evaluation is unavailable");
    if (!data || data.length === 0) break;
    all.push(...(data as PriceRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/**
 * Live accuracy of published stocks scores vs the same before-open target SPY session
 * measured open→close (tradable morning-permission horizon).
 */
export const getStocksPublishedLiveEval = cache(async (): Promise<LiveScoreEvaluation> => {
  const sb = createSupabaseAdminClient({ timeoutMs: 15000 });
  const [scores, spyPrices] = await Promise.all([
    fetchAllPublishedScores(sb),
    fetchAllSpyOhlc(sb),
  ]);

  const published: PublishedScoreForEval[] = scores.flatMap(row => {
    const targetSessionDate = stockLiveSession(row.trade_date, row.source_date, latestPublicationTime(row.created_at, row.updated_at));
    return targetSessionDate ? [{tradeDate: row.trade_date, targetSessionDate, score: row.score, signal: row.signal}] : [];
  });

  // Session return = open→close on that session (what a morning permission captures).
  const sessions: SessionReturnForEval[] = spyPrices
    .filter((row) => row.open > 0)
    .map((row) => ({
      tradeDate: row.trade_date,
      changePercent: ((row.close - row.open) / row.open) * 100,
    }));

  return evaluatePublishedScores(published, sessions, STOCKS_STRATEGY_RULES);
});
