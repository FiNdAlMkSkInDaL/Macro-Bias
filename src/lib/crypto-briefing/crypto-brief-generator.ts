import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { getRequiredServerEnv } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { DailyEmailContext } from "@/lib/marketing/daily-email-context";

import {
  CRYPTO_BRIEFING_MODEL,
  CRYPTO_BRIEFING_MAX_TOKENS,
  CRYPTO_BRIEFING_SECTION_HEADERS,
  CRYPTO_BRIEFING_LEGACY_SYSTEM_PROMPT,
  CRYPTO_BRIEFING_SYSTEM_PROMPT,
  CRYPTO_LLM_RETRY_OPTIONS,
} from "./crypto-briefing-config";

import type {
  CryptoBiasComponentResult,
  CryptoDailyBiasResult,
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
  historicalContext: CryptoHistoricalContext;
  groundedBriefing: string;
  coverage: { defiSector: false; stablecoinSupply: false; exchangeFlows: false; news: false };
  tradableSignal: {
    position: string;
    size: number;
    reliability: string;
    neighborAgreement: number;
    noTrade: boolean;
    reason: string;
  } | null;
};

function countSentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0).length;
}

function validateCryptoNewsletterCopy(newsletterCopy: string, optimised = false) {
  if (/\b(?:NO_TRADE|Permission\s*:|Reliability\s+[A-F]\b|rel\s+[A-F]\b|Size\s+\d+%)/i.test(newsletterCopy)) {
    throw new Error("Anthropic crypto briefing exposed model control fields.");
  }

  const headers = Object.values(CRYPTO_BRIEFING_SECTION_HEADERS);
  const matches = [...newsletterCopy.matchAll(
    new RegExp(`^(${headers.map((header) => header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[ \\t]*(?::[ \\t]*(.*))?$`, "gm"),
  )];

  if (matches.length !== headers.length || matches.some((match, index) => match[1] !== headers[index])) {
    throw new Error("Anthropic crypto briefing failed section parsing.");
  }

  const sections = new Map<string, string>();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const title = match[1];
    const start = match.index! + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index! : newsletterCopy.length;
    sections.set(title, [match[2] ?? "", newsletterCopy.slice(start, end)].join("\n").trim());
  }

  const regimeStatus = sections.get(CRYPTO_BRIEFING_SECTION_HEADERS.bottomLine) ?? "";
  const marketMap = sections.get(CRYPTO_BRIEFING_SECTION_HEADERS.marketBreakdown) ?? "";
  const riskFrame = sections.get(CRYPTO_BRIEFING_SECTION_HEADERS.riskCheck) ?? "";
  const modelContext = sections.get(CRYPTO_BRIEFING_SECTION_HEADERS.modelNotes) ?? "";

  if (countSentences(regimeStatus) < 1 || countSentences(regimeStatus) > (optimised ? 2 : 1)) {
    throw new Error("Anthropic crypto briefing regime status must contain 1 or 2 sentences.");
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

  const diagnosticIndex = modelContextLines.findIndex((line) => line.startsWith("Model Diagnostics:"));
  if (diagnosticIndex !== modelContextLines.length - 1 || diagnosticIndex === -1) {
    throw new Error("Anthropic crypto briefing diagnostics line is malformed.");
  }
  const contextSentences = countSentences(modelContextLines.slice(0, diagnosticIndex).join(" "));
  if (contextSentences < 2 || contextSentences > (optimised ? 4 : 2)) {
    throw new Error("Anthropic crypto briefing model context must begin with 2 to 4 sentences.");
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

function buildPromptPayload(biasResult: CryptoDailyBiasResult, optimised = false): CryptoBriefingPromptPayload | Omit<CryptoBriefingPromptPayload, "historicalContext" | "groundedBriefing" | "coverage"> {
  if (!optimised) {
    const firstComponent = biasResult.componentScores[0];
    const signal = biasResult.signal ?? null;
    return {
      tradeDate: biasResult.tradeDate,
      score: biasResult.score,
      label: biasResult.label,
      tickerChanges: Object.fromEntries(Object.entries(biasResult.tickerChanges).map(([ticker, snap]) => [
        ticker, { close: snap.close, percentChange: snap.percentChange },
      ])),
      componentSummaries: biasResult.componentScores.map((component) => component.summary),
      topAnalogDates: firstComponent?.analogDates ?? [],
      averageForward1DayReturn: firstComponent?.averageForward1DayReturn ?? null,
      averageForward3DayReturn: firstComponent?.averageForward3DayReturn ?? null,
      tradableSignal: signal ? {
        position: signal.position, size: signal.size, reliability: signal.reliability,
        neighborAgreement: signal.neighborAgreement, noTrade: signal.noTrade, reason: signal.reason,
      } : null,
    };
  }
  const firstComponent = findHistoricalComponent(biasResult);
  const signal = measuredSignal(biasResult);
  return {
    tradeDate: biasResult.tradeDate,
    score: biasResult.score,
    label: biasResult.label,
    tickerChanges: Object.fromEntries(
      Object.entries(biasResult.tickerChanges).filter(([, snap]) =>
        Number.isFinite(snap.close) && Number.isFinite(snap.percentChange) &&
        (!snap.tradeDate || snap.tradeDate === biasResult.tradeDate),
      ).map(([ticker, snap]) => [
        ticker,
        { close: snap.close, percentChange: snap.percentChange },
      ]),
    ),
    componentSummaries: biasResult.componentScores.map((c) => c.summary),
    topAnalogDates: firstComponent?.analogDates ?? [],
    averageForward1DayReturn: firstComponent?.averageForward1DayReturn ?? null,
    averageForward3DayReturn: firstComponent?.averageForward3DayReturn ?? null,
    historicalContext: buildHistoricalContext(biasResult),
    groundedBriefing: buildFallbackBriefing(biasResult, false),
    coverage: { defiSector: false, stablecoinSupply: false, exchangeFlows: false, news: false },
    tradableSignal: signal
      ? {
          position: signal.position,
          size: signal.size,
          reliability: signal.reliability,
          neighborAgreement: signal.neighborAgreement,
          noTrade: signal.noTrade,
          reason: signal.reason,
        }
      : null,
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

function parseCryptoBriefingResponse(raw: string, optimised = false): CryptoBriefingLLMResponse {
  // Try direct parse
  try {
    const parsed = JSON.parse(raw);
    if (isCryptoBriefingResponse(parsed)) {
      validateCryptoNewsletterCopy(parsed.newsletter_copy.trim(), optimised);
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
        validateCryptoNewsletterCopy(embedded.newsletter_copy.trim(), optimised);
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
    validateCryptoNewsletterCopy(normalized, optimised);
    return { is_override_active: false, newsletter_copy: normalized };
  }

  throw new Error("Anthropic crypto briefing response was not valid JSON.");
}

type CryptoHistoricalContext = {
  sampleSize: number | null;
  averageForward1DayReturn: number | null;
  averageForward3DayReturn: number | null;
  range1Day: { sampleSize: number; min: number; max: number } | null;
  range3Day: { sampleSize: number; min: number; max: number } | null;
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatSignedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatPrice(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ordinal(value: number) {
  const rounded = Math.round(value);
  const suffix = rounded % 100 >= 11 && rounded % 100 <= 13 ? "th"
    : rounded % 10 === 1 ? "st" : rounded % 10 === 2 ? "nd" : rounded % 10 === 3 ? "rd" : "th";
  return `${rounded}${suffix}`;
}

function findHistoricalComponent(biasResult: CryptoDailyBiasResult): CryptoBiasComponentResult | undefined {
  return biasResult.componentScores.find((component) => component.analogMatches?.length)
    ?? biasResult.componentScores.find((component) => component.analogDates?.length)
    ?? biasResult.componentScores.find((component) =>
      finiteNumber(component.averageForward1DayReturn) || finiteNumber(component.averageForward3DayReturn),
    );
}

function measuredSignal(biasResult: CryptoDailyBiasResult) {
  const signal = biasResult.signal;
  // Legacy snapshots have a synthetic C grade in the publisher. It is not measured confidence.
  return signal && typeof signal.noTrade === "boolean" && /^[ABCDF]$/.test(signal.reliability ?? "") &&
    !/legacy score without tradable signal metadata/i.test(signal.reason ?? "")
    ? signal
    : null;
}

function recordedPrice(biasResult: CryptoDailyBiasResult, ticker: "BTC-USD" | "ETH-USD" | "SOL-USD") {
  const snapshot = biasResult.tickerChanges[ticker];
  if (!snapshot || !finiteNumber(snapshot.close) || snapshot.close <= 0 ||
      !finiteNumber(snapshot.percentChange) ||
      (snapshot.tradeDate && snapshot.tradeDate !== biasResult.tradeDate)) return null;
  return snapshot;
}

function buildHistoricalContext(biasResult: CryptoDailyBiasResult): CryptoHistoricalContext {
  const component = findHistoricalComponent(biasResult);
  // The same neighbor set is stored on every pillar. Count it once, never combine pillars.
  const matches = [...new Map((component?.analogMatches ?? [])
    .filter((match) => /^\d{4}-\d{2}-\d{2}$/.test(match.tradeDate) && match.tradeDate < biasResult.tradeDate)
    .map((match) => [match.tradeDate, match])).values()];
  const dates = new Set((component?.analogDates ?? [])
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date < biasResult.tradeDate));
  const range = (key: "btcForward1DayReturn" | "btcForward3DayReturn") => {
    const values = matches.map((match) => match[key]).filter(finiteNumber);
    return values.length
      ? { sampleSize: values.length, min: Math.min(...values), max: Math.max(...values) }
      : null;
  };
  return {
    sampleSize: matches.length || dates.size || null,
    averageForward1DayReturn: finiteNumber(component?.averageForward1DayReturn) ? component.averageForward1DayReturn : null,
    averageForward3DayReturn: finiteNumber(component?.averageForward3DayReturn) ? component.averageForward3DayReturn : null,
    range1Day: range("btcForward1DayReturn"),
    range3Day: range("btcForward3DayReturn"),
  };
}

function confidenceSummary(biasResult: CryptoDailyBiasResult) {
  const signal = measuredSignal(biasResult);
  if (!signal) return "Model confidence is unavailable for this saved reading; score strength alone does not establish reliability.";
  if (signal.noTrade) return "Confidence is limited because the historical match is too weak to support a directional reading today.";
  const confidence = signal.reliability === "A" || signal.reliability === "B" ? "higher"
    : signal.reliability === "C" ? "moderate" : "low";
  const agreement = finiteNumber(signal.neighborAgreement) && signal.neighborAgreement >= 0 && signal.neighborAgreement <= 1 && biasResult.score !== 0
    ? `, with ${Math.round(signal.neighborAgreement * 100)}% of matched sessions agreeing with the score's direction`
    : "";
  return `Historical-match confidence is ${confidence}${agreement}; this is not a probability of tomorrow's outcome.`;
}

function historicalSummary(biasResult: CryptoDailyBiasResult, includeConfidence = true) {
  const history = buildHistoricalContext(biasResult);
  const sample = history.sampleSize === null ? "Recorded similar sessions"
    : `The ${history.sampleSize} matched historical session${history.sampleSize === 1 ? "" : "s"}`;
  const averages: string[] = [];
  if (history.averageForward1DayReturn !== null) averages.push(`${formatSignedPercent(history.averageForward1DayReturn)} after one day`);
  if (history.averageForward3DayReturn !== null) averages.push(`${formatSignedPercent(history.averageForward3DayReturn)} after three days`);
  const averageSentence = averages.length
    ? `${sample}: weighted **BTC** returns averaged ${averages.join(" and ")}.`
    : "Historical return averages are unavailable for this reading.";
  const ranges: string[] = [];
  if (history.range1Day) ranges.push(`one-day range ${formatSignedPercent(history.range1Day.min)} to ${formatSignedPercent(history.range1Day.max)}${history.range1Day.sampleSize !== history.sampleSize ? ` (${history.range1Day.sampleSize} recorded outcomes)` : ""}`);
  if (history.range3Day) ranges.push(`three-day range ${formatSignedPercent(history.range3Day.min)} to ${formatSignedPercent(history.range3Day.max)}${history.range3Day.sampleSize !== history.sampleSize ? ` (${history.range3Day.sampleSize} recorded outcomes)` : ""}`);
  const rangeSentence = ranges.length
    ? `Observed ${ranges.join("; ")}; past outcomes, not forecast bounds.`
    : "Outcome ranges are unavailable; averages alone do not show the spread of results.";
  return [averageSentence, rangeSentence, ...(includeConfidence ? [confidenceSummary(biasResult)] : [])].join(" ");
}

function interpretation(biasResult: CryptoDailyBiasResult) {
  const btc = recordedPrice(biasResult, "BTC-USD");
  const lean = biasResult.score > 0 ? "positive" : biasResult.score < 0 ? "negative" : "balanced";
  const strength = Math.abs(biasResult.score) >= 70 ? "strongly " : Math.abs(biasResult.score) < 20 ? "slightly " : "";
  const reading = biasResult.score === 0 ? "The historical model is balanced"
    : `The historical model leans ${strength}${lean}`;
  let confirmation = "daily price confirmation is unavailable";
  if (btc) {
    const move = `**BTC** moved ${formatSignedPercent(btc.percentChange)}`;
    confirmation = biasResult.score === 0 ? `${move}, while the score has no directional lean`
      : btc.percentChange === 0 ? `${move}, offering no daily price confirmation`
      : Math.sign(biasResult.score) === Math.sign(btc.percentChange)
        ? `${move}, in the same direction as the model lean`
        : `${move}, opposite to the model lean`;
  }
  const limit = measuredSignal(biasResult)?.noTrade
    ? " The historical match is too weak to give the score much weight today."
    : "";
  return `${reading}; ${confirmation}.${limit}`;
}

function relativeMove(biasResult: CryptoDailyBiasResult, ticker: "ETH-USD" | "SOL-USD") {
  const snapshot = recordedPrice(biasResult, ticker);
  const btc = recordedPrice(biasResult, "BTC-USD");
  if (!snapshot) return null;
  const name = ticker === "ETH-USD" ? "ETH" : "SOL";
  if (!btc) return `**${name}** moved ${formatSignedPercent(snapshot.percentChange)}; the **BTC** comparison is unavailable`;
  const difference = snapshot.percentChange - btc.percentChange;
  const relative = Math.abs(difference) < 0.005 ? "matched **BTC**'s daily move"
    : `${difference > 0 ? "outperformed" : "underperformed"} **BTC** by ${Math.abs(difference).toFixed(2)} percentage points`;
  return `**${name}** moved ${formatSignedPercent(snapshot.percentChange)} and ${relative}`;
}

function inputEvidence(biasResult: CryptoDailyBiasResult) {
  const facts: string[] = [];
  const summaries = biasResult.componentScores.map((component) => component.summary).join(" ");
  const rsi = summaries.match(/BTC RSI is (\d+(?:\.\d+)?)/);
  if (rsi && Number(rsi[1]) >= 0 && Number(rsi[1]) <= 100) {
    const value = Number(rsi[1]);
    facts.push(`Momentum: **BTC** RSI ${value.toFixed(1)}, ${value >= 60 ? "stronger recent momentum" : value <= 40 ? "weaker recent momentum" : "a neutral reading"}.`);
  }
  const ethRank = summaries.match(/ETH\/BTC percentile is (\d+(?:\.\d+)?)/);
  if (ethRank && Number(ethRank[1]) >= 0 && Number(ethRank[1]) <= 100) {
    const value = Number(ethRank[1]);
    facts.push(`Relative strength: **ETH/BTC** at the ${ordinal(value)} percentile of recent history.`);
  }
  const dollar = summaries.match(/DXY momentum is ([+-]?[\d.]+)%/);
  if (dollar && finiteNumber(Number(dollar[1]))) facts.push(`Dollar backdrop: **DXY** momentum ${formatSignedPercent(Number(dollar[1]))} over five sessions.`);
  if (!facts.length) {
    const history = buildHistoricalContext(biasResult);
    if (history.averageForward1DayReturn !== null && history.averageForward3DayReturn !== null) {
      facts.push(`The score combines historical **BTC** return averages of ${formatSignedPercent(history.averageForward1DayReturn)} after one day and ${formatSignedPercent(history.averageForward3DayReturn)} after three days.`);
    }
  }
  const relative = relativeMove(biasResult, "ETH-USD");
  if (relative) facts.push(`Price confirmation: ${relative}.`);
  return facts.slice(0, 3);
}

export function buildCryptoEmailEvidence(biasResult: CryptoDailyBiasResult): Pick<DailyEmailContext, "interpretation" | "evidence" | "historicalContext" | "coverageNote"> {
  return {
    interpretation: interpretation(biasResult),
    evidence: inputEvidence(biasResult),
    historicalContext: historicalSummary(biasResult, false),
    coverageNote: "Quantitative coverage only; no news assessment. Broad DeFi activity, stablecoin supply, pegs and exchange flows are not measured.",
  };
}

function marketMap(biasResult: CryptoDailyBiasResult) {
  const btc = recordedPrice(biasResult, "BTC-USD");
  const eth = relativeMove(biasResult, "ETH-USD");
  const sol = relativeMove(biasResult, "SOL-USD");
  return [
    `- **Bitcoin**: ${btc ? `**BTC** close $${formatPrice(btc.close)}; daily move ${formatSignedPercent(btc.percentChange)}.` : "Price data is unavailable for this date."}`,
    `- **Altcoins (ETH-led)**: ${eth ? `${eth}.` : "**ETH** price data is unavailable; relative performance cannot be assessed."}`,
    `- **DeFi/L1s**: ${sol ? `${sol} (one L1 price proxy).` : "**SOL** price data is unavailable."}`,
    "- **Stablecoins/Flows**: Not measured.",
  ].join("\n");
}

function riskFrame(biasResult: CryptoDailyBiasResult) {
  const signal = measuredSignal(biasResult);
  const btc = recordedPrice(biasResult, "BTC-USD");
  const eth = recordedPrice(biasResult, "ETH-USD");
  if (!btc || !eth) return "Daily price confirmation is unavailable with the current coverage. Reassess **BTC** and **ETH** relative performance when both completed daily candles are available.";
  if (signal?.noTrade) return "Watch whether **BTC** and **ETH** develop a consistent direction over the next one to three days. A single day's move provides limited confirmation.";
  return biasResult.score > 0
    ? "Watch for **BTC** gains and **ETH** outperformance over the next one to three days. **BTC** losses with **ETH** underperformance would weaken price confirmation."
    : biasResult.score < 0
      ? "Watch for **BTC** losses and **ETH** underperformance over the next one to three days. **BTC** gains with **ETH** outperformance would weaken price confirmation."
      : "Watch **BTC** and **ETH** for consistent direction over the next one to three days. That would help establish whether the balanced reading is changing.";
}

function factualDiagnostics(biasResult: CryptoDailyBiasResult) {
  const btc = recordedPrice(biasResult, "BTC-USD");
  const history = buildHistoricalContext(biasResult);
  const score = biasResult.score > 0 ? `+${biasResult.score}` : String(biasResult.score);
  return `Model Diagnostics: BTC Close ${btc ? `$${formatPrice(btc.close)}` : "unavailable"} | BTC Daily Change ${btc ? formatSignedPercent(btc.percentChange) : "unavailable"} | Score ${score} | Historical sample ${history.sampleSize ?? "unavailable"}.`;
}

function buildFallbackBriefing(biasResult: CryptoDailyBiasResult, quantitativeOnlyNotice = true): string {
  return [
    `${CRYPTO_BRIEFING_SECTION_HEADERS.bottomLine}:`, interpretation(biasResult), "",
    `${CRYPTO_BRIEFING_SECTION_HEADERS.marketBreakdown}:`, marketMap(biasResult), "",
    `${CRYPTO_BRIEFING_SECTION_HEADERS.riskCheck}:`, riskFrame(biasResult), "",
    `${CRYPTO_BRIEFING_SECTION_HEADERS.modelNotes}:`, historicalSummary(biasResult),
    ...(quantitativeOnlyNotice ? ["Quantitative summary only today; no news assessment is included."] : []),
    factualDiagnostics(biasResult),
  ].join("\n");
}

function buildLegacyFallbackBriefing(biasResult: CryptoDailyBiasResult): string {
  const label = biasResult.label.replace(/_/g, " ");
  const score = biasResult.score > 0 ? `+${biasResult.score}` : `${biasResult.score}`;
  const btcChange = biasResult.tickerChanges["BTC-USD"];
  const btcPct = btcChange ? formatSignedPercent(btcChange.percentChange) : "n/a";
  return [
    `${CRYPTO_BRIEFING_SECTION_HEADERS.bottomLine}:`,
    biasResult.signal?.noTrade
      ? `Crypto is in a ${label.toLowerCase()} regime, but the historical match is too weak to put much weight on the score today.`
      : `Crypto is in a ${label.toLowerCase()} regime, and the score still deserves weight today.`, "",
    `${CRYPTO_BRIEFING_SECTION_HEADERS.marketBreakdown}:`,
    `- **Bitcoin**: Neutral -- **BTC** closed at $${btcChange?.close.toLocaleString() ?? "n/a"} with a ${btcPct} move, so price alone is not giving a strong message.`,
    "- **Altcoins (ETH-led)**: Neutral -- **ETH** is tracking **BTC** without clear leadership or stress.",
    "- **DeFi/L1s**: Neutral -- The higher-beta part of crypto is not showing a clean expansion signal yet.",
    "- **Stablecoins/Flows**: Neutral -- No obvious flow disruption is showing up in the stablecoin backdrop.", "",
    `${CRYPTO_BRIEFING_SECTION_HEADERS.riskCheck}:`,
    "The close in **BTC** matters less than the broader macro and relative-strength backdrop. Confidence improves if **ETH** and higher-beta crypto stop lagging while the dollar backdrop eases.", "",
    `${CRYPTO_BRIEFING_SECTION_HEADERS.modelNotes}:`,
    biasResult.signal?.noTrade
      ? "The historical match is not strong enough to give a reliable comparison today. The numeric score is background context until a clearer pattern develops."
      : "The nearest analog set gives a usable baseline, but this fallback is leaning on compressed quant context rather than a full narrative read. Similar setups were mixed enough that the score should be treated as a directional lean, not a precise path forecast.",
    `Model Diagnostics: BTC Close $${btcChange?.close.toLocaleString() ?? "n/a"} | BTC Daily Change ${btcPct} | Score ${score} | Analogs ${biasResult.componentScores[0]?.analogDates?.slice(0, 3).join(", ") || "n/a"}.`,
  ].join("\n");
}

function groundCryptoBriefing(response: CryptoBriefingLLMResponse, biasResult: CryptoDailyBiasResult): CryptoBriefingLLMResponse {
  const aiRisk = response.newsletter_copy.match(/^RISK FRAME[ \t]*(?::[ \t]*(.*))?$([\s\S]*?)(?=^MODEL CONTEXT)/m);
  const risk = aiRisk ? [aiRisk[1] ?? "", aiRisk[2]].join("\n").trim() : "";
  // AI can add readable interpretation of the supplied quantitative inputs. Facts, unknown
  // coverage and confidence always come from the recorded snapshot. Keep the risk frame
  // only when it is conditional and contains no new figures or unmeasured event claims.
  const unsupported = /\d|stablecoin|\bDeFi\b|\bflows?\b|exchange|hack|regulat|depeg|\bETF|liquidat|on.chain|news|catalyst|\bDXY\b|dollar|yields?|rates?|treasur|inflation|\bfed\b|policy|lagging|rallying|falling|rising|surging|compressed|fallback|diagnostic|no.trade|\blong\b|\bshort\b|\bbuy\b|\bsell\b|entry|target|stop/i;
  const ungroundedConfidence = /\b(?:high|higher|strong|low|weak|poor|good|moderate|reliable|unreliable)\s+(?:confidence|conviction|match)|(?:confidence|conviction|match)\s+(?:is|remains|looks)\s+(?:high|higher|strong|low|weak|poor|good|moderate|reliable|unreliable)/i;
  const incompatibleDirection = biasResult.score > 0 ? /negative|bearish|risk.off/i.test(risk)
    : biasResult.score < 0 ? /positive|bullish|risk.on/i.test(risk)
      : /positive|negative|bullish|bearish|risk.on|risk.off/i.test(risk);
  const validRisk = risk.length > 0 && risk.split(/\s+/).length <= 40 && !unsupported.test(risk) &&
    !ungroundedConfidence.test(risk) && !incompatibleDirection &&
    !measuredSignal(biasResult)?.noTrade && !!recordedPrice(biasResult, "BTC-USD") && !!recordedPrice(biasResult, "ETH-USD") &&
    /\bBTC\b/i.test(risk) && /\bETH\b/i.test(risk) &&
    /\bif\b|\bwould\b|\bwatch\b|\bnext\b/i.test(risk);
  return {
    // No news feed is supplied to crypto synthesis, so it cannot assert an event override.
    is_override_active: false,
    newsletter_copy: [
      `${CRYPTO_BRIEFING_SECTION_HEADERS.bottomLine}:`, interpretation(biasResult), "",
      `${CRYPTO_BRIEFING_SECTION_HEADERS.marketBreakdown}:`, marketMap(biasResult), "",
      `${CRYPTO_BRIEFING_SECTION_HEADERS.riskCheck}:`, validRisk ? risk : riskFrame(biasResult), "",
      `${CRYPTO_BRIEFING_SECTION_HEADERS.modelNotes}:`, historicalSummary(biasResult), factualDiagnostics(biasResult),
    ].join("\n"),
  };
}

async function generateAnthropicCryptoBriefing(
  biasResult: CryptoDailyBiasResult,
  optimised = false,
): Promise<CryptoBriefingLLMResponse> {
  const anthropic = new Anthropic({
    apiKey: getRequiredServerEnv("ANTHROPIC_API_KEY"),
    timeout: 45_000,
    maxRetries: 0,
  });

  const payload = buildPromptPayload(biasResult, optimised);

  const response = await withExponentialBackoff(
    () =>
      anthropic.messages.create({
        model: CRYPTO_BRIEFING_MODEL,
        max_tokens: CRYPTO_BRIEFING_MAX_TOKENS,
        system: optimised ? CRYPTO_BRIEFING_SYSTEM_PROMPT : CRYPTO_BRIEFING_LEGACY_SYSTEM_PROMPT,
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
    { ...CRYPTO_LLM_RETRY_OPTIONS, maxAttempts: 2 },
  );

  const raw = extractTextResponse(response.content);
  if (!raw) throw new Error("Anthropic crypto briefing response had no text content.");

  const parsed = parseCryptoBriefingResponse(raw, optimised);
  if (optimised) return groundCryptoBriefing(parsed, biasResult);
  const factualDiagnostics = buildLegacyFallbackBriefing(biasResult).match(/^Model Diagnostics:.*$/m)?.[0];
  return {
    ...parsed,
    newsletter_copy: factualDiagnostics
      ? parsed.newsletter_copy.replace(/^[ \t]*Model Diagnostics:.*$/m, factualDiagnostics)
      : parsed.newsletter_copy,
  };
}

export async function generateCryptoDailyBriefing(
  biasResult: CryptoDailyBiasResult,
  options: { optimised?: boolean } = {},
): Promise<CryptoDailyBriefingResult> {
  const warnings: string[] = [];

  try {
    const response = await generateAnthropicCryptoBriefing(biasResult, options.optimised === true);
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
      newsletterCopy: options.optimised ? buildFallbackBriefing(biasResult) : buildLegacyFallbackBriefing(biasResult),
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
  const supabase = createSupabaseAdminClient({ timeoutMs: 5_000 });

  const { error } = await supabase.from("crypto_daily_briefings").upsert(
    {
      trade_date: tradeDate,
      brief_content: briefContent,
      score,
      bias_label: biasLabel,
      is_override_active: isOverrideActive,
      model_version: "crypto-model-v1",
    },
    { onConflict: "trade_date", ignoreDuplicates: true },
  );

  if (error) {
    throw new Error(`Failed to persist crypto briefing: ${error.message}`);
  }
}
