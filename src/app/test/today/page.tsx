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
      title: 'Press when the tape confirms.',
      body: 'The setup is aligned enough that the score can lead the read this morning.',
    };
  }

  if (status === 'pattern_shaky') {
    return {
      title: 'Stay selective. Do not force it.',
      body: 'The setup is mixed enough that price still needs to prove the read before you size up.',
    };
  }

  return {
    title: 'Stand down on index conviction.',
    body: 'Fresh headlines are strong enough that the score is background, not signal, this morning.',
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

function getAvoidLabel(status: ReturnType<typeof buildPromotedTrustCheck>['status']) {
  if (status === 'pattern_intact') {
    return 'Big mistake';
  }

  return 'Avoid';
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

function formatFactorLabel(label: string) {
  switch (label) {
    case 'Analog agreement':
      return 'Historical agreement';
    case 'Regime stability':
      return 'Setup stability';
    case 'News disruption':
      return 'Headline risk';
    default:
      return label;
  }
}

function formatExpressionLabel(label: string | null) {
  if (!label) {
    return null;
  }

  switch (label) {
    case 'Safety Demand':
      return 'Defensives over equities';
    case 'Growth Leadership':
      return 'Growth over the broad tape';
    case 'Defensive Leadership':
      return 'Defensives over the broad tape';
    case 'Duration Versus Equities':
      return 'Duration over equities';
    case 'Credit Over Duration':
      return 'Credit over duration';
    case 'Energy Impulse':
      return 'Energy over the broad tape';
    case 'Cyclical Commodity Bid':
      return 'Cyclicals over safety';
    default:
      return label;
  }
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

function getWhyNowSummary(input: {
  newsPatternValidity: 'intact' | 'shaky' | 'broken';
  analogConsensus: string | undefined;
  status: ReturnType<typeof buildPromotedTrustCheck>['status'];
}) {
  if (input.newsPatternValidity === 'broken') {
    return 'Fresh headlines';
  }

  if (input.newsPatternValidity === 'shaky') {
    return 'Mixed backdrop';
  }

  if (input.status === 'pattern_intact') {
    return 'Aligned analogs';
  }

  if (input.analogConsensus && input.analogConsensus !== 'n/a') {
    return `Analogs ${input.analogConsensus}`;
  }

  return 'Mixed setup';
}

function getMeaningHeadline(status: ReturnType<typeof buildPromotedTrustCheck>['status']) {
  if (status === 'pattern_intact') {
    return 'Lean on the read';
  }

  if (status === 'pattern_shaky') {
    return 'Keep size and conviction measured';
  }

  return 'Keep the score in the background';
}

function getActionLabel(status: ReturnType<typeof buildPromotedTrustCheck>['status']) {
  if (status === 'pattern_intact') {
    return 'Press';
  }

  if (status === 'pattern_shaky') {
    return 'Stay selective';
  }

  return 'Stand down';
}

function getAtAGlanceSummary(input: {
  score: number;
  regimeLabel: string;
  status: ReturnType<typeof buildPromotedTrustCheck>['status'];
  whyNowSummary: string;
}) {
  const scoreText = `${formatScore(input.score)} ${input.regimeLabel.toLowerCase()}`;

  if (input.status === 'pattern_intact') {
    return `${scoreText} score. The setup is aligned, so the read is usable this morning.`;
  }

  if (input.status === 'pattern_shaky') {
    return `${scoreText} score. The setup is mixed, so keep size down until price confirms the read.`;
  }

  return `${scoreText} score. The driver is ${input.whyNowSummary.toLowerCase()}, so the read should stay in the background for now.`;
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
  const whyNowSummary = getWhyNowSummary({
    newsPatternValidity: cockpit.news.patternValidity,
    analogConsensus: underTheHoodFactors[0]?.value,
    status: trustCheck.status,
  });
  const atAGlanceSummary = getAtAGlanceSummary({
    score,
    regimeLabel: regime.label,
    status: trustCheck.status,
    whyNowSummary,
  });

  return (
    <main className="min-h-screen font-sans font-[family:var(--font-heading)]">
      <div className="mx-auto w-full max-w-7xl px-3 sm:px-4 md:px-6 lg:px-8">
        <header className="border-b border-white/5 py-4">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Morning Read Terminal ]
          </p>
          <h1 className="mt-3 max-w-3xl text-balance text-3xl font-semibold tracking-tighter text-white md:text-4xl">
            {hero.title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{hero.body}</p>
        </header>

        <section className="grid grid-cols-1 gap-4 py-4 md:gap-6 md:py-6 lg:grid-cols-2">
          <section className={`${moduleClassName} lg:col-span-2 ${tone.module}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
                  At a glance
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-white md:text-2xl">
                  {getMeaningHeadline(trustCheck.status)}
                </h2>
              </div>
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                {morningDate} / Data as of {formatShortDate(trustCheck.asOf)}
              </p>
            </div>

            <div className={`mt-5 grid grid-cols-1 gap-0 ${terminalDividerClassName} pt-5 md:grid-cols-4`}>
              {[
                ['Score', `${formatScore(score)} ${regime.label}`],
                ['Trust', formatStatus(trustCheck.status)],
                ['Why', whyNowSummary],
                ['Action', getActionLabel(trustCheck.status)],
              ].map(([label, value], index) => (
                <div
                  key={label}
                  className={`py-3 md:px-4 ${index > 0 ? 'md:border-l md:border-white/5' : ''}`}
                >
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                    {label}
                  </p>
                  <p className={`mt-2 text-lg font-semibold tracking-tight ${label === 'Trust' ? tone.accent : 'text-white'}`}>
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <div className={`${terminalDividerClassName} mt-2 pt-4`}>
              <div className="grid gap-3 lg:grid-cols-[0.18fr_1fr]">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                  What&apos;s happening
                </p>
                <div>
                  <p className="text-[15px] leading-7 text-white sm:text-base">{atAGlanceSummary}</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">{trustCheck.reason}</p>
                </div>
              </div>
            </div>

            <div className={`mt-5 grid grid-cols-1 gap-3 ${terminalDividerClassName} pt-4 sm:grid-cols-3`}>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                  Strongest
                </p>
                <p className="mt-2 text-sm font-medium text-white">{strongestMove?.ticker ?? '--'}</p>
                <p className="mt-1 font-[family:var(--font-data)] text-sm text-zinc-300">
                  {formatMove(strongestMove?.percentChange)}
                </p>
              </div>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                  Weakest
                </p>
                <p className="mt-2 text-sm font-medium text-white">{weakestMove?.ticker ?? '--'}</p>
                <p className="mt-1 font-[family:var(--font-data)] text-sm text-zinc-300">
                  {formatMove(weakestMove?.percentChange)}
                </p>
              </div>
              <div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                  Best read
                </p>
                <p className="mt-2 text-sm font-medium text-white">
                  {bestExpression ? formatExpressionLabel(bestExpression.label) : 'Stay selective'}
                </p>
              </div>
            </div>
          </section>

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
                        Premarket map
                      </h3>
                    </div>
                    <p className="max-w-md text-sm leading-6 text-zinc-500">
                      What kind of day this is and what to do with that information.
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
                      [getAvoidLabel(trustCheck.status), getMistakeCopy(trustCheck.status)],
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
                        Why this matters
                      </p>
                      <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">
                        The edge is not trading the wrong market
                      </h3>
                    </div>
                    <p className="max-w-md text-sm leading-6 text-zinc-500">
                      Absorb the day type fast, then stop forcing the wrong trades.
                    </p>
                  </div>

                  <div className="mt-4 space-y-4 text-sm leading-7 text-zinc-300">
                    <p>
                      This page is useful because it tells you what kind of market you are walking
                      into before the open and whether the score deserves trust.
                    </p>
                    {bestExpression ? (
                      <p>
                        Today the cleanest expression is{' '}
                        <span className="font-medium text-white">{formatExpressionLabel(bestExpression.label)}</span>, not
                        broad index conviction.
                      </p>
                    ) : null}
                    <p>
                      That means fewer forced trades, less confusion in the first hour, and a faster
                      read on whether today is a day to press or a day to back off.
                    </p>
                  </div>
                </section>
              </div>

              <section className={moduleClassName}>
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                      Why we&apos;re saying that
                    </p>
                    <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">
                      The evidence behind the call
                    </h3>
                  </div>
                </div>

                <div className="mt-4 space-y-0">
                  {underTheHoodFactors.map((factor) => (
                    <article
                      key={factor.label}
                      className={`${terminalDividerClassName} py-4 first:border-t-0 first:pt-0 last:pb-0`}
                    >
                      <div className="grid gap-3 md:grid-cols-[0.34fr_0.14fr_1fr]">
                        <p className="text-sm font-medium text-white">{formatFactorLabel(factor.label)}</p>
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
