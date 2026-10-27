import type { DailyBriefingResult, StoredBiasSnapshot } from '../briefing/types';
import { buildStockMarketSnapshot } from '../briefing/stock-market-snapshot';

/** Facts supplied by the publisher, independent of generated newsletter copy. */
export type DailyEmailContext = {
  scoreDate?: string;
  marketDataDate?: string;
  generatedAt?: string;
  previousScore?: number | null;
  previousScoreDate?: string | null;
  scoreVersion?: string | null;
  previousScoreVersion?: string | null;
  interpretation?: string | null;
  /** Supported price observation, safe to retain even when the model withholds a call. */
  marketObservation?: string | null;
  evidence?: string[];
  historicalContext?: string | null;
  coverageNote?: string | null;
  isOverrideActive?: boolean;
  /** Dated stock facts supplied independently of AI prose, including fallback sends. */
  stockFacts?: { marketRows: string[]; watchPoints: string[] };
};

export const DAILY_EMAIL_IMPROVEMENTS_START_DATE = '2026-10-07';

/** Activate for sends on the requested London calendar date, not the score's data date. */
export function dailyEmailImprovementsEnabled(now = new Date()) {
  const parts = new Map(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}` >= DAILY_EMAIL_IMPROVEMENTS_START_DATE;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function percent(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function ordinal(value: number) {
  const rounded = Math.round(value);
  const suffix = rounded % 100 >= 11 && rounded % 100 <= 13 ? 'th'
    : rounded % 10 === 1 ? 'st' : rounded % 10 === 2 ? 'nd' : rounded % 10 === 3 ? 'rd' : 'th';
  return `${rounded}${suffix}`;
}

export function buildStockEmailContext(
  briefing: DailyBriefingResult,
  snapshot: StoredBiasSnapshot,
  previous: (Pick<StoredBiasSnapshot, 'trade_date' | 'score'> & Partial<Pick<StoredBiasSnapshot, 'model_version'>>) | null,
): DailyEmailContext {
  const components = Array.isArray(snapshot.component_scores) ? snapshot.component_scores.map(record) : [];
  const historical = components.find((component) => Array.isArray(component.analogMatches) && component.analogMatches.length)
    ?? components.find((component) => finite(component.averageForward1DayReturn) || finite(component.averageForward3DayReturn));
  const matches = [...new Map((Array.isArray(historical?.analogMatches) ? historical.analogMatches.map(record) : [])
    .filter((match) => typeof match.tradeDate === 'string' && match.tradeDate < snapshot.trade_date)
    .map((match) => [match.tradeDate as string, match])).values()];
  const returns: string[] = [];
  if (finite(historical?.averageForward1DayReturn)) returns.push(`${percent(historical.averageForward1DayReturn)} after one session`);
  if (finite(historical?.averageForward3DayReturn)) returns.push(`${percent(historical.averageForward3DayReturn)} after three sessions`);
  const rangeText = [['spyForward1DayReturn', 'one-session'], ['spyForward3DayReturn', 'three-session']].map(([key, horizon]) => {
    const range = matches.map((match) => match[key]).filter(finite);
    return range.length === 1 ? ` One recorded ${horizon} return: ${percent(range[0])}.`
      : range.length > 1 ? ` Observed ${horizon} returns ran from ${percent(Math.min(...range))} to ${percent(Math.max(...range))}${range.length !== matches.length ? ` (${range.length} recorded outcomes)` : ''}.` : '';
  }).join('');
  const history = returns.length
    ? `${matches.length ? `${matches.length} past session${matches.length === 1 ? '' : 's'} matched this setup.` : 'The number of past matches is unavailable.'} SPY's weighted average return was ${returns.join(' and ')}.${rangeText}${matches.length > 0 && matches.length < 10 ? ' That is a small sample.' : ''} These are past outcomes, not forecast bounds.`
    : null;
  const summaries = components.flatMap((component) => typeof component.summary === 'string' ? [component.summary] : []).join(' ');
  const market = buildStockMarketSnapshot(snapshot);
  const evidence: string[] = [...market.evidence];
  const rsi = summaries.match(/SPY RSI is ([\d.]+)/);
  if (!evidence.length && rsi && Number(rsi[1]) >= 0 && Number(rsi[1]) <= 100) evidence.push(`SPY RSI is ${Number(rsi[1]).toFixed(1)}.`);
  const credit = summaries.match(/HYG\/TLT percentile is ([\d.]+)/);
  if (credit && Number(credit[1]) >= 0 && Number(credit[1]) <= 100) evidence.push(`The HYG/TLT price ratio is at the ${ordinal(Number(credit[1]))} percentile of its recent history. This compares high-yield credit with long Treasuries, not today's return.`);
  const marketDataDate = market.marketDataDate ?? undefined;
  return {
    scoreDate: snapshot.trade_date,
    scoreVersion: snapshot.model_version,
    previousScoreVersion: previous?.model_version ?? null,
    marketDataDate,
    generatedAt: new Date().toISOString(),
    previousScore: previous && previous.trade_date < snapshot.trade_date && finite(previous.score) ? previous.score : null,
    previousScoreDate: previous?.trade_date,
    evidence,
    marketObservation: market.quotes.SPY ? `The S&P 500 ETF SPY ${market.quotes.SPY.percentChange === 0 ? 'was unchanged'
      : Math.abs(market.quotes.SPY.percentChange) < 0.005 ? 'changed less than 0.01%'
      : `${market.quotes.SPY.percentChange > 0 ? 'rose' : 'fell'} ${Math.abs(market.quotes.SPY.percentChange).toFixed(2)}%`} in the latest completed session.` : null,
    historicalContext: history,
    stockFacts: { marketRows: market.marketRows, watchPoints: market.watchPoints },
    coverageNote: [market.coverageNote, briefing.news.status === 'unavailable' ? 'The news feed is unavailable. This reading does not assess current headlines.' : null].filter(Boolean).join(' ') || null,
    isOverrideActive: briefing.isOverrideActive,
  };
}
