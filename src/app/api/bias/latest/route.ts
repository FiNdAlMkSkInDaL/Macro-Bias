import { NextResponse } from "next/server";

import { getLatestBiasSnapshot } from "../../../../lib/market-data/get-latest-bias-snapshot";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
        tickerChanges: snapshot.ticker_changes,
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