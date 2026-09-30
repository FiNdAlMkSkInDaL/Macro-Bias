import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DashboardTop } from '@/components/dashboard/DashboardTop';
import { HeroSignupForm } from '@/components/product/HeroSignupForm';
import { continuationFromSearchParams, firstSearchParam } from '@/lib/auth/continuation';
import { formatTradeDate } from '@/lib/public-proof/format';
import {
  loadBriefingCallForTradeDate,
  loadLatestRegimeRead,
} from '@/lib/public-proof/load-public-proof';
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

function ProofLabel({ children }: { children: string }) {
  return (
    <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
      {children}
    </p>
  );
}

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

  const regime = await loadLatestRegimeRead();
  const latestScore = regime.value;
  const briefing = latestScore
    ? await loadBriefingCallForTradeDate(latestScore.tradeDate)
    : { value: null, error: null };
  const matchingCall =
    briefing.value && latestScore && briefing.value.tradeDate === latestScore.tradeDate
      ? briefing.value
      : null;

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
        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
          Macro Bias
        </p>
        <h1 id="hero-heading" className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
          Trade with the weather. Not against it.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-300">
          Macro Bias gives you a fast daily market read before the open. Get the score, the day type, and the trust check before you place a trade.
        </p>
        <HeroSignupForm />
        <p className="mt-3 max-w-xl text-xs leading-5 text-zinc-500">
          Free every morning. Stocks and crypto. Unsubscribe anytime.
        </p>
        <div className="mt-16">
          <DashboardTop
            assets={latestScore?.assets ?? []}
            biasLabel={latestScore?.biasLabel}
            biasScore={latestScore?.score ?? 0}
            hasScore={Boolean(latestScore)}
            note={regime.error}
          />
          {briefing.error ? (
            <article className="mt-10 max-w-3xl">
              <ProofLabel>Latest call</ProofLabel>
              <p className="mt-3 text-sm leading-6 text-zinc-300">{briefing.error}</p>
            </article>
          ) : matchingCall ? (
            <article className="mt-10 max-w-3xl">
              <ProofLabel>Latest call</ProofLabel>
              <p className="mt-3 font-[family:var(--font-data)] text-xs text-zinc-500">
                Trade date {formatTradeDate(matchingCall.tradeDate)}
              </p>
              <p className="mt-4 text-sm leading-6 text-zinc-300">
                <span className="text-zinc-500">Day type. </span>
                {matchingCall.dayType}
              </p>
              <p className="mt-3 text-base leading-7 text-white">
                <span className="text-zinc-500">Bottom line. </span>
                {matchingCall.bottomLine}
              </p>
            </article>
          ) : null}
        </div>
      </section>
      <section className="mt-16 border border-white/10 px-5 py-6" aria-label="Referral">
        <p className="text-sm leading-6 text-zinc-400">
          Already subscribed? Invite 3 traders and unlock 7 days of Premium.
        </p>
        <Link href="/refer" className="mt-3 inline-block text-sm text-sky-400 underline">
          See referral rewards
        </Link>
      </section>
    </main>
  );
}
