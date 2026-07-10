import type { Metadata } from "next";
import Link from "next/link";

import { getBacktestData } from "@/lib/track-record/backtest-engine";
import { getStocksLivePaperLedger } from "@/lib/track-record/live-paper-ledger";
import { getStocksPublishedLiveEval } from "@/lib/track-record/published-score-live-eval";
import PerformanceChart from "@/components/track-record/PerformanceChart";
import { AssetToggle } from "@/components/AssetToggle";

/* ------------------------------------------------------------------ */
/*  SEO                                                                */
/* ------------------------------------------------------------------ */

const SITE_URL = "https://macro-bias.com";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Track Record — Model Performance vs S&P 500 | Macro Bias",
  description:
    "See how the Macro Bias signal performed against the S&P 500 since January 2020. Simple equity curve, no spin — just the numbers.",
  keywords: [
    "trading model track record",
    "SPY backtested performance",
    "quant model results",
    "macro regime backtest",
    "day trading signal accuracy",
    "market regime model performance",
  ],
  alternates: {
    canonical: `${SITE_URL}/track-record`,
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/track-record`,
    siteName: "Macro Bias",
    title: "Track Record — Model Performance vs S&P 500 | Macro Bias",
    description:
      "See how the Macro Bias signal performed against the S&P 500 since January 2020.",
    images: [
      {
        url: `${SITE_URL}/api/og`,
        width: 1200,
        height: 630,
        alt: "Macro Bias — Track Record",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Track Record — Model vs S&P 500 | Macro Bias",
    description:
      "Backtested equity curve since Jan 2020. No spin — just the numbers.",
  },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function TrackRecordPage() {
  const [backtest, paperLedger, liveEval] = await Promise.all([
    getBacktestData(),
    getStocksLivePaperLedger(),
    getStocksPublishedLiveEval().catch(() => null),
  ]);
  const hasData = backtest.totalDays > 0 && backtest.equityCurve.length > 0;
  const hasPaper = paperLedger.totalSessions > 0;
  const hasLiveEval = liveEval !== null && liveEval.totalGraded > 0;

  const stratReturn = backtest.strategyReturn;
  const spyReturn = backtest.spyReturn;
  const outperformance =
    stratReturn !== null && spyReturn !== null
      ? stratReturn - spyReturn
      : null;

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

  /* ---- Structured data ----------------------------------------- */

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        url: `${SITE_URL}/track-record`,
        name: "Track Record — Model Performance vs S&P 500",
        description:
          "Macro Bias signal vs S&P 500 equity curve since January 2020.",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: SITE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Track Record",
            item: `${SITE_URL}/track-record`,
          },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "How is the strategy return calculated?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Each morning the model builds a 6-factor market fingerprint, finds historical analogs, and maps forward-return expectancy to a score. A tradable layer then applies reliability gates: LONG or SHORT only when |score| exceeds 20 and neighbor agreement/distance quality pass; otherwise FLAT or NO_TRADE. A 5 bps friction is applied on every position change.",
            },
          },
          {
            "@type": "Question",
            name: "Is this backtested or live?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Two views: (1) research backtest replaying the production algorithm since January 2020, and (2) live paper ledger built only from scores actually published to the database. The paper ledger is the honest accountability track once enough live days exist.",
            },
          },
          {
            "@type": "Question",
            name: "Can I verify these results?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "You can replay SPY closes with the published rules: lag the tradable signal by one session, long/short/cash with 5 bps friction. Exact neighbor sets can differ slightly with data revisions. Treat headline returns as research, not a guarantee.",
            },
          },
        ],
      },
    ],
  };

  return (
    <main className="min-h-screen font-sans">
      <div className="mx-auto w-full max-w-7xl px-6 sm:px-8 lg:px-10">

        {/* ---- Hero ---- */}
        <section className="border-b border-white/10 py-16 sm:py-24">
          <div className="flex items-center justify-between">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              [ Track Record ]
            </p>
            <AssetToggle />
          </div>
          <h1 className="mt-6 max-w-4xl font-[family:var(--font-heading)] text-4xl font-bold tracking-tighter text-white md:text-5xl">
            Model vs S&amp;P 500
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-300">
            Research backtest since 2020 plus a live paper ledger built only from
            scores that were actually published. Long when the tradable signal
            says LONG, short when SHORT, cash on FLAT or NO_TRADE. 5 bps friction.
          </p>
        </section>

        {/* ---- Live accuracy by reliability (published scores) ---- */}
        {hasLiveEval && liveEval ? (
          <section className="border-b border-white/10 py-12">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-emerald-400/80">
              [ Live accuracy · next session after publish ]
            </p>
            <h2 className="mt-4 max-w-3xl font-[family:var(--font-heading)] text-2xl font-semibold tracking-tighter text-white md:text-3xl">
              Did the published score work?
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
              Every graded session uses only scores that were written to production,
              lagged one session. This is the metric we optimize, not the research
              re-sim below.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Next-session hit
                </p>
                <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-white">
                  {liveEval.forwardHitRate !== null
                    ? `${liveEval.forwardHitRate.toFixed(1)}%`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Sessions graded
                </p>
                <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-white">
                  {liveEval.totalGraded}
                </p>
              </div>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Edge (long − short)
                </p>
                <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-white">
                  {liveEval.edgeSpread !== null
                    ? `${liveEval.edgeSpread > 0 ? "+" : ""}${liveEval.edgeSpread.toFixed(3)}%`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Latest graded
                </p>
                <p className="mt-2 font-[family:var(--font-data)] text-sm font-semibold text-zinc-300">
                  {liveEval.latest
                    ? `${liveEval.latest.sessionDate} · ${liveEval.latest.position}${
                        liveEval.latest.directionCorrect === true
                          ? " · hit"
                          : liveEval.latest.directionCorrect === false
                            ? " · miss"
                            : ""
                      }`
                    : "—"}
                </p>
              </div>
            </div>
            {liveEval.reliabilityBuckets.length > 0 ? (
              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-sm text-zinc-300">
                  <thead>
                    <tr className="border-b border-white/10 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                      <th className="py-2 pr-4">Reliability</th>
                      <th className="py-2 pr-4">n</th>
                      <th className="py-2 pr-4">Hit rate</th>
                      <th className="py-2 pr-4">Avg strat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveEval.reliabilityBuckets.map((bucket) => (
                      <tr key={bucket.reliability} className="border-b border-white/5">
                        <td className="py-2 pr-4 font-semibold text-white">{bucket.reliability}</td>
                        <td className="py-2 pr-4">{bucket.sessions}</td>
                        <td className="py-2 pr-4">
                          {bucket.hitRate !== null ? `${bucket.hitRate.toFixed(1)}%` : "—"}
                        </td>
                        <td className="py-2 pr-4">
                          {bucket.avgStrategyReturn !== null
                            ? `${bucket.avgStrategyReturn > 0 ? "+" : ""}${bucket.avgStrategyReturn.toFixed(3)}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* ---- Live paper ledger (published scores only) ---- */}
        <section className="border-b border-white/10 py-12">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-emerald-400/80">
            [ Live paper ledger ]
          </p>
          <h2 className="mt-4 max-w-3xl font-[family:var(--font-heading)] text-2xl font-semibold tracking-tighter text-white md:text-3xl">
            Published scores only
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
            Equity curve from rows written to the production score table, lagged
            one session, with friction. This is not a full historical re-sim.
            {hasPaper
              ? ` ${paperLedger.totalSessions} sessions graded.`
              : " Waiting for published score history."}
          </p>
          {hasPaper ? (
            <>
              <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                    Paper strategy
                  </p>
                  <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-white">
                    {fmtReturn(paperLedger.strategyReturn)}
                  </p>
                </div>
                <div>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                    Size-scaled
                  </p>
                  <p className="mt-2 font-[family:var(--font-data)] text-xl font-bold text-zinc-200">
                    {fmtReturn(paperLedger.sizeScaledReturn)}
                  </p>
                </div>
                <div>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                    SPY (same window)
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
              {paperLedger.dateRange && (
                <p className="mt-4 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  {fmtDateRange(paperLedger.dateRange.from, paperLedger.dateRange.to)}
                  {" · "}
                  L/S/C {paperLedger.longDays}/{paperLedger.shortDays}/{paperLedger.cashDays}
                  {" · "}
                  flips {paperLedger.flipCount}
                  {paperLedger.maxDrawdownStrategy !== null
                    ? ` · max DD ${paperLedger.maxDrawdownStrategy.toFixed(1)}%`
                    : ""}
                </p>
              )}
              {paperEquityCurve.length > 1 && (
                <div className="mt-6">
                  <PerformanceChart data={paperEquityCurve} />
                </div>
              )}
            </>
          ) : (
            <p className="mt-6 text-sm text-zinc-500">
              No published score rows yet. After the daily cron runs, this section
              will track live accountability automatically.
            </p>
          )}
        </section>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />

        {hasData ? (
          <>
            {/* ---- Research backtest stats ---- */}
            <p className="border-b border-white/10 py-3 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              [ Research backtest · full history re-sim ]
            </p>
            <section className="grid grid-cols-1 min-[420px]:grid-cols-3 border-b border-white/10">
              <div className="border-b min-[420px]:border-b-0 min-[420px]:border-r border-white/10 py-4 min-[420px]:py-6 px-0 min-[420px]:px-3 sm:px-6">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Macro Bias
                </p>
                <p className="mt-2 min-[420px]:mt-3 font-[family:var(--font-data)] text-2xl font-bold text-white sm:text-2xl md:text-3xl">
                  {fmtReturn(stratReturn)}
                </p>
              </div>
              <div className="border-b min-[420px]:border-b-0 min-[420px]:border-r border-white/10 py-4 min-[420px]:py-6 px-0 min-[420px]:px-3 sm:px-6">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  S&amp;P 500
                </p>
                <p className="mt-2 min-[420px]:mt-3 font-[family:var(--font-data)] text-2xl font-bold text-zinc-300 sm:text-2xl md:text-3xl">
                  {fmtReturn(spyReturn)}
                </p>
              </div>
              <div className="py-4 min-[420px]:py-6 px-0 min-[420px]:px-3 sm:px-6">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Alpha
                </p>
                <p className="mt-2 min-[420px]:mt-3 font-[family:var(--font-data)] text-2xl font-bold text-white sm:text-2xl md:text-3xl">
                  {outperformance !== null
                    ? `${outperformance > 0 ? "+" : ""}${outperformance.toFixed(2)}%`
                    : "—"}
                </p>
              </div>
            </section>

            {/* ---- Date range ---- */}
            {backtest.dateRange && (
              <p className="border-b border-white/10 py-3 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                {fmtDateRange(backtest.dateRange.from, backtest.dateRange.to)} · {backtest.totalDays} sessions
              </p>
            )}

            {/* ---- Chart ---- */}
            <section className="border-b border-white/10 py-8">
              <div className="mb-5 flex flex-wrap items-center gap-6">
                <span className="flex items-center gap-2 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  <span className="inline-block h-px w-4 bg-white" />
                  Macro Bias Signal
                </span>
                <span className="flex items-center gap-2 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  <span className="inline-block h-px w-4 bg-zinc-600" />
                  S&amp;P 500 Buy &amp; Hold
                </span>
              </div>
              <PerformanceChart data={backtest.equityCurve} />
            </section>

            {/* ---- Methodology ---- */}
            <section className="border-b border-white/10 py-16">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
                Methodology
              </p>
              <h2 className="mt-5 max-w-3xl font-[family:var(--font-heading)] text-3xl font-semibold tracking-tighter text-white md:text-4xl">
                How it works
              </h2>
              <div className="mt-8 grid gap-10 md:grid-cols-3 lg:gap-8">
                <article className="border-t border-white/10 pt-5">
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                    01
                  </p>
                  <h3 className="mt-4 font-[family:var(--font-heading)] text-lg font-semibold tracking-tight text-white">
                    Score
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">
                    Every morning before the opening bell, the KNN model scores
                    macro conditions on a -100 to +100 scale using 6 cross-asset
                    features — volatility, credit spreads, commodity ratios,
                    momentum.
                  </p>
                </article>
                <article className="border-t border-white/10 pt-5">
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                    02
                  </p>
                  <h3 className="mt-4 font-[family:var(--font-heading)] text-lg font-semibold tracking-tight text-white">
                    Position
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">
                    LONG when reliability passes and score exceeds +20. SHORT
                    below −20. FLAT in the dead zone. NO_TRADE when analogs are
                    loose or disagree. 5 bps friction per flip. No leverage.
                  </p>
                </article>
                <article className="border-t border-white/10 pt-5">
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                    03
                  </p>
                  <h3 className="mt-4 font-[family:var(--font-heading)] text-lg font-semibold tracking-tight text-white">
                    No lookahead
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">
                    Each day&rsquo;s score is computed using only prior data. The
                    chart shows the exact same algorithm and parameters that run
                    in production today.
                  </p>
                </article>
              </div>
            </section>

            {/* ---- FAQ ---- */}
            <section className="border-b border-white/10 py-16">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
                FAQ
              </p>
              <div className="mt-6 space-y-0">
                <div className="border-t border-white/10 py-6">
                  <h3 className="text-sm font-semibold text-white">
                    Is this backtested or live?
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">
                    The algo runs live every trading day. This chart is a research
                    backtest of that model since Jan 2020, not a live paper ledger.
                    Each day uses only prior data. 5 bps friction is included.
                    Past results do not guarantee future performance.
                  </p>
                </div>
                <div className="border-t border-white/10 py-6">
                  <h3 className="text-sm font-semibold text-white">
                    Can I verify these numbers?
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">
                    Pull SPY daily closes and lag the published rules: long when
                    the tradable signal is LONG, short when SHORT, cash on FLAT
                    or NO_TRADE, with 5 bps friction. Neighbor sets can shift
                    slightly with data history. Treat this as research, not a
                    bank statement.
                  </p>
                </div>
                <div className="border-t border-white/10 py-6">
                  <h3 className="text-sm font-semibold text-white">
                    What happens on news-driven days?
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">
                    The model reads macro conditions, not headlines. Some
                    news-driven days it gets wrong — tariff announcements, Fed
                    surprises. The chart includes those days too. No
                    cherry-picking.
                  </p>
                </div>
              </div>
            </section>

            {/* ---- CTA ---- */}
            <section className="py-16 text-center">
              <h2 className="font-[family:var(--font-heading)] text-2xl font-bold tracking-tighter text-white sm:text-3xl">
                Get the signal before the bell
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-zinc-400">
                Daily scores, regime calls, and a full market briefing —
                delivered before 9:30 AM ET. 7-day free trial.
              </p>
              <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                <Link
                  href="/pricing"
                  className="inline-flex min-w-[220px] items-center justify-center bg-white px-6 py-3.5 text-sm font-semibold text-black transition hover:bg-zinc-200"
                  data-analytics-event="track_record_cta_click"
                  data-analytics-label="Start Free Trial"
                  data-analytics-location="track_record_footer_cta"
                >
                  Start Free Trial
                </Link>
                <Link
                  href="/dashboard"
                  className="inline-flex min-w-[220px] items-center justify-center bg-white/[0.03] px-6 py-3.5 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.06] hover:text-white"
                  data-analytics-event="track_record_cta_click"
                  data-analytics-label="View Dashboard"
                  data-analytics-location="track_record_footer_cta"
                >
                  View Dashboard
                </Link>
              </div>
            </section>
          </>
        ) : (
          <section className="border-b border-white/10 py-16 text-center">
            <p className="text-sm text-zinc-500">
              Performance data is being calculated. Check back shortly.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
