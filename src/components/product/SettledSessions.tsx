import { AssetToggle } from '@/components/AssetToggle';
import type { SettledSession } from '@/lib/track-record/settled-sessions';

function formatScore(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}

function formatPct(value: number) {
  const rounded = Number(value.toFixed(2));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}%`;
}

function formatDate(dateStr: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateStr}T00:00:00Z`));
}

export function SettledSessions({
  asset,
  market,
  rows,
  loadError = null,
}: {
  asset: string;
  market: string;
  rows: SettledSession[];
  loadError?: string | null;
}) {
  return (
    <main className="min-h-screen font-sans">
      <div className="mx-auto w-full max-w-5xl px-6 py-12 sm:px-8">
        <div className="flex items-center justify-between">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Track record ]
          </p>
          <AssetToggle />
        </div>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white">{asset}</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
          Settled next-session open-to-close for {market}, from scores and prices already stored.
          This table is the latest 80 stored scores. A row appears after that next session has an
          open and a close. Not financial advice.
        </p>
        {loadError ? (
          <p className="mt-10 text-sm leading-6 text-zinc-300">{loadError}</p>
        ) : rows.length === 0 ? (
          <>
            <p className="mt-4 font-[family:var(--font-data)] text-xs uppercase tracking-[0.24em] text-zinc-500">
              0 settled sessions
            </p>
            <p className="mt-10 text-sm text-zinc-500">No settled next-session results are stored yet.</p>
          </>
        ) : (
          <>
            <p className="mt-4 font-[family:var(--font-data)] text-xs uppercase tracking-[0.24em] text-zinc-500">
              {rows.length} settled session{rows.length === 1 ? '' : 's'}
            </p>
            <div className="mt-8 overflow-x-auto border border-white/10">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-white/10 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Score date</th>
                  <th className="px-4 py-3 font-medium">Session</th>
                  <th className="px-4 py-3 font-medium">Score</th>
                  <th className="px-4 py-3 font-medium">Open to close</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.scoreDate}-${row.sessionDate}`} className="border-b border-white/5 text-zinc-300">
                    <td className="px-4 py-3 font-[family:var(--font-data)] text-xs">{formatDate(row.scoreDate)}</td>
                    <td className="px-4 py-3 font-[family:var(--font-data)] text-xs">{formatDate(row.sessionDate)}</td>
                    <td className="px-4 py-3 font-[family:var(--font-data)]">{formatScore(row.score)}</td>
                    <td className="px-4 py-3 font-[family:var(--font-data)]">{formatPct(row.openToClosePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
