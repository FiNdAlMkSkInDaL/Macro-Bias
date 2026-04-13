import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { notFound } from "next/navigation";

import {
  ALL_REGIME_SLUGS,
  formatDisplayLabel,
  formatSignedScore,
  getRegimeAccentClass,
  getRegimeBorderClass,
  getRegimeGradientClass,
  getRegimeStats,
  isValidRegimeSlug,
  regimeSlugToLabel,
  type RegimeSlug,
} from "@/lib/regime/regime-data";
import { getRegimeContent } from "@/lib/regime/regime-content";
import { getAppUrl } from "@/lib/server-env";
import { RegimeSignupForm } from "./signup-form";

const headingFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

const dataFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-data",
});

const SITE_NAME = "Macro Bias";

export const dynamicParams = true;
export const revalidate = 3600;

type PageProps = {
  params: Promise<{ slug: string }>;
};

function formatLongDate(dateString: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(dateString));
}

function formatShortDate(dateString: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(dateString));
}

export function generateStaticParams(): Array<{ slug: string }> {
  return ALL_REGIME_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;

  if (!isValidRegimeSlug(slug)) {
    return { title: "Regime Not Found" };
  }

  const content = getRegimeContent(slug);
  const appUrl = getAppUrl().replace(/\/$/, "");
  const canonicalUrl = `${appUrl}/regime/${slug}`;

  return {
    title: content.seoTitle,
    description: content.seoDescription,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: "article",
      url: canonicalUrl,
      siteName: SITE_NAME,
      title: content.seoTitle,
      description: content.seoDescription,
      images: [
        {
          url: `${appUrl}/api/og`,
          width: 1200,
          height: 630,
          alt: content.seoTitle,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: content.seoTitle,
      description: content.seoDescription,
    },
  };
}

export default async function RegimePage({ params }: PageProps) {
  const { slug } = await params;

  if (!isValidRegimeSlug(slug)) {
    notFound();
  }

  const typedSlug: RegimeSlug = slug;
  const label = regimeSlugToLabel(typedSlug);
  const content = getRegimeContent(typedSlug);
  const stats = await getRegimeStats(typedSlug);
  const appUrl = getAppUrl().replace(/\/$/, "");
  const canonicalUrl = `${appUrl}/regime/${typedSlug}`;

  const accentClass = getRegimeAccentClass(label);
  const borderClass = getRegimeBorderClass(label);
  const gradientClass = getRegimeGradientClass(label);

  // Structured data: FAQPage
  const faqStructuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: content.faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  // Structured data: Article
  const articleStructuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: content.seoTitle,
    description: content.seoDescription,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
    author: { "@type": "Organization", name: SITE_NAME },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: appUrl,
      logo: { "@type": "ImageObject", url: `${appUrl}/icon.png` },
    },
    about: {
      "@type": "FinancialProduct",
      name: `Macro Bias ${content.headline} Regime Signal`,
      description: content.description,
      category: "Financial Analytics",
    },
    keywords: [
      "macro bias",
      content.headline.toLowerCase(),
      "macro regime",
      "day trading",
      "algo signal",
      "risk on risk off",
      slug,
    ],
  };

  // Structured data: BreadcrumbList
  const breadcrumbData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: appUrl },
      { "@type": "ListItem", position: 2, name: "Regimes", item: `${appUrl}/regime` },
      { "@type": "ListItem", position: 3, name: content.headline, item: canonicalUrl },
    ],
  };

  return (
    <main
      className={`${headingFont.variable} ${dataFont.variable} min-h-screen bg-zinc-950 font-[family:var(--font-heading)] text-zinc-100`}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqStructuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleStructuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbData) }}
      />

      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-8 sm:px-6 sm:py-10">
        {/* ===== Hero Header ===== */}
        <header
          className={`border ${borderClass} bg-gradient-to-br ${gradientClass} via-zinc-950 to-zinc-950 px-5 py-10 sm:px-8 sm:py-14`}
        >
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Macro Regime ]
          </p>
          <h1 className="mt-5 font-[family:var(--font-heading)] text-4xl font-bold tracking-[-0.06em] text-white sm:text-5xl lg:text-6xl">
            <span className={accentClass}>{content.headline}</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-300">
            {content.tagline}
          </p>

          {/* Live stats strip */}
          {stats && stats.occurrenceCount > 0 && (
            <div className="mt-8 grid grid-cols-2 gap-4 border-t border-white/10 pt-6 sm:grid-cols-4">
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                  Occurrences
                </p>
                <p className="mt-1 font-[family:var(--font-data)] text-xl font-bold text-white">
                  {stats.occurrenceCount}
                </p>
              </div>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                  Avg Score
                </p>
                <p className={`mt-1 font-[family:var(--font-data)] text-xl font-bold ${accentClass}`}>
                  {formatSignedScore(stats.avgScore)}
                </p>
              </div>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                  Score Range
                </p>
                <p className="mt-1 font-[family:var(--font-data)] text-xl font-bold text-white">
                  {formatSignedScore(stats.minScore)} / {formatSignedScore(stats.maxScore)}
                </p>
              </div>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                  Last Seen
                </p>
                <p className="mt-1 font-[family:var(--font-data)] text-sm font-bold text-white">
                  {stats.lastSeenDate ? formatShortDate(stats.lastSeenDate) : "—"}
                </p>
              </div>
            </div>
          )}
        </header>

        {/* ===== What It Means ===== */}
        <section className="mt-6 border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ What It Means ]
          </p>
          <p className="mt-5 text-base leading-8 text-zinc-300">
            {content.description}
          </p>
          <p className="mt-4 text-base leading-8 text-zinc-300">
            {content.whatItMeans}
          </p>
        </section>

        {/* ===== Trading Implications ===== */}
        <section className="mt-6 border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
          <p className={`font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] ${accentClass}`}>
            [ Trading Implications ]
          </p>
          <ul className="mt-5 space-y-4">
            {content.tradingImplications.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-7 text-zinc-300">
                <span className="mt-[0.72rem] block h-px w-3 flex-none bg-zinc-600" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ===== Historical Context ===== */}
        <section className="mt-6 border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Historical Context ]
          </p>
          <p className="mt-5 text-base leading-8 text-zinc-300">
            {content.historicalContext}
          </p>
        </section>

        {/* ===== Key Indicators ===== */}
        <section className="mt-6 border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Key Indicators ]
          </p>
          <ul className="mt-5 space-y-3">
            {content.keyIndicators.map((indicator) => (
              <li key={indicator} className="flex items-start gap-3">
                <span className="mt-2 block h-1.5 w-1.5 flex-none rounded-full bg-zinc-600" />
                <span className="text-sm leading-7 text-zinc-300">{indicator}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ===== Recent Sessions ===== */}
        {stats && stats.recentBriefings.length > 0 && (
          <section className="mt-6 border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              [ Recent {content.headline} Sessions ]
            </p>
            <div className="mt-5 divide-y divide-white/5">
              {stats.recentBriefings.map((b) => (
                <Link
                  key={b.briefing_date}
                  href={`/briefings/${b.briefing_date}`}
                  className="flex items-center justify-between py-3 transition hover:bg-white/[0.02]"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-[family:var(--font-data)] text-xs text-zinc-500">
                      {formatShortDate(b.briefing_date)}
                    </span>
                    {b.is_override_active && (
                      <span className="font-[family:var(--font-data)] text-[9px] font-bold uppercase tracking-widest text-red-400">
                        Override
                      </span>
                    )}
                  </div>
                  <span className={`font-[family:var(--font-data)] text-sm font-bold ${accentClass}`}>
                    {formatSignedScore(b.quant_score)}
                  </span>
                </Link>
              ))}
            </div>
            <div className="mt-4">
              <Link
                href="/briefings"
                className="font-[family:var(--font-data)] text-xs text-zinc-500 transition hover:text-zinc-300"
              >
                View full briefing archive →
              </Link>
            </div>
          </section>
        )}

        {/* ===== FAQ ===== */}
        <section className="mt-6 border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Frequently Asked Questions ]
          </p>
          <div className="mt-6 divide-y divide-white/5">
            {content.faq.map((item) => (
              <div key={item.question} className="py-5 first:pt-0 last:pb-0">
                <h3 className="text-sm font-semibold text-white">{item.question}</h3>
                <p className="mt-2 text-sm leading-7 text-zinc-400">{item.answer}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ===== Newsletter Signup CTA ===== */}
        <section
          className={`mt-6 border ${borderClass} bg-gradient-to-br ${gradientClass} via-zinc-950 to-zinc-950 px-5 py-10 sm:px-8 sm:py-12`}
        >
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-sky-300">
            [ Get the Daily Signal ]
          </p>
          <h2 className="mt-4 font-[family:var(--font-heading)] text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Know the regime before the open.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
            Free subscribers get the daily regime score and top-line alpha
            protocol every trading day. Premium unlocks the full briefing with
            sector scoring, K-NN diagnostics, and system risk protocol.
          </p>
          <RegimeSignupForm regime={content.headline} />
          <div className="mt-4 flex items-center gap-4">
            <Link
              className="inline-flex items-center justify-center rounded-xl border border-sky-400/50 bg-gradient-to-r from-sky-500 to-sky-600 px-5 py-2.5 font-[family:var(--font-data)] text-xs font-bold uppercase tracking-[0.14em] text-white shadow-lg shadow-sky-500/20 transition hover:from-sky-400 hover:to-sky-500"
              href="/api/checkout?plan=monthly"
            >
              Start 7-Day Free Trial — $25/mo after
            </Link>
          </div>
        </section>

        {/* ===== Nav ===== */}
        <nav className="mt-8 flex items-center justify-between">
          <Link
            href="/regime"
            className="font-[family:var(--font-data)] text-xs text-zinc-500 transition hover:text-zinc-300"
          >
            ← All Regimes
          </Link>
          <Link
            href="/briefings"
            className="font-[family:var(--font-data)] text-xs text-zinc-500 transition hover:text-zinc-300"
          >
            Briefing Archive →
          </Link>
        </nav>
      </div>
    </main>
  );
}
