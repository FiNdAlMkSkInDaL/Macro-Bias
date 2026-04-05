import { NextResponse } from "next/server";

import { getLatestBiasSnapshot } from "../../../../lib/market-data/get-latest-bias-snapshot";
import { CORE_ASSET_TICKERS } from "../../../../types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FRONTEND_TICKERS = new Set<string>(CORE_ASSET_TICKERS);

type FrontendTickerChange = {
  close: number;
  percentChange: number;
  previousClose: number;
  ticker: string;
  tradeDate: string;
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
        componentScores: snapshot.component_scores,
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