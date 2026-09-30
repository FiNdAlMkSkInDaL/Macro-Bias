import type { Metadata } from 'next';
import Link from 'next/link';

import { AssetToggle } from '@/components/AssetToggle';
import { ScoreCard } from '@/components/product/ScoreCard';
import { getViewerScore } from '@/lib/product/score-access';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Crypto score — Macro Bias',
  description:
    'Daily crypto score from -100 to +100, with the same permission, grade, and size hint as stocks. Not financial advice.',
};

export default async function CryptoPage() {
  const { score, missingSessionDate, loadError } = await getViewerScore('crypto');

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
        <ScoreCard title="Crypto" href="/today" score={score} missingSessionDate={missingSessionDate} loadError={loadError} />
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
