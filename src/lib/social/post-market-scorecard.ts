import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { BiasLabel } from '@/lib/macro-bias/types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ScoreRow = {
  trade_date: string;
  score: number;
  bias_label: BiasLabel;
  ticker_changes: Record<
    string,
    { close: number; previousClose: number; percentChange: number }
  >;
};

type SpyPriceRow = {
  trade_date: string;
  close: number;
};

export type ScorecardData = {
  tradeDate: string;
  score: number;
  biasLabel: BiasLabel;
  spyChangePercent: number;
  callCorrect: boolean | null;
  /** Rolling hit rate over the last 30 scored days, as a percentage. */
  rollingHitRate: number | null;
  rollingWindow: number;
  streak: { count: number; type: 'correct' | 'incorrect' } | null;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function directionCorrect(score: number, returnPct: number): boolean | null {
  if (score === 0) return null;
  if (score > 0) return returnPct >= 0;
  return returnPct <= 0;
}

function friendlyLabel(label: BiasLabel): string {
  switch (label) {
    case 'EXTREME_RISK_ON':
      return 'Strong Bullish';
    case 'RISK_ON':
      return 'Bullish';
    case 'NEUTRAL':
      return 'Neutral';
    case 'RISK_OFF':
      return 'Bearish';
    case 'EXTREME_RISK_OFF':
      return 'Strong Bearish';
    default:
      return label;
  }
}

function formatSignedPercent(value: number): string {
  const rounded = Number(value.toFixed(2));
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

function formatSignedScore(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

/* ------------------------------------------------------------------ */
/*  Data fetcher                                                       */
/* ------------------------------------------------------------------ */

const ROLLING_WINDOW = 30;

export async function getScorecardData(): Promise<ScorecardData | null> {
  const sb = createSupabaseAdminClient();

  // Fetch the most recent 31 scored days (31 so we have enough for 30-day rolling window)
  const { data: scores, error: scoresErr } = await sb
    .from('macro_bias_scores')
    .select('trade_date, score, bias_label, ticker_changes')
    .order('trade_date', { ascending: false })
    .limit(ROLLING_WINDOW + 1);

  if (scoresErr) {
    throw new Error(`Failed to load bias scores: ${scoresErr.message}`);
  }

  const typedScores = (scores ?? []) as ScoreRow[];

  if (typedScores.length === 0) {
    return null;
  }

  const today = typedScores[0];

  // SPY change comes from the score row's ticker_changes (same-day close vs prev close)
  const spyChange = today.ticker_changes?.SPY;

  if (!spyChange) {
    return null;
  }

  const spyChangePercent = spyChange.percentChange;
  const callCorrect = directionCorrect(today.score, spyChangePercent);

  // Build rolling hit rate from the last ROLLING_WINDOW scored days
  const scoredDays = typedScores.filter((s) => s.score !== 0);
  const windowDays = scoredDays.slice(0, ROLLING_WINDOW);

  let correctCount = 0;
  let totalScored = 0;

  for (const day of windowDays) {
    const spy = day.ticker_changes?.SPY;
    if (!spy) continue;
    const correct = directionCorrect(day.score, spy.percentChange);
    if (correct !== null) {
      totalScored += 1;
      if (correct) correctCount += 1;
    }
  }

  const rollingHitRate = totalScored > 0 ? (correctCount / totalScored) * 100 : null;

  // Calculate current streak (correct or incorrect)
  let streak: ScorecardData['streak'] = null;

  if (callCorrect !== null) {
    let streakCount = 0;
    const streakType = callCorrect ? 'correct' : 'incorrect';

    for (const day of scoredDays) {
      const spy = day.ticker_changes?.SPY;
      if (!spy) break;
      const dayCorrect = directionCorrect(day.score, spy.percentChange);
      if (dayCorrect === null) break;
      if (dayCorrect === callCorrect) {
        streakCount += 1;
      } else {
        break;
      }
    }

    streak = { count: streakCount, type: streakType };
  }

  return {
    tradeDate: today.trade_date,
    score: today.score,
    biasLabel: today.bias_label,
    spyChangePercent,
    callCorrect,
    rollingHitRate,
    rollingWindow: totalScored,
    streak,
  };
}

/* ------------------------------------------------------------------ */
/*  Post builder                                                       */
/* ------------------------------------------------------------------ */

/**
 * Builds a plain-English scorecard post for X / Bluesky.
 *
 * Voice: confident, conversational, zero jargon. Like a trader updating
 * friends on how the day went. Matches the Macro Bias brand persona.
 */
export function buildScorecardPost(data: ScorecardData): string {
  const {
    score,
    biasLabel,
    spyChangePercent,
    callCorrect,
    rollingHitRate,
    rollingWindow,
    streak,
  } = data;

  const spyStr = formatSignedPercent(spyChangePercent);
  const scoreStr = formatSignedScore(score);
  const label = friendlyLabel(biasLabel);

  // Line 1: the call and the result
  let resultVerdict: string;

  if (callCorrect === null) {
    // Neutral score, can't judge direction
    resultVerdict = `Today's call: Neutral (${scoreStr}). $SPY closed ${spyStr}. No directional lean today.`;
  } else if (callCorrect) {
    resultVerdict = `Today's call: ${label} (${scoreStr}). $SPY closed ${spyStr}. Right again.`;
  } else {
    resultVerdict = `Today's call: ${label} (${scoreStr}). $SPY closed ${spyStr}. Wrong on this one.`;
  }

  // Line 2: rolling hit rate (only if we have enough data)
  let statsLine: string | null = null;

  if (rollingHitRate !== null && rollingWindow >= 5) {
    const hitRateStr = `${Math.round(rollingHitRate)}%`;
    statsLine = `Rolling accuracy: ${hitRateStr} over the last ${rollingWindow} trading days.`;
  }

  // Line 3: streak colour (only if streak is 3+ days)
  let streakLine: string | null = null;

  if (streak && streak.count >= 3) {
    if (streak.type === 'correct') {
      streakLine = `${streak.count}-day correct streak.`;
    } else {
      streakLine = `Working through a ${streak.count}-day miss streak. The model adapts.`;
    }
  }

  // Line 4: CTA
  const ctaLine = 'macro-bias.com/track-record?utm_source=twitter&utm_medium=social&utm_campaign=scorecard';

  const lines = [resultVerdict, statsLine, streakLine, ctaLine].filter(
    (line): line is string => Boolean(line),
  );

  return lines.join('\n\n');
}
