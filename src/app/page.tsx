import { redirect } from 'next/navigation';

import { BiasGauge } from '@/components/dashboard/BiasGauge';
import { StormFrontsCard } from '@/components/dashboard/StormFrontsCard';
import { HeroSignupForm } from '@/components/product/HeroSignupForm';
import { LockedBriefing } from '@/components/product/LockedBriefing';
import { ScoreStrip } from '@/components/product/ScoreStrip';
import { StockCandles } from '@/components/product/StockCandles';
import { continuationFromSearchParams, firstSearchParam } from '@/lib/auth/continuation';
import { loadLatestRegimeRead, loadStoredSpyCandles, loadStoredStockScores } from '@/lib/public-proof/load-public-proof';
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

  const [regime, history, spyBars] = await Promise.all([
    loadLatestRegimeRead(),
    loadStoredStockScores(),
    loadStoredSpyCandles(),
  ]);
  const latestScore = regime.value;
  const storedScores = history.value ?? [];
  const stripMarks = storedScores.slice(0, 20).slice().reverse();
  const candles = spyBars.value ?? [];

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
        <h1 id="hero-heading" className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
          Trade with the weather. Not against it.
        </h1>
        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
          <section className="min-w-0 border border-white/5 p-4 sm:p-5">
            {latestScore ? (
              <BiasGauge animate stackRead biasScore={latestScore.score} />
            ) : (
              <p className="text-sm leading-6 text-zinc-400">
                {regime.error ?? 'No score is stored for this session.'}
              </p>
            )}
          </section>
          <section className="min-w-0 border border-white/5 p-4 sm:p-5">
            <StockCandles candles={candles} notice={spyBars.error} />
          </section>
        </div>
        <ScoreStrip marks={stripMarks} today={latestScore?.tradeDate ?? ''} />
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
