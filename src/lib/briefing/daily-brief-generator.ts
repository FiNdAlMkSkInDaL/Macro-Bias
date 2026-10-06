import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  deriveHistoricalAnalogs,
  type HistoricalAnalogsPayload,
} from "@/lib/market-data/derive-historical-analogs";
import { fetchMorningNews } from "@/lib/market-data/fetch-morning-news";
import { getRequiredServerEnv } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dailyEmailImprovementsEnabled } from "@/lib/marketing/daily-email-context";

import {
  DAILY_BRIEFING_MACRO_HEADER_TYPO,
  DAILY_BRIEFING_MAX_ANALOG_MATCHES,
  DAILY_BRIEFING_MAX_HEADLINES,
  DAILY_BRIEFING_MAX_TOKENS,
  DAILY_BRIEFING_MODEL,
  DAILY_BRIEFING_RESPONSE_SCHEMA,
  DAILY_BRIEFING_SECTION_HEADERS,
  EDITORIAL_STOCK_BRIEFING_SYSTEM_PROMPT,
  INSTITUTIONAL_STRATEGIST_SYSTEM_PROMPT,
  LLM_RETRY_OPTIONS,
  NEWS_RETRY_OPTIONS,
} from "./daily-briefing-config";
import { buildResearchBrief } from "./daily-briefing-research";
import {
  type DailyBriefingAnalogMatch,
  type DailyBriefingNewsResult,
  type DailyBriefingQuantContext,
  type DailyBriefingResult,
  type DailyBriefingStressTest,
  type DailyBriefingTraderPlaybook,
  type HistoricalAnalogSnapshot,
  type SnapshotSummary,
  type StoredBiasSnapshot,
} from "./types";
import { extractTradableSignal } from "@/lib/signal/format-tradable-signal";

import { getDailyBriefingStrategy } from "./daily-briefing-strategies";
import { withExponentialBackoff } from "./retry";

const HISTORICAL_ANALOG_PAGE_SIZE = 500;
const MAX_ANALOG_LOOKBACK_YEARS = 10;

type DailyBriefingLLMResponse = {
  is_override_active: boolean;
  newsletter_copy: string;
};

type HistoricalAnalogSummary = Pick<
  HistoricalAnalogsPayload["topMatches"][number],
  "intradayNet" | "matchConfidence" | "nextSessionDate" | "overnightGap" | "sessionRange" | "tradeDate"
>;

type DailyBriefingPromptPayload = {
  analogs: {
    alignedSessionCount: number;
    candidateCount: number;
    clusterAveragePlaybook: {
      intradayNet: number | null;
      overnightGap: number | null;
      sessionRange: number | null;
    };
    topMatches: HistoricalAnalogSummary[];
  };
  analogReference: string | null;
  headlines: string[];
  label: string;
  newsDisclaimer: string | null;
  newsStatus: DailyBriefingNewsResult["status"];
  newsSummary: string;
  playbook: DailyBriefingTraderPlaybook;
  score: number;
  stressTest: DailyBriefingStressTest;
  tradeDate: string;
  publishedScoreContext: DailyBriefingQuantContext["publishedScoreContext"];
  /** Internal limits to explain in plain English, without exposing control fields. */
  tradableSignal: {
    position: string;
    size: number;
    reliability: string;
    neighborAgreement: number;
    distanceQuality: number;
    noTrade: boolean;
    reason: string;
  } | null;
};

type NewsFetchOutcome = {
  news: DailyBriefingNewsResult;
  warnings: string[];
};

type QuantScoreOutcome = {
  quant: DailyBriefingQuantContext;
  warnings: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function subtractYearsFromTradeDate(tradeDate: string, years: number) {
  const referenceDate = new Date(`${tradeDate}T00:00:00Z`);
  referenceDate.setUTCFullYear(referenceDate.getUTCFullYear() - years);
  return referenceDate.toISOString().slice(0, 10);
}

function summarizeHeadlines(headlines: string[]) {
  if (headlines.length === 0) {
    return "Headline scan was sparse. No dominant macro catalyst stood out in the pre-market tape.";
  }

  return headlines.slice(0, 3).join(" | ");
}

function detectOverrideCatalyst(headlines: string[]) {
  // Only match genuine macro shocks — not routine data releases or scheduled events.
  // Words like "fed", "rate", "policy", "treasury", "inflation", "cpi", "payrolls"
  // appear in financial headlines every single day and must NOT trigger an override.
  const overridePatterns = [
    // Military / geopolitical escalation
    /\b(war|invasion|nuclear|missile.{0,8}strike)\b/i,
    // Financial system failure
    /\b(bank.{0,8}(collapse|fail|run)|flash.{0,5}crash|circuit.{0,3}breaker|market.{0,8}(halt|suspend|close))\b/i,
    // Unscheduled / emergency policy action (not scheduled meetings)
    /\bemergency.{0,20}(rate|cut|hike|action|meeting)\b/i,
    // Sovereign / credit crisis
    /\b(sovereign.{0,8}default|debt.{0,8}crisis|liquidity.{0,8}crisis)\b/i,
    // Commodity supply shock (requires shock qualifier, not just mentioning oil/opec)
    /\b(oil.{0,10}shock|energy.{0,8}crisis|opec.{0,10}(emergency|surprise.{0,10}cut))\b/i,
    // New tariff escalation (not ongoing coverage of existing tariffs)
    /\b(tariff.{0,15}(shock|escalat)|major.{0,10}new.{0,10}tariff)\b/i,
    // Sanctions with clear new-action language
    /\b(sanctions?.{0,10}(imposed|announced|expand)|embargo.{0,10}(announced|impos))\b/i,
  ];

  return headlines.find((headline) => overridePatterns.some((pattern) => pattern.test(headline))) ?? null;
}

async function getHistoricalAnalogSnapshots(
  latestTradeDate: string,
): Promise<HistoricalAnalogSnapshot[]> {
  const supabase = createSupabaseAdminClient();
  const tenYearsAgo = subtractYearsFromTradeDate(latestTradeDate, MAX_ANALOG_LOOKBACK_YEARS);
  const historicalSnapshots: HistoricalAnalogSnapshot[] = [];

  for (let offset = 0; ; offset += HISTORICAL_ANALOG_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("macro_bias_scores")
      .select("trade_date, score, bias_label")
      .gte("trade_date", tenYearsAgo)
      .lte("trade_date", latestTradeDate)
      .order("trade_date", { ascending: true })
      .range(offset, offset + HISTORICAL_ANALOG_PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to load historical analog snapshots: ${error.message}`);
    }

    const page = (data as HistoricalAnalogSnapshot[] | null) ?? [];
    historicalSnapshots.push(...page);

    if (page.length < HISTORICAL_ANALOG_PAGE_SIZE) {
      break;
    }
  }

  return historicalSnapshots;
}

function buildPublishedAnalogs(
  historicalAnalogs: HistoricalAnalogsPayload | null,
  snapshotsByDate: Map<string, SnapshotSummary>,
) {
  if (!historicalAnalogs) {
    return [] as DailyBriefingAnalogMatch[];
  }

  return historicalAnalogs.topMatches.map((analog) => {
    const snapshot = snapshotsByDate.get(analog.tradeDate);

    return {
      tradeDate: analog.tradeDate,
      nextSessionDate: analog.nextSessionDate,
      score: snapshot?.score ?? null,
      biasLabel: snapshot?.bias_label ?? null,
      matchConfidence: analog.matchConfidence,
      intradayNet: analog.intradayNet,
      overnightGap: analog.overnightGap,
      sessionRange: analog.sessionRange,
    } satisfies DailyBriefingAnalogMatch;
  });
}

async function fetchNews(): Promise<NewsFetchOutcome> {
  try {
    const headlines = await withExponentialBackoff(
      () => fetchMorningNews(),
      NEWS_RETRY_OPTIONS,
    );

    const normalizedHeadlines = headlines.slice(0, DAILY_BRIEFING_MAX_HEADLINES);

    return {
      news: {
        disclaimer: null,
        headlines: normalizedHeadlines,
        status: "available",
        summary: summarizeHeadlines(normalizedHeadlines),
      },
      warnings: normalizedHeadlines.length === 0
        ? ["News scan returned no qualifying headlines; proceeding with quant-only context."]
        : [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown news fetch failure.";
    const summary = "News Unavailable: Finnhub request failed after retries. Briefing generated from quant data only.";

    return {
      news: {
        disclaimer: summary,
        headlines: [],
        status: "unavailable",
        summary,
      },
      warnings: [`News API degraded: ${message}`],
    };
  }
}

async function getQuantScore(
  latestSnapshot: StoredBiasSnapshot,
  recentSnapshots: StoredBiasSnapshot[],
): Promise<QuantScoreOutcome> {
  try {
    const historicalAnalogSnapshots = await getHistoricalAnalogSnapshots(latestSnapshot.trade_date);
    const snapshotsByDate = new Map<string, SnapshotSummary>([
      ...historicalAnalogSnapshots.map((snapshot) => [snapshot.trade_date, snapshot] as const),
      ...recentSnapshots.map(
        (snapshot) =>
          [
            snapshot.trade_date,
            {
              trade_date: snapshot.trade_date,
              score: snapshot.score,
              bias_label: snapshot.bias_label,
            },
          ] as const,
      ),
    ]);
    const historicalAnalogs = deriveHistoricalAnalogs(
      latestSnapshot.engine_inputs,
      latestSnapshot.component_scores,
      latestSnapshot.technical_indicators,
      {
        applyRegimeFilter: true,
        disablePersistedMatchFallback: true,
        rollingWindowStartDate: subtractYearsFromTradeDate(
          latestSnapshot.trade_date,
          MAX_ANALOG_LOOKBACK_YEARS,
        ),
      },
    );
    const analogs = buildPublishedAnalogs(historicalAnalogs, snapshotsByDate);

    const signal = extractTradableSignal(latestSnapshot.engine_inputs);

    return {
      quant: {
        analogReference:
          analogs[0]?.tradeDate ?? historicalAnalogs?.topMatches[0]?.tradeDate ?? null,
        analogs,
        historicalAnalogs,
        label: latestSnapshot.bias_label,
        score: latestSnapshot.score,
        tradeDate: latestSnapshot.trade_date,
        signal,
        publishedScoreContext: getPublishedScoreContext(latestSnapshot),
      },
      warnings: historicalAnalogs ? [] : ["Historical analog context was unavailable for the briefing."],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown quant context failure.";

    return {
      quant: {
        analogReference: null,
        analogs: [],
        historicalAnalogs: null,
        label: latestSnapshot.bias_label,
        score: latestSnapshot.score,
        tradeDate: latestSnapshot.trade_date,
        signal: extractTradableSignal(latestSnapshot.engine_inputs),
        publishedScoreContext: getPublishedScoreContext(latestSnapshot),
      },
      warnings: [`Quant context degraded: ${message}`],
    };
  }
}

function getPublishedScoreContext(snapshot: StoredBiasSnapshot) {
  const components = Array.isArray(snapshot.component_scores)
    ? snapshot.component_scores.filter(isRecord)
    : [];
  const firstComponent = components[0];
  const engine = isRecord(snapshot.engine_inputs) ? snapshot.engine_inputs : {};
  const tradeWindow = isRecord(engine.tradeWindow) ? engine.tradeWindow : {};
  const finiteNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    averageForward1DayReturn: finiteNumber(firstComponent?.averageForward1DayReturn),
    averageForward3DayReturn: finiteNumber(firstComponent?.averageForward3DayReturn),
    blendedForwardReturn: finiteNumber(engine.blendedForwardReturn),
    componentSummaries: components.flatMap((component) => typeof component.summary === "string" ? [component.summary] : []).slice(0, 4),
    marketDataDate: typeof tradeWindow.latestTradeDate === "string" ? tradeWindow.latestTradeDate : null,
  };
}

function buildPromptPayload(
  quant: DailyBriefingQuantContext,
  news: DailyBriefingNewsResult,
  playbook: DailyBriefingTraderPlaybook,
  stressTest: DailyBriefingStressTest,
): DailyBriefingPromptPayload {
  return {
    tradeDate: quant.tradeDate,
    score: Number(quant.score.toFixed(2)),
    label: quant.label,
    analogReference: quant.analogReference,
    newsStatus: news.status,
    newsSummary: news.summary,
    newsDisclaimer: news.disclaimer,
    headlines: news.headlines.slice(0, DAILY_BRIEFING_MAX_HEADLINES),
    publishedScoreContext: quant.publishedScoreContext,
    playbook,
    stressTest,
    tradableSignal: quant.signal
      ? {
          position: quant.signal.position,
          size: quant.signal.size,
          reliability: quant.signal.reliability,
          neighborAgreement: quant.signal.neighborAgreement,
          distanceQuality: quant.signal.distanceQuality,
          noTrade: quant.signal.noTrade,
          reason: quant.signal.reason,
        }
      : null,
    analogs: {
      alignedSessionCount: quant.historicalAnalogs?.alignedSessionCount ?? 0,
      candidateCount: quant.historicalAnalogs?.candidateCount ?? 0,
      clusterAveragePlaybook: {
        intradayNet: quant.historicalAnalogs?.clusterAveragePlaybook.intradayNet ?? null,
        overnightGap: quant.historicalAnalogs?.clusterAveragePlaybook.overnightGap ?? null,
        sessionRange: quant.historicalAnalogs?.clusterAveragePlaybook.sessionRange ?? null,
      },
      topMatches:
        quant.historicalAnalogs?.topMatches.slice(0, DAILY_BRIEFING_MAX_ANALOG_MATCHES).map(
          (match) => ({
            tradeDate: match.tradeDate,
            nextSessionDate: match.nextSessionDate,
            matchConfidence: match.matchConfidence,
            overnightGap: match.overnightGap,
            intradayNet: match.intradayNet,
            sessionRange: match.sessionRange,
          }),
        ) ?? [],
    },
  };
}

function buildDailyBriefingPrompt(
  quant: DailyBriefingQuantContext,
  news: DailyBriefingNewsResult,
  strategyContext: ReturnType<typeof getStrategyContext>,
) {
  const promptPayload = buildPromptPayload(
    quant,
    news,
    strategyContext.playbook,
    strategyContext.stressTest,
  );

  return [
    strategyContext.strategy.buildPromptContext(strategyContext),
    "Structured market context follows as JSON:",
    JSON.stringify(promptPayload, null, 2),
  ].join("\n\n");
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

function isDailyBriefingLLMResponse(value: unknown): value is DailyBriefingLLMResponse {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value);

  return (
    keys.length === 2 &&
    keys.includes("is_override_active") &&
    keys.includes("newsletter_copy") &&
    typeof value.is_override_active === "boolean" &&
    typeof value.newsletter_copy === "string" &&
    value.newsletter_copy.trim().length > 0
  );
}

function normalizeNewsletterCopy(newsletterCopy: string) {
  return newsletterCopy.replace(/\r\n/g, "\n").replaceAll(
    DAILY_BRIEFING_MACRO_HEADER_TYPO,
    DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus,
  );
}

const BANNED_NEWSLETTER_PHRASES = [
  "until the dust clears",
  "tail risk",
  "layered on top",
  "the real weight",
  "poison",
  "isolate from the noise",
  "could surprise in either direction",
  "before lunch",
  "first hour",
  "participation flows",
  "broke the anchor",
  "capitulation into weakness",
  "fade headlines",
  "chase headlines",
  "the real trap",
  "front and center",
  "stops caring",
] as const;

function countSentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0).length;
}

function splitNewsletterSections(newsletterCopy: string) {
  const normalized = normalizeNewsletterCopy(newsletterCopy).trim();
  const headers = [
    DAILY_BRIEFING_SECTION_HEADERS.bottomLine,
    DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook,
    DAILY_BRIEFING_SECTION_HEADERS.stressTest,
    DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus,
    DAILY_BRIEFING_SECTION_HEADERS.quantCorner,
  ];
  const matches = [...normalized.matchAll(
    new RegExp(`^(${headers.map((header) => header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[ \\t]*(?::[ \\t]*(.*))?$`, "gm"),
  )];

  if (matches.length !== headers.length || matches.some((match, index) => match[1] !== headers[index])) {
    return null;
  }

  const sections = new Map<string, string>();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const title = match[1];
    const start = match.index! + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index! : normalized.length;
    const content = [match[2] ?? "", normalized.slice(start, end)].join("\n").trim();
    sections.set(title, content);
  }

  return {
    normalized,
    sections,
  };
}

function validateNewsletterCopy(newsletterCopy: string, editorialEnabled = false) {
  if (/\b(?:NO_TRADE|Permission\s*:|Reliability\s+[A-F]\b|rel\s+[A-F]\b|Size\s+\d+%)/i.test(newsletterCopy)) {
    throw new Error("Anthropic daily briefing exposed model control fields.");
  }

  const parsed = splitNewsletterSections(newsletterCopy);

  if (!parsed) {
    throw new Error("Anthropic daily briefing failed section parsing.");
  }

  const lowerCopy = parsed.normalized.toLowerCase();
  const bannedPhrase = BANNED_NEWSLETTER_PHRASES.find((phrase) =>
    lowerCopy.includes(phrase.toLowerCase()),
  );

  if (bannedPhrase) {
    throw new Error(`Anthropic daily briefing used banned phrasing: "${bannedPhrase}".`);
  }

  const regimeStatus = parsed.sections.get(DAILY_BRIEFING_SECTION_HEADERS.bottomLine) ?? "";
  const tradingImplication = parsed.sections.get(DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook) ?? "";
  const baseScore = parsed.sections.get(DAILY_BRIEFING_SECTION_HEADERS.stressTest) ?? "";
  const whyItMatters = parsed.sections.get(DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus) ?? "";
  const modelContext = parsed.sections.get(DAILY_BRIEFING_SECTION_HEADERS.quantCorner) ?? "";

  const boundedSentences = (content: string, legacyCount: number) => {
    const count = countSentences(content);
    return editorialEnabled ? count >= 1 && count <= 3 : count === legacyCount;
  };

  if (!boundedSentences(regimeStatus, 1)) {
    throw new Error(editorialEnabled
      ? "Anthropic daily briefing regime status must contain 1 to 3 sentences."
      : "Anthropic daily briefing regime status must be exactly 1 sentence.");
  }

  const tradingImplicationLines = tradingImplication
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (tradingImplicationLines.length !== 3) {
    throw new Error("Anthropic daily briefing trading implication section must contain exactly 3 bullets.");
  }

  const expectedBulletPrefixes = ["- **Setup:**", "- **Focus:**", "- **Risk:**"];

  expectedBulletPrefixes.forEach((prefix, index) => {
    if (!tradingImplicationLines[index]?.startsWith(prefix)) {
      throw new Error(`Anthropic daily briefing trading implication bullet ${index + 1} is malformed.`);
    }
  });

  if (!boundedSentences(baseScore, 1)) {
    throw new Error(editorialEnabled
      ? "Anthropic daily briefing base score section must contain 1 to 3 sentences."
      : "Anthropic daily briefing base score section must be exactly 1 sentence.");
  }

  if (!boundedSentences(whyItMatters, 2)) {
    throw new Error(editorialEnabled
      ? "Anthropic daily briefing why it matters section must contain 1 to 3 sentences."
      : "Anthropic daily briefing why it matters section must be exactly 2 sentences.");
  }

  const modelContextLines = modelContext
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const diagnosticIndex = modelContextLines.findIndex((line) => line.startsWith("Model Diagnostics:"));
  const narrativeLines = diagnosticIndex === -1 ? modelContextLines : modelContextLines.slice(0, diagnosticIndex);
  if (!boundedSentences(narrativeLines.join(" "), 2)) {
    throw new Error(editorialEnabled
      ? "Anthropic daily briefing model context must begin with 1 to 3 sentences."
      : "Anthropic daily briefing model context must begin with exactly 2 sentences.");
  }

  if (diagnosticIndex !== -1 && diagnosticIndex !== modelContextLines.length - 1) {
    throw new Error("Anthropic daily briefing model context diagnostics line is malformed.");
  }
}

function tryParseDailyBriefingJson(rawResponse: string) {
  try {
    const parsedResponse = JSON.parse(rawResponse);

    return isDailyBriefingLLMResponse(parsedResponse) ? parsedResponse : null;
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

function tryParsePseudoJsonDailyBriefing(rawResponse: string): DailyBriefingLLMResponse | null {
  const overrideMatch = rawResponse.match(/"is_override_active"\s*:\s*(true|false)/i);
  const newsletterMatch = rawResponse.match(/"newsletter_copy"\s*:\s*"([\s\S]*)"\s*}\s*$/);

  if (!newsletterMatch) {
    return null;
  }

  const normalizedNewsletterCopy = normalizeNewsletterCopy(
    newsletterMatch[1]
      .replace(/\\r/g, "\r")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\"),
  ).trim();

  return {
    is_override_active: overrideMatch
      ? overrideMatch[1].toLowerCase() === "true"
      : inferOverrideFromNewsletterCopy(normalizedNewsletterCopy),
    newsletter_copy: normalizedNewsletterCopy,
  };
}

function looksLikeNewsletterCopy(newsletterCopy: string) {
  return Object.values(DAILY_BRIEFING_SECTION_HEADERS).every((sectionHeader) =>
    newsletterCopy.includes(sectionHeader),
  );
}

function inferOverrideFromNewsletterCopy(newsletterCopy: string) {
  const normalized = normalizeNewsletterCopy(newsletterCopy);

  if (/\bOverride active:\b/i.test(normalized) || /\bPattern broken\b/i.test(normalized)) {
    return true;
  }

  if (/\bPattern intact\b/i.test(normalized) || /\bPattern shaky\b/i.test(normalized)) {
    return false;
  }

  return /\bOverride ACTIVE\b/i.test(normalized);
}

function parseDailyBriefingResponse(rawResponse: string, editorialEnabled = false): DailyBriefingLLMResponse {
  const parsedResponse = tryParseDailyBriefingJson(rawResponse);

  if (parsedResponse) {
    const normalizedNewsletterCopy = normalizeNewsletterCopy(parsedResponse.newsletter_copy).trim();
    validateNewsletterCopy(normalizedNewsletterCopy, editorialEnabled);

    return {
      is_override_active: parsedResponse.is_override_active,
      newsletter_copy: normalizedNewsletterCopy,
    };
  }

  const embeddedJson = extractEmbeddedJson(rawResponse);
  const parsedEmbeddedResponse = embeddedJson ? tryParseDailyBriefingJson(embeddedJson) : null;

  if (parsedEmbeddedResponse) {
    const normalizedNewsletterCopy = normalizeNewsletterCopy(parsedEmbeddedResponse.newsletter_copy).trim();
    validateNewsletterCopy(normalizedNewsletterCopy, editorialEnabled);

    return {
      is_override_active: parsedEmbeddedResponse.is_override_active,
      newsletter_copy: normalizedNewsletterCopy,
    };
  }

  const pseudoJsonResponse = tryParsePseudoJsonDailyBriefing(rawResponse);

  if (pseudoJsonResponse) {
    validateNewsletterCopy(pseudoJsonResponse.newsletter_copy, editorialEnabled);
    return pseudoJsonResponse;
  }

  const normalizedNewsletter = normalizeNewsletterCopy(rawResponse).trim();

  if (looksLikeNewsletterCopy(normalizedNewsletter)) {
    validateNewsletterCopy(normalizedNewsletter, editorialEnabled);
    return {
      is_override_active: inferOverrideFromNewsletterCopy(normalizedNewsletter),
      newsletter_copy: normalizedNewsletter,
    };
  }

  throw new Error("Anthropic daily briefing response was not valid JSON.");
}

function assertEditorialStockClaims(
  newsletterCopy: string,
  quant: DailyBriefingQuantContext,
  news: DailyBriefingNewsResult,
  context: ReturnType<typeof getStrategyContext>,
) {
  const sections = splitNewsletterSections(newsletterCopy)?.sections;
  // Base score and historical context are replaced with recorded facts below.
  const narrative = [
    sections?.get(DAILY_BRIEFING_SECTION_HEADERS.bottomLine),
    sections?.get(DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook),
    sections?.get(DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus),
  ].filter(Boolean).join("\n");
  const personalAuthor = /\bI(?:['’](?:m|ve|d|ll))?\b|\b(?:my|mine)\b/i;
  const personalTeamExperience = /\bwe(?:['’](?:ve|d|re))?\s+(?:(?:have|had|were|are|personally)\s+)?(?:bought|buy(?:ing)?|sold|sell(?:ing)?|trad(?:e|ed|ing)|felt|feel(?:ing)?|spoke|speak(?:ing)?|met|meet(?:ing)?|watch(?:ed|ing)?)\b|\bour\s+(?:(?:own|personal|live|current|long|short)\s+)?(?:positions?|trades?|portfolios?)\b/i;
  if (personalAuthor.test(narrative) || personalTeamExperience.test(narrative)) {
    throw new Error("Anthropic daily briefing invented a personal author perspective.");
  }
  const numericClaims = (value: string) => [...value.matchAll(
    /(\$?)\s*([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(\s*(?:%|percent(?:age points)?))?/gi,
  )].map((match) => {
    const unit = match[1] ? "$" : match[3] ? "%" : "number";
    return `${unit}:${Number(match[2].replaceAll(",", ""))}`;
  });
  const recordedPercentages = [
    quant.publishedScoreContext?.averageForward1DayReturn,
    quant.publishedScoreContext?.averageForward3DayReturn,
    ...quant.analogs.flatMap((match) => [match.intradayNet, match.overnightGap, match.sessionRange]),
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map((value) => `${value.toFixed(2)}%`).join(" ");
  const source = JSON.stringify(buildPromptPayload(quant, news, context.playbook, context.stressTest));
  const allowed = new Set(numericClaims(`${source} ${recordedPercentages} ${quant.score.toFixed(0)} 0 1 3 100`));
  if (numericClaims(narrative).some((claim) => !allowed.has(claim))) {
    throw new Error("Anthropic daily briefing added a numerical claim absent from the supplied inputs.");
  }
}

function getStrategyContext(
  quant: DailyBriefingQuantContext,
  news: DailyBriefingNewsResult,
  editorialEnabled = dailyEmailImprovementsEnabled(),
) {
  const catalyst = detectOverrideCatalyst(news.headlines);
  const suggestedOverrideActive = catalyst !== null && news.status === "available";
  const strategy = getDailyBriefingStrategy(news, editorialEnabled);
  const researchBrief = buildResearchBrief({
    catalyst,
    news,
    quant,
    suggestedOverrideActive,
  });

  return {
    catalyst,
    news,
    playbook: researchBrief.playbook,
    quant,
    strategy,
    suggestedOverrideActive,
    stressTest: researchBrief.stressTest,
  };
}

async function generateAnthropicBriefing(
  quant: DailyBriefingQuantContext,
  news: DailyBriefingNewsResult,
  editorialEnabled = dailyEmailImprovementsEnabled(),
) {
  const anthropic = new Anthropic({
    apiKey: getRequiredServerEnv("ANTHROPIC_API_KEY"),
  });
  const strategyContext = getStrategyContext(quant, news, editorialEnabled);

  const response = await withExponentialBackoff(
    () =>
      anthropic.messages.create({
        model: DAILY_BRIEFING_MODEL,
        max_tokens: DAILY_BRIEFING_MAX_TOKENS,
        system: editorialEnabled ? EDITORIAL_STOCK_BRIEFING_SYSTEM_PROMPT : INSTITUTIONAL_STRATEGIST_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildDailyBriefingPrompt(quant, news, strategyContext),
          },
        ],
        output_config: {
          format: {
            type: "json_schema",
            schema: DAILY_BRIEFING_RESPONSE_SCHEMA,
          },
        },
      }),
    LLM_RETRY_OPTIONS,
  );
  const rawResponse = extractTextResponse(response.content);

  if (!rawResponse) {
    throw new Error("Anthropic daily briefing response did not include text content.");
  }

  const parsed = parseDailyBriefingResponse(rawResponse, editorialEnabled);
  if (editorialEnabled) assertEditorialStockClaims(parsed.newsletter_copy, quant, news, strategyContext);
  // A missing news feed cannot support a newly generated event override.
  const overrideActive = editorialEnabled
    ? parsed.is_override_active && news.status === "available" && news.headlines.length > 0
    : parsed.is_override_active;
  const factualFallback = strategyContext.strategy.buildFallbackBriefing({
    ...strategyContext,
    suggestedOverrideActive: overrideActive,
  });
  const factualDiagnostics = factualFallback.match(/^Model Diagnostics:.*$/m)?.[0];
  let newsletterCopy = factualDiagnostics
    ? parsed.newsletter_copy.replace(/^[ \t]*Model Diagnostics:.*$/m, factualDiagnostics)
    : parsed.newsletter_copy;
  const factualBaseScore = splitNewsletterSections(factualFallback)?.sections.get(DAILY_BRIEFING_SECTION_HEADERS.stressTest);
  if (factualBaseScore) {
    newsletterCopy = newsletterCopy.replace(
      /^BASE SCORE[ \t]*(?::[^\n]*)?[\s\S]*?(?=^WHY IT MATTERS)/m,
      `${DAILY_BRIEFING_SECTION_HEADERS.stressTest}: ${factualBaseScore}\n\n`,
    );
  }
  // These averages describe the analog set, never the single closest session.
  // Keep AI interpretation elsewhere while grounding the compact factual section.
  if (editorialEnabled || (quant.publishedScoreContext?.averageForward1DayReturn != null &&
      quant.publishedScoreContext?.averageForward3DayReturn != null)) {
    const modelContext = factualFallback.slice(factualFallback.indexOf(DAILY_BRIEFING_SECTION_HEADERS.quantCorner));
    newsletterCopy = newsletterCopy.replace(/^MODEL CONTEXT[ \t]*(?::[^\n]*)?[\s\S]*$/m, modelContext);
  }
  if (editorialEnabled && (quant.signal?.noTrade || parsed.is_override_active !== overrideActive)) {
    // Do not leave an enthusiastic playbook or invented event narrative beneath a cautious lead.
    newsletterCopy = factualFallback;
  }
  return {
    ...parsed,
    is_override_active: overrideActive,
    newsletter_copy: newsletterCopy,
  };
}

async function synthesizeDailyBriefingFromContext(
  quant: DailyBriefingQuantContext,
  news: DailyBriefingNewsResult,
  warnings: string[],
): Promise<DailyBriefingResult> {
  const editorialEnabled = dailyEmailImprovementsEnabled();
  const strategyContext = getStrategyContext(quant, news, editorialEnabled);

  try {
    const response = await generateAnthropicBriefing(quant, news, editorialEnabled);

    return {
      generatedBy: "anthropic",
      isOverrideActive: response.is_override_active,
      model: DAILY_BRIEFING_MODEL,
      news,
      newsletterCopy: response.newsletter_copy,
      playbook: strategyContext.playbook,
      quant,
      stressTest: strategyContext.stressTest,
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM generation failure.";

    warnings.push(`LLM synthesis degraded: ${message}`);

    return {
      generatedBy: "fallback",
      isOverrideActive: strategyContext.suggestedOverrideActive,
      model: "deterministic-fallback",
      news,
      newsletterCopy: strategyContext.strategy.buildFallbackBriefing(strategyContext),
      playbook: strategyContext.playbook,
      quant,
      stressTest: strategyContext.stressTest,
      warnings,
    };
  }
}

export async function generateDailyBriefingFromContext(
  quant: DailyBriefingQuantContext,
  news: DailyBriefingNewsResult,
): Promise<DailyBriefingResult> {
  return synthesizeDailyBriefingFromContext(quant, news, []);
}

export async function generateDailyBriefing(
  latestSnapshot: StoredBiasSnapshot,
  recentSnapshots: StoredBiasSnapshot[],
): Promise<DailyBriefingResult> {
  const [newsOutcome, quantOutcome] = await Promise.all([
    fetchNews(),
    getQuantScore(latestSnapshot, recentSnapshots),
  ]);
  const warnings = [...newsOutcome.warnings, ...quantOutcome.warnings];

  return synthesizeDailyBriefingFromContext(quantOutcome.quant, newsOutcome.news, warnings);
}
