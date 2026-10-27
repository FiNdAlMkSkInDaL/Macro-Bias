import "server-only";

import { cache } from "react";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  evaluatePublishedScores,
  type LiveScoreEvaluation,
  type PublishedScoreForEval,
  type SessionReturnForEval,
} from "@/lib/signal/live-score-evaluation";
import { cryptoLiveSession, latestPublicationTime } from "@/lib/signal/publication-timing";
import type { TradableSignal } from "@/lib/signal/types";
import { CRYPTO_STRATEGY_RULES } from "@/lib/signal";

type ScoreRow = {
  trade_date: string;
  score: number;
  signal: TradableSignal | null;
  created_at: string;
  updated_at: string | null;
  ticker_changes: Record<string, { percentChange?: number }> | null;
};

type PriceRow = {
  trade_date: string;
  close: number;
};

/**
 * Live accuracy of published crypto scores vs the first complete UTC BTC session starting after publication (long-only).
 */
export const getCryptoPublishedLiveEval = cache(async (): Promise<LiveScoreEvaluation> => {
  const sb = createSupabaseAdminClient({ timeoutMs: 15000 });

  const scores: ScoreRow[] = [];
  const prices: PriceRow[] = [];
  const pageSize = 50;

  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("crypto_bias_scores")
      .select("trade_date, score, created_at, updated_at, signal:engine_inputs->tradableSignal, ticker_changes")
      .order("trade_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error("Published crypto evaluation is unavailable");
    if (!data || data.length === 0) break;
    scores.push(...(data as ScoreRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  from = 0;
  while (true) {
    const { data, error } = await sb
      .from("etf_daily_prices")
      .select("trade_date, close")
      .eq("ticker", "BTC-USD")
      .order("trade_date", { ascending: true })
      .range(from, from + 1000 - 1);
    if (error) throw new Error("Published crypto evaluation is unavailable");
    if (!data || data.length === 0) break;
    prices.push(...(data as PriceRow[]));
    if (data.length < 1000) break;
    from += 1000;
  }

  const published: PublishedScoreForEval[] = scores.flatMap(row => {
    const targetSessionDate = cryptoLiveSession(row.trade_date, latestPublicationTime(row.created_at, row.updated_at));
    return targetSessionDate ? [{tradeDate: row.trade_date, targetSessionDate, score: row.score, signal: row.signal}] : [];
  });

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
