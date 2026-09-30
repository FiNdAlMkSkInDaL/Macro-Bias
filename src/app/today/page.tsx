import type { Metadata } from 'next';
import Link from 'next/link';

import { AssetToggle } from '@/components/AssetToggle';
import { ScoreCard } from '@/components/product/ScoreCard';
import { getViewerScore } from '@/lib/product/score-access';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Stock score — Macro Bias',
  description:
    'Daily stock score from -100 to +100, with a LONG / SHORT / FLAT / NO_TRADE permission for subscribers. Not financial advice.',
};

export default async function TodayPage() {
  const { score, missingSessionDate, loadError } = await getViewerScore('stocks');

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
          Stocks
        </p>
        <AssetToggle />
      </div>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">Stock score</h1>
      <p className="mt-4 text-base leading-7 text-zinc-400">
        KNN on the current feature set: SPY RSI, VIX momentum, HYG/TLT, CPER/GLD, USO momentum,
        rolling percentiles, cosine distance, adaptive K when vol is high. The score is that output.
      </p>
      <div className="mt-8">
        <ScoreCard title="Stocks" href="/crypto" score={score} missingSessionDate={missingSessionDate} loadError={loadError} />
      </div>
      <p className="mt-6 text-xs leading-5 text-zinc-600">
        Not a price target. Not a certainty claim. Not financial advice. Not a managed fund.
      </p>
      <Link href="/" className="mt-6 inline-flex text-sm text-zinc-500 hover:text-white">
        Both scores
      </Link>
    </main>
  );
}
