import "server-only";

import { cache } from "react";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { briefingAccess, canReadBriefing } from "@/lib/product/briefing-access";
import { getBriefingMetadata, getBriefingViewer, loadPaidBriefingArchive } from "@/lib/product/paid-briefing-data";

export type PublicBriefingRow = {
  id: string;
  briefing_date: string;
  trade_date: string;
  quant_score: number;
  bias_label: string;
  is_override_active: boolean;
  brief_content: string;
  news_headlines: string[];
  news_summary: string;
  generated_at: string;
};

export type BriefingListItem = {
  briefing_date: string;
  quant_score: number;
  bias_label: string;
  is_override_active: boolean;
};

const BRIEFING_COLUMNS =
  "id, briefing_date, trade_date, quant_score, bias_label, is_override_active, brief_content, news_headlines, news_summary, generated_at";

type StoredStockScore = {
  trade_date: string;
  score: number;
  bias_label: string;
};

function signedScore(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}

function citeStoredScore(content: string, fromLabel: string, fromScore: number, toLabel: string, toScore: number) {
  const from = `${fromLabel} (${signedScore(fromScore)})`;
  const to = `${toLabel} (${signedScore(toScore)})`;
  if (from === to) {
    return content;
  }
  return content.split(from).join(to);
}

async function storedScoresByTradeDate(tradeDates: string[]) {
  const dates = [...new Set(tradeDates)].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const scores = new Map<string, StoredStockScore>();
  if (dates.length === 0) {
    return scores;
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("macro_bias_scores")
    .select("trade_date, score, bias_label")
    .in("trade_date", dates);

  if (error) {
    throw new Error(`Failed to load macro_bias_scores: ${error.message}`);
  }

  for (const row of data ?? []) {
    const tradeDate = row.trade_date;
    const score = typeof row.score === "number" ? row.score : Number(row.score);
    const label = row.bias_label;
    if (typeof tradeDate !== "string" || !Number.isFinite(score) || typeof label !== "string") {
      continue;
    }
    scores.set(tradeDate, { trade_date: tradeDate, score, bias_label: label });
  }

  return scores;
}

function withStoredStockScore<T extends { briefing_date: string; quant_score: number; bias_label: string; brief_content?: string }>(
  row: T,
  stored: StoredStockScore | undefined,
): T | null {
  if (!stored || stored.trade_date !== row.briefing_date) {
    return null;
  }

  if (typeof row.brief_content !== "string") {
    return { ...row, quant_score: stored.score, bias_label: stored.bias_label };
  }

  return {
    ...row,
    quant_score: stored.score,
    bias_label: stored.bias_label,
    brief_content: citeStoredScore(
      row.brief_content,
      row.bias_label,
      row.quant_score,
      stored.bias_label,
      stored.score,
    ),
  };
}

export const getBriefingByDate = cache(async (date: string): Promise<PublicBriefingRow | null> => {
  const [metadata, viewer] = await Promise.all([getBriefingMetadata('stocks', date), getBriefingViewer()]);
  if (!metadata || !canReadBriefing(briefingAccess(viewer, metadata.publishedAt))) return null;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("daily_market_briefings")
    .select(BRIEFING_COLUMNS)
    .eq("briefing_date", date)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load briefing for ${date}: ${error.message}`);
  }

  const row = (data as PublicBriefingRow | null) ?? null;
  if (!row) {
    return null;
  }

  const stored = await storedScoresByTradeDate([row.briefing_date]);
  return withStoredStockScore(row, stored.get(row.briefing_date));
});

export const getLatestBriefing = cache(async (): Promise<PublicBriefingRow | null> => {
  const archive = await loadPaidBriefingArchive('stocks');
  return archive.items[0] ? getBriefingByDate(archive.items[0].date) : null;
});

export async function getAllBriefingDates(): Promise<BriefingListItem[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("daily_market_briefings")
    .select("briefing_date, quant_score, bias_label, is_override_active")
    .order("briefing_date", { ascending: false });

  if (error) {
    throw new Error(`Failed to load briefing dates: ${error.message}`);
  }

  const rows = (data as BriefingListItem[] | null) ?? [];
  const stored = await storedScoresByTradeDate(rows.map((row) => row.briefing_date));
  return rows.flatMap((row) => {
    const aligned = withStoredStockScore(row, stored.get(row.briefing_date));
    return aligned ? [aligned] : [];
  });
}
