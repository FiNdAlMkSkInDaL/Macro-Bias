import { unstable_noStore as noStore } from "next/cache";

import { BiasGauge } from "@/components/dashboard/BiasGauge";
import { PaywallWrapper } from "@/components/paywall-wrapper";
import { AssetToggle } from "@/components/AssetToggle";
import {
  getUserSubscriptionStatus,
  isSubscriptionActive,
} from "@/lib/billing/subscription";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CRYPTO_ANALOG_MODEL_SETTINGS } from "@/lib/crypto-bias/constants";
import type {
  BiasLabel,
  CryptoBiasScoreRow,
  CryptoBiasComponentResult,
  CryptoHistoricalAnalogMatch,
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
  { key: "trendAndMomentum", label: "Trend & Momentum", symbol: "BTC RSI" },
  { key: "cryptoStructure", label: "Crypto Structure", symbol: "ETH/BTC" },
  {
    key: "macroCorrelation",
    label: "Macro Correlation",
    symbol: "BTC/GLD · DXY",
  },
  { key: "volatility", label: "Volatility", symbol: "BTC Realized Vol" },
] as const;

const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

function formatPrice(value: number | null) {
  if (value === null) return "Pending";
  return priceFormatter.format(value);
}

function formatMove(value: number | null): string {
  if (value === null) return "Pending";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
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
  if (!tradeDate) return "Pending first sync";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${tradeDate}T12:00:00Z`));
}

function formatAnalogDate(tradeDate?: string) {
  if (!tradeDate) return "Pending";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${tradeDate}T12:00:00Z`));
}

function formatBiasLabel(label: string | undefined): string {
  if (!label) return "Awaiting First Sync";
  return label
    .toLowerCase()
    .split("_")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

function formatContribution(value: number | undefined) {
  if (value == null || Number.isNaN(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatWeight(value: number | undefined) {
  if (value == null || Number.isNaN(value)) return "--";
  return value.toFixed(0);
}

function getSignalDisposition(signal: number | undefined) {
  if (signal == null || Number.isNaN(signal))
    return { label: "Pending", tone: "text-zinc-500" };
  if (signal > 0.15) return { label: "Bullish", tone: "text-emerald-400" };
  if (signal < -0.15) return { label: "Bearish", tone: "text-rose-400" };
  return { label: "Neutral", tone: "text-zinc-300" };
}

function getBiasRegime(
  biasScore: number,
): "Risk-On" | "Neutral" | "Risk-Off" {
  if (biasScore > 30) return "Risk-On";
  if (biasScore < -30) return "Risk-Off";
  return "Neutral";
}

const STORM_FRONTS_COPY = {
  neutral:
    "Capital is cycling between risk and safety without conviction. Crypto-specific setups are unreliable in this environment. Keep position sizes small and avoid chasing breakouts.",
  riskOff:
    "Macro headwinds are compressing crypto valuations. BTC dominance typically rises as altcoins bleed faster. Prioritise capital preservation and look for relative strength only in majors.",
  riskOn:
    "Macro tailwinds are feeding risk appetite into digital assets. BTC is catching structural bids from cross-asset flows. Lean into relative strength, buy the dips, and extend your profit targets.",
} as const;

function getCryptoForecastCopy(
  biasLabel: BiasLabel | undefined,
  regime: "Risk-On" | "Neutral" | "Risk-Off",
): string {
  switch (biasLabel) {
    case "RISK_ON":
    case "EXTREME_RISK_ON":
      return STORM_FRONTS_COPY.riskOn;
    case "RISK_OFF":
    case "EXTREME_RISK_OFF":
      return STORM_FRONTS_COPY.riskOff;
    case "NEUTRAL":
      return STORM_FRONTS_COPY.neutral;
    default:
      if (regime === "Risk-On") return STORM_FRONTS_COPY.riskOn;
      if (regime === "Risk-Off") return STORM_FRONTS_COPY.riskOff;
      return STORM_FRONTS_COPY.neutral;
  }
}

function getMoveTone(value: number | null): string {
  if (value === null) return "text-zinc-500";
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-rose-400";
  return "text-zinc-300";
}

function getDeltaTone(value: number | null): string {
  if (value === null) return "text-zinc-500";
  if (value > 0) return "text-green-500";
  if (value < 0) return "text-red-500";
  return "text-zinc-400";
}

function distanceToConfidence(distance: number): number {
  return Math.round(
    Math.max(0, Math.min(100, 100 * Math.exp(-distance * 0.5))),
  );
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

async function getLatestCryptoSnapshot(): Promise<CryptoBiasScoreRow | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("crypto_bias_scores")
      .select(
        "id, trade_date, score, bias_label, component_scores, ticker_changes, engine_inputs, technical_indicators, created_at, updated_at",
      )
      .order("trade_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return null;
    return data as CryptoBiasScoreRow | null;
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

  const [snapshot, { isPro, subscriptionStatus, user }, supplementalAssets] =
    await Promise.all([
      getLatestCryptoSnapshot(),
      getUserSubscriptionStatus(),
      getSupplementalAssets(),
    ]);

  if (!snapshot) {
    return (
      <main className="min-h-screen font-[family:var(--font-heading)]">
        <div className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 text-center">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Crypto Dashboard ]
          </p>
          <h1 className="mt-6 text-3xl font-bold text-white">No Data Yet</h1>
          <p className="mt-3 text-sm text-zinc-400">
            Crypto scores will appear after the first daily sync.
          </p>
        </div>
      </main>
    );
  }

  const isProUser = isSubscriptionActive(subscriptionStatus);
  const shouldRenderManageSubscription = isPro;
  const componentScores = snapshot.component_scores ?? [];
  const tickerChanges = snapshot.ticker_changes;
  const regime = getBiasRegime(snapshot.score);
  const signalLabel = formatBiasLabel(snapshot.bias_label);
  const targetSessionDate = formatTargetSessionDate();
  const snapshotDateLabel = formatDataAsOfDate(snapshot.trade_date);

  /* Ticker-level derived data */
  const tickerEntries = tickerChanges
    ? Object.entries(tickerChanges).map(([ticker, snap]) => ({
        ticker,
        close: (snap as CryptoTickerChangeSnapshot).close,
        percentChange: (snap as CryptoTickerChangeSnapshot).percentChange,
      }))
    : [];
  const sortedTickers = [...tickerEntries].sort(
    (a, b) => a.percentChange - b.percentChange,
  );
  const weakestTicker = sortedTickers[0] ?? null;
  const strongestTicker = sortedTickers.at(-1) ?? null;
  const advancingCount = tickerEntries.filter(
    (t) => t.percentChange > 0,
  ).length;
  const breadthSummary =
    tickerEntries.length > 0
      ? `${advancingCount}/${tickerEntries.length} advancing`
      : "Waiting for market data";
  const strongestMoveTone =
    strongestTicker && strongestTicker.percentChange > 0
      ? "text-emerald-400"
      : "text-zinc-300";
  const weakestMoveTone =
    weakestTicker && weakestTicker.percentChange < 0
      ? "text-rose-400"
      : "text-zinc-300";

  /* Signal pillar lookup */
  const signalScoreByKey = new Map<string, CryptoBiasComponentResult>(
    componentScores.map((s) => [s.pillar ?? s.key, s]),
  );

  /* Analog data */
  const analogData = extractAnalogData(componentScores);

  /* Cross-asset map */
  const tickerPriceMap = new Map<
    string,
    { close: number; percentChange: number }
  >();
  if (tickerChanges) {
    for (const [ticker, snap] of Object.entries(tickerChanges)) {
      const s = snap as CryptoTickerChangeSnapshot;
      tickerPriceMap.set(ticker, {
        close: s.close,
        percentChange: s.percentChange,
      });
    }
  }

  const crossAssetMapAssets: CrossAssetMapAsset[] = CROSS_ASSET_TICKERS.map(
    (ticker) => {
      const crypto = tickerPriceMap.get(ticker);
      if (crypto) {
        return {
          currentPrice: crypto.close,
          dailyChangePercent: crypto.percentChange,
          ticker,
        };
      }
      return (
        supplementalAssets.find((a) => a.ticker === ticker) ?? {
          currentPrice: null,
          dailyChangePercent: null,
          ticker,
        }
      );
    },
  );

  /* Layout tokens (match stocks dashboard) */
  const terminalBorderClassName = "border border-white/5";
  const terminalDividerClassName = "border-t border-white/5";
  const terminalTableDividerClassName = "border-b border-white/5";
  const moduleClassName = `${terminalBorderClassName} min-w-0 p-4 sm:p-5 md:p-6`;
  const footerModuleClassName = `${terminalBorderClassName} min-w-0 p-4 text-sm leading-6 text-zinc-500 sm:p-5 md:p-6`;

  return (
    <main className="min-h-screen font-sans font-[family:var(--font-heading)]">
      <div className="mx-auto w-full max-w-7xl px-3 sm:px-4 md:px-6 lg:px-8">
        {/* ── Header ───────────────────────────────────────────── */}
        <header className="flex flex-col gap-4 border-b border-white/5 py-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center justify-between">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
                [ Crypto Data Terminal ]
              </p>
              <AssetToggle />
            </div>
            <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tighter text-white md:text-4xl">
              Daily Crypto Bias
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Institutional-grade crypto risk scoring. Updated daily.
            </p>
          </div>

          <div className="flex flex-col gap-4 md:min-w-0 md:flex-shrink-0 md:items-end">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:gap-6">
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
              <a
                href="/refer"
                className="inline-flex min-h-12 w-full items-center justify-center rounded-full border-[0.5px] border-sky-400/30 bg-sky-500/[0.06] px-5 py-3 text-[13px] font-medium text-sky-300 transition hover:border-sky-400/50 hover:bg-sky-500/[0.12] sm:w-auto sm:px-4 sm:py-2.5 sm:text-sm md:border"
              >
                Refer Friends
              </a>
              {shouldRenderManageSubscription ? (
                <a
                  className="text-xs text-zinc-500 underline underline-offset-4 hover:text-white"
                  href="/api/stripe/portal"
                >
                  Manage Subscription
                </a>
              ) : null}
            </div>
          </div>
        </header>

        {/* ── Main grid ────────────────────────────────────────── */}
        <section className="grid grid-cols-1 gap-4 py-4 md:gap-6 md:py-6 lg:grid-cols-2">
          {/* BiasGauge + Storm Fronts */}
          <div className="min-w-0 grid grid-cols-1 gap-4 md:gap-6 lg:col-span-2 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
            <section className={`${moduleClassName} overflow-hidden`}>
              <div className="mx-auto w-full max-w-[17rem] min-[360px]:max-w-full md:mx-0 md:max-w-none">
                <BiasGauge biasScore={snapshot.score} />
              </div>
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
                  {getCryptoForecastCopy(snapshot.bias_label, regime)}
                </p>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className={`${terminalDividerClassName} pt-3`}>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                    Strongest
                  </p>
                  <p className="mt-2 text-sm font-medium text-white">
                    {strongestTicker?.ticker ?? "--"}
                  </p>
                  <p
                    className={`mt-1 font-[family:var(--font-data)] text-sm ${strongestMoveTone}`}
                  >
                    {formatMove(strongestTicker?.percentChange ?? null)}
                  </p>
                </div>

                <div className={`${terminalDividerClassName} pt-3`}>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                    Weakest
                  </p>
                  <p className="mt-2 text-sm font-medium text-white">
                    {weakestTicker?.ticker ?? "--"}
                  </p>
                  <p
                    className={`mt-1 font-[family:var(--font-data)] text-sm ${weakestMoveTone}`}
                  >
                    {formatMove(weakestTicker?.percentChange ?? null)}
                  </p>
                </div>

                <div className={`${terminalDividerClassName} pt-3`}>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                    Breadth
                  </p>
                  <p className="mt-2 text-sm font-medium text-white">
                    {breadthSummary}
                  </p>
                  <p className="mt-1 font-[family:var(--font-data)] text-sm text-zinc-400">
                    3 core tokens
                  </p>
                </div>
              </div>
            </section>
          </div>

          {/* Locked workspace teaser (free users) */}
          {!isProUser ? (
            <section className={`${moduleClassName} lg:col-span-2`}>
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
                Locked Workspace
              </p>
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-white">
                Historical Playbook + Setup Map
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                Signal drivers, cross-asset confirmation, and the BTC
                forward-return playbook are arranged below in the Pro grid.
              </p>
            </section>
          ) : null}

          {/* ── Pro / Paywall content ──────────────────────────── */}
          <div className="min-w-0 lg:col-span-2">
            {isProUser ? (
              <div className="space-y-4 md:space-y-6">
                <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
                  {/* Signal Breakdown */}
                  <section className={`${moduleClassName} h-full`}>
                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                      <div>
                        <p className="font-[family:var(--font-data)] text-[9px] uppercase tracking-[0.32em] text-zinc-500 sm:text-[10px] sm:tracking-[0.36em]">
                          Signal Breakdown
                        </p>
                        <h3 className="mt-2 text-[clamp(1.05rem,4vw,1.125rem)] font-semibold tracking-tight text-white">
                          Context Engine
                        </h3>
                      </div>
                      <p className="max-w-md text-[clamp(0.8125rem,2.8vw,0.875rem)] leading-[1.75] text-zinc-500">
                        Weighted pillar contribution to the composite score.
                      </p>
                    </div>

                    <div className="mt-4 space-y-0">
                      {cryptoSignalPillars.map((pillar) => {
                        const score = signalScoreByKey.get(pillar.key);
                        const disposition = getSignalDisposition(score?.signal);

                        return (
                          <article
                            className={`${terminalDividerClassName} py-4 first:border-t-0 first:pt-0 last:pb-0`}
                            key={pillar.key}
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-[family:var(--font-data)] text-[9px] uppercase tracking-[0.28em] text-zinc-500 sm:text-[10px] sm:tracking-[0.32em]">
                                  {pillar.label}
                                </p>
                                <p className="mt-1 text-[15px] font-medium text-white sm:text-sm">
                                  {pillar.symbol}
                                </p>
                              </div>
                              <div className="sm:text-right">
                                <p
                                  className={`font-[family:var(--font-data)] text-[9px] uppercase tracking-[0.22em] sm:text-[10px] sm:tracking-[0.28em] ${disposition.tone}`}
                                >
                                  {disposition.label}
                                </p>
                                <p className="mt-2 font-[family:var(--font-data)] text-[15px] text-white sm:text-base">
                                  {formatContribution(score?.contribution)}
                                </p>
                                <p className="mt-1 font-[family:var(--font-data)] text-[9px] uppercase tracking-[0.22em] text-zinc-500 sm:text-[10px] sm:tracking-[0.28em]">
                                  of {formatWeight(score?.weight)} pts
                                </p>
                              </div>
                            </div>
                            <p className="mt-3 max-w-[65ch] text-[clamp(0.8125rem,2.9vw,0.875rem)] leading-[1.75] text-zinc-400">
                              {score?.summary ??
                                "Waiting for the next model sync to publish this pillar\u2019s narrative read."}
                            </p>
                          </article>
                        );
                      })}
                    </div>
                  </section>

                  {/* Cross-Asset Map */}
                  <section className={`${moduleClassName} h-full`}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                      <div>
                        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                          Cross-Asset Regime
                        </p>
                        <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">
                          Market Internals
                        </h3>
                      </div>
                      <p className="max-w-md text-sm leading-6 text-zinc-500">
                        Crypto majors alongside the macro anchors that drive the
                        correlation model.
                      </p>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:gap-3">
                      {crossAssetMapAssets.map((asset) => (
                        <article
                          className={`${terminalBorderClassName} overflow-hidden bg-white/[0.01] p-2.5 xl:p-3`}
                          key={asset.ticker}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                              {asset.ticker}
                            </p>
                            <p
                              className={`shrink-0 font-[family:var(--font-data)] text-[11px] ${getMoveTone(asset.dailyChangePercent)}`}
                            >
                              {formatMove(asset.dailyChangePercent)}
                            </p>
                          </div>
                          <p className="mt-1.5 text-sm font-medium text-white">
                            {formatPrice(asset.currentPrice)}
                          </p>
                        </article>
                      ))}
                    </div>
                  </section>
                </div>

                {/* Historical Analog Playbook */}
                <section className={moduleClassName}>
                  <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                        Historical Analogs
                      </p>
                      <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">
                        BTC Forward-Return Playbook
                      </h3>
                    </div>
                    {analogData ? (
                      <p className="max-w-lg text-sm leading-6 text-zinc-500">
                        Top {analogData.matchCount} nearest neighbors from the
                        crypto analog engine.
                      </p>
                    ) : null}
                  </div>

                  {analogData ? (
                    <div className="w-full">
                      <p className="text-[10px] text-zinc-500 sm:hidden">
                        &larr; scroll to see all columns &rarr;
                      </p>
                      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                        <table className="min-w-[36rem] border-collapse text-left md:min-w-full">
                          <thead>
                            <tr className={terminalTableDividerClassName}>
                              <th className="w-[30%] whitespace-nowrap py-4 pr-6 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                                Matched Date
                              </th>
                              <th className="w-[20%] whitespace-nowrap py-4 pr-6 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                                Similarity
                              </th>
                              <th className="w-[25%] whitespace-nowrap py-4 pr-6 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                                BTC 1-Day Return
                              </th>
                              <th className="w-[25%] whitespace-nowrap py-4 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                                BTC 3-Day Return
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {analogData.matches.map(
                              (match: CryptoHistoricalAnalogMatch) => (
                                <tr
                                  className={`${terminalTableDividerClassName} even:bg-white/[0.02] last:border-b-0`}
                                  key={match.tradeDate}
                                >
                                  <td className="py-5 pr-6 align-middle">
                                    <p className="text-base font-medium text-white">
                                      {formatAnalogDate(match.tradeDate)}
                                    </p>
                                  </td>
                                  <td className="py-5 pr-6 align-middle">
                                    <p className="font-[family:var(--font-data)] text-sm text-zinc-400">
                                      {distanceToConfidence(match.distance)}%
                                    </p>
                                  </td>
                                  <td
                                    className={`py-5 pr-6 align-middle font-[family:var(--font-data)] text-base ${getDeltaTone(match.btcForward1DayReturn)}`}
                                  >
                                    {formatMove(match.btcForward1DayReturn)}
                                  </td>
                                  <td
                                    className={`py-5 align-middle font-[family:var(--font-data)] text-base ${getDeltaTone(match.btcForward3DayReturn)}`}
                                  >
                                    {formatMove(match.btcForward3DayReturn)}
                                  </td>
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`${terminalBorderClassName} bg-white/[0.01] p-4`}
                    >
                      <p className="max-w-2xl text-sm leading-6 text-zinc-500">
                        The analog engine has not yet produced a complete
                        playbook for this snapshot. Additional aligned price
                        history is required before the forward-return profile
                        can be computed.
                      </p>
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <PaywallWrapper
                initialIsPro={false}
                userId={user?.id ?? null}
              >
                <div aria-hidden="true" className="space-y-4 md:space-y-6">
                  <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
                    {/* Locked Signal Breakdown */}
                    <section className={`${moduleClassName} h-full`}>
                      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                        <div>
                          <p className="font-[family:var(--font-data)] text-[9px] uppercase tracking-[0.32em] text-zinc-500 sm:text-[10px] sm:tracking-[0.36em]">
                            Signal Breakdown
                          </p>
                          <h3 className="mt-2 text-[clamp(1.05rem,4vw,1.125rem)] font-semibold tracking-tight text-white">
                            Context Engine
                          </h3>
                        </div>
                        <p className="max-w-md text-[clamp(0.8125rem,2.8vw,0.875rem)] leading-[1.75] text-zinc-500">
                          Weighted pillar contribution and regime notes unlock
                          with Pro.
                        </p>
                      </div>

                      <div className="mt-4 space-y-0">
                        {cryptoSignalPillars.map((pillar) => (
                          <article
                            className={`${terminalDividerClassName} py-4 first:border-t-0 first:pt-0 last:pb-0`}
                            key={pillar.key}
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-[family:var(--font-data)] text-[9px] uppercase tracking-[0.28em] text-zinc-500 sm:text-[10px] sm:tracking-[0.32em]">
                                  {pillar.label}
                                </p>
                                <p className="mt-1 text-[15px] font-medium text-white sm:text-sm">
                                  {pillar.symbol}
                                </p>
                              </div>
                              <div className="sm:text-right">
                                <p className="font-[family:var(--font-data)] text-[9px] uppercase tracking-[0.22em] text-zinc-500 sm:text-[10px] sm:tracking-[0.28em]">
                                  Locked
                                </p>
                                <p className="mt-2 font-[family:var(--font-data)] text-[15px] text-white sm:text-base">
                                  --
                                </p>
                              </div>
                            </div>
                            <p className="mt-3 max-w-[65ch] text-[clamp(0.8125rem,2.9vw,0.875rem)] leading-[1.75] text-zinc-500">
                              Premium narrative commentary is hidden until the
                              workspace is unlocked.
                            </p>
                          </article>
                        ))}
                      </div>
                    </section>

                    {/* Locked Cross-Asset Map */}
                    <section className={`${moduleClassName} h-full`}>
                      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                        <div>
                          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                            Cross-Asset Regime
                          </p>
                          <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">
                            Market Internals
                          </h3>
                        </div>
                        <p className="max-w-md text-sm leading-6 text-zinc-500">
                          Cross-asset internals and macro anchor cards unlock
                          with Pro access.
                        </p>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                        {CROSS_ASSET_TICKERS.map((ticker) => (
                          <article
                            className={`${terminalBorderClassName} bg-white/[0.01] p-4`}
                            key={ticker}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                                  {ticker}
                                </p>
                                <p className="mt-2 text-base font-medium text-white">
                                  Restricted
                                </p>
                              </div>
                              <p className="font-[family:var(--font-data)] text-sm text-zinc-500">
                                --
                              </p>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  </div>

                  {/* Locked Playbook */}
                  <section className={moduleClassName}>
                    <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                      <div>
                        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                          Historical Analogs
                        </p>
                        <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">
                          BTC Forward-Return Playbook
                        </h3>
                      </div>
                      <p className="max-w-lg text-sm leading-6 text-zinc-500">
                        Premium access unlocks the exact analog table and BTC
                        forward-return execution context.
                      </p>
                    </div>

                    <div className="w-full">
                      <p className="text-[10px] text-zinc-500 sm:hidden">
                        &larr; scroll to see all columns &rarr;
                      </p>
                      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                        <table className="min-w-[36rem] border-collapse text-left md:min-w-full">
                          <thead>
                            <tr className={terminalTableDividerClassName}>
                              <th className="w-[30%] whitespace-nowrap py-4 pr-6 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                                Matched Date
                              </th>
                              <th className="w-[20%] whitespace-nowrap py-4 pr-6 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                                Similarity
                              </th>
                              <th className="w-[25%] whitespace-nowrap py-4 pr-6 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                                BTC 1-Day Return
                              </th>
                              <th className="w-[25%] whitespace-nowrap py-4 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                                BTC 3-Day Return
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {Array.from({ length: 3 }, (_, index) => (
                              <tr
                                className={`${terminalTableDividerClassName} even:bg-white/[0.02] last:border-b-0`}
                                key={`locked-row-${index}`}
                              >
                                <td className="py-5 pr-6 align-middle font-[family:var(--font-data)] text-sm text-zinc-500">
                                  Restricted
                                </td>
                                <td className="py-5 pr-6 align-middle font-[family:var(--font-data)] text-sm text-zinc-500">
                                  --
                                </td>
                                <td className="py-5 pr-6 align-middle font-[family:var(--font-data)] text-sm text-zinc-500">
                                  --
                                </td>
                                <td className="py-5 align-middle font-[family:var(--font-data)] text-sm text-zinc-500">
                                  --
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>
                </div>
              </PaywallWrapper>
            )}
          </div>

          {/* ── Footer: Cluster Averages + Model Integrity ─────── */}
          {isProUser ? (
            <div className="min-w-0 grid grid-cols-1 gap-4 md:gap-6 lg:col-span-2 lg:grid-cols-2">
              <section className={footerModuleClassName}>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Crypto Summary
                </p>
                <h3 className="mt-2 text-base font-semibold tracking-tight text-white">
                  Cluster Averages
                </h3>

                <div className="mt-4 space-y-0 font-[family:var(--font-data)] text-[11px]">
                  <div
                    className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 first:border-t-0 first:pt-0 sm:items-end`}
                  >
                    <p className="uppercase tracking-[0.28em] text-zinc-500">
                      Analog Matches
                    </p>
                    <p className="text-sm text-white">
                      {analogData ? analogData.matchCount : "--"}
                    </p>
                  </div>

                  <div
                    className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 sm:items-end`}
                  >
                    <p className="uppercase tracking-[0.28em] text-zinc-500">
                      Avg BTC 1D Return
                    </p>
                    <p className={getMoveTone(analogData?.avg1d ?? null)}>
                      {formatMove(analogData?.avg1d ?? null)}
                    </p>
                  </div>

                  <div
                    className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 sm:items-end`}
                  >
                    <p className="uppercase tracking-[0.28em] text-zinc-500">
                      Avg BTC 3D Return
                    </p>
                    <p className={getMoveTone(analogData?.avg3d ?? null)}>
                      {formatMove(analogData?.avg3d ?? null)}
                    </p>
                  </div>

                  <div
                    className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 sm:items-end`}
                  >
                    <p className="uppercase tracking-[0.28em] text-zinc-500">
                      Bearish Hit Rate (1D)
                    </p>
                    <p className="text-sm text-zinc-400">
                      {analogData?.bearish1d != null
                        ? `${(analogData.bearish1d * 100).toFixed(0)}%`
                        : "--"}
                    </p>
                  </div>

                  <div
                    className={`flex items-start justify-between gap-4 ${terminalDividerClassName} pt-3 sm:items-end`}
                  >
                    <p className="uppercase tracking-[0.28em] text-zinc-500">
                      Bearish Hit Rate (3D)
                    </p>
                    <p className="text-sm text-zinc-400">
                      {analogData?.bearish3d != null
                        ? `${(analogData.bearish3d * 100).toFixed(0)}%`
                        : "--"}
                    </p>
                  </div>
                </div>
              </section>

              <section className={footerModuleClassName}>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Model Integrity
                </p>
                <h3 className="mt-2 text-base font-semibold tracking-tight text-white">
                  Crypto KNN Engine
                </h3>
                <p className="mt-3">
                  This score is generated from a K-Nearest Neighbors engine over
                  aligned crypto and intermarket history. The dashboard, playbook
                  table, and publication pipeline reference the same
                  decay-adjusted analog set.
                </p>

                <div className="mt-4 space-y-3 font-[family:var(--font-data)] text-[11px] text-zinc-500">
                  <div
                    className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 first:border-t-0 first:pt-0 sm:items-end`}
                  >
                    <p className="uppercase tracking-[0.28em]">
                      Temporal Decay
                    </p>
                    <p className="text-sm text-white">
                      &lambda; ={" "}
                      {CRYPTO_ANALOG_MODEL_SETTINGS.temporalDecayLambda}
                    </p>
                  </div>
                  <div
                    className={`flex items-start justify-between gap-4 ${terminalDividerClassName} pt-3 sm:items-end`}
                  >
                    <p className="uppercase tracking-[0.28em]">
                      Nearest Neighbors
                    </p>
                    <p className="text-right text-sm text-zinc-400">
                      K ={" "}
                      {CRYPTO_ANALOG_MODEL_SETTINGS.nearestNeighborCount}
                    </p>
                  </div>
                  <div
                    className={`flex items-start justify-between gap-4 ${terminalDividerClassName} pt-3 sm:items-end`}
                  >
                    <p className="uppercase tracking-[0.28em]">Feature Set</p>
                    <p className="text-right text-sm text-zinc-400">
                      BTC RSI · ETH/BTC · BTC/GLD · DXY · Vol · TLT
                    </p>
                  </div>
                </div>

                <p className="mt-4 max-w-xl text-xs leading-5 text-zinc-600">
                  The analog engine blends 1-day (40%) and 3-day (60%) forward
                  BTC returns through a tanh mapping scaled to &plusmn;100.
                </p>
              </section>
            </div>
          ) : (
            <PaywallWrapper
              initialIsPro={false}
              userId={user?.id ?? null}
            >
              <div className="min-w-0 grid grid-cols-1 gap-4 md:gap-6 lg:col-span-2 lg:grid-cols-2">
                <section className={footerModuleClassName}>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                    Crypto Summary
                  </p>
                  <h3 className="mt-2 text-base font-semibold tracking-tight text-white">
                    Cluster Averages
                  </h3>
                  <div className="mt-4 space-y-0 font-[family:var(--font-data)] text-[11px]">
                    <div
                      className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 first:border-t-0 first:pt-0 sm:items-end`}
                    >
                      <p className="uppercase tracking-[0.28em] text-zinc-500">
                        Analog Matches
                      </p>
                      <p className="text-sm text-white">--</p>
                    </div>
                    <div
                      className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 sm:items-end`}
                    >
                      <p className="uppercase tracking-[0.28em] text-zinc-500">
                        Avg BTC 1D Return
                      </p>
                      <p className="text-sm text-zinc-500">--</p>
                    </div>
                    <div
                      className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 sm:items-end`}
                    >
                      <p className="uppercase tracking-[0.28em] text-zinc-500">
                        Avg BTC 3D Return
                      </p>
                      <p className="text-sm text-zinc-500">--</p>
                    </div>
                    <div
                      className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 sm:items-end`}
                    >
                      <p className="uppercase tracking-[0.28em] text-zinc-500">
                        Bearish Hit Rate (1D)
                      </p>
                      <p className="text-sm text-zinc-500">--</p>
                    </div>
                    <div
                      className={`flex items-start justify-between gap-4 ${terminalDividerClassName} pt-3 sm:items-end`}
                    >
                      <p className="uppercase tracking-[0.28em] text-zinc-500">
                        Bearish Hit Rate (3D)
                      </p>
                      <p className="text-sm text-zinc-500">--</p>
                    </div>
                  </div>
                </section>

                <section className={footerModuleClassName}>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                    Model Integrity
                  </p>
                  <h3 className="mt-2 text-base font-semibold tracking-tight text-white">
                    Crypto KNN Engine
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-zinc-500">
                    This score is generated from a K-Nearest Neighbors engine
                    over aligned crypto and intermarket history.
                  </p>
                  <div className="mt-4 space-y-3 font-[family:var(--font-data)] text-[11px] text-zinc-500">
                    <div
                      className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 first:border-t-0 first:pt-0 sm:items-end`}
                    >
                      <p className="uppercase tracking-[0.28em]">
                        Temporal Decay
                      </p>
                      <p className="text-sm text-white">
                        &lambda; ={" "}
                        {CRYPTO_ANALOG_MODEL_SETTINGS.temporalDecayLambda}
                      </p>
                    </div>
                    <div
                      className={`flex items-start justify-between gap-4 ${terminalDividerClassName} pt-3 sm:items-end`}
                    >
                      <p className="uppercase tracking-[0.28em]">
                        Nearest Neighbors
                      </p>
                      <p className="text-right text-sm text-zinc-400">
                        K ={" "}
                        {CRYPTO_ANALOG_MODEL_SETTINGS.nearestNeighborCount}
                      </p>
                    </div>
                    <div
                      className={`flex items-start justify-between gap-4 ${terminalDividerClassName} pt-3 sm:items-end`}
                    >
                      <p className="uppercase tracking-[0.28em]">
                        Feature Set
                      </p>
                      <p className="text-right text-sm text-zinc-400">
                        BTC RSI · ETH/BTC · BTC/GLD · DXY · Vol · TLT
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            </PaywallWrapper>
          )}
        </section>
      </div>
    </main>
  );
}
