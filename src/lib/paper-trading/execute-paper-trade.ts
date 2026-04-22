import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import {
  normalizePaperTradingCurrency,
  normalizePaperTradingQuantity,
  normalizePaperTradingWeight,
  PAPER_TRADING_PRICE_SOURCE,
  PAPER_TRADING_STARTING_CASH,
  PAPER_TRADING_SUPPORTED_ASSET,
} from "./paper-trading-config";
import type {
  ExecutePaperTradeInput,
  ExecutePaperTradeResult,
  PaperTradingExecutionPlan,
  PaperTradingExecutionRow,
  PaperTradingExecutionSide,
  PaperTradingPortfolioSnapshotRow,
  PaperTradingRunRow,
  PaperTradingRunStatus,
} from "./types";

type PaperTradingRunInsertRecord = {
  id: string;
  briefing_date: string;
  source_trade_date: string;
  daily_market_briefing_id: string;
  macro_bias_score_id: string;
  asset: string;
  decision: string;
  target_spy_weight: unknown;
  target_cash_weight: unknown;
  conviction_score: unknown;
  reasoning_summary: string;
  risk_flags: unknown;
  prompt_version: string;
  source_model: string;
  generation_method: string;
  prompt_payload: unknown;
  decision_payload: unknown;
  raw_response: string | null;
  status: unknown;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type PaperTradingExecutionInsertRecord = {
  id: string;
  paper_trading_run_id: string;
  briefing_date: string;
  pricing_trade_date: string;
  executed_at: string;
  asset: string;
  side: string;
  quantity: unknown;
  price: unknown;
  notional: unknown;
  conviction_score: unknown;
  price_source: string;
  cash_balance_after: unknown;
  position_quantity_after: unknown;
  created_at: string;
};

type PaperTradingSnapshotInsertRecord = {
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

function getObjectOrEmptyRecord(value: unknown) {
  return isRecord(value) ? value : {};
}

function normalizeRunRecord(record: PaperTradingRunInsertRecord): PaperTradingRunRow {
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
    decision: getRequiredString(record.decision, "paper_trading_runs.decision") as PaperTradingRunRow["decision"],
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
    generationMethod: getRequiredString(
      record.generation_method,
      "paper_trading_runs.generation_method",
    ) as PaperTradingRunRow["generationMethod"],
    promptPayload: getObjectOrEmptyRecord(record.prompt_payload),
    decisionPayload: getObjectOrEmptyRecord(record.decision_payload),
    rawResponse: typeof record.raw_response === "string" ? record.raw_response : null,
    status: getRequiredString(record.status, "paper_trading_runs.status") as PaperTradingRunStatus,
    errorMessage: typeof record.error_message === "string" ? record.error_message : null,
    createdAt: getRequiredString(record.created_at, "paper_trading_runs.created_at"),
    updatedAt: getRequiredString(record.updated_at, "paper_trading_runs.updated_at"),
  };
}

function normalizeExecutionRecord(record: PaperTradingExecutionInsertRecord): PaperTradingExecutionRow {
  return {
    id: getRequiredString(record.id, "paper_trading_executions.id"),
    paperTradingRunId: getRequiredString(
      record.paper_trading_run_id,
      "paper_trading_executions.paper_trading_run_id",
    ),
    briefingDate: getRequiredString(
      record.briefing_date,
      "paper_trading_executions.briefing_date",
    ),
    pricingTradeDate: getRequiredString(
      record.pricing_trade_date,
      "paper_trading_executions.pricing_trade_date",
    ),
    executedAt: getRequiredString(record.executed_at, "paper_trading_executions.executed_at"),
    asset: PAPER_TRADING_SUPPORTED_ASSET,
    side: getRequiredString(record.side, "paper_trading_executions.side") as PaperTradingExecutionSide,
    quantity: normalizePaperTradingQuantity(
      getRequiredNumber(record.quantity, "paper_trading_executions.quantity"),
    ),
    price: normalizePaperTradingCurrency(
      getRequiredNumber(record.price, "paper_trading_executions.price"),
    ),
    notional: normalizePaperTradingCurrency(
      getRequiredNumber(record.notional, "paper_trading_executions.notional"),
    ),
    convictionScore: getRequiredNumber(
      record.conviction_score,
      "paper_trading_executions.conviction_score",
    ),
    priceSource: getRequiredString(
      record.price_source,
      "paper_trading_executions.price_source",
    ) as PaperTradingExecutionRow["priceSource"],
    cashBalanceAfter: normalizePaperTradingCurrency(
      getRequiredNumber(
        record.cash_balance_after,
        "paper_trading_executions.cash_balance_after",
      ),
    ),
    positionQuantityAfter: normalizePaperTradingQuantity(
      getRequiredNumber(
        record.position_quantity_after,
        "paper_trading_executions.position_quantity_after",
      ),
    ),
    createdAt: getRequiredString(record.created_at, "paper_trading_executions.created_at"),
  };
}

function normalizeSnapshotRecord(
  record: PaperTradingSnapshotInsertRecord,
): PaperTradingPortfolioSnapshotRow {
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

function buildExecutionPlan(input: ExecutePaperTradeInput): PaperTradingExecutionPlan {
  const { context, decisionResult } = input;
  const currentState = context.portfolioState;
  const price = normalizePaperTradingCurrency(context.latestPrice.close);
  const totalEquityAfter = normalizePaperTradingCurrency(currentState.totalEquity);
  const targetPositionQuantity =
    totalEquityAfter > 0
      ? normalizePaperTradingQuantity(
          (totalEquityAfter * decisionResult.decision.targetSpyWeight) / price,
        )
      : 0;
  const positionMarketValueAfter = normalizePaperTradingCurrency(targetPositionQuantity * price);
  const cashBalanceAfter = normalizePaperTradingCurrency(totalEquityAfter - positionMarketValueAfter);
  const quantityDelta = normalizePaperTradingQuantity(
    targetPositionQuantity - currentState.positionQuantity,
  );
  const shouldExecute = Math.abs(quantityDelta) > 0;
  const side = shouldExecute ? (quantityDelta > 0 ? "BUY" : "SELL") : null;
  const quantity = shouldExecute ? normalizePaperTradingQuantity(Math.abs(quantityDelta)) : 0;
  const notional = shouldExecute
    ? normalizePaperTradingCurrency(Math.abs(cashBalanceAfter - currentState.cashBalance))
    : 0;

  if (cashBalanceAfter < 0) {
    throw new Error("Execution plan would create a negative cash balance.");
  }

  if (targetPositionQuantity < 0) {
    throw new Error("Execution plan would create a negative SPY quantity.");
  }

  let positionAvgCostAfter: number | null = null;

  if (targetPositionQuantity > 0) {
    if (side === "BUY") {
      const currentCostBasis =
        currentState.positionQuantity > 0
          ? currentState.positionQuantity * (currentState.positionAvgCost ?? currentState.markPrice)
          : 0;
      const purchaseCostBasis = quantity * price;
      positionAvgCostAfter = normalizePaperTradingCurrency(
        (currentCostBasis + purchaseCostBasis) / targetPositionQuantity,
      );
    } else {
      positionAvgCostAfter = currentState.positionAvgCost ?? currentState.markPrice;
    }
  }

  const assetWeightAfter =
    totalEquityAfter > 0
      ? normalizePaperTradingWeight(positionMarketValueAfter / totalEquityAfter)
      : 0;
  const cashWeightAfter = normalizePaperTradingWeight(1 - assetWeightAfter);
  const totalReturnPctAfter =
    PAPER_TRADING_STARTING_CASH > 0
      ? normalizePaperTradingWeight(((totalEquityAfter / PAPER_TRADING_STARTING_CASH) - 1) * 100)
      : 0;

  return {
    asset: PAPER_TRADING_SUPPORTED_ASSET,
    pricingTradeDate: context.latestPrice.tradeDate,
    price,
    shouldExecute,
    side,
    quantity,
    notional,
    cashBalanceAfter,
    positionQuantityAfter: targetPositionQuantity,
    positionAvgCostAfter,
    positionMarketValueAfter,
    totalEquityAfter,
    dailyPnlAfter: currentState.dailyPnl,
    dailyReturnPctAfter: currentState.dailyReturnPct,
    totalReturnPctAfter,
    cashWeightAfter,
    assetWeightAfter,
  };
}

async function insertPendingRun(input: ExecutePaperTradeInput) {
  const supabase = createSupabaseAdminClient();
  const { context, decisionResult } = input;
  const { data, error } = await supabase
    .from("paper_trading_runs")
    .insert({
      briefing_date: context.briefingDate,
      source_trade_date: context.briefing.tradeDate,
      daily_market_briefing_id: context.briefing.id,
      macro_bias_score_id: context.biasScore.id,
      asset: PAPER_TRADING_SUPPORTED_ASSET,
      decision: decisionResult.decision.decision,
      target_spy_weight: decisionResult.decision.targetSpyWeight,
      target_cash_weight: decisionResult.decision.targetCashWeight,
      conviction_score: decisionResult.decision.convictionScore,
      reasoning_summary: decisionResult.decision.reasoningSummary,
      risk_flags: decisionResult.decision.riskFlags,
      prompt_version: decisionResult.promptVersion,
      source_model: decisionResult.sourceModel,
      generation_method: decisionResult.generationMethod,
      prompt_payload: context.promptPayload,
      decision_payload: {
        ...decisionResult.decision,
      },
      raw_response: decisionResult.rawResponse,
      status: "pending",
      error_message: null,
    })
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
    .single();

  if (error) {
    throw new Error(`Failed to insert pending paper trading run: ${error.message}`);
  }

  return normalizeRunRecord(data as unknown as PaperTradingRunInsertRecord);
}

async function insertExecution(runId: string, input: ExecutePaperTradeInput, plan: PaperTradingExecutionPlan) {
  if (!plan.shouldExecute || !plan.side) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  const { context, decisionResult } = input;
  const { data, error } = await supabase
    .from("paper_trading_executions")
    .insert({
      paper_trading_run_id: runId,
      briefing_date: context.briefingDate,
      pricing_trade_date: plan.pricingTradeDate,
      asset: plan.asset,
      side: plan.side,
      quantity: plan.quantity,
      price: plan.price,
      notional: plan.notional,
      conviction_score: decisionResult.decision.convictionScore,
      price_source: PAPER_TRADING_PRICE_SOURCE,
      cash_balance_after: plan.cashBalanceAfter,
      position_quantity_after: plan.positionQuantityAfter,
    })
    .select(
      [
        "id",
        "paper_trading_run_id",
        "briefing_date",
        "pricing_trade_date",
        "executed_at",
        "asset",
        "side",
        "quantity",
        "price",
        "notional",
        "conviction_score",
        "price_source",
        "cash_balance_after",
        "position_quantity_after",
        "created_at",
      ].join(", "),
    )
    .single();

  if (error) {
    throw new Error(`Failed to insert paper trading execution: ${error.message}`);
  }

  return normalizeExecutionRecord(data as unknown as PaperTradingExecutionInsertRecord);
}

async function insertSnapshot(runId: string, input: ExecutePaperTradeInput, plan: PaperTradingExecutionPlan) {
  const supabase = createSupabaseAdminClient();
  const { context } = input;
  const { data, error } = await supabase
    .from("paper_trading_portfolio_snapshots")
    .insert({
      paper_trading_run_id: runId,
      briefing_date: context.briefingDate,
      pricing_trade_date: plan.pricingTradeDate,
      asset: plan.asset,
      cash_balance: plan.cashBalanceAfter,
      position_quantity: plan.positionQuantityAfter,
      position_avg_cost: plan.positionAvgCostAfter,
      mark_price: plan.price,
      position_market_value: plan.positionMarketValueAfter,
      total_equity: plan.totalEquityAfter,
      daily_pnl: plan.dailyPnlAfter,
      daily_return_pct: plan.dailyReturnPctAfter,
      total_return_pct: plan.totalReturnPctAfter,
      cash_weight: plan.cashWeightAfter,
      asset_weight: plan.assetWeightAfter,
    })
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
    .single();

  if (error) {
    throw new Error(`Failed to insert paper trading portfolio snapshot: ${error.message}`);
  }

  return normalizeSnapshotRecord(data as unknown as PaperTradingSnapshotInsertRecord);
}

async function updateRunStatus(runId: string, status: PaperTradingRunStatus, errorMessage: string | null) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("paper_trading_runs")
    .update({
      status,
      error_message: errorMessage,
    })
    .eq("id", runId)
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
    .single();

  if (error) {
    throw new Error(`Failed to update paper trading run status: ${error.message}`);
  }

  return normalizeRunRecord(data as unknown as PaperTradingRunInsertRecord);
}

async function markRunFailedSafely(runId: string, message: string) {
  try {
    await updateRunStatus(runId, "failed", message);
  } catch (error) {
    const updateMessage =
      error instanceof Error ? error.message : "Unknown paper trading status update failure.";
    console.error(`[paper-trade] Failed to mark run ${runId} as failed: ${updateMessage}`);
  }
}

export async function executePaperTrade(
  input: ExecutePaperTradeInput,
): Promise<ExecutePaperTradeResult> {
  if (input.context.existingRun) {
    throw new Error(
      `Paper trading run already exists for ${input.context.briefingDate} with status ${input.context.existingRun.status}.`,
    );
  }

  const executionPlan = buildExecutionPlan(input);
  let insertedRun: PaperTradingRunRow | null = null;

  try {
    insertedRun = await insertPendingRun(input);
    const execution = await insertExecution(insertedRun.id, input, executionPlan);
    const snapshot = await insertSnapshot(insertedRun.id, input, executionPlan);
    const completedRun = await updateRunStatus(insertedRun.id, "completed", null);

    return {
      run: completedRun,
      execution,
      snapshot,
      executionPlan,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown paper trading execution failure.";

    if (insertedRun) {
      await markRunFailedSafely(insertedRun.id, message);
    }

    throw error instanceof Error ? error : new Error(message);
  }
}
