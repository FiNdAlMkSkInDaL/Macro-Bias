import 'server-only';

import { DAILY_BRIEFING_SECTION_HEADERS } from '../briefing/daily-briefing-config';
import { isSubscriptionActive, getUserSubscriptionStatus } from '../billing/subscription';
import { extractTradableSignal } from '../signal/format-tradable-signal';
import type { PositionPermission } from '../signal/types';
import { createSupabaseAdminClient } from '../supabase/admin';

export type ProductAsset = 'stocks' | 'crypto';

export type ViewerScore = {
  asset: ProductAsset;
  paid: boolean;
  delayed: boolean;
  tradeDate: string;
  score: number;
  label: string;
  updatedAt: string | null;
  permission: PositionPermission | null;
  grade: string | null;
  sizePct: number | null;
  sentence: string | null;
};

type ScoreRow = {
  trade_date: string;
  score: number;
  bias_label: string;
  engine_inputs: unknown;
  updated_at: string | null;
};

const SCORE_COLUMNS = 'trade_date, score, bias_label, engine_inputs, updated_at';

export async function viewerIsPaid() {
  const { subscriptionStatus } = await getUserSubscriptionStatus();
  return isSubscriptionActive(subscriptionStatus);
}

async function loadRecentScores(table: 'macro_bias_scores' | 'crypto_bias_scores') {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from(table)
    .select(SCORE_COLUMNS)
    .order('trade_date', { ascending: false })
    .limit(2);

  if (error) {
    throw new Error(`Failed to load ${table}: ${error.message}`);
  }

  return (data as ScoreRow[] | null) ?? [];
}

function firstParagraph(text: string | null | undefined) {
  if (!text) {
    return null;
  }

  const withoutMarkers = text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim();
  const paragraph = withoutMarkers
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .find((part) => part.length > 40);

  if (!paragraph) {
    return null;
  }

  return paragraph.length > 420 ? `${paragraph.slice(0, 417).trimEnd()}...` : paragraph;
}

function sectionParagraph(briefContent: string, header: string) {
  const lines = briefContent.split('\n');
  const start = lines.findIndex((line) => line.replace(/\*\*/g, '').trim().startsWith(header));

  if (start === -1) {
    return firstParagraph(briefContent);
  }

  const body: string[] = [];

  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (body.length > 0) {
        break;
      }
      continue;
    }

    if (/^[A-Z][A-Z0-9 /-]{6,}$/.test(trimmed.replace(/\*\*/g, ''))) {
      break;
    }

    body.push(trimmed);
  }

  return firstParagraph(body.join(' ')) ?? firstParagraph(briefContent);
}

async function stockSentence(tradeDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('daily_market_briefings')
    .select('brief_content, trade_date, briefing_date')
    .or(`trade_date.eq.${tradeDate},briefing_date.eq.${tradeDate}`)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data || typeof data.brief_content !== 'string') {
    return null;
  }

  if (data.trade_date !== tradeDate && data.briefing_date !== tradeDate) {
    return null;
  }

  return sectionParagraph(data.brief_content, DAILY_BRIEFING_SECTION_HEADERS.bottomLine);
}

async function cryptoSentence(tradeDate: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('crypto_daily_briefings')
    .select('brief_content, trade_date')
    .eq('trade_date', tradeDate)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data || typeof data.brief_content !== 'string') {
    return null;
  }

  return firstParagraph(data.brief_content);
}

function toViewerScore(asset: ProductAsset, row: ScoreRow, paid: boolean, delayed: boolean): ViewerScore {
  const signal = paid ? extractTradableSignal(row.engine_inputs) : null;

  return {
    asset,
    paid,
    delayed,
    tradeDate: row.trade_date,
    score: row.score,
    label: row.bias_label,
    updatedAt: row.updated_at,
    permission: signal?.position ?? null,
    grade: signal?.reliability ?? null,
    sizePct: signal ? Math.round(signal.size * 100) : null,
    sentence: null,
  };
}

export async function getViewerScore(asset: ProductAsset): Promise<ViewerScore | null> {
  const paid = await viewerIsPaid();
  const rows = await loadRecentScores(asset === 'stocks' ? 'macro_bias_scores' : 'crypto_bias_scores');
  const row = paid ? rows[0] : rows[1];

  if (!row) {
    return null;
  }

  const score = toViewerScore(asset, row, paid, !paid);

  if (!paid) {
    return score;
  }

  score.sentence = asset === 'stocks' ? await stockSentence(row.trade_date) : await cryptoSentence(row.trade_date);
  return score;
}

export async function latestStoredTradeDate(asset: ProductAsset) {
  const rows = await loadRecentScores(asset === 'stocks' ? 'macro_bias_scores' : 'crypto_bias_scores');
  return rows[0]?.trade_date ?? null;
}

export async function isLatestSessionLocked(asset: ProductAsset, date: string) {
  if (await viewerIsPaid()) {
    return false;
  }

  const latest = await latestStoredTradeDate(asset);
  return latest != null && latest === date;
}
