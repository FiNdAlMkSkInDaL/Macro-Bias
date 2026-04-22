import "server-only";

import type { BiasComponentResult, BiasLabel, TickerChangeMap } from "@/lib/macro-bias/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import {
  buildInitialPaperTradingPortfolioState,
  normalizePaperTradingCurrency,
  normalizePaperTradingQuantity,
  normalizePaperTradingWeight,
  PAPER_TRADING_ALLOWED_DECISIONS,
  PAPER_TRADING_ALLOW_LEVERAGE,
  PAPER_TRADING_ALLOW_SHORT,
  PAPER_TRADING_PRICE_SOURCE,
  PAPER_TRADING_STARTING_CASH,
  PAPER_TRADING_SUPPORTED_ASSET,
  getPaperTradingMarketCalendarContext,
} from "./paper-trading-config";
import type {
  LoadPaperTradingContextOptions,
  PaperTradingBiasScoreSource,
  PaperTradingBriefingSource,
  PaperTradingContextLoadResult,
  PaperTradingGenerationMethod,
  PaperTradingNewsStatus,
  PaperTradingPortfolioSnapshotRow,
  PaperTradingPortfolioState,
  PaperTradingPriceSource,
  PaperTradingRunRow,
  PaperTradingRunStatus,
} from "./types";

type PaperTradingAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type DailyMarketBriefingRecord = {
  id: string;
  briefing_date: string;
  trade_date: string;
  quant_score: unknown;
  bias_label: unknown;
  is_override_active: boolean;
  news_status: unknown;
  news_summary: string;
  news_headlines: unknown;
  analog_reference: string | null;
  brief_content: string;
  source_model: string;
  generation_method: unknown;
  generated_at: string;
};

type MacroBiasScoreRecord = {
  id: string;
  trade_date: string;
  score: unknown;
  bias_label: unknown;
  component_scores: unknown;
  ticker_changes: unknown;
  engine_inputs: unknown;
  technical_indicators: unknown;
  model_version: string | null;
  created_at: string;
  updated_at: string;
};

type PriceRecord = {
  ticker: string;
  trade_date: string;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  adjusted_close: unknown;
  volume: unknown;
  source: string;
};

type PortfolioSnapshotRecord = {
  id: string;
  paper_trading_run_id: string;
  briefing_date: string;
  pricing_trade_date: string;
  asset: string;
  cash_balance: unknown;
  position_quantity: unknown;
  position_avg_cost: unknown;
  mark_price: unknown;
  position_market_value: unknown;
  total_equity: unknown;
  daily_pnl: unknown;
  daily_return_pct: unknown;
  total_return_pct: unknown;
  cash_weight: unknown;
  asset_weight: unknown;
  created_at: string;
  updated_at: string;
};

type PaperTradingRunRecord = {
  id: string;
  briefing_date: string;
  source_trade_date: string;
  daily_market_briefing_id: string;
  macro_bias_score_id: string;
  asset: string;
  decision: unknown;
  target_spy_weight: unknown;
  target_cash_weight: unknown;
  conviction_score: unknown;
  reasoning_summary: string;
  risk_flags: unknown;
  prompt_version: string;
  source_model: string;
  generation_method: unknown;
  prompt_payload: unknown;
  decision_payload: unknown;
  raw_response: string | null;
  status: unknown;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

const VALID_BIAS_LABELS = new Set<BiasLabel>([
  "EXTREME_RISK_OFF",
  "RISK_OFF",
  "NEUTRAL",
  "RISK_ON",
  "EXTREME_RISK_ON",
]);
const VALID_NEWS_STATUSES = new Set<PaperTradingNewsStatus>(["available", "unavailable"]);
const VALID_GENERATION_METHODS = new Set<PaperTradingGenerationMethod>(["anthropic", "fallback"]);
const VALID_RUN_STATUSES = new Set<PaperTradingRunStatus>(["pending", "completed", "failed"]);
const VALID_DECISIONS = new Set<PaperTradingRunRow["decision"]>(["BUY", "SELL", "HOLD"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRequiredString(value: unknown, fieldName: string) {
  if (typeof value !== "string") {
    throw new Error(`Expected ${fieldName} to be a string.`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`Expected ${fieldName} to be a non-empty string.`);
  }

  return normalized;
}

function getOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function getRequiredNumber(value: unknown, fieldName: string) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error(`Expected ${fieldName} to be a numeric value.`);
}

function getOptionalNumber(value: unknown) {
  if (value == null) {
    return null;
  }

  return getRequiredNumber(value, "optional numeric field");
}

function getStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function getObjectOrNull(value: unknown) {
  return isRecord(value) ? value : null;
}

function getObjectOrThrow(value: unknown, fieldName: string) {
  if (!isRecord(value)) {
    throw new Error(`Expected ${fieldName} to be an object.`);
  }

  return value;
}

function getBiasLabel(value: unknown, fieldName: string): BiasLabel {
  const normalized = getRequiredString(value, fieldName);

  if (!VALID_BIAS_LABELS.has(normalized as BiasLabel)) {
    throw new Error(`Unsupported ${fieldName}: ${normalized}`);
  }

  return normalized as BiasLabel;
}

function getNewsStatus(value: unknown): PaperTradingNewsStatus {
  const normalized = getRequiredString(value, "news_status");

  if (!VALID_NEWS_STATUSES.has(normalized as PaperTradingNewsStatus)) {
    throw new Error(`Unsupported news_status: ${normalized}`);
  }

  return normalized as PaperTradingNewsStatus;
}

function getGenerationMethod(value: unknown, fieldName: string): PaperTradingGenerationMethod {
  const normalized = getRequiredString(value, fieldName);

  if (!VALID_GENERATION_METHODS.has(normalized as PaperTradingGenerationMethod)) {
    throw new Error(`Unsupported ${fieldName}: ${normalized}`);
  }

  return normalized as PaperTradingGenerationMethod;
}

function getRunStatus(value: unknown): PaperTradingRunStatus {
  const normalized = getRequiredString(value, "status");

  if (!VALID_RUN_STATUSES.has(normalized as PaperTradingRunStatus)) {
    throw new Error(`Unsupported paper trading run status: ${normalized}`);
  }

  return normalized as PaperTradingRunStatus;
}

function getDecision(value: unknown) {
  const normalized = getRequiredString(value, "decision");

  if (!VALID_DECISIONS.has(normalized as PaperTradingRunRow["decision"])) {
    throw new Error(`Unsupported paper trading decision: ${normalized}`);
  }

  return normalized as PaperTradingRunRow["decision"];
}

function normalizeBriefingRecord(record: DailyMarketBriefingRecord): PaperTradingBriefingSource {
  return {
    id: getRequiredString(record.id, "daily_market_briefings.id"),
    briefingDate: getRequiredString(record.briefing_date, "daily_market_briefings.briefing_date"),
    tradeDate: getRequiredString(record.trade_date, "daily_market_briefings.trade_date"),
    quantScore: getRequiredNumber(record.quant_score, "daily_market_briefings.quant_score"),
    biasLabel: getBiasLabel(record.bias_label, "daily_market_briefings.bias_label"),
    isOverrideActive: record.is_override_active,
    newsStatus: getNewsStatus(record.news_status),
    newsSummary: getRequiredString(record.news_summary, "daily_market_briefings.news_summary"),
    newsHeadlines: getStringArray(record.news_headlines),
    analogReference: getOptionalString(record.analog_reference),
    briefContent: getRequiredString(record.brief_content, "daily_market_briefings.brief_content"),
    sourceModel: getRequiredString(record.source_model, "daily_market_briefings.source_model"),
    generationMethod: getGenerationMethod(
      record.generation_method,
      "daily_market_briefings.generation_method",
    ),
    generatedAt: getRequiredString(record.generated_at, "daily_market_briefings.generated_at"),
  };
}

function normalizeBiasScoreRecord(record: MacroBiasScoreRecord): PaperTradingBiasScoreSource {
  const componentScores = record.component_scores;
  const tickerChanges = record.ticker_changes;

  if (!Array.isArray(componentScores)) {
    throw new Error("macro_bias_scores.component_scores must be an array.");
  }

  if (!isRecord(tickerChanges)) {
    throw new Error("macro_bias_scores.ticker_changes must be an object.");
  }

  return {
    id: getRequiredString(record.id, "macro_bias_scores.id"),
    tradeDate: getRequiredString(record.trade_date, "macro_bias_scores.trade_date"),
    score: getRequiredNumber(record.score, "macro_bias_scores.score"),
    biasLabel: getBiasLabel(record.bias_label, "macro_bias_scores.bias_label"),
    componentScores: componentScores as BiasComponentResult[],
    tickerChanges: tickerChanges as TickerChangeMap,
    engineInputs: getObjectOrNull(record.engine_inputs),
    technicalIndicators: getObjectOrNull(record.technical_indicators),
    modelVersion: getOptionalString(record.model_version),
    createdAt: getRequiredString(record.created_at, "macro_bias_scores.created_at"),
    updatedAt: getRequiredString(record.updated_at, "macro_bias_scores.updated_at"),
  };
}

function normalizePriceRecord(record: PriceRecord): PaperTradingPriceSource {
  const asset = getRequiredString(record.ticker, "etf_daily_prices.ticker");

  if (asset !== PAPER_TRADING_SUPPORTED_ASSET) {
    throw new Error(`Unsupported paper trading asset in etf_daily_prices: ${asset}`);
  }

  return {
    asset: PAPER_TRADING_SUPPORTED_ASSET,
    tradeDate: getRequiredString(record.trade_date, "etf_daily_prices.trade_date"),
    open: normalizePaperTradingCurrency(getRequiredNumber(record.open, "etf_daily_prices.open")),
    high: normalizePaperTradingCurrency(getRequiredNumber(record.high, "etf_daily_prices.high")),
    low: normalizePaperTradingCurrency(getRequiredNumber(record.low, "etf_daily_prices.low")),
    close: normalizePaperTradingCurrency(getRequiredNumber(record.close, "etf_daily_prices.close")),
    adjustedClose: normalizePaperTradingCurrency(
      getRequiredNumber(record.adjusted_close, "etf_daily_prices.adjusted_close"),
    ),
    volume: getRequiredNumber(record.volume, "etf_daily_prices.volume"),
    source: getRequiredString(record.source, "etf_daily_prices.source"),
  };
}

function normalizePaperTradingRunRecord(record: PaperTradingRunRecord): PaperTradingRunRow {
  const asset = getRequiredString(record.asset, "paper_trading_runs.asset");

  if (asset !== PAPER_TRADING_SUPPORTED_ASSET) {
    throw new Error(`Unsupported paper_trading_runs.asset value: ${asset}`);
  }

  return {
    id: getRequiredString(record.id, "paper_trading_runs.id"),
    briefingDate: getRequiredString(record.briefing_date, "paper_trading_runs.briefing_date"),
    sourceTradeDate: getRequiredString(record.source_trade_date, "paper_trading_runs.source_trade_date"),
    dailyMarketBriefingId: getRequiredString(
      record.daily_market_briefing_id,
      "paper_trading_runs.daily_market_briefing_id",
    ),
    macroBiasScoreId: getRequiredString(
      record.macro_bias_score_id,
      "paper_trading_runs.macro_bias_score_id",
    ),
    asset: PAPER_TRADING_SUPPORTED_ASSET,
    decision: getDecision(record.decision),
    targetSpyWeight: normalizePaperTradingWeight(
      getRequiredNumber(record.target_spy_weight, "paper_trading_runs.target_spy_weight"),
    ),
    targetCashWeight: normalizePaperTradingWeight(
      getRequiredNumber(record.target_cash_weight, "paper_trading_runs.target_cash_weight"),
    ),
    convictionScore: getRequiredNumber(
      record.conviction_score,
      "paper_trading_runs.conviction_score",
    ),
    reasoningSummary: getRequiredString(
      record.reasoning_summary,
      "paper_trading_runs.reasoning_summary",
    ),
    riskFlags: getStringArray(record.risk_flags),
    promptVersion: getRequiredString(record.prompt_version, "paper_trading_runs.prompt_version"),
    sourceModel: getRequiredString(record.source_model, "paper_trading_runs.source_model"),
    generationMethod: getGenerationMethod(
      record.generation_method,
      "paper_trading_runs.generation_method",
    ),
    promptPayload: getObjectOrThrow(record.prompt_payload, "paper_trading_runs.prompt_payload"),
    decisionPayload: getObjectOrThrow(record.decision_payload, "paper_trading_runs.decision_payload"),
    rawResponse: getOptionalString(record.raw_response),
    status: getRunStatus(record.status),
    errorMessage: getOptionalString(record.error_message),
    createdAt: getRequiredString(record.created_at, "paper_trading_runs.created_at"),
    updatedAt: getRequiredString(record.updated_at, "paper_trading_runs.updated_at"),
  };
}

function normalizeSnapshotRecord(record: PortfolioSnapshotRecord): PaperTradingPortfolioSnapshotRow {
  const asset = getRequiredString(record.asset, "paper_trading_portfolio_snapshots.asset");

  if (asset !== PAPER_TRADING_SUPPORTED_ASSET) {
    throw new Error(`Unsupported paper_trading_portfolio_snapshots.asset value: ${asset}`);
  }

  return {
    id: getRequiredString(record.id, "paper_trading_portfolio_snapshots.id"),
    paperTradingRunId: getRequiredString(
      record.paper_trading_run_id,
      "paper_trading_portfolio_snapshots.paper_trading_run_id",
    ),
    briefingDate: getRequiredString(
      record.briefing_date,
      "paper_trading_portfolio_snapshots.briefing_date",
    ),
    pricingTradeDate: getRequiredString(
      record.pricing_trade_date,
      "paper_trading_portfolio_snapshots.pricing_trade_date",
    ),
    asset: PAPER_TRADING_SUPPORTED_ASSET,
    cashBalance: normalizePaperTradingCurrency(
      getRequiredNumber(record.cash_balance, "paper_trading_portfolio_snapshots.cash_balance"),
    ),
    positionQuantity: normalizePaperTradingQuantity(
      getRequiredNumber(
        record.position_quantity,
        "paper_trading_portfolio_snapshots.position_quantity",
      ),
    ),
    positionAvgCost: getOptionalNumber(record.position_avg_cost),
    markPrice: normalizePaperTradingCurrency(
      getRequiredNumber(record.mark_price, "paper_trading_portfolio_snapshots.mark_price"),
    ),
    positionMarketValue: normalizePaperTradingCurrency(
      getRequiredNumber(
        record.position_market_value,
        "paper_trading_portfolio_snapshots.position_market_value",
      ),
    ),
    totalEquity: normalizePaperTradingCurrency(
      getRequiredNumber(record.total_equity, "paper_trading_portfolio_snapshots.total_equity"),
    ),
    dailyPnl: normalizePaperTradingCurrency(
      getRequiredNumber(record.daily_pnl, "paper_trading_portfolio_snapshots.daily_pnl"),
    ),
    dailyReturnPct: normalizePaperTradingWeight(
      getRequiredNumber(
        record.daily_return_pct,
        "paper_trading_portfolio_snapshots.daily_return_pct",
      ),
    ),
    totalReturnPct: normalizePaperTradingWeight(
      getRequiredNumber(
        record.total_return_pct,
        "paper_trading_portfolio_snapshots.total_return_pct",
      ),
    ),
    cashWeight: normalizePaperTradingWeight(
      getRequiredNumber(record.cash_weight, "paper_trading_portfolio_snapshots.cash_weight"),
    ),
    assetWeight: normalizePaperTradingWeight(
      getRequiredNumber(record.asset_weight, "paper_trading_portfolio_snapshots.asset_weight"),
    ),
    createdAt: getRequiredString(record.created_at, "paper_trading_portfolio_snapshots.created_at"),
    updatedAt: getRequiredString(record.updated_at, "paper_trading_portfolio_snapshots.updated_at"),
  };
}

function derivePortfolioState(
  snapshot: PaperTradingPortfolioSnapshotRow | null,
  latestPrice: PaperTradingPriceSource,
): PaperTradingPortfolioState {
  if (!snapshot) {
    return buildInitialPaperTradingPortfolioState(latestPrice.close, latestPrice.tradeDate);
  }

  const markPriceChanged =
    snapshot.pricingTradeDate !== latestPrice.tradeDate ||
    Math.abs(snapshot.markPrice - latestPrice.close) >= 0.0001;

  if (!markPriceChanged) {
    return {
      snapshotSource: "persisted",
      snapshotId: snapshot.id,
      paperTradingRunId: snapshot.paperTradingRunId,
      briefingDate: snapshot.briefingDate,
      pricingTradeDate: snapshot.pricingTradeDate,
      asset: snapshot.asset,
      cashBalance: snapshot.cashBalance,
      positionQuantity: snapshot.positionQuantity,
      positionAvgCost: snapshot.positionAvgCost,
      markPrice: snapshot.markPrice,
      positionMarketValue: snapshot.positionMarketValue,
      totalEquity: snapshot.totalEquity,
      dailyPnl: snapshot.dailyPnl,
      dailyReturnPct: snapshot.dailyReturnPct,
      totalReturnPct: snapshot.totalReturnPct,
      cashWeight: snapshot.cashWeight,
      assetWeight: snapshot.assetWeight,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
    };
  }

  const positionMarketValue = normalizePaperTradingCurrency(
    snapshot.positionQuantity * latestPrice.close,
  );
  const totalEquity = normalizePaperTradingCurrency(snapshot.cashBalance + positionMarketValue);
  const dailyPnl = normalizePaperTradingCurrency(totalEquity - snapshot.totalEquity);
  const dailyReturnPct =
    snapshot.totalEquity > 0
      ? normalizePaperTradingWeight((dailyPnl / snapshot.totalEquity) * 100)
      : 0;
  const totalReturnPct =
    PAPER_TRADING_STARTING_CASH > 0
      ? normalizePaperTradingWeight(((totalEquity / PAPER_TRADING_STARTING_CASH) - 1) * 100)
      : 0;
  const assetWeight =
    totalEquity > 0 ? normalizePaperTradingWeight(positionMarketValue / totalEquity) : 0;
  const cashWeight =
    totalEquity > 0 ? normalizePaperTradingWeight(snapshot.cashBalance / totalEquity) : 1;

  return {
    snapshotSource: "mark_to_market",
    snapshotId: snapshot.id,
    paperTradingRunId: snapshot.paperTradingRunId,
    briefingDate: snapshot.briefingDate,
    pricingTradeDate: latestPrice.tradeDate,
    asset: snapshot.asset,
    cashBalance: snapshot.cashBalance,
    positionQuantity: snapshot.positionQuantity,
    positionAvgCost: snapshot.positionAvgCost,
    markPrice: latestPrice.close,
    positionMarketValue,
    totalEquity,
    dailyPnl,
    dailyReturnPct,
    totalReturnPct,
    cashWeight,
    assetWeight,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

function buildPromptPayload(
  briefing: PaperTradingBriefingSource,
  biasScore: PaperTradingBiasScoreSource,
  latestPrice: PaperTradingPriceSource,
  portfolioState: PaperTradingPortfolioState,
) {
  return {
    briefingDate: briefing.briefingDate,
    sourceTradeDate: briefing.tradeDate,
    asset: PAPER_TRADING_SUPPORTED_ASSET,
    currentPortfolio: {
      cashBalance: portfolioState.cashBalance,
      positionQuantity: portfolioState.positionQuantity,
      positionAvgCost: portfolioState.positionAvgCost,
      totalEquity: portfolioState.totalEquity,
      assetWeight: portfolioState.assetWeight,
      cashWeight: portfolioState.cashWeight,
      markPrice: portfolioState.markPrice,
      lastSnapshotBriefingDate: portfolioState.briefingDate,
      lastSnapshotTradeDate: portfolioState.pricingTradeDate,
    },
    briefing: {
      quantScore: briefing.quantScore,
      biasLabel: briefing.biasLabel,
      isOverrideActive: briefing.isOverrideActive,
      newsStatus: briefing.newsStatus,
      newsSummary: briefing.newsSummary,
      newsHeadlines: briefing.newsHeadlines,
      analogReference: briefing.analogReference,
      briefContent: briefing.briefContent,
      sourceModel: briefing.sourceModel,
      generationMethod: briefing.generationMethod,
    },
    quant: {
      score: biasScore.score,
      biasLabel: biasScore.biasLabel,
      componentSummaries: biasScore.componentScores
        .map((component) => component.summary)
        .filter((summary): summary is string => typeof summary === "string" && summary.trim().length > 0),
      componentCount: biasScore.componentScores.length,
      tickerChanges: biasScore.tickerChanges,
      modelVersion: biasScore.modelVersion,
    },
    price: {
      tradeDate: latestPrice.tradeDate,
      close: latestPrice.close,
      source: PAPER_TRADING_PRICE_SOURCE,
    },
    constraints: {
      allowedAsset: PAPER_TRADING_SUPPORTED_ASSET,
      allowedDecisions: [...PAPER_TRADING_ALLOWED_DECISIONS],
      allowLeverage: PAPER_TRADING_ALLOW_LEVERAGE,
      allowShort: PAPER_TRADING_ALLOW_SHORT,
    },
  };
}

async function loadExistingRun(supabase: PaperTradingAdminClient, briefingDate: string) {
  const { data, error } = await supabase
    .from("paper_trading_runs")
    .select(
      [
        "id",
        "briefing_date",
        "source_trade_date",
        "daily_market_briefing_id",
        "macro_bias_score_id",
        "asset",
        "decision",
        "target_spy_weight",
        "target_cash_weight",
        "conviction_score",
        "reasoning_summary",
        "risk_flags",
        "prompt_version",
        "source_model",
        "generation_method",
        "prompt_payload",
        "decision_payload",
        "raw_response",
        "status",
        "error_message",
        "created_at",
        "updated_at",
      ].join(", "),
    )
    .eq("briefing_date", briefingDate)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load paper trading run for ${briefingDate}: ${error.message}`);
  }

  return data ? normalizePaperTradingRunRecord(data as unknown as PaperTradingRunRecord) : null;
}

async function loadBriefing(supabase: PaperTradingAdminClient, briefingDate: string) {
  const { data, error } = await supabase
    .from("daily_market_briefings")
    .select(
      [
        "id",
        "briefing_date",
        "trade_date",
        "quant_score",
        "bias_label",
        "is_override_active",
        "news_status",
        "news_summary",
        "news_headlines",
        "analog_reference",
        "brief_content",
        "source_model",
        "generation_method",
        "generated_at",
      ].join(", "),
    )
    .eq("briefing_date", briefingDate)
    .order("generated_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to load daily briefing for ${briefingDate}: ${error.message}`);
  }

  const record = (((data as unknown) as DailyMarketBriefingRecord[] | null) ?? [])[0];
  return record ? normalizeBriefingRecord(record) : null;
}

async function loadBiasScore(supabase: PaperTradingAdminClient, tradeDate: string) {
  const { data, error } = await supabase
    .from("macro_bias_scores")
    .select(
      [
        "id",
        "trade_date",
        "score",
        "bias_label",
        "component_scores",
        "ticker_changes",
        "engine_inputs",
        "technical_indicators",
        "model_version",
        "created_at",
        "updated_at",
      ].join(", "),
    )
    .eq("trade_date", tradeDate)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load macro bias score for ${tradeDate}: ${error.message}`);
  }

  return data ? normalizeBiasScoreRecord(data as unknown as MacroBiasScoreRecord) : null;
}

async function loadLatestPrice(supabase: PaperTradingAdminClient, tradeDate: string) {
  const { data, error } = await supabase
    .from("etf_daily_prices")
    .select("ticker, trade_date, open, high, low, close, adjusted_close, volume, source")
    .eq("ticker", PAPER_TRADING_SUPPORTED_ASSET)
    .eq("trade_date", tradeDate)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load ${PAPER_TRADING_SUPPORTED_ASSET} price for ${tradeDate}: ${error.message}`,
    );
  }

  return data ? normalizePriceRecord(data as PriceRecord) : null;
}

async function loadLatestSnapshot(supabase: PaperTradingAdminClient) {
  const { data, error } = await supabase
    .from("paper_trading_portfolio_snapshots")
    .select(
      [
        "id",
        "paper_trading_run_id",
        "briefing_date",
        "pricing_trade_date",
        "asset",
        "cash_balance",
        "position_quantity",
        "position_avg_cost",
        "mark_price",
        "position_market_value",
        "total_equity",
        "daily_pnl",
        "daily_return_pct",
        "total_return_pct",
        "cash_weight",
        "asset_weight",
        "created_at",
        "updated_at",
      ].join(", "),
    )
    .eq("asset", PAPER_TRADING_SUPPORTED_ASSET)
    .order("briefing_date", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to load paper trading portfolio state: ${error.message}`);
  }

  const record = (((data as unknown) as PortfolioSnapshotRecord[] | null) ?? [])[0];
  return record ? normalizeSnapshotRecord(record) : null;
}

export async function loadPaperTradingContext(
  options: LoadPaperTradingContextOptions = {},
): Promise<PaperTradingContextLoadResult> {
  const supabase = createSupabaseAdminClient();
  const marketCalendar = getPaperTradingMarketCalendarContext(options.now);
  const briefingDate = options.briefingDate ?? marketCalendar.briefingDate;
  const existingRun = await loadExistingRun(supabase, briefingDate);

  if (marketCalendar.isWeekend && !options.briefingDate) {
    return {
      status: "unavailable",
      reason: "weekend",
      message: `Paper trading skips weekends in ${marketCalendar.marketTimeZone}.`,
      briefingDate,
      marketCalendar: {
        ...marketCalendar,
        briefingDate,
      },
      existingRun,
      briefing: null,
      biasScore: null,
      latestPrice: null,
      portfolioState: null,
    };
  }

  const briefing = await loadBriefing(supabase, briefingDate);

  if (!briefing) {
    return {
      status: "unavailable",
      reason: "missing_briefing",
      message: `No daily_market_briefings row exists for ${briefingDate}.`,
      briefingDate,
      marketCalendar: {
        ...marketCalendar,
        briefingDate,
      },
      existingRun,
      briefing: null,
      biasScore: null,
      latestPrice: null,
      portfolioState: null,
    };
  }

  const biasScore = await loadBiasScore(supabase, briefing.tradeDate);

  if (!biasScore) {
    return {
      status: "unavailable",
      reason: "missing_bias_score",
      message: `No macro_bias_scores row exists for source trade date ${briefing.tradeDate}.`,
      briefingDate,
      marketCalendar: {
        ...marketCalendar,
        briefingDate,
      },
      existingRun,
      briefing,
      biasScore: null,
      latestPrice: null,
      portfolioState: null,
    };
  }

  const latestPrice = await loadLatestPrice(supabase, briefing.tradeDate);

  if (!latestPrice) {
    return {
      status: "unavailable",
      reason: "missing_price",
      message: `No ${PAPER_TRADING_SUPPORTED_ASSET} price exists for trade date ${briefing.tradeDate}.`,
      briefingDate,
      marketCalendar: {
        ...marketCalendar,
        briefingDate,
      },
      existingRun,
      briefing,
      biasScore,
      latestPrice: null,
      portfolioState: null,
    };
  }

  const latestSnapshot = await loadLatestSnapshot(supabase);
  const portfolioState = derivePortfolioState(latestSnapshot, latestPrice);
  const promptPayload = buildPromptPayload(briefing, biasScore, latestPrice, portfolioState);

  return {
    status: "ready",
    briefingDate,
    marketCalendar: {
      ...marketCalendar,
      briefingDate,
    },
    existingRun,
    briefing,
    biasScore,
    latestPrice,
    portfolioState,
    promptPayload,
  };
}
