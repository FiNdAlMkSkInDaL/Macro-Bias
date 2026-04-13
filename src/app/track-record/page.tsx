import type { Metadata } from "next";
import Link from "next/link";

import { getBacktestData } from "@/lib/track-record/backtest-engine";
import PerformanceChart from "@/components/track-record/PerformanceChart";

/* ------------------------------------------------------------------ */
/*  SEO                                                                */
/* ------------------------------------------------------------------ */

const SITE_URL = "https://macro-bias.com";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Track Record — Model Performance vs S&P 500 | Macro Bias",
  description:
    "See how the Macro Bias signal performed against the S&P 500 since January 2026. Simple equity curve, no spin — just the numbers.",
  alternates: {
    canonical: `${SITE_URL}/track-record`,
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/track-record`,
    siteName: "Macro Bias",
    title: "Track Record — Model Performance vs S&P 500 | Macro Bias",
    description:
      "See how the Macro Bias signal performed against the S&P 500 since January 2026.",
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
          "Macro Bias signal vs S&P 500 equity curve since January 2026.",
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
              text: "Each morning the model publishes a bias score. On bullish days (score > 0) the strategy goes long SPY. On bearish days (score < 0) it goes short SPY. On neutral days (score = 0) it sits in cash. No leverage, no options — just direction.",
            },
          },
          {
            "@type": "Question",
            name: "Is this backtested or live?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "The chart replays the exact production algorithm against every 2026 trading session. Each day's score uses only data available before that session's open — no lookahead bias. The same model runs live every trading day.",
            },
          },
          {
            "@type": "Question",
            name: "Can I verify these results?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Yes. Pull SPY daily closes from Yahoo Finance or any public source. The strategy is simple: long SPY on bullish signal days, short on bearish, cash on neutral. You can replicate the equity curve independently.",
            },
          },
        ],
      },
    ],
  };

  return (
    <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      {/* Header */}
      <header>
        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-600">
          [ Track Record ]
        </p>
        <h1 className="mt-3 font-[family:var(--font-heading)] text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Model vs S&amp;P 500
        </h1>
        <p className="mt-2 text-sm leading-7 text-zinc-400 sm:text-base">
          The same algo that runs every morning — replayed since January 2026.
          Long on bullish days, short on bearish, cash on neutral.
        </p>
      </header>

      {hasData ? (
        <>
          {/* Headline numbers */}
          <div className="mt-10 grid grid-cols-3 gap-4">
            <div className="border border-white/[0.06] bg-white/[0.02] px-4 py-4">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                Macro Bias
              </p>
              <p
                className={`mt-1 font-[family:var(--font-data)] text-2xl font-bold sm:text-3xl ${
                  (stratReturn ?? 0) >= 0 ? "text-cyan-400" : "text-red-400"
                }`}
              >
                {fmtReturn(stratReturn)}
              </p>
            </div>
            <div className="border border-white/[0.06] bg-white/[0.02] px-4 py-4">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                S&amp;P 500
              </p>
              <p
                className={`mt-1 font-[family:var(--font-data)] text-2xl font-bold sm:text-3xl ${
                  (spyReturn ?? 0) >= 0 ? "text-zinc-300" : "text-red-400"
                }`}
              >
                {fmtReturn(spyReturn)}
              </p>
            </div>
            <div className="border border-white/[0.06] bg-white/[0.02] px-4 py-4">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                Alpha
              </p>
              <p
                className={`mt-1 font-[family:var(--font-data)] text-2xl font-bold sm:text-3xl ${
                  (outperformance ?? 0) > 0
                    ? "text-emerald-400"
                    : "text-zinc-400"
                }`}
              >
                {outperformance !== null
                  ? `${outperformance > 0 ? "+" : ""}${outperformance.toFixed(2)}%`
                  : "—"}
              </p>
            </div>
          </div>

          {/* Date range */}
          {backtest.dateRange && (
            <p className="mt-3 font-[family:var(--font-data)] text-xs text-zinc-600">
              {fmtDateRange(backtest.dateRange.from, backtest.dateRange.to)} ·{" "}
              {backtest.totalDays} sessions
            </p>
          )}

          {/* Chart */}
          <div className="mt-6 border border-white/[0.06] bg-white/[0.02] p-3 sm:p-5">
            {/* Legend */}
            <div className="mb-4 flex items-center gap-5">
              <span className="flex items-center gap-2 font-[family:var(--font-data)] text-xs text-zinc-400">
                <span className="inline-block h-0.5 w-4 bg-cyan-400" />
                Macro Bias Signal
              </span>
              <span className="flex items-center gap-2 font-[family:var(--font-data)] text-xs text-zinc-400">
                <span className="inline-block h-0.5 w-4 bg-zinc-500" />
                S&amp;P 500 Buy &amp; Hold
              </span>
            </div>
            <PerformanceChart data={backtest.equityCurve} />
          </div>

          {/* Methodology */}
          <div className="mt-8 space-y-5 text-sm leading-7 text-zinc-400">
            <h2 className="font-[family:var(--font-heading)] text-lg font-semibold tracking-tight text-white">
              How it works
            </h2>
            <p>
              Every morning before the opening bell, our KNN-based model scores
              the day&rsquo;s macro conditions on a{" "}
              <span className="text-zinc-300">-100 to +100</span> scale. It
              analyses 6 cross-asset features — volatility, credit spreads,
              commodity ratios, momentum — against a decade of historical
              analogs.
            </p>
            <p>
              The strategy on this chart is simple:{" "}
              <span className="text-cyan-400">go long</span> SPY when the score
              is bullish,{" "}
              <span className="text-red-400">go short</span> when bearish, and
              sit in cash when neutral. No leverage, no options, no fancy
              execution — just direction.
            </p>
            <p>
              Each day&rsquo;s score is{" "}
              <span className="text-zinc-300">
                computed using only prior data
              </span>
              . No lookahead bias. The chart shows the exact same algorithm and
              parameters that run in production today.
            </p>
          </div>

          {/* FAQ */}
          <div className="mt-8 divide-y divide-white/[0.06] border-t border-white/[0.06]">
            <div className="py-5">
              <h3 className="text-sm font-semibold text-white">
                Is this backtested or live?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                Both. The algo runs live every trading day. This chart replays
                the same model against 2026 sessions to show a longer track
                record. Each day uses only data available at the time — no
                lookahead.
              </p>
            </div>
            <div className="py-5">
              <h3 className="text-sm font-semibold text-white">
                Can I verify these numbers?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                Yes. Pull SPY daily closes from Yahoo Finance. Apply the
                strategy: long on bullish signal days, short on bearish, cash on
                neutral. You&rsquo;ll get the same equity curve.
              </p>
            </div>
            <div className="py-5">
              <h3 className="text-sm font-semibold text-white">
                What happens on news-driven days?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                The model reads macro conditions, not headlines. Some
                news-driven days it gets wrong — tariff announcements, Fed
                surprises. The chart includes those days too. No cherry-picking.
              </p>
            </div>
          </div>

          {/* CTA */}
          <div className="mt-10 border border-cyan-500/20 bg-cyan-500/[0.04] px-5 py-6 text-center sm:px-8 sm:py-8">
            <p className="font-[family:var(--font-heading)] text-lg font-bold text-white sm:text-xl">
              Get the signal before the bell
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              Daily scores, regime calls, and a full market briefing — delivered
              before 9:30 AM ET. 7-day free trial.
            </p>
            <Link
              href="/pricing"
              className="mt-4 inline-block rounded bg-cyan-500 px-6 py-2.5 text-sm font-semibold text-black transition hover:bg-cyan-400"
            >
              Start free trial
            </Link>
          </div>
        </>
      ) : (
        <div className="mt-12 rounded border border-white/[0.06] bg-white/[0.02] px-6 py-10 text-center">
          <p className="text-sm text-zinc-400">
            Performance data is being calculated. Check back shortly.
          </p>
        </div>
      )}

      {/* Nav */}
      <nav className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/"
          className="font-[family:var(--font-data)] text-xs text-zinc-600 transition hover:text-zinc-400"
        >
          ← Home
        </Link>
        <Link
          href="/dashboard"
          className="font-[family:var(--font-data)] text-xs text-zinc-600 transition hover:text-zinc-400"
        >
          Dashboard →
        </Link>
      </nav>
    </div>
  );
}
