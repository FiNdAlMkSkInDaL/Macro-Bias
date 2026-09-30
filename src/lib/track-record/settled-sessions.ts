import 'server-only';

import { extractTradableSignal } from '../signal/format-tradable-signal';
import { createSupabaseAdminClient } from '../supabase/admin';

export type SettledSession = {
  scoreDate: string;
  sessionDate: string;
  score: number;
  permission: string | null;
  grade: string | null;
  sizePct: number | null;
  openToClosePct: number;
};

type ScoreRow = {
  trade_date: string;
  score: number;
  tradableSignal: unknown;
};

type PriceRow = {
  trade_date: string;
  open: number;
  close: number;
};

const SCORE_COLUMNS = 'trade_date, score, tradableSignal:engine_inputs->tradableSignal';

function queryError(table: string, message: string) {
  const detail = /<!DOCTYPE|522|timed out/i.test(message) ? 'the database timed out' : message.slice(0, 300);
  return new Error(`Failed to load ${table}: ${detail}`);
}

async function fetchRecentScores(table: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from(table)
    .select(SCORE_COLUMNS)
    .order('trade_date', { ascending: false })
    .limit(80);

  if (error) {
    throw queryError(table, error.message);
  }

  return (data as ScoreRow[] | null) ?? [];
}

async function fetchPrices(ticker: string, fromDate: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('etf_daily_prices')
    .select('trade_date, open, close')
    .eq('ticker', ticker)
    .gte('trade_date', fromDate)
    .order('trade_date', { ascending: true })
    .limit(200);

  if (error) {
    throw queryError('etf_daily_prices', error.message);
  }

  return (data as PriceRow[] | null) ?? [];
}

function settle(scores: ScoreRow[], prices: PriceRow[]): SettledSession[] {
  const orderedPrices = [...prices]
    .filter((row) => Number(row.open) > 0 && Number.isFinite(Number(row.close)))
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const sessions: SettledSession[] = [];

  for (const score of scores) {
    const next = orderedPrices.find((price) => price.trade_date > score.trade_date);

    if (!next) {
      continue;
    }

    const signal = extractTradableSignal({ tradableSignal: score.tradableSignal });
    const open = Number(next.open);
    const close = Number(next.close);

    sessions.push({
      scoreDate: score.trade_date,
      sessionDate: next.trade_date,
      score: score.score,
      permission: signal?.position ?? null,
      grade: signal?.reliability ?? null,
      sizePct: signal ? Math.round(signal.size * 100) : null,
      openToClosePct: ((close - open) / open) * 100,
    });
  }

  return sessions.sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
}

const CACHE_MS = 15 * 60 * 1000;
const settledCache = new Map<string, { at: number; rows: SettledSession[] }>();

async function loadSettled(scoreTable: string, ticker: string) {
  const scores = await fetchRecentScores(scoreTable);
  const firstDate = scores.reduce<string | null>(
    (oldest, row) => (oldest == null || row.trade_date < oldest ? row.trade_date : oldest),
    null,
  );
  const prices = firstDate ? await fetchPrices(ticker, firstDate) : [];

  return settle(scores, prices);
}

async function cachedSettled(key: string, load: () => Promise<SettledSession[]>) {
  const hit = settledCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return hit.rows;
  }

  const rows = await load();
  settledCache.set(key, { at: Date.now(), rows });
  return rows;
}

export async function getSettledStockSessions() {
  return cachedSettled('stocks', () => loadSettled('macro_bias_scores', 'SPY'));
}

export async function getSettledCryptoSessions() {
  return cachedSettled('crypto', () => loadSettled('crypto_bias_scores', 'BTC-USD'));
}
