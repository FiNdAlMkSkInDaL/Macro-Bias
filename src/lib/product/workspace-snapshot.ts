import 'server-only';

import { cache } from 'react';

import type { SubscriptionStatusResult } from '../billing/subscription';
import type { CryptoBiasScoreRow } from '../crypto-bias/types';
import type { MacroBiasScoreRow } from '../macro-bias/types';
import { selectVisibleRow, stockSessionDate } from '../market-data/stock-session';
import { createSupabaseAdminClient } from '../supabase/admin';
import type { ProductAsset } from './score-access';

export type WorkspaceSnapshot = (MacroBiasScoreRow | CryptoBiasScoreRow) & { source_date?: string | null };

export type ScoreMetadata = {
  trade_date: string;
  score: number;
  bias_label: string;
  updated_at: string | null;
  created_at?: string | null;
  source_date?: string | null;
};

/** Public reading metadata only; never fetch full analog universes to select a date. */
export const readRecentScoreMetadata = cache(async (asset: ProductAsset) => {
  const table = asset === 'stocks' ? 'macro_bias_scores' : 'crypto_bias_scores';
  const sourceDate = asset === 'stocks'
    ? 'source_date:ticker_changes->SPY->>tradeDate'
    : 'source_date:ticker_changes->"BTC-USD"->>tradeDate';
  const { data, error } = await createSupabaseAdminClient().from(table)
    .select(`trade_date, score, bias_label, updated_at, created_at, ${sourceDate}`)
    .order('trade_date', { ascending: false }).limit(5);
  if (error) throw error;
  return (data ?? []) as ScoreMetadata[];
});

// React invalidates this memo for each server render. No account or publication
// survives into another request, and both page and chart select the same row.
const readPaidSnapshot = cache(async (asset: ProductAsset) => {
  const table = asset === 'stocks' ? 'macro_bias_scores' : 'crypto_bias_scores';
  const selected = selectVisibleRow(await readRecentScoreMetadata(asset), true, asset === 'stocks' ? stockSessionDate() : null);
  if (!selected.row) return { ...selected, row: null };
  const { data, error } = await createSupabaseAdminClient().from(table)
    .select('id, trade_date, score, bias_label, component_scores, ticker_changes, engine_inputs, technical_indicators, created_at, updated_at')
    .eq('trade_date', selected.row.trade_date).maybeSingle();
  if (error) throw error;
  // Do not silently substitute another publication if the selected row disappears.
  const row = data?.trade_date === selected.row.trade_date
    ? { ...data, source_date: selected.row.source_date } as WorkspaceSnapshot
    : null;
  return { ...selected, row };
});

/** Only server callers with an already verified paid session may read full rows. */
export async function readPaidWorkspaceSelection(asset: ProductAsset, status: SubscriptionStatusResult) {
  if (!status.user?.id || !status.isPro) {
    return { row: null, displayTradeDate: null, missingSessionDate: null };
  }
  return readPaidSnapshot(asset);
}
