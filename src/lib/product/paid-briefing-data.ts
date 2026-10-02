import 'server-only';
import { cache } from 'react';
import { getUserSubscriptionStatus } from '@/lib/billing/subscription';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { briefingAccess, briefingReleaseAt, canReadBriefing, type BriefingAccess, type BriefingViewer } from './briefing-access';
import type { ProductAsset } from './score-access';

export type PaidBriefingArchiveItem = {
  date: string; tradeDate: string; score: number | null; biasLabel: string;
  overrideActive?: boolean; publishedAt: string | null; freeAvailableAt: string | null;
};
type BriefingMetadata = PaidBriefingArchiveItem & { id: string; generatedAt: string | null };
export type PaidBriefingArchiveData = { items: PaidBriefingArchiveItem[]; loadError: string | null };
export type PaidBriefingDocument = {
  briefingDate: string; tradeDate: string; score: number | null; biasLabel: string;
  content: string; generatedAt: string | null; publishedAt: string | null;
  overrideActive: boolean; modelVersion?: string | null;
};
export type PaidBriefingDetailData = {
  briefing: PaidBriefingDocument | null; metadata: PaidBriefingArchiveItem | null;
  access: BriefingAccess; viewer: BriefingViewer; archive: PaidBriefingArchiveData; loadError: string | null;
};
export function isPaidBriefingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
function validTimestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}
function isScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -100 && value <= 100;
}
export const getBriefingViewer = cache(async (): Promise<BriefingViewer> => {
  const status = await getUserSubscriptionStatus();
  return { signedIn: Boolean(status.user), isPro: status.isPro };
});

// Metadata is separate from body/news/model columns. React cache deduplicates
// within a request; it is never a cross-user persistent authorization cache.
const loadMetadata = cache(async (asset: ProductAsset): Promise<BriefingMetadata[]> => {
  const admin = createSupabaseAdminClient();
  const stock = asset === 'stocks';
  const table = stock ? 'daily_market_briefings' : 'crypto_daily_briefings';
  const columns = stock
    ? 'id, briefing_date, trade_date, quant_score, bias_label, is_override_active, generated_at'
    : 'id, trade_date, score, bias_label, is_override_active, created_at';
  const sessions = new Map<string, BriefingMetadata>();
  // Read every metadata page so regenerations cannot truncate the first
  // publication. No briefing body is fetched for archive/listing requests.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from(table).select(columns)
      .order(stock ? 'briefing_date' : 'trade_date', { ascending: false })
      .order(stock ? 'generated_at' : 'created_at', { ascending: false })
      .range(offset, offset + 999);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    for (const row of rows) {
      const date = stock ? row.briefing_date : row.trade_date;
      if (!isPaidBriefingDate(date) || !isPaidBriefingDate(row.trade_date) || typeof row.id !== 'string') continue;
      const timestamp = validTimestamp(stock ? row.generated_at : row.created_at);
      const existing = sessions.get(date);
      if (existing) {
        // New stock publications append rows: use the earliest actual timestamp
        // for age while the newest row id selects the current stored text.
        if (timestamp && (!existing.publishedAt || timestamp < existing.publishedAt)) {
          existing.publishedAt = timestamp;
          existing.freeAvailableAt = briefingReleaseAt(timestamp);
        }
        continue;
      }
      const rawScore = stock ? row.quant_score : row.score;
      sessions.set(date, {
        id: row.id, date, tradeDate: row.trade_date, score: isScore(rawScore) ? rawScore : null,
        biasLabel: typeof row.bias_label === 'string' ? row.bias_label : 'UNAVAILABLE',
        overrideActive: row.is_override_active === true,
        generatedAt: timestamp, publishedAt: timestamp, freeAvailableAt: briefingReleaseAt(timestamp),
      });
    }
    if (rows.length < 1000) break;
  }
  if (stock && sessions.size) {
    const dates = [...sessions.keys()];
    const stored = new Map<string, { score: number; biasLabel: string }>();
    for (let offset = 0; offset < dates.length; offset += 500) {
      const { data, error } = await admin.from('macro_bias_scores').select('trade_date, score, bias_label').in('trade_date', dates.slice(offset, offset + 500));
      if (error) throw error;
      for (const row of data ?? []) if (isScore(row.score) && typeof row.bias_label === 'string') stored.set(row.trade_date, { score: row.score, biasLabel: row.bias_label });
    }
    // Keep published posts whose aligned reading is missing, without attaching
    // a different source session's score to the displayed briefing date.
    for (const item of sessions.values()) {
      const reading = stored.get(item.date);
      item.score = reading?.score ?? null;
      item.biasLabel = reading?.biasLabel ?? 'UNAVAILABLE';
    }
  }
  return [...sessions.values()].sort((a, b) => b.date.localeCompare(a.date));
});
function publicMetadata({ id: _id, generatedAt: _generatedAt, ...item }: BriefingMetadata): PaidBriefingArchiveItem { return item; }
export async function loadPaidBriefingArchive(asset: ProductAsset): Promise<PaidBriefingArchiveData> {
  try { return { items: (await loadMetadata(asset)).map(publicMetadata), loadError: null }; }
  catch { return { items: [], loadError: 'Briefings could not be loaded. Please try again.' }; }
}
export async function getBriefingMetadata(asset: ProductAsset, date: string): Promise<PaidBriefingArchiveItem | null> {
  if (!isPaidBriefingDate(date)) return null;
  const item = (await loadMetadata(asset)).find((row) => row.date === date);
  return item ? publicMetadata(item) : null;
}
export async function loadPaidBriefingDetail(asset: ProductAsset, date: string): Promise<PaidBriefingDetailData> {
  const viewer = await getBriefingViewer();
  const archive = await loadPaidBriefingArchive(asset);
  const empty = { briefing: null, metadata: null, access: briefingAccess(viewer, null), viewer, archive, loadError: archive.loadError };
  if (!isPaidBriefingDate(date) || archive.loadError) return empty;
  const row = (await loadMetadata(asset)).find((item) => item.date === date);
  if (!row) return empty;
  const metadata = publicMetadata(row);
  const access = briefingAccess(viewer, row.publishedAt);
  // Authorization precedes the only content/model query. Locked responses have
  // no body/model/news object available to serialize into HTML/RSC/JSON.
  if (!canReadBriefing(access)) return { ...empty, metadata, access };
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from(asset === 'stocks' ? 'daily_market_briefings' : 'crypto_daily_briefings')
      .select(asset === 'stocks' ? 'brief_content' : 'brief_content, model_version')
      .eq('id', row.id).maybeSingle();
    if (error) throw error;
    if (!data) return { ...empty, metadata, access };
    const document = data as unknown as { brief_content?: unknown; model_version?: unknown };
    const content = typeof document.brief_content === 'string' ? document.brief_content : '';
    return { metadata, access, viewer, archive, loadError: null, briefing: {
      briefingDate: row.date, tradeDate: row.tradeDate, score: row.score, biasLabel: row.biasLabel,
      content, generatedAt: row.generatedAt, publishedAt: row.publishedAt, overrideActive: row.overrideActive === true,
      ...(typeof document.model_version === 'string' ? { modelVersion: document.model_version } : {}),
    } };
  } catch { return { ...empty, metadata, access, loadError: 'This briefing could not be loaded. Please try again.' }; }
}
