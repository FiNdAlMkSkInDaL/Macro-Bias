import { unstable_noStore as noStore } from "next/cache";
import { Suspense } from "react";

import { LoadingIndicator } from "@/components/ui/LoadingIndicator";
import { FreeWorkspace } from "@/components/product/FreeWorkspace";
import { MemberShell } from "@/components/product/MemberShell";
import { ProBriefingActions, ProMarketPrices, ProWorkspace, type ProAssetQuote } from "@/components/product/ProWorkspace";
import { CRYPTO_MODEL_SETTINGS } from "@/components/product/pro-model-settings";
import { buildProContextObservations } from "@/components/product/pro-context-observations";
import { loadWorkspaceData, loadWorkspaceSnapshot, type WorkspaceMarketTape } from "@/lib/product/workspace-data";
import { getSupplementalQuotes } from "@/lib/product/supplemental-quotes";
import { requireWorkspaceStatus } from "@/lib/product/workspace-auth";
import { loadPaidBriefingLink } from "@/lib/product/paid-briefing-link";
import { ManagePlan } from "@/components/billing/ManagePlan";
import { getStripeCustomerId } from "@/lib/billing/stripe-customer";
import { extractTradableSignal } from "@/lib/signal/format-tradable-signal";
import type {
  CryptoBiasScoreRow,
  CryptoBiasComponentResult,
  CryptoTickerChangeSnapshot,
} from "@/lib/crypto-bias/types";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type CrossAssetTicker =
  | "BTC-USD"
  | "ETH-USD"
  | "SOL-USD"
  | "GLD"
  | "TLT"
  | "UUP";

type CrossAssetMapAsset = {
  currentPrice: number | null;
  dailyChangePercent: number | null;
  ticker: CrossAssetTicker;
  tradeDate: string | null;
  dateSource: ProAssetQuote['dateSource'];
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CROSS_ASSET_TICKERS: readonly CrossAssetTicker[] = [
  "BTC-USD",
  "ETH-USD",
  "SOL-USD",
  "GLD",
  "TLT",
  "UUP",
];

const SUPPLEMENTAL_TICKERS: readonly (readonly [string, CrossAssetTicker])[] = [
  ["BTC-USD", "BTC-USD"],
  ["ETH-USD", "ETH-USD"],
  ["SOL-USD", "SOL-USD"],
  ["GLD", "GLD"],
  ["TLT", "TLT"],
  ["UUP", "UUP"],
];

const cryptoSignalPillars = [
  { key: "trendAndMomentum", label: "Momentum", symbol: "BTC RSI", description: "BTC’s 14-period RSI describes recent price momentum." },
  { key: "cryptoStructure", label: "Relative crypto strength", symbol: "ETH/BTC", description: "The ETH/BTC ratio compares Ether’s relative price with Bitcoin." },
  {
    key: "macroCorrelation",
    label: "Cross-market context",
    symbol: "BTC/GLD · DXY · TLT",
    description: "Compares Bitcoin versus gold, dollar momentum and Treasury momentum with historical conditions.",
  },
  { key: "volatility", label: "Volatility", symbol: "BTC realized volatility", description: "BTC’s 20-session realized volatility is compared with its historical range." },
] as const;

/* ------------------------------------------------------------------ */
/*  Secondary market context                                           */
/* ------------------------------------------------------------------ */

function storedCrossAssets(snapshot: CryptoBiasScoreRow | null): CrossAssetMapAsset[] {
  return CROSS_ASSET_TICKERS.map((ticker) => {
    const quote = (snapshot?.ticker_changes as Partial<Record<string, CryptoTickerChangeSnapshot>> | undefined)?.[ticker];
    const tradeDate = quote?.tradeDate ?? snapshot?.trade_date ?? null;
    const date = tradeDate ? new Date(`${tradeDate}T00:00:00Z`) : null;
    if (quote && Number.isFinite(quote.close) && quote.close > 0 && Number.isFinite(quote.percentChange)
      && tradeDate && date && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === tradeDate
      && snapshot && tradeDate <= snapshot.trade_date) {
      return { currentPrice: quote.close, dailyChangePercent: quote.percentChange, ticker, tradeDate, dateSource: quote.tradeDate ? 'ticker' : 'snapshot' };
    }
    return { currentPrice: null, dailyChangePercent: null, ticker, tradeDate: null, dateSource: null };
  });
}

async function CryptoMarketPrices({ assets, tape }: { assets: CrossAssetMapAsset[]; tape: WorkspaceMarketTape }) {
  const supplemental = await getSupplementalQuotes(SUPPLEMENTAL_TICKERS);
  return <ProMarketPrices assets={assets.map((asset) => {
    const latest = supplemental.find((quote) => quote.ticker === asset.ticker);
    return latest && (!asset.tradeDate || latest.tradeDate >= asset.tradeDate) ? latest : asset;
  })} tape={tape} />;
}

async function CryptoPlanActions({ userId, isPro }: { userId: string; isPro: boolean }) {
  const stripeCustomerId = await getStripeCustomerId(userId).catch(() => null);
  return <><a href="/refer">Refer friends</a><ManagePlan hasStripeCustomer={Boolean(stripeCustomerId)} isPro={isPro} /></>;
}

/* ------------------------------------------------------------------ */
/*  Analog extraction                                                  */
/* ------------------------------------------------------------------ */

function extractAnalogData(componentScores: CryptoBiasComponentResult[]) {
  const src = componentScores.find(
    (c) => c.analogMatches && c.analogMatches.length > 0,
  );
  if (!src?.analogMatches) return null;

  return {
    matches: src.analogMatches,
    matchCount: src.analogMatches.length,
    avg1d: src.averageForward1DayReturn ?? null,
    avg3d: src.averageForward3DayReturn ?? null,
    bearish1d: src.bearishHitRate1Day ?? null,
    bearish3d: src.bearishHitRate3Day ?? null,
  };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function CryptoDashboardPage() {
  noStore();

  const status = await requireWorkspaceStatus('/crypto/dashboard');
  if (!status.isPro) {
    const data = await loadWorkspaceData('crypto', status);
    return <FreeWorkspace data={data} audience="member" userId={status.user.id} />;
  }

  const { isPro, user } = status;
  const snapshotPromise = loadWorkspaceSnapshot('crypto', status);
  const briefingPromise = snapshotPromise.then((snapshot) => loadPaidBriefingLink('crypto', snapshot?.trade_date ?? null, isPro));
  const [snapshot, workspaceData, briefing] = await Promise.all([
    snapshotPromise,
    loadWorkspaceData('crypto', status, { includeMemberExtras: false }),
    briefingPromise,
  ]);
  const componentScores = snapshot?.component_scores ?? [];
  const signalScoreByKey = new Map<string, CryptoBiasComponentResult>(
    componentScores.map((score) => [score.pillar ?? score.key, score]),
  );
  const analogData = extractAnalogData(componentScores);
  const crossAssetMapAssets = storedCrossAssets(snapshot);
  const engineInputs = snapshot?.engine_inputs;
  const scoringMatchCount = componentScores.find((score) => Array.isArray(score.analogMatches))?.analogMatches?.length ?? null;

  return (
    <MemberShell
      title="Your crypto workspace"
      plan="Pro plan"
      headerActions={<ProBriefingActions asset="crypto" briefing={briefing} />}
    >
      <ProWorkspace
        asset="crypto"
        published={snapshot ? { tradeDate: snapshot.trade_date, score: snapshot.score, label: snapshot.bias_label } : null}
        signal={extractTradableSignal(engineInputs)}
        chart={workspaceData.active}
        briefing={briefing}
        observations={buildProContextObservations('crypto', snapshot)}
        notice={!snapshot ? 'The published crypto reading is temporarily unavailable. Please try again.' : null}
        pillars={cryptoSignalPillars.map((pillar) => {
          const score = signalScoreByKey.get(pillar.key);
          return {
            key: pillar.key,
            label: pillar.label,
            source: pillar.symbol,
            description: pillar.description,
            contribution: score?.contribution ?? null,
            weight: score?.weight ?? null,
            signal: score?.signal ?? null,
            summary: score?.summary ?? null,
          };
        })}
        assets={crossAssetMapAssets}
        marketPrices={<Suspense fallback={<ProMarketPrices assets={crossAssetMapAssets} tape={workspaceData.tape} loading loadingTickers={SUPPLEMENTAL_TICKERS.map(([, ticker]) => ticker)} />}><CryptoMarketPrices assets={crossAssetMapAssets} tape={workspaceData.tape} /></Suspense>}
        participation={workspaceData.tape}
        historical={analogData ? { kind: 'crypto', ...analogData } : null}
        diagnostics={{
          modelVersion: typeof engineInputs?.modelVersion === 'string' ? engineInputs.modelVersion : null,
          createdAt: snapshot?.created_at ?? null,
          updatedAt: snapshot?.updated_at ?? null,
          blendedForwardReturn: typeof engineInputs?.blendedForwardReturn === 'number' && Number.isFinite(engineInputs.blendedForwardReturn) ? engineInputs.blendedForwardReturn : null,
          scoringMatchCount,
          settings: CRYPTO_MODEL_SETTINGS,
        }}
        actions={<Suspense fallback={<><a href="/refer">Refer friends</a><LoadingIndicator compact label="Loading account options" /></>}><CryptoPlanActions userId={user.id} isPro={isPro} /></Suspense>}
      />
    </MemberShell>
  );
}
