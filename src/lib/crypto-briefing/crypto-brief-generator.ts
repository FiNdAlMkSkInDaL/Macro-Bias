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

function countSentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0).length;
}

function validateCryptoNewsletterCopy(newsletterCopy: string) {
  const headers = Object.values(CRYPTO_BRIEFING_SECTION_HEADERS);
  const matches = [...newsletterCopy.matchAll(
    new RegExp(`^(${headers.map((header) => header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*:?[ \t]*$`, "gm"),
  )];

  if (matches.length !== headers.length) {
    throw new Error("Anthropic crypto briefing failed section parsing.");
  }

  const sections = new Map<string, string>();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const title = match[1];
    const start = match.index! + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index! : newsletterCopy.length;
    sections.set(title, newsletterCopy.slice(start, end).trim());
  }

  const regimeStatus = sections.get(CRYPTO_BRIEFING_SECTION_HEADERS.bottomLine) ?? "";
  const marketMap = sections.get(CRYPTO_BRIEFING_SECTION_HEADERS.marketBreakdown) ?? "";
  const riskFrame = sections.get(CRYPTO_BRIEFING_SECTION_HEADERS.riskCheck) ?? "";
  const modelContext = sections.get(CRYPTO_BRIEFING_SECTION_HEADERS.modelNotes) ?? "";

  if (countSentences(regimeStatus) !== 1) {
    throw new Error("Anthropic crypto briefing regime status must be exactly 1 sentence.");
  }

  const marketLines = marketMap
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (marketLines.length !== 4) {
    throw new Error("Anthropic crypto briefing market map must contain exactly 4 bullets.");
  }

  const expectedPrefixes = [
    "- **Bitcoin**:",
    "- **Altcoins (ETH-led)**:",
    "- **DeFi/L1s**:",
    "- **Stablecoins/Flows**:",
  ];

  expectedPrefixes.forEach((prefix, index) => {
    if (!marketLines[index]?.startsWith(prefix)) {
      throw new Error(`Anthropic crypto briefing market map bullet ${index + 1} is malformed.`);
    }
  });

  if (countSentences(riskFrame) !== 2) {
    throw new Error("Anthropic crypto briefing risk frame must be exactly 2 sentences.");
  }

  const modelContextLines = modelContext
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (modelContextLines.length !== 3) {
    throw new Error("Anthropic crypto briefing model context must be 2 sentences plus diagnostics.");
  }

  if (countSentences(modelContextLines[0]) + countSentences(modelContextLines[1]) !== 2) {
    throw new Error("Anthropic crypto briefing model context must begin with exactly 2 sentences.");
  }

  if (!modelContextLines[2].startsWith("Model Diagnostics:")) {
    throw new Error("Anthropic crypto briefing diagnostics line is malformed.");
  }
}

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
    if (isCryptoBriefingResponse(parsed)) {
      validateCryptoNewsletterCopy(parsed.newsletter_copy.trim());
      return {
        ...parsed,
        newsletter_copy: parsed.newsletter_copy.trim(),
      };
    }
  } catch { /* ignore */ }

  // Try extracting embedded JSON
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const embedded = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
      if (isCryptoBriefingResponse(embedded)) {
        validateCryptoNewsletterCopy(embedded.newsletter_copy.trim());
        return {
          ...embedded,
          newsletter_copy: embedded.newsletter_copy.trim(),
        };
      }
    } catch { /* ignore */ }
  }

  // Fallback: treat entire response as newsletter copy
  const hasHeaders = Object.values(CRYPTO_BRIEFING_SECTION_HEADERS).every((h) => raw.includes(h));
  if (hasHeaders) {
    const normalized = raw.trim();
    validateCryptoNewsletterCopy(normalized);
    return { is_override_active: false, newsletter_copy: normalized };
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
    `Crypto is in a ${label.toLowerCase()} regime, and the score still deserves weight today.`,
    "",
    `${CRYPTO_BRIEFING_SECTION_HEADERS.marketBreakdown}:`,
    `- **Bitcoin**: Neutral -- **BTC** closed at $${btcChange?.close.toLocaleString() ?? "n/a"} with a ${btcPct} move, so price alone is not giving a strong message.`,
    `- **Altcoins (ETH-led)**: Neutral -- **ETH** is tracking **BTC** without clear leadership or stress.`,
    `- **DeFi/L1s**: Neutral -- The higher-beta part of crypto is not showing a clean expansion signal yet.`,
    `- **Stablecoins/Flows**: Neutral -- No obvious flow disruption is showing up in the stablecoin backdrop.`,
    "",
    `${CRYPTO_BRIEFING_SECTION_HEADERS.riskCheck}:`,
    `The close in **BTC** matters less than the broader macro and relative-strength backdrop. Confidence improves if **ETH** and higher-beta crypto stop lagging while the dollar backdrop eases.`,
    "",
    `${CRYPTO_BRIEFING_SECTION_HEADERS.modelNotes}:`,
    `The nearest analog set gives a usable baseline, but this fallback is leaning on compressed quant context rather than a full narrative read. Similar setups were mixed enough that the score should be treated as a directional lean, not a precise path forecast.`,
    `Model Diagnostics: BTC Close $${btcChange?.close.toLocaleString() ?? "n/a"} | BTC Daily Change ${btcPct} | Score ${score} | Analogs ${biasResult.componentScores[0]?.analogDates?.slice(0, 3).join(", ") || "n/a"}.`,
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
