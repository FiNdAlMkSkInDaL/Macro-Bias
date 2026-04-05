import { headers } from "next/headers";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

import { AssetHeatmap } from "../../components/dashboard/AssetHeatmap";
import { BiasGauge } from "../../components/dashboard/BiasGauge";
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
  componentScores: Array<{
    contribution: number;
    key: string;
    signal: number;
    summary: string;
    weight: number;
  }>;
  createdAt: string;
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

  return (
    <main
      className={`${headingFont.variable} ${dataFont.variable} min-h-screen bg-zinc-950 font-sans font-[family:var(--font-heading)] text-zinc-100`}
    >
      <div className="mx-auto max-w-7xl px-6 py-12 sm:px-8 lg:px-10 lg:py-16">
        <section className="py-8 lg:py-12">
          <div className="max-w-5xl">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              [ Live Macro Regime Dashboard ]
            </p>
            <h1 className="mt-6 max-w-5xl text-balance text-5xl font-bold tracking-tighter text-white md:text-7xl">
              Daily Macro Bias. Built for the open.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-zinc-300 md:text-xl">
              A live regime read for pre-market decision-making, driven directly by the
              latest snapshot served through the bias API.
            </p>
          </div>

          <div className="mt-16 grid gap-10 border-t border-white/5 pt-8 sm:grid-cols-3 lg:max-w-4xl">
            <div>
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                Report Date
              </p>
              <p className="mt-3 text-lg font-semibold text-white md:text-xl">{reportDate}</p>
            </div>
            <div>
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                Snapshot
              </p>
              <p className="mt-3 text-lg font-semibold text-white md:text-xl">{signalLabel}</p>
            </div>
            <div>
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                Breadth
              </p>
              <p className="mt-3 text-lg font-semibold text-white md:text-xl">{breadthSummary}</p>
            </div>
          </div>
        </section>

        {errorMessage ? (
          <section className="border-t border-amber-400/15 py-6">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-amber-200/80">
              Latest sync issue
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-amber-100">{errorMessage}</p>
          </section>
        ) : null}

        <section className="grid gap-16 border-t border-white/5 py-20 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.86fr)] xl:items-start">
          <BiasGauge biasScore={biasData.biasScore} />

          <aside className="xl:border-l xl:border-white/5 xl:pl-10">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              Storm Fronts
            </p>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {regime} backdrop
            </h2>
            <p className="mt-5 max-w-md text-base leading-7 text-zinc-300">
              {errorMessage ?? getForecastCopy(regime)}
            </p>

            <div className="mt-12 space-y-8">
              <article className="border-t border-white/10 pt-4">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Strongest tailwind
                </p>
                <div className="mt-4 flex items-end justify-between gap-4">
                  <p className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                    {strongestAsset?.ticker ?? "--"}
                  </p>
                  <p className="font-[family:var(--font-data)] text-lg text-emerald-400">
                    {formatMove(strongestAsset?.dailyChangePercent ?? null)}
                  </p>
                </div>
              </article>

              <article className="border-t border-white/10 pt-4">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Weakest pocket
                </p>
                <div className="mt-4 flex items-end justify-between gap-4">
                  <p className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                    {weakestAsset?.ticker ?? "--"}
                  </p>
                  <p className="font-[family:var(--font-data)] text-lg text-rose-400">
                    {formatMove(weakestAsset?.dailyChangePercent ?? null)}
                  </p>
                </div>
              </article>

              <article className="border-t border-white/10 pt-4">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Signal note
                </p>
                <p className="mt-4 max-w-md text-sm leading-7 text-zinc-400">
                  BiasGauge stays fully exposed, while the premium cross-asset heatmap below is gated behind the subscription paywall.
                </p>
              </article>
            </div>
          </aside>
        </section>

        <section className="border-t border-white/5 py-20">
          <PaywallWrapper>
            <AssetHeatmap assets={biasData.assets} />
          </PaywallWrapper>
        </section>
      </div>
    </main>
  );
}