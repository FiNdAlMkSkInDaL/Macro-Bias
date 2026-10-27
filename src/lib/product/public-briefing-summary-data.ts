import 'server-only';
import { cache } from 'react';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getBriefingMetadata, isPaidBriefingDate } from './paid-briefing-data';
import { buildPublicBriefingSummary, type PublicBriefingFacts } from './public-briefing-summary';
import type { ProductAsset } from './score-access';

export const loadPublicBriefingSummary = cache(async (asset: ProductAsset, date: string) => {
  if (!isPaidBriefingDate(date)) return null;
  try {
    const published = await getBriefingMetadata(asset, date);
    if (!published?.publishedAt || Date.parse(published.publishedAt) > Date.now()) return null;
    const { data, error } = await createSupabaseAdminClient({ timeoutMs: 5000 })
      .from(asset === 'stocks' ? 'macro_bias_scores' : 'crypto_bias_scores')
      .select(asset === 'stocks' ? 'trade_date,ticker_changes,window:engine_inputs->tradeWindow' : 'trade_date,ticker_changes')
      .eq('trade_date', date).maybeSingle();
    if (error) return null;
    return buildPublicBriefingSummary(asset, date, data as unknown as PublicBriefingFacts | null);
  } catch { return null; }
});
