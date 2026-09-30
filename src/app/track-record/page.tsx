import type { Metadata } from 'next';

import { AssetToggle } from '@/components/AssetToggle';
import {
  formatBiasLabel,
  formatScore,
  formatSignedPercent,
  formatTradeDate,
  formatUsd,
  formatWeight,
} from '@/lib/public-proof/format';
import { loadPaperSnapshot, loadStoredStockScores } from '@/lib/public-proof/load-public-proof';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Stock track record — Macro Bias',
  description:
    'Stored Macro Bias stock scores and the paper-trading snapshot. Not financial advice.',
};

export default async function TrackRecordPage() {
  const [scores, paper] = await Promise.all([loadStoredStockScores(), loadPaperSnapshot()]);

  return (
    <main className="min-h-screen font-sans">
      <div className="mx-auto w-full max-w-5xl px-6 py-12 sm:px-8">
        <div className="flex items-center justify-between">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Track record ]
          </p>
          <AssetToggle />
        </div>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white">Stored stock scores</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
          Scores already written to production, plus the latest paper-trading snapshot. Not financial advice.
        </p>

        <section className="mt-12" aria-labelledby="stored-scores">
          <h2 id="stored-scores" className="text-lg font-semibold text-white">
            macro_bias_scores
          </h2>
          {scores.error ? (
            <p className="mt-4 text-sm leading-6 text-zinc-300">{scores.error}</p>
          ) : scores.value && scores.value.length > 0 ? (
            <div className="mt-4 overflow-x-auto border border-white/10">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-white/10 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Trade date</th>
                    <th className="px-4 py-3 font-medium">Score</th>
                    <th className="px-4 py-3 font-medium">Bias</th>
                  </tr>
                </thead>
                <tbody>
                  {scores.value.map((row) => (
                    <tr key={row.tradeDate} className="border-b border-white/5 text-zinc-300">
                      <td className="px-4 py-3 font-[family:var(--font-data)] text-xs">{formatTradeDate(row.tradeDate)}</td>
                      <td className="px-4 py-3 font-[family:var(--font-data)]">{formatScore(row.score)}</td>
                      <td className="px-4 py-3">{formatBiasLabel(row.biasLabel)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">No stock score is stored yet.</p>
          )}
        </section>

        <section className="mt-14" aria-labelledby="paper-comparison">
          <h2 id="paper-comparison" className="text-lg font-semibold text-white">
            Paper comparison
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
            The latest stored paper snapshot against the SPY mark on the first and latest snapshot in that book.
          </p>
          {paper.error ? (
            <p className="mt-4 text-sm leading-6 text-zinc-300">{paper.error}</p>
          ) : paper.value ? (
            <dl className="mt-6 grid gap-6 border border-white/10 p-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-[0.18em] text-zinc-500">Equity</dt>
                <dd className="mt-2 font-[family:var(--font-data)] text-2xl text-white">{formatUsd(paper.value.equity)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.18em] text-zinc-500">Total return</dt>
                <dd className="mt-2 font-[family:var(--font-data)] text-2xl text-white">
                  {formatSignedPercent(paper.value.totalReturnPct)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.18em] text-zinc-500">Sessions tracked</dt>
                <dd className="mt-2 font-[family:var(--font-data)] text-2xl text-white">{paper.value.sessionsTracked}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.18em] text-zinc-500">Cash weight</dt>
                <dd className="mt-2 font-[family:var(--font-data)] text-2xl text-white">{formatWeight(paper.value.cashWeight)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-[0.18em] text-zinc-500">SPY mark over stored snapshots</dt>
                <dd className="mt-2 text-sm leading-6 text-zinc-300">
                  {paper.value.spyMarkReturnPct != null && paper.value.spyFromDate && paper.value.spyToDate ? (
                    <>
                      <span className="font-[family:var(--font-data)] text-xl text-white">
                        {formatSignedPercent(paper.value.spyMarkReturnPct)}
                      </span>
                      <span className="mt-1 block text-zinc-500">
                        {formatTradeDate(paper.value.spyFromDate)} to {formatTradeDate(paper.value.spyToDate)}
                      </span>
                    </>
                  ) : (
                    'The stored marks do not span two prices yet.'
                  )}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">No paper snapshot is stored yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}
