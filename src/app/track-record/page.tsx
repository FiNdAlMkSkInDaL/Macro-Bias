import type { Metadata } from "next";
import Link from "next/link";

import { getBacktestData } from "@/lib/track-record/backtest-engine";
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
  const backtest = await getBacktestData();
  const hasData = backtest.totalDays > 0 && backtest.equityCurve.length > 0;

  const stratReturn = backtest.strategyReturn;
  const spyReturn = backtest.spyReturn;
  const outperformance =
    stratReturn !== null && spyReturn !== null
      ? stratReturn - spyReturn
      : null;

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
              text: "Each morning the model publishes a bias score from -100 to +100. When the score signals Risk-On (above +20) the strategy goes long SPY. When it signals Risk-Off (below -20) it goes short SPY. In the Neutral zone the strategy sits in cash. A 5 basis-point friction is applied on every position change to reflect real-world trading costs.",
            },
          },
          {
            "@type": "Question",
            name: "Is this backtested or live?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "The chart replays the exact production algorithm against every trading session since January 2020. Each day's score uses only data available before that session's open — no lookahead bias. The same model runs live every trading day.",
            },
          },
          {
            "@type": "Question",
            name: "Can I verify these results?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Yes. Pull SPY daily closes from Yahoo Finance or any public source. The strategy is simple: long SPY when the score exceeds +20, short when below -20, cash otherwise. A 5 bps friction is applied per trade. You can replicate the equity curve independently.",
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
            The same algo that runs every morning — replayed since January 2020.
            Long when Risk-On, short when Risk-Off, cash when Neutral. Includes
            5 bps trading friction.
          </p>
        </section>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />

        {hasData ? (
          <>
            {/* ---- Stats strip ---- */}
            <section className="grid grid-cols-3 border-b border-white/10">
              <div className="border-r border-white/10 py-6 pr-6">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Macro Bias
                </p>
                <p className="mt-3 font-[family:var(--font-data)] text-2xl font-bold text-white sm:text-3xl">
                  {fmtReturn(stratReturn)}
                </p>
              </div>
              <div className="border-r border-white/10 py-6 px-6">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  S&amp;P 500
                </p>
                <p className="mt-3 font-[family:var(--font-data)] text-2xl font-bold text-zinc-300 sm:text-3xl">
                  {fmtReturn(spyReturn)}
                </p>
              </div>
              <div className="py-6 pl-6">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Alpha
                </p>
                <p className="mt-3 font-[family:var(--font-data)] text-2xl font-bold text-white sm:text-3xl">
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
              <div className="mb-5 flex items-center gap-6">
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
              <div className="mt-8 grid gap-10 lg:grid-cols-3 lg:gap-8">
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
                    Long SPY when the score exceeds +20 (Risk-On). Short SPY
                    when below −20 (Risk-Off). Cash in the Neutral zone. A 5 bps
                    friction on every position change. No leverage, no options.
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
                    Both. The algo runs live every trading day. This chart replays
                    the same model against every session since Jan 2020 to show a
                    longer track record. Each day uses only data available at the
                    time — no lookahead. A 5 bps trading friction is included.
                  </p>
                </div>
                <div className="border-t border-white/10 py-6">
                  <h3 className="text-sm font-semibold text-white">
                    Can I verify these numbers?
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">
                    Yes. Pull SPY daily closes from Yahoo Finance. Apply the
                    strategy: long when the score exceeds +20, short when below
                    −20, cash otherwise. Include 5 bps friction per position
                    change. You&rsquo;ll get the same equity curve.
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
