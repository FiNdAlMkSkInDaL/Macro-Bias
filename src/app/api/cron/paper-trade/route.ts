import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { generatePaperTradeDecision } from "@/lib/paper-trading/generate-paper-trade-decision";
import { loadPaperTradingContext } from "@/lib/paper-trading/load-paper-trading-context";
import { executePaperTrade } from "@/lib/paper-trading/execute-paper-trade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const revalidate = 0;

function getOptionalServerEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getProvidedCronSecret(request: NextRequest) {
  const authorizationHeader = request.headers.get("authorization");

  if (authorizationHeader?.startsWith("Bearer ")) {
    return authorizationHeader.slice("Bearer ".length).trim();
  }

  return request.headers.get("x-cron-secret")?.trim() ?? null;
}

function isAuthorizedCronRequest(request: NextRequest) {
  const expectedSecret = getOptionalServerEnv("CRON_SECRET") ?? getOptionalServerEnv("PUBLISH_CRON_SECRET");

  if (!expectedSecret) {
    throw new Error("Missing CRON_SECRET. Configure it before enabling the paper trade cron route.");
  }

  const providedSecret = getProvidedCronSecret(request);

  return Boolean(providedSecret && safeCompare(providedSecret, expectedSecret));
}

function getRequestedBriefingDate(request: NextRequest) {
  const requestedBriefingDate = request.nextUrl.searchParams.get("briefingDate")?.trim() ?? null;

  if (!requestedBriefingDate) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedBriefingDate)) {
    throw new Error("briefingDate must use YYYY-MM-DD format when provided.");
  }

  return requestedBriefingDate;
}

async function handlePaperTrade(request: NextRequest) {
  try {
    if (!isAuthorizedCronRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const requestedBriefingDate = getRequestedBriefingDate(request);
    const context = await loadPaperTradingContext(
      requestedBriefingDate ? { briefingDate: requestedBriefingDate } : {},
    );

    if (context.status === "unavailable") {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: context.reason,
        message: context.message,
        briefingDate: context.briefingDate,
        existingRun: context.existingRun
          ? {
              id: context.existingRun.id,
              status: context.existingRun.status,
              decision: context.existingRun.decision,
            }
          : null,
      });
    }

    if (context.existingRun) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "already_processed",
        message: `Paper trading run already exists for ${context.briefingDate}.`,
        briefingDate: context.briefingDate,
        run: {
          id: context.existingRun.id,
          status: context.existingRun.status,
          decision: context.existingRun.decision,
          convictionScore: context.existingRun.convictionScore,
          targetSpyWeight: context.existingRun.targetSpyWeight,
          targetCashWeight: context.existingRun.targetCashWeight,
          generationMethod: context.existingRun.generationMethod,
          sourceModel: context.existingRun.sourceModel,
          errorMessage: context.existingRun.errorMessage,
        },
      });
    }

    const decisionResult = await generatePaperTradeDecision(context);
    const executionResult = await executePaperTrade({
      context,
      decisionResult,
    });

    return NextResponse.json({
      ok: true,
      briefingDate: context.briefingDate,
      tradeDate: context.briefing.tradeDate,
      generationMethod: decisionResult.generationMethod,
      sourceModel: decisionResult.sourceModel,
      promptVersion: decisionResult.promptVersion,
      run: {
        id: executionResult.run.id,
        status: executionResult.run.status,
        decision: executionResult.run.decision,
        convictionScore: executionResult.run.convictionScore,
        targetSpyWeight: executionResult.run.targetSpyWeight,
        targetCashWeight: executionResult.run.targetCashWeight,
        riskFlags: executionResult.run.riskFlags,
      },
      execution: executionResult.execution
        ? {
            id: executionResult.execution.id,
            side: executionResult.execution.side,
            quantity: executionResult.execution.quantity,
            price: executionResult.execution.price,
            notional: executionResult.execution.notional,
            cashBalanceAfter: executionResult.execution.cashBalanceAfter,
            positionQuantityAfter: executionResult.execution.positionQuantityAfter,
          }
        : null,
      snapshot: {
        id: executionResult.snapshot.id,
        totalEquity: executionResult.snapshot.totalEquity,
        cashBalance: executionResult.snapshot.cashBalance,
        positionQuantity: executionResult.snapshot.positionQuantity,
        positionAvgCost: executionResult.snapshot.positionAvgCost,
        markPrice: executionResult.snapshot.markPrice,
        positionMarketValue: executionResult.snapshot.positionMarketValue,
        assetWeight: executionResult.snapshot.assetWeight,
        cashWeight: executionResult.snapshot.cashWeight,
        totalReturnPct: executionResult.snapshot.totalReturnPct,
        dailyReturnPct: executionResult.snapshot.dailyReturnPct,
      },
      skippedExecution: !executionResult.execution,
      warnings: decisionResult.warnings,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to run the paper trade cron.";
    console.error(`[paper-trade] Fatal error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handlePaperTrade(request);
}

export async function POST(request: NextRequest) {
  return handlePaperTrade(request);
}
