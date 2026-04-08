import type { BiasLabel } from "@/lib/macro-bias/types";

import type { DailyBriefingNewsResult, DailyBriefingQuantContext } from "./types";

type DailyBriefingStrategyContext = {
  catalyst: string | null;
  news: DailyBriefingNewsResult;
  quant: DailyBriefingQuantContext;
  suggestedOverrideActive: boolean;
};

export interface DailyBriefingStrategy {
  readonly kind: "news-aware" | "news-unavailable";
  buildFallbackBriefing(context: DailyBriefingStrategyContext): string;
  buildPromptContext(context: DailyBriefingStrategyContext): string;
}

type SectorRow = {
  catalyst: string;
  sector: string;
  sectorBias: "Strong" | "Neutral" | "Under Pressure";
};

function formatBiasLabel(label: BiasLabel) {
  return label.replace(/_/g, " ");
}

function getAnalogReferenceText(quant: DailyBriefingQuantContext) {
  if (!quant.analogReference) {
    return "Analog reference unavailable";
  }

  return quant.analogReference.length >= 4
    ? quant.analogReference.slice(0, 4)
    : quant.analogReference;
}

function buildSectorRows(label: BiasLabel, catalyst: string): SectorRow[] {
  switch (label) {
    case "EXTREME_RISK_ON":
    case "RISK_ON":
      return [
        { sector: "Technology", sectorBias: "Strong", catalyst },
        { sector: "Cyclicals", sectorBias: "Strong", catalyst },
        { sector: "Defensives", sectorBias: "Under Pressure", catalyst },
      ];
    case "EXTREME_RISK_OFF":
    case "RISK_OFF":
      return [
        { sector: "Technology", sectorBias: "Under Pressure", catalyst },
        { sector: "Cyclicals", sectorBias: "Under Pressure", catalyst },
        { sector: "Defensives", sectorBias: "Strong", catalyst },
      ];
    default:
      return [
        { sector: "Technology", sectorBias: "Neutral", catalyst },
        { sector: "Cyclicals", sectorBias: "Neutral", catalyst },
        { sector: "Defensives", sectorBias: "Neutral", catalyst },
      ];
  }
}

function buildPlaybookTable(label: BiasLabel, catalyst: string) {
  return [
    "Sector | Sector Bias | Driving Catalyst",
    "--- | --- | ---",
    ...buildSectorRows(label, catalyst).map(
      (row) => `${row.sector} | ${row.sectorBias} | ${row.catalyst}`,
    ),
  ].join("\n");
}

function buildQuantCorner(context: DailyBriefingStrategyContext) {
  if (!context.quant.analogReference) {
    return "QUANT CORNER: Historical analog coverage is unavailable, so the regime read is anchored to the live score, sector concentration, and current price action rather than a trusted analog year.";
  }

  const analogReference = getAnalogReferenceText(context.quant);
  const analogContext = context.quant.historicalAnalogs?.clusterAveragePlaybook;
  const driftText = analogContext?.intradayNet == null ? "n/a" : `${analogContext.intradayNet}%`;
  const rangeText = analogContext?.sessionRange == null ? "n/a" : `${analogContext.sessionRange}%`;

  return `QUANT CORNER: The closest analog reference is ${analogReference}. It ${context.suggestedOverrideActive ? "does not fully apply because the current catalyst introduces a Regime Shift against the historical sample" : "still applies because the news tape has not broken the analog structure"}. Cluster drift is ${driftText} with session range ${rangeText}.`;
}

function buildBottomLine(context: DailyBriefingStrategyContext) {
  const labelText = formatBiasLabel(context.quant.label);

  if (context.suggestedOverrideActive) {
    return `THE BOTTOM LINE: ${labelText} remains the raw quant regime with score ${context.quant.score}, but the briefing is now framed through an active macro override because ${context.catalyst ?? "fresh news flow introduces Tail Risk"}. Price Action should be read through Regime Shift risk rather than blind analog carryover.`;
  }

  if (context.news.status === "unavailable") {
    return `THE BOTTOM LINE: ${labelText} is the active quant regime with score ${context.quant.score}, and the K-NN analog set remains the primary reference point for today's pre-market brief. News Unavailable, so the framing leans on relative strength, tailwinds, headwinds, and sector concentration inside the quant sample.`;
  }

  return `THE BOTTOM LINE: ${labelText} is the active quant regime with score ${context.quant.score}, and the historical analog set remains usable for today's read-through. News flow is being treated as context rather than a catalyst strong enough to break the baseline regime.`;
}

class NewsAwareBriefingStrategy implements DailyBriefingStrategy {
  readonly kind = "news-aware" as const;

  buildPromptContext(context: DailyBriefingStrategyContext) {
    return [
      "Validated news is available for this briefing.",
      `Use this news summary as the qualitative overlay: ${context.news.summary}`,
      context.suggestedOverrideActive
        ? `A likely override catalyst is present: ${context.catalyst}. Confirm or reject that assessment explicitly.`
        : "The current news tape does not obviously invalidate the quant baseline. Confirm whether the analog regime still applies.",
    ].join(" ");
  }

  buildFallbackBriefing(context: DailyBriefingStrategyContext) {
    const catalyst = context.catalyst ?? context.news.summary;
    const macroOverrideStatus = context.suggestedOverrideActive
      ? `MACRO OVERRIDE STATUS: ACTIVE. ${catalyst} is a live Tail Risk catalyst that weakens the historical K-NN analog set.`
      : `MACRO OVERRIDE STATUS: INACTIVE. ${context.news.summary} does not invalidate the historical K-NN analogs.`;

    return [
      buildBottomLine(context),
      "",
      "THE REGIME PLAYBOOK:",
      buildPlaybookTable(context.quant.label, catalyst),
      "",
      macroOverrideStatus,
      "",
      buildQuantCorner(context),
    ].join("\n");
  }
}

class NewsUnavailableBriefingStrategy implements DailyBriefingStrategy {
  readonly kind = "news-unavailable" as const;

  buildPromptContext(context: DailyBriefingStrategyContext) {
    return [
      "The news feed is unavailable after retries.",
      "You must still produce the full report from quant context.",
      `MACRO OVERRIDE STATUS must include this disclaimer verbatim: ${context.news.summary}`,
      "Default to is_override_active=false unless the structured quant context itself clearly implies the analog set is unusable.",
    ].join(" ");
  }

  buildFallbackBriefing(context: DailyBriefingStrategyContext) {
    const catalyst = context.news.summary;

    return [
      buildBottomLine(context),
      "",
      "THE REGIME PLAYBOOK:",
      buildPlaybookTable(context.quant.label, catalyst),
      "",
      `MACRO OVERRIDE STATUS: INACTIVE. ${context.news.summary}`,
      "",
      buildQuantCorner(context),
    ].join("\n");
  }
}

export function getDailyBriefingStrategy(
  news: DailyBriefingNewsResult,
): DailyBriefingStrategy {
  return news.status === "available"
    ? new NewsAwareBriefingStrategy()
    : new NewsUnavailableBriefingStrategy();
}