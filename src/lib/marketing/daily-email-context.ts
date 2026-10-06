import type { DailyBriefingResult, StoredBiasSnapshot } from '../briefing/types';

/** Facts supplied by the publisher, independent of generated newsletter copy. */
export type DailyEmailContext = {
  scoreDate?: string;
  marketDataDate?: string;
  generatedAt?: string;
  previousScore?: number | null;
  previousScoreDate?: string | null;
  interpretation?: string | null;
  evidence?: string[];
  historicalContext?: string | null;
  coverageNote?: string | null;
  isOverrideActive?: boolean;
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

export function buildStockEmailContext(
  briefing: DailyBriefingResult,
  snapshot: StoredBiasSnapshot,
  previous: Pick<StoredBiasSnapshot, 'trade_date' | 'score'> | null,
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
  const range = matches.map((match) => match.spyForward1DayReturn).filter(finite);
  const history = returns.length
    ? `${matches.length ? `${matches.length} matched historical sessions` : 'Recorded similar sessions'} had weighted average SPY returns of ${returns.join(' and ')}.${range.length ? ` Recorded one-session returns ranged from ${percent(Math.min(...range))} to ${percent(Math.max(...range))}.` : ''} These are past outcomes, not forecast bounds.`
    : null;
  const summaries = components.flatMap((component) => typeof component.summary === 'string' ? [component.summary] : []).join(' ');
  const evidence: string[] = [];
  const rsi = summaries.match(/SPY RSI is ([\d.]+)/);
  if (rsi && Number(rsi[1]) >= 0 && Number(rsi[1]) <= 100) evidence.push(`Momentum: SPY RSI is ${Number(rsi[1]).toFixed(1)} on a 0 to 100 scale.`);
  const credit = summaries.match(/HYG\/TLT percentile is ([\d.]+)/);
  if (credit && Number(credit[1]) >= 0 && Number(credit[1]) <= 100) evidence.push(`Credit backdrop: HYG versus TLT is at the ${Math.round(Number(credit[1]))}th percentile of its recent history.`);
  if (returns.length) evidence.push(`The score draws on similar sessions with weighted average SPY returns of ${returns.join(' and ')}.`);
  const engine = record(snapshot.engine_inputs);
  const tradeWindow = record(engine.tradeWindow);
  const marketDataDate = typeof tradeWindow.latestTradeDate === 'string' ? tradeWindow.latestTradeDate
    : briefing.quant.publishedScoreContext?.marketDataDate ?? undefined;
  return {
    scoreDate: snapshot.trade_date,
    marketDataDate,
    generatedAt: new Date().toISOString(),
    previousScore: previous && previous.trade_date < snapshot.trade_date && finite(previous.score) ? previous.score : null,
    previousScoreDate: previous?.trade_date,
    evidence,
    historicalContext: history,
    coverageNote: briefing.news.status === 'unavailable' ? 'The live news read is unavailable, so current headline risks have not been assessed.' : null,
    isOverrideActive: briefing.isOverrideActive,
  };
}
