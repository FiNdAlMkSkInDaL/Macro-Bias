import type { BiasLabel } from "@/lib/macro-bias/types";

import { DAILY_BRIEFING_SECTION_HEADERS } from "./daily-briefing-config";
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

const PLAYBOOK_BULLET_SEPARATOR = "--";

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

function buildPlaybookList(label: BiasLabel, catalyst: string) {
  return buildSectorRows(label, catalyst)
    .map(
      (row) =>
        `- **${row.sector}**: ${row.sectorBias} ${PLAYBOOK_BULLET_SEPARATOR} ${row.catalyst}`,
    )
    .join("\n");
}

function getPortfolioPostureLine() {
  return "The pattern is unreliable right now. Wait for things to settle before trusting the historical playbook again.";
}

function formatSignedPercent(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatMatchConfidence(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  return value.toFixed(2);
}

function buildModelDiagnostics(context: DailyBriefingStrategyContext) {
  const leadAnalog = context.quant.analogs[0];
  const analogContext = context.quant.historicalAnalogs?.clusterAveragePlaybook;
  const intradayNet = leadAnalog?.intradayNet ?? analogContext?.intradayNet ?? null;
  const sessionRange = leadAnalog?.sessionRange ?? analogContext?.sessionRange ?? null;
  const matchConfidence = leadAnalog?.matchConfidence ?? null;

  return `Model Diagnostics: Intraday Net ${formatSignedPercent(intradayNet)} | Session Range ${formatSignedPercent(sessionRange)} | Match Confidence ${formatMatchConfidence(matchConfidence)}.`;
}

function buildQuantCorner(context: DailyBriefingStrategyContext) {
  if (!context.quant.analogReference) {
    const actionabilitySuffix = context.suggestedOverrideActive
      ? ` ${getPortfolioPostureLine()}`
      : "";

    return `${DAILY_BRIEFING_SECTION_HEADERS.quantCorner}: Not enough historical matches today, so the score is leaning on the live data and sector readings instead. ${buildModelDiagnostics(context)} ${actionabilitySuffix}`.trim();
  }

  const analogReference = getAnalogReferenceText(context.quant);

  const actionabilitySuffix = context.suggestedOverrideActive
    ? ` ${getPortfolioPostureLine()}`
    : "";

  return `${DAILY_BRIEFING_SECTION_HEADERS.quantCorner}: Closest analog: ${analogReference}. ${context.suggestedOverrideActive ? "Today's news has broken the historical pattern enough that this match is less trustworthy than usual." : "This historical match still lines up with what we are seeing today, so the pattern data remains useful."} ${buildModelDiagnostics(context)}${actionabilitySuffix ? ` ${actionabilitySuffix}` : ""}`;
}

function buildBottomLine(context: DailyBriefingStrategyContext) {
  const labelText = formatBiasLabel(context.quant.label);

  if (context.suggestedOverrideActive) {
    return `${DAILY_BRIEFING_SECTION_HEADERS.bottomLine}: The model reads ${labelText} with a score of ${context.quant.score}, but ${context.catalyst ?? "breaking news is shaking things up"}. That makes the historical pattern less reliable today, so the numbers deserve extra skepticism until things calm down.`;
  }

  if (context.news.status === "unavailable") {
    return `${DAILY_BRIEFING_SECTION_HEADERS.bottomLine}: The model reads ${labelText} with a score of ${context.quant.score}. News is unavailable today, so the signal is relying on sector data, relative strength, and the historical pattern rather than any specific headline.`;
  }

  return `${DAILY_BRIEFING_SECTION_HEADERS.bottomLine}: The model reads ${labelText} with a score of ${context.quant.score}, and the historical pattern still matches what we are seeing in the market. The news is confirming the score rather than contradicting it, which makes the setup more trustworthy than usual.`;
}

class NewsAwareBriefingStrategy implements DailyBriefingStrategy {
  readonly kind = "news-aware" as const;

  buildPromptContext(context: DailyBriefingStrategyContext) {
    return [
      "Validated news is available for this briefing.",
      `Use this news summary as the institutional-flow overlay: ${context.news.summary}`,
      context.suggestedOverrideActive
        ? `There is a potential disruption: ${context.catalyst}. Assess whether this changes the picture enough to override the historical pattern, and explain your reasoning clearly.`
        : "The news does not obviously contradict the model. Assess whether the historical pattern still holds and whether today's headlines support or weaken the setup.",
    ].join(" ");
  }

  buildFallbackBriefing(context: DailyBriefingStrategyContext) {
    const catalyst = context.catalyst ?? context.news.summary;
    const macroOverrideStatus = context.suggestedOverrideActive
      ? `${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus}: ACTIVE. ${catalyst} is a big enough deal to make the historical pattern unreliable today. The model's read deserves extra caution.`
      : `${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus}: INACTIVE. ${context.news.summary} is not enough to break the historical pattern the model is following.`;

    return [
      buildBottomLine(context),
      "",
      `${DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook}:`,
      buildPlaybookList(context.quant.label, catalyst),
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
      "Still produce the full report using the quantitative data and model diagnostics.",
      `${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus} must include this disclaimer verbatim: ${context.news.summary}`,
      "Default to is_override_active=false unless the quantitative data itself suggests the historical pattern is broken.",
    ].join(" ");
  }

  buildFallbackBriefing(context: DailyBriefingStrategyContext) {
    const catalyst = context.news.summary;

    return [
      buildBottomLine(context),
      "",
      `${DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook}:`,
      buildPlaybookList(context.quant.label, catalyst),
      "",
      `${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus}: INACTIVE. ${context.news.summary}`,
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