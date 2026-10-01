import 'server-only';

import { getAllBriefingDates, getBriefingByDate } from '@/lib/briefing/get-public-briefing';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { ProductAsset } from './score-access';

export type PaidBriefingArchiveItem = {
  date: string;
  score: number;
  biasLabel: string;
  overrideActive?: boolean;
};

export type PaidBriefingArchiveData = {
  items: PaidBriefingArchiveItem[];
  loadError: string | null;
};

export type PaidBriefingDocument = {
  briefingDate: string;
  tradeDate: string;
  score: number;
  biasLabel: string;
  content: string;
  generatedAt: string | null;
  overrideActive: boolean;
  modelVersion?: string | null;
};

export type PaidBriefingDetailData = {
  briefing: PaidBriefingDocument | null;
  archive: PaidBriefingArchiveData;
  loadError: string | null;
};

export function isPaidBriefingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function isScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -100 && value <= 100;
}

function isLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueSessions(items: PaidBriefingArchiveItem[]) {
  const sessions = new Map<string, PaidBriefingArchiveItem>();
  for (const item of items) if (!sessions.has(item.date)) sessions.set(item.date, item);
  return [...sessions.values()].sort((left, right) => right.date.localeCompare(left.date));
}

// These reads are called only from the routes' existing paid branches. Stock
// scores retain the public helper's briefing-date alignment. The clean helper's
// three list fields are sufficient; no unrelated override-list change is needed.
export async function loadPaidBriefingArchive(asset: ProductAsset): Promise<PaidBriefingArchiveData> {
  try {
    if (asset === 'stocks') {
      const rows = await getAllBriefingDates();
      const items = rows.flatMap((row): PaidBriefingArchiveItem[] =>
        isPaidBriefingDate(row.briefing_date) && isScore(row.quant_score) && isLabel(row.bias_label)
          ? [{ date: row.briefing_date, score: row.quant_score, biasLabel: row.bias_label }]
          : [],
      );
      return { items: uniqueSessions(items), loadError: null };
    }

    const { data, error } = await createSupabaseAdminClient()
      .from('crypto_daily_briefings')
      .select('id, trade_date, score, bias_label, is_override_active')
      .order('trade_date', { ascending: false })
      .limit(365);
    if (error) throw error;
    const items = (data ?? []).flatMap((row): PaidBriefingArchiveItem[] =>
      isPaidBriefingDate(row.trade_date) && isScore(row.score) && isLabel(row.bias_label)
        ? [{ date: row.trade_date, score: row.score, biasLabel: row.bias_label, overrideActive: row.is_override_active === true }]
        : [],
    );
    return { items: uniqueSessions(items), loadError: null };
  } catch {
    return { items: [], loadError: 'Briefings could not be loaded. Please try again.' };
  }
}

async function loadDocument(asset: ProductAsset, date: string): Promise<PaidBriefingDocument | null> {
  if (!isPaidBriefingDate(date)) return null;
  if (asset === 'stocks') {
    const row = await getBriefingByDate(date);
    if (!row || !isPaidBriefingDate(row.briefing_date) || !isPaidBriefingDate(row.trade_date) || !isScore(row.quant_score) || !isLabel(row.bias_label)) return null;
    return {
      briefingDate: row.briefing_date,
      tradeDate: row.trade_date,
      score: row.quant_score,
      biasLabel: row.bias_label,
      content: typeof row.brief_content === 'string' ? row.brief_content : '',
      generatedAt: typeof row.generated_at === 'string' ? row.generated_at : null,
      overrideActive: row.is_override_active === true,
    };
  }

  const { data, error } = await createSupabaseAdminClient()
    .from('crypto_daily_briefings')
    .select('id, trade_date, score, bias_label, brief_content, is_override_active, model_version, created_at')
    .eq('trade_date', date)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data || !isPaidBriefingDate(data.trade_date) || !isScore(data.score) || !isLabel(data.bias_label)) return null;
  return {
    briefingDate: data.trade_date,
    tradeDate: data.trade_date,
    score: data.score,
    biasLabel: data.bias_label,
    content: typeof data.brief_content === 'string' ? data.brief_content : '',
    generatedAt: typeof data.created_at === 'string' ? data.created_at : null,
    overrideActive: data.is_override_active === true,
    modelVersion: typeof data.model_version === 'string' ? data.model_version : null,
  };
}

export async function loadPaidBriefingDetail(asset: ProductAsset, date: string): Promise<PaidBriefingDetailData> {
  const [document, archive] = await Promise.allSettled([
    loadDocument(asset, date),
    loadPaidBriefingArchive(asset),
  ]);
  return {
    briefing: document.status === 'fulfilled' ? document.value : null,
    archive: archive.status === 'fulfilled' ? archive.value : { items: [], loadError: 'Briefing navigation could not be loaded.' },
    loadError: document.status === 'rejected' ? 'This briefing could not be loaded. Please try again.' : null,
  };
}
