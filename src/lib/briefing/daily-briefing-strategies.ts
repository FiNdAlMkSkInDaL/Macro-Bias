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
    const firstSentence = "There is not enough clean history here, so the analog comparison is weak today.";
    const secondSentence = context.suggestedOverrideActive
      ? "That matters even less than usual because the news changed the setup."
      : "That makes the score usable, but less sturdy than a clean analog day.";

    return `${DAILY_BRIEFING_SECTION_HEADERS.quantCorner}: ${firstSentence} ${secondSentence}\n${buildModelDiagnostics(context)}`;
  }

  const analogReference = getAnalogReferenceText(context.quant);
  const firstSentence = `Closest match is ${analogReference}, which was a quieter session than this one.`;
  const secondSentence = context.suggestedOverrideActive
    ? "On a normal day this setup would usually stay contained, but today's news makes that comparison more of a baseline than a guide."
    : "On a normal day this setup would usually stay fairly contained, and that comparison still deserves weight because the pattern is still intact.";

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
  const setupText = context.suggestedOverrideActive
    ? "Headline-driven session, so the index read is unstable."
    : context.playbook.posture;
  const focusText = context.suggestedOverrideActive
    ? `${convictionText} conviction. Focus on ${favoredGroups}, not ${pressuredGroups}.`
    : `${convictionText} conviction. Focus on ${favoredGroups}, not ${pressuredGroups}.`;
  const riskText = context.suggestedOverrideActive
    ? "Treating a reactive tape like a clean trend day."
    : context.playbook.invalidationSignal;

  return [
    `${DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook}:`,
    `- **Setup:** ${setupText}`,
    `- **Focus:** ${focusText}`,
    `- **Risk:** ${riskText}`,
  ].join("\n");
}

function buildStressTest(context: DailyBriefingStrategyContext) {
  const scoreText = `${formatBiasLabel(context.quant.label)} (${context.quant.score > 0 ? "+" : ""}${context.quant.score.toFixed(0)})`;
  const sentence = context.suggestedOverrideActive
    ? `Base model score: ${scoreText}, but it is de-emphasized until the market stops trading on fresh headlines.`
    : `Base model score: ${scoreText}, and it still deserves weight because the setup has not broken.`;

  return `${DAILY_BRIEFING_SECTION_HEADERS.stressTest}: ${sentence}`;
}

function buildTrustCheck(context: DailyBriefingStrategyContext) {
  if (context.suggestedOverrideActive) {
    return `${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus}: ${formatCatalyst(context.catalyst)} is moving the tape more than the normal setup this morning. If the market keeps repricing every new headline, the pattern is still broken.`;
  }

  if (context.news.status === "unavailable") {
    return `${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus}: The score still matters, but the live news read is unavailable. Trust improves if price action and breadth stay aligned with the base read after the open.`;
  }

  if (context.playbook.conviction === "LOW") {
    return `${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus}: The score is near neutral, so the historical read is not strong on its own. Trust improves if the tape starts confirming the same direction instead of flipping around it.`;
  }

  return `${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus}: The news does not do enough damage to break the historical read today. If leadership and breadth keep lining up with the score, confidence should hold.`;
}

function buildBottomLine(context: DailyBriefingStrategyContext) {
  if (context.suggestedOverrideActive) {
    return `${DAILY_BRIEFING_SECTION_HEADERS.bottomLine}: Override active: headline-driven session, so the score is background context for now.`;
  }

  if (context.news.status === "unavailable") {
    return `${DAILY_BRIEFING_SECTION_HEADERS.bottomLine}: Pattern shaky: the score is usable, but the missing news read lowers confidence.`;
  }

  if (context.playbook.conviction === "LOW") {
    return `${DAILY_BRIEFING_SECTION_HEADERS.bottomLine}: Pattern shaky: the score is usable, but it still needs confirmation from the tape.`;
  }

  return `${DAILY_BRIEFING_SECTION_HEADERS.bottomLine}: Pattern intact: the score deserves real weight today.`;
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
