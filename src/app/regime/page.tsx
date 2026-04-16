import type { Metadata } from "next";
import Link from "next/link";

import {
  formatDisplayLabel,
  formatSignedScore,
  getRegimeAccentClass,
  getRegimeBorderClass,
  getRegimeGradientClass,
  getRegimeOverview,
} from "@/lib/regime/regime-data";
import { getRegimeContent, getAllRegimeContent } from "@/lib/regime/regime-content";
import { getAppUrl } from "@/lib/server-env";



const SITE_URL = "https://macro-bias.com";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Macro Regime Guide — Risk On, Risk Off, Neutral | Macro Bias",
  description:
    "Understand the five macro regimes the Macro Bias algo tracks: Extreme Risk On, Risk On, Neutral, Risk Off, and Extreme Risk Off. Learn what each regime means for day trading.",
  alternates: {
    canonical: `${SITE_URL}/regime`,
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/regime`,
    siteName: "Macro Bias",
    title: "Macro Regime Guide — Risk On, Risk Off, Neutral | Macro Bias",
    description:
      "Guide to the five macro regimes tracked by the Macro Bias algo. Learn trading implications, key indicators, and historical patterns for each regime.",
  },
};

function formatShortDate(dateString: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(dateString));
}

export default async function RegimeIndexPage() {
  const overview = await getRegimeOverview();
  const appUrl = getAppUrl().replace(/\/$/, "");
  const allContent = getAllRegimeContent();

  const faqStructuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What are macro regimes in trading?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Macro regimes describe the dominant market environment based on intermarket signals from equities, bonds, gold, oil, and credit. The five regimes — Extreme Risk On, Risk On, Neutral, Risk Off, and Extreme Risk Off — each have different implications for which trading strategies work best.",
        },
      },
      {
        "@type": "Question",
        name: "How does the Macro Bias algo determine the current regime?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The algo uses K-Nearest Neighbors analysis across SPY, TLT, GLD, USO, and HYG daily price data, combined with technical indicators (RSI, MACD, moving averages) and VIX levels, to produce a score from -100 to +100 that maps to one of five regime classifications.",
        },
      },
      {
        "@type": "Question",
        name: "How often does the macro regime change?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The regime is recalculated every trading day. It can persist for days or weeks, or shift after a single session depending on macro catalysts. The Neutral regime often acts as a transition zone between Risk On and Risk Off phases.",
        },
      },
      {
        "@type": "Question",
        name: "Can I get alerts when the regime changes?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes. Free subscribers receive a daily email with the regime score and bottom line summary. Premium subscribers get the full briefing with sector breakdown, model notes, and risk check before the opening bell.",
        },
      },
    ],
  };

  const collectionData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Macro Regime Guide",
    description:
      "Guide to the five macro regimes tracked by the Macro Bias algo.",
    url: `${appUrl}/regime`,
    isPartOf: {
      "@type": "WebSite",
      name: "Macro Bias",
      url: appUrl,
    },
  };

  return (
    <main
      className="min-h-screen font-[family:var(--font-heading)]"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqStructuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionData) }}
      />

      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-8 sm:px-6 sm:py-10">
        {/* Header */}
        <header className="border border-white/10 bg-zinc-950 px-5 py-10 sm:px-8 sm:py-12">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Regime Guide ]
          </p>
          <h1 className="mt-4 font-[family:var(--font-heading)] text-4xl font-bold tracking-[-0.06em] text-white sm:text-5xl">
            Macro Regimes Explained
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-8 text-zinc-400">
            The Macro Bias algo classifies every trading session into one of
            five regimes based on intermarket price action across equities,
            bonds, gold, oil, and credit. Each regime has different implications
            for which strategies work and which get you killed.
          </p>

          {/* Current regime highlight */}
          {overview.currentRegime && (
            <div className="mt-8 border-t border-white/10 pt-6">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                Current Regime
              </p>
              <Link
                href={`/regime/${overview.currentRegime.slug}`}
                className={`mt-2 inline-block font-[family:var(--font-heading)] text-2xl font-bold tracking-tight transition hover:opacity-80 ${getRegimeAccentClass(overview.currentRegime.label)}`}
              >
                {overview.currentRegime.displayName}{" "}
                <span className="font-[family:var(--font-data)] text-lg">
                  ({formatSignedScore(overview.currentRegime.avgScore)} avg)
                </span>
              </Link>
              {overview.currentRegime.lastSeenDate && (
                <p className="mt-1 font-[family:var(--font-data)] text-xs text-zinc-500">
                  Last seen: {formatShortDate(overview.currentRegime.lastSeenDate)}
                </p>
              )}
            </div>
          )}

          {overview.totalBriefings > 0 && (
            <p className="mt-4 font-[family:var(--font-data)] text-xs text-zinc-600">
              Based on {overview.totalBriefings} trading sessions analyzed.
            </p>
          )}
        </header>

        {/* Regime cards */}
        <div className="mt-6 space-y-4">
          {overview.allRegimes.map((regime) => {
            const content = getRegimeContent(regime.slug);
            const accentClass = getRegimeAccentClass(regime.label);
            const borderClass = getRegimeBorderClass(regime.label);
            const gradientClass = getRegimeGradientClass(regime.label);

            return (
              <Link
                key={regime.slug}
                href={`/regime/${regime.slug}`}
                className={`block border ${borderClass} bg-gradient-to-br ${gradientClass} via-zinc-950 to-zinc-950 px-5 py-6 transition hover:brightness-110 sm:px-8`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1">
                    <h2 className={`font-[family:var(--font-heading)] text-xl font-bold tracking-tight ${accentClass}`}>
                      {content.headline}
                    </h2>
                    <p className="mt-2 text-sm leading-7 text-zinc-400">
                      {content.tagline}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-4 sm:flex-col sm:items-end sm:gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-[family:var(--font-data)] text-[10px] uppercase tracking-widest text-zinc-600">
                        Count
                      </span>
                      <span className="font-[family:var(--font-data)] text-sm font-bold text-white">
                        {regime.occurrenceCount}
                      </span>
                    </div>
                    {regime.occurrenceCount > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="font-[family:var(--font-data)] text-[10px] uppercase tracking-widest text-zinc-600">
                          Avg
                        </span>
                        <span className={`font-[family:var(--font-data)] text-sm font-bold ${accentClass}`}>
                          {formatSignedScore(regime.avgScore)}
                        </span>
                      </div>
                    )}
                    {regime.lastSeenDate && (
                      <div className="flex items-center gap-2">
                        <span className="font-[family:var(--font-data)] text-[10px] uppercase tracking-widest text-zinc-600">
                          Last
                        </span>
                        <span className="font-[family:var(--font-data)] text-xs text-zinc-400">
                          {formatShortDate(regime.lastSeenDate)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* FAQ */}
        <section className="mt-6 border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ FAQ ]
          </p>
          <div className="mt-6 divide-y divide-white/5">
            <div className="py-5 first:pt-0">
              <h3 className="text-sm font-semibold text-white">
                What are macro regimes in trading?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                Macro regimes describe the dominant market environment based on
                intermarket signals from equities, bonds, gold, oil, and credit.
                Each regime has different implications for which strategies work
                and which carry elevated risk.
              </p>
            </div>
            <div className="py-5">
              <h3 className="text-sm font-semibold text-white">
                How does the Macro Bias algo determine the current regime?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                The algo uses K-Nearest Neighbors analysis across SPY, TLT, GLD,
                USO, and HYG daily price data, combined with technical indicators
                and VIX levels, to produce a score from -100 to +100 that maps to
                one of five regime classifications.
              </p>
            </div>
            <div className="py-5 last:pb-0">
              <h3 className="text-sm font-semibold text-white">
                Can I get alerts when the regime changes?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                Yes. Free subscribers receive a daily email with the regime score.
                Premium subscribers get the full briefing including sector scoring
                and K-NN diagnostics before the opening bell.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mt-6 border border-sky-500/30 bg-gradient-to-br from-sky-500/10 via-zinc-950 to-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
          <h2 className="font-[family:var(--font-heading)] text-2xl font-semibold tracking-tight text-white">
            Get daily regime alerts free.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
            The algo scores the macro tape every session. Get the result in your
            inbox before the bell.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Link
              className="w-full sm:w-auto inline-flex items-center justify-center border border-white/20 bg-white/5 px-6 py-3 font-[family:var(--font-data)] text-xs font-bold uppercase tracking-[0.14em] text-white transition hover:bg-white/10"
              href="/emails"
            >
              Subscribe Free
            </Link>
            <Link
              className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl border border-sky-400/50 bg-gradient-to-r from-sky-500 to-sky-600 px-6 py-3 font-[family:var(--font-data)] text-xs font-bold uppercase tracking-[0.14em] text-white shadow-lg shadow-sky-500/20 transition hover:from-sky-400 hover:to-sky-500"
              href="/api/checkout?plan=monthly"
            >
              Start 7-Day Free Trial
            </Link>
          </div>
        </section>

      </div>
    </main>
  );
}
