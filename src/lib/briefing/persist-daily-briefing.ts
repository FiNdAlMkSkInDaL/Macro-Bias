import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import type { PersistDailyBriefingInput } from "./types";

type DailyMarketBriefingInsert = {
  analog_reference: string | null;
  bias_label: string;
  brief_content: string;
  briefing_date: string;
  generation_method: string;
  is_override_active: boolean;
  news_headlines: string[];
  news_status: string;
  news_summary: string;
  quant_score: number;
  source_model: string;
  trade_date: string;
};

export async function persistDailyBriefing(
  input: PersistDailyBriefingInput,
): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const row: DailyMarketBriefingInsert = {
    analog_reference: input.briefing.quant.analogReference,
    bias_label: input.briefing.quant.label,
    brief_content: input.briefing.newsletterCopy,
    briefing_date: input.briefingDate,
    generation_method: input.briefing.generatedBy,
    is_override_active: input.briefing.isOverrideActive,
    news_headlines: input.briefing.news.headlines,
    news_status: input.briefing.news.status,
    news_summary: input.briefing.news.summary,
    quant_score: input.briefing.quant.score,
    source_model: input.briefing.model,
    trade_date: input.briefing.quant.tradeDate,
  };

  const { error } = await supabase.from("daily_market_briefings").insert(row);

  if (error) {
    throw new Error(`Failed to persist daily briefing: ${error.message}`);
  }
}