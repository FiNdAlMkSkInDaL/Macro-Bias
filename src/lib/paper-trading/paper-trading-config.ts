import type {
  PaperTradingAsset,
  PaperTradingDecision,
  PaperTradingMarketCalendarContext,
  PaperTradingPortfolioState,
  PaperTradingPriceSourceName,
} from "./types";

export const PAPER_TRADING_AGENT_NAME = "macro-bias-paper-trading-agent";
export const PAPER_TRADING_PROMPT_VERSION = "paper-trading-agent-v1";
export const PAPER_TRADING_MODEL = "claude-haiku-4-5";
export const PAPER_TRADING_SUPPORTED_ASSET: PaperTradingAsset = "SPY";
export const PAPER_TRADING_ALLOWED_DECISIONS: PaperTradingDecision[] = ["BUY", "SELL", "HOLD"];
export const PAPER_TRADING_STARTING_CASH = 100_000;
export const PAPER_TRADING_TARGET_WEIGHT_TOLERANCE = 0.0005;
export const PAPER_TRADING_PRICE_SOURCE: PaperTradingPriceSourceName = "etf_daily_prices.close";
export const PAPER_TRADING_MARKET_TIME_ZONE = "America/New_York";
export const PAPER_TRADING_ALLOW_SHORT = false as const;
export const PAPER_TRADING_ALLOW_LEVERAGE = false as const;
export const PAPER_TRADING_DECISION_MAX_TOKENS = 600;
export const PAPER_TRADING_MAX_REASONING_SUMMARY_LENGTH = 320;
export const PAPER_TRADING_MAX_RISK_FLAGS = 10;

export const PAPER_TRADING_LLM_RETRY_OPTIONS = {
  baseDelayMs: 1_000,
  maxAttempts: 3,
  maxDelayMs: 6_000,
  operationName: "anthropic paper trade decision generation",
} as const;

export const PAPER_TRADING_SYSTEM_PROMPT = [
  "You are the Macro Bias paper trading agent for a simulated portfolio.",
  "You manage only two holdings: **SPY** and USD cash.",
  "Use only the structured JSON provided in the user message.",
  "Do not use external news, prior market knowledge, or unstated assumptions.",
  "Return strict JSON only. No markdown fences. No prose outside the JSON object.",
  "",
  "OBJECTIVE:",
  "Choose whether the simulated portfolio should increase SPY exposure, decrease SPY exposure, or hold its current allocation for this session.",
  "",
  "TRADING RULES:",
  "- Allowed decisions are BUY, SELL, and HOLD.",
  "- No leverage.",
  "- No shorting.",
  "- target_spy_weight must be between 0 and 1.",
  "- target_cash_weight must be between 0 and 1.",
  `- target_spy_weight plus target_cash_weight must equal 1.0 within ${PAPER_TRADING_TARGET_WEIGHT_TOLERANCE.toFixed(4)}.`,
  `- HOLD means keep the current weights unchanged within ${PAPER_TRADING_TARGET_WEIGHT_TOLERANCE.toFixed(4)}.`,
  `- BUY means target_spy_weight must be higher than the current SPY weight by more than ${PAPER_TRADING_TARGET_WEIGHT_TOLERANCE.toFixed(4)}.`,
  `- SELL means target_spy_weight must be lower than the current SPY weight by more than ${PAPER_TRADING_TARGET_WEIGHT_TOLERANCE.toFixed(4)}.`,
  "- If the inputs are mixed or weak, prefer HOLD over forcing a trade.",
  "- If is_override_active is true or news_status is unavailable, treat that as a caution signal and reduce conviction unless the quant evidence is still clear.",
  "",
  "OUTPUT RULES:",
  "- conviction_score must be an integer from 0 to 100.",
  "- reasoning_summary must be one or two short sentences grounded only in the provided briefing and quant inputs.",
  "- risk_flags must be concise snake_case strings.",
  "- Never mention outside research, missing browsing, or hidden tools.",
].join("\n");

export const PAPER_TRADING_DECISION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "decision",
    "target_spy_weight",
    "target_cash_weight",
    "conviction_score",
    "reasoning_summary",
    "risk_flags",
  ],
  properties: {
    decision: {
      type: "string",
      enum: PAPER_TRADING_ALLOWED_DECISIONS,
    },
    target_spy_weight: {
      type: "number",
    },
    target_cash_weight: {
      type: "number",
    },
    conviction_score: {
      type: "integer",
    },
    reasoning_summary: {
      type: "string",
    },
    risk_flags: {
      type: "array",
      items: {
        type: "string",
      },
    },
  },
} satisfies Record<string, unknown>;

const WEEKDAY_INDEX_BY_LABEL = {
  Fri: 5,
  Mon: 1,
  Sat: 6,
  Sun: 0,
  Thu: 4,
  Tue: 2,
  Wed: 3,
} as const;

function roundToMetric(value: number, decimals: number) {
  return Number(value.toFixed(decimals));
}

export function normalizePaperTradingWeight(value: number) {
  return roundToMetric(value, 4);
}

export function normalizePaperTradingCurrency(value: number) {
  return roundToMetric(value, 4);
}

export function normalizePaperTradingQuantity(value: number) {
  return roundToMetric(value, 6);
}

export function getPaperTradingMarketCalendarContext(
  now = new Date(),
): PaperTradingMarketCalendarContext {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: PAPER_TRADING_MARKET_TIME_ZONE,
    weekday: "short",
    year: "numeric",
  });
  const parts = new Map(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value] as const),
  );
  const weekdayLabel = parts.get("weekday");
  const year = parts.get("year");
  const month = parts.get("month");
  const day = parts.get("day");

  if (!weekdayLabel || !year || !month || !day) {
    throw new Error("Failed to derive the paper-trading market calendar context.");
  }

  const dayOfWeek = WEEKDAY_INDEX_BY_LABEL[weekdayLabel as keyof typeof WEEKDAY_INDEX_BY_LABEL];

  if (dayOfWeek == null) {
    throw new Error(`Unsupported market weekday label: ${weekdayLabel}`);
  }

  return {
    briefingDate: `${year}-${month}-${day}`,
    isMonday: dayOfWeek === 1,
    isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    marketTimeZone: PAPER_TRADING_MARKET_TIME_ZONE,
  };
}

export function buildInitialPaperTradingPortfolioState(
  markPrice: number,
  pricingTradeDate: string,
): PaperTradingPortfolioState {
  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    throw new Error("Initial paper-trading state requires a positive SPY mark price.");
  }

  return {
    snapshotSource: "initial",
    snapshotId: null,
    paperTradingRunId: null,
    briefingDate: null,
    pricingTradeDate,
    asset: PAPER_TRADING_SUPPORTED_ASSET,
    cashBalance: normalizePaperTradingCurrency(PAPER_TRADING_STARTING_CASH),
    positionQuantity: 0,
    positionAvgCost: null,
    markPrice: normalizePaperTradingCurrency(markPrice),
    positionMarketValue: 0,
    totalEquity: normalizePaperTradingCurrency(PAPER_TRADING_STARTING_CASH),
    dailyPnl: 0,
    dailyReturnPct: 0,
    totalReturnPct: 0,
    cashWeight: 1,
    assetWeight: 0,
    createdAt: null,
    updatedAt: null,
  };
}
