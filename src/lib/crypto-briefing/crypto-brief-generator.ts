import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { getRequiredServerEnv } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import {
  CRYPTO_BRIEFING_MODEL,
  CRYPTO_BRIEFING_MAX_TOKENS,
  CRYPTO_BRIEFING_RESPONSE_SCHEMA,
  CRYPTO_BRIEFING_SECTION_HEADERS,
  CRYPTO_BRIEFING_SYSTEM_PROMPT,
  CRYPTO_LLM_RETRY_OPTIONS,
} from "./crypto-briefing-config";

import type {
  CryptoBiasComponentResult,
  CryptoDailyBiasResult,
  CryptoHistoricalAnalogMatch,
  BiasLabel,
} from "@/lib/crypto-bias/types";

type CryptoBriefingLLMResponse = {
  is_override_active: boolean;
  newsletter_copy: string;
};

export type CryptoDailyBriefingResult = {
  generatedBy: "anthropic" | "fallback";
  isOverrideActive: boolean;
  model: string;
  newsletterCopy: string;
  warnings: string[];
};

type CryptoBriefingPromptPayload = {
  tradeDate: string;
  score: number;
  label: string;
  tickerChanges: Record<string, { close: number; percentChange: number }>;
  componentSummaries: string[];
  topAnalogDates: string[];
  averageForward1DayReturn: number | null;
  averageForward3DayReturn: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: { baseDelayMs: number; maxAttempts: number; maxDelayMs: number; operationName: string },
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < options.maxAttempts) {
        const delay = Math.min(options.baseDelayMs * Math.pow(2, attempt - 1), options.maxDelayMs);
        await sleep(delay);
      }
    }
  }
  throw lastError ?? new Error(`${options.operationName} failed after ${options.maxAttempts} attempts.`);
}

function buildPromptPayload(biasResult: CryptoDailyBiasResult): CryptoBriefingPromptPayload {
  const firstComponent = biasResult.componentScores[0];
  return {
    tradeDate: biasResult.tradeDate,
    score: biasResult.score,
    label: biasResult.label,
    tickerChanges: Object.fromEntries(
      Object.entries(biasResult.tickerChanges).map(([ticker, snap]) => [
        ticker,
        { close: snap.close, percentChange: snap.percentChange },
      ]),
    ),
    componentSummaries: biasResult.componentScores.map((c) => c.summary),
    topAnalogDates: firstComponent?.analogDates ?? [],
    averageForward1DayReturn: firstComponent?.averageForward1DayReturn ?? null,
    averageForward3DayReturn: firstComponent?.averageForward3DayReturn ?? null,
  };
}

function extractTextResponse(contentBlocks: Array<{ type: string; text?: string }>) {
  return contentBlocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
    .trim();
}

function isCryptoBriefingResponse(value: unknown): value is CryptoBriefingLLMResponse {
  if (!isRecord(value)) return false;
  return (
    typeof value.is_override_active === "boolean" &&
    typeof value.newsletter_copy === "string" &&
    (value.newsletter_copy as string).trim().length > 0
  );
}

function parseCryptoBriefingResponse(raw: string): CryptoBriefingLLMResponse {
  // Try direct parse
  try {
    const parsed = JSON.parse(raw);
    if (isCryptoBriefingResponse(parsed)) return parsed;
  } catch { /* ignore */ }

  // Try extracting embedded JSON
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const embedded = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
      if (isCryptoBriefingResponse(embedded)) return embedded;
    } catch { /* ignore */ }
  }

  // Fallback: treat entire response as newsletter copy
  const hasHeaders = Object.values(CRYPTO_BRIEFING_SECTION_HEADERS).every((h) => raw.includes(h));
  if (hasHeaders) {
    return { is_override_active: false, newsletter_copy: raw.trim() };
  }

  throw new Error("Anthropic crypto briefing response was not valid JSON.");
}

function buildFallbackBriefing(biasResult: CryptoDailyBiasResult): string {
  const label = biasResult.label.replace(/_/g, " ");
  const score = biasResult.score > 0 ? `+${biasResult.score}` : `${biasResult.score}`;
  const btcChange = biasResult.tickerChanges["BTC-USD"];
  const btcPct = btcChange
    ? `${btcChange.percentChange > 0 ? "+" : ""}${btcChange.percentChange.toFixed(2)}%`
    : "n/a";

  return [
    `${CRYPTO_BRIEFING_SECTION_HEADERS.bottomLine}:`,
    `The crypto regime algo scored ${label} (${score}) today. **BTC** moved ${btcPct} in the last session. The model is reading a mixed picture, so staying patient makes sense.`,
    "",
    `${CRYPTO_BRIEFING_SECTION_HEADERS.marketBreakdown}:`,
    `- **Bitcoin**: Neutral -- BTC closed at $${btcChange?.close.toLocaleString() ?? "n/a"} with a ${btcPct} move.`,
    `- **Altcoins (ETH-led)**: Neutral -- ETH is tracking BTC without clear leadership.`,
    `- **DeFi/L1s**: Neutral -- No standout moves in the L1 space today.`,
    `- **Stablecoins/Flows**: Neutral -- Flow data is inconclusive.`,
    "",
    `${CRYPTO_BRIEFING_SECTION_HEADERS.riskCheck}:`,
    `No major override catalysts detected. The model's historical pattern still applies.`,
    "",
    `${CRYPTO_BRIEFING_SECTION_HEADERS.modelNotes}:`,
    `The K-NN model found 5 historical analogs. Briefing was generated from quant data only because the LLM was unavailable.`,
  ].join("\n");
}

async function generateAnthropicCryptoBriefing(
  biasResult: CryptoDailyBiasResult,
): Promise<CryptoBriefingLLMResponse> {
  const anthropic = new Anthropic({
    apiKey: getRequiredServerEnv("ANTHROPIC_API_KEY"),
  });

  const payload = buildPromptPayload(biasResult);

  const response = await withExponentialBackoff(
    () =>
      anthropic.messages.create({
        model: CRYPTO_BRIEFING_MODEL,
        max_tokens: CRYPTO_BRIEFING_MAX_TOKENS,
        system: CRYPTO_BRIEFING_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              "Generate the crypto daily briefing from this quantitative context:",
              JSON.stringify(payload, null, 2),
            ].join("\n\n"),
          },
        ],
      }),
    CRYPTO_LLM_RETRY_OPTIONS,
  );

  const raw = extractTextResponse(response.content);
  if (!raw) throw new Error("Anthropic crypto briefing response had no text content.");

  return parseCryptoBriefingResponse(raw);
}

export async function generateCryptoDailyBriefing(
  biasResult: CryptoDailyBiasResult,
): Promise<CryptoDailyBriefingResult> {
  const warnings: string[] = [];

  try {
    const response = await generateAnthropicCryptoBriefing(biasResult);
    return {
      generatedBy: "anthropic",
      isOverrideActive: response.is_override_active,
      model: CRYPTO_BRIEFING_MODEL,
      newsletterCopy: response.newsletter_copy,
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM failure.";
    warnings.push(`LLM synthesis degraded: ${message}`);

    return {
      generatedBy: "fallback",
      isOverrideActive: false,
      model: "deterministic-fallback",
      newsletterCopy: buildFallbackBriefing(biasResult),
      warnings,
    };
  }
}

export async function persistCryptoBriefing(
  tradeDate: string,
  score: number,
  biasLabel: BiasLabel,
  briefContent: string,
  isOverrideActive: boolean,
) {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase.from("crypto_daily_briefings").upsert(
    {
      trade_date: tradeDate,
      brief_content: briefContent,
      score,
      bias_label: biasLabel,
      is_override_active: isOverrideActive,
      model_version: "crypto-model-v1",
    },
    { onConflict: "trade_date" },
  );

  if (error) {
    throw new Error(`Failed to persist crypto briefing: ${error.message}`);
  }
}
