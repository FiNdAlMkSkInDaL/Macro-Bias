import "server-only";

import { cache } from "react";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  evaluatePublishedScores,
  type LiveScoreEvaluation,
  type PublishedScoreForEval,
  type SessionReturnForEval,
} from "@/lib/signal/live-score-evaluation";
import { extractTradableSignal } from "@/lib/signal/format-tradable-signal";
import { STOCKS_STRATEGY_RULES } from "@/lib/signal";

type ScoreRow = {
  trade_date: string;
  score: number;
  engine_inputs: Record<string, unknown> | null;
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
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data } = await sb
      .from("macro_bias_scores")
      .select("trade_date, score, engine_inputs")
      .order("trade_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as ScoreRow[]));
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
    const { data } = await sb
      .from("etf_daily_prices")
      .select("trade_date, open, close")
      .eq("ticker", "SPY")
      .order("trade_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as PriceRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/**
 * Live accuracy of published stocks scores vs next SPY *session*
 * measured open→close (tradable morning-permission horizon).
 */
export const getStocksPublishedLiveEval = cache(async (): Promise<LiveScoreEvaluation> => {
  const sb = createSupabaseAdminClient();
  const [scores, spyPrices] = await Promise.all([
    fetchAllPublishedScores(sb),
    fetchAllSpyOhlc(sb),
  ]);

  const published: PublishedScoreForEval[] = scores.map((row) => ({
    tradeDate: row.trade_date,
    score: row.score,
    signal: extractTradableSignal(row.engine_inputs),
  }));

  // Session return = open→close on that session (what a morning permission captures).
  const sessions: SessionReturnForEval[] = spyPrices
    .filter((row) => row.open > 0)
    .map((row) => ({
      tradeDate: row.trade_date,
      changePercent: ((row.close - row.open) / row.open) * 100,
    }));

  return evaluatePublishedScores(published, sessions, STOCKS_STRATEGY_RULES);
});
