import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";

import { DashboardTop } from "../../components/dashboard/DashboardTop";
import {
  type SignalBreakdownScore,
} from "../../components/dashboard/SignalBreakdown";
import { FreeWorkspace } from "@/components/product/FreeWorkspace";
import { MacroMarketChart } from "@/components/product/MacroMarketChart";
import { MarketTabs, MemberShell } from "@/components/product/MemberShell";
import workspaceStyles from "@/components/product/FreeWorkspace.module.css";
import memberStyles from "@/components/product/MemberUI.module.css";
import { loadWorkspaceData } from "@/lib/product/workspace-data";
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
  componentScores: SignalBreakdownScore[];
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

const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const proSignalPillars = [
  {
    key: "volatility" as const,
    label: "Volatility Regime",
    symbol: "^VIX",
  },
  {
    key: "creditAndRiskSpreads" as const,
    label: "Credit Stress",
    symbol: "HYG vs TLT",
  },
  {
    key: "trendAndMomentum" as const,
    label: "Trend Exhaustion",
    symbol: "SPY RSI",
  },
  {
    key: "positioning" as const,
    label: "Market Plumbing",
    symbol: "GEX Proxy",
  },
] satisfies Array<{
  key: SignalBreakdownScore["key"];
  label: string;
  symbol: string;
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

function formatPrice(value: number | null) {
  if (value === null) {
    return "Pending";
  }

  return priceFormatter.format(value);
}

function getSignalDisposition(signal: number | undefined) {
  if (signal == null || Number.isNaN(signal)) {
    return {
      label: "Pending",
      tone: "text-[#acb6ad]",
    };
  }

  if (signal > 0.15) {
    return {
      label: "Bullish",
      tone: "text-[#c9f58a]",
    };
  }

  if (signal < -0.15) {
    return {
      label: "Bearish",
      tone: "text-[#ef9d9d]",
    };
  }

  return {
    label: "Neutral",
    tone: "text-[#d1d9cf]",
  };
}

function formatContribution(value: number | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "--";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatWeight(value: number | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "--";
  }

  return value.toFixed(0);
}

function formatBiasLabel(label: string | undefined): string {
  if (!label) {
    return "Awaiting First Sync";
  }

  return label.toLowerCase().split("_").map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");
}

function formatMove(value: number | null): string {
  if (value === null) {
    return "Pending";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatUnsignedPercent(value: number | null): string {
  if (value === null) {
    return "Pending";
  }

  return `${value.toFixed(2)}%`;
}

function formatTradeDate(tradeDate?: string) {
  if (!tradeDate) {
    return "Pending first sync";
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${tradeDate}T12:00:00Z`));
}

function formatAnalogDate(tradeDate?: string) {
  if (!tradeDate) {
    return "Pending";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${tradeDate}T12:00:00Z`));
}

function getMoveTone(value: number | null): string {
  if (value === null) {
    return "text-[#acb6ad]";
  }

  if (value > 0) {
    return "text-[#c9f58a]";
  }

  if (value < 0) {
    return "text-[#ef9d9d]";
  }

  return "text-[#d1d9cf]";
}

function getDeltaTone(value: number | null): string {
  if (value === null) {
    return "text-[#acb6ad]";
  }

  if (value > 0) {
    return "text-[#c9f58a]";
  }

  if (value < 0) {
    return "text-[#ef9d9d]";
  }

  return "text-[#acb6ad]";
}

function getRangeTone(value: number | null): string {
  if (value === null) {
    return "text-[#acb6ad]";
  }

  return "text-sky-300";
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
  const { biasData, errorMessage, snapshot } = await getDashboardData(baseUrl, headerStore.get("cookie"));
  const isProUser = isPro;
  const stripeCustomerId = user ? await getStripeCustomerId(user.id) : null;
  const historicalAnalogs = snapshot?.historicalAnalogs ?? null;
  const tradableSignal = snapshot?.signal ?? null;
  const componentScores = snapshot?.componentScores ?? [];
  const signalScoreByKey = new Map<string, SignalBreakdownScore>(
    componentScores.map((score) => [score.key, score]),
  );
  const detailedSignalScoreByKey = new Map<string, ApiDetailedComponentScore>(
    (snapshot?.detailedComponentScores ?? []).map((score) => [score.pillar ?? score.key, score]),
  );
  const topAnalogMatches = historicalAnalogs?.topMatches ?? [];
  const analogSummaryCopy = historicalAnalogs
    ? `${historicalAnalogs.alignedSessionCount.toLocaleString()} aligned historical sessions in the analog engine`
    : "historical analog engine warming up";
  const terminalBorderClassName = "border border-[#2a342c]";
  const terminalDividerClassName = "border-t border-[#2a342c]";
  const terminalTableDividerClassName = "border-b border-[#2a342c]";
  const moduleClassName = `${terminalBorderClassName} rounded-[4px] bg-[#111512] min-w-0 p-4 sm:p-5 md:p-6`;
  const footerModuleClassName =
    `${terminalBorderClassName} rounded-[4px] bg-[#111512] min-w-0 p-4 text-sm leading-6 text-[#acb6ad] sm:p-5 md:p-6`;
  const crossAssetMapAssets = CROSS_ASSET_MAP_TICKERS.map((ticker) => {
    const coreAsset = biasData.assets.find((asset) => asset.ticker === ticker);

    if (coreAsset) {
      return {
        currentPrice: coreAsset.currentPrice,
        dailyChangePercent: coreAsset.dailyChangePercent,
        ticker,
      } satisfies CrossAssetMapAsset;
    }

    return (
      supplementalCrossAssetMapAssets.find((asset) => asset.ticker === ticker) ?? {
        currentPrice: null,
        dailyChangePercent: null,
        ticker,
      }
    );
  });

  return (
    <MemberShell
      title="Your stock workspace"
      plan="Pro plan"
      description={<>Published session · {snapshot?.tradeDate ? <time dateTime={snapshot?.tradeDate}>{formatTradeDate(snapshot?.tradeDate)}</time> : 'Not available'}</>}
    >
      <div className={workspaceStyles.proWorkspace} data-pro-workspace="stocks">
        <MarketTabs asset="stocks" view="dashboard" />
        <div className={workspaceStyles.proUtility}>
          <a href="/refer" className={memberStyles.textLink}>Refer friends</a>
          <ManagePlan hasStripeCustomer={Boolean(stripeCustomerId)} isPro={isPro} />
        </div>

        {errorMessage ? (
          <section className="border-b border-amber-400/15 py-3">
            <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-amber-200/80">
              Latest sync issue
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-amber-100">{errorMessage}</p>
          </section>
        ) : null}

        {tradableSignal ? (
          <section className={workspaceStyles.proPermission}>
            <div>
              <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                Permission
              </p>
              <p
                className={`mt-2 text-base font-semibold tracking-tight ${
                  tradableSignal.position === "LONG"
                    ? "text-[#c9f58a]"
                    : tradableSignal.position === "SHORT"
                      ? "text-[#ef9d9d]"
                      : tradableSignal.position === "NO_TRADE"
                        ? "text-amber-300"
                        : "text-[#d1d9cf]"
                }`}
              >
                {tradableSignal.position}
              </p>
            </div>
            <div>
              <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                Size
              </p>
              <p className="mt-2 text-base font-semibold tracking-tight text-[#f1f5ef]">
                {Math.round(tradableSignal.size * 100)}%
              </p>
            </div>
            <div>
              <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                Reliability
              </p>
              <p className="mt-2 text-base font-semibold tracking-tight text-[#f1f5ef]">
                {tradableSignal.reliability}
              </p>
            </div>
            <div>
              <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                Agreement
              </p>
              <p className="mt-2 text-base font-semibold tracking-tight text-[#f1f5ef]">
                {Math.round(tradableSignal.neighborAgreement * 100)}%
              </p>
            </div>
            <p className="col-span-2 text-sm leading-6 text-[#acb6ad] sm:col-span-4">
              {tradableSignal.reason}
            </p>
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-4 py-4 md:gap-6 md:py-6 lg:grid-cols-2">
          <DashboardTop
            assets={biasData.assets.map((asset) => ({ ...asset, tradeDate: snapshot?.tickerChanges[asset.ticker]?.tradeDate }))}
            biasLabel={snapshot?.label}
            biasScore={biasData.biasScore}
            hasScore={Boolean(snapshot)}
            note={errorMessage}
            tradeDate={snapshot?.tradeDate ?? null}
          />

          <div className={`${workspaceStyles.proChart} min-w-0 lg:col-span-2`}>
            <MacroMarketChart
              variant="history" instrument="SPY" title="SPY price & daily bias" defaultRangeMonths={3}
              candles={workspaceData.active.candles} marks={workspaceData.active.history}
              latest={workspaceData.active.score ? { tradeDate: workspaceData.active.score.tradeDate, score: workspaceData.active.score.score, biasLabel: workspaceData.active.score.label } : null}
              notice={workspaceData.active.historyNotice ?? workspaceData.active.priceNotice ?? workspaceData.active.loadError}
            />
          </div>

          <div className="min-w-0 lg:col-span-2">

              <div className="space-y-4 md:space-y-6">
                <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
                  <section className={`${moduleClassName} h-full`}>
                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                      <div>
                        <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad] sm:text-[12px] sm:tracking-[0.06em]">
                          Signal Breakdown
                        </p>
                        <h3 className="mt-2 text-2xl font-semibold tracking-tight text-[#f1f5ef]">
                          Context Engine
                        </h3>
                      </div>
                      <p className="max-w-md text-base leading-[1.75] text-[#acb6ad]">
                        Weighted pillar contribution to the composite score.
                      </p>
                    </div>

                    <div className="mt-4 space-y-0">
                      {proSignalPillars.map((pillar) => {
                        const score = getSignalPillarValue(signalScoreByKey, pillar.key);
                        const detailedScore = getSignalPillarValue(detailedSignalScoreByKey, pillar.key);
                        const disposition = getSignalDisposition(score?.signal);

                        return (
                          <article
                            className={`${terminalDividerClassName} py-4 first:border-t-0 first:pt-0 last:pb-0`}
                            key={pillar.key}
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad] sm:text-[12px] sm:tracking-[0.06em]">
                                  {pillar.label}
                                </p>
                                <p className="mt-1 text-[15px] font-medium text-[#f1f5ef] sm:text-sm">{pillar.symbol}</p>
                              </div>

                              <div className="sm:text-right">
                                <p
                                  className={`font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] sm:text-[12px] sm:tracking-[0.06em] ${disposition.tone}`}
                                >
                                  {disposition.label}
                                </p>
                                <p className="mt-2 font-[family:var(--font-data)] text-[15px] text-[#f1f5ef] sm:text-base">
                                  {formatContribution(score?.contribution)}
                                </p>
                                <p className="mt-1 font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad] sm:text-[12px] sm:tracking-[0.06em]">
                                  of {formatWeight(score?.weight)} pts
                                </p>
                              </div>
                            </div>

                            <p className="mt-3 max-w-[65ch] text-base leading-[1.75] text-[#acb6ad]">
                              {detailedScore?.summary ?? "Waiting for the next model sync to publish this pillar's narrative read."}
                            </p>
                          </article>
                        );
                      })}
                    </div>
                  </section>

                  <section className={`${moduleClassName} h-full`}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                      <div>
                        <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                          Cross-Asset Regime
                        </p>
                        <h3 className="mt-2 text-lg font-semibold tracking-tight text-[#f1f5ef]">
                          Market Internals
                        </h3>
                      </div>
                      <p className="max-w-md text-sm leading-6 text-[#acb6ad]">
                        Macro scope across equities, credit, volatility, dollar, and energy leadership.
                      </p>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-5 xl:gap-3">
                      {crossAssetMapAssets.map((asset) => (
                        <article className={`${terminalBorderClassName} overflow-hidden bg-white/[0.01] p-2.5 xl:p-3`} key={asset.ticker}>
                          <div className="flex items-center justify-between gap-1">
                            <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                              {asset.ticker}
                            </p>
                            <p className={`shrink-0 font-[family:var(--font-data)] text-[13px] ${getMoveTone(asset.dailyChangePercent)}`}>
                              {formatMove(asset.dailyChangePercent)}
                            </p>
                          </div>
                          <p className="mt-1.5 text-sm font-medium text-[#f1f5ef]">
                            {formatPrice(asset.currentPrice)}
                          </p>
                        </article>
                      ))}
                    </div>
                  </section>
                </div>

                <section className={moduleClassName}>
                  <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                      <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                        Historical Analogs
                      </p>
                      <h3 className="mt-2 text-lg font-semibold tracking-tight text-[#f1f5ef]">
                        Intraday Playbook
                      </h3>
                    </div>
                    {historicalAnalogs ? (
                      <p className="max-w-lg text-sm leading-6 text-[#acb6ad]">
                        Ranked against {historicalAnalogs.alignedSessionCount.toLocaleString()} aligned sessions across {historicalAnalogs.featureTickers.join(", ")}.
                      </p>
                    ) : null}
                  </div>

                  {historicalAnalogs ? (
                    <div className="w-full">
                      <p className="text-[12px] text-[#acb6ad] sm:hidden">&larr; scroll to see all columns &rarr;</p>
                      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                      <table className="min-w-[44rem] border-collapse text-left md:min-w-full">
                        <thead>
                          <tr className={terminalTableDividerClassName}>
                            <th className="w-[34%] whitespace-nowrap py-4 pr-6 font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                              Matched date
                            </th>
                            <th className="w-[16%] whitespace-nowrap py-4 pr-6 font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                              Match confidence
                            </th>
                            <th className="w-[16%] whitespace-nowrap py-4 pr-6 font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                              SPY Gap
                            </th>
                            <th className="w-[18%] whitespace-nowrap py-4 pr-6 font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                              SPY Intraday (O-C)
                            </th>
                            <th className="w-[16%] whitespace-nowrap py-4 font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                              SPY Range
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {topAnalogMatches.map((match) => (
                            <tr
                              className={`${terminalTableDividerClassName} even:bg-white/[0.02] last:border-b-0`}
                              key={match.tradeDate}
                            >
                              <td className="py-5 pr-6 align-middle">
                                <p className="text-base font-medium text-[#f1f5ef]">
                                  {formatAnalogDate(match.tradeDate)}
                                </p>
                                <p className="mt-1 font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                                  Next {formatAnalogDate(match.nextSessionDate)}
                                </p>
                              </td>
                              <td className="py-5 pr-6 align-middle">
                                <p className="font-[family:var(--font-data)] text-sm text-[#acb6ad]">
                                  {match.matchConfidence}%
                                </p>
                              </td>
                              <td
                                className={`py-5 pr-6 align-middle font-[family:var(--font-data)] text-base ${getDeltaTone(match.overnightGap)}`}
                              >
                                {formatMove(match.overnightGap)}
                              </td>
                              <td
                                className={`py-5 pr-6 align-middle font-[family:var(--font-data)] text-base ${getDeltaTone(match.intradayNet)}`}
                              >
                                {formatMove(match.intradayNet)}
                              </td>
                              <td className={`py-5 align-middle font-[family:var(--font-data)] text-base ${getRangeTone(match.sessionRange)}`}>
                                {formatUnsignedPercent(match.sessionRange)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    </div>
                  ) : (
                    <div className={`${terminalBorderClassName} bg-white/[0.01] p-4`}>
                      <p className="max-w-2xl text-sm leading-6 text-[#acb6ad]">
                        The analog engine has not yet produced a complete intraday playbook for this snapshot. Additional aligned price history is required before the next-session gap, intraday drift, and range profile can be computed.
                      </p>
                    </div>
                  )}
                </section>
              </div>

          </div>

          {isProUser ? (
          <div className="min-w-0 grid grid-cols-1 gap-4 md:gap-6 lg:col-span-2 lg:grid-cols-2">
            <section className={footerModuleClassName}>
              <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                Macro Summary
              </p>
              <h3 className="mt-2 text-base font-semibold tracking-tight text-[#f1f5ef]">
                Cluster Averages
              </h3>

              {isProUser ? (
                <div className="mt-4 space-y-0 font-[family:var(--font-data)] text-[13px]">
                  <div className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 first:border-t-0 first:pt-0 sm:items-end`}>
                    <p className="uppercase tracking-[0.06em] text-[#acb6ad]">Aligned Sessions</p>
                    <p className="text-sm text-[#f1f5ef]">
                      {historicalAnalogs
                        ? historicalAnalogs.alignedSessionCount.toLocaleString()
                        : "--"}
                    </p>
                  </div>

                  <div className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 sm:items-end`}>
                    <p className="uppercase tracking-[0.06em] text-[#acb6ad]">Usable Matches</p>
                    <p className="text-sm text-[#f1f5ef]">
                      {historicalAnalogs
                        ? historicalAnalogs.candidateCount.toLocaleString()
                        : "--"}
                    </p>
                  </div>

                  <div className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 sm:items-end`}>
                    <p className="uppercase tracking-[0.06em] text-[#acb6ad]">Avg Overnight Gap</p>
                    <p className={getMoveTone(historicalAnalogs?.clusterAveragePlaybook.overnightGap ?? null)}>
                      {formatMove(historicalAnalogs?.clusterAveragePlaybook.overnightGap ?? null)}
                    </p>
                  </div>

                  <div className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 sm:items-end`}>
                    <p className="uppercase tracking-[0.06em] text-[#acb6ad]">Avg Intraday Net</p>
                    <p className={getMoveTone(historicalAnalogs?.clusterAveragePlaybook.intradayNet ?? null)}>
                      {formatMove(historicalAnalogs?.clusterAveragePlaybook.intradayNet ?? null)}
                    </p>
                  </div>

                  <div className={`flex items-start justify-between gap-4 ${terminalDividerClassName} pt-3 sm:items-end`}>
                    <p className="uppercase tracking-[0.06em] text-[#acb6ad]">Avg Session Range</p>
                    <p className={getRangeTone(historicalAnalogs?.clusterAveragePlaybook.sessionRange ?? null)}>
                      {formatUnsignedPercent(historicalAnalogs?.clusterAveragePlaybook.sessionRange ?? null)}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-3 max-w-xl text-sm leading-6 text-[#acb6ad]">
                  Upgrade to expose the exact analog cluster averages behind the current regime classification.
                </p>
              )}
            </section>

            <section className={footerModuleClassName}>
              <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                Model Integrity
              </p>
              <h3 className="mt-2 text-base font-semibold tracking-tight text-[#f1f5ef]">
                Microstructure Upgrade
              </h3>
              <p className="mt-3">
                This score is generated from a K-Nearest Neighbors engine over aligned intermarket history. The dashboard, playbook table, and publication pipeline now reference the same decay-adjusted analog set.
              </p>

              <div className="mt-4 space-y-3 font-[family:var(--font-data)] text-[13px] text-[#acb6ad]">
                <div className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 first:border-t-0 first:pt-0 sm:items-end`}>
                  <p className="uppercase tracking-[0.06em]">Temporal Decay</p>
                  <p className="text-sm text-[#f1f5ef]">λ = 0.001</p>
                </div>
                <div className={`flex items-start justify-between gap-4 ${terminalDividerClassName} pt-3 sm:items-end`}>
                  <p className="uppercase tracking-[0.06em]">Regime Filter</p>
                  <p className="text-right text-sm text-[#acb6ad]">ACTIVE (HMM Proxy)</p>
                </div>
                <div className={`flex items-start justify-between gap-4 ${terminalDividerClassName} pt-3 sm:items-end`}>
                  <p className="uppercase tracking-[0.06em]">Selection Logic</p>
                  <p className="text-right text-sm text-[#acb6ad]">Exact decayed KNN top 5</p>
                </div>
              </div>

              <p className="mt-4 max-w-xl text-xs leading-5 text-[#829287]">
                Dataset is hard-capped to a 10-year rolling window to prevent Z-score distortion, and pre-filtered by structural regime.
              </p>
            </section>
          </div>
          ) : null}
        </section>
      </div>
    </MemberShell>
  );
}
