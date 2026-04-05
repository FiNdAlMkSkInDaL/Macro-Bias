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
      className={`${headingFont.variable} ${dataFont.variable} min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.12),_transparent_24%),radial-gradient(circle_at_85%_15%,_rgba(148,163,184,0.1),_transparent_18%),linear-gradient(180deg,_#020617_0%,_#0f172a_55%,_#020617_100%)] px-4 py-10 font-sans font-[family:var(--font-heading)] text-slate-100 sm:px-6 lg:px-8`}
    >
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-800/80 bg-slate-950/75 p-6 shadow-[0_30px_80px_rgba(2,6,23,0.55)] backdrop-blur-sm sm:p-8">
          <div className="flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <span className="inline-flex items-center rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 font-mono font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.32em] text-sky-200">
                Live Macro Weather Report
              </span>
              <h1 className="mt-5 text-4xl font-semibold text-white sm:text-5xl">
                Daily Macro Bias dashboard for fast, pre-market context.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                The score card now reads directly from the latest live snapshot served by the /api/bias/latest route.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[420px]">
              <article className="rounded-[24px] border border-slate-800 bg-slate-900/75 p-4">
                <p className="font-mono font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.3em] text-slate-500">
                  Report Date
                </p>
                <p className="mt-3 text-lg font-semibold text-white">{reportDate}</p>
              </article>
              <article className="rounded-[24px] border border-slate-800 bg-slate-900/75 p-4">
                <p className="font-mono font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.3em] text-slate-500">
                  Snapshot
                </p>
                <p className="mt-3 text-lg font-semibold text-white">{signalLabel}</p>
              </article>
              <article className="rounded-[24px] border border-slate-800 bg-slate-900/75 p-4">
                <p className="font-mono font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.3em] text-slate-500">
                  Breadth
                </p>
                <p className="mt-3 text-lg font-semibold text-white">{breadthSummary}</p>
              </article>
            </div>
          </div>
        </section>

        {errorMessage ? (
          <section className="rounded-[24px] border border-amber-400/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
            {errorMessage}
          </section>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)]">
          <BiasGauge biasScore={biasData.biasScore} />

          <aside className="rounded-[28px] border border-slate-800/80 bg-slate-950/80 p-6 shadow-[0_24px_60px_rgba(2,6,23,0.45)] backdrop-blur-sm sm:p-7">
            <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-slate-400">
              Storm Fronts
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
              {regime} backdrop
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              {errorMessage ?? getForecastCopy(regime)}
            </p>

            <div className="mt-8 space-y-4">
              <article className="rounded-[24px] border border-emerald-500/25 bg-emerald-500/10 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-emerald-200/75">
                  Strongest tailwind
                </p>
                <div className="mt-4 flex items-end justify-between gap-4">
                  <p className="text-3xl font-semibold text-white">{strongestAsset?.ticker ?? "--"}</p>
                  <p className="font-mono text-lg text-emerald-200">
                    {formatMove(strongestAsset?.dailyChangePercent ?? null)}
                  </p>
                </div>
              </article>

              <article className="rounded-[24px] border border-rose-500/25 bg-rose-500/10 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-rose-200/75">
                  Weakest pocket
                </p>
                <div className="mt-4 flex items-end justify-between gap-4">
                  <p className="text-3xl font-semibold text-white">{weakestAsset?.ticker ?? "--"}</p>
                  <p className="font-mono text-lg text-rose-200">
                    {formatMove(weakestAsset?.dailyChangePercent ?? null)}
                  </p>
                </div>
              </article>

              <article className="rounded-[24px] border border-slate-800 bg-slate-900/70 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">
                  Signal note
                </p>
                <p className="mt-4 text-sm leading-6 text-slate-300">
                  BiasGauge stays fully exposed, while the premium cross-asset heatmap below is gated behind the subscription paywall.
                </p>
              </article>
            </div>
          </aside>
        </section>

        <PaywallWrapper>
          <AssetHeatmap assets={biasData.assets} />
        </PaywallWrapper>
      </div>
    </main>
  );
}