import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

import {
  getTrackRecordData,
  type ScoreBucket,
} from "@/lib/track-record/track-record-data";
import { getBacktestData } from "@/lib/track-record/backtest-engine";
import {
  formatDisplayLabel,
  getRegimeAccentClass,
} from "@/lib/regime/regime-data";

/* ------------------------------------------------------------------ */
/*  Fonts                                                              */
/* ------------------------------------------------------------------ */

const headingFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

const dataFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-data",
});

/* ------------------------------------------------------------------ */
/*  SEO                                                                */
/* ------------------------------------------------------------------ */

const SITE_URL = "https://macro-bias.com";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Track Record — Live Algo Performance | Macro Bias",
  description:
    "Every session scored by the Macro Bias algo, published before the opening bell, recorded without edits. Directional hit rates, regime accuracy, full daily log, and model backtest since Jan 2026 — all verifiable against public SPY data.",
  alternates: {
    canonical: `${SITE_URL}/track-record`,
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/track-record`,
    siteName: "Macro Bias",
    title: "Track Record — Live Algo Performance | Macro Bias",
    description:
      "Verifiable algo performance: directional hit rates, regime accuracy, full session log, and model backtest since Jan 2026.",
  },
};

/* ------------------------------------------------------------------ */
/*  Format helpers                                                     */
/* ------------------------------------------------------------------ */

function fmtReturn(v: number | null): string {
  if (v === null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return `${Math.round(v)}%`;
}

function fmtScore(v: number): string {
  return v > 0 ? `+${v}` : `${v}`;
}

function fmtDate(s: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(s));
}

function fmtLongDate(s: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(s));
}

function returnColor(v: number | null): string {
  if (v === null) return "text-zinc-600";
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-red-400";
  return "text-zinc-400";
}

function getBarHex(label: string): string {
  switch (label) {
    case "EXTREME_RISK_ON":
      return "#6ee7b7";
    case "RISK_ON":
      return "#4ade80";
    case "NEUTRAL":
      return "#fbbf24";
    case "RISK_OFF":
      return "#fb923c";
    case "EXTREME_RISK_OFF":
      return "#f87171";
    default:
      return "#a1a1aa";
  }
}

function getDistBarClass(label: string): string {
  switch (label) {
    case "EXTREME_RISK_ON":
      return "bg-emerald-500";
    case "RISK_ON":
      return "bg-green-500";
    case "NEUTRAL":
      return "bg-amber-500";
    case "RISK_OFF":
      return "bg-orange-500";
    case "EXTREME_RISK_OFF":
      return "bg-red-500";
    default:
      return "bg-zinc-500";
  }
}

function getDistDotClass(label: string): string {
  switch (label) {
    case "EXTREME_RISK_ON":
      return "bg-emerald-400";
    case "RISK_ON":
      return "bg-green-400";
    case "NEUTRAL":
      return "bg-amber-400";
    case "RISK_OFF":
      return "bg-orange-400";
    case "EXTREME_RISK_OFF":
      return "bg-red-400";
    default:
      return "bg-zinc-400";
  }
}

/* ------------------------------------------------------------------ */
/*  Inline components                                                  */
/* ------------------------------------------------------------------ */

function ScoreBar({ score, label }: { score: number; label: string }) {
  const barPct = Math.abs(score) / 2; // -100→100 maps to 0-50%
  const color = getBarHex(label);
  const positive = score >= 0;

  return (
    <div className="relative h-3 w-24 shrink-0">
      <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-700/40" />
      {score !== 0 && (
        <div
          className="absolute top-0 bottom-0 rounded-[1px]"
          style={{
            backgroundColor: color,
            opacity: 0.7,
            ...(positive
              ? { left: "50%", width: `${barPct}%` }
              : { right: "50%", width: `${barPct}%` }),
          }}
        />
      )}
    </div>
  );
}

function CallBadge({ correct }: { correct: boolean | null }) {
  if (correct === true) {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 font-[family:var(--font-data)] text-[10px] font-bold text-emerald-400">
        ✓
      </span>
    );
  }
  if (correct === false) {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500/15 font-[family:var(--font-data)] text-[10px] font-bold text-red-400">
        ✗
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center font-[family:var(--font-data)] text-[10px] text-zinc-600">
      —
    </span>
  );
}

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="border border-white/10 bg-zinc-950 px-4 py-5">
      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.3em] text-zinc-500">
        {label}
      </p>
      <p
        className={`mt-2 font-[family:var(--font-data)] text-2xl font-bold tracking-tight ${accent ?? "text-white"}`}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-1 font-[family:var(--font-data)] text-[10px] text-zinc-600">
          {sub}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Gradient row for the score→return butterfly chart                   */
/* ------------------------------------------------------------------ */

function GradientRow({
  bucket,
  maxAbs,
}: {
  bucket: ScoreBucket;
  maxAbs: number;
}) {
  const ret = bucket.avgSameDayReturn;
  const barPct =
    ret !== null && maxAbs > 0 ? (Math.abs(ret) / maxAbs) * 42 : 0;

  return (
    <Fragment>
      {/* Score range label */}
      <span
        className={`font-[family:var(--font-data)] text-xs ${getRegimeAccentClass(bucket.biasLabel)}`}
      >
        {bucket.label}
      </span>

      {/* Butterfly bar */}
      <div className="relative h-5">
        <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-700/30" />
        {ret !== null && ret !== 0 && (
          <div
            className="absolute top-0.5 bottom-0.5 rounded-[2px]"
            style={{
              backgroundColor: ret > 0 ? "#34d399" : "#f87171",
              opacity: 0.55,
              ...(ret > 0
                ? { left: "50%", width: `${barPct}%` }
                : { right: "50%", width: `${barPct}%` }),
            }}
          />
        )}
      </div>

      {/* Return value */}
      <span
        className={`text-right font-[family:var(--font-data)] text-xs font-semibold ${returnColor(ret)}`}
      >
        {fmtReturn(ret)}
      </span>

      {/* Session count */}
      <span className="text-right font-[family:var(--font-data)] text-xs text-zinc-600">
        {bucket.count}
      </span>
    </Fragment>
  );
}

/* ================================================================== */
/*  PAGE                                                               */
/* ================================================================== */

export default async function TrackRecordPage() {
  const [data, backtest] = await Promise.all([
    getTrackRecordData(),
    getBacktestData(),
  ]);
  const hasData = data.totalDays > 0;
  const hasBacktest = backtest.totalDays > 0;

  const bullishCount = data.days.filter((d) => d.score > 0).length;
  const bearishCount = data.days.filter((d) => d.score < 0).length;

  const maxAbsReturn = Math.max(
    ...data.scoreBuckets.map((b) => Math.abs(b.avgSameDayReturn ?? 0)),
    0.01,
  );

  /* ---- Structured data ----------------------------------------- */

  const faqStructuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "How is the directional hit rate calculated?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The directional hit rate measures how often the algo's score direction matched SPY's same-day move. Positive scores (bullish) are correct when SPY closes up; negative scores (bearish) are correct when SPY closes down. Sessions with a score of exactly zero are excluded.",
        },
      },
      {
        "@type": "Question",
        name: "Is this track record based on live or backtested data?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Every score is from live production. Each score is computed before the opening bell using the previous session's closing prices and published to subscribers before market open. Scores cannot be altered after publication.",
        },
      },
      {
        "@type": "Question",
        name: "How often is the track record updated?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The track record updates daily before the US market open. A new session row is added for each trading day with the algo's score, regime classification, and the previous session's SPY result.",
        },
      },
      {
        "@type": "Question",
        name: "What does edge spread measure?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Edge spread is the difference between the average SPY return on bullish-scored days versus bearish-scored days. A positive edge spread means the algo's bullish calls coincide with higher SPY returns than its bearish calls — evidence of genuine directional discrimination.",
        },
      },
      {
        "@type": "Question",
        name: "Can I independently verify the track record?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes. Every session lists the exact trade date, SPY closing price, and percentage move. Cross-reference any row against public SPY historical price data from Yahoo Finance, Google Finance, or any market data provider.",
        },
      },
      {
        "@type": "Question",
        name: "How does the backtest work?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The backtest replays the exact same KNN algorithm, features, and parameters against every 2026 trading session. Each day's score uses only price data available before that session's open — no lookahead bias. The backtest shows what the model would have scored if it had been live since January 1, 2026.",
        },
      },
    ],
  };

  const breadcrumbData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Macro Bias",
        item: SITE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Track Record",
        item: `${SITE_URL}/track-record`,
      },
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbData) }}
      />

      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-8 sm:px-6 sm:py-10">
        {/* ============================================================ */}
        {/*  HEADER                                                      */}
        {/* ============================================================ */}
        <header className="border border-white/10 bg-zinc-950 px-5 py-10 sm:px-8 sm:py-12">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Track Record ]
          </p>
          <h1 className="mt-4 font-[family:var(--font-heading)] text-3xl font-bold tracking-[-0.04em] text-white sm:text-4xl">
            Algo Performance
          </h1>
          <p className="mt-1 font-[family:var(--font-heading)] text-lg tracking-tight text-zinc-500 sm:text-xl">
            Session by session. No edits. Backtest included.
          </p>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-zinc-400">
            Every score below was published to subscribers before the opening
            bell, computed from the prior session&rsquo;s close. Cross-reference
            any date against public SPY data.
          </p>

          {data.dateRange && (
            <div className="mt-6 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-white/5 pt-5">
              <span className="font-[family:var(--font-data)] text-xs text-zinc-500">
                {fmtLongDate(data.dateRange.from)} —{" "}
                {fmtLongDate(data.dateRange.to)}
              </span>
              <span className="font-[family:var(--font-data)] text-xs text-zinc-600">
                {data.totalDays} sessions · Model {data.latestModelVersion}
              </span>
            </div>
          )}

          {/* Regime distribution stacked bar */}
          {hasData && (
            <div className="mt-5">
              <div className="flex h-2.5 w-full overflow-hidden rounded-[2px]">
                {data.regimeDistribution
                  .filter((d) => d.count > 0)
                  .map((d) => (
                    <div
                      key={d.label}
                      className={`${getDistBarClass(d.label)} transition-all`}
                      style={{ width: `${d.pct}%` }}
                      title={`${formatDisplayLabel(d.label)}: ${Math.round(d.pct)}%`}
                    />
                  ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {data.regimeDistribution
                  .filter((d) => d.count > 0)
                  .map((d) => (
                    <span
                      key={d.label}
                      className="flex items-center gap-1.5 font-[family:var(--font-data)] text-[10px] text-zinc-500"
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${getDistDotClass(d.label)}`}
                      />
                      {formatDisplayLabel(d.label)} {Math.round(d.pct)}%
                    </span>
                  ))}
              </div>
            </div>
          )}
        </header>

        {/* ============================================================ */}
        {/*  KPI STRIP                                                   */}
        {/* ============================================================ */}
        {hasData && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            <KpiCard
              label="Sessions"
              value={data.totalDays.toString()}
              sub="scored & published"
            />
            <KpiCard
              label="Hit Rate"
              value={fmtPct(data.sameDayHitRate)}
              sub={`same-day direction (n=${data.daysWithResult})`}
              accent={
                data.sameDayHitRate !== null && data.sameDayHitRate >= 50
                  ? "text-emerald-400"
                  : "text-red-400"
              }
            />
            <KpiCard
              label="Bullish Avg"
              value={fmtReturn(data.avgReturnBullish)}
              sub={`avg SPY when score > 0 (n=${bullishCount})`}
              accent={returnColor(data.avgReturnBullish).replace("text-zinc-400", "text-white")}
            />
            <KpiCard
              label="Edge Spread"
              value={fmtReturn(data.edgeSpread)}
              sub={`bull avg − bear avg (n=${bullishCount + bearishCount})`}
              accent={
                data.edgeSpread !== null && data.edgeSpread > 0
                  ? "text-cyan-400"
                  : "text-zinc-400"
              }
            />
          </div>
        )}

        {/* ============================================================ */}
        {/*  SCORE → RETURN GRADIENT                                     */}
        {/* ============================================================ */}
        {hasData && (
          <section className="mt-4 border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              [ Score → Return Gradient ]
            </p>
            <p className="mt-3 max-w-xl text-sm leading-7 text-zinc-400">
              Does the model discriminate? Higher scores should produce higher
              returns. A monotonic gradient from bearish to bullish is the
              signature of a working model.
            </p>

            <div className="mt-6 grid grid-cols-[90px_1fr_60px_30px] items-center gap-x-3 gap-y-2 sm:grid-cols-[110px_1fr_70px_40px]">
              {/* Column headers */}
              <span className="font-[family:var(--font-data)] text-[9px] uppercase tracking-[0.3em] text-zinc-600">
                Score
              </span>
              <span className="text-center font-[family:var(--font-data)] text-[9px] uppercase tracking-[0.3em] text-zinc-600">
                &nbsp;
              </span>
              <span className="text-right font-[family:var(--font-data)] text-[9px] uppercase tracking-[0.3em] text-zinc-600">
                Avg Δ
              </span>
              <span className="text-right font-[family:var(--font-data)] text-[9px] uppercase tracking-[0.3em] text-zinc-600">
                n
              </span>

              {/* Divider */}
              <div className="col-span-4 h-px bg-white/5" />

              {/* Data rows */}
              {data.scoreBuckets.map((bucket) => (
                <GradientRow
                  key={bucket.label}
                  bucket={bucket}
                  maxAbs={maxAbsReturn}
                />
              ))}
            </div>

            {data.edgeSpread !== null && data.edgeSpread > 0 && (
              <p className="mt-5 border-t border-white/5 pt-4 font-[family:var(--font-data)] text-[10px] tracking-wide text-zinc-600">
                Positive edge spread ({fmtReturn(data.edgeSpread)}) confirms
                the gradient is directionally consistent.
              </p>
            )}
          </section>
        )}

        {/* ============================================================ */}
        {/*  REGIME ACCURACY                                             */}
        {/* ============================================================ */}
        {hasData && (
          <section className="mt-4 border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              [ Regime Accuracy ]
            </p>
            <p className="mt-3 max-w-xl text-sm leading-7 text-zinc-400">
              Same-day directional accuracy broken down by regime
              classification. Does the model call direction correctly across all
              five regimes?
            </p>

            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[480px]">
                <thead>
                  <tr>
                    <th className="pb-2 text-left font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                      Regime
                    </th>
                    <th className="pb-2 text-right font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                      Sessions
                    </th>
                    <th className="pb-2 text-right font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                      Hit Rate
                    </th>
                    <th className="pb-2 text-right font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                      Avg Session
                    </th>
                    <th className="pb-2 text-right font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                      Avg Fwd 1D
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.regimeHitRates.map((r) => (
                    <tr key={r.label}>
                      <td
                        className={`py-2.5 font-[family:var(--font-data)] text-xs font-medium ${getRegimeAccentClass(r.label)}`}
                      >
                        {r.displayName}
                      </td>
                      <td className="py-2.5 text-right font-[family:var(--font-data)] text-xs text-zinc-300">
                        {r.totalDays}
                      </td>
                      <td className="py-2.5 text-right font-[family:var(--font-data)] text-xs font-bold text-white">
                        {fmtPct(r.hitRate)}
                      </td>
                      <td
                        className={`py-2.5 text-right font-[family:var(--font-data)] text-xs ${returnColor(r.avgSameDayReturn)}`}
                      >
                        {fmtReturn(r.avgSameDayReturn)}
                      </td>
                      <td
                        className={`py-2.5 text-right font-[family:var(--font-data)] text-xs ${returnColor(r.avgForward1DReturn)}`}
                      >
                        {fmtReturn(r.avgForward1DReturn)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/*  DAILY SESSION LOG                                           */}
        {/* ============================================================ */}
        <section className="mt-4 border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Daily Session Log ]
          </p>
          <p className="mt-3 max-w-xl text-sm leading-7 text-zinc-400">
            {hasData
              ? "Full history, most recent first. Every score published before the opening bell."
              : "Track record builds with each trading session. First scores publish within 24 hours."}
          </p>

          {hasData && (
            <div className="-mx-5 mt-6 overflow-x-auto px-5 sm:-mx-8 sm:px-8">
              <table className="w-full min-w-[660px]">
                <thead>
                  <tr>
                    <th className="pb-2 text-left font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                      Date
                    </th>
                    <th className="pb-2 text-right font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                      Score
                    </th>
                    <th className="pb-2 font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                      &nbsp;
                    </th>
                    <th className="pb-2 text-left font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                      Regime
                    </th>
                    <th className="pb-2 text-right font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                      SPY Δ
                    </th>
                    <th className="pb-2 text-right font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                      Fwd 1D
                    </th>
                    <th className="pb-2 text-center font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                      Call
                    </th>
                    <th className="pb-2 text-center font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                      Ovr
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {data.days.map((day, idx) => (
                    <tr
                      key={day.tradeDate}
                      className={`transition-colors hover:bg-white/[0.02] ${day.isOverride ? "bg-amber-500/[0.04]" : ""}`}
                    >
                      <td className="py-2.5 font-[family:var(--font-data)] text-xs text-zinc-300">
                        {fmtDate(day.tradeDate)}
                      </td>
                      <td
                        className={`py-2.5 text-right font-[family:var(--font-data)] text-xs font-bold ${getRegimeAccentClass(day.biasLabel)}`}
                      >
                        {fmtScore(day.score)}
                      </td>
                      <td className="py-2.5 pl-2">
                        <ScoreBar
                          score={day.score}
                          label={day.biasLabel}
                        />
                      </td>
                      <td
                        className={`py-2.5 font-[family:var(--font-data)] text-[11px] ${getRegimeAccentClass(day.biasLabel)}`}
                      >
                        {formatDisplayLabel(day.biasLabel)}
                      </td>
                      <td
                        className={`py-2.5 text-right font-[family:var(--font-data)] text-xs ${returnColor(day.spyChangePercent)}`}
                      >
                        {fmtReturn(day.spyChangePercent)}
                      </td>
                      <td
                        className={`py-2.5 text-right font-[family:var(--font-data)] text-xs ${
                          day.spyForward1DReturn !== null
                            ? returnColor(day.spyForward1DReturn)
                            : "text-zinc-700"
                        }`}
                      >
                        {idx === 0 && day.spyForward1DReturn === null ? (
                          <span className="text-[10px] uppercase tracking-wider text-zinc-600">
                            pending
                          </span>
                        ) : (
                          fmtReturn(day.spyForward1DReturn)
                        )}
                      </td>
                      <td className="py-2.5 text-center">
                        <CallBadge correct={day.sameDayCorrect} />
                      </td>
                      <td className="py-2.5 text-center">
                        {day.isOverride ? (
                          <span
                            className="inline-flex h-5 items-center rounded-sm bg-amber-500/15 px-1.5 font-[family:var(--font-data)] text-[9px] font-bold uppercase tracking-wider text-amber-400"
                            title="Manual macro override was active"
                          >
                            OVR
                          </span>
                        ) : (
                          <span className="font-[family:var(--font-data)] text-[10px] text-zinc-700">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ============================================================ */}
        {/*  BACKTEST: MODEL SIMULATION                                  */}
        {/* ============================================================ */}
        {hasBacktest && (
          <section className="mt-4 border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.04] via-zinc-950 to-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
            <div className="flex items-center gap-3">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-violet-400/80">
                [ Model Backtest ]
              </p>
              <span className="rounded-sm bg-violet-500/15 px-2 py-0.5 font-[family:var(--font-data)] text-[9px] font-bold uppercase tracking-wider text-violet-400">
                Simulated
              </span>
            </div>
            <h2 className="mt-4 font-[family:var(--font-heading)] text-xl font-bold tracking-tight text-white sm:text-2xl">
              What if the model had been live since Jan 1?
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
              The exact same KNN algorithm, features, and parameters — replayed
              against every 2026 trading session using only data available at the
              time. No lookahead bias: each day&rsquo;s score uses only prior
              closes as the analog pool.
            </p>

            {backtest.dateRange && (
              <p className="mt-3 font-[family:var(--font-data)] text-xs text-zinc-600">
                {fmtLongDate(backtest.dateRange.from)} —{" "}
                {fmtLongDate(backtest.dateRange.to)} · {backtest.totalDays}{" "}
                sessions simulated
              </p>
            )}

            {/* Backtest KPIs */}
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              <KpiCard
                label="Sessions"
                value={backtest.totalDays.toString()}
                sub="simulated since Jan 1"
              />
              <KpiCard
                label="Hit Rate"
                value={fmtPct(backtest.sameDayHitRate)}
                sub="same-day directional"
                accent={
                  backtest.sameDayHitRate !== null &&
                  backtest.sameDayHitRate >= 50
                    ? "text-emerald-400"
                    : "text-red-400"
                }
              />
              <KpiCard
                label="Fwd 1D Hit"
                value={fmtPct(backtest.forward1DHitRate)}
                sub="next-day directional"
                accent={
                  backtest.forward1DHitRate !== null &&
                  backtest.forward1DHitRate >= 50
                    ? "text-emerald-400"
                    : "text-red-400"
                }
              />
              <KpiCard
                label="Edge Spread"
                value={fmtReturn(backtest.edgeSpread)}
                sub="bull avg − bear avg"
                accent={
                  backtest.edgeSpread !== null && backtest.edgeSpread > 0
                    ? "text-cyan-400"
                    : "text-zinc-400"
                }
              />
            </div>

            {/* Backtest regime distribution */}
            <div className="mt-5">
              <div className="flex h-2.5 w-full overflow-hidden rounded-[2px]">
                {backtest.regimeDistribution
                  .filter((d) => d.count > 0)
                  .map((d) => (
                    <div
                      key={d.label}
                      className={`${getDistBarClass(d.label)} transition-all`}
                      style={{ width: `${d.pct}%` }}
                      title={`${formatDisplayLabel(d.label)}: ${Math.round(d.pct)}%`}
                    />
                  ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {backtest.regimeDistribution
                  .filter((d) => d.count > 0)
                  .map((d) => (
                    <span
                      key={d.label}
                      className="flex items-center gap-1.5 font-[family:var(--font-data)] text-[10px] text-zinc-500"
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${getDistDotClass(d.label)}`}
                      />
                      {formatDisplayLabel(d.label)} {Math.round(d.pct)}%
                    </span>
                  ))}
              </div>
            </div>

            {/* Backtest session log (collapsible via details) */}
            <details className="mt-6 group">
              <summary className="cursor-pointer font-[family:var(--font-data)] text-xs font-bold uppercase tracking-[0.2em] text-zinc-400 transition hover:text-zinc-200">
                Show full backtest log ({backtest.totalDays} sessions)
              </summary>
              <div className="-mx-5 mt-4 overflow-x-auto px-5 sm:-mx-8 sm:px-8">
                <table className="w-full min-w-[560px]">
                  <thead>
                    <tr>
                      <th className="pb-2 text-left font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                        Date
                      </th>
                      <th className="pb-2 text-right font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                        Score
                      </th>
                      <th className="pb-2 font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                        &nbsp;
                      </th>
                      <th className="pb-2 text-left font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                        Regime
                      </th>
                      <th className="pb-2 text-right font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                        SPY Δ
                      </th>
                      <th className="pb-2 text-right font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                        Fwd 1D
                      </th>
                      <th className="pb-2 text-center font-[family:var(--font-data)] text-[9px] font-normal uppercase tracking-[0.3em] text-zinc-600">
                        Call
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {backtest.days.map((day, idx) => (
                      <tr
                        key={day.tradeDate}
                        className="transition-colors hover:bg-white/[0.02]"
                      >
                        <td className="py-2 font-[family:var(--font-data)] text-xs text-zinc-300">
                          {fmtDate(day.tradeDate)}
                        </td>
                        <td
                          className={`py-2 text-right font-[family:var(--font-data)] text-xs font-bold ${getRegimeAccentClass(day.biasLabel)}`}
                        >
                          {fmtScore(day.score)}
                        </td>
                        <td className="py-2 pl-2">
                          <ScoreBar score={day.score} label={day.biasLabel} />
                        </td>
                        <td
                          className={`py-2 font-[family:var(--font-data)] text-[11px] ${getRegimeAccentClass(day.biasLabel)}`}
                        >
                          {formatDisplayLabel(day.biasLabel)}
                        </td>
                        <td
                          className={`py-2 text-right font-[family:var(--font-data)] text-xs ${returnColor(day.spyChangePercent)}`}
                        >
                          {fmtReturn(day.spyChangePercent)}
                        </td>
                        <td
                          className={`py-2 text-right font-[family:var(--font-data)] text-xs ${
                            day.spyForward1DReturn !== null
                              ? returnColor(day.spyForward1DReturn)
                              : "text-zinc-700"
                          }`}
                        >
                          {idx === 0 && day.spyForward1DReturn === null ? (
                            <span className="text-[10px] uppercase tracking-wider text-zinc-600">
                              pending
                            </span>
                          ) : (
                            fmtReturn(day.spyForward1DReturn)
                          )}
                        </td>
                        <td className="py-2 text-center">
                          <CallBadge correct={day.sameDayCorrect} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            {/* Backtest caveat */}
            <p className="mt-6 border-t border-violet-500/10 pt-4 text-xs leading-6 text-zinc-500">
              <strong className="text-zinc-400">Caveat:</strong> This is a
              simulation, not live production data. The backtest uses the same
              model logic, parameters, and features as the live system. Each
              session score is computed using only data available before that
              session&rsquo;s open — no lookahead bias. However, backtested
              results may differ from live results due to data revisions,
              execution timing, and news-driven overrides that the model
              cannot anticipate.
            </p>
          </section>
        )}

        {/* ============================================================ */}
        {/*  DATA INTEGRITY                                              */}
        {/* ============================================================ */}
        <section className="mt-4 border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Data Integrity ]
          </p>

          <div className="mt-5 grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Live production scores
              </h3>
              <p className="mt-1.5 text-sm leading-7 text-zinc-400">
                Every row on this page is a live production score. No backtests.
                No paper trading. No retroactive edits. The score is computed
                from prior-session close data and published before market open.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                Independently verifiable
              </h3>
              <p className="mt-1.5 text-sm leading-7 text-zinc-400">
                Each session cites the trade date and SPY closing price.
                Cross-reference against Yahoo Finance, Google Finance, or any
                public historical data feed.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                Sample size caveat
              </h3>
              <p className="mt-1.5 text-sm leading-7 text-zinc-400">
                Statistical confidence scales with sample size. Early-stage
                results should be interpreted as directionally informative, not
                statistically conclusive. This page updates daily as the
                track record deepens.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                Not financial advice
              </h3>
              <p className="mt-1.5 text-sm leading-7 text-zinc-400">
                Past performance does not guarantee future results. The Macro
                Bias algo is a decision-support tool, not a trading signal
                service. Always apply your own risk management.
              </p>
            </div>
          </div>

          {/* Model metadata */}
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/5 pt-5">
            <span className="font-[family:var(--font-data)] text-[10px] text-zinc-600">
              Model: {data.latestModelVersion}
            </span>
            <span className="font-[family:var(--font-data)] text-[10px] text-zinc-600">
              Overrides: {data.overrideCount}
            </span>
            <span className="font-[family:var(--font-data)] text-[10px] text-zinc-600">
              Updated daily before the opening bell
            </span>
          </div>
        </section>

        {/* ============================================================ */}
        {/*  CTA                                                         */}
        {/* ============================================================ */}
        <section className="mt-4 border border-sky-500/30 bg-gradient-to-br from-sky-500/10 via-zinc-950 to-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
          <h2 className="font-[family:var(--font-heading)] text-2xl font-semibold tracking-tight text-white">
            See tomorrow&rsquo;s score before the bell.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
            Free subscribers get the daily regime score. Premium subscribers get
            the full briefing with K-NN diagnostics, sector scoring, and system
            risk protocol.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Link
              className="inline-flex items-center justify-center border border-white/20 bg-white/5 px-6 py-3 font-[family:var(--font-data)] text-xs font-bold uppercase tracking-[0.14em] text-white transition hover:bg-white/10"
              href="/emails"
            >
              Subscribe Free
            </Link>
            <Link
              className="inline-flex items-center justify-center rounded-xl border border-sky-400/50 bg-gradient-to-r from-sky-500 to-sky-600 px-6 py-3 font-[family:var(--font-data)] text-xs font-bold uppercase tracking-[0.14em] text-white shadow-lg shadow-sky-500/20 transition hover:from-sky-400 hover:to-sky-500"
              href="/api/checkout?plan=monthly"
            >
              Start 7-Day Free Trial
            </Link>
          </div>
        </section>

        {/* ============================================================ */}
        {/*  FAQ                                                         */}
        {/* ============================================================ */}
        <section className="mt-4 border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ FAQ ]
          </p>
          <div className="mt-6 divide-y divide-white/5">
            <div className="py-5 first:pt-0">
              <h3 className="text-sm font-semibold text-white">
                How is the directional hit rate calculated?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                A positive score (bullish) is &ldquo;correct&rdquo; if SPY
                closed higher that session. A negative score (bearish) is
                correct if SPY closed lower. Sessions with a perfect-zero score
                are excluded. The hit rate is correct calls / total non-neutral
                sessions.
              </p>
            </div>
            <div className="py-5">
              <h3 className="text-sm font-semibold text-white">
                Is this backtested or live?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                The &ldquo;Live Sessions&rdquo; section is live production data.
                The &ldquo;Model Backtest&rdquo; section replays the exact same
                algo against 2026 trading sessions using only prior data — no
                lookahead. Both are transparent and verifiable.
              </p>
            </div>
            <div className="py-5">
              <h3 className="text-sm font-semibold text-white">
                What does edge spread measure?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                Edge spread is the average SPY return on bullish-scored days
                minus the average SPY return on bearish-scored days. A positive
                spread means the model&rsquo;s bullish calls coincide with
                better outcomes than its bearish calls — the core evidence of
                directional skill.
              </p>
            </div>
            <div className="py-5">
              <h3 className="text-sm font-semibold text-white">
                Can I verify these results independently?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                Yes. Each row shows the trade date, SPY closing price, and
                session return. Pull the same dates from Yahoo Finance, Google
                Finance, or any public data provider. The numbers should match.
              </p>
            </div>
            <div className="py-5">
              <h3 className="text-sm font-semibold text-white">
                What does the override column mean?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                Some sessions are marked &ldquo;OVR&rdquo; — a manual macro
                override was active. These are days where news-driven events
                (tariffs, Fed announcements, geopolitical shifts) caused the
                team to flag the model output. The override is noted for
                transparency but the recorded score is the algo&rsquo;s
                original output.
              </p>
            </div>
            <div className="py-5 last:pb-0">
              <h3 className="text-sm font-semibold text-white">
                Why is the sample size small?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                The algo launched recently. The track record grows by one session
                every trading day. Early results are directionally informative
                but not statistically conclusive. Bookmark this page and revisit
                as the sample deepens.
              </p>
            </div>
          </div>
        </section>

        {/* ============================================================ */}
        {/*  NAV                                                         */}
        {/* ============================================================ */}
        <nav className="mt-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-4">
            <Link
              href="/regime"
              className="font-[family:var(--font-data)] text-xs text-zinc-500 transition hover:text-zinc-300"
            >
              Regime Guide →
            </Link>
            <Link
              href="/briefings"
              className="font-[family:var(--font-data)] text-xs text-zinc-500 transition hover:text-zinc-300"
            >
              Briefing Archive →
            </Link>
            <Link
              href="/pricing"
              className="font-[family:var(--font-data)] text-xs text-zinc-500 transition hover:text-zinc-300"
            >
              Pricing →
            </Link>
          </div>
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
