import type { Metadata } from 'next';
import Link from 'next/link';

import { getLatestBiasSnapshot } from '@/lib/market-data/get-latest-bias-snapshot';
import { requireTestLabAccess } from '@/lib/test-lab/access';
import { getLiveVsHistoryCockpitData } from '@/lib/test-lab/live-vs-history';
import { buildPromotedTrustCheck } from '@/lib/test-lab/trust-check';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Test Today Preview | Macro Bias Research Lab',
  robots: {
    index: false,
    follow: false,
  },
};

function formatScore(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}

function formatTradeDate(dateStr: string | null) {
  if (!dateStr) {
    return 'Latest available session';
  }

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(dateStr));
}

function getRegimeDisplay(score: number) {
  if (score >= 60) {
    return {
      regime: 'Extreme Risk-On',
      color: 'text-emerald-300',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
      summary: 'Strong cross-asset confirmation. The tape is broadly supportive of risk.',
    };
  }

  if (score > 20) {
    return {
      regime: 'Risk-On',
      color: 'text-emerald-300',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
      summary: 'The score leans constructive, with risk assets generally in better shape.',
    };
  }

  if (score >= -20) {
    return {
      regime: 'Neutral',
      color: 'text-zinc-200',
      bg: 'bg-zinc-500/10',
      border: 'border-zinc-500/30',
      summary: 'Mixed cross-asset signals. This is where trust matters more than the raw score.',
    };
  }

  if (score > -60) {
    return {
      regime: 'Risk-Off',
      color: 'text-rose-300',
      bg: 'bg-rose-500/10',
      border: 'border-rose-500/30',
      summary: 'Defensive rotation is taking over and broad risk appetite is fading.',
    };
  }

  return {
    regime: 'Extreme Risk-Off',
    color: 'text-rose-300',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    summary: 'Broad liquidation conditions. Safety is dominating offense.',
  };
}

function getTrustStyles(status: ReturnType<typeof buildPromotedTrustCheck>['status']) {
  if (status === 'pattern_intact') {
    return {
      badge: 'PATTERN INTACT',
      badgeClass: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
      cardClass: 'border-emerald-500/25 bg-emerald-500/[0.06]',
    };
  }

  if (status === 'pattern_shaky') {
    return {
      badge: 'PATTERN SHAKY',
      badgeClass: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
      cardClass: 'border-amber-500/25 bg-amber-500/[0.06]',
    };
  }

  return {
    badge: 'PATTERN BROKEN',
    badgeClass: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
    cardClass: 'border-rose-500/25 bg-rose-500/[0.06]',
  };
}

function getFactorToneClasses(tone: ReturnType<typeof buildPromotedTrustCheck>['factors'][number]['tone']) {
  if (tone === 'positive') {
    return 'text-emerald-300';
  }

  if (tone === 'warning') {
    return 'text-amber-300';
  }

  return 'text-rose-300';
}

export default async function TestTodayPreviewPage() {
  await requireTestLabAccess();

  const [cockpit, latestSnapshot] = await Promise.all([
    getLiveVsHistoryCockpitData(),
    getLatestBiasSnapshot(),
  ]);

  const trustCheck = buildPromotedTrustCheck(cockpit);
  const score = latestSnapshot?.score ?? cockpit.bias?.score ?? 0;
  const regimeDisplay = getRegimeDisplay(score);
  const trustStyles = getTrustStyles(trustCheck.status);

  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <nav className="mb-8 text-xs text-zinc-500" aria-label="Breadcrumb">
        <Link href="/test" className="transition-colors hover:text-zinc-300">
          Test Lab
        </Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-400">Today Preview</span>
      </nav>

      <header className="border-b border-white/10 pb-8">
        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-amber-300">
          Promotion Candidate
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          /today Trust Check Preview
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
          This page shows the first serious live candidate exactly the way we would want to ship it:
          one clean trust read, one short reason, and a small amount of supporting context.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/test/live-vs-history"
            className="inline-flex items-center rounded-md bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-zinc-200"
          >
            Open Daily Cockpit
          </Link>
          <Link
            href="/test/confidence"
            className="inline-flex items-center rounded-md border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-white/[0.06] hover:text-white"
          >
            Inspect Confidence Module
          </Link>
        </div>
      </header>

      <section className="mt-10 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <div className={`rounded-2xl border ${regimeDisplay.border} ${regimeDisplay.bg} p-6`}>
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.38em] text-zinc-500">
            Today&apos;s Score
          </p>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className={`font-[family:var(--font-data)] text-5xl font-semibold leading-none sm:text-6xl ${regimeDisplay.color}`}>
                {formatScore(score)}
              </p>
              <p className={`mt-2 font-[family:var(--font-data)] text-xs uppercase tracking-[0.34em] ${regimeDisplay.color}`}>
                {regimeDisplay.regime}
              </p>
            </div>
            <p className="max-w-sm text-sm leading-6 text-zinc-300">{regimeDisplay.summary}</p>
          </div>
          <p className="mt-5 text-xs text-zinc-500">{formatTradeDate(trustCheck.asOf)}</p>
        </div>

        <div className={`rounded-2xl border ${trustStyles.cardClass} p-6`}>
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.38em] text-zinc-500">
            Trust Check
          </p>
          <div className="mt-4 flex items-center justify-between gap-4">
            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] ${trustStyles.badgeClass}`}>
              {trustStyles.badge}
            </span>
            <span className="font-[family:var(--font-data)] text-sm text-zinc-300">
              Confidence {trustCheck.confidenceScore ?? 'n/a'}
            </span>
          </div>
          <h2 className="mt-5 text-2xl font-semibold text-white">{trustCheck.headline}</h2>
          <p className="mt-3 text-sm leading-7 text-zinc-200">{trustCheck.summary}</p>
          <p className="mt-3 text-sm leading-7 text-zinc-400">{trustCheck.reason}</p>
        </div>
      </section>

      <section className="mt-10 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.38em] text-zinc-500">
            Why This Works For Live
          </p>
          <div className="mt-4 space-y-4 text-sm leading-7 text-zinc-300">
            <p>It answers the real question users have after seeing the score: should I actually trust this read today?</p>
            <p>It compresses the research lab into one calm decision layer instead of forcing users to read a full internal cockpit.</p>
            <p>It preserves the clean dashboard feel because the output is simple even though the logic underneath is richer.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.38em] text-zinc-500">
            Candidate Placement
          </p>
          <div className="mt-4 space-y-3 text-sm leading-7 text-zinc-300">
            <p>1. Directly beside the score on <span className="font-[family:var(--font-data)] text-white">/today</span></p>
            <p>2. As the `Trust Check` block in the daily email</p>
            <p>3. At the top of paid briefings before the deeper context</p>
          </div>
        </div>
      </section>

      <section className="mt-10 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.38em] text-zinc-500">
          Supporting Factors
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {trustCheck.factors.map((factor) => (
            <div key={factor.label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-medium text-white">{factor.label}</p>
                <span className={`font-[family:var(--font-data)] text-sm ${getFactorToneClasses(factor.tone)}`}>
                  {factor.value}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-zinc-400">{factor.summary}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
