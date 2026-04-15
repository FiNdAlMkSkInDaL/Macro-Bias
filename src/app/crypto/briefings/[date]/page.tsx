import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CRYPTO_BRIEFING_SECTION_HEADERS } from "@/lib/crypto-briefing/crypto-briefing-config";

const SITE_URL = "https://macro-bias.com";

type CryptoBriefingDetail = {
  id: string;
  trade_date: string;
  score: number;
  bias_label: string;
  brief_content: string;
  is_override_active: boolean;
  model_version: string | null;
  created_at: string;
};

type PageProps = {
  params: Promise<{ date: string }>;
};

async function getCryptoBriefing(tradeDate: string): Promise<CryptoBriefingDetail | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("crypto_daily_briefings")
      .select("id, trade_date, score, bias_label, brief_content, is_override_active, model_version, created_at")
      .eq("trade_date", tradeDate)
      .limit(1)
      .maybeSingle();

    if (error) return null;
    return data as CryptoBriefingDetail | null;
  } catch {
    return null;
  }
}

function getCryptoFreeTierContent(briefContent: string): string {
  const bottomLineHeader = CRYPTO_BRIEFING_SECTION_HEADERS.bottomLine;
  const marketBreakdownHeader = CRYPTO_BRIEFING_SECTION_HEADERS.marketBreakdown;

  const sections = briefContent.split(/\n/).reduce<{ current: string | null; map: Map<string, string[]> }>(
    (acc, line) => {
      const trimmed = line.trim();
      const headerMatch = [bottomLineHeader, marketBreakdownHeader].find(
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

  const breakdown = sections.map.get(marketBreakdownHeader);
  if (breakdown) {
    const lines = breakdown.join("\n").trim().split("\n");
    const bulletLines = lines.filter((l) => l.trim().startsWith("-"));
    if (bulletLines.length > 1) {
      parts.push(
        `${marketBreakdownHeader}:\n${bulletLines[0]}\n- 🔒 **[LOCKED]**: Upgrade to view full market breakdown, risk check, and model notes.`,
      );
    } else {
      parts.push(`${marketBreakdownHeader}:\n${lines.join("\n")}`);
    }
  }

  return parts.join("\n\n");
}

function formatSignedScore(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}

function formatDisplayDate(dateString: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(dateString + "T00:00:00Z"));
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date } = await params;
  return {
    title: `Crypto Briefing — ${date} | Macro Bias`,
    description: `Daily crypto regime briefing for ${date} from the Macro Bias crypto model.`,
    alternates: {
      canonical: `${SITE_URL}/crypto/briefings/${date}`,
    },
  };
}

export default async function CryptoBriefingDatePage({ params }: PageProps) {
  const { date } = await params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    notFound();
  }

  const briefing = await getCryptoBriefing(date);

  if (!briefing) {
    notFound();
  }

  const freeTierContent = getCryptoFreeTierContent(briefing.brief_content);

  return (
    <main className="min-h-screen font-[family:var(--font-heading)]">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="border border-white/10 bg-zinc-950 px-5 py-10 sm:px-8 sm:py-12">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Crypto Briefing ]
          </p>
          <h1 className="mt-4 font-[family:var(--font-heading)] text-3xl font-bold tracking-[-0.04em] text-white sm:text-4xl">
            {formatDisplayDate(briefing.trade_date)}
          </h1>
          <div className="mt-4 flex items-center gap-4">
            <span
              className={`font-[family:var(--font-data)] text-xl font-bold ${getScoreColor(briefing.bias_label)}`}
            >
              {formatSignedScore(briefing.score)}
            </span>
            <span className="font-[family:var(--font-data)] text-sm uppercase tracking-widest text-zinc-400">
              {briefing.bias_label.replace(/_/g, " ")}
            </span>
            {briefing.is_override_active && (
              <span className="rounded bg-orange-500/20 px-2 py-0.5 font-[family:var(--font-data)] text-[10px] uppercase tracking-wider text-orange-400">
                Override Active
              </span>
            )}
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
            Unlock the full crypto briefing.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
            Get the full market breakdown, risk check, model notes, and Live Terminal access for the crypto regime model.
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
      </div>
    </main>
  );
}

