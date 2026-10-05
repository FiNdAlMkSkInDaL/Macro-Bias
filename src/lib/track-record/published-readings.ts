import 'server-only';

import { loadPaidBriefingArchive } from '@/lib/product/paid-briefing-data';
import type { ProductAsset } from '@/lib/product/score-access';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { publishedReadingLinks, type PublishedReading, type PublishedScore } from './published-reading-links';

export type PublishedReadingsData = {
  rows: PublishedReading[];
  loadError: string | null;
  briefingNotice: string | null;
};

const SCORE_LIMIT = 80;
const BIAS_LABELS = new Set(['EXTREME_RISK_OFF', 'RISK_OFF', 'NEUTRAL', 'RISK_ON', 'EXTREME_RISK_ON']);

function scoreRow(row: Record<string, unknown>): PublishedScore | null {
  const date = row.trade_date;
  const score = Number(row.score);
  if (
    typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
    (typeof row.score !== 'number' && (typeof row.score !== 'string' || !row.score.trim())) ||
    !Number.isFinite(score) || Math.abs(score) > 100 ||
    typeof row.bias_label !== 'string' || !BIAS_LABELS.has(row.bias_label)
  ) return null;
  return { tradeDate: date, score, biasLabel: row.bias_label };
}

async function loadScores(asset: ProductAsset) {
  const { data, error } = await createSupabaseAdminClient()
    .from(asset === 'stocks' ? 'macro_bias_scores' : 'crypto_bias_scores')
    .select('trade_date, score, bias_label')
    .order('trade_date', { ascending: false })
    .limit(SCORE_LIMIT);
  if (error) throw error;
  return (data ?? []).map(scoreRow).filter((row): row is PublishedScore => row !== null);
}

/** Scores remain public even when a full briefing is restricted or not published. */
export async function loadPublishedReadings(asset: ProductAsset): Promise<PublishedReadingsData> {
  const [scores, briefings] = await Promise.allSettled([
    loadScores(asset),
    loadPaidBriefingArchive(asset),
  ]);
  if (scores.status === 'rejected') {
    return { rows: [], loadError: 'Published readings are temporarily unavailable. Please try again.', briefingNotice: null };
  }

  const archive = briefings.status === 'fulfilled'
    ? briefings.value
    : { items: [], loadError: 'Briefings could not be loaded. Please try again.' };
  return {
    rows: publishedReadingLinks(asset, scores.value, archive.items, archive.loadError),
    loadError: null,
    briefingNotice: archive.loadError ? 'Full briefing availability could not be checked. Please try again.' : null,
  };
}
