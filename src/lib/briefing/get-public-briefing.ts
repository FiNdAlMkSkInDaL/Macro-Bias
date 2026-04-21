import "server-only";

import { cache } from "react";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
};

const BRIEFING_COLUMNS =
  "id, briefing_date, trade_date, quant_score, bias_label, is_override_active, brief_content, news_headlines, news_summary, generated_at";

export const getBriefingByDate = cache(async (date: string): Promise<PublicBriefingRow | null> => {
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

  return (data as PublicBriefingRow | null) ?? null;
});

export const getLatestBriefing = cache(async (): Promise<PublicBriefingRow | null> => {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("daily_market_briefings")
    .select(BRIEFING_COLUMNS)
    .order("briefing_date", { ascending: false })
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load latest briefing: ${error.message}`);
  }

  return (data as PublicBriefingRow | null) ?? null;
});

export async function getAllBriefingDates(): Promise<BriefingListItem[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("daily_market_briefings")
    .select("briefing_date, quant_score, bias_label")
    .order("briefing_date", { ascending: false });

  if (error) {
    throw new Error(`Failed to load briefing dates: ${error.message}`);
  }

  return (data as BriefingListItem[] | null) ?? [];
}
