import { unstable_noStore as noStore } from "next/cache";

import { FreeWorkspace } from "@/components/product/FreeWorkspace";
import { MemberShell } from "@/components/product/MemberShell";
import { ProBriefingActions, ProWorkspace, type ProAssetQuote } from "@/components/product/ProWorkspace";
import { CRYPTO_MODEL_SETTINGS } from "@/components/product/pro-model-settings";
import { loadWorkspaceData } from "@/lib/product/workspace-data";
import { loadPaidBriefingLink } from "@/lib/product/paid-briefing-link";
import { ManagePlan } from "@/components/billing/ManagePlan";
import { getStripeCustomerId } from "@/lib/billing/stripe-customer";
import { getUserSubscriptionStatus } from "@/lib/billing/subscription";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: Array<number | null> }>;
      };
    }>;
  };
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

function formatAnalogDate(tradeDate?: string) {
  if (!tradeDate) return "Pending";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${tradeDate}T12:00:00Z`));
}

function roundTo(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function subtractDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() - days);
  return next;
}

/* ------------------------------------------------------------------ */
/*  Data fetching                                                      */
/* ------------------------------------------------------------------ */

async function getLatestCryptoSnapshot(paid: boolean): Promise<CryptoBiasScoreRow | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("crypto_bias_scores")
      .select(
        "id, trade_date, score, bias_label, component_scores, ticker_changes, engine_inputs, technical_indicators, created_at, updated_at",
      )
      .order("trade_date", { ascending: false })
      .limit(2);

    if (error) return null;
    const rows = (data as CryptoBiasScoreRow[] | null) ?? [];
    return (paid ? rows[0] : rows[1]) ?? null;
  } catch {
    return null;
  }
}

function buildYahooChartUrl(ticker: string) {
  const period2 = new Date();
  const period1 = subtractDays(period2, 10);
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
  );
  url.searchParams.set("interval", "1d");
  url.searchParams.set("includeAdjustedClose", "false");
  url.searchParams.set(
    "period1",
    String(Math.floor(period1.getTime() / 1000)),
  );
  url.searchParams.set(
    "period2",
    String(Math.floor(period2.getTime() / 1000)),
  );
  return url;
}

async function fetchSupplementalAsset(
  sourceTicker: string,
  displayTicker: CrossAssetTicker,
): Promise<CrossAssetMapAsset | null> {
  try {
    const response = await fetch(buildYahooChartUrl(sourceTicker), {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as YahooChartResponse;
    const result = payload.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    const points = timestamps
      .map((ts, i) => {
        const close = closes[i];
        if (close == null) return null;
        return { close, timestamp: ts };
      })
      .filter(
        (p): p is { close: number; timestamp: number } => p !== null,
      )
      .sort((a, b) => a.timestamp - b.timestamp);

    if (points.length < 2) return null;

    const latest = points.at(-1)!;
    const previous = points.at(-2)!;

    return {
      currentPrice: roundTo(latest.close),
      dailyChangePercent: roundTo(
        ((latest.close - previous.close) / previous.close) * 100,
      ),
      ticker: displayTicker,
      tradeDate: new Date(latest.timestamp * 1000).toISOString().slice(0, 10),
      dateSource: 'supplemental',
    };
  } catch {
    return null;
  }
}

async function getSupplementalAssets() {
  const assets = await Promise.all(
    SUPPLEMENTAL_TICKERS.map(([src, display]) =>
      fetchSupplementalAsset(src, display),
    ),
  );
  return assets.filter(
    (a): a is CrossAssetMapAsset => a !== null,
  );
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

  const status = await getUserSubscriptionStatus();
  if (!status.isPro) {
    const data = await loadWorkspaceData('crypto', status);
    return <FreeWorkspace data={data} audience={status.user ? 'member' : 'public'} userId={status.user?.id ?? null} />;
  }

  const { isPro, user } = status;
  const [snapshot, supplementalAssets, workspaceData] = await Promise.all([
    getLatestCryptoSnapshot(isPro),
    getSupplementalAssets(),
    loadWorkspaceData('crypto', status),
  ]);
  const [stripeCustomerId, briefing] = await Promise.all([
    user ? getStripeCustomerId(user.id).catch(() => null) : Promise.resolve(null),
    loadPaidBriefingLink('crypto', snapshot?.trade_date ?? null, isPro),
  ]);
  const componentScores = snapshot?.component_scores ?? [];
  const signalScoreByKey = new Map<string, CryptoBiasComponentResult>(
    componentScores.map((score) => [score.pillar ?? score.key, score]),
  );
  const analogData = extractAnalogData(componentScores);
  const tickerPriceMap = new Map<string, CryptoTickerChangeSnapshot>();
  if (snapshot?.ticker_changes) {
    for (const [ticker, quote] of Object.entries(snapshot.ticker_changes)) {
      tickerPriceMap.set(ticker, quote as CryptoTickerChangeSnapshot);
    }
  }
  const crossAssetMapAssets: CrossAssetMapAsset[] = CROSS_ASSET_TICKERS.map((ticker) => {
    const storedQuote = tickerPriceMap.get(ticker);
    if (storedQuote) {
      return {
        currentPrice: storedQuote.close,
        dailyChangePercent: storedQuote.percentChange,
        ticker,
        tradeDate: storedQuote.tradeDate ?? snapshot?.trade_date ?? null,
        dateSource: storedQuote.tradeDate ? 'ticker' : snapshot ? 'snapshot' : null,
      };
    }
    return supplementalAssets.find((quote) => quote.ticker === ticker) ?? {
      currentPrice: null,
      dailyChangePercent: null,
      ticker,
      tradeDate: null,
      dateSource: null,
    };
  });
  const engineInputs = snapshot?.engine_inputs;
  const scoringMatchCount = componentScores.find((score) => Array.isArray(score.analogMatches))?.analogMatches?.length ?? null;

  return (
    <MemberShell
      title="Your crypto workspace"
      plan="Pro plan"
      headerActions={<ProBriefingActions asset="crypto" briefing={briefing} />}
      description={<>Published session · {snapshot?.trade_date ? <time dateTime={snapshot.trade_date}>{formatAnalogDate(snapshot.trade_date)}</time> : 'Not available'}</>}
    >
      <ProWorkspace
        asset="crypto"
        published={snapshot ? { tradeDate: snapshot.trade_date, score: snapshot.score, label: snapshot.bias_label } : null}
        signal={extractTradableSignal(engineInputs)}
        chart={workspaceData.active}
        briefing={briefing}
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
        actions={<><a href="/refer">Refer friends</a><ManagePlan hasStripeCustomer={Boolean(stripeCustomerId)} isPro={isPro} /></>}
      />
    </MemberShell>
  );
}
