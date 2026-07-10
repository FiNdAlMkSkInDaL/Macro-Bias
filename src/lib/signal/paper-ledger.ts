import {
  CRYPTO_STRATEGY_RULES,
  STOCKS_STRATEGY_RULES,
  positionFromSignal,
} from "./strategy";
import type { StrategyRules, TradableSignal } from "./types";

export type PaperPosition = "LONG" | "SHORT" | "CASH";

export type PublishedScoreDay = {
  tradeDate: string;
  score: number;
  /** Optional persisted tradable signal from engine_inputs. */
  signal?: TradableSignal | null;
  modelVersion?: string | null;
};

export type AssetSessionDay = {
  tradeDate: string;
  /** Close-to-close % change for this session (already in percent units). */
  changePercent: number;
  close?: number;
};

export type PaperLedgerDay = {
  tradeDate: string;
  /** Score that was live *before* this session (lagged). */
  laggedScore: number | null;
  position: PaperPosition;
  size: number;
  assetReturnPct: number;
  strategyReturnPct: number;
  assetEquity: number;
  strategyEquity: number;
  /** Size-scaled strategy equity (partial exposure when size < 1). */
  sizeScaledEquity: number;
  sizeScaledReturnPct: number;
  frictionApplied: boolean;
};

export type PaperLedgerSummary = {
  days: PaperLedgerDay[];
  totalSessions: number;
  dateRange: { from: string; to: string } | null;
  strategyReturn: number | null;
  sizeScaledReturn: number | null;
  assetReturn: number | null;
  maxDrawdownStrategy: number | null;
  maxDrawdownSizeScaled: number | null;
  maxDrawdownAsset: number | null;
  longDays: number;
  shortDays: number;
  cashDays: number;
  flipCount: number;
  forward1DHitRate: number | null;
  /** Days where the lagged published signal was NO_TRADE. */
  noTradeSignalDays: number;
  source: "published_scores";
};

export type BuildPaperLedgerOptions = {
  rules: StrategyRules;
  mode?: "long_short" | "long_only";
};

function emptySummary(): PaperLedgerSummary {
  return {
    days: [],
    totalSessions: 0,
    dateRange: null,
    strategyReturn: null,
    sizeScaledReturn: null,
    assetReturn: null,
    maxDrawdownStrategy: null,
    maxDrawdownSizeScaled: null,
    maxDrawdownAsset: null,
    longDays: 0,
    shortDays: 0,
    cashDays: 0,
    flipCount: 0,
    forward1DHitRate: null,
    noTradeSignalDays: 0,
    source: "published_scores",
  };
}

function resolvePositionAndSize(
  prior: PublishedScoreDay | undefined,
  rules: StrategyRules,
  mode: "long_short" | "long_only",
): { position: PaperPosition; size: number } {
  if (!prior) {
    return { position: "CASH", size: 0 };
  }

  let position = positionFromSignal(prior.signal, prior.score, rules);

  if (mode === "long_only" && position === "SHORT") {
    position = "CASH";
  }

  let size = 0;
  if (position === "LONG" || position === "SHORT") {
    if (prior.signal && !prior.signal.noTrade && prior.signal.size > 0) {
      size = prior.signal.size;
    } else {
      // Legacy published scores: full unit when threshold clears.
      size = 1;
    }
  }

  return { position, size };
}

/**
 * Build a paper-trading equity curve from *published* daily scores only.
 *
 * Timing (no lookahead):
 * - Score/signal on trade date T is assumed available by the next session open.
 * - Position for session S uses the latest published score with tradeDate < S.
 * - Session return is the asset close-to-close move on S.
 */
export function buildPaperLedger(
  publishedScores: PublishedScoreDay[],
  assetSessions: AssetSessionDay[],
  options: BuildPaperLedgerOptions,
): PaperLedgerSummary {
  if (publishedScores.length === 0 || assetSessions.length === 0) {
    return emptySummary();
  }

  const rules = options.rules;
  const mode = options.mode ?? "long_short";
  const friction = rules.frictionBps / 10_000;

  const orderedScores = [...publishedScores].sort((a, b) =>
    a.tradeDate.localeCompare(b.tradeDate),
  );
  const orderedAsset = [...assetSessions].sort((a, b) =>
    a.tradeDate.localeCompare(b.tradeDate),
  );

  const firstScoreDate = orderedScores[0].tradeDate;
  const tradableSessions = orderedAsset.filter((d) => d.tradeDate > firstScoreDate);

  const days: PaperLedgerDay[] = [];
  let assetEquity = 100;
  let strategyEquity = 100;
  let sizeScaledEquity = 100;
  let prevPosition: PaperPosition = "CASH";
  let peakAsset = 100;
  let peakStrat = 100;
  let peakSized = 100;
  let maxDdAsset = 0;
  let maxDdStrat = 0;
  let maxDdSized = 0;
  let longDays = 0;
  let shortDays = 0;
  let cashDays = 0;
  let flipCount = 0;
  let forwardCorrect = 0;
  let forwardTotal = 0;
  let noTradeSignalDays = 0;

  // Two-pointer: latest score strictly before each session
  let scoreIdx = -1;

  for (const session of tradableSessions) {
    while (
      scoreIdx + 1 < orderedScores.length &&
      orderedScores[scoreIdx + 1].tradeDate < session.tradeDate
    ) {
      scoreIdx += 1;
    }

    const lagged = scoreIdx >= 0 ? orderedScores[scoreIdx] : undefined;
    const { position, size } = resolvePositionAndSize(lagged, rules, mode);

    if (lagged?.signal?.noTrade) {
      noTradeSignalDays += 1;
    }

    const assetReturn = session.changePercent / 100;
    assetEquity *= 1 + assetReturn;

    let frictionApplied = false;
    if (position !== prevPosition) {
      strategyEquity *= 1 - friction;
      sizeScaledEquity *= 1 - friction;
      frictionApplied = true;
      flipCount += 1;
    }

    let strategyReturnPct = 0;
    let sizeScaledReturnPct = 0;

    if (position === "LONG") {
      strategyEquity *= 1 + assetReturn;
      sizeScaledEquity *= 1 + assetReturn * size;
      strategyReturnPct = session.changePercent;
      sizeScaledReturnPct = session.changePercent * size;
      longDays += 1;
    } else if (position === "SHORT") {
      strategyEquity *= 1 - assetReturn;
      sizeScaledEquity *= 1 - assetReturn * size;
      strategyReturnPct = -session.changePercent;
      sizeScaledReturnPct = -session.changePercent * size;
      shortDays += 1;
    } else {
      cashDays += 1;
    }

    if (lagged && lagged.score !== 0) {
      forwardTotal += 1;
      const correct =
        lagged.score > 0 ? session.changePercent >= 0 : session.changePercent <= 0;
      if (correct) forwardCorrect += 1;
    }

    if (assetEquity > peakAsset) peakAsset = assetEquity;
    if (strategyEquity > peakStrat) peakStrat = strategyEquity;
    if (sizeScaledEquity > peakSized) peakSized = sizeScaledEquity;
    const ddA = (assetEquity - peakAsset) / peakAsset;
    const ddS = (strategyEquity - peakStrat) / peakStrat;
    const ddZ = (sizeScaledEquity - peakSized) / peakSized;
    if (ddA < maxDdAsset) maxDdAsset = ddA;
    if (ddS < maxDdStrat) maxDdStrat = ddS;
    if (ddZ < maxDdSized) maxDdSized = ddZ;

    days.push({
      tradeDate: session.tradeDate,
      laggedScore: lagged?.score ?? null,
      position,
      size,
      assetReturnPct: session.changePercent,
      strategyReturnPct,
      assetEquity: Number(assetEquity.toFixed(4)),
      strategyEquity: Number(strategyEquity.toFixed(4)),
      sizeScaledEquity: Number(sizeScaledEquity.toFixed(4)),
      sizeScaledReturnPct,
      frictionApplied,
    });

    prevPosition = position;
  }

  if (days.length === 0) {
    return emptySummary();
  }

  return {
    days,
    totalSessions: days.length,
    dateRange: {
      from: days[0].tradeDate,
      to: days[days.length - 1].tradeDate,
    },
    strategyReturn: strategyEquity - 100,
    sizeScaledReturn: sizeScaledEquity - 100,
    assetReturn: assetEquity - 100,
    maxDrawdownStrategy: maxDdStrat * 100,
    maxDrawdownSizeScaled: maxDdSized * 100,
    maxDrawdownAsset: maxDdAsset * 100,
    longDays,
    shortDays,
    cashDays,
    flipCount,
    forward1DHitRate: forwardTotal > 0 ? (forwardCorrect / forwardTotal) * 100 : null,
    noTradeSignalDays,
    source: "published_scores",
  };
}

export function stocksPaperLedgerOptions(): BuildPaperLedgerOptions {
  return { rules: STOCKS_STRATEGY_RULES, mode: "long_short" };
}

export function cryptoPaperLedgerOptions(
  mode: "long_short" | "long_only" = "long_only",
): BuildPaperLedgerOptions {
  return { rules: CRYPTO_STRATEGY_RULES, mode };
}
