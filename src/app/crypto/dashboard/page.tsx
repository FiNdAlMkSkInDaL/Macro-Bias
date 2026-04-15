import { unstable_noStore as noStore } from "next/cache";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AssetToggle } from "@/components/AssetToggle";
import type {
  BiasLabel,
  CryptoBiasScoreRow,
  CryptoBiasComponentResult,
} from "@/lib/crypto-bias/types";

export const dynamic = "force-dynamic";

function formatSignedScore(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}

function formatDisplayLabel(label: string) {
  return label.replace(/_/g, " ");
}

function formatShortDate(dateString: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
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

function getGaugeRotation(score: number): number {
  return (score / 100) * 90;
}

async function getLatestCryptoSnapshot(): Promise<CryptoBiasScoreRow | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("crypto_bias_scores")
      .select(
        "id, trade_date, score, bias_label, component_scores, ticker_changes, engine_inputs, technical_indicators, created_at, updated_at",
      )
      .order("trade_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return null;
    return data as CryptoBiasScoreRow | null;
  } catch {
    return null;
  }
}

export default async function CryptoDashboardPage() {
  noStore();

  const snapshot = await getLatestCryptoSnapshot();

  if (!snapshot) {
    return (
      <main className="min-h-screen font-[family:var(--font-heading)]">
        <div className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 text-center">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Crypto Dashboard ]
          </p>
          <h1 className="mt-6 text-3xl font-bold text-white">No Data Yet</h1>
          <p className="mt-3 text-sm text-zinc-400">
            Crypto scores will appear after the first daily sync.
          </p>
        </div>
      </main>
    );
  }

  const componentScores = snapshot.component_scores ?? [];
  const tickerChanges = snapshot.ticker_changes ?? {};

  return (
    <main className="min-h-screen font-[family:var(--font-heading)]">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Header */}
        <header className="border border-white/10 bg-zinc-950 px-5 py-10 sm:px-8 sm:py-12">
          <div className="flex items-center justify-between">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              [ Crypto Dashboard ]
            </p>
            <AssetToggle />
          </div>
          <h1 className="mt-4 font-[family:var(--font-heading)] text-4xl font-bold tracking-[-0.06em] text-white sm:text-5xl">
            Crypto Bias
          </h1>
          <p className="mt-2 font-[family:var(--font-data)] text-xs text-zinc-500">
            {formatShortDate(snapshot.trade_date)}
          </p>
        </header>

        {/* Gauge section */}
        <section className="mt-6 border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8">
          <div className="flex flex-col items-center">
            <div className="relative h-40 w-72">
              <svg viewBox="0 0 200 110" className="h-full w-full">
                {/* Background arc */}
                <path
                  d="M 10 100 A 90 90 0 0 1 190 100"
                  fill="none"
                  stroke="rgb(39 39 42)"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                {/* Score arc */}
                <path
                  d="M 10 100 A 90 90 0 0 1 190 100"
                  fill="none"
                  stroke={
                    snapshot.score > 20
                      ? "#4ade80"
                      : snapshot.score < -20
                        ? "#fb923c"
                        : "#fbbf24"
                  }
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${((snapshot.score + 100) / 200) * 283} 283`}
                />
                {/* Needle */}
                <line
                  x1="100"
                  y1="100"
                  x2="100"
                  y2="20"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  transform={`rotate(${getGaugeRotation(snapshot.score)} 100 100)`}
                />
                <circle cx="100" cy="100" r="4" fill="white" />
              </svg>
            </div>

            <p
              className={`mt-4 font-[family:var(--font-data)] text-4xl font-bold ${getScoreColor(snapshot.bias_label)}`}
            >
              {formatSignedScore(snapshot.score)}
            </p>
            <p className="mt-1 font-[family:var(--font-data)] text-sm uppercase tracking-widest text-zinc-400">
              {formatDisplayLabel(snapshot.bias_label)}
            </p>
          </div>
        </section>

        {/* Ticker changes */}
        {Object.keys(tickerChanges).length > 0 && (
          <section className="mt-6 border border-white/10 bg-zinc-950">
            <div className="border-b border-white/10 px-5 py-4">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                Ticker Moves
              </p>
            </div>
            <div className="divide-y divide-white/5">
              {Object.entries(tickerChanges).map(([ticker, snap]) => {
                if (!snap) return null;
                const pctClass =
                  snap.percentChange > 0
                    ? "text-green-400"
                    : snap.percentChange < 0
                      ? "text-red-400"
                      : "text-zinc-400";
                return (
                  <div
                    key={ticker}
                    className="flex items-center justify-between px-5 py-3"
                  >
                    <span className="font-[family:var(--font-data)] text-sm font-bold text-white">
                      {ticker}
                    </span>
                    <div className="flex items-center gap-4">
                      <span className="font-[family:var(--font-data)] text-xs text-zinc-400">
                        ${snap.close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <span className={`font-[family:var(--font-data)] text-xs font-bold ${pctClass}`}>
                        {snap.percentChange > 0 ? "+" : ""}
                        {snap.percentChange.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Component scores */}
        {componentScores.length > 0 && (
          <section className="mt-6 border border-white/10 bg-zinc-950">
            <div className="border-b border-white/10 px-5 py-4">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                Signal Breakdown
              </p>
            </div>
            <div className="divide-y divide-white/5">
              {componentScores.map((c: CryptoBiasComponentResult) => {
                const signalClass =
                  c.signal > 0.15
                    ? "text-green-400"
                    : c.signal < -0.15
                      ? "text-orange-400"
                      : "text-zinc-400";
                return (
                  <div key={c.key} className="px-5 py-4">
                    <div className="flex items-center justify-between">
                      <span className="font-[family:var(--font-data)] text-xs uppercase tracking-widest text-zinc-500">
                        {c.pillar ?? c.key}
                      </span>
                      <span className={`font-[family:var(--font-data)] text-sm font-bold ${signalClass}`}>
                        {c.signal > 0 ? "+" : ""}
                        {c.signal.toFixed(2)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-zinc-400">
                      {c.summary}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
