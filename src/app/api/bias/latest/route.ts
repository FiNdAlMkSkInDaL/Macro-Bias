import { NextResponse } from "next/server";

import { getLatestBiasSnapshot } from "../../../../lib/market-data/get-latest-bias-snapshot";
import { BIAS_PILLAR_WEIGHTS } from "../../../../lib/macro-bias/constants";
import type { BiasComponentResult, BiasPillarKey } from "../../../../lib/macro-bias/types";
import { CORE_ASSET_TICKERS } from "../../../../types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FRONTEND_TICKERS = new Set<string>(CORE_ASSET_TICKERS);
const PILLAR_ORDER: BiasPillarKey[] = [
  "trendAndMomentum",
  "creditAndRiskSpreads",
  "volatility",
];

const PILLAR_LABELS: Record<BiasPillarKey, string> = {
  trendAndMomentum: "Trend/Momentum",
  creditAndRiskSpreads: "Credit/Risk Spreads",
  volatility: "Volatility",
};

type FrontendTickerChange = {
  close: number;
  percentChange: number;
  previousClose: number;
  ticker: string;
  tradeDate: string;
};

type PillarBreakdown = {
  contribution: number;
  key: BiasPillarKey;
  label: string;
  signal: number;
  weight: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFrontendTickerChange(value: unknown): value is FrontendTickerChange {
  return (
    isRecord(value) &&
    typeof value.close === "number" &&
    typeof value.percentChange === "number" &&
    typeof value.previousClose === "number" &&
    typeof value.ticker === "string" &&
    typeof value.tradeDate === "string"
  );
}

function isBiasPillarKey(value: unknown): value is BiasPillarKey {
  return typeof value === "string" && value in BIAS_PILLAR_WEIGHTS;
}

function isBiasComponentResult(value: unknown): value is BiasComponentResult {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.weight === "number" &&
    typeof value.signal === "number" &&
    typeof value.contribution === "number" &&
    typeof value.summary === "string" &&
    (value.pillar === undefined || isBiasPillarKey(value.pillar))
  );
}

function roundTo(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function buildPillarBreakdown(componentScores: unknown): PillarBreakdown[] {
  if (!Array.isArray(componentScores)) {
    return [];
  }

  const components = componentScores.filter(isBiasComponentResult);
  const aggregatedScores = new Map<
    BiasPillarKey,
    { contribution: number; weight: number }
  >(
    PILLAR_ORDER.map((pillar) => [
      pillar,
      {
        contribution: 0,
        weight: BIAS_PILLAR_WEIGHTS[pillar],
      },
    ]),
  );

  components.forEach((component) => {
    if (!component.pillar) {
      return;
    }

    const pillarTotals = aggregatedScores.get(component.pillar);

    if (!pillarTotals) {
      return;
    }

    pillarTotals.contribution += component.contribution;
  });

  return PILLAR_ORDER.map((pillar) => {
    const pillarTotals = aggregatedScores.get(pillar)!;

    return {
      contribution: roundTo(pillarTotals.contribution),
      key: pillar,
      label: PILLAR_LABELS[pillar],
      signal: roundTo(pillarTotals.contribution / pillarTotals.weight, 4),
      weight: pillarTotals.weight,
    };
  });
}

function buildFrontendTickerChanges(tickerChanges: unknown) {
  if (!isRecord(tickerChanges)) {
    return {};
  }

  return Object.entries(tickerChanges).reduce<Record<string, FrontendTickerChange>>(
    (frontendTickerChanges, [ticker, value]) => {
      if (!FRONTEND_TICKERS.has(ticker) || !isFrontendTickerChange(value)) {
        return frontendTickerChanges;
      }

      frontendTickerChanges[ticker] = {
        close: value.close,
        percentChange: value.percentChange,
        previousClose: value.previousClose,
        ticker: value.ticker,
        tradeDate: value.tradeDate,
      };

      return frontendTickerChanges;
    },
    {},
  );
}

export async function GET() {
  try {
    const snapshot = await getLatestBiasSnapshot();

    if (!snapshot) {
      return NextResponse.json(
        {
          error: "No macro bias score has been calculated yet.",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      data: {
        tradeDate: snapshot.trade_date,
        score: snapshot.score,
        label: snapshot.bias_label,
        tickerChanges: buildFrontendTickerChanges(snapshot.ticker_changes),
        componentScores: buildPillarBreakdown(snapshot.component_scores),
        detailedComponentScores: snapshot.component_scores,
        createdAt: snapshot.created_at,
        updatedAt: snapshot.updated_at,
      },
    });
  } catch (error) {
    console.error("Failed to read latest macro bias snapshot.", error);

    return NextResponse.json(
      {
        error: "Failed to load the latest macro bias snapshot.",
      },
      { status: 500 },
    );
  }
}