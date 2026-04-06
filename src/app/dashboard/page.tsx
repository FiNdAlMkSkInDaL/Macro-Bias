import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

import { BiasGauge } from "../../components/dashboard/BiasGauge";
import { ShareEdgeButton } from "../../components/dashboard/ShareEdgeButton";
import {
  type SignalBreakdownScore,
} from "../../components/dashboard/SignalBreakdown";
import { PaywallWrapper } from "../../components/paywall-wrapper";
import { getUserSubscriptionStatus, isSubscriptionActive } from "../../lib/billing/subscription";
import { getAppUrl } from "../../lib/server-env";
import { CORE_ASSET_TICKERS, type BiasAsset, type BiasData } from "../../types";

export const dynamic = "force-dynamic";

const headingFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

const dataFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-data",
});

type ApiTickerChange = {
  close: number;
  percentChange: number;
  previousClose: number;
  ticker: BiasAsset["ticker"];
  tradeDate: string;
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
  label: string;
  score: number;
  tickerChanges: Partial<Record<BiasAsset["ticker"], ApiTickerChange>>;
  tradeDate: string;
  updatedAt: string;
};

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
    symbol: "SPY RSI / SMA",
  },
] satisfies Array<{
  key: SignalBreakdownScore["key"];
  label: string;
  symbol: string;
}>;

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
      tone: "text-zinc-500",
    };
  }

  if (signal > 0.15) {
    return {
      label: "Bullish",
      tone: "text-emerald-400",
    };
  }

  if (signal < -0.15) {
    return {
      label: "Bearish",
      tone: "text-rose-400",
    };
  }

  return {
    label: "Neutral",
    tone: "text-zinc-300",
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

function getBiasRegime(biasScore: number): "Risk-On" | "Neutral" | "Risk-Off" {
  if (biasScore > 30) {
    return "Risk-On";
  }

  if (biasScore < -30) {
    return "Risk-Off";
  }

  return "Neutral";
}

function formatBiasLabel(label: string | undefined): string {
  if (!label) {
    return "Awaiting First Sync";
  }

  return label.toLowerCase().split("_").map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");
}

function getForecastCopy(regime: "Risk-On" | "Neutral" | "Risk-Off"): string {
  if (regime === "Risk-On") {
    return "Execution Context: Positive regime. Favor continuation setups and reduce defensive exposure.";
  }

  if (regime === "Risk-Off") {
    return "Execution Context: Defensive regime. Reduce gross exposure and tighten entry selection.";
  }

  return "Execution Context: Low-conviction regime. Prioritize tactical position sizing over directional swings.";
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
  }).format(new Date(`${tradeDate}T12:00:00Z`));
}

function formatTargetSessionDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(date);
}

function formatDataAsOfDate(tradeDate?: string) {
  if (!tradeDate) {
    return "Pending first sync";
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
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
    return "text-zinc-500";
  }

  if (value > 0) {
    return "text-emerald-400";
  }

  if (value < 0) {
    return "text-rose-400";
  }

  return "text-zinc-300";
}

function getDeltaTone(value: number | null): string {
  if (value === null) {
    return "text-zinc-500";
  }

  if (value > 0) {
    return "text-green-500";
  }

  if (value < 0) {
    return "text-red-500";
  }

  return "text-zinc-400";
}

function getRangeTone(value: number | null): string {
  if (value === null) {
    return "text-zinc-500";
  }

  return "text-sky-300";
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

async function getDashboardData(baseUrl: string): Promise<DashboardDataResult> {
  const emptyBiasData: BiasData = {
    biasScore: 0,
    assets: [],
  };

  try {
    const response = await fetch(`${baseUrl}/api/bias/latest`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
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

  const [baseUrl, { isPro, subscriptionStatus, user }] = await Promise.all([
    getRequestBaseUrl(),
    getUserSubscriptionStatus(),
  ]);
  const landingPageUrl = new URL("/#auth-console", baseUrl).toString();
  const { biasData, errorMessage, snapshot } = await getDashboardData(baseUrl);
  const isProUser = isSubscriptionActive(subscriptionStatus);
  const shouldRenderManageSubscription = isPro;
  const regime = getBiasRegime(biasData.biasScore);
  const sortedAssets = [...biasData.assets].sort(
    (leftAsset, rightAsset) => leftAsset.dailyChangePercent - rightAsset.dailyChangePercent,
  );
  const weakestAsset = sortedAssets[0] ?? null;
  const strongestAsset = sortedAssets[sortedAssets.length - 1] ?? null;
  const advancingAssets = biasData.assets.filter(
    (asset) => asset.dailyChangePercent > 0,
  ).length;
  const targetSessionDate = formatTargetSessionDate();
  const snapshotDateLabel = formatDataAsOfDate(snapshot?.tradeDate);
  const signalLabel = formatBiasLabel(snapshot?.label);
  const breadthSummary =
    biasData.assets.length > 0
      ? `${advancingAssets}/${biasData.assets.length} advancing`
      : "Waiting for market data";
  const strongestMoveTone =
    strongestAsset && strongestAsset.dailyChangePercent > 0
      ? "text-emerald-400"
      : "text-zinc-300";
  const weakestMoveTone =
    weakestAsset && weakestAsset.dailyChangePercent < 0
      ? "text-rose-400"
      : "text-zinc-300";
  const historicalAnalogs = snapshot?.historicalAnalogs ?? null;
  const componentScores = snapshot?.componentScores ?? [];
  const signalScoreByKey = new Map(componentScores.map((score) => [score.key, score]));
  const detailedSignalScoreByKey = new Map(
    (snapshot?.detailedComponentScores ?? []).map((score) => [score.pillar ?? score.key, score]),
  );
  const topAnalogMatches = historicalAnalogs?.topMatches ?? [];
  const analogSummaryCopy = historicalAnalogs
    ? `${historicalAnalogs.alignedSessionCount.toLocaleString()} aligned historical sessions in the analog engine`
    : "historical analog engine warming up";
  const moduleClassName = "border border-white/10 p-5 sm:p-6";
  const footerModuleClassName =
    "border border-white/10 p-5 text-sm leading-6 text-zinc-500 sm:p-6";
  const shareCopy = [
    `Macro Bias | ${targetSessionDate}`,
    `Data as of ${snapshotDateLabel}`,
    `${signalLabel} (${biasData.biasScore > 0 ? "+" : ""}${biasData.biasScore})`,
    breadthSummary,
    strongestAsset
      ? `Leader ${strongestAsset.ticker} ${formatMove(strongestAsset.dailyChangePercent ?? null)}`
      : null,
    analogSummaryCopy,
    `See today's edge: ${landingPageUrl}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" | ");

  return (
    <main
      className={`${headingFont.variable} ${dataFont.variable} min-h-screen bg-zinc-950 font-sans font-[family:var(--font-heading)] text-zinc-100`}
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/5 py-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              [ Regime Data Terminal ]
            </p>
            <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tighter text-white md:text-4xl">
              Daily Macro Bias
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Institutional-grade macro risk scoring. Updated daily at 08:30 EST.
            </p>
          </div>

          <div className="flex flex-col gap-4 md:min-w-0 md:flex-shrink-0 md:items-end">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 md:gap-6">
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Date
                </p>
                <p className="mt-2 text-base font-semibold tracking-tight text-white">
                  {targetSessionDate}
                </p>
                <p className="mt-1 font-[family:var(--font-data)] text-[10px] text-zinc-500">
                  Data as of: {snapshotDateLabel}
                </p>
              </div>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Snapshot
                </p>
                <p className="mt-2 text-base font-semibold tracking-tight text-white">
                  {signalLabel}
                </p>
              </div>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Breadth
                </p>
                <p className="mt-2 text-base font-semibold tracking-tight text-white">
                  {breadthSummary}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 md:items-end">
              <ShareEdgeButton copyText={shareCopy} />

              {shouldRenderManageSubscription ? (
                <a
                  className="text-xs text-zinc-500 hover:text-white underline underline-offset-4"
                  href="/api/stripe/portal"
                >
                  Manage Subscription
                </a>
              ) : null}
            </div>
          </div>
        </header>

        {errorMessage ? (
          <section className="border-b border-amber-400/15 py-3">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-amber-200/80">
              Latest sync issue
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-amber-100">{errorMessage}</p>
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-6 py-6 lg:grid-cols-2">
          <div className="grid grid-cols-1 gap-6 lg:col-span-2 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
            <section className={moduleClassName}>
              <BiasGauge biasScore={biasData.biasScore} />
            </section>

            <section className={moduleClassName}>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
                  Storm Fronts
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
                  {regime} backdrop
                </h2>
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  {errorMessage ?? getForecastCopy(regime)}
                </p>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="border-t border-white/10 pt-3">
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                    Strongest
                  </p>
                  <p className="mt-2 text-sm font-medium text-white">
                    {strongestAsset?.ticker ?? "--"}
                  </p>
                  <p className={`mt-1 font-[family:var(--font-data)] text-sm ${strongestMoveTone}`}>
                    {formatMove(strongestAsset?.dailyChangePercent ?? null)}
                  </p>
                </div>

                <div className="border-t border-white/10 pt-3">
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                    Weakest
                  </p>
                  <p className="mt-2 text-sm font-medium text-white">
                    {weakestAsset?.ticker ?? "--"}
                  </p>
                  <p className={`mt-1 font-[family:var(--font-data)] text-sm ${weakestMoveTone}`}>
                    {formatMove(weakestAsset?.dailyChangePercent ?? null)}
                  </p>
                </div>

                <div className="border-t border-white/10 pt-3">
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                    Breadth
                  </p>
                  <p className="mt-2 text-sm font-medium text-white">{breadthSummary}</p>
                  <p className="mt-1 font-[family:var(--font-data)] text-sm text-zinc-400">
                    {biasData.assets.length} core ETFs
                  </p>
                </div>
              </div>
            </section>
          </div>

          {!isProUser ? (
            <section className={`${moduleClassName} lg:col-span-2`}>
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
                Locked Workspace
              </p>
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-white">
                Historical Playbook + Setup Map
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                Signal drivers, cross-asset confirmation, and the intraday playbook are arranged below in the Pro grid.
              </p>
            </section>
          ) : null}

          <div className="lg:col-span-2">
            <PaywallWrapper initialIsPro={isProUser} userId={user?.id ?? null}>
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <section className={`${moduleClassName} h-full`}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                          Signal Breakdown
                        </p>
                        <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">
                          Context Engine
                        </h3>
                      </div>
                      <p className="max-w-md text-sm leading-6 text-zinc-500">
                        Weighted pillar contribution to the composite score.
                      </p>
                    </div>

                    <div className="mt-4 space-y-0">
                      {proSignalPillars.map((pillar) => {
                        const score = signalScoreByKey.get(pillar.key);
                        const detailedScore = detailedSignalScoreByKey.get(pillar.key);
                        const disposition = getSignalDisposition(score?.signal);

                        return (
                          <article
                            className="border-t border-white/10 py-3 first:border-t-0 first:pt-0 last:pb-0"
                            key={pillar.key}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                                  {pillar.label}
                                </p>
                                <p className="mt-1 text-sm font-medium text-white">{pillar.symbol}</p>
                              </div>

                              <div className="text-right">
                                <p
                                  className={`font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] ${disposition.tone}`}
                                >
                                  {disposition.label}
                                </p>
                                <p className="mt-2 font-[family:var(--font-data)] text-base text-white">
                                  {formatContribution(score?.contribution)}
                                </p>
                                <p className="mt-1 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                                  of {formatWeight(score?.weight)} pts
                                </p>
                              </div>
                            </div>

                            <p className="mt-3 text-sm leading-6 text-zinc-400">
                              {detailedScore?.summary ?? "Waiting for the next model sync to publish this pillar's narrative read."}
                            </p>
                          </article>
                        );
                      })}
                    </div>
                  </section>

                  <section className={`${moduleClassName} h-full`}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                          Cross-Asset Map
                        </p>
                        <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">
                          Market Internals
                        </h3>
                      </div>
                      <p className="max-w-md text-sm leading-6 text-zinc-500">
                        Live confirmation across the core ETF basket feeding the composite bias.
                      </p>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {biasData.assets.map((asset) => (
                        <article className="border border-white/10 p-4" key={asset.ticker}>
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                                {asset.ticker}
                              </p>
                              <p className="mt-2 text-sm font-medium text-white">
                                {formatPrice(asset.currentPrice)}
                              </p>
                            </div>
                            <p className={`font-[family:var(--font-data)] text-sm ${getMoveTone(asset.dailyChangePercent)}`}>
                              {formatMove(asset.dailyChangePercent)}
                            </p>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                </div>

                <section className={moduleClassName}>
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                        Historical Analogs
                      </p>
                      <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">
                        Intraday Playbook
                      </h3>
                    </div>
                    {historicalAnalogs ? (
                      <p className="max-w-lg text-sm leading-6 text-zinc-500">
                        Ranked against {historicalAnalogs.alignedSessionCount.toLocaleString()} aligned sessions across {historicalAnalogs.featureTickers.join(", ")}.
                      </p>
                    ) : null}
                  </div>

                  {historicalAnalogs ? (
                    <div className="overflow-hidden">
                      <table className="min-w-full table-fixed border-collapse text-left">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="w-[34%] py-4 pr-6 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                              Matched date
                            </th>
                            <th className="w-[16%] py-4 pr-6 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                              Match confidence
                            </th>
                            <th className="w-[16%] py-4 pr-6 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                              SPY Gap
                            </th>
                            <th className="w-[18%] py-4 pr-6 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                              SPY Intraday (O-C)
                            </th>
                            <th className="w-[16%] py-4 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                              SPY Range
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {topAnalogMatches.map((match) => (
                            <tr
                              className="border-b border-white/10 even:bg-white/[0.02] last:border-b-0"
                              key={match.tradeDate}
                            >
                              <td className="py-5 pr-6 align-middle">
                                <p className="text-base font-medium text-white">
                                  {formatAnalogDate(match.tradeDate)}
                                </p>
                                <p className="mt-1 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                                  Next {formatAnalogDate(match.nextSessionDate)}
                                </p>
                              </td>
                              <td className="py-5 pr-6 align-middle">
                                <p className="font-[family:var(--font-data)] text-sm text-zinc-400">
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
                  ) : (
                    <div className="border border-white/10 bg-white/[0.01] p-4">
                      <p className="max-w-2xl text-sm leading-6 text-zinc-500">
                        The analog engine has not yet produced a complete intraday playbook for this snapshot. Additional aligned price history is required before the next-session gap, intraday drift, and range profile can be computed.
                      </p>
                    </div>
                  )}
                </section>
              </div>
            </PaywallWrapper>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:col-span-2 lg:grid-cols-2">
            <section className={footerModuleClassName}>
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                Macro Summary
              </p>
              <h3 className="mt-2 text-base font-semibold tracking-tight text-white">
                Cluster Averages
              </h3>

              {isProUser ? (
                <div className="mt-4 space-y-0 font-[family:var(--font-data)] text-[11px]">
                  <div className="flex items-end justify-between gap-4 border-t border-white/10 py-3 first:pt-0">
                    <p className="uppercase tracking-[0.28em] text-zinc-500">Aligned Sessions</p>
                    <p className="text-sm text-white">
                      {historicalAnalogs
                        ? historicalAnalogs.alignedSessionCount.toLocaleString()
                        : "--"}
                    </p>
                  </div>

                  <div className="flex items-end justify-between gap-4 border-t border-white/10 py-3">
                    <p className="uppercase tracking-[0.28em] text-zinc-500">Usable Matches</p>
                    <p className="text-sm text-white">
                      {historicalAnalogs
                        ? historicalAnalogs.candidateCount.toLocaleString()
                        : "--"}
                    </p>
                  </div>

                  <div className="flex items-end justify-between gap-4 border-t border-white/10 py-3">
                    <p className="uppercase tracking-[0.28em] text-zinc-500">Avg Overnight Gap</p>
                    <p className={getMoveTone(historicalAnalogs?.clusterAveragePlaybook.overnightGap ?? null)}>
                      {formatMove(historicalAnalogs?.clusterAveragePlaybook.overnightGap ?? null)}
                    </p>
                  </div>

                  <div className="flex items-end justify-between gap-4 border-t border-white/10 py-3">
                    <p className="uppercase tracking-[0.28em] text-zinc-500">Avg Intraday Net</p>
                    <p className={getMoveTone(historicalAnalogs?.clusterAveragePlaybook.intradayNet ?? null)}>
                      {formatMove(historicalAnalogs?.clusterAveragePlaybook.intradayNet ?? null)}
                    </p>
                  </div>

                  <div className="flex items-end justify-between gap-4 border-t border-white/10 pt-3">
                    <p className="uppercase tracking-[0.28em] text-zinc-500">Avg Session Range</p>
                    <p className={getRangeTone(historicalAnalogs?.clusterAveragePlaybook.sessionRange ?? null)}>
                      {formatUnsignedPercent(historicalAnalogs?.clusterAveragePlaybook.sessionRange ?? null)}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-500">
                  Upgrade to expose the exact analog cluster averages behind the current regime classification.
                </p>
              )}
            </section>

            <section className={footerModuleClassName}>
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                Model Integrity
              </p>
              <h3 className="mt-2 text-base font-semibold tracking-tight text-white">
                Microstructure Upgrade
              </h3>
              <p className="mt-3">
                This score is generated from a K-Nearest Neighbors engine over aligned intermarket history. The dashboard, playbook table, and publication pipeline now reference the same decay-adjusted analog set.
              </p>

              <div className="mt-4 space-y-3 font-[family:var(--font-data)] text-[11px] text-zinc-500">
                <div className="flex items-end justify-between gap-4 border-t border-white/10 py-3 first:pt-0">
                  <p className="uppercase tracking-[0.28em]">Temporal Decay</p>
                  <p className="text-sm text-white">λ = 0.001</p>
                </div>
                <div className="flex items-end justify-between gap-4 border-t border-white/10 pt-3">
                  <p className="uppercase tracking-[0.28em]">Selection Logic</p>
                  <p className="text-right text-sm text-zinc-400">Exact decayed KNN top 5</p>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}