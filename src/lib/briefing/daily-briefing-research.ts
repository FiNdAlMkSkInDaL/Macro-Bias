import type { BiasLabel } from "@/lib/macro-bias/types";

import type {
  DailyBriefingConviction,
  DailyBriefingNewsResult,
  DailyBriefingQuantContext,
  DailyBriefingStressTest,
  DailyBriefingTraderPlaybook,
} from "./types";

type BuildResearchBriefInput = {
  catalyst: string | null;
  news: DailyBriefingNewsResult;
  quant: DailyBriefingQuantContext;
  suggestedOverrideActive: boolean;
};

function mean(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function formatSignedPercent(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function getDirectionalMatches(quant: DailyBriefingQuantContext) {
  const scoreDirection = quant.score === 0 ? 0 : quant.score > 0 ? 1 : -1;
  const signedMatches = quant.analogs
    .map((analog) => {
      const value =
        typeof analog.intradayNet === "number"
          ? analog.intradayNet
          : analog.overnightGap;

      if (typeof value !== "number" || value === 0) {
        return null;
      }

      return value > 0 ? 1 : -1;
    })
    .filter((value): value is 1 | -1 => value !== null);

  const agreementRatio =
    scoreDirection === 0 || signedMatches.length === 0
      ? null
      : signedMatches.filter((value) => value === scoreDirection).length / signedMatches.length;

  return {
    agreementRatio,
    signedMatches,
  };
}

function getLeadMatchConfidence(quant: DailyBriefingQuantContext) {
  return quant.analogs[0]?.matchConfidence ?? null;
}

function getAverageSessionRange(quant: DailyBriefingQuantContext) {
  const values = quant.analogs
    .map((analog) => analog.sessionRange)
    .filter((value): value is number => typeof value === "number");

  return mean(values);
}

function getAverageIntradayNet(quant: DailyBriefingQuantContext) {
  const values = quant.analogs
    .map((analog) => analog.intradayNet)
    .filter((value): value is number => typeof value === "number");

  return mean(values);
}

function getConviction(
  quant: DailyBriefingQuantContext,
  news: DailyBriefingNewsResult,
  suggestedOverrideActive: boolean,
) {
  let score = 0;
  const absScore = Math.abs(quant.score);
  const matchConfidence = getLeadMatchConfidence(quant);
  const { agreementRatio } = getDirectionalMatches(quant);

  if (absScore >= 60) {
    score += 2;
  } else if (absScore >= 35) {
    score += 1;
  }

  if (typeof matchConfidence === "number") {
    if (matchConfidence >= 0.82) {
      score += 2;
    } else if (matchConfidence >= 0.68) {
      score += 1;
    } else if (matchConfidence < 0.55) {
      score -= 1;
    }
  } else {
    score -= 1;
  }

  if (typeof agreementRatio === "number") {
    if (agreementRatio >= 0.75) {
      score += 1;
    } else if (agreementRatio < 0.55) {
      score -= 1;
    }
  }

  if (news.status === "unavailable") {
    score -= 1;
  }

  if (suggestedOverrideActive) {
    score -= 2;
  }

  if (score >= 3) {
    return "HIGH" satisfies DailyBriefingConviction;
  }

  if (score >= 1) {
    return "MEDIUM" satisfies DailyBriefingConviction;
  }

  return "LOW" satisfies DailyBriefingConviction;
}

function getGroupMap(label: BiasLabel) {
  switch (label) {
    case "EXTREME_RISK_ON":
      return {
        favoredGroups: ["high-beta growth", "semiconductors", "cyclicals"],
        posture: "Bias is positive, but only if buying stays broad.",
        pressuredGroups: ["defensives", "low-beta yield proxies", "late safe-haven chasing"],
      };
    case "RISK_ON":
      return {
        favoredGroups: ["quality growth", "cyclicals", "consumer discretionary"],
        posture: "Bias is positive, but only while the stronger parts of the market keep leading.",
        pressuredGroups: ["defensives", "utilities", "panic hedges"],
      };
    case "EXTREME_RISK_OFF":
      return {
        favoredGroups: ["defensives", "duration-sensitive quality", "cash-like positioning"],
        posture: "Bias is defensive, so capital preservation matters more than upside.",
        pressuredGroups: ["high-beta growth", "cyclicals", "weak-balance-sheet laggards"],
      };
    case "RISK_OFF":
      return {
        favoredGroups: ["defensives", "quality balance sheets", "lower-vol leadership"],
        posture: "Bias is defensive, so stay selective and do not chase weak bounces.",
        pressuredGroups: ["cyclicals", "speculative growth", "crowded squeeze names"],
      };
    default:
      return {
        favoredGroups: ["relative-value setups", "idiosyncratic names", "event-driven trades"],
        posture: "Base case is chop unless the market starts to trend.",
        pressuredGroups: ["index momentum chasing", "late breakout trades", "big directional bets without confirmation"],
      };
  }
}

function buildBestExpression(
  label: BiasLabel,
  conviction: DailyBriefingConviction,
  averageSessionRange: number | null,
) {
  const highRange = typeof averageSessionRange === "number" && averageSessionRange >= 2;
  const followThrough =
    conviction === "HIGH"
      ? "if most of the market is moving with it"
      : conviction === "MEDIUM"
        ? "if leadership stays healthy"
        : "but probably only in short bursts";

  switch (label) {
    case "EXTREME_RISK_ON":
    case "RISK_ON":
      return highRange
        ? `If this keeps working, it should show up as steady upside after the open, ${followThrough}.`
        : `If this keeps working, it should look like a calm grind higher, ${followThrough}.`;
    case "EXTREME_RISK_OFF":
    case "RISK_OFF":
      return highRange
        ? `If this keeps working, weak names should stay weak and bounces should fade, ${followThrough}.`
        : `If this keeps working, quality and defensive names should hold up better while weaker risk trades lag.`;
    default:
      return highRange
        ? "If this read is right, expect back-and-forth price action rather than a clean one-way trend."
        : "If this read is right, individual names should matter more than the index.";
  }
}

function buildAvoidLine(
  label: BiasLabel,
  conviction: DailyBriefingConviction,
  averageSessionRange: number | null,
) {
  const highRange = typeof averageSessionRange === "number" && averageSessionRange >= 2;

  if (conviction === "LOW") {
    return "Avoid getting too confident early. This setup can change quickly.";
  }

  if (highRange) {
    return "Avoid chasing the first sharp move. The historical matches point to a wider and messier session than usual.";
  }

  return label === "NEUTRAL"
    ? "Avoid treating a mixed tape like a clean trend day."
    : "Avoid leaning on the score if only one corner of the market is working.";
}

function buildInvalidationSignal(label: BiasLabel, suggestedOverrideActive: boolean) {
  if (suggestedOverrideActive) {
    return "This read fails if the news keeps changing faster than the market can price it.";
  }

  switch (label) {
    case "EXTREME_RISK_ON":
    case "RISK_ON":
      return "This read is wrong if defensives lead, volatility stays high, and upside breadth narrows quickly.";
    case "EXTREME_RISK_OFF":
    case "RISK_OFF":
      return "This read is wrong if cyclicals reclaim leadership, volatility fades, and buying broadens out.";
    default:
      return "This read is wrong if the market stops chopping and starts moving one way with broad participation.";
  }
}

function buildPrimaryFailureMode(
  label: BiasLabel,
  news: DailyBriefingNewsResult,
  suggestedOverrideActive: boolean,
  agreementRatio: number | null,
) {
  if (suggestedOverrideActive) {
    return "Fresh news can make the historical matches much less useful before the market has time to settle.";
  }

  if (news.status === "unavailable") {
    return "An unseen headline can hit a model that is working without a live news read.";
  }

  if (typeof agreementRatio === "number" && agreementRatio < 0.55) {
    return "The historical matches are split, so a mixed open can turn into a whippy session instead of a clean follow-through day.";
  }

  return label === "NEUTRAL"
    ? "The biggest risk is mistaking noise for a real trend and pushing too hard in a market that wants to chop around."
    : "The biggest risk is a narrow move that looks healthy at first but never gets broad support.";
}

function buildCounterThesis(label: BiasLabel) {
  switch (label) {
    case "EXTREME_RISK_ON":
    case "RISK_ON":
      return "The counter-thesis is that this is not a true risk-on session at all, only a headline bounce that fades once breadth and cyclicals fail to confirm.";
    case "EXTREME_RISK_OFF":
    case "RISK_OFF":
      return "The counter-thesis is that the market is already through the stress pocket, and what looks defensive early turns into a squeeze back into beta.";
    default:
      return "The counter case is that this stops being a chop day and turns into a real trend, which would make a neutral read too cautious.";
  }
}

function buildProvingSignals(label: BiasLabel, suggestedOverrideActive: boolean) {
  if (suggestedOverrideActive) {
    return "The model earns trust back only when the market stops reacting to each new headline.";
  }

  switch (label) {
    case "EXTREME_RISK_ON":
    case "RISK_ON":
      return "This forecast is being proven wrong if defensives keep outperforming, volatility stays high, and breadth never broadens.";
    case "EXTREME_RISK_OFF":
    case "RISK_OFF":
      return "This forecast is being proven wrong if weak beta stops leaking, defensives lose support, and volatility fades.";
    default:
      return "This forecast is being proven wrong if the market stops chopping and starts trending in one direction with broad participation.";
  }
}

function buildFragilityFlags(
  quant: DailyBriefingQuantContext,
  news: DailyBriefingNewsResult,
  suggestedOverrideActive: boolean,
) {
  const flags: string[] = [];
  const absScore = Math.abs(quant.score);
  const matchConfidence = getLeadMatchConfidence(quant);
  const averageSessionRange = getAverageSessionRange(quant);
  const { agreementRatio } = getDirectionalMatches(quant);

  if (suggestedOverrideActive) {
    flags.push("fresh news is distorting the historical comparison set");
  }

  if (news.status === "unavailable") {
    flags.push("live news is unavailable, so headline risk is higher than normal");
  }

  if (absScore < 35) {
    flags.push("signal strength is close to the neutral zone");
  }

  if (typeof matchConfidence === "number" && matchConfidence < 0.6) {
    flags.push("top analog confidence is only moderate");
  }

  if (typeof agreementRatio === "number" && agreementRatio < 0.6) {
    flags.push("nearest analogs disagree on direction");
  }

  if (typeof averageSessionRange === "number" && averageSessionRange >= 2) {
    flags.push(`analog tape implies elevated session volatility (${formatSignedPercent(averageSessionRange)})`);
  }

  return flags.slice(0, 3);
}

export function buildResearchBrief(
  input: BuildResearchBriefInput,
): {
  playbook: DailyBriefingTraderPlaybook;
  stressTest: DailyBriefingStressTest;
} {
  const { agreementRatio } = getDirectionalMatches(input.quant);
  const conviction = getConviction(
    input.quant,
    input.news,
    input.suggestedOverrideActive,
  );
  const averageSessionRange = getAverageSessionRange(input.quant);
  const averageIntradayNet = getAverageIntradayNet(input.quant);
  const groupMap = getGroupMap(input.quant.label);

  const playbook: DailyBriefingTraderPlaybook = {
    avoid: buildAvoidLine(input.quant.label, conviction, averageSessionRange),
    bestExpression: buildBestExpression(
      input.quant.label,
      conviction,
      averageSessionRange,
    ),
    conviction,
    favoredGroups: groupMap.favoredGroups,
    invalidationSignal: buildInvalidationSignal(
      input.quant.label,
      input.suggestedOverrideActive,
    ),
    posture: groupMap.posture,
    pressuredGroups: groupMap.pressuredGroups,
  };

  const stressTest: DailyBriefingStressTest = {
    confidence: conviction,
    counterThesis: buildCounterThesis(input.quant.label),
    fragilityFlags: buildFragilityFlags(
      input.quant,
      input.news,
      input.suggestedOverrideActive,
    ),
    primaryFailureMode: buildPrimaryFailureMode(
      input.quant.label,
      input.news,
      input.suggestedOverrideActive,
      agreementRatio,
    ),
    provingSignals: buildProvingSignals(
      input.quant.label,
      input.suggestedOverrideActive,
    ),
  };

  return {
    playbook,
    stressTest,
  };
}
