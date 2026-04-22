import type { DailyBriefingGenerationMethod, DailyBriefingNewsStatus } from "@/lib/briefing/types";
import type { BiasComponentResult, BiasLabel, TickerChangeMap } from "@/lib/macro-bias/types";

export type PaperTradingAsset = "SPY";
export type PaperTradingDecision = "BUY" | "SELL" | "HOLD";
export type PaperTradingExecutionSide = "BUY" | "SELL";
export type PaperTradingRunStatus = "pending" | "completed" | "failed";
export type PaperTradingGenerationMethod = DailyBriefingGenerationMethod;
export type PaperTradingPriceSourceName = "etf_daily_prices.close";
export type PaperTradingNewsStatus = DailyBriefingNewsStatus;
export type PaperTradingPortfolioStateSource = "initial" | "persisted" | "mark_to_market";
export type PaperTradingContextUnavailableReason =
  | "weekend"
  | "missing_briefing"
  | "missing_bias_score"
  | "missing_price";

export type PaperTradingRunRow = {
  id: string;
  briefingDate: string;
  sourceTradeDate: string;
  dailyMarketBriefingId: string;
  macroBiasScoreId: string;
  asset: PaperTradingAsset;
  decision: PaperTradingDecision;
  targetSpyWeight: number;
  targetCashWeight: number;
  convictionScore: number;
  reasoningSummary: string;
  riskFlags: string[];
  promptVersion: string;
  sourceModel: string;
  generationMethod: PaperTradingGenerationMethod;
  promptPayload: Record<string, unknown>;
  decisionPayload: Record<string, unknown>;
  rawResponse: string | null;
  status: PaperTradingRunStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaperTradingExecutionRow = {
  id: string;
  paperTradingRunId: string;
  briefingDate: string;
  pricingTradeDate: string;
  executedAt: string;
  asset: PaperTradingAsset;
  side: PaperTradingExecutionSide;
  quantity: number;
  price: number;
  notional: number;
  convictionScore: number;
  priceSource: PaperTradingPriceSourceName;
  cashBalanceAfter: number;
  positionQuantityAfter: number;
  createdAt: string;
};

export type PaperTradingPortfolioSnapshotRow = {
  id: string;
  paperTradingRunId: string;
  briefingDate: string;
  pricingTradeDate: string;
  asset: PaperTradingAsset;
  cashBalance: number;
  positionQuantity: number;
  positionAvgCost: number | null;
  markPrice: number;
  positionMarketValue: number;
  totalEquity: number;
  dailyPnl: number;
  dailyReturnPct: number;
  totalReturnPct: number;
  cashWeight: number;
  assetWeight: number;
  createdAt: string;
  updatedAt: string;
};

export type PaperTradingPortfolioState = {
  snapshotSource: PaperTradingPortfolioStateSource;
  snapshotId: string | null;
  paperTradingRunId: string | null;
  briefingDate: string | null;
  pricingTradeDate: string | null;
  asset: PaperTradingAsset;
  cashBalance: number;
  positionQuantity: number;
  positionAvgCost: number | null;
  markPrice: number;
  positionMarketValue: number;
  totalEquity: number;
  dailyPnl: number;
  dailyReturnPct: number;
  totalReturnPct: number;
  cashWeight: number;
  assetWeight: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PaperTradingBriefingSource = {
  id: string;
  briefingDate: string;
  tradeDate: string;
  quantScore: number;
  biasLabel: BiasLabel;
  isOverrideActive: boolean;
  newsStatus: PaperTradingNewsStatus;
  newsSummary: string;
  newsHeadlines: string[];
  analogReference: string | null;
  briefContent: string;
  sourceModel: string;
  generationMethod: PaperTradingGenerationMethod;
  generatedAt: string;
};

export type PaperTradingBiasScoreSource = {
  id: string;
  tradeDate: string;
  score: number;
  biasLabel: BiasLabel;
  componentScores: BiasComponentResult[];
  tickerChanges: TickerChangeMap;
  engineInputs: Record<string, unknown> | null;
  technicalIndicators: Record<string, unknown> | null;
  modelVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaperTradingPriceSource = {
  asset: PaperTradingAsset;
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose: number;
  volume: number;
  source: string;
};

export type PaperTradingMarketCalendarContext = {
  briefingDate: string;
  isMonday: boolean;
  isWeekend: boolean;
  marketTimeZone: string;
};

export type PaperTradingPromptPayload = {
  briefingDate: string;
  sourceTradeDate: string;
  asset: PaperTradingAsset;
  currentPortfolio: {
    cashBalance: number;
    positionQuantity: number;
    positionAvgCost: number | null;
    totalEquity: number;
    assetWeight: number;
    cashWeight: number;
    markPrice: number;
    lastSnapshotBriefingDate: string | null;
    lastSnapshotTradeDate: string | null;
  };
  briefing: {
    quantScore: number;
    biasLabel: BiasLabel;
    isOverrideActive: boolean;
    newsStatus: PaperTradingNewsStatus;
    newsSummary: string;
    newsHeadlines: string[];
    analogReference: string | null;
    briefContent: string;
    sourceModel: string;
    generationMethod: PaperTradingGenerationMethod;
  };
  quant: {
    score: number;
    biasLabel: BiasLabel;
    componentSummaries: string[];
    componentCount: number;
    tickerChanges: TickerChangeMap;
    modelVersion: string | null;
  };
  price: {
    tradeDate: string;
    close: number;
    source: string;
  };
  constraints: {
    allowedAsset: PaperTradingAsset;
    allowedDecisions: PaperTradingDecision[];
    allowLeverage: false;
    allowShort: false;
  };
};

export type PaperTradingDecisionPayload = {
  decision: PaperTradingDecision;
  targetSpyWeight: number;
  targetCashWeight: number;
  convictionScore: number;
  reasoningSummary: string;
  riskFlags: string[];
};

export type GeneratePaperTradeDecisionResult = {
  decision: PaperTradingDecisionPayload;
  generationMethod: PaperTradingGenerationMethod;
  sourceModel: string;
  promptVersion: string;
  rawResponse: string | null;
  warnings: string[];
};

export type PaperTradingExecutionPlan = {
  asset: PaperTradingAsset;
  pricingTradeDate: string;
  price: number;
  shouldExecute: boolean;
  side: PaperTradingExecutionSide | null;
  quantity: number;
  notional: number;
  cashBalanceAfter: number;
  positionQuantityAfter: number;
  positionAvgCostAfter: number | null;
  positionMarketValueAfter: number;
  totalEquityAfter: number;
  dailyPnlAfter: number;
  dailyReturnPctAfter: number;
  totalReturnPctAfter: number;
  cashWeightAfter: number;
  assetWeightAfter: number;
};

export type ExecutePaperTradeInput = {
  context: PaperTradingContextReady;
  decisionResult: GeneratePaperTradeDecisionResult;
};

export type ExecutePaperTradeResult = {
  run: PaperTradingRunRow;
  execution: PaperTradingExecutionRow | null;
  snapshot: PaperTradingPortfolioSnapshotRow;
  executionPlan: PaperTradingExecutionPlan;
};

export type PaperTradingContextReady = {
  status: "ready";
  briefingDate: string;
  marketCalendar: PaperTradingMarketCalendarContext;
  existingRun: PaperTradingRunRow | null;
  briefing: PaperTradingBriefingSource;
  biasScore: PaperTradingBiasScoreSource;
  latestPrice: PaperTradingPriceSource;
  portfolioState: PaperTradingPortfolioState;
  promptPayload: PaperTradingPromptPayload;
};

export type PaperTradingContextUnavailable = {
  status: "unavailable";
  reason: PaperTradingContextUnavailableReason;
  message: string;
  briefingDate: string;
  marketCalendar: PaperTradingMarketCalendarContext;
  existingRun: PaperTradingRunRow | null;
  briefing: PaperTradingBriefingSource | null;
  biasScore: PaperTradingBiasScoreSource | null;
  latestPrice: PaperTradingPriceSource | null;
  portfolioState: PaperTradingPortfolioState | null;
};

export type PaperTradingContextLoadResult =
  | PaperTradingContextReady
  | PaperTradingContextUnavailable;

export type LoadPaperTradingContextOptions = {
  briefingDate?: string;
  now?: Date;
};
