import type { Metadata } from 'next';

import { getLatestBiasSnapshot } from '@/lib/market-data/get-latest-bias-snapshot';
import { requireTestLabAccess } from '@/lib/test-lab/access';
import { getLiveVsHistoryCockpitData } from '@/lib/test-lab/live-vs-history';
import { buildPromotedTrustCheck } from '@/lib/test-lab/trust-check';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Morning Read Preview | Macro Bias Test Lab',
  robots: {
    index: false,
    follow: false,
  },
};

function formatScore(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}

function formatConfidence(value: number | null) {
  return value == null ? 'n/a' : `${value}/100`;
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

function formatStatus(status: ReturnType<typeof buildPromotedTrustCheck>['status']) {
  if (status === 'pattern_intact') {
    return 'Pattern intact';
  }

  if (status === 'pattern_shaky') {
    return 'Pattern shaky';
  }

  return 'Pattern broken';
}

function getStatusClasses(status: ReturnType<typeof buildPromotedTrustCheck>['status']) {
  if (status === 'pattern_intact') {
    return {
      accent: 'text-emerald-300',
      border: 'border-emerald-400/20',
      wash: 'bg-emerald-400/[0.05]',
    };
  }

  if (status === 'pattern_shaky') {
    return {
      accent: 'text-amber-300',
      border: 'border-amber-400/20',
      wash: 'bg-amber-400/[0.05]',
    };
  }

  return {
    accent: 'text-rose-300',
    border: 'border-rose-400/20',
    wash: 'bg-rose-400/[0.06]',
  };
}

function getRegimeDisplay(score: number) {
  if (score >= 60) {
    return {
      label: 'Extreme Risk-On',
      summary: 'Broad risk appetite is showing up cleanly across the cross-asset basket.',
    };
  }

  if (score > 20) {
    return {
      label: 'Risk-On',
      summary: 'The model leans constructive and the tape should favor offense over defense.',
    };
  }

  if (score >= -20) {
    return {
      label: 'Neutral',
      summary: 'Mixed cross-asset signals. This is where trust matters more than the raw number.',
    };
  }

  if (score > -60) {
    return {
      label: 'Risk-Off',
      summary: 'Defensive behavior is overtaking risk appetite across the basket.',
    };
  }

  return {
    label: 'Extreme Risk-Off',
    summary: 'Broad liquidation conditions. Safety is leading and offense is failing.',
  };
}

function getHeroCopy(status: ReturnType<typeof buildPromotedTrustCheck>['status']) {
  if (status === 'pattern_intact') {
    return {
      title: 'The score deserves weight today.',
      dek: 'This is the kind of session where the model should help frame the day instead of sitting quietly in the background.',
    };
  }

  if (status === 'pattern_shaky') {
    return {
      title: 'Use the score, but make it earn it.',
      dek: 'There is information in the read, but not enough to lean hard on it before the tape confirms the setup.',
    };
  }

  return {
    title: "Don't trust the score yet.",
    dek: 'Something in the current setup is strong enough that the usual historical pattern should not be treated as signal on its own.',
  };
}

function getBaseCaseCopy(input: {
  regimeSummary: string;
  score: number;
  status: ReturnType<typeof buildPromotedTrustCheck>['status'];
}) {
  const scoreText = `${formatScore(input.score)} ${getRegimeDisplay(input.score).label.toLowerCase()}`;

  if (input.status === 'pattern_broken') {
    return `The score reads ${scoreText}, but treat that as background only. ${input.regimeSummary}`;
  }

  if (input.status === 'pattern_shaky') {
    return `The score reads ${scoreText}. Respect the read, but wait for price action to prove it before sizing up.`;
  }

  return `The score reads ${scoreText}. ${input.regimeSummary}`;
}

function getBestAreaCopy(input: {
  bestExpressionLabel: string | null;
  bestExpressionSummary: string | null;
  status: ReturnType<typeof buildPromotedTrustCheck>['status'];
}) {
  if (input.bestExpressionLabel && input.bestExpressionSummary) {
    return `${input.bestExpressionLabel} is the cleanest place to express the read right now. ${input.bestExpressionSummary}`;
  }

  if (input.status === 'pattern_broken') {
    return 'Stay stock-specific and keep conviction low until the broader tape stops getting pushed around.';
  }

  return 'Stay with the cleanest expressions of the read instead of forcing broad index conviction too early.';
}

function getMistakeCopy(status: ReturnType<typeof buildPromotedTrustCheck>['status']) {
  if (status === 'pattern_intact') {
    return 'Ignoring the read because the open feels noisy. On a good day, the model matters more than the first few minutes do.';
  }

  if (status === 'pattern_shaky') {
    return 'Getting too big too early and treating a mixed setup like a clean trend day.';
  }

  return 'Trading the index like today is clean and directional when the setup is still being rewritten in real time.';
}

function getReversalLabel(status: ReturnType<typeof buildPromotedTrustCheck>['status']) {
  if (status === 'pattern_intact') {
    return 'What breaks this';
  }

  if (status === 'pattern_shaky') {
    return 'What firms this up';
  }

  return 'What fixes this';
}

function getReversalCopy(status: ReturnType<typeof buildPromotedTrustCheck>['status']) {
  if (status === 'pattern_intact') {
    return 'A fresh macro shock or collapsing participation would be enough to knock the read off course.';
  }

  if (status === 'pattern_shaky') {
    return 'The read gets stronger if participation broadens and the market stops fighting the analog set.';
  }

  return 'The read improves only when the market stops reacting to every fresh headline and leadership starts to settle into something coherent.';
}

export default async function TestTodayPreviewPage() {
  await requireTestLabAccess();

  const [cockpit, latestSnapshot] = await Promise.all([
    getLiveVsHistoryCockpitData(),
    getLatestBiasSnapshot(),
  ]);

  const trustCheck = buildPromotedTrustCheck(cockpit);
  const score = latestSnapshot?.score ?? cockpit.bias?.score ?? 0;
  const regime = getRegimeDisplay(score);
  const hero = getHeroCopy(trustCheck.status);
  const statusStyles = getStatusClasses(trustCheck.status);
  const bestExpression = cockpit.crossSectional?.leadingLenses[0] ?? null;
  const underTheHoodFactors = trustCheck.factors.slice(0, 3);

  return (
    <article className="mx-auto max-w-5xl">
      <header className="max-w-4xl border-b border-white/10 pb-10">
        <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
          Morning read · {formatTradeDate(trustCheck.asOf)}
        </p>
        <h1 className="mt-6 max-w-3xl font-[family:var(--font-heading)] text-5xl font-semibold tracking-tight text-white sm:text-7xl">
          {hero.title}
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-9 text-zinc-200">{hero.dek}</p>
        <p className="mt-4 max-w-3xl text-base leading-8 text-zinc-400">{trustCheck.reason}</p>
      </header>

      <section className="mt-12 grid gap-14 lg:grid-cols-[0.72fr_1.28fr]">
        <aside className="space-y-10 lg:pr-8">
          <div className="border-l border-white/10 pl-6">
            <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
              Today&apos;s score
            </p>
            <p className="mt-5 font-[family:var(--font-data)] text-7xl font-semibold leading-none text-white">
              {formatScore(score)}
            </p>
            <p className="mt-3 font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.36em] text-zinc-300">
              {regime.label}
            </p>
            <p className="mt-5 text-sm leading-7 text-zinc-400">{regime.summary}</p>
          </div>

          <div className={`border-l ${statusStyles.border} ${statusStyles.wash} pl-6 py-1`}>
            <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
              Trust check
            </p>
            <p className={`mt-4 text-2xl font-semibold ${statusStyles.accent}`}>
              {formatStatus(trustCheck.status)}
            </p>
            <p className="mt-3 font-[family:var(--font-data)] text-sm text-zinc-300">
              Confidence {formatConfidence(trustCheck.confidenceScore)}
            </p>
          </div>
        </aside>

        <section>
          <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.34em] text-amber-300">
            Read this in 20 seconds
          </p>
          <div className="mt-6 divide-y divide-white/10 border-y border-white/10">
            <div className="grid gap-4 py-6 md:grid-cols-[0.24fr_1fr]">
              <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.32em] text-zinc-500">
                Base case
              </p>
              <p className="text-lg leading-8 text-zinc-100">
                {getBaseCaseCopy({
                  regimeSummary: regime.summary,
                  score,
                  status: trustCheck.status,
                })}
              </p>
            </div>

            <div className="grid gap-4 py-6 md:grid-cols-[0.24fr_1fr]">
              <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.32em] text-zinc-500">
                Best area
              </p>
              <p className="text-lg leading-8 text-zinc-100">
                {getBestAreaCopy({
                  bestExpressionLabel: bestExpression?.label ?? null,
                  bestExpressionSummary: bestExpression?.summary ?? null,
                  status: trustCheck.status,
                })}
              </p>
            </div>

            <div className="grid gap-4 py-6 md:grid-cols-[0.24fr_1fr]">
              <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.32em] text-zinc-500">
                Big mistake
              </p>
              <p className="text-lg leading-8 text-zinc-100">{getMistakeCopy(trustCheck.status)}</p>
            </div>

            <div className="grid gap-4 py-6 md:grid-cols-[0.24fr_1fr]">
              <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.32em] text-zinc-500">
                {getReversalLabel(trustCheck.status)}
              </p>
              <p className="text-lg leading-8 text-zinc-100">{getReversalCopy(trustCheck.status)}</p>
            </div>
          </div>
        </section>
      </section>

      <section className="mt-16 grid gap-14 border-t border-white/10 pt-10 lg:grid-cols-[1.08fr_0.92fr]">
        <div>
          <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
            Bottom line
          </p>
          <div className="mt-5 max-w-3xl space-y-5 text-base leading-8 text-zinc-300">
            <p>{trustCheck.summary}</p>
            {bestExpression ? (
              <p>
                The cleanest expression underneath the hood is{' '}
                <span className="font-semibold text-white">{bestExpression.label}</span>, which has
                been the strongest relative pocket inside this regime.
              </p>
            ) : null}
            <p>
              If the market starts settling and the tape stops fighting the setup, this read can
              regain weight quickly. If it does not, keep the score in the background.
            </p>
          </div>
        </div>

        <div>
          <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
            Under the hood
          </p>
          <div className="mt-5 divide-y divide-white/10 border-y border-white/10">
            {underTheHoodFactors.map((factor) => (
              <div key={factor.label} className="grid gap-3 py-5 md:grid-cols-[0.42fr_0.18fr_1fr]">
                <p className="text-sm font-medium text-white">{factor.label}</p>
                <p className="font-[family:var(--font-data)] text-sm text-zinc-300">{factor.value}</p>
                <p className="text-sm leading-7 text-zinc-400">{factor.summary}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </article>
  );
}
