import type { Metadata } from "next";

import { getCryptoBacktestData } from "@/lib/crypto-track-record/crypto-backtest-engine";
import { getCryptoLivePaperLedger } from "@/lib/crypto-track-record/crypto-live-paper-ledger";
import CryptoPerformanceChart from "@/components/track-record/CryptoPerformanceChart";
import PerformanceChart from "@/components/track-record/PerformanceChart";
import { AssetToggle } from "@/components/AssetToggle";

const SITE_URL = "https://macro-bias.com";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Crypto Track Record — Model vs BTC | Macro Bias",
  description:
    "Research backtest of the Macro Bias crypto regime model vs BTC buy-and-hold since January 2020. Long-only benchmark with 15 bps friction.",
  alternates: {
    canonical: `${SITE_URL}/crypto/track-record`,
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/crypto/track-record`,
    siteName: "Macro Bias",
    title: "Crypto Track Record — Model vs BTC | Macro Bias",
    description:
      "Crypto model equity curve vs BTC buy-and-hold since January 2020.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Crypto Track Record — Model vs BTC | Macro Bias",
    description:
      "Backtested crypto model equity curve vs BTC buy-and-hold since Jan 2020.",
  },
};

function fmtReturn(v: number | null): string {
  if (v === null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function fmtDateRange(from: string, to: string): string {
  const fmt = (s: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(s + "T00:00:00Z"));
  return `${fmt(from)} — ${fmt(to)}`;
}

export default async function CryptoTrackRecordPage() {
  const [backtest, paperLedger] = await Promise.all([
    getCryptoBacktestData(),
    getCryptoLivePaperLedger("long_only"),
  ]);
  const hasData = backtest.totalDays > 0 && backtest.equityCurve.length > 0;
  const hasPaper = paperLedger.totalSessions > 0;

  const stratReturn = backtest.strategyReturn;
  const longOnlyReturn = backtest.longOnlyReturn;
  const btcReturn = backtest.btcReturn;
  const longOnlyAlpha =
    longOnlyReturn !== null && btcReturn !== null
      ? longOnlyReturn - btcReturn
      : null;

  const chartData = backtest.equityCurve.map((d) => ({
    date: d.date,
    btc: d.btc,
    strategy: d.strategy,
    longOnly: d.longOnly,
  }));

  const paperEquityCurve =
    paperLedger.days.length <= 300
      ? paperLedger.days.map((d) => ({
          date: d.tradeDate,
          spy: Number(d.assetEquity.toFixed(2)),
          strategy: Number(d.strategyEquity.toFixed(2)),
        }))
      : paperLedger.days
          .filter(
            (_, i) =>
              i === 0 ||
              i === paperLedger.days.length - 1 ||
              i % 5 === 0,
          )
          .map((d) => ({
            date: d.tradeDate,
            spy: Number(d.assetEquity.toFixed(2)),
            strategy: Number(d.strategyEquity.toFixed(2)),
          }));

  return (
    <main className="min-h-screen font-sans">
      <div className="mx-auto w-full max-w-7xl px-6 sm:px-8 lg:px-10">
        {/* Hero */}
        <section className="border-b border-white/10 py-16 sm:py-24">
          <div className="flex items-center justify-between">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              [ Crypto Track Record ]
            </p>
            <AssetToggle />
          </div>
          <h1 className="mt-6 max-w-4xl font-[family:var(--font-heading)] text-4xl font-bold tracking-tighter text-white md:text-5xl">
            Crypto Model vs BTC
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-300">
            Research backtest plus a live paper ledger from published scores only.
            Public benchmark is long-only with 15 bps friction. Research curves are
            path-dependent. Use the paper ledger for live accountability.
          </p>
        </section>

        {/* Live paper ledger */}
        <section className="border-b border-white/10 py-12">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-emerald-400/80">
            [ Live paper ledger · long only ]
          </p>
          <h2 className="mt-4 max-w-3xl font-[family:var(--font-heading)] text-2xl font-semibold tracking-tighter text-white md:text-3xl">
            Published crypto scores only
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
            Built from rows in the production crypto score table, lagged one day,
            cash when not LONG. Not a full historical re-sim.
            {hasPaper
              ? ` ${paperLedger.totalSessions} sessions graded.`
              : " Waiting for published crypto scores."}
          </p>
          {hasPaper ? (
            <>
              <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                    Paper long-only
                  </p>
                  <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-emerald-400">
                    {fmtReturn(paperLedger.strategyReturn)}
                  </p>
                </div>
                <div>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                    Size-scaled
                  </p>
                  <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-white">
                    {fmtReturn(paperLedger.sizeScaledReturn)}
                  </p>
                </div>
                <div>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                    BTC (same window)
                  </p>
                  <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-zinc-400">
                    {fmtReturn(paperLedger.assetReturn)}
                  </p>
                </div>
                <div>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                    Next-day hit rate
                  </p>
                  <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-white">
                    {paperLedger.forward1DHitRate !== null
                      ? `${paperLedger.forward1DHitRate.toFixed(1)}%`
                      : "—"}
                  </p>
                </div>
              </div>
              {paperEquityCurve.length > 1 && (
                <div className="mt-6">
                  <div className="mb-4 flex flex-wrap gap-4 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-px w-4 bg-white" /> Paper
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-px w-4 bg-zinc-600" /> BTC
                    </span>
                  </div>
                  <PerformanceChart data={paperEquityCurve} />
                </div>
              )}
            </>
          ) : (
            <p className="mt-6 text-sm text-zinc-500">
              No published crypto scores yet. After the crypto cron runs, this
              section will fill automatically.
            </p>
          )}
        </section>

        {hasData ? (
          <>
            <p className="border-b border-white/10 py-3 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              [ Research backtest · full history re-sim ]
            </p>
            {/* Stats */}
            <section className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-4 border-b border-white/10">
              <div className="border-b min-[420px]:border-b-0 min-[420px]:border-r border-white/10 py-4 min-[420px]:py-6 pr-0 min-[420px]:pr-4 sm:pr-6">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Long Only
                </p>
                <p className="mt-2 min-[420px]:mt-3 font-[family:var(--font-data)] text-2xl font-bold text-emerald-400 sm:text-3xl">
                  {fmtReturn(longOnlyReturn)}
                </p>
              </div>
              <div className="border-b min-[420px]:border-b-0 sm:border-r border-white/10 py-4 min-[420px]:py-6 px-0 min-[420px]:px-4 sm:px-6">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Long/Short
                </p>
                <p className="mt-2 min-[420px]:mt-3 font-[family:var(--font-data)] text-2xl font-bold text-white sm:text-3xl">
                  {fmtReturn(stratReturn)}
                </p>
              </div>
              <div className="border-b min-[420px]:border-b-0 min-[420px]:border-r border-white/10 py-4 min-[420px]:py-6 px-0 min-[420px]:px-4 sm:px-6">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  BTC Buy &amp; Hold
                </p>
                <p className="mt-2 min-[420px]:mt-3 font-[family:var(--font-data)] text-2xl font-bold text-zinc-300 sm:text-3xl">
                  {fmtReturn(btcReturn)}
                </p>
              </div>
              <div className="py-4 min-[420px]:py-6 pl-0 min-[420px]:pl-4 sm:pl-6">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Long Only Alpha
                </p>
                <p className="mt-2 min-[420px]:mt-2 min-[420px]:mt-3 font-[family:var(--font-data)] text-2xl font-bold text-white sm:text-3xl">
                  {longOnlyAlpha !== null
                    ? `${longOnlyAlpha > 0 ? "+" : ""}${longOnlyAlpha.toFixed(2)}%`
                    : "—"}
                </p>
              </div>
            </section>

            {/* Date range */}
            {backtest.dateRange && (
              <p className="border-b border-white/10 py-3 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                {fmtDateRange(backtest.dateRange.from, backtest.dateRange.to)} ·{" "}
                {backtest.totalDays} days
              </p>
            )}

            {/* Chart */}
            <section className="border-b border-white/10 py-8">
              <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className="flex items-center gap-2 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  <span className="inline-block h-px w-4 bg-white" />
                  Long/Short
                </span>
                <span className="flex items-center gap-2 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  <span className="inline-block h-px w-4 bg-emerald-400" />
                  Long Only
                </span>
                <span className="flex items-center gap-2 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  <span className="inline-block h-px w-4 bg-zinc-600" />
                  BTC Buy &amp; Hold
                </span>
              </div>
              <CryptoPerformanceChart data={chartData} />
            </section>

            {/* Hit rates */}
            <section className="grid grid-cols-2 gap-6 border-b border-white/10 py-8 sm:grid-cols-4">
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Next-Day Hit Rate
                </p>
                <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-white">
                  {backtest.forward1DHitRate !== null
                    ? `${backtest.forward1DHitRate.toFixed(1)}%`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  NO_TRADE Rate
                </p>
                <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-white">
                  {backtest.noTradeRate !== null
                    ? `${backtest.noTradeRate.toFixed(1)}%`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Max DD (Long Only)
                </p>
                <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-orange-400">
                  {backtest.maxDrawdownLongOnly !== null
                    ? `${backtest.maxDrawdownLongOnly.toFixed(1)}%`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Max DD (BTC)
                </p>
                <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-zinc-400">
                  {backtest.maxDrawdownBtc !== null
                    ? `${backtest.maxDrawdownBtc.toFixed(1)}%`
                    : "—"}
                </p>
              </div>
            </section>

            {/* Regime distribution */}
            <section className="border-b border-white/10 py-8">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500 mb-4">
                Regime Distribution
              </p>
              <div className="flex gap-3 flex-wrap">
                {backtest.regimeDistribution.map((r) => (
                  <div
                    key={r.label}
                    className="border border-white/10 bg-zinc-950 px-4 py-3"
                  >
                    <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-widest text-zinc-500">
                      {r.label.replace(/_/g, " ")}
                    </p>
                    <p className="mt-1 font-[family:var(--font-data)] text-sm font-bold text-white">
                      {r.count}{" "}
                      <span className="text-zinc-500">
                        ({r.pct.toFixed(1)}%)
                      </span>
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : (
          <div className="py-24 text-center">
            <p className="text-sm text-zinc-500">
              Not enough data for the crypto backtest yet. Scores will
              accumulate as the daily sync runs.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
