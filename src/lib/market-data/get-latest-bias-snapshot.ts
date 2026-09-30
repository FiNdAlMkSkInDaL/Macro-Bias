import { createSupabaseAdminClient } from "../supabase/admin";
import type { MacroBiasScoreRow } from "../macro-bias/types";

// The API route only needs one record: the latest score that the daily job wrote.
// Keeping the query in a separate module makes the route itself trivial to maintain.
const SNAPSHOT_COLUMNS =
  "id, trade_date, score, bias_label, component_scores, ticker_changes, engine_inputs, technical_indicators, created_at, updated_at";

export async function getRecentBiasSnapshots(limit = 2): Promise<MacroBiasScoreRow[]> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("macro_bias_scores")
    .select(SNAPSHOT_COLUMNS)
    .order("trade_date", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data as MacroBiasScoreRow[] | null) ?? [];
}

export async function getLatestBiasSnapshot(): Promise<MacroBiasScoreRow | null> {
  const rows = await getRecentBiasSnapshots(1);
  return rows[0] ?? null;
}