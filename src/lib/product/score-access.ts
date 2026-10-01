import 'server-only';

import { DAILY_BRIEFING_SECTION_HEADERS } from '../briefing/daily-briefing-config';
import { getUserSubscriptionStatus } from '../billing/subscription';
import { selectVisibleRow, stockSessionDate } from '../market-data/stock-session';
import { extractTradableSignal } from '../signal/format-tradable-signal';
import type { PositionPermission, TradableSignal } from '../signal/types';
import { createSupabaseAdminClient } from '../supabase/admin';

export { selectVisibleRow, stockSessionDate };

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
  updated_at: string | null;
};

const SCORE_COLUMNS = 'trade_date, score, bias_label, updated_at';
type ScoreTable = 'macro_bias_scores' | 'crypto_bias_scores';

export type ProductScore = {
  paid: boolean;
  signedIn: boolean;
  score: ViewerScore | null;
  missingSessionDate: string | null;
  loadError: string | null;
};

export async function viewerIsPaid() {
  const { isPro } = await getUserSubscriptionStatus();
  return isPro;
}

async function loadRecentScores(table: ScoreTable) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from(table)
    .select(SCORE_COLUMNS)
    .order('trade_date', { ascending: false })
    .limit(5);

  if (error) {
    const detail = /<!DOCTYPE|522|timed out/i.test(error.message) ? 'the database timed out' : error.message.slice(0, 300);
    throw new Error(`Failed to load ${table}: ${detail}`);
  }

  return (data as ScoreRow[] | null) ?? [];
}

function toLoadError(table: ScoreTable, error: unknown) {
  const message = error instanceof Error ? error.message : '';

  if (message.startsWith('Failed to load ')) {
    return message;
  }

  const detail = /<!DOCTYPE|522|timed out/i.test(message)
    ? 'the database timed out'
    : message.slice(0, 300) || 'the database timed out';

  if (message.startsWith('Failed to read ')) {
    return `${message.split(':')[0]}: ${detail}`;
  }

  return `Failed to load ${table}: ${detail}`;
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
    .select('brief_content, trade_date')
    .eq('trade_date', tradeDate)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data || data.trade_date !== tradeDate || typeof data.brief_content !== 'string') {
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

async function loadTradableSignal(table: ScoreTable, tradeDate: string): Promise<TradableSignal | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from(table)
      .select('tradableSignal:engine_inputs->tradableSignal')
      .eq('trade_date', tradeDate)
      .maybeSingle();

    if (error || !data || typeof data !== 'object') {
      return null;
    }

    const tradableSignal = 'tradableSignal' in data ? data.tradableSignal : null;
    return extractTradableSignal({ tradableSignal });
  } catch {
    return null;
  }
}

function toViewerScore(
  asset: ProductAsset,
  row: ScoreRow,
  paid: boolean,
  delayed: boolean,
  signal: TradableSignal | null,
  tradeDate: string,
): ViewerScore {
  return {
    asset,
    paid,
    delayed,
    tradeDate,
    score: row.score,
    label: row.bias_label,
    updatedAt: row.updated_at,
    permission: signal?.position ?? null,
    grade: signal?.reliability ?? null,
    sizePct: signal ? Math.round(signal.size * 100) : null,
    sentence: null,
  };
}

export async function getViewerScore(asset: ProductAsset): Promise<ProductScore> {
  const table: ScoreTable = asset === 'stocks' ? 'macro_bias_scores' : 'crypto_bias_scores';
  let paid = false;
  let signedIn = false;

  try {
    const status = await getUserSubscriptionStatus();
    paid = status.isPro;
    signedIn = Boolean(status.user);
  } catch (error) {
    return {
      paid,
      signedIn,
      score: null,
      missingSessionDate: null,
      loadError: toLoadError(table, error),
    };
  }

  try {
    const rows = await loadRecentScores(table);
    const selected = selectVisibleRow(rows, paid, asset === 'stocks' ? stockSessionDate() : null);

    if (!selected.row) {
      return {
        paid,
        signedIn,
        score: null,
        missingSessionDate: selected.missingSessionDate,
        loadError: null,
      };
    }

    const tradeDate = selected.row.trade_date;
    const signal = paid ? await loadTradableSignal(table, selected.row.trade_date) : null;
    const score = toViewerScore(asset, selected.row, paid, !paid, signal, tradeDate);

    if (paid) {
      score.sentence = asset === 'stocks' ? await stockSentence(tradeDate) : await cryptoSentence(tradeDate);
    }

    return {
      paid,
      signedIn,
      score,
      missingSessionDate: selected.missingSessionDate,
      loadError: null,
    };
  } catch (error) {
    return {
      paid,
      signedIn,
      score: null,
      missingSessionDate: null,
      loadError: toLoadError(table, error),
    };
  }
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
