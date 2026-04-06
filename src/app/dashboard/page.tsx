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
  const topAnalogMatches = historicalAnalogs?.topMatches ?? [];
  const analogSummaryCopy = historicalAnalogs
    ? `${historicalAnalogs.alignedSessionCount.toLocaleString()} aligned historical sessions in the analog engine`
    : "historical analog engine warming up";
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

        <section className="grid grid-cols-1 gap-8 py-5 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            <BiasGauge biasScore={biasData.biasScore} />

            {!isProUser ? (
              <section className="border-t border-white/5 pt-5">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] lg:items-end">
                  <div>
                    <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
                      Historical Analog Engine
                    </p>
                    <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
                      Closest historical tape
                    </h2>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                      {historicalAnalogs
                        ? `Pattern matching identified ${historicalAnalogs.candidateCount.toLocaleString()} mathematical analogs. Upgrade to unlock the typical overnight gap, cash-session drift, and range expansion for the next SPY session.`
                        : "Pattern library unavailable. Additional aligned history is required before next-session gap, intraday drift, and range tendencies can be computed."}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="border-t border-white/10 pt-3">
                      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                        Matching sessions
                      </p>
                      <p className="mt-2 text-lg font-semibold tracking-tight text-white">
                        {historicalAnalogs
                          ? historicalAnalogs.candidateCount.toLocaleString()
                          : "--"}
                      </p>
                    </div>

                    <div className="border-t border-white/10 pt-3">
                      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                        Nearest cluster
                      </p>
                      <p className="mt-2 text-lg font-semibold tracking-tight text-white">
                        {topAnalogMatches.length > 0 ? `${topAnalogMatches.length} sessions` : "--"}
                      </p>
                    </div>

                    <div className="col-span-2 border-t border-white/10 pt-3 sm:col-span-1">
                      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                        Next session playbook
                      </p>
                      <ul className="mt-2 space-y-1 text-sm text-zinc-400">
                        <li>Gap ...</li>
                        <li>Intraday ...</li>
                        <li>Range ...</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="border-t border-white/5 pt-5">
              {isProUser ? (
                <div className="mb-5">
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
                    [ PRO DATA TERMINAL ]
                  </p>
                </div>
              ) : (
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
                      Locked Workspace
                    </p>
                    <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
                      Historical Playbook + Setup Map
                    </h2>
                  </div>
                  <p className="max-w-md text-sm leading-6 text-zinc-500">
                    Historical analogs, signal drivers, and cross-asset confirmation live behind the lock.
                  </p>
                </div>
              )}

              <PaywallWrapper initialIsPro={isProUser} userId={user?.id ?? null}>
                <div>
                  <section>
                    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                          Historical Analogs
                        </p>
                        <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">
                          Intraday Playbook
                        </h3>
                      </div>
                      {isProUser && historicalAnalogs ? (
                        <p className="max-w-lg text-sm leading-6 text-zinc-500">
                          Ranked against {historicalAnalogs.alignedSessionCount.toLocaleString()} aligned sessions across {historicalAnalogs.featureTickers.join(", ")}.
                        </p>
                      ) : null}
                    </div>

                    {historicalAnalogs ? (
                      <>
                        <div className="overflow-hidden">
                          <table className="min-w-full table-fixed border-collapse text-left">
                            <thead>
                              <tr className="border-b border-zinc-800">
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
                                <tr className="border-b border-zinc-800 last:border-b-0" key={match.tradeDate}>
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
                      </>
                    ) : (
                      <div className="border-y border-white/5 py-4">
                        <p className="max-w-2xl text-sm leading-6 text-zinc-500">
                          The analog engine has not yet produced a complete intraday playbook for this snapshot. Additional aligned price history is required before the next-session gap, intraday drift, and range profile can be computed.
                        </p>
                      </div>
                    )}
                  </section>

                  {isProUser ? (
                    <section className="mt-12 border-t border-white/10 pt-4">
                      <div className="flex flex-col gap-2">
                        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                          Methodology
                        </p>
                        <h3 className="text-lg font-semibold tracking-tight text-white">
                          Signal Breakdown
                        </h3>
                        <p className="text-sm leading-6 text-zinc-500">
                          Weighted pillar contribution to the composite score.
                        </p>
                      </div>

                      <div className="mt-4 space-y-0">
                        {proSignalPillars.map((pillar) => {
                          const score = signalScoreByKey.get(pillar.key);
                          const disposition = getSignalDisposition(score?.signal);

                          return (
                            <article className="border-b border-zinc-900 py-3 last:border-b-0" key={pillar.key}>
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
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}
                </div>
              </PaywallWrapper>
            </section>
          </div>

          <aside className="space-y-5 border-t border-white/5 pt-5 lg:col-span-4 lg:border-l lg:border-t-0 lg:border-white/5 lg:pl-6 lg:pt-0">
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

            <div className="border-t border-white/10">
              <div className="flex items-center justify-between gap-4 border-b border-white/5 py-3">
                <div>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                    Strongest
                  </p>
                  <p className="mt-1 text-sm font-medium text-white">
                    {strongestAsset?.ticker ?? "--"}
                  </p>
                </div>
                <p className={`font-[family:var(--font-data)] text-sm ${strongestMoveTone}`}>
                  {formatMove(strongestAsset?.dailyChangePercent ?? null)}
                </p>
              </div>

              <div className="flex items-center justify-between gap-4 border-b border-white/5 py-3">
                <div>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                    Weakest
                  </p>
                  <p className="mt-1 text-sm font-medium text-white">
                    {weakestAsset?.ticker ?? "--"}
                  </p>
                </div>
                <p className={`font-[family:var(--font-data)] text-sm ${weakestMoveTone}`}>
                  {formatMove(weakestAsset?.dailyChangePercent ?? null)}
                </p>
              </div>

              <div className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                    Heatmap
                  </p>
                  <p className="mt-1 text-sm font-medium text-white">
                    {isProUser ? "Cross-asset map" : "Heatmap preview"}
                  </p>
                </div>
                <p className="font-[family:var(--font-data)] text-sm text-zinc-300">
                  {isProUser ? `${biasData.assets.length} assets` : "Below"}
                </p>
              </div>
            </div>

            {isProUser ? (
              <div className="border-t border-white/10 pt-4">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Cross-Asset Map
                </p>

                <div className="mt-4 space-y-3">
                  {biasData.assets.map((asset) => (
                    <div
                      className="flex items-center justify-between gap-4 border-b border-zinc-800 pb-3 last:border-b-0 last:pb-0"
                      key={asset.ticker}
                    >
                      <div>
                        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                          {asset.ticker}
                        </p>
                        <p className="mt-1 text-sm font-medium text-white">
                          {formatPrice(asset.currentPrice)}
                        </p>
                      </div>
                      <p className={`font-[family:var(--font-data)] text-sm ${getMoveTone(asset.dailyChangePercent)}`}>
                        {formatMove(asset.dailyChangePercent)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="border-t border-white/10 pt-4">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                Model Integrity
              </p>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                Model Integrity: This score is derived via K-Nearest Neighbors analysis across 730 days of intermarket data. No discretionary bias is applied to the output.
              </p>
              {isProUser ? (
                <div className="mt-4 border-y border-white/5">
                  <div className="flex items-start justify-between gap-4 py-3">
                    <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                      Temporal Decay Factor
                    </p>
                    <p className="font-[family:var(--font-data)] text-sm text-white">
                      λ = 0.001
                    </p>
                  </div>
                  <p className="pb-3 text-sm leading-6 text-zinc-500">
                    Older analogs are mathematically penalized to prioritize recent market microstructures.
                  </p>
                </div>
              ) : null}
            </div>

            {isProUser ? (
              <div className="border-t border-white/10 pt-4">
                <div className="flex flex-col gap-2">
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                    Cluster Averages
                  </p>
                  <h3 className="text-lg font-semibold tracking-tight text-white">
                    Macro summary
                  </h3>
                </div>

                <div className="mt-4">
                  <div className="flex items-end justify-between gap-4 border-b border-zinc-900 py-3">
                    <div>
                      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                        Aligned Sessions
                      </p>
                    </div>
                    <p className="font-[family:var(--font-data)] text-lg text-white">
                      {historicalAnalogs
                        ? historicalAnalogs.alignedSessionCount.toLocaleString()
                        : "--"}
                    </p>
                  </div>

                  <div className="flex items-end justify-between gap-4 border-b border-zinc-900 py-3">
                    <div>
                      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                        Usable Matches
                      </p>
                    </div>
                    <p className="font-[family:var(--font-data)] text-lg text-white">
                      {historicalAnalogs
                        ? historicalAnalogs.candidateCount.toLocaleString()
                        : "--"}
                    </p>
                  </div>

                  <div className="flex items-end justify-between gap-4 border-b border-zinc-900 py-3">
                    <div>
                      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                        Avg Overnight Gap
                      </p>
                    </div>
                    <p
                      className={`font-[family:var(--font-data)] text-lg ${getMoveTone(historicalAnalogs?.clusterAveragePlaybook.overnightGap ?? null)}`}
                    >
                      {formatMove(historicalAnalogs?.clusterAveragePlaybook.overnightGap ?? null)}
                    </p>
                  </div>

                  <div className="flex items-end justify-between gap-4 border-b border-zinc-900 py-3">
                    <div>
                      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                        Avg Intraday Net
                      </p>
                    </div>
                    <p
                      className={`font-[family:var(--font-data)] text-lg ${getMoveTone(historicalAnalogs?.clusterAveragePlaybook.intradayNet ?? null)}`}
                    >
                      {formatMove(historicalAnalogs?.clusterAveragePlaybook.intradayNet ?? null)}
                    </p>
                  </div>

                  <div className="flex items-end justify-between gap-4 border-b border-zinc-900 py-3 last:border-b-0">
                    <div>
                      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                        Avg Session Range
                      </p>
                    </div>
                    <p
                      className={`font-[family:var(--font-data)] text-lg ${getRangeTone(historicalAnalogs?.clusterAveragePlaybook.sessionRange ?? null)}`}
                    >
                      {formatUnsignedPercent(historicalAnalogs?.clusterAveragePlaybook.sessionRange ?? null)}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

          </aside>
        </section>
      </div>
    </main>
  );
}