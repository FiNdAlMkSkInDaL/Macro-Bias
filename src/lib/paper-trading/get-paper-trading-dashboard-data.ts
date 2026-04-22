import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import {
  normalizePaperTradingCurrency,
  normalizePaperTradingQuantity,
  normalizePaperTradingWeight,
  PAPER_TRADING_SUPPORTED_ASSET,
} from "./paper-trading-config";

type PaperTradingAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type SnapshotRecord = {
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
  total_return_pct: unknown;
  cash_weight: unknown;
  asset_weight: unknown;
};

type RunRecord = {
  id: string;
  briefing_date: string;
  source_trade_date: string;
  decision: string;
  conviction_score: unknown;
  target_spy_weight: unknown;
  target_cash_weight: unknown;
  reasoning_summary: string;
  risk_flags: unknown;
  status: string;
  generation_method: string;
  source_model: string;
  created_at: string;
};

type ExecutionRecord = {
  id: string;
  briefing_date: string;
  pricing_trade_date: string;
  side: string;
  quantity: unknown;
  price: unknown;
  notional: unknown;
  executed_at: string;
};

export type PaperTradingEquityCurvePoint = {
  date: string;
  equityIndex: number;
  totalEquity: number;
  totalReturnPct: number;
};

export type PaperTradingCurrentPortfolio = {
  briefingDate: string | null;
  pricingTradeDate: string | null;
  totalEquity: number;
  totalReturnPct: number;
  cashBalance: number;
  cashWeight: number;
  spyWeight: number;
  positionQuantity: number;
  positionAvgCost: number | null;
  markPrice: number;
  positionMarketValue: number;
};

export type PaperTradingLatestRunSummary = {
  id: string;
  briefingDate: string;
  sourceTradeDate: string;
  decision: string;
  convictionScore: number;
  targetSpyWeight: number;
  targetCashWeight: number;
  reasoningSummary: string;
  riskFlags: string[];
  status: string;
  generationMethod: string;
  sourceModel: string;
  createdAt: string;
};

export type PaperTradingLatestExecutionSummary = {
  id: string;
  briefingDate: string;
  pricingTradeDate: string;
  side: string;
  quantity: number;
  price: number;
  notional: number;
  executedAt: string;
};

export type PaperTradingDashboardData = {
  hasData: boolean;
  currentPortfolio: PaperTradingCurrentPortfolio;
  equityCurve: PaperTradingEquityCurvePoint[];
  latestRun: PaperTradingLatestRunSummary | null;
  latestExecution: PaperTradingLatestExecutionSummary | null;
  sessionCount: number;
};

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

function getNumber(value: unknown, fieldName: string) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error(`Expected ${fieldName} to be numeric.`);
}

function getOptionalNumber(value: unknown) {
  if (value == null) {
    return null;
  }

  return getNumber(value, "optional numeric field");
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

function toEquityIndex(totalReturnPct: number) {
  return Number((100 + totalReturnPct).toFixed(2));
}

function downsampleCurve(
  points: PaperTradingEquityCurvePoint[],
  maxPoints = 240,
): PaperTradingEquityCurvePoint[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const sampled: PaperTradingEquityCurvePoint[] = [];
  const seenIndices = new Set<number>();

  for (let sampleIndex = 0; sampleIndex < maxPoints; sampleIndex += 1) {
    const pointIndex = Math.round((sampleIndex * (points.length - 1)) / (maxPoints - 1));

    if (seenIndices.has(pointIndex)) {
      continue;
    }

    seenIndices.add(pointIndex);
    sampled.push(points[pointIndex]);
  }

  return sampled;
}

function getEmptyPortfolio(): PaperTradingCurrentPortfolio {
  return {
    briefingDate: null,
    pricingTradeDate: null,
    totalEquity: 0,
    totalReturnPct: 0,
    cashBalance: 0,
    cashWeight: 0,
    spyWeight: 0,
    positionQuantity: 0,
    positionAvgCost: null,
    markPrice: 0,
    positionMarketValue: 0,
  };
}

function normalizeSnapshot(record: SnapshotRecord): PaperTradingCurrentPortfolio {
  const asset = getRequiredString(record.asset, "paper_trading_portfolio_snapshots.asset");

  if (asset !== PAPER_TRADING_SUPPORTED_ASSET) {
    throw new Error(`Unsupported paper trading asset in snapshot: ${asset}`);
  }

  return {
    briefingDate: getRequiredString(record.briefing_date, "paper_trading_portfolio_snapshots.briefing_date"),
    pricingTradeDate: getRequiredString(
      record.pricing_trade_date,
      "paper_trading_portfolio_snapshots.pricing_trade_date",
    ),
    totalEquity: normalizePaperTradingCurrency(
      getNumber(record.total_equity, "paper_trading_portfolio_snapshots.total_equity"),
    ),
    totalReturnPct: normalizePaperTradingWeight(
      getNumber(record.total_return_pct, "paper_trading_portfolio_snapshots.total_return_pct"),
    ),
    cashBalance: normalizePaperTradingCurrency(
      getNumber(record.cash_balance, "paper_trading_portfolio_snapshots.cash_balance"),
    ),
    cashWeight: normalizePaperTradingWeight(
      getNumber(record.cash_weight, "paper_trading_portfolio_snapshots.cash_weight"),
    ),
    spyWeight: normalizePaperTradingWeight(
      getNumber(record.asset_weight, "paper_trading_portfolio_snapshots.asset_weight"),
    ),
    positionQuantity: normalizePaperTradingQuantity(
      getNumber(record.position_quantity, "paper_trading_portfolio_snapshots.position_quantity"),
    ),
    positionAvgCost:
      getOptionalNumber(record.position_avg_cost) == null
        ? null
        : normalizePaperTradingCurrency(getOptionalNumber(record.position_avg_cost) as number),
    markPrice: normalizePaperTradingCurrency(
      getNumber(record.mark_price, "paper_trading_portfolio_snapshots.mark_price"),
    ),
    positionMarketValue: normalizePaperTradingCurrency(
      getNumber(
        record.position_market_value,
        "paper_trading_portfolio_snapshots.position_market_value",
      ),
    ),
  };
}

function normalizeLatestRun(record: RunRecord): PaperTradingLatestRunSummary {
  return {
    id: getRequiredString(record.id, "paper_trading_runs.id"),
    briefingDate: getRequiredString(record.briefing_date, "paper_trading_runs.briefing_date"),
    sourceTradeDate: getRequiredString(
      record.source_trade_date,
      "paper_trading_runs.source_trade_date",
    ),
    decision: getRequiredString(record.decision, "paper_trading_runs.decision"),
    convictionScore: getNumber(record.conviction_score, "paper_trading_runs.conviction_score"),
    targetSpyWeight: normalizePaperTradingWeight(
      getNumber(record.target_spy_weight, "paper_trading_runs.target_spy_weight"),
    ),
    targetCashWeight: normalizePaperTradingWeight(
      getNumber(record.target_cash_weight, "paper_trading_runs.target_cash_weight"),
    ),
    reasoningSummary: getRequiredString(
      record.reasoning_summary,
      "paper_trading_runs.reasoning_summary",
    ),
    riskFlags: getStringArray(record.risk_flags),
    status: getRequiredString(record.status, "paper_trading_runs.status"),
    generationMethod: getRequiredString(
      record.generation_method,
      "paper_trading_runs.generation_method",
    ),
    sourceModel: getRequiredString(record.source_model, "paper_trading_runs.source_model"),
    createdAt: getRequiredString(record.created_at, "paper_trading_runs.created_at"),
  };
}

function normalizeLatestExecution(record: ExecutionRecord): PaperTradingLatestExecutionSummary {
  return {
    id: getRequiredString(record.id, "paper_trading_executions.id"),
    briefingDate: getRequiredString(
      record.briefing_date,
      "paper_trading_executions.briefing_date",
    ),
    pricingTradeDate: getRequiredString(
      record.pricing_trade_date,
      "paper_trading_executions.pricing_trade_date",
    ),
    side: getRequiredString(record.side, "paper_trading_executions.side"),
    quantity: normalizePaperTradingQuantity(
      getNumber(record.quantity, "paper_trading_executions.quantity"),
    ),
    price: normalizePaperTradingCurrency(
      getNumber(record.price, "paper_trading_executions.price"),
    ),
    notional: normalizePaperTradingCurrency(
      getNumber(record.notional, "paper_trading_executions.notional"),
    ),
    executedAt: getRequiredString(record.executed_at, "paper_trading_executions.executed_at"),
  };
}

export async function getPaperTradingDashboardData(
  adminClient: PaperTradingAdminClient = createSupabaseAdminClient(),
): Promise<PaperTradingDashboardData> {
  const [snapshotsRes, latestRunRes] = await Promise.all([
    adminClient
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
          "total_return_pct",
          "cash_weight",
          "asset_weight",
        ].join(", "),
      )
      .eq("asset", PAPER_TRADING_SUPPORTED_ASSET)
      .order("briefing_date", { ascending: true }),
    adminClient
      .from("paper_trading_runs")
      .select(
        [
          "id",
          "briefing_date",
          "source_trade_date",
          "decision",
          "conviction_score",
          "target_spy_weight",
          "target_cash_weight",
          "reasoning_summary",
          "risk_flags",
          "status",
          "generation_method",
          "source_model",
          "created_at",
        ].join(", "),
      )
      .order("briefing_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (snapshotsRes.error) {
    throw new Error(
      `Failed to load paper trading portfolio snapshots: ${snapshotsRes.error.message}`,
    );
  }

  if (latestRunRes.error) {
    throw new Error(`Failed to load latest paper trading run: ${latestRunRes.error.message}`);
  }

  const snapshots = (((snapshotsRes.data as unknown) as SnapshotRecord[] | null) ?? []).map(
    normalizeSnapshot,
  );
  const currentPortfolio = snapshots.at(-1) ?? getEmptyPortfolio();
  const equityCurve = downsampleCurve(
    snapshots.map((snapshot) => ({
      date: snapshot.briefingDate ?? "",
      equityIndex: toEquityIndex(snapshot.totalReturnPct),
      totalEquity: snapshot.totalEquity,
      totalReturnPct: snapshot.totalReturnPct,
    })),
  );
  const latestRun = latestRunRes.data
    ? normalizeLatestRun(latestRunRes.data as unknown as RunRecord)
    : null;

  let latestExecution: PaperTradingLatestExecutionSummary | null = null;

  if (latestRun) {
    const latestExecutionRes = await adminClient
      .from("paper_trading_executions")
      .select("id, briefing_date, pricing_trade_date, side, quantity, price, notional, executed_at")
      .eq("paper_trading_run_id", latestRun.id)
      .order("executed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestExecutionRes.error) {
      throw new Error(
        `Failed to load latest paper trading execution: ${latestExecutionRes.error.message}`,
      );
    }

    latestExecution = latestExecutionRes.data
      ? normalizeLatestExecution(latestExecutionRes.data as unknown as ExecutionRecord)
      : null;
  }

  return {
    hasData: snapshots.length > 0,
    currentPortfolio,
    equityCurve,
    latestRun,
    latestExecution,
    sessionCount: snapshots.length,
  };
}
