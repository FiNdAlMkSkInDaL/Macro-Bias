import { headers } from "next/headers";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

import { AssetHeatmap } from "../../components/dashboard/AssetHeatmap";
import { BiasGauge } from "../../components/dashboard/BiasGauge";
import {
  SignalBreakdown,
  type SignalBreakdownScore,
} from "../../components/dashboard/SignalBreakdown";
import { PaywallWrapper } from "../../components/paywall-wrapper";
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
    return "Cyclical leadership is expanding, and defensive hedges are losing relative momentum.";
  }

  if (regime === "Risk-Off") {
    return "Traders are leaning into protection as growth-sensitive assets lose sponsorship.";
  }

  return "Signal quality is mixed, so conviction remains tactical instead of directional.";
}

function formatMove(value: number | null): string {
  if (value === null) {
    return "Pending";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
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

async function getDashboardData(): Promise<DashboardDataResult> {
  const emptyBiasData: BiasData = {
    biasScore: 0,
    assets: [],
  };

  try {
    const response = await fetch(`${await getRequestBaseUrl()}/api/bias/latest`, {
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
  const { biasData, errorMessage, snapshot } = await getDashboardData();
  const regime = getBiasRegime(biasData.biasScore);
  const sortedAssets = [...biasData.assets].sort(
    (leftAsset, rightAsset) => leftAsset.dailyChangePercent - rightAsset.dailyChangePercent,
  );
  const weakestAsset = sortedAssets[0] ?? null;
  const strongestAsset = sortedAssets[sortedAssets.length - 1] ?? null;
  const advancingAssets = biasData.assets.filter(
    (asset) => asset.dailyChangePercent > 0,
  ).length;
  const reportDate = formatTradeDate(snapshot?.tradeDate);
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

  return (
    <main
      className={`${headingFont.variable} ${dataFont.variable} min-h-screen bg-zinc-950 font-sans font-[family:var(--font-heading)] text-zinc-100`}
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/5 py-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              [ Live Macro Regime Dashboard ]
            </p>
            <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tighter text-white md:text-4xl">
              Daily Macro Bias
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Pre-market regime context served directly from the latest live snapshot.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 md:min-w-0 md:flex-shrink-0 md:gap-6">
            <div>
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                Date
              </p>
              <p className="mt-2 text-base font-semibold tracking-tight text-white">
                {reportDate}
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

            <SignalBreakdown componentScores={snapshot?.componentScores ?? []} />

            <PaywallWrapper>
              <AssetHeatmap assets={biasData.assets} />
            </PaywallWrapper>
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
                    View
                  </p>
                  <p className="mt-1 text-sm font-medium text-white">Heatmap preview</p>
                </div>
                <p className="font-[family:var(--font-data)] text-sm text-zinc-300">Below</p>
              </div>
            </div>

            <div className="border-t border-white/10 pt-4">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                Signal note
              </p>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                The bias scale stays fully visible, and the gated heatmap preview now sits immediately underneath the main read instead of below a large visual break.
              </p>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}