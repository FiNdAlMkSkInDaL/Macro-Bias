import type { ReliabilityGrade, StrategyRules, TradableSignal } from "./types";
import { positionFromSignal, STOCKS_STRATEGY_RULES } from "./strategy";

export type PublishedScoreForEval = {
  tradeDate: string;
  score: number;
  signal?: TradableSignal | null;
};

export type SessionReturnForEval = {
  tradeDate: string;
  /** Close-to-close % return for this session. */
  changePercent: number;
};

export type GradedSession = {
  /** Session that realized the return (T+1 relative to the score). */
  sessionDate: string;
  /** Score date that was live before this session. */
  scoreDate: string;
  score: number;
  position: "LONG" | "SHORT" | "CASH";
  reliability: ReliabilityGrade | "LEGACY";
  size: number;
  sessionReturnPct: number;
  strategyReturnPct: number;
  directionCorrect: boolean | null;
};

export type ReliabilityBucketStats = {
  reliability: ReliabilityGrade | "LEGACY";
  sessions: number;
  hitRate: number | null;
  avgSessionReturnWhenLong: number | null;
  avgSessionReturnWhenShort: number | null;
  avgStrategyReturn: number | null;
};

export type LiveScoreEvaluation = {
  gradedSessions: GradedSession[];
  totalGraded: number;
  dateRange: { from: string; to: string } | null;
  /** Next-session direction hit rate among non-cash positions with non-zero score. */
  forwardHitRate: number | null;
  avgReturnLong: number | null;
  avgReturnShort: number | null;
  avgReturnCash: number | null;
  edgeSpread: number | null;
  reliabilityBuckets: ReliabilityBucketStats[];
  /** Last graded session (most recent complete next-day outcome). */
  latest: GradedSession | null;
  source: "published_scores";
};

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolveReliability(signal: TradableSignal | null | undefined): ReliabilityGrade | "LEGACY" {
  if (!signal) return "LEGACY";
  return signal.reliability;
}

/**
 * Grade published scores against the *next* asset session only.
 * Score on date S applies to the first session with tradeDate > S.
 */
export function evaluatePublishedScores(
  scores: PublishedScoreForEval[],
  sessions: SessionReturnForEval[],
  rules: StrategyRules = STOCKS_STRATEGY_RULES,
  mode: "long_short" | "long_only" = "long_short",
): LiveScoreEvaluation {
  if (scores.length === 0 || sessions.length === 0) {
    return {
      gradedSessions: [],
      totalGraded: 0,
      dateRange: null,
      forwardHitRate: null,
      avgReturnLong: null,
      avgReturnShort: null,
      avgReturnCash: null,
      edgeSpread: null,
      reliabilityBuckets: [],
      latest: null,
      source: "published_scores",
    };
  }

  const orderedScores = [...scores].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const orderedSessions = [...sessions].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  const graded: GradedSession[] = [];
  let scoreIdx = -1;

  for (const session of orderedSessions) {
    while (
      scoreIdx + 1 < orderedScores.length &&
      orderedScores[scoreIdx + 1].tradeDate < session.tradeDate
    ) {
      scoreIdx += 1;
    }

    if (scoreIdx < 0) continue;

    const prior = orderedScores[scoreIdx];
    if (prior.tradeDate >= session.tradeDate) continue;

    let position = positionFromSignal(prior.signal, prior.score, rules);
    if (mode === "long_only" && position === "SHORT") {
      position = "CASH";
    }
    const size =
      position === "CASH"
        ? 0
        : prior.signal && !prior.signal.noTrade && prior.signal.size > 0
          ? prior.signal.size
          : 1;

    let strategyReturnPct = 0;
    if (position === "LONG") strategyReturnPct = session.changePercent;
    else if (position === "SHORT") strategyReturnPct = -session.changePercent;

    let directionCorrect: boolean | null = null;
    if (position === "LONG") {
      directionCorrect = session.changePercent >= 0;
    } else if (position === "SHORT") {
      directionCorrect = session.changePercent <= 0;
    }

    graded.push({
      sessionDate: session.tradeDate,
      scoreDate: prior.tradeDate,
      score: prior.score,
      position,
      reliability: resolveReliability(prior.signal),
      size,
      sessionReturnPct: session.changePercent,
      strategyReturnPct,
      directionCorrect,
    });
  }

  const directional = graded.filter((g) => g.position !== "CASH" && g.directionCorrect !== null);
  const hitRate =
    directional.length > 0
      ? (directional.filter((g) => g.directionCorrect === true).length / directional.length) * 100
      : null;

  const longSessions = graded.filter((g) => g.position === "LONG");
  const shortSessions = graded.filter((g) => g.position === "SHORT");
  const cashSessions = graded.filter((g) => g.position === "CASH");

  const avgReturnLong = avg(longSessions.map((g) => g.sessionReturnPct));
  const avgReturnShort = avg(shortSessions.map((g) => g.sessionReturnPct));
  const avgReturnCash = avg(cashSessions.map((g) => g.sessionReturnPct));

  const grades: Array<ReliabilityGrade | "LEGACY"> = ["A", "B", "C", "D", "F", "LEGACY"];
  const reliabilityBuckets: ReliabilityBucketStats[] = grades.map((reliability) => {
    const inBucket = graded.filter((g) => g.reliability === reliability);
    const dir = inBucket.filter((g) => g.position !== "CASH" && g.directionCorrect !== null);
    const longs = inBucket.filter((g) => g.position === "LONG");
    const shorts = inBucket.filter((g) => g.position === "SHORT");

    return {
      reliability,
      sessions: inBucket.length,
      hitRate:
        dir.length > 0
          ? (dir.filter((g) => g.directionCorrect === true).length / dir.length) * 100
          : null,
      avgSessionReturnWhenLong: avg(longs.map((g) => g.sessionReturnPct)),
      avgSessionReturnWhenShort: avg(shorts.map((g) => g.sessionReturnPct)),
      avgStrategyReturn: avg(inBucket.map((g) => g.strategyReturnPct)),
    };
  }).filter((bucket) => bucket.sessions > 0);

  return {
    gradedSessions: graded,
    totalGraded: graded.length,
    dateRange:
      graded.length > 0
        ? { from: graded[0].sessionDate, to: graded[graded.length - 1].sessionDate }
        : null,
    forwardHitRate: hitRate,
    avgReturnLong,
    avgReturnShort,
    avgReturnCash,
    edgeSpread:
      avgReturnLong !== null && avgReturnShort !== null
        ? avgReturnLong - avgReturnShort
        : null,
    reliabilityBuckets,
    latest: graded.length > 0 ? graded[graded.length - 1] : null,
    source: "published_scores",
  };
}
