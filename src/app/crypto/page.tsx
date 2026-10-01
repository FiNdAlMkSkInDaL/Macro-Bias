import type { Metadata } from 'next';
import Link from 'next/link';

import { AssetToggle } from '@/components/AssetToggle';
import { ScoreCard } from '@/components/product/ScoreCard';
import { PublicDailyPage } from '@/components/product/PublicDailyPage';
import { loadPublicDailyData } from '@/lib/product/public-daily-data';
import { getViewerScore } from '@/lib/product/score-access';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Crypto score — Macro Bias',
  description:
    'Explore the previous published crypto score, Bitcoin price history and the wider market backdrop. Get free daily stock and crypto updates by email.',
};

export default async function CryptoPage() {
  const viewer = await getViewerScore('crypto');
  const { score, missingSessionDate, loadError } = viewer;

  if (!viewer.signedIn && !viewer.paid) {
    return <PublicDailyPage data={await loadPublicDailyData('crypto', viewer)} />;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
          Crypto
        </p>
        <AssetToggle />
      </div>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">Crypto score</h1>
      <p className="mt-4 text-base leading-7 text-zinc-400">
        The same kind of morning permission as stocks, from the crypto path. Not a price target.
      </p>
      <div className="mt-8">
        <ScoreCard title="Crypto" href="/crypto" score={score} missingSessionDate={missingSessionDate} loadError={loadError} />
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
