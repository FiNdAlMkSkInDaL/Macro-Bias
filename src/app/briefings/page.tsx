import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

import { getAllBriefingDates } from "@/lib/briefing/get-public-briefing";
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

const SITE_URL = "https://macro-bias.com";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Daily Briefing Archive | Macro Bias",
  description:
    "Browse the complete archive of daily macro regime briefings from the Macro Bias algo. Free previews of every session's score, overlay status, and sector playbook.",
  alternates: {
    canonical: `${SITE_URL}/briefings`,
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/briefings`,
    siteName: "Macro Bias",
    title: "Daily Briefing Archive | Macro Bias",
    description:
      "Browse the complete archive of daily macro regime briefings from the Macro Bias algo.",
  },
};

function formatDisplayLabel(label: string) {
  return label.replace(/_/g, " ");
}

function formatSignedScore(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}

function formatShortDate(dateString: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(dateString));
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

export default async function BriefingsArchivePage() {
  const briefings = await getAllBriefingDates();
  const appUrl = getAppUrl().replace(/\/$/, "");

  const faqStructuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What is the Macro Bias score?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The Macro Bias score is a daily quantitative regime signal ranging from -100 to +100 that measures the net directional pressure across SPY, TLT, GLD, USO, and HYG. Positive scores indicate risk-on conditions; negative scores signal risk-off.",
        },
      },
      {
        "@type": "Question",
        name: "How often is the Macro Bias briefing updated?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The briefing updates every trading day. The algo recalculates after market data is available and publishes a fresh regime score, sector playbook, and K-NN diagnostics each session.",
        },
      },
      {
        "@type": "Question",
        name: "What does Risk On vs Risk Off mean for day traders?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Risk On means institutional capital is flowing into equities, credit, and commodities — continuation setups tend to work. Risk Off means capital is moving to bonds and gold — defensive postures and mean-reversion setups are favored.",
        },
      },
      {
        "@type": "Question",
        name: "What markets does the Macro Bias model track?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The model tracks five core ETFs: SPY (equities), TLT (bonds), GLD (gold), USO (oil), and HYG (high-yield credit). It also integrates VIX volatility and technical indicators like RSI, MACD, and moving average crossovers.",
        },
      },
      {
        "@type": "Question",
        name: "Is the Macro Bias briefing free?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Each daily briefing includes a free preview with the regime score and top-line alpha protocol. The full briefing with sector scoring, K-NN diagnostics, and system risk protocol requires a premium subscription at $19/month.",
        },
      },
    ],
  };

  const collectionStructuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Daily Briefing Archive",
    description:
      "Complete archive of daily macro regime briefings from the Macro Bias algo.",
    url: `${appUrl}/briefings`,
    isPartOf: {
      "@type": "WebSite",
      name: "Macro Bias",
      url: appUrl,
    },
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionStructuredData) }}
      />
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-8 sm:px-6 sm:py-10">
        <header className="border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Briefing Archive ]
          </p>
          <h1 className="mt-4 font-[family:var(--font-heading)] text-4xl font-semibold tracking-[-0.06em] text-white sm:text-5xl">
            Daily Macro Briefings
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
            Every session the algo scores the macro regime across equity, credit, volatility, commodities, and rates. Browse the archive below.
          </p>
        </header>

        <div className="mt-6 divide-y divide-white/10 border border-white/10 bg-zinc-950">
          {briefings.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-zinc-500 sm:px-8">
              No briefings published yet. Check back after the next trading session.
            </div>
          )}

          {briefings.map((b) => (
            <Link
              key={b.briefing_date}
              href={`/briefings/${b.briefing_date}`}
              className="flex items-center justify-between px-5 py-4 transition hover:bg-white/[0.03] sm:px-8"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                <span className="font-[family:var(--font-data)] text-xs text-zinc-400">
                  {formatShortDate(b.briefing_date)}
                </span>
                <span className="text-sm font-medium text-white">
                  {formatDisplayLabel(b.bias_label)}
                </span>
              </div>
              <span
                className={`font-[family:var(--font-data)] text-sm font-bold ${getScoreColor(b.bias_label)}`}
              >
                {formatSignedScore(b.quant_score)}
              </span>
            </Link>
          ))}
        </div>

        <nav className="mt-8 flex items-center justify-between">
          <Link
            href="/emails"
            className="font-[family:var(--font-data)] text-xs text-zinc-500 transition hover:text-zinc-300"
          >
            Get Free Daily Emails →
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
