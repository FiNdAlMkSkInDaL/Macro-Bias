import type { Metadata } from "next";

import { getCryptoBacktestData } from "@/lib/crypto-track-record/crypto-backtest-engine";
import CryptoPerformanceChart from "@/components/track-record/CryptoPerformanceChart";
import { AssetToggle } from "@/components/AssetToggle";

const SITE_URL = "https://macro-bias.com";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Crypto Track Record — Model vs BTC | Macro Bias",
  description:
    "See how the Macro Bias crypto signal performed against BTC buy-and-hold since January 2020. Equity curve with 10 bps friction.",
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
  const backtest = await getCryptoBacktestData();
  const hasData = backtest.totalDays > 0 && backtest.equityCurve.length > 0;

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
            The same algo that runs every day, replayed since January 2020.
            Long-only mode goes to cash when Risk Off. Long/short mode
            also shorts BTC on bearish signals. Both include 10 bps friction.
          </p>
        </section>

        {hasData ? (
          <>
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
              <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2nter gap-x-6 gap-y-2">
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
                  Same-Day Hit Rate
                </p>
                <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-white">
                  {backtest.sameDayHitRate !== null
                    ? `${backtest.sameDayHitRate.toFixed(1)}%`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Fwd 1D Hit Rate
                </p>
                <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-white">
                  {backtest.forward1DHitRate !== null
                    ? `${backtest.forward1DHitRate.toFixed(1)}%`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Avg Return (Bull)
                </p>
                <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-green-400">
                  {backtest.avgReturnBullish !== null
                    ? `${backtest.avgReturnBullish > 0 ? "+" : ""}${backtest.avgReturnBullish.toFixed(3)}%`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Avg Return (Bear)
                </p>
                <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-orange-400">
                  {backtest.avgReturnBearish !== null
                    ? `${backtest.avgReturnBearish > 0 ? "+" : ""}${backtest.avgReturnBearish.toFixed(3)}%`
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
