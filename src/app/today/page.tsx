import type { Metadata } from "next";
import Link from "next/link";

import { ReferralPromoCard } from "@/components/ReferralPromoCard";
import { getLatestBiasSnapshot } from "@/lib/market-data/get-latest-bias-snapshot";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TodaySignupForm } from "./signup-form";

const SITE_URL = "https://macro-bias.com";

export const revalidate = 900; // 15 minutes

export const metadata: Metadata = {
  title: "Market Regime Today — Is the Market Risk On or Risk Off? | Macro Bias",
  description:
    "Check today's macro regime score before you trade. Is the market risk on or risk off today? Updated daily before the US open using 9 cross-asset ETFs and 10 years of historical pattern matching.",
  keywords: [
    "market regime today",
    "is market risk on today",
    "risk on risk off today",
    "macro regime score",
    "market bias today",
    "daily market regime",
    "stock market regime today",
    "crypto regime today",
    "market conditions today",
    "risk on or risk off",
  ],
  alternates: {
    canonical: `${SITE_URL}/today`,
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/today`,
    siteName: "Macro Bias",
    title: "Market Regime Today — Is the Market Risk On or Risk Off?",
    description:
      "Today's quantitative macro regime score. Updated daily before the US equity open. Stocks + Crypto.",
    images: [
      {
        url: `${SITE_URL}/api/og`,
        width: 1200,
        height: 630,
        alt: "Macro Bias — Market Regime Today",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Market Regime Today — Is the Market Risk On or Risk Off?",
    description:
      "Today's macro regime score. Updated daily before the US open.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

type ScoreSnapshot = {
  score: number;
  label: string;
  tradeDate: string;
  updatedAt: string;
};

function getRegimeDisplay(score: number) {
  if (score >= 60)
    return {
      regime: "Extreme Risk-On",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/30",
      barColor: "#22c55e",
      summary:
        "Strong structural bids across risk assets. Cross-asset participation is confirming broad risk appetite.",
    };
  if (score > 20)
    return {
      regime: "Risk-On",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/30",
      barColor: "#22c55e",
      summary:
        "Growth and cyclical leadership. The tape favors offense and buying pullbacks.",
    };
  if (score >= -20)
    return {
      regime: "Neutral",
      color: "text-zinc-300",
      bg: "bg-zinc-500/10",
      border: "border-zinc-500/30",
      barColor: "#a1a1aa",
      summary:
        "Mixed signals. No clean macro confirmation from the cross-asset rotation basket. Reduce sizing.",
    };
  if (score > -60)
    return {
      regime: "Risk-Off",
      color: "text-rose-400",
      bg: "bg-rose-500/10",
      border: "border-rose-500/30",
      barColor: "#f43f5e",
      summary:
        "Defensive leadership taking over. Traders are rotating away from cyclicals into safety.",
    };
  return {
    regime: "Extreme Risk-Off",
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/30",
    barColor: "#f43f5e",
    summary:
      "Broad risk-asset liquidation. Bonds, gold, and defensive sectors dominating flows.",
  };
}

function formatScore(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}

function formatTradeDate(dateStr: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(dateStr));
}

function formatShortDate(dateStr: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(dateStr));
}

function formatUpdateTime(dateStr: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(new Date(dateStr));
}

function getGaugePosition(score: number) {
  return ((Math.max(-100, Math.min(100, score)) + 100) / 200) * 100;
}

async function getCryptoSnapshot(): Promise<ScoreSnapshot | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("crypto_bias_scores")
    .select("score, bias_label, trade_date, updated_at")
    .order("trade_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    score: data.score,
    label: data.bias_label,
    tradeDate: data.trade_date,
    updatedAt: data.updated_at,
  };
}

export default async function TodayPage() {
  const [stocksSnapshot, cryptoSnapshot] = await Promise.all([
    getLatestBiasSnapshot(),
    getCryptoSnapshot(),
  ]);

  const stocksScore = stocksSnapshot?.score ?? 0;
  const stocksDate = stocksSnapshot?.trade_date ?? new Date().toISOString().slice(0, 10);
  const stocksUpdated = stocksSnapshot?.updated_at ?? new Date().toISOString();
  const stocksDisplay = getRegimeDisplay(stocksScore);

  const cryptoScore = cryptoSnapshot?.score ?? null;
  const cryptoDate = cryptoSnapshot?.tradeDate ?? null;
  const cryptoUpdated = cryptoSnapshot?.updatedAt ?? null;
  const cryptoDisplay = cryptoScore !== null ? getRegimeDisplay(cryptoScore) : null;

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What is the market regime today?",
        acceptedAnswer: {
          "@type": "Answer",
          text: `As of ${formatShortDate(stocksDate)}, the Macro Bias stock market regime score is ${formatScore(stocksScore)} (${stocksDisplay.regime}). ${stocksDisplay.summary}`,
        },
      },
      {
        "@type": "Question",
        name: "Is the market risk on or risk off today?",
        acceptedAnswer: {
          "@type": "Answer",
          text: `The market is currently ${stocksDisplay.regime}. The score is calculated from 9 cross-asset ETFs spanning stocks, bonds, volatility, commodities, and credit, matched against 10 years of historically similar sessions.`,
        },
      },
      {
        "@type": "Question",
        name: "How is the macro regime score calculated?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The regime score ranges from -100 (extreme risk-off) to +100 (extreme risk-on). A K-Nearest Neighbors model measures today's cross-asset conditions against the most similar historical sessions. Features include SPY RSI, VIX level, HYG/TLT credit ratio, copper/gold ratio, USO momentum, and dealer positioning proxy.",
        },
      },
      {
        "@type": "Question",
        name: "What is the crypto regime today?",
        acceptedAnswer: {
          "@type": "Answer",
          text: cryptoScore !== null
            ? `The crypto regime score is ${formatScore(cryptoScore)} (${cryptoDisplay?.regime}) as of ${formatShortDate(cryptoDate!)}. The crypto model tracks BTC realized volatility, ETH/BTC ratio, DXY momentum, funding rates, and TLT momentum.`
            : "Crypto regime data is not yet available for today.",
        },
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <nav className="mb-8 text-xs text-zinc-500" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-zinc-300 transition-colors">
            Home
          </Link>
          <span className="mx-2">/</span>
          <span className="text-zinc-400">Today</span>
        </nav>

        {/* Page heading — H1 targets primary keyword */}
        <header>
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            Updated {formatTradeDate(stocksDate)}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Market Regime Today
          </h1>
          <p className="mt-3 text-base leading-7 text-zinc-400">
            Is the market risk on or risk off today? The quantitative score below
            is calculated before the US open from 9 cross-asset ETFs matched
            against 10 years of historically similar sessions.
          </p>
        </header>

        {/* ── Stocks Regime Score ── */}
        <section className="mt-10" aria-labelledby="stocks-regime">
          <h2 id="stocks-regime" className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            Stocks Regime Score
          </h2>

          <div className={`mt-4 rounded-xl border ${stocksDisplay.border} ${stocksDisplay.bg} p-6`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className={`font-[family:var(--font-data)] text-5xl font-semibold leading-none sm:text-6xl ${stocksDisplay.color}`}>
                  {formatScore(stocksScore)}
                </p>
                <p className={`mt-2 font-[family:var(--font-data)] text-xs uppercase tracking-[0.36em] ${stocksDisplay.color}`}>
                  {stocksDisplay.regime}
                </p>
              </div>
              <p className="max-w-sm text-sm leading-6 text-zinc-400">
                {stocksDisplay.summary}
              </p>
            </div>

            {/* Gauge bar */}
            <div className="mt-6 space-y-1">
              <div className="relative w-full pt-3">
                <div
                  className="relative h-1.5 w-full overflow-hidden rounded-full"
                  style={{
                    background:
                      "linear-gradient(90deg, #f43f5e 0%, #71717a 50%, #22c55e 100%)",
                  }}
                >
                  <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/60" />
                </div>
                <div
                  className="pointer-events-none absolute top-0 h-7 -translate-x-1/2"
                  style={{ left: `${getGaugePosition(stocksScore)}%` }}
                >
                  <div
                    className="mx-auto h-full w-0.5 rounded-full"
                    style={{ background: stocksDisplay.barColor }}
                  />
                </div>
              </div>
              <div className="flex justify-between text-[10px] font-medium text-zinc-600">
                <span>−100</span>
                <span>0</span>
                <span>+100</span>
              </div>
            </div>

            <p className="mt-4 text-xs text-zinc-600">
              Last updated {formatUpdateTime(stocksUpdated)}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-3 text-xs">
            <Link
              href="/dashboard"
              className="rounded-md border border-zinc-800 px-3 py-1.5 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white"
            >
              Live dashboard →
            </Link>
            <Link
              href="/track-record"
              className="rounded-md border border-zinc-800 px-3 py-1.5 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white"
            >
              Track record →
            </Link>
            <Link
              href="/briefings"
              className="rounded-md border border-zinc-800 px-3 py-1.5 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white"
            >
              Briefing archive →
            </Link>
          </div>
        </section>

        {/* ── Crypto Regime Score ── */}
        {cryptoScore !== null && cryptoDisplay && (
          <section className="mt-10" aria-labelledby="crypto-regime">
            <h2 id="crypto-regime" className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              Crypto Regime Score
            </h2>

            <div className={`mt-4 rounded-xl border ${cryptoDisplay.border} ${cryptoDisplay.bg} p-6`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className={`font-[family:var(--font-data)] text-5xl font-semibold leading-none sm:text-6xl ${cryptoDisplay.color}`}>
                    {formatScore(cryptoScore)}
                  </p>
                  <p className={`mt-2 font-[family:var(--font-data)] text-xs uppercase tracking-[0.36em] ${cryptoDisplay.color}`}>
                    {cryptoDisplay.regime}
                  </p>
                </div>
                <p className="max-w-sm text-sm leading-6 text-zinc-400">
                  {cryptoDisplay.summary}
                </p>
              </div>

              {/* Gauge bar */}
              <div className="mt-6 space-y-1">
                <div className="relative w-full pt-3">
                  <div
                    className="relative h-1.5 w-full overflow-hidden rounded-full"
                    style={{
                      background:
                        "linear-gradient(90deg, #f43f5e 0%, #71717a 50%, #22c55e 100%)",
                    }}
                  >
                    <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/60" />
                  </div>
                  <div
                    className="pointer-events-none absolute top-0 h-7 -translate-x-1/2"
                    style={{ left: `${getGaugePosition(cryptoScore)}%` }}
                  >
                    <div
                      className="mx-auto h-full w-0.5 rounded-full"
                      style={{ background: cryptoDisplay.barColor }}
                    />
                  </div>
                </div>
                <div className="flex justify-between text-[10px] font-medium text-zinc-600">
                  <span>−100</span>
                  <span>0</span>
                  <span>+100</span>
                </div>
              </div>

              <p className="mt-4 text-xs text-zinc-600">
                Last updated {cryptoUpdated ? formatUpdateTime(cryptoUpdated) : "—"}
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-3 text-xs">
              <Link
                href="/crypto/dashboard"
                className="rounded-md border border-zinc-800 px-3 py-1.5 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white"
              >
                Crypto dashboard →
              </Link>
              <Link
                href="/crypto/track-record"
                className="rounded-md border border-zinc-800 px-3 py-1.5 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white"
              >
                Crypto track record →
              </Link>
            </div>
          </section>
        )}

        {/* ── How it works (SEO-rich content) ── */}
        <section className="mt-14" aria-labelledby="how-it-works">
          <h2
            id="how-it-works"
            className="text-lg font-semibold tracking-tight text-white"
          >
            How the regime score works
          </h2>

          <div className="mt-4 space-y-4 text-sm leading-7 text-zinc-400">
            <p>
              The macro regime score ranges from <strong className="text-zinc-200">−100</strong> (extreme risk-off)
              to <strong className="text-zinc-200">+100</strong> (extreme risk-on). It measures today&apos;s
              cross-asset conditions against the most similar historical trading sessions
              from the past 10+ years.
            </p>
            <p>
              A <strong className="text-zinc-200">K-Nearest Neighbors</strong> model builds a 6-dimensional feature
              vector from SPY momentum (RSI-14), VIX implied volatility, HYG/TLT credit
              spreads, copper/gold industrial-vs-safe-haven ratio, USO energy momentum, and
              a dealer positioning proxy. It finds the 5 closest historical analogs,
              averages their forward returns, and maps the result to the −100 to +100 scale.
            </p>
            <p>
              For crypto, a parallel model uses BTC realized volatility, ETH/BTC ratio, DXY
              dollar momentum, funding rates, and TLT rate-expectation momentum.
            </p>
            <p>
              Both scores are published every trading day before the US equity open. The
              daily briefing email expands the score into a full sector breakdown,
              historical pattern analysis, and risk check.
            </p>
          </div>
        </section>

        {/* ── Signup form ── */}
        <section className="mt-14" aria-labelledby="signup-heading">
          <h2
            id="signup-heading"
            className="text-lg font-semibold tracking-tight text-white"
          >
            Get the full briefing every morning
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            The score above is the headline. The daily email gives you everything
            behind it: sector breakdown, historical pattern matching, risk check,
            and model notes. Free. 90 seconds. Before the bell.
          </p>

          <TodaySignupForm />
        </section>

        <ReferralPromoCard
          className="mt-10"
          ctaLabel="See referral rewards"
          location="today_page"
          title="Already on the list? Send friends here and let the product do the selling."
        />

        {/* ── Score legend (keyword-rich) ── */}
        <section className="mt-14" aria-labelledby="score-legend">
          <h2
            id="score-legend"
            className="text-lg font-semibold tracking-tight text-white"
          >
            What each regime means
          </h2>

          <div className="mt-4 space-y-3">
            {[
              {
                range: "+60 to +100",
                label: "Extreme Risk-On",
                color: "text-emerald-400",
                desc: "Broad structural bids. Lean into momentum and relative strength leaders.",
              },
              {
                range: "+21 to +59",
                label: "Risk-On",
                color: "text-emerald-400",
                desc: "Growth-favoring conditions. Buy pullbacks in leading sectors.",
              },
              {
                range: "−20 to +20",
                label: "Neutral",
                color: "text-zinc-300",
                desc: "Mixed tape. Reduce position sizing. Wait for confirmation before committing.",
              },
              {
                range: "−59 to −21",
                label: "Risk-Off",
                color: "text-rose-400",
                desc: "Defensive rotation underway. Favor bonds, utilities, and cash.",
              },
              {
                range: "−100 to −60",
                label: "Extreme Risk-Off",
                color: "text-rose-400",
                desc: "Broad liquidation. Capital preservation mode. Avoid new longs.",
              },
            ].map((tier) => (
              <div
                key={tier.label}
                className="flex flex-col gap-1 rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <span className="w-28 shrink-0 font-[family:var(--font-data)] text-xs text-zinc-500">
                  {tier.range}
                </span>
                <span className={`w-36 shrink-0 text-sm font-semibold ${tier.color}`}>
                  {tier.label}
                </span>
                <span className="text-sm text-zinc-400">{tier.desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Bottom CTA ── */}
        <section className="mt-14 rounded-xl border border-zinc-800 bg-zinc-900/30 p-6 text-center">
          <p className="text-sm text-zinc-400">
            Backtested since 2020:{" "}
            <Link
              href="/track-record"
              className="font-semibold text-white underline decoration-zinc-600 underline-offset-4 hover:decoration-white transition-colors"
            >
              +295% strategy vs +116% S&amp;P 500
            </Link>
            {" "}·{" "}
            <Link
              href="/crypto/track-record"
              className="font-semibold text-white underline decoration-zinc-600 underline-offset-4 hover:decoration-white transition-colors"
            >
              +41,576% long-only vs +941% BTC
            </Link>
          </p>
        </section>
      </main>
    </>
  );
}
