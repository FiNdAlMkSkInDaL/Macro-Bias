import { unstable_noStore as noStore } from "next/cache";

import { DashboardTop } from "@/components/dashboard/DashboardTop";
import { FreeWorkspace } from "@/components/product/FreeWorkspace";
import { MacroMarketChart } from "@/components/product/MacroMarketChart";
import { MarketTabs, MemberShell } from "@/components/product/MemberShell";
import workspaceStyles from "@/components/product/FreeWorkspace.module.css";
import memberStyles from "@/components/product/MemberUI.module.css";
import { loadWorkspaceData } from "@/lib/product/workspace-data";
import { ManagePlan } from "@/components/billing/ManagePlan";
import { getStripeCustomerId } from "@/lib/billing/stripe-customer";
import { getUserSubscriptionStatus } from "@/lib/billing/subscription";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CRYPTO_ANALOG_MODEL_SETTINGS } from "@/lib/crypto-bias/constants";
import type {
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
    return { label: "Pending", tone: "text-[#acb6ad]" };
  if (signal > 0.15) return { label: "Bullish", tone: "text-[#c9f58a]" };
  if (signal < -0.15) return { label: "Bearish", tone: "text-[#ef9d9d]" };
  return { label: "Neutral", tone: "text-[#d1d9cf]" };
}

function getMoveTone(value: number | null): string {
  if (value === null) return "text-[#acb6ad]";
  if (value > 0) return "text-[#c9f58a]";
  if (value < 0) return "text-[#ef9d9d]";
  return "text-[#d1d9cf]";
}

function getDeltaTone(value: number | null): string {
  if (value === null) return "text-[#acb6ad]";
  if (value > 0) return "text-[#c9f58a]";
  if (value < 0) return "text-[#ef9d9d]";
  return "text-[#acb6ad]";
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
  const [snapshot, supplementalAssets, workspaceData] =
    await Promise.all([
      getLatestCryptoSnapshot(isPro),
      getSupplementalAssets(),
      loadWorkspaceData('crypto', status),
    ]);

  if (!snapshot) {
    return (
      <MemberShell title="Your crypto workspace" plan="Pro plan" description="The published crypto reading is not available yet.">
        <MarketTabs asset="crypto" view="dashboard" />
        <section className={memberStyles.panel}><h2>Reading unavailable</h2><p>Crypto scores will appear after a daily session has been stored.</p></section>
      </MemberShell>
    );
  }

  const isProUser = isPro;
  const stripeCustomerId = user ? await getStripeCustomerId(user.id) : null;
  const componentScores = snapshot.component_scores ?? [];
  const tickerChanges = snapshot.ticker_changes;
  /* Ticker-level derived data */
  const tickerEntries = tickerChanges
    ? Object.entries(tickerChanges).map(([ticker, snap]) => ({
        ticker,
        close: (snap as CryptoTickerChangeSnapshot).close,
        percentChange: (snap as CryptoTickerChangeSnapshot).percentChange,
      }))
    : [];
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
  const terminalBorderClassName = "border border-[#2a342c]";
  const terminalDividerClassName = "border-t border-[#2a342c]";
  const terminalTableDividerClassName = "border-b border-[#2a342c]";
  const moduleClassName = `${terminalBorderClassName} rounded-[4px] bg-[#111512] min-w-0 p-4 sm:p-5 md:p-6`;
  const footerModuleClassName = `${terminalBorderClassName} rounded-[4px] bg-[#111512] min-w-0 p-4 text-sm leading-6 text-[#acb6ad] sm:p-5 md:p-6`;

  return (
    <MemberShell
      title="Your crypto workspace"
      plan="Pro plan"
      description={<>Published session · {snapshot.trade_date ? <time dateTime={snapshot.trade_date}>{formatAnalogDate(snapshot.trade_date)}</time> : 'Not available'}</>}
    >
      <div className={workspaceStyles.proWorkspace} data-pro-workspace="crypto">
        <MarketTabs asset="crypto" view="dashboard" />
        <div className={workspaceStyles.proUtility}>
          <a href="/refer" className={memberStyles.textLink}>Refer friends</a>
          <ManagePlan hasStripeCustomer={Boolean(stripeCustomerId)} isPro={isPro} />
        </div>

        {/* ── Main grid ────────────────────────────────────────── */}
        <section className="grid grid-cols-1 gap-4 py-4 md:gap-6 md:py-6 lg:grid-cols-2">
          <DashboardTop
            assets={tickerEntries.map((entry) => ({ ticker: entry.ticker, dailyChangePercent: entry.percentChange, ...workspaceData.tape.entries.find((stored) => stored.ticker === entry.ticker) }))}
            biasLabel={snapshot.bias_label} biasScore={snapshot.score} hasScore
            tradeDate={snapshot.trade_date} marketName="Crypto"
          />
          <div className={`${workspaceStyles.proChart} min-w-0 lg:col-span-2`}>
            <MacroMarketChart
              variant="history" instrument="BTC" title="BTC price & daily bias" defaultRangeMonths={3}
              candles={workspaceData.active.candles} marks={workspaceData.active.history}
              latest={workspaceData.active.score ? { tradeDate: workspaceData.active.score.tradeDate, score: workspaceData.active.score.score, biasLabel: workspaceData.active.score.label } : null}
              notice={workspaceData.active.historyNotice ?? workspaceData.active.priceNotice ?? workspaceData.active.loadError}
            />
          </div>

          <div className="min-w-0 lg:col-span-2">

              <div className="space-y-4 md:space-y-6">
                <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
                  {/* Signal Breakdown */}
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
                                <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad] sm:text-[12px] sm:tracking-[0.06em]">
                                  {pillar.label}
                                </p>
                                <p className="mt-1 text-[15px] font-medium text-[#f1f5ef] sm:text-sm">
                                  {pillar.symbol}
                                </p>
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
                        <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                          Cross-Asset Regime
                        </p>
                        <h3 className="mt-2 text-lg font-semibold tracking-tight text-[#f1f5ef]">
                          Market Internals
                        </h3>
                      </div>
                      <p className="max-w-md text-sm leading-6 text-[#acb6ad]">
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
                            <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                              {asset.ticker}
                            </p>
                            <p
                              className={`shrink-0 font-[family:var(--font-data)] text-[13px] ${getMoveTone(asset.dailyChangePercent)}`}
                            >
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

                {/* Historical Analog Playbook */}
                <section className={moduleClassName}>
                  <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                      <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                        Historical Analogs
                      </p>
                      <h3 className="mt-2 text-lg font-semibold tracking-tight text-[#f1f5ef]">
                        BTC Forward-Return Playbook
                      </h3>
                    </div>
                    {analogData ? (
                      <p className="max-w-lg text-sm leading-6 text-[#acb6ad]">
                        Top {analogData.matchCount} nearest neighbors from the
                        crypto analog engine.
                      </p>
                    ) : null}
                  </div>

                  {analogData ? (
                    <div className="w-full">
                      <p className="text-[12px] text-[#acb6ad] sm:hidden">
                        &larr; scroll to see all columns &rarr;
                      </p>
                      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                        <table className="min-w-[36rem] border-collapse text-left md:min-w-full">
                          <thead>
                            <tr className={terminalTableDividerClassName}>
                              <th className="w-[30%] whitespace-nowrap py-4 pr-6 font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                                Matched Date
                              </th>
                              <th className="w-[20%] whitespace-nowrap py-4 pr-6 font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                                Similarity
                              </th>
                              <th className="w-[25%] whitespace-nowrap py-4 pr-6 font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                                BTC 1-Day Return
                              </th>
                              <th className="w-[25%] whitespace-nowrap py-4 font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
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
                                    <p className="text-base font-medium text-[#f1f5ef]">
                                      {formatAnalogDate(match.tradeDate)}
                                    </p>
                                  </td>
                                  <td className="py-5 pr-6 align-middle">
                                    <p className="font-[family:var(--font-data)] text-sm text-[#acb6ad]">
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
                      <p className="max-w-2xl text-sm leading-6 text-[#acb6ad]">
                        The analog engine has not yet produced a complete
                        playbook for this snapshot. Additional aligned price
                        history is required before the forward-return profile
                        can be computed.
                      </p>
                    </div>
                  )}
                </section>
              </div>

          </div>

          {/* ── Footer: Cluster Averages + Model Integrity ─────── */}
          {isProUser ? (
            <div className="min-w-0 grid grid-cols-1 gap-4 md:gap-6 lg:col-span-2 lg:grid-cols-2">
              <section className={footerModuleClassName}>
                <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                  Crypto Summary
                </p>
                <h3 className="mt-2 text-base font-semibold tracking-tight text-[#f1f5ef]">
                  Cluster Averages
                </h3>

                <div className="mt-4 space-y-0 font-[family:var(--font-data)] text-[13px]">
                  <div
                    className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 first:border-t-0 first:pt-0 sm:items-end`}
                  >
                    <p className="uppercase tracking-[0.06em] text-[#acb6ad]">
                      Analog Matches
                    </p>
                    <p className="text-sm text-[#f1f5ef]">
                      {analogData ? analogData.matchCount : "--"}
                    </p>
                  </div>

                  <div
                    className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 sm:items-end`}
                  >
                    <p className="uppercase tracking-[0.06em] text-[#acb6ad]">
                      Avg BTC 1D Return
                    </p>
                    <p className={getMoveTone(analogData?.avg1d ?? null)}>
                      {formatMove(analogData?.avg1d ?? null)}
                    </p>
                  </div>

                  <div
                    className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 sm:items-end`}
                  >
                    <p className="uppercase tracking-[0.06em] text-[#acb6ad]">
                      Avg BTC 3D Return
                    </p>
                    <p className={getMoveTone(analogData?.avg3d ?? null)}>
                      {formatMove(analogData?.avg3d ?? null)}
                    </p>
                  </div>

                  <div
                    className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 sm:items-end`}
                  >
                    <p className="uppercase tracking-[0.06em] text-[#acb6ad]">
                      Bearish Hit Rate (1D)
                    </p>
                    <p className="text-sm text-[#acb6ad]">
                      {analogData?.bearish1d != null
                        ? `${(analogData.bearish1d * 100).toFixed(0)}%`
                        : "--"}
                    </p>
                  </div>

                  <div
                    className={`flex items-start justify-between gap-4 ${terminalDividerClassName} pt-3 sm:items-end`}
                  >
                    <p className="uppercase tracking-[0.06em] text-[#acb6ad]">
                      Bearish Hit Rate (3D)
                    </p>
                    <p className="text-sm text-[#acb6ad]">
                      {analogData?.bearish3d != null
                        ? `${(analogData.bearish3d * 100).toFixed(0)}%`
                        : "--"}
                    </p>
                  </div>
                </div>
              </section>

              <section className={footerModuleClassName}>
                <p className="font-[family:var(--font-data)] text-[12px] uppercase tracking-[0.06em] text-[#acb6ad]">
                  Model Integrity
                </p>
                <h3 className="mt-2 text-base font-semibold tracking-tight text-[#f1f5ef]">
                  Crypto KNN Engine
                </h3>
                <p className="mt-3">
                  This score is generated from a K-Nearest Neighbors engine over
                  aligned crypto and intermarket history. The dashboard, playbook
                  table, and publication pipeline reference the same
                  decay-adjusted analog set.
                </p>

                <div className="mt-4 space-y-3 font-[family:var(--font-data)] text-[13px] text-[#acb6ad]">
                  <div
                    className={`flex items-start justify-between gap-4 ${terminalDividerClassName} py-3 first:border-t-0 first:pt-0 sm:items-end`}
                  >
                    <p className="uppercase tracking-[0.06em]">
                      Temporal Decay
                    </p>
                    <p className="text-sm text-[#f1f5ef]">
                      &lambda; ={" "}
                      {CRYPTO_ANALOG_MODEL_SETTINGS.temporalDecayLambda}
                    </p>
                  </div>
                  <div
                    className={`flex items-start justify-between gap-4 ${terminalDividerClassName} pt-3 sm:items-end`}
                  >
                    <p className="uppercase tracking-[0.06em]">
                      Nearest Neighbors
                    </p>
                    <p className="text-right text-sm text-[#acb6ad]">
                      K ={" "}
                      {CRYPTO_ANALOG_MODEL_SETTINGS.nearestNeighborCount}
                    </p>
                  </div>
                  <div
                    className={`flex items-start justify-between gap-4 ${terminalDividerClassName} pt-3 sm:items-end`}
                  >
                    <p className="uppercase tracking-[0.06em]">Feature Set</p>
                    <p className="text-right text-sm text-[#acb6ad]">
                      BTC RSI · ETH/BTC · BTC/GLD · DXY · Vol · TLT
                    </p>
                  </div>
                </div>

                <p className="mt-4 max-w-xl text-xs leading-5 text-[#829287]">
                  The analog engine blends 1-day (40%) and 3-day (60%) forward
                  BTC returns through a tanh mapping scaled to &plusmn;100.
                </p>
              </section>
            </div>
          ) : null}
        </section>
      </div>
    </MemberShell>
  );
}
