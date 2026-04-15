import type { Metadata } from "next";
import Link from "next/link";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AssetToggle } from "@/components/AssetToggle";

const SITE_URL = "https://macro-bias.com";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Crypto Briefing Archive | Macro Bias",
  description:
    "Browse the archive of daily crypto regime briefings from the Macro Bias crypto model.",
  alternates: {
    canonical: `${SITE_URL}/crypto/briefings`,
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/crypto/briefings`,
    siteName: "Macro Bias",
    title: "Crypto Briefing Archive | Macro Bias",
    description:
      "Browse the archive of daily crypto regime briefings.",
  },
};

type CryptoBriefingRow = {
  id: string;
  trade_date: string;
  score: number;
  bias_label: string;
  is_override_active: boolean;
};

function formatShortDate(dateString: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(dateString + "T00:00:00Z"));
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

async function getAllCryptoBriefingDates(): Promise<CryptoBriefingRow[]> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("crypto_daily_briefings")
      .select("id, trade_date, score, bias_label, is_override_active")
      .order("trade_date", { ascending: false })
      .limit(365);

    if (error) return [];
    return (data as CryptoBriefingRow[] | null) ?? [];
  } catch {
    return [];
  }
}

export default async function CryptoBriefingsPage() {
  const briefings = await getAllCryptoBriefingDates();

  return (
    <main className="min-h-screen font-[family:var(--font-heading)]">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="border border-white/10 bg-zinc-950 px-5 py-10 sm:px-8 sm:py-12">
          <div className="flex items-center justify-between">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              [ Crypto Briefings ]
            </p>
            <AssetToggle />
          </div>
          <h1 className="mt-4 font-[family:var(--font-heading)] text-4xl font-bold tracking-[-0.06em] text-white sm:text-5xl">
            Crypto Briefing Archive
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-8 text-zinc-400">
            Every day the crypto model publishes a regime score and an
            AI-generated market briefing. Browse the full archive below.
          </p>
        </header>

        {briefings.length > 0 ? (
          <section className="mt-6 border border-white/10 bg-zinc-950">
            <div className="divide-y divide-white/5">
              {briefings.map((b) => (
                <Link
                  key={b.trade_date}
                  href={`/crypto/briefings/${b.trade_date}`}
                  className="flex items-center justify-between px-5 py-4 transition hover:bg-white/[0.02]"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-[family:var(--font-data)] text-xs text-zinc-400">
                      {formatShortDate(b.trade_date)}
                    </span>
                    {b.is_override_active && (
                      <span className="rounded bg-orange-500/20 px-1.5 py-0.5 font-[family:var(--font-data)] text-[9px] uppercase tracking-wider text-orange-400">
                        Override
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-[family:var(--font-data)] text-[10px] uppercase tracking-widest text-zinc-600">
                      {b.bias_label.replace(/_/g, " ")}
                    </span>
                    <span
                      className={`font-[family:var(--font-data)] text-sm font-bold ${getScoreColor(b.bias_label)}`}
                    >
                      {formatSignedScore(b.score)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : (
          <div className="mt-12 text-center">
            <p className="text-sm text-zinc-500">
              No crypto briefings yet. They will appear after the first publish
              cron runs.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
