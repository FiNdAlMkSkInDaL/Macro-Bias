import { createSupabaseAdminClient } from "../supabase/admin";
import type { MacroBiasScoreRow } from "../macro-bias/types";

// The API route only needs one record: the latest score that the daily job wrote.
// Keeping the query in a separate module makes the route itself trivial to maintain.
export async function getLatestBiasSnapshot(): Promise<MacroBiasScoreRow | null> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("macro_bias_scores")
    .select(
      "id, trade_date, score, bias_label, component_scores, ticker_changes, engine_inputs, technical_indicators, created_at, updated_at",
    )
    .order("trade_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as MacroBiasScoreRow | null) ?? null;
}