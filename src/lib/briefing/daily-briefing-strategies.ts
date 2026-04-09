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

const PLAYBOOK_BULLET_SEPARATOR = "\u2014";

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
  return "Treat the tape as a retail trap until volatility normalizes and price action confirms the model's edge again.";
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

    return `${DAILY_BRIEFING_SECTION_HEADERS.quantCorner}: The K-NN archive is thin today, so the live score and sector concentration are carrying the algorithmic edge. ${buildModelDiagnostics(context)} ${actionabilitySuffix}`.trim();
  }

  const analogReference = getAnalogReferenceText(context.quant);

  const actionabilitySuffix = context.suggestedOverrideActive
    ? ` ${getPortfolioPostureLine()}`
    : "";

  return `${DAILY_BRIEFING_SECTION_HEADERS.quantCorner}: Closest analog: ${analogReference}. ${context.suggestedOverrideActive ? "The model is flagging that institutional flow has broken the historical script, which raises retail-trap risk even though the analog still matters as a reference." : "The analog still maps cleanly enough to today's tape to suggest the algorithmic edge is intact while institutional flow remains orderly."} ${buildModelDiagnostics(context)}${actionabilitySuffix ? ` ${actionabilitySuffix}` : ""}`;
}

function buildBottomLine(context: DailyBriefingStrategyContext) {
  const labelText = formatBiasLabel(context.quant.label);

  if (context.suggestedOverrideActive) {
    return `${DAILY_BRIEFING_SECTION_HEADERS.bottomLine}: ${labelText} is still the raw algo bias with score ${context.quant.score}, but the black-box model is warning that ${context.catalyst ?? "fresh news flow is distorting institutional flow"}. That turns the open into a higher-risk retail trap regime, so the edge only comes back once price action re-confirms the setup.`;
  }

  if (context.news.status === "unavailable") {
    return `${DAILY_BRIEFING_SECTION_HEADERS.bottomLine}: ${labelText} is the live algo bias with score ${context.quant.score}, and the model still sees a usable algorithmic edge in the K-NN stack. News is unavailable, so the signal is leaning harder on sector concentration, relative strength, and model diagnostics instead of any one headline catalyst.`;
  }

  return `${DAILY_BRIEFING_SECTION_HEADERS.bottomLine}: ${labelText} is the live algo bias with score ${context.quant.score}, and the historical analog set is still producing an actionable algorithmic edge. Institutional flow is acting as confirmation rather than disruption, which lowers the odds of a crowded retail trap and keeps asymmetric opportunities alive.`;
}

class NewsAwareBriefingStrategy implements DailyBriefingStrategy {
  readonly kind = "news-aware" as const;

  buildPromptContext(context: DailyBriefingStrategyContext) {
    return [
      "Validated news is available for this briefing.",
      `Use this news summary as the institutional-flow overlay: ${context.news.summary}`,
      context.suggestedOverrideActive
        ? `A likely retail-trap catalyst is present: ${context.catalyst}. Confirm or reject that risk explicitly and explain whether the black-box edge is breaking.`
        : "The current news tape does not obviously invalidate the algo baseline. Confirm whether the K-NN edge still holds and whether institutional flow is helping or fading the setup.",
    ].join(" ");
  }

  buildFallbackBriefing(context: DailyBriefingStrategyContext) {
    const catalyst = context.catalyst ?? context.news.summary;
    const macroOverrideStatus = context.suggestedOverrideActive
      ? `${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus}: ACTIVE. ${catalyst} is disrupting institutional flow enough to weaken the historical K-NN script and increase retail-trap risk.`
      : `${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus}: INACTIVE. ${context.news.summary} is not strong enough to break the model's baseline analog edge.`;

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
      "You must still produce the full report from quant context and model diagnostics.",
      `${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus} must include this disclaimer verbatim: ${context.news.summary}`,
      "Default to is_override_active=false unless the structured quant context itself clearly implies the analog set is unusable or the setup looks like a retail trap.",
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