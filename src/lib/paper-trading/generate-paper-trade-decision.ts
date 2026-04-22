import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { withExponentialBackoff } from "@/lib/briefing/retry";
import { getRequiredServerEnv } from "@/lib/server-env";

import {
  normalizePaperTradingQuantity,
  normalizePaperTradingWeight,
  PAPER_TRADING_DECISION_MAX_TOKENS,
  PAPER_TRADING_DECISION_RESPONSE_SCHEMA,
  PAPER_TRADING_LLM_RETRY_OPTIONS,
  PAPER_TRADING_MAX_REASONING_SUMMARY_LENGTH,
  PAPER_TRADING_MAX_RISK_FLAGS,
  PAPER_TRADING_MODEL,
  PAPER_TRADING_PROMPT_VERSION,
  PAPER_TRADING_SYSTEM_PROMPT,
  PAPER_TRADING_TARGET_WEIGHT_TOLERANCE,
} from "./paper-trading-config";
import type {
  GeneratePaperTradeDecisionResult,
  PaperTradingContextReady,
  PaperTradingDecision,
  PaperTradingDecisionPayload,
  PaperTradingPromptPayload,
} from "./types";

const RESPONSE_KEYS = [
  "decision",
  "target_spy_weight",
  "target_cash_weight",
  "conviction_score",
  "reasoning_summary",
  "risk_flags",
] as const;

class PaperTradeDecisionValidationError extends Error {
  riskFlag: string;

  constructor(riskFlag: string, message: string) {
    super(message);
    this.name = "PaperTradeDecisionValidationError";
    this.riskFlag = riskFlag;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractTextResponse(contentBlocks: Array<{ type: string; text?: string }>) {
  return contentBlocks
    .filter((contentBlock): contentBlock is { type: "text"; text: string } => {
      return contentBlock.type === "text" && typeof contentBlock.text === "string";
    })
    .map((contentBlock) => contentBlock.text)
    .join("")
    .trim();
}

function tryParseJson(rawResponse: string) {
  try {
    return JSON.parse(rawResponse);
  } catch {
    return null;
  }
}

function extractEmbeddedJson(rawResponse: string) {
  const firstBraceIndex = rawResponse.indexOf("{");
  const lastBraceIndex = rawResponse.lastIndexOf("}");

  if (firstBraceIndex === -1 || lastBraceIndex === -1 || lastBraceIndex <= firstBraceIndex) {
    return null;
  }

  return rawResponse.slice(firstBraceIndex, lastBraceIndex + 1);
}

function getRequiredString(value: unknown, fieldName: string) {
  if (typeof value !== "string") {
    throw new PaperTradeDecisionValidationError(
      "fallback_invalid_schema",
      `Expected ${fieldName} to be a string.`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new PaperTradeDecisionValidationError(
      "fallback_invalid_schema",
      `Expected ${fieldName} to be a non-empty string.`,
    );
  }

  return normalized;
}

function getRequiredNumber(value: unknown, fieldName: string) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throw new PaperTradeDecisionValidationError(
    "fallback_invalid_schema",
    `Expected ${fieldName} to be a finite number.`,
  );
}

function getRequiredInteger(value: unknown, fieldName: string) {
  const numericValue = getRequiredNumber(value, fieldName);

  if (!Number.isInteger(numericValue)) {
    throw new PaperTradeDecisionValidationError(
      "fallback_invalid_schema",
      `Expected ${fieldName} to be an integer.`,
    );
  }

  return numericValue;
}

function normalizeRiskFlag(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function dedupeRiskFlags(flags: string[]) {
  const normalizedFlags: string[] = [];
  const seen = new Set<string>();

  for (const flag of flags) {
    const normalizedFlag = normalizeRiskFlag(flag);

    if (!normalizedFlag || seen.has(normalizedFlag)) {
      continue;
    }

    seen.add(normalizedFlag);
    normalizedFlags.push(normalizedFlag);
  }

  return normalizedFlags.slice(0, PAPER_TRADING_MAX_RISK_FLAGS);
}

function getCurrentPortfolioWeights(context: PaperTradingContextReady) {
  if (context.portfolioState.totalEquity <= 0) {
    return {
      targetCashWeight: 1,
      targetSpyWeight: 0,
    };
  }

  const targetSpyWeight = normalizePaperTradingWeight(
    context.portfolioState.positionMarketValue / context.portfolioState.totalEquity,
  );
  const targetCashWeight = normalizePaperTradingWeight(1 - targetSpyWeight);

  return {
    targetCashWeight,
    targetSpyWeight,
  };
}

function getContextRiskFlags(context: PaperTradingContextReady) {
  const riskFlags: string[] = [];

  if (context.briefing.isOverrideActive) {
    riskFlags.push("macro_override_active");
  }

  if (context.briefing.newsStatus === "unavailable") {
    riskFlags.push("briefing_news_unavailable");
  }

  return riskFlags;
}

function buildFallbackDecision(
  context: PaperTradingContextReady,
  reasonMessage: string,
  fallbackRiskFlags: string[],
  rawResponse: string | null,
): GeneratePaperTradeDecisionResult {
  const currentWeights = getCurrentPortfolioWeights(context);
  const riskFlags = dedupeRiskFlags([
    "fallback_decision_used",
    ...getContextRiskFlags(context),
    ...fallbackRiskFlags,
  ]);
  const reasoningSummary = [
    `Defaulted to HOLD because ${reasonMessage}.`,
    `Keeping SPY at ${(currentWeights.targetSpyWeight * 100).toFixed(1)}% and cash at ${(currentWeights.targetCashWeight * 100).toFixed(1)}%.`,
  ].join(" ");

  return {
    decision: {
      decision: "HOLD",
      targetSpyWeight: currentWeights.targetSpyWeight,
      targetCashWeight: currentWeights.targetCashWeight,
      convictionScore: 0,
      reasoningSummary,
      riskFlags,
    },
    generationMethod: "fallback",
    sourceModel: "deterministic-fallback",
    promptVersion: PAPER_TRADING_PROMPT_VERSION,
    rawResponse,
    warnings: [reasonMessage],
  };
}

function buildPromptPayload(promptPayload: PaperTradingPromptPayload) {
  return [
    "Make one simulated paper-trading allocation decision from this JSON.",
    "Return strict JSON only that matches the requested schema.",
    JSON.stringify(promptPayload, null, 2),
  ].join("\n\n");
}

function parseRawDecisionResponse(rawResponse: string) {
  const directParse = tryParseJson(rawResponse);

  if (directParse !== null) {
    return directParse;
  }

  const embeddedJson = extractEmbeddedJson(rawResponse);

  if (!embeddedJson) {
    throw new PaperTradeDecisionValidationError(
      "fallback_invalid_json",
      "Anthropic paper trade decision did not return valid JSON.",
    );
  }

  const embeddedParse = tryParseJson(embeddedJson);

  if (embeddedParse === null) {
    throw new PaperTradeDecisionValidationError(
      "fallback_invalid_json",
      "Anthropic paper trade decision contained malformed embedded JSON.",
    );
  }

  return embeddedParse;
}

function validateDecisionSemantics(
  context: PaperTradingContextReady,
  decision: PaperTradingDecision,
  targetSpyWeight: number,
  targetCashWeight: number,
) {
  const currentWeights = getCurrentPortfolioWeights(context);
  const spyWeightDelta = normalizePaperTradingWeight(
    targetSpyWeight - currentWeights.targetSpyWeight,
  );
  const cashWeightDelta = normalizePaperTradingWeight(
    targetCashWeight - currentWeights.targetCashWeight,
  );
  const targetQuantity =
    context.portfolioState.totalEquity > 0
      ? normalizePaperTradingQuantity(
          (context.portfolioState.totalEquity * targetSpyWeight) / context.latestPrice.close,
        )
      : 0;
  const quantityDelta = normalizePaperTradingQuantity(
    targetQuantity - context.portfolioState.positionQuantity,
  );

  if (decision === "HOLD") {
    if (
      Math.abs(spyWeightDelta) > PAPER_TRADING_TARGET_WEIGHT_TOLERANCE ||
      Math.abs(cashWeightDelta) > PAPER_TRADING_TARGET_WEIGHT_TOLERANCE
    ) {
      throw new PaperTradeDecisionValidationError(
        "fallback_invalid_decision_semantics",
        "HOLD decision changed the target allocation.",
      );
    }

    return;
  }

  if (decision === "BUY") {
    if (spyWeightDelta <= PAPER_TRADING_TARGET_WEIGHT_TOLERANCE || quantityDelta <= 0) {
      throw new PaperTradeDecisionValidationError(
        "fallback_invalid_decision_semantics",
        "BUY decision did not increase SPY exposure.",
      );
    }

    return;
  }

  if (decision === "SELL") {
    if (spyWeightDelta >= -PAPER_TRADING_TARGET_WEIGHT_TOLERANCE || quantityDelta >= 0) {
      throw new PaperTradeDecisionValidationError(
        "fallback_invalid_decision_semantics",
        "SELL decision did not reduce SPY exposure.",
      );
    }

    return;
  }

  throw new PaperTradeDecisionValidationError(
    "fallback_invalid_schema",
    `Unsupported paper trading decision: ${decision}`,
  );
}

function validateDecisionPayload(
  candidate: unknown,
  context: PaperTradingContextReady,
): PaperTradingDecisionPayload {
  if (!isRecord(candidate)) {
    throw new PaperTradeDecisionValidationError(
      "fallback_invalid_schema",
      "Anthropic paper trade decision was not an object.",
    );
  }

  const keys = Object.keys(candidate).sort();
  const expectedKeys = [...RESPONSE_KEYS].sort();

  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key, index) => key !== keys[index])
  ) {
    throw new PaperTradeDecisionValidationError(
      "fallback_invalid_schema",
      "Anthropic paper trade decision returned unexpected fields.",
    );
  }

  const decision = getRequiredString(candidate.decision, "decision") as PaperTradingDecision;

  if (!["BUY", "SELL", "HOLD"].includes(decision)) {
    throw new PaperTradeDecisionValidationError(
      "fallback_invalid_schema",
      `Unsupported paper trade decision: ${decision}`,
    );
  }

  const targetSpyWeight = normalizePaperTradingWeight(
    getRequiredNumber(candidate.target_spy_weight, "target_spy_weight"),
  );
  const targetCashWeight = normalizePaperTradingWeight(
    getRequiredNumber(candidate.target_cash_weight, "target_cash_weight"),
  );
  const convictionScore = getRequiredInteger(candidate.conviction_score, "conviction_score");
  const reasoningSummary = getRequiredString(candidate.reasoning_summary, "reasoning_summary");

  if (targetSpyWeight < 0 || targetSpyWeight > 1 || targetCashWeight < 0 || targetCashWeight > 1) {
    throw new PaperTradeDecisionValidationError(
      "fallback_invalid_math",
      "Paper trade target weights must stay between 0 and 1.",
    );
  }

  if (
    Math.abs(targetSpyWeight + targetCashWeight - 1) > PAPER_TRADING_TARGET_WEIGHT_TOLERANCE
  ) {
    throw new PaperTradeDecisionValidationError(
      "fallback_invalid_math",
      "Paper trade target weights did not sum to 1.",
    );
  }

  if (reasoningSummary.length > PAPER_TRADING_MAX_REASONING_SUMMARY_LENGTH) {
    throw new PaperTradeDecisionValidationError(
      "fallback_invalid_schema",
      "Paper trade reasoning_summary exceeded the maximum length.",
    );
  }

  if (!Array.isArray(candidate.risk_flags)) {
    throw new PaperTradeDecisionValidationError(
      "fallback_invalid_schema",
      "Paper trade risk_flags must be an array of strings.",
    );
  }

  if (candidate.risk_flags.length > PAPER_TRADING_MAX_RISK_FLAGS) {
    throw new PaperTradeDecisionValidationError(
      "fallback_invalid_schema",
      "Paper trade risk_flags exceeded the maximum allowed items.",
    );
  }

  const normalizedRiskFlags = candidate.risk_flags.map((value) => {
    if (typeof value !== "string") {
      throw new PaperTradeDecisionValidationError(
        "fallback_invalid_schema",
        "Paper trade risk_flags must only contain strings.",
      );
    }

    const normalizedRiskFlag = normalizeRiskFlag(value);

    if (!normalizedRiskFlag) {
      throw new PaperTradeDecisionValidationError(
        "fallback_invalid_schema",
        "Paper trade risk_flags contained an empty value.",
      );
    }

    return normalizedRiskFlag;
  });

  validateDecisionSemantics(context, decision, targetSpyWeight, targetCashWeight);

  return {
    decision,
    targetSpyWeight,
    targetCashWeight,
    convictionScore,
    reasoningSummary,
    riskFlags: dedupeRiskFlags([...getContextRiskFlags(context), ...normalizedRiskFlags]),
  };
}

function getFallbackRiskFlag(error: unknown) {
  if (error instanceof PaperTradeDecisionValidationError) {
    return error.riskFlag;
  }

  return "fallback_llm_unavailable";
}

export async function generatePaperTradeDecision(
  context: PaperTradingContextReady,
): Promise<GeneratePaperTradeDecisionResult> {
  let rawResponse: string | null = null;

  try {
    const anthropic = new Anthropic({
      apiKey: getRequiredServerEnv("ANTHROPIC_API_KEY"),
    });

    const response = await withExponentialBackoff(
      () =>
        anthropic.messages.create({
          model: PAPER_TRADING_MODEL,
          max_tokens: PAPER_TRADING_DECISION_MAX_TOKENS,
          system: PAPER_TRADING_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: buildPromptPayload(context.promptPayload),
            },
          ],
          output_config: {
            format: {
              type: "json_schema",
              schema: PAPER_TRADING_DECISION_RESPONSE_SCHEMA,
            },
          },
        }),
      PAPER_TRADING_LLM_RETRY_OPTIONS,
    );

    rawResponse = extractTextResponse(response.content);

    if (!rawResponse) {
      throw new PaperTradeDecisionValidationError(
        "fallback_empty_response",
        "Anthropic paper trade decision returned no text content.",
      );
    }

    const parsedResponse = parseRawDecisionResponse(rawResponse);
    const decision = validateDecisionPayload(parsedResponse, context);

    return {
      decision,
      generationMethod: "anthropic",
      sourceModel: PAPER_TRADING_MODEL,
      promptVersion: PAPER_TRADING_PROMPT_VERSION,
      rawResponse,
      warnings: [],
    };
  } catch (error) {
    const fallbackRiskFlag = getFallbackRiskFlag(error);
    const message =
      error instanceof Error
        ? error.message
        : "Unknown paper trade decision generation failure.";

    return buildFallbackDecision(context, message, [fallbackRiskFlag], rawResponse);
  }
}
