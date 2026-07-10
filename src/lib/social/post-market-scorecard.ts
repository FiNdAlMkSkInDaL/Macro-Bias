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
  /** Score that was live for the session being graded (prior close fingerprint). */
  score: number;
  biasLabel: BiasLabel;
  /** Next-session SPY return after the score date (tradable horizon). */
  spyForward1DReturn: number;
  callCorrect: boolean | null;
  /** Rolling next-day hit rate over the last N scored days. */
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

/**
 * Grades the *previous* bias score against the *next* SPY session return.
 * Same-day score vs same-day move is circular (features include that close).
 */
export async function getScorecardData(): Promise<ScorecardData | null> {
  const sb = createSupabaseAdminClient();

  // Need enough history for rolling window + forward pairing
  const { data: scores, error: scoresErr } = await sb
    .from('macro_bias_scores')
    .select('trade_date, score, bias_label, ticker_changes')
    .order('trade_date', { ascending: false })
    .limit(ROLLING_WINDOW + 5);

  if (scoresErr) {
    throw new Error(`Failed to load bias scores: ${scoresErr.message}`);
  }

  const typedScores = (scores ?? []) as ScoreRow[];

  if (typedScores.length < 2) {
    return null;
  }

  // Chronological ascending for pairing
  const chronological = [...typedScores].reverse();

  // Pair score on day t with SPY return on day t+1 (from ticker_changes of day t+1)
  type PairedDay = {
    scoreDate: string;
    score: number;
    biasLabel: BiasLabel;
    forward1DReturn: number;
    correct: boolean | null;
  };

  const pairs: PairedDay[] = [];

  for (let i = 0; i < chronological.length - 1; i++) {
    const scoreDay = chronological[i];
    const nextDay = chronological[i + 1];
    const nextSpy = nextDay.ticker_changes?.SPY;
    if (!nextSpy || typeof nextSpy.percentChange !== 'number') continue;

    pairs.push({
      scoreDate: scoreDay.trade_date,
      score: scoreDay.score,
      biasLabel: scoreDay.bias_label,
      forward1DReturn: nextSpy.percentChange,
      correct: directionCorrect(scoreDay.score, nextSpy.percentChange),
    });
  }

  if (pairs.length === 0) {
    // Fallback: use SPY prices if ticker_changes missing on next day
    const dates = chronological.map((s) => s.trade_date);
    const { data: spyRows } = await sb
      .from('etf_daily_prices')
      .select('trade_date, close')
      .eq('ticker', 'SPY')
      .in('trade_date', dates)
      .order('trade_date', { ascending: true });

    const spyByDate = new Map(
      ((spyRows ?? []) as SpyPriceRow[]).map((r) => [r.trade_date, r.close]),
    );

    for (let i = 0; i < chronological.length - 1; i++) {
      const scoreDay = chronological[i];
      const nextDate = chronological[i + 1].trade_date;
      const c0 = spyByDate.get(scoreDay.trade_date);
      const c1 = spyByDate.get(nextDate);
      if (c0 == null || c1 == null || c0 === 0) continue;
      const fwd = ((c1 - c0) / c0) * 100;
      pairs.push({
        scoreDate: scoreDay.trade_date,
        score: scoreDay.score,
        biasLabel: scoreDay.bias_label,
        forward1DReturn: fwd,
        correct: directionCorrect(scoreDay.score, fwd),
      });
    }
  }

  if (pairs.length === 0) {
    return null;
  }

  // Latest completed pair (most recent score that has a next-day outcome)
  const latest = pairs[pairs.length - 1];
  const callCorrect = latest.correct;

  // Rolling next-day hit rate over non-neutral scores
  const scoredPairs = pairs.filter((p) => p.score !== 0 && p.correct !== null);
  const windowPairs = scoredPairs.slice(-ROLLING_WINDOW);
  const correctCount = windowPairs.filter((p) => p.correct === true).length;
  const rollingHitRate =
    windowPairs.length > 0 ? (correctCount / windowPairs.length) * 100 : null;

  // Streak from the end of scored pairs
  let streak: ScorecardData['streak'] = null;
  if (callCorrect !== null) {
    let streakCount = 0;
    for (let i = scoredPairs.length - 1; i >= 0; i--) {
      if (scoredPairs[i].correct === callCorrect) streakCount += 1;
      else break;
    }
    if (streakCount > 0) {
      streak = { count: streakCount, type: callCorrect ? 'correct' : 'incorrect' };
    }
  }

  return {
    tradeDate: latest.scoreDate,
    score: latest.score,
    biasLabel: latest.biasLabel,
    spyForward1DReturn: latest.forward1DReturn,
    callCorrect,
    rollingHitRate,
    rollingWindow: windowPairs.length,
    streak,
  };
}

/* ------------------------------------------------------------------ */
/*  Post builder                                                       */
/* ------------------------------------------------------------------ */

/**
 * Builds a plain-English scorecard post for X / Bluesky.
 * Grades next-day SPY move after the published score (tradable horizon).
 */
export function buildScorecardPost(data: ScorecardData): string {
  const {
    score,
    biasLabel,
    spyForward1DReturn,
    callCorrect,
    rollingHitRate,
    rollingWindow,
    streak,
  } = data;

  const spyStr = formatSignedPercent(spyForward1DReturn);
  const scoreStr = formatSignedScore(score);
  const label = friendlyLabel(biasLabel);

  let resultVerdict: string;

  if (callCorrect === null) {
    resultVerdict = `Prior call: Neutral (${scoreStr}). Next-day $SPY moved ${spyStr}. No directional lean to grade.`;
  } else if (callCorrect) {
    resultVerdict = `Prior call: ${label} (${scoreStr}). Next-day $SPY ${spyStr}. Direction matched.`;
  } else {
    resultVerdict = `Prior call: ${label} (${scoreStr}). Next-day $SPY ${spyStr}. Missed this one.`;
  }

  let statsLine: string | null = null;

  if (rollingHitRate !== null && rollingWindow >= 5) {
    const hitRateStr = `${Math.round(rollingHitRate)}%`;
    statsLine = `Next-day hit rate: ${hitRateStr} over the last ${rollingWindow} graded sessions.`;
  }

  let streakLine: string | null = null;

  if (streak && streak.count >= 3) {
    if (streak.type === 'correct') {
      streakLine = `${streak.count}-session next-day correct streak.`;
    } else {
      streakLine = `Working through a ${streak.count}-session miss streak. The model adapts.`;
    }
  }

  // Line 4: CTA
  const ctaLine =
    'See the live daily read: https://www.macro-bias.com/today?utm_source=x&utm_campaign=scorecard';

  const lines = [resultVerdict, statsLine, streakLine, ctaLine].filter(
    (line): line is string => Boolean(line),
  );

  return lines.join('\n\n');
}
