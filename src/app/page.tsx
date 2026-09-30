import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ScoreCard } from '@/components/product/ScoreCard';
import { getViewerScore } from '@/lib/product/score-access';

export const dynamic = 'force-dynamic';

type HomePageProps = {
  searchParams: Promise<{ authError?: string; checkout?: string; redirectTo?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;

  if (params.redirectTo || params.authError) {
    const loginParams = new URLSearchParams();

    if (params.redirectTo) {
      loginParams.set('redirectTo', params.redirectTo);
    }

    if (params.authError) {
      loginParams.set('authError', params.authError);
    }

    redirect(`/login?${loginParams.toString()}`);
  }

  const [stocks, crypto] = await Promise.all([getViewerScore('stocks'), getViewerScore('crypto')]);
  const paid = Boolean(stocks.score?.paid || crypto.score?.paid);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:px-8">
      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
        Macro Bias
      </p>
      <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
        The morning score.
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
        A number from -100 to +100, then a permission: LONG, SHORT, FLAT, or NO_TRADE. Grade A–F.
        F means NO_TRADE. A dead zone around zero means FLAT. Not a price target. Not financial advice.
      </p>
      {params.checkout === 'success' && (
        <p className="mt-6 border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          Stripe accepted the subscription. Today&apos;s score shows once the webhook grants access. Refresh if it is still the previous session.
        </p>
      )}
      {params.checkout === 'active' && (
        <p className="mt-6 border border-white/10 px-4 py-3 text-sm text-zinc-300">
          This account already has an active subscription.
        </p>
      )}
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <ScoreCard title="Stocks" href="/today" score={stocks.score} missingSessionDate={stocks.missingSessionDate} />
        <ScoreCard title="Crypto" href="/crypto" score={crypto.score} missingSessionDate={crypto.missingSessionDate} />
      </div>
      <div className="mt-8 flex flex-wrap gap-4 text-sm">
        {paid ? (
          <p className="text-zinc-400">The morning email goes to the address on the subscription.</p>
        ) : (
          <Link href="/pricing" className="bg-white px-4 py-2 font-semibold text-black">
            Pricing
          </Link>
        )}
        <Link href="/login" className="border border-white/15 px-4 py-2 text-zinc-200">
          Sign in
        </Link>
      </div>
    </main>
  );
}
