import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";

import {
  type SignalBreakdownScore,
} from "../../components/dashboard/SignalBreakdown";
import { FreeWorkspace } from "@/components/product/FreeWorkspace";
import { MemberShell } from "@/components/product/MemberShell";
import { ProBriefingActions, ProWorkspace, type ProAssetQuote } from "@/components/product/ProWorkspace";
import { STOCK_MODEL_SETTINGS } from "@/components/product/pro-model-settings";
import { loadWorkspaceData } from "@/lib/product/workspace-data";
import { loadPaidBriefingLink } from "@/lib/product/paid-briefing-link";
import { ManagePlan } from "../../components/billing/ManagePlan";
import { getStripeCustomerId } from "../../lib/billing/stripe-customer";
import { getUserSubscriptionStatus } from "../../lib/billing/subscription";
import type { BiasLabel } from "../../lib/macro-bias/types";
import { getAppUrl } from "../../lib/server-env";
import { CORE_ASSET_TICKERS, type BiasAsset, type BiasData } from "../../types";

export const dynamic = "force-dynamic";

type ApiTickerChange = {
  close: number;
  percentChange: number;
  previousClose: number;
  ticker: BiasAsset["ticker"];
  tradeDate: string;
};

type ApiTradableSignal = {
  position: "LONG" | "SHORT" | "FLAT" | "NO_TRADE";
  size: number;
  reliability: "A" | "B" | "C" | "D" | "F";
  neighborAgreement: number;
  meanNeighborDistance: number;
  distanceQuality: number;
  noTrade: boolean;
  reason: string;
};

type ApiBiasSnapshot = {
  componentScores: (SignalBreakdownScore & { analogDates?: string[] })[];
  createdAt: string;
  detailedComponentScores?: Array<{
    contribution: number;
    key: string;
    pillar?: SignalBreakdownScore["key"];
    signal: number;
    summary: string;
    weight: number;
  }>;
  historicalAnalogs?: {
    alignedSessionCount: number;
    candidateCount: number;
    clusterAveragePlaybook: {
      intradayNet: number | null;
      overnightGap: number | null;
      sessionRange: number | null;
    };
    featureTickers: string[];
    topMatches: Array<{
      intradayNet: number | null;
      matchConfidence: number;
      nextSessionDate: string;
      overnightGap: number | null;
      sessionRange: number | null;
      tradeDate: string;
    }>;
  } | null;
  label: BiasLabel;
  score: number;
  signal?: ApiTradableSignal | null;
  blendedForwardReturn?: number | null;
  modelVersion?: string | null;
  tickerChanges: Partial<Record<BiasAsset["ticker"], ApiTickerChange>>;
  tradeDate: string;
  updatedAt: string;
};

type ApiDetailedComponentScore = NonNullable<ApiBiasSnapshot["detailedComponentScores"]>[number];

type LatestBiasResponse =
  | {
      data: ApiBiasSnapshot;
    }
  | {
      error: string;
    };

type DashboardDataResult = {
  biasData: BiasData;
  errorMessage: string | null;
  snapshot: ApiBiasSnapshot | null;
};

type CrossAssetMapTicker = BiasAsset["ticker"] | "IWM" | "HYG" | "VIX" | "UUP" | "USO";

type CrossAssetMapAsset = {
  currentPrice: number | null;
  dailyChangePercent: number | null;
  ticker: CrossAssetMapTicker;
  tradeDate: string | null;
  dateSource: ProAssetQuote['dateSource'];
};

type YahooChartQuote = {
  close?: Array<number | null>;
};

type YahooChartResult = {
  timestamp?: number[];
  indicators?: {
    quote?: YahooChartQuote[];
  };
};

type YahooChartResponse = {
  chart?: {
    result?: YahooChartResult[];
  };
};

const CROSS_ASSET_MAP_TICKERS = [
  "SPY",
  "QQQ",
  "XLP",
  "TLT",
  "GLD",
  "IWM",
  "HYG",
  "VIX",
  "UUP",
  "USO",
] as const satisfies readonly CrossAssetMapTicker[];

const SUPPLEMENTAL_CROSS_ASSET_MAP_TICKERS = [
  ["IWM", "IWM"],
  ["HYG", "HYG"],
  ["^VIX", "VIX"],
  ["UUP", "UUP"],
  ["USO", "USO"],
] as const satisfies readonly (readonly [string, CrossAssetMapTicker])[];

const proSignalPillars = [
  {
    key: "volatility" as const,
    label: "Volatility",
    symbol: "VIX level & momentum",
    description: "VIX momentum and its historical level provide saved volatility context.",
  },
  {
    key: "creditAndRiskSpreads" as const,
    label: "Credit & commodities",
    symbol: "HYG/TLT · CPER/GLD · USO",
    description: "Compares credit, metals, gold and oil context with historical conditions.",
  },
  {
    key: "trendAndMomentum" as const,
    label: "Momentum",
    symbol: "SPY RSI",
    description: "SPY’s 14-period RSI describes recent price momentum.",
  },
  {
    key: "positioning" as const,
    label: "Saved positioning context",
    symbol: "VIX momentum proxy",
    description: "The saved narrative uses volatility momentum rather than measured dealer gamma.",
  },
] satisfies Array<{
  key: SignalBreakdownScore["key"];
  label: string;
  symbol: string;
  description: string;
}>;

function getSignalPillarLookupKeys(key: SignalBreakdownScore["key"]): readonly string[] {
  if (
    key === "positioning" ||
    key === "dealerPositioning" ||
    key === "gammaExposure" ||
    key === "vixMomentum"
  ) {
    return ["positioning", "dealerPositioning", "gammaExposure", "vixMomentum"];
  }

  return [key];
}

function getSignalPillarValue<T>(scoreByKey: Map<string, T>, key: SignalBreakdownScore["key"]) {
  for (const lookupKey of getSignalPillarLookupKeys(key)) {
    const score = scoreByKey.get(lookupKey);

    if (score !== undefined) {
      return score;
    }
  }

  return undefined;
}

function formatAnalogDate(tradeDate?: string) {
  if (!tradeDate) {
    return "Pending";
  }

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
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() - days);
  return nextDate;
}

function buildYahooChartUrl(ticker: string) {
  const period2 = new Date();
  const period1 = subtractDays(period2, 10);
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
  );

  url.searchParams.set("interval", "1d");
  url.searchParams.set("includeAdjustedClose", "false");
  url.searchParams.set("period1", String(Math.floor(period1.getTime() / 1000)));
  url.searchParams.set("period2", String(Math.floor(period2.getTime() / 1000)));

  return url;
}

async function fetchSupplementalCrossAsset(
  sourceTicker: string,
  displayTicker: CrossAssetMapTicker,
): Promise<CrossAssetMapAsset | null> {
  try {
    const response = await fetch(buildYahooChartUrl(sourceTicker), {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as YahooChartResponse;
    const result = payload.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    const points = timestamps
      .map((timestamp, index) => {
        const close = closes[index];

        if (close == null) {
          return null;
        }

        return {
          close,
          timestamp,
        };
      })
      .filter((point): point is { close: number; timestamp: number } => point !== null)
      .sort((left, right) => left.timestamp - right.timestamp);

    if (points.length < 2) {
      return null;
    }

    const latestPoint = points.at(-1)!;
    const previousPoint = points.at(-2)!;

    return {
      currentPrice: roundTo(latestPoint.close),
      dailyChangePercent: roundTo(
        ((latestPoint.close - previousPoint.close) / previousPoint.close) * 100,
      ),
      ticker: displayTicker,
      tradeDate: new Date(latestPoint.timestamp * 1000).toISOString().slice(0, 10),
      dateSource: 'supplemental',
    };
  } catch {
    return null;
  }
}

async function getSupplementalCrossAssetMapAssets() {
  const assets = await Promise.all(
    SUPPLEMENTAL_CROSS_ASSET_MAP_TICKERS.map(([sourceTicker, displayTicker]) =>
      fetchSupplementalCrossAsset(sourceTicker, displayTicker),
    ),
  );

  return assets.filter((asset): asset is CrossAssetMapAsset => asset !== null);
}

async function getRequestBaseUrl() {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const protocol =
    headerStore.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "development" ? "http" : "https");

  if (host) {
    return `${protocol}://${host}`;
  }

  return getAppUrl();
}

async function getDashboardData(baseUrl: string, cookieHeader: string | null): Promise<DashboardDataResult> {
  const emptyBiasData: BiasData = {
    biasScore: 0,
    assets: [],
  };

  try {
    const response = await fetch(`${baseUrl}/api/bias/latest`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });
    const payload = (await response.json().catch(() => null)) as LatestBiasResponse | null;

    if (!response.ok) {
      return {
        biasData: emptyBiasData,
        errorMessage:
          payload && "error" in payload
            ? payload.error
            : "Unable to load the latest macro bias snapshot.",
        snapshot: null,
      };
    }

    if (!payload || !("data" in payload)) {
      return {
        biasData: emptyBiasData,
        errorMessage: "The latest macro bias endpoint returned an invalid payload.",
        snapshot: null,
      };
    }

    const assets: BiasAsset[] = CORE_ASSET_TICKERS.flatMap((ticker) => {
      const tickerChange = payload.data.tickerChanges[ticker];

      if (!tickerChange) {
        return [];
      }

      return [
        {
          currentPrice: tickerChange.close,
          dailyChangePercent: tickerChange.percentChange,
          ticker,
        },
      ];
    });

    return {
      biasData: {
        biasScore: payload.data.score,
        assets,
      },
      errorMessage: null,
      snapshot: payload.data,
    };
  } catch (error) {
    return {
      biasData: emptyBiasData,
      errorMessage:
        error instanceof Error
          ? error.message
          : "Unable to load the latest macro bias snapshot.",
      snapshot: null,
    };
  }
}

export default async function DashboardPage() {
  noStore();

  const status = await getUserSubscriptionStatus();
  if (!status.isPro) {
    const data = await loadWorkspaceData('stocks', status);
    return <FreeWorkspace data={data} audience={status.user ? 'member' : 'public'} userId={status.user?.id ?? null} />;
  }

  const { isPro, user } = status;
  const [baseUrl, supplementalCrossAssetMapAssets, headerStore, workspaceData] =
    await Promise.all([
      getRequestBaseUrl(),
      getSupplementalCrossAssetMapAssets(),
      headers(),
      loadWorkspaceData('stocks', status),
    ]);
  const { biasData, errorMessage, snapshot } = await getDashboardData(baseUrl, headerStore.get('cookie'));
  const [stripeCustomerId, briefing] = await Promise.all([
    user ? getStripeCustomerId(user.id).catch(() => null) : Promise.resolve(null),
    loadPaidBriefingLink('stocks', snapshot?.tradeDate ?? null, isPro),
  ]);
  const historicalAnalogs = snapshot?.historicalAnalogs ?? null;
  const componentScores = snapshot?.componentScores ?? [];
  const signalScoreByKey = new Map<string, SignalBreakdownScore>(
    componentScores.map((score) => [score.key, score]),
  );
  const detailedSignalScoreByKey = new Map<string, ApiDetailedComponentScore>(
    (snapshot?.detailedComponentScores ?? []).map((score) => [score.pillar ?? score.key, score]),
  );
  const scoringMatchCount = componentScores.find((score) => Array.isArray(score.analogDates))?.analogDates?.length ?? null;
  const crossAssetMapAssets = CROSS_ASSET_MAP_TICKERS.map((ticker) => {
    const coreAsset = biasData.assets.find((asset) => asset.ticker === ticker);
    const storedQuote = snapshot?.tickerChanges[ticker as BiasAsset['ticker']];
    if (coreAsset) {
      return {
        currentPrice: coreAsset.currentPrice,
        dailyChangePercent: coreAsset.dailyChangePercent,
        ticker,
        tradeDate: storedQuote?.tradeDate ?? snapshot?.tradeDate ?? null,
        dateSource: storedQuote?.tradeDate ? 'ticker' : snapshot ? 'snapshot' : null,
      } satisfies CrossAssetMapAsset;
    }
    return supplementalCrossAssetMapAssets.find((asset) => asset.ticker === ticker) ?? {
      currentPrice: null,
      dailyChangePercent: null,
      ticker,
      tradeDate: null,
      dateSource: null,
    } satisfies CrossAssetMapAsset;
  });

  return (
    <MemberShell
      title="Your stock workspace"
      plan="Pro plan"
      headerActions={<ProBriefingActions asset="stocks" briefing={briefing} />}
      description={<>Published session · {snapshot?.tradeDate ? <time dateTime={snapshot.tradeDate}>{formatAnalogDate(snapshot.tradeDate)}</time> : 'Not available'}</>}
    >
      <ProWorkspace
        asset="stocks"
        published={snapshot ? { tradeDate: snapshot.tradeDate, score: snapshot.score, label: snapshot.label } : null}
        signal={snapshot?.signal ?? null}
        chart={workspaceData.active}
        briefing={briefing}
        notice={errorMessage ? errorMessage.startsWith('No score is stored for ') ? errorMessage : 'The published stock reading is temporarily unavailable. Please try again.' : null}
        pillars={proSignalPillars.map((pillar) => {
          const score = getSignalPillarValue(signalScoreByKey, pillar.key);
          const detail = getSignalPillarValue(detailedSignalScoreByKey, pillar.key);
          return {
            key: pillar.key,
            label: pillar.label,
            source: pillar.symbol,
            description: pillar.description,
            contribution: score?.contribution ?? null,
            weight: score?.weight ?? null,
            signal: score?.signal ?? null,
            summary: detail?.summary ?? null,
          };
        })}
        assets={crossAssetMapAssets}
        participation={workspaceData.tape}
        historical={historicalAnalogs ? {
          kind: 'stocks',
          alignedSessionCount: historicalAnalogs.alignedSessionCount,
          candidateCount: historicalAnalogs.candidateCount,
          featureTickers: historicalAnalogs.featureTickers,
          clusterAveragePlaybook: historicalAnalogs.clusterAveragePlaybook,
          matches: historicalAnalogs.topMatches,
        } : null}
        diagnostics={{
          modelVersion: snapshot?.modelVersion ?? null,
          createdAt: snapshot?.createdAt ?? null,
          updatedAt: snapshot?.updatedAt ?? null,
          blendedForwardReturn: snapshot?.blendedForwardReturn ?? null,
          scoringMatchCount,
          settings: STOCK_MODEL_SETTINGS,
        }}
        actions={<><a href="/refer">Refer friends</a><ManagePlan hasStripeCustomer={Boolean(stripeCustomerId)} isPro={isPro} /></>}
      />
    </MemberShell>
  );
}
