import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  getAllBriefingDates,
  getBriefingByDate,
  type PublicBriefingRow,
} from "@/lib/briefing/get-public-briefing";
import { DAILY_BRIEFING_SECTION_HEADERS } from "@/lib/briefing/daily-briefing-config";
import { getAppUrl } from "@/lib/server-env";

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
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const dynamicParams = true;
export const revalidate = 3600;

type PageProps = {
  params: Promise<{ date: string }>;
};

function isValidDateParam(value: string) {
  return DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function formatDisplayDate(dateString: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(dateString));
}

function formatDisplayLabel(label: string) {
  return label.replace(/_/g, " ");
}

function formatSignedScore(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}

function getScoreColor(label: string) {
  switch (label) {
    case "EXTREME_RISK_ON":
    case "RISK_ON":
      return "text-green-400";
    case "EXTREME_RISK_OFF":
    case "RISK_OFF":
      return "text-orange-400";
    default:
      return "text-amber-400";
  }
}

function getFreeTierContent(briefContent: string): string {
  const bottomLineHeader = DAILY_BRIEFING_SECTION_HEADERS.bottomLine;
  const playbookHeader = DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook;
  const sections = briefContent.split(/\n/).reduce<{ current: string | null; map: Map<string, string[]> }>(
    (acc, line) => {
      const trimmed = line.trim();
      const headerMatch = [bottomLineHeader, playbookHeader].find(
        (h) => trimmed.startsWith(h) || trimmed.startsWith(`**${h}`) || trimmed.replace(/\*\*/g, "").startsWith(h),
      );
      if (headerMatch) {
        acc.current = headerMatch;
        const rest = trimmed.replace(/\*\*/g, "").replace(headerMatch, "").replace(/^:?\s*/, "");
        if (rest) acc.map.get(headerMatch)?.push(rest) ?? acc.map.set(headerMatch, [rest]);
        else acc.map.set(headerMatch, acc.map.get(headerMatch) ?? []);
        return acc;
      }
      if (acc.current) {
        const lines = acc.map.get(acc.current);
        if (lines) lines.push(line);
      }
      return acc;
    },
    { current: null, map: new Map() },
  );

  const parts: string[] = [];
  const bottomLine = sections.map.get(bottomLineHeader);
  if (bottomLine) {
    parts.push(`${bottomLineHeader}:\n${bottomLine.join("\n").trim()}`);
  }

  const playbook = sections.map.get(playbookHeader);
  if (playbook) {
    const lines = playbook.join("\n").trim().split("\n");
    const bulletLines = lines.filter((l) => l.trim().startsWith("-"));
    if (bulletLines.length > 1) {
      parts.push(
        `${playbookHeader}:\n${bulletLines[0]}\n- 🔒 **[LOCKED]**: Upgrade to view remaining sector scores and algo catalyst.`,
      );
    } else {
      parts.push(`${playbookHeader}:\n${lines.join("\n")}`);
    }
  }

  return parts.join("\n\n");
}

function buildBriefingDescription(briefing: PublicBriefingRow) {
  const label = formatDisplayLabel(briefing.bias_label);
  const score = formatSignedScore(briefing.quant_score);
  return `Macro Bias algo scored ${label} (${score}) on ${formatDisplayDate(briefing.briefing_date)}. Free daily regime briefing for day traders.`;
}

export async function generateStaticParams(): Promise<Array<{ date: string }>> {
  const briefings = await getAllBriefingDates();
  return briefings.map((b) => ({ date: b.briefing_date }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date } = await params;

  if (!isValidDateParam(date)) {
    return { title: "Briefing Not Found" };
  }

  const briefing = await getBriefingByDate(date);
  if (!briefing) {
    return { title: "Briefing Not Found" };
  }

  const appUrl = getAppUrl().replace(/\/$/, "");
  const canonicalUrl = `${appUrl}/briefings/${date}`;
  const title = `${formatDisplayLabel(briefing.bias_label)} (${formatSignedScore(briefing.quant_score)}) — ${formatDisplayDate(briefing.briefing_date)}`;
  const description = buildBriefingDescription(briefing);
  const ogImageUrl = `${appUrl}/api/og?date=${date}`;

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: "article",
      url: canonicalUrl,
      siteName: SITE_NAME,
      title,
      description,
      publishedTime: briefing.generated_at,
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default async function BriefingPage({ params }: PageProps) {
  const { date } = await params;

  if (!isValidDateParam(date)) {
    notFound();
  }

  const briefing = await getBriefingByDate(date);
  if (!briefing) {
    notFound();
  }

  const appUrl = getAppUrl().replace(/\/$/, "");
  const canonicalUrl = `${appUrl}/briefings/${date}`;
  const displayDate = formatDisplayDate(briefing.briefing_date);
  const displayLabel = formatDisplayLabel(briefing.bias_label);
  const displayScore = formatSignedScore(briefing.quant_score);
  const scoreColor = getScoreColor(briefing.bias_label);
  const overlayLabel = briefing.is_override_active ? "HIGH ALERT" : "CONTAINED";
  const overlayColor = briefing.is_override_active ? "text-red-300" : "text-sky-300";
  const description = buildBriefingDescription(briefing);
  const freeTierContent = getFreeTierContent(briefing.brief_content);

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${displayLabel} (${displayScore}) — ${displayDate}`,
    description,
    datePublished: briefing.generated_at,
    dateModified: briefing.generated_at,
    mainEntityOfPage: canonicalUrl,
    url: canonicalUrl,
    articleSection: "Daily Macro Briefing",
    author: { "@type": "Organization", name: SITE_NAME },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: appUrl,
      logo: { "@type": "ImageObject", url: `${appUrl}/icon.png` },
    },
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: appUrl,
    },
    about: {
      "@type": "FinancialProduct",
      name: "Macro Bias Daily Regime Score",
      description: `Quantitative macro regime score of ${displayScore} (${displayLabel}) computed across SPY, TLT, GLD, USO, and HYG for ${displayDate}.`,
      category: "Financial Analytics",
    },
    keywords: [
      "macro bias",
      "regime score",
      displayLabel.toLowerCase(),
      "day trading",
      "macro regime",
      briefing.briefing_date,
    ],
  };

  const breadcrumbData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: appUrl,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Briefings",
        item: `${appUrl}/briefings`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: displayDate,
        item: canonicalUrl,
      },
    ],
  };

  return (
    <main
      className={`${headingFont.variable} ${dataFont.variable} min-h-screen bg-zinc-950 font-[family:var(--font-heading)] text-zinc-100`}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbData) }}
      />

      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-8 sm:px-6 sm:py-10">
        {/* Header */}
        <header className="border border-white/10 bg-zinc-950">
          <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-8">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              [ Daily Algo Briefing ]
            </p>
            <div className="flex items-center gap-3 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.3em] text-zinc-500">
              <span>{displayDate}</span>
            </div>
          </div>

          <div className="space-y-6 px-5 py-8 sm:px-8 sm:py-10">
            <div className="space-y-2">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-600">
                [System Output] Algo Bias
              </p>
              <p className="font-[family:var(--font-heading)] text-4xl font-bold tracking-tight text-white sm:text-5xl">
                {displayLabel}{" "}
                <span className={`font-[family:var(--font-data)] ${scoreColor}`}>
                  ({displayScore})
                </span>
              </p>
            </div>

            <div className="space-y-1 border-t border-white/10 pt-4">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-600">
                [System Output] Overlay
              </p>
              <p className={`font-[family:var(--font-data)] text-xl font-bold tracking-wide ${overlayColor}`}>
                {overlayLabel}
              </p>
            </div>
          </div>
        </header>

        {/* Free-tier briefing preview */}
        <article className="mt-6 border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
          <div className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-600">
            [ Free Preview ]
          </div>

          <div className="mt-6 text-base leading-8 text-zinc-300">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <h2 className="mt-10 font-[family:var(--font-data)] text-[11px] font-bold uppercase tracking-[0.2em] text-sky-300">
                    {children}
                  </h2>
                ),
                h2: ({ children }) => (
                  <h2 className="mt-10 font-[family:var(--font-data)] text-[11px] font-bold uppercase tracking-[0.2em] text-sky-300">
                    {children}
                  </h2>
                ),
                p: ({ children }) => <p className="mt-4 text-zinc-300 first:mt-0">{children}</p>,
                ul: ({ children }) => (
                  <ul className="mt-4 list-disc space-y-3 pl-6 text-zinc-300">{children}</ul>
                ),
                li: ({ children }) => (
                  <li className="pl-2 marker:text-zinc-500">{children}</li>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-white">{children}</strong>
                ),
              }}
            >
              {freeTierContent}
            </ReactMarkdown>
          </div>
        </article>

        {/* Paywall / CTA */}
        <section className="mt-6 border border-sky-500/30 bg-gradient-to-br from-sky-500/10 via-zinc-950 to-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-sky-300">
            Premium Access Required
          </p>
          <h2 className="mt-4 font-[family:var(--font-heading)] text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Unlock the full briefing.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
            Get remaining sector scores, K-NN diagnostics, system risk protocol, and Live Terminal access.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              className="inline-flex items-center justify-center rounded-xl border border-sky-400/50 bg-gradient-to-r from-sky-500 to-sky-600 px-6 py-3 font-[family:var(--font-data)] text-xs font-bold uppercase tracking-[0.18em] text-white shadow-lg shadow-sky-500/20 transition hover:from-sky-400 hover:to-sky-500"
              href="/api/checkout?plan=monthly"
            >
              Start 7-Day Free Trial
            </Link>
            <Link
              className="inline-flex items-center justify-center border border-white/10 px-6 py-3 font-[family:var(--font-data)] text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition hover:bg-white/5"
              href="/emails"
            >
              Get Free Daily Emails
            </Link>
          </div>
        </section>

        {/* Archive link + nav */}
        <nav className="mt-8 flex items-center justify-between">
          <Link
            href="/briefings"
            className="font-[family:var(--font-data)] text-xs text-zinc-500 transition hover:text-zinc-300"
          >
            ← All Briefings
          </Link>
          <Link
            href="/"
            className="font-[family:var(--font-data)] text-xs text-zinc-500 transition hover:text-zinc-300"
          >
            macro-bias.com
          </Link>
        </nav>
      </div>
    </main>
  );
}
