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

const terminalBorderClassName = 'border border-white/5';
const terminalDividerClassName = 'border-t border-white/5';
const moduleClassName = `${terminalBorderClassName} min-w-0 p-4 sm:p-5 md:p-6`;

function formatScore(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}

function formatConfidence(value: number | null) {
  return value == null ? 'Pending' : `${value}/100`;
}

function formatTradeDate(dateStr: string | null) {
  if (!dateStr) {
    return 'Pending';
  }

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateStr}T12:00:00Z`));
}

function formatShortDate(dateStr: string | null) {
  if (!dateStr) {
    return 'Pending';
  }

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateStr}T12:00:00Z`));
}

function formatStatus(status: ReturnType<typeof buildPromotedTrustCheck>['status']) {
  if (status === 'pattern_intact') {
    return 'Pattern Intact';
  }

  if (status === 'pattern_shaky') {
    return 'Pattern Shaky';
  }

  return 'Pattern Broken';
}

function getStatusTone(status: ReturnType<typeof buildPromotedTrustCheck>['status']) {
  if (status === 'pattern_broken') {
    return {
      accent: 'text-rose-300',
      pill: 'border-rose-400/20 bg-rose-400/[0.08] text-rose-200',
      module: 'border-rose-400/15 bg-rose-400/[0.04]',
    };
  }

  return {
    accent: 'text-white',
    pill: 'border-white/10 bg-white/[0.03] text-zinc-200',
    module: '',
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
      body: 'This is the kind of session where the model should help frame the day instead of sitting quietly in the background.',
    };
  }

  if (status === 'pattern_shaky') {
    return {
      title: 'Use the score, but make it earn it.',
      body: 'There is information in the read, but not enough to lean hard on it before the tape confirms the setup.',
    };
  }

  return {
    title: "Don't trust the score yet.",
    body: 'Something in the current setup is strong enough that the usual historical pattern should not be treated as signal on its own.',
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

function getBreadthSummary(
  tickerMoves: Array<{ percentChange: number }> | null | undefined,
) {
  if (!tickerMoves || tickerMoves.length === 0) {
    return 'Pending';
  }

  const advancing = tickerMoves.filter((move) => move.percentChange > 0).length;
  return `${advancing}/${tickerMoves.length} advancing`;
}

function getTopMove(
  tickerMoves: Array<{ ticker: string; percentChange: number }> | null | undefined,
  direction: 'strongest' | 'weakest',
) {
  if (!tickerMoves || tickerMoves.length === 0) {
    return null;
  }

  const sorted = [...tickerMoves].sort((left, right) => left.percentChange - right.percentChange);
  return direction === 'strongest' ? sorted.at(-1) ?? null : sorted[0] ?? null;
}

function formatMove(value: number | null | undefined) {
  if (value == null) {
    return 'Pending';
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
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
  const tone = getStatusTone(trustCheck.status);
  const bestExpression = cockpit.crossSectional?.leadingLenses[0] ?? null;
  const underTheHoodFactors = trustCheck.factors.slice(0, 3);
  const breadthSummary = getBreadthSummary(cockpit.bias?.tickerMoves ?? null);
  const strongestMove = getTopMove(cockpit.bias?.tickerMoves ?? null, 'strongest');
  const weakestMove = getTopMove(cockpit.bias?.tickerMoves ?? null, 'weakest');
  const morningDate = formatTradeDate(trustCheck.asOf);

  return (
    <main className="min-h-screen font-sans font-[family:var(--font-heading)]">
      <div className="mx-auto w-full max-w-7xl px-3 sm:px-4 md:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/5 py-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              [ Morning Read Terminal ]
            </p>
            <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tighter text-white md:text-4xl">
              {hero.title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{hero.body}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:gap-6">
            <div>
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                Date
              </p>
              <p className="mt-2 text-base font-semibold tracking-tight text-white">{morningDate}</p>
              <p className="mt-1 font-[family:var(--font-data)] text-[10px] text-zinc-500">
                Data as of: {formatShortDate(trustCheck.asOf)}
              </p>
            </div>
            <div>
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                Score
              </p>
              <p className="mt-2 text-base font-semibold tracking-tight text-white">
                {formatScore(score)} {regime.label}
              </p>
            </div>
            <div>
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                Trust
              </p>
              <p className={`mt-2 text-base font-semibold tracking-tight ${tone.accent}`}>
                {formatStatus(trustCheck.status)}
              </p>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 py-4 md:gap-6 md:py-6 lg:grid-cols-2">
          <div className="min-w-0 grid grid-cols-1 gap-4 md:gap-6 lg:col-span-2 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
            <section className={moduleClassName}>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)]">
                <div>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
                    Today&apos;s Score
                  </p>
                  <p className="mt-4 font-[family:var(--font-data)] text-7xl font-semibold leading-none text-white">
                    {formatScore(score)}
                  </p>
                  <p className="mt-3 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-300">
                    {regime.label}
                  </p>
                </div>
                <div>
                  <p className="text-sm leading-6 text-zinc-400">{regime.summary}</p>
                  <div className={`mt-6 ${terminalDividerClassName} pt-4`}>
                    <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                      Trust Check
                    </p>
                    <p className={`mt-2 text-2xl font-semibold ${tone.accent}`}>{formatStatus(trustCheck.status)}</p>
                    <p className="mt-1 font-[family:var(--font-data)] text-sm text-zinc-300">
                      Confidence {formatConfidence(trustCheck.confidenceScore)}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className={`${moduleClassName} ${tone.module}`}>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
                  Morning Call
                </p>
                <h2 className={`mt-3 text-2xl font-semibold tracking-tight ${tone.accent}`}>
                  {formatStatus(trustCheck.status)}
                </h2>
                <p className="mt-3 text-sm leading-6 text-zinc-300">{trustCheck.summary}</p>
                <p className="mt-3 text-sm leading-6 text-zinc-400">{trustCheck.reason}</p>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className={`${terminalDividerClassName} pt-3`}>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                    Strongest
                  </p>
                  <p className="mt-2 text-sm font-medium text-white">{strongestMove?.ticker ?? '--'}</p>
                  <p className="mt-1 font-[family:var(--font-data)] text-sm text-zinc-300">
                    {formatMove(strongestMove?.percentChange)}
                  </p>
                </div>

                <div className={`${terminalDividerClassName} pt-3`}>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                    Weakest
                  </p>
                  <p className="mt-2 text-sm font-medium text-white">{weakestMove?.ticker ?? '--'}</p>
                  <p className="mt-1 font-[family:var(--font-data)] text-sm text-zinc-300">
                    {formatMove(weakestMove?.percentChange)}
                  </p>
                </div>

                <div className={`${terminalDividerClassName} pt-3`}>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                    Breadth
                  </p>
                  <p className="mt-2 text-sm font-medium text-white">{breadthSummary}</p>
                  <p className="mt-1 font-[family:var(--font-data)] text-sm text-zinc-400">
                    Core basket
                  </p>
                </div>
              </div>
            </section>
          </div>

          <div className="min-w-0 lg:col-span-2">
            <div className="space-y-4 md:space-y-6">
              <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
                <section className={`${moduleClassName} h-full`}>
                  <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                        Read This In 20 Seconds
                      </p>
                      <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">
                        Session framing
                      </h3>
                    </div>
                    <p className="max-w-md text-sm leading-6 text-zinc-500">
                      The fastest useful read before the open.
                    </p>
                  </div>

                  <div className="mt-4 space-y-0">
                    {[
                      ['Base case', getBaseCaseCopy({ regimeSummary: regime.summary, score, status: trustCheck.status })],
                      ['Best area', getBestAreaCopy({
                        bestExpressionLabel: bestExpression?.label ?? null,
                        bestExpressionSummary: bestExpression?.summary ?? null,
                        status: trustCheck.status,
                      })],
                      ['Big mistake', getMistakeCopy(trustCheck.status)],
                      [getReversalLabel(trustCheck.status), getReversalCopy(trustCheck.status)],
                    ].map(([label, copy]) => (
                      <article
                        key={label}
                        className={`${terminalDividerClassName} py-4 first:border-t-0 first:pt-0 last:pb-0`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="sm:min-w-[9rem]">
                            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                              {label}
                            </p>
                          </div>
                          <p className="max-w-[52ch] text-[15px] leading-[1.75] text-white sm:text-base">
                            {copy}
                          </p>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                <section className={`${moduleClassName} h-full`}>
                  <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                        Bottom Line
                      </p>
                      <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">
                        Where the edge is
                      </h3>
                    </div>
                    <p className="max-w-md text-sm leading-6 text-zinc-500">
                      The deeper layer, after the first glance.
                    </p>
                  </div>

                  <div className="mt-4 space-y-4 text-sm leading-7 text-zinc-300">
                    <p>{trustCheck.summary}</p>
                    {bestExpression ? (
                      <p>
                        The cleanest expression underneath the hood is{' '}
                        <span className="font-medium text-white">{bestExpression.label}</span>, which
                        has been the strongest relative pocket inside this regime.
                      </p>
                    ) : null}
                    <p>
                      If the market starts settling and the tape stops fighting the setup, this read
                      can regain weight quickly. If it does not, keep the score in the background.
                    </p>
                  </div>
                </section>
              </div>

              <section className={moduleClassName}>
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                      Under The Hood
                    </p>
                    <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">
                      Why the trust read looks like this
                    </h3>
                  </div>
                  <p className="max-w-md text-sm leading-6 text-zinc-500">
                    Supporting diagnostics, kept out of the way until you want them.
                  </p>
                </div>

                <div className="mt-4 space-y-0">
                  {underTheHoodFactors.map((factor) => (
                    <article
                      key={factor.label}
                      className={`${terminalDividerClassName} py-4 first:border-t-0 first:pt-0 last:pb-0`}
                    >
                      <div className="grid gap-3 md:grid-cols-[0.34fr_0.14fr_1fr]">
                        <p className="text-sm font-medium text-white">{factor.label}</p>
                        <p className="font-[family:var(--font-data)] text-sm text-zinc-300">{factor.value}</p>
                        <p className="text-sm leading-7 text-zinc-400">{factor.summary}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
