import { redirect } from 'next/navigation';

import { BiasGauge } from '@/components/dashboard/BiasGauge';
import { tapeLineForScore } from '@/components/dashboard/gauge-copy';
import { StormFrontsCard } from '@/components/dashboard/StormFrontsCard';
import { HeroSignupForm } from '@/components/product/HeroSignupForm';
import { LockedBriefing } from '@/components/product/LockedBriefing';
import { ScoreStrip, scoreMoveLine } from '@/components/product/ScoreStrip';
import { continuationFromSearchParams, firstSearchParam } from '@/lib/auth/continuation';
import { formatBiasLabel, formatScore, formatTradeDate } from '@/lib/public-proof/format';
import { loadLatestRegimeRead, loadStoredStockScores } from '@/lib/public-proof/load-public-proof';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type HomePageProps = {
  searchParams: Promise<{
    authError?: string | string[];
    checkout?: string | string[];
    coupon?: string | string[];
    plan?: string | string[];
    redirectTo?: string | string[];
  }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const continuation = continuationFromSearchParams(params);
  const authError = firstSearchParam(params.authError);
  const checkout = firstSearchParam(params.checkout);

  if (continuation && !authError) {
    let signedIn = false;

    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getUser();
      signedIn = Boolean(data.user);
    } catch {
      signedIn = false;
    }

    if (signedIn) {
      redirect(continuation);
    }
  }

  if (continuation || authError) {
    const loginParams = new URLSearchParams();

    if (continuation) {
      loginParams.set('redirectTo', continuation);
    }

    if (authError) {
      loginParams.set('authError', authError);
    }

    redirect(`/login?${loginParams.toString()}`);
  }

  const [regime, history] = await Promise.all([loadLatestRegimeRead(), loadStoredStockScores()]);
  const latestScore = regime.value;
  const storedScores = history.value ?? [];
  const todayRow = latestScore
    ? storedScores.find((row) => row.tradeDate === latestScore.tradeDate) ?? null
    : null;
  const todayIndex = todayRow ? storedScores.findIndex((row) => row.tradeDate === todayRow.tradeDate) : -1;
  const priorRow = todayIndex >= 0 ? storedScores[todayIndex + 1] ?? null : null;
  const stripMarks = storedScores.slice(0, 20).slice().reverse();

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:px-8">
      {checkout === 'success' ? (
        <p className="mb-8 border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          Stripe accepted the subscription. Today&apos;s score shows once the webhook grants access. Refresh if it is still the previous session.
        </p>
      ) : null}
      {checkout === 'active' ? (
        <p className="mb-8 border border-white/10 px-4 py-3 text-sm text-zinc-300">
          This account already has an active subscription.
        </p>
      ) : null}
      <section aria-labelledby="hero-heading">
        <p className="text-sm text-zinc-500">Trade with the weather. Not against it.</p>
        {latestScore ? (
          <>
            <h1 id="hero-heading" className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <span className="font-[family:var(--font-data)] text-6xl font-semibold leading-none tracking-tight text-white sm:text-7xl">
                {formatScore(Math.round(latestScore.score))}
              </span>
              <span className="font-[family:var(--font-data)] text-sm uppercase tracking-[0.32em] text-zinc-300">
                {formatBiasLabel(latestScore.biasLabel)}
              </span>
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-300">{tapeLineForScore(latestScore.score)}</p>
            <div className="mt-8 max-w-3xl">
              <BiasGauge animate biasScore={latestScore.score} showRead={false} />
              <ScoreStrip marks={stripMarks} today={latestScore.tradeDate} />
              {priorRow && todayRow ? (
                <p className="mt-3 text-sm text-zinc-300" title={`${formatTradeDate(priorRow.tradeDate)} to ${formatTradeDate(todayRow.tradeDate)}`}>
                  {scoreMoveLine(priorRow, todayRow)}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <h1 id="hero-heading" className="mt-4 text-2xl font-semibold tracking-tight text-white">
            No score is stored for this session.
          </h1>
        )}
        {history.error && stripMarks.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-400">{history.error}</p>
        ) : null}
        <div className="mt-8">
          <StormFrontsCard
            assets={latestScore?.assets ?? []}
            biasLabel={latestScore?.biasLabel}
            biasScore={latestScore?.score ?? 0}
            hasScore={Boolean(latestScore)}
            note={regime.error}
          />
          <LockedBriefing />
        </div>
        <HeroSignupForm />
      </section>
    </main>
  );
}
