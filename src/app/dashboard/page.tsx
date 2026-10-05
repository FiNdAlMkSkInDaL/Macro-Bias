import { unstable_noStore as noStore } from "next/cache";
import { Suspense } from "react";

import { LoadingIndicator } from "@/components/ui/LoadingIndicator";
import { FreeWorkspace } from "@/components/product/FreeWorkspace";
import { MemberShell } from "@/components/product/MemberShell";
import { ProBriefingActions, ProMarketPrices, ProWorkspace, type ProAssetQuote } from "@/components/product/ProWorkspace";
import { loadWorkspaceData, loadWorkspaceSnapshot, type WorkspaceMarketTape } from "@/lib/product/workspace-data";
import { requireWorkspaceStatus } from "@/lib/product/workspace-auth";
import { loadPaidBriefingLink } from "@/lib/product/paid-briefing-link";
import { getSupplementalQuotes } from "@/lib/product/supplemental-quotes";
import { deriveHistoricalAnalogs } from "@/lib/market-data/derive-historical-analogs";
import { buildProContextObservations } from "@/components/product/pro-context-observations";
import { ManagePlan } from "@/components/billing/ManagePlan";
import { getStripeCustomerId } from "@/lib/billing/stripe-customer";
import type { MacroBiasScoreRow } from "@/lib/macro-bias/types";

export const dynamic = "force-dynamic";

const CROSS_ASSET_TICKERS = ["SPY", "QQQ", "XLP", "TLT", "GLD", "IWM", "HYG", "VIX", "UUP", "USO"] as const;
const SUPPLEMENTAL_TICKERS = [
  ["SPY", "SPY"], ["QQQ", "QQQ"], ["XLP", "XLP"], ["TLT", "TLT"], ["GLD", "GLD"],
  ["IWM", "IWM"], ["HYG", "HYG"], ["^VIX", "VIX"], ["UUP", "UUP"], ["USO", "USO"],
] as const;
function storedQuotes(tape: WorkspaceMarketTape): ProAssetQuote[] {
  return CROSS_ASSET_TICKERS.map((ticker) => {
    const entry = tape.entries.find((quote) => quote.ticker === ticker);
    return {
      ticker, currentPrice: entry?.close ?? null, dailyChangePercent: entry?.percentChange ?? null,
      tradeDate: entry?.tradeDate ?? null, dateSource: entry?.dateSource ?? null,
    };
  });
}

async function StockMarketPrices({ assets, tape }: { assets: ProAssetQuote[]; tape: WorkspaceMarketTape }) {
  const supplemental = await getSupplementalQuotes(SUPPLEMENTAL_TICKERS);
  const byTicker = new Map(supplemental.map((quote) => [quote.ticker, quote]));
  const complete = assets.map((quote) => {
    const latest = byTicker.get(quote.ticker as typeof SUPPLEMENTAL_TICKERS[number][1]);
    return latest && (!quote.tradeDate || latest.tradeDate >= quote.tradeDate) ? latest : quote;
  });
  return <ProMarketPrices assets={complete} tape={tape} />;
}

function historicalComparisons(snapshot: MacroBiasScoreRow | null) {
  if (!snapshot) return null;
  try {
    return deriveHistoricalAnalogs(snapshot.engine_inputs, snapshot.component_scores, snapshot.technical_indicators);
  } catch {
    return null;
  }
}

async function StockPlanActions({ userId, isPro }: { userId: string; isPro: boolean }) {
  const stripeCustomerId = await getStripeCustomerId(userId).catch(() => null);
  return <><a href="/refer">Refer friends</a><ManagePlan hasStripeCustomer={Boolean(stripeCustomerId)} isPro={isPro} /></>;
}

export default async function DashboardPage() {
  noStore();
  const status = await requireWorkspaceStatus("/dashboard");
  if (!status.isPro) {
    const data = await loadWorkspaceData("stocks", status);
    return <FreeWorkspace data={data} audience="member" userId={status.user.id} />;
  }

  const snapshotPromise = loadWorkspaceSnapshot("stocks", status);
  const briefingPromise = snapshotPromise.then((row) =>
    loadPaidBriefingLink("stocks", row?.trade_date ?? null, status.isPro),
  );
  const [workspaceData, row, selectedBriefing] = await Promise.all([
    loadWorkspaceData("stocks", status, { includeMemberExtras: false }),
    snapshotPromise,
    briefingPromise,
  ]);
  const score = workspaceData.active.score;
  const snapshot = row?.trade_date === score?.tradeDate ? row : null;
  const briefing = snapshot ? selectedBriefing : { href: null, notice: null };
  const historical = historicalComparisons(snapshot);
  const assets = storedQuotes(workspaceData.tape);

  return (
    <MemberShell
      title="Your stock workspace"
      plan="Pro plan"
      headerActions={<ProBriefingActions asset="stocks" briefing={briefing} />}
    >
      <ProWorkspace
        asset="stocks"
        published={score ? { tradeDate: score.tradeDate, score: score.score, label: score.label } : null}
        chart={workspaceData.active}
        briefing={briefing}
        notice={workspaceData.active.loadError ?? (workspaceData.active.missingSessionDate ? "No score is published for " + workspaceData.active.missingSessionDate + "." : null)}
        observations={buildProContextObservations("stocks", snapshot)}
        assets={assets}
        participation={workspaceData.tape}
        marketPrices={
          <Suspense fallback={<ProMarketPrices assets={assets} tape={workspaceData.tape} loading loadingTickers={SUPPLEMENTAL_TICKERS.map(([, ticker]) => ticker)} />}>
            <StockMarketPrices assets={assets} tape={workspaceData.tape} />
          </Suspense>
        }
        historical={historical ? {
          kind: "stocks", alignedSessionCount: historical.alignedSessionCount,
          candidateCount: historical.candidateCount, featureTickers: historical.featureTickers,
          clusterAveragePlaybook: historical.clusterAveragePlaybook, matches: historical.topMatches,
        } : null}
        actions={<Suspense fallback={<><a href="/refer">Refer friends</a><LoadingIndicator compact label="Loading account options" /></>}><StockPlanActions userId={status.user.id} isPro={status.isPro} /></Suspense>}
      />
    </MemberShell>
  );
}
