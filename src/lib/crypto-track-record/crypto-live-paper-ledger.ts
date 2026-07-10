import "server-only";

import { cache } from "react";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildPaperLedger,
  cryptoPaperLedgerOptions,
  type PaperLedgerSummary,
  type PublishedScoreDay,
  type AssetSessionDay,
} from "@/lib/signal/paper-ledger";
import type { TradableSignal } from "@/lib/signal";

type ScoreRow = {
  trade_date: string;
  score: number;
  bias_label: string;
  model_version: string | null;
  engine_inputs: Record<string, unknown> | null;
  ticker_changes: Record<
    string,
    { close?: number; previousClose?: number; percentChange?: number }
  > | null;
};

type PriceRow = {
  trade_date: string;
  close: number;
};

function isTradableSignal(value: unknown): value is TradableSignal {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.position === "string" &&
    typeof v.size === "number" &&
    typeof v.reliability === "string" &&
    typeof v.noTrade === "boolean"
  );
}

function extractSignal(engineInputs: Record<string, unknown> | null): TradableSignal | null {
  if (!engineInputs) return null;
  const raw = engineInputs.tradableSignal;
  return isTradableSignal(raw) ? raw : null;
}

async function fetchAllBtcPrices(
  sb: ReturnType<typeof createSupabaseAdminClient>,
): Promise<PriceRow[]> {
  const all: PriceRow[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data } = await sb
      .from("etf_daily_prices")
      .select("trade_date, close")
      .eq("ticker", "BTC-USD")
      .order("trade_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as PriceRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function fetchAllPublishedCryptoScores(
  sb: ReturnType<typeof createSupabaseAdminClient>,
): Promise<ScoreRow[]> {
  const all: ScoreRow[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data } = await sb
      .from("crypto_bias_scores")
      .select("trade_date, score, bias_label, model_version, engine_inputs, ticker_changes")
      .order("trade_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as ScoreRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/**
 * Live paper ledger for crypto (long-only by default): only published
 * crypto_bias_scores rows, not a full historical re-sim.
 */
export const getCryptoLivePaperLedger = cache(
  async (mode: "long_only" | "long_short" = "long_only"): Promise<PaperLedgerSummary> => {
    const sb = createSupabaseAdminClient();
    const [scores, btcPrices] = await Promise.all([
      fetchAllPublishedCryptoScores(sb),
      fetchAllBtcPrices(sb),
    ]);

    if (scores.length === 0 || btcPrices.length < 2) {
      return buildPaperLedger([], [], cryptoPaperLedgerOptions(mode));
    }

    const published: PublishedScoreDay[] = scores.map((row) => ({
      tradeDate: row.trade_date,
      score: row.score,
      signal: extractSignal(row.engine_inputs),
      modelVersion: row.model_version,
    }));

    const tickerChangeByDate = new Map(
      scores.map((s) => [
        s.trade_date,
        s.ticker_changes?.["BTC-USD"]?.percentChange ??
          s.ticker_changes?.BTC?.percentChange,
      ]),
    );
    const assetSessions: AssetSessionDay[] = [];
    for (let i = 1; i < btcPrices.length; i++) {
      const row = btcPrices[i];
      const prev = btcPrices[i - 1];
      const fromTicker = tickerChangeByDate.get(row.trade_date);

      const changePercent =
        typeof fromTicker === "number"
          ? fromTicker
          : prev.close > 0
            ? ((row.close - prev.close) / prev.close) * 100
            : 0;

      assetSessions.push({
        tradeDate: row.trade_date,
        changePercent,
        close: row.close,
      });
    }

    return buildPaperLedger(published, assetSessions, cryptoPaperLedgerOptions(mode));
  },
);
