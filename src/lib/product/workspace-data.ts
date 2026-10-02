import 'server-only';

import { loadAlertPreferences, type AlertPreferences } from '../account/alert-preferences';
import type { SubscriptionStatusResult } from '../billing/subscription';
import { CRYPTO_TRACKED_TICKERS } from '../crypto-bias/constants';
import { TRACKED_TICKERS } from '../macro-bias/constants';
import type { PositionPermission, ReliabilityGrade } from '../signal/types';
import { createSupabaseAdminClient } from '../supabase/admin';
import { loadPublicDailyData, type PublicDailyData } from './public-daily-data';
import { getViewerScore, type ProductAsset, type ProductScore, type ViewerScore } from './score-access';

export type WorkspaceTickerChange = {
  ticker: string;
  tradeDate: string;
  dateSource: 'ticker' | 'snapshot';
  close: number;
  previousClose: number;
  percentChange: number;
};

export type WorkspaceMarketTape = {
  tradeDate: string | null;
  delayed: boolean;
  entries: WorkspaceTickerChange[];
  strongest: WorkspaceTickerChange | null;
  weakest: WorkspaceTickerChange | null;
  breadth: { advancers: number; decliners: number; unchanged: number; total: number };
  notice: string | null;
};

/** Existing stock-dashboard context, from the same authorized score session. */
export type WorkspaceStockContext = {
  tradeDate: string;
  delayed: boolean;
  permission: PositionPermission;
  sizePct: number | null;
  reliability: ReliabilityGrade | null;
  agreementPct: number | null;
  reason: string | null;
};

export type WorkspaceData = {
  asset: ProductAsset;
  active: PublicDailyData;
  otherMarket: {
    asset: ProductAsset;
    score: ViewerScore | null;
    missingSessionDate: string | null;
    loadError: string | null;
  };
  alerts: { preferences: AlertPreferences | null; notice: string | null };
  tape: WorkspaceMarketTape;
  stockContext: WorkspaceStockContext | null;
  stockContextNotice: string | null;
};

const LABELS = new Set(['EXTREME_RISK_OFF', 'RISK_OFF', 'NEUTRAL', 'RISK_ON', 'EXTREME_RISK_ON']);
const PERMISSIONS = new Set<PositionPermission>(['LONG', 'SHORT', 'FLAT', 'NO_TRADE']);
const GRADES = new Set<ReliabilityGrade>(['A', 'B', 'C', 'D', 'F']);
const SCORE_NOTICE = 'The daily score is temporarily unavailable. Please try again.';
const TAPE_NOTICE = 'Market moves are temporarily unavailable. Please try again.';
const CONTEXT_NOTICE = 'Stock trade context is temporarily unavailable. Please try again.';
const STOCK_CONTEXT_COLUMNS = [
  'permission:engine_inputs->tradableSignal->>position',
  'size:engine_inputs->tradableSignal->size',
  'reliability:engine_inputs->tradableSignal->>reliability',
  'agreement:engine_inputs->tradableSignal->neighborAgreement',
  'reason:engine_inputs->tradableSignal->>reason',
].join(', ');

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function number(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function projectScore(score: ViewerScore): ViewerScore {
  return {
    asset: score.asset, paid: score.paid, delayed: score.delayed,
    tradeDate: score.tradeDate, score: score.score, label: score.label,
    updatedAt: typeof score.updatedAt === 'string' ? score.updatedAt : null,
    permission: score.paid && score.permission && PERMISSIONS.has(score.permission) ? score.permission : null,
    grade: score.paid && score.grade && GRADES.has(score.grade as ReliabilityGrade) ? score.grade : null,
    sizePct: score.paid && typeof score.sizePct === 'number' && Number.isFinite(score.sizePct) && score.sizePct >= 0 && score.sizePct <= 100 ? score.sizePct : null,
    sentence: score.paid && typeof score.sentence === 'string' ? score.sentence.slice(0, 420) : null,
  };
}

function safeOtherScore(viewer: ProductScore, asset: ProductAsset): WorkspaceData['otherMarket'] {
  const result: WorkspaceData['otherMarket'] = {
    asset, score: null,
    missingSessionDate: validDate(viewer.missingSessionDate) ? viewer.missingSessionDate : null,
    loadError: viewer.loadError ? SCORE_NOTICE : null,
  };
  const score = viewer.score;
  if (result.loadError || !score) return result;
  // The other-market preview always uses the free selection, even for Pro.
  if (viewer.paid || score.paid || score.asset !== asset || !validDate(score.tradeDate) || !Number.isFinite(score.score) || Math.abs(score.score) > 100 || !LABELS.has(score.label)) {
    result.loadError = SCORE_NOTICE;
    return result;
  }
  result.score = {
    asset, paid: false, delayed: true, tradeDate: score.tradeDate,
    score: score.score, label: score.label, updatedAt: typeof score.updatedAt === 'string' ? score.updatedAt : null,
    permission: null, grade: null, sizePct: null, sentence: null,
  };
  return result;
}

function emptyTape(score: ViewerScore | null): WorkspaceMarketTape {
  return {
    tradeDate: score?.tradeDate ?? null, delayed: score?.delayed ?? true,
    entries: [], strongest: null, weakest: null,
    breadth: { advancers: 0, decliners: 0, unchanged: 0, total: 0 },
    notice: null,
  };
}

function tickerFromRow(ticker: string, row: unknown, tradeDate: string): WorkspaceTickerChange | null {
  if (!record(row) || (row.ticker != null && row.ticker !== ticker)) return null;
  const hasTickerDate = row.tradeDate != null;
  const tickerDate = hasTickerDate ? row.tradeDate : tradeDate;
  const close = number(row.close);
  const previousClose = number(row.previousClose);
  const percentChange = number(row.percentChange);
  // Older source dates remain explicit. A newer ticker date cannot bypass the cutoff.
  if (!validDate(tickerDate) || tickerDate > tradeDate || close == null || close <= 0 || previousClose == null || previousClose <= 0 || percentChange == null) return null;
  return { ticker, tradeDate: tickerDate, dateSource: hasTickerDate ? 'ticker' : 'snapshot', close, previousClose, percentChange };
}

function stockContext(row: Record<string, unknown>, score: ViewerScore): WorkspaceStockContext | null {
  if (typeof row.permission !== 'string' || !PERMISSIONS.has(row.permission as PositionPermission)) return null;
  const size = number(row.size);
  const agreement = number(row.agreement);
  return {
    tradeDate: score.tradeDate, delayed: score.delayed,
    permission: row.permission as PositionPermission,
    sizePct: size != null && size >= 0 && size <= 1 ? Math.round(size * 100) : null,
    reliability: typeof row.reliability === 'string' && GRADES.has(row.reliability as ReliabilityGrade) ? row.reliability as ReliabilityGrade : null,
    agreementPct: agreement != null && agreement >= 0 && agreement <= 1 ? Math.round(agreement * 100) : null,
    reason: typeof row.reason === 'string' && row.reason.trim() ? row.reason.trim().slice(0, 500) : null,
  };
}

async function loadDatedContext(asset: ProductAsset, score: ViewerScore | null) {
  const tape = emptyTape(score);
  let context: WorkspaceStockContext | null = null;
  let contextNotice: string | null = null;
  if (!score) {
    tape.notice = 'Market moves will appear when a score session is available.';
    return { tape, context, contextNotice };
  }
  try {
    const admin = createSupabaseAdminClient();
    const table = asset === 'stocks' ? 'macro_bias_scores' : 'crypto_bias_scores';
    const columns = `trade_date, ticker_changes${asset === 'stocks' ? `, ${STOCK_CONTEXT_COLUMNS}` : ''}`;
    const { data, error } = await admin.from(table).select(columns).eq('trade_date', score.tradeDate).maybeSingle();
    if (error) throw error;
    if (!record(data) || data.trade_date !== score.tradeDate) {
      tape.notice = 'Market moves are not available for this score session yet.';
      contextNotice = asset === 'stocks' ? 'Stock trade context is not available for this score session yet.' : null;
      return { tape, context, contextNotice };
    }
    const tickers: readonly string[] = asset === 'stocks' ? TRACKED_TICKERS : CRYPTO_TRACKED_TICKERS;
    if (record(data.ticker_changes)) {
      const changes = data.ticker_changes;
      tape.entries = tickers.map((ticker) => tickerFromRow(ticker, changes[ticker], score.tradeDate))
        .filter((entry): entry is WorkspaceTickerChange => entry != null);
    }
    const sorted = [...tape.entries].sort((a, b) => a.percentChange - b.percentChange);
    tape.weakest = sorted[0] ?? null;
    tape.strongest = sorted.at(-1) ?? null;
    tape.breadth = {
      advancers: tape.entries.filter((entry) => entry.percentChange > 0).length,
      decliners: tape.entries.filter((entry) => entry.percentChange < 0).length,
      unchanged: tape.entries.filter((entry) => entry.percentChange === 0).length,
      total: tape.entries.length,
    };
    if (!tape.entries.length) tape.notice = 'Market moves are not available for this score session yet.';
    if (asset === 'stocks') {
      context = stockContext(data, score);
      if (!context) contextNotice = 'Stock trade context is not available for this score session yet.';
    }
  } catch {
    tape.notice = TAPE_NOTICE;
    contextNotice = asset === 'stocks' ? CONTEXT_NOTICE : null;
  }
  return { tape, context, contextNotice };
}

async function loadVerifiedAlerts(status: SubscriptionStatusResult): Promise<WorkspaceData['alerts']> {
  if (!status.user?.email) return { preferences: null, notice: 'Email preferences are unavailable for this account.' };
  try {
    return { preferences: await loadAlertPreferences(status.user.email), notice: null };
  } catch {
    // Unavailable is distinct from verified opt-out: the UI must not present false defaults.
    return { preferences: null, notice: 'Email preferences are temporarily unavailable. Please try again.' };
  }
}

/**
 * Read-only workspace data. Reuses one trusted subscription lookup, caps active
 * history and all snapshot context at that viewer's visible session, and never
 * loads referral or billing actions. Free stock context preserves the existing
 * delayed dashboard feature without adding permission fields to crypto.
 */
export async function loadWorkspaceData(asset: ProductAsset, subscriptionStatus: SubscriptionStatusResult): Promise<WorkspaceData> {
  if (!subscriptionStatus.user?.id) {
    throw new Error('Sign in to open a workspace.');
  }

  const otherAsset: ProductAsset = asset === 'stocks' ? 'crypto' : 'stocks';
  const unavailableViewer: ProductScore = {
    paid: subscriptionStatus.isPro, signedIn: Boolean(subscriptionStatus.user),
    score: null, missingSessionDate: null, loadError: SCORE_NOTICE,
  };
  const [activeViewer, otherViewer, alerts] = await Promise.allSettled([
    getViewerScore(asset, subscriptionStatus),
    getViewerScore(otherAsset, { ...subscriptionStatus, isPro: false }),
    loadVerifiedAlerts(subscriptionStatus),
  ]);
  const candidate = activeViewer.status === 'fulfilled' ? activeViewer.value : unavailableViewer;
  // Fail closed if an unexpected access result disagrees with the trusted status.
  const authorized = candidate.paid === subscriptionStatus.isPro && (!candidate.score || candidate.score.paid === subscriptionStatus.isPro);
  const active = await loadPublicDailyData(asset, authorized ? { ...candidate, score: candidate.score ? projectScore(candidate.score) : null } : unavailableViewer);
  const dated = await loadDatedContext(asset, active.score);
  return {
    asset, active,
    otherMarket: safeOtherScore(otherViewer.status === 'fulfilled' ? otherViewer.value : { ...unavailableViewer, paid: false }, otherAsset),
    alerts: alerts.status === 'fulfilled' ? alerts.value : { preferences: null, notice: 'Email preferences are temporarily unavailable. Please try again.' },
    tape: dated.tape, stockContext: dated.context, stockContextNotice: dated.contextNotice,
  };
}
