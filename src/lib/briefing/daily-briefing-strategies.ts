import type { BiasLabel } from "@/lib/macro-bias/types";

import { DAILY_BRIEFING_SECTION_HEADERS } from "./daily-briefing-config";
import type {
  DailyBriefingNewsResult,
  DailyBriefingQuantContext,
  DailyBriefingStressTest,
  DailyBriefingTraderPlaybook,
} from "./types";

type DailyBriefingStrategyContext = {
  catalyst: string | null;
  news: DailyBriefingNewsResult;
  playbook: DailyBriefingTraderPlaybook;
  quant: DailyBriefingQuantContext;
  suggestedOverrideActive: boolean;
  stressTest: DailyBriefingStressTest;
};

export interface DailyBriefingStrategy {
  readonly kind: "news-aware" | "news-unavailable";
  buildFallbackBriefing(context: DailyBriefingStrategyContext): string;
  buildPromptContext(context: DailyBriefingStrategyContext): string;
}

function formatBiasLabel(label: BiasLabel) {
  return label.replace(/_/g, " ");
}

function getAnalogReferenceText(quant: DailyBriefingQuantContext) {
  if (!quant.analogReference) {
    return "Analog reference unavailable";
  }

  return quant.analogReference;
}

function formatConviction(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function formatCatalyst(value: string | null) {
  if (!value) {
    return "Today's news";
  }

  const normalized = value.toLowerCase();

  if (normalized.includes("iran") && normalized.includes("sanction")) {
    return "Iran escalation and fresh US sanctions";
  }

  if (normalized.includes("iran")) {
    return "Iran escalation";
  }

  if (normalized.includes("sanction")) {
    return "Fresh sanctions headlines";
  }

  return "Fresh macro headlines";
}

function summarizeFocus(groups: string[]) {
  if (groups.length === 0) {
    return "clean setups";
  }

  if (groups.length === 1) {
    return groups[0];
  }

  return `${groups[0]} and ${groups[1]}`;
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

  return `${Math.round(value)}%`;
}

function buildModelDiagnostics(context: DailyBriefingStrategyContext) {
  const leadAnalog = context.quant.analogs[0];
  const analogContext = context.quant.historicalAnalogs?.clusterAveragePlaybook;
  const intradayNet = leadAnalog?.intradayNet ?? analogContext?.intradayNet ?? null;
  const sessionRange = leadAnalog?.sessionRange ?? analogContext?.sessionRange ?? null;
  const matchConfidence = leadAnalog?.matchConfidence ?? null;
  const analogReference = context.quant.analogReference ?? "n/a";
  const overrideState = context.suggestedOverrideActive ? "ACTIVE" : "INACTIVE";

  return `Model Diagnostics: Closest Match ${analogReference} | Intraday Net ${formatSignedPercent(intradayNet)} | Session Range ${formatSignedPercent(sessionRange)} | Match Confidence ${formatMatchConfidence(matchConfidence)} | Override ${overrideState}.`;
}

function buildQuantCorner(context: DailyBriefingStrategyContext) {
  if (!context.quant.analogReference) {
    const firstSentence = "There is not enough clean history here, so the score is leaning more on the live tape than the analog set.";
    const secondSentence = context.suggestedOverrideActive
      ? "That matters even less than usual because the news changed the setup."
      : "That makes this read a little softer than usual.";

    return `${DAILY_BRIEFING_SECTION_HEADERS.quantCorner}: ${firstSentence} ${secondSentence}\n${buildModelDiagnostics(context)}`;
  }

  const analogReference = getAnalogReferenceText(context.quant);
  const firstSentence = `Closest match is ${analogReference}, a quieter session than today.`;
  const secondSentence = context.suggestedOverrideActive
    ? "On a normal day this setup would usually stay contained, but today's news makes that comparison less useful."
    : "A normal day like this would usually stay fairly contained, and that comparison still matters because the setup has not broken.";

  return `${DAILY_BRIEFING_SECTION_HEADERS.quantCorner}: ${firstSentence} ${secondSentence}\n${buildModelDiagnostics(context)}`;
}

function buildTraderPlaybook(context: DailyBriefingStrategyContext) {
  const convictionText = formatConviction(context.playbook.conviction);
  const favoredGroups = context.suggestedOverrideActive
    ? "stock-specific setups"
    : summarizeFocus(context.playbook.favoredGroups);
  const pressuredGroups = context.suggestedOverrideActive
    ? "index chasing"
    : summarizeFocus(context.playbook.pressuredGroups);
  const dayTypeText = context.suggestedOverrideActive
    ? "Neutral setup, but headlines are driving the tape."
    : context.playbook.posture;
  const bestAreaText = context.suggestedOverrideActive
    ? `${convictionText} conviction. Focus on ${favoredGroups}, not ${pressuredGroups}.`
    : `${convictionText} conviction. Focus on ${favoredGroups}, not ${pressuredGroups}.`;
  const bigRiskText = context.suggestedOverrideActive
    ? "Treating a noisy tape like a clean trend day."
    : context.playbook.invalidationSignal;

  return [
    `${DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook}:`,
    `- **Day type:** ${dayTypeText}`,
    `- **Best area:** ${bestAreaText}`,
    `- **Big risk:** ${bigRiskText}`,
  ].join("\n");
}

function buildStressTest(context: DailyBriefingStrategyContext) {
  const firstSentence = context.suggestedOverrideActive
    ? "The edge is in stock-specific setups while the index gets pushed around by headlines."
    : context.stressTest.counterThesis;
  const secondSentence = context.suggestedOverrideActive
    ? "If the market keeps reacting to every new headline, use the score as background, not signal."
    : context.stressTest.provingSignals;

  return `${DAILY_BRIEFING_SECTION_HEADERS.stressTest}: ${firstSentence} ${secondSentence}`;
}

function buildTrustCheck(context: DailyBriefingStrategyContext) {
  if (context.suggestedOverrideActive) {
    return `${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus}: Pattern broken. ${formatCatalyst(context.catalyst)} changed the setup enough that the historical pattern is not reliable right now.`;
  }

  if (context.news.status === "unavailable") {
    return `${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus}: Pattern shaky. The score still matters, but the live news read is unavailable.`;
  }

  if (context.playbook.conviction === "LOW") {
    return `${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus}: Pattern shaky. The score is near neutral, so this read needs confirmation from price action.`;
  }

  return `${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus}: Pattern intact. The news does not do enough damage to break the historical read.`;
}

function buildBottomLine(context: DailyBriefingStrategyContext) {
  const labelText = formatBiasLabel(context.quant.label);

  if (context.suggestedOverrideActive) {
    return `${DAILY_BRIEFING_SECTION_HEADERS.bottomLine}: Pattern broken this morning. ${formatCatalyst(context.catalyst)} matters more than the ${labelText.toLowerCase()} score right now.`;
  }

  if (context.news.status === "unavailable") {
    return `${DAILY_BRIEFING_SECTION_HEADERS.bottomLine}: ${labelText} score, but trust it less than usual. News is unavailable, so the setup needs more confirmation from price action.`;
  }

  return `${DAILY_BRIEFING_SECTION_HEADERS.bottomLine}: ${labelText} score, and the setup is still intact. The news is not doing enough damage to break the historical read.`;
}

class NewsAwareBriefingStrategy implements DailyBriefingStrategy {
  readonly kind = "news-aware" as const;

  buildPromptContext(context: DailyBriefingStrategyContext) {
    return [
      "Validated news is available for this briefing.",
      `Use this news summary as the news backdrop for the session: ${context.news.summary}`,
      `Playbook inputs: posture=${context.playbook.posture} | cleanRead=${context.playbook.bestExpression} | invalidation=${context.playbook.invalidationSignal}.`,
      `Challenge inputs: failureMode=${context.stressTest.primaryFailureMode} | counterCase=${context.stressTest.counterThesis} | provingSignal=${context.stressTest.provingSignals}.`,
      context.suggestedOverrideActive
        ? `There is a potential disruption: ${context.catalyst}. Assess whether this changes the picture enough to override the historical pattern, and explain your reasoning clearly.`
        : "The news does not obviously contradict the model. Assess whether the historical pattern still holds and whether today's headlines support or weaken the setup.",
    ].join(" ");
  }

  buildFallbackBriefing(context: DailyBriefingStrategyContext) {
    return [
      buildBottomLine(context),
      "",
      buildTraderPlaybook(context),
      "",
      buildStressTest(context),
      "",
      buildTrustCheck(context),
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
      `Playbook inputs: posture=${context.playbook.posture} | cleanRead=${context.playbook.bestExpression} | invalidation=${context.playbook.invalidationSignal}.`,
      `Challenge inputs: failureMode=${context.stressTest.primaryFailureMode} | counterCase=${context.stressTest.counterThesis} | provingSignal=${context.stressTest.provingSignals}.`,
      `${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus} must include this disclaimer verbatim: ${context.news.summary}`,
      "Default to is_override_active=false unless the quantitative data itself suggests the historical pattern is broken.",
    ].join(" ");
  }

  buildFallbackBriefing(context: DailyBriefingStrategyContext) {
    const catalyst = context.news.summary;

    return [
      buildBottomLine(context),
      "",
      buildTraderPlaybook(context),
      "",
      buildStressTest(context),
      "",
      buildTrustCheck(context),
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
