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
import { CRYPTO_STRATEGY_RULES } from "@/lib/signal";

type ScoreRow = {
  trade_date: string;
  score: number;
  engine_inputs: Record<string, unknown> | null;
  ticker_changes: Record<string, { percentChange?: number }> | null;
};

type PriceRow = {
  trade_date: string;
  close: number;
};

/**
 * Live accuracy of published crypto scores vs next BTC session (long-only).
 */
export const getCryptoPublishedLiveEval = cache(async (): Promise<LiveScoreEvaluation> => {
  const sb = createSupabaseAdminClient();

  const scores: ScoreRow[] = [];
  const prices: PriceRow[] = [];
  const pageSize = 1000;

  let from = 0;
  while (true) {
    const { data } = await sb
      .from("crypto_bias_scores")
      .select("trade_date, score, engine_inputs, ticker_changes")
      .order("trade_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    scores.push(...(data as ScoreRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  from = 0;
  while (true) {
    const { data } = await sb
      .from("etf_daily_prices")
      .select("trade_date, close")
      .eq("ticker", "BTC-USD")
      .order("trade_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    prices.push(...(data as PriceRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const published: PublishedScoreForEval[] = scores.map((row) => ({
    tradeDate: row.trade_date,
    score: row.score,
    signal: extractTradableSignal(row.engine_inputs),
  }));

  const tickerPct = new Map(
    scores.map((s) => [
      s.trade_date,
      s.ticker_changes?.["BTC-USD"]?.percentChange ?? s.ticker_changes?.BTC?.percentChange,
    ]),
  );

  const sessions: SessionReturnForEval[] = [];
  for (let i = 1; i < prices.length; i++) {
    const row = prices[i];
    const prev = prices[i - 1];
    const fromTicker = tickerPct.get(row.trade_date);
    const changePercent =
      typeof fromTicker === "number"
        ? fromTicker
        : prev.close > 0
          ? ((row.close - prev.close) / prev.close) * 100
          : 0;
    sessions.push({ tradeDate: row.trade_date, changePercent });
  }

  return evaluatePublishedScores(published, sessions, CRYPTO_STRATEGY_RULES, "long_only");
});
