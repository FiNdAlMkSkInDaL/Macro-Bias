import Link from 'next/link';

import type { ViewerScore } from '@/lib/product/score-access';

function formatScore(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}

function formatTradeDate(dateStr: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateStr}T00:00:00Z`));
}

function formatLabel(label: string) {
  return label.replace(/_/g, ' ');
}

function scoreColor(score: number) {
  if (score > 20) return 'text-emerald-400';
  if (score < -20) return 'text-rose-400';
  return 'text-zinc-200';
}

export function ScoreCard({
  title,
  href,
  score,
}: {
  title: string;
  href: string;
  score: ViewerScore | null;
}) {
  if (!score) {
    return (
      <section className="border border-white/10 bg-zinc-950 p-6 sm:p-8">
        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
          {title}
        </p>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">No stored score yet</h2>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          The morning job has not written a score for this book. Nothing here is estimated.
        </p>
      </section>
    );
  }

  return (
    <section className="border border-white/10 bg-zinc-950 p-6 sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
          {title}
        </p>
        <Link href={href} className="text-xs text-zinc-500 transition hover:text-white">
          Open
        </Link>
      </div>
      <p className="mt-4 text-sm text-zinc-500">{formatTradeDate(score.tradeDate)}</p>
      <p className={`mt-2 font-[family:var(--font-data)] text-6xl font-semibold tracking-tight ${scoreColor(score.score)}`}>
        {formatScore(score.score)}
      </p>
      <p className="mt-2 text-sm uppercase tracking-[0.28em] text-zinc-400">{formatLabel(score.label)}</p>
      {score.delayed && (
        <p className="mt-4 text-sm leading-6 text-zinc-400">
          Previous session. Today&apos;s score, grade, and size hint are on the paid plan.
        </p>
      )}
      {score.paid && score.permission && (
        <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-white/10 pt-5">
          <div>
            <dt className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Permission
            </dt>
            <dd className="mt-2 text-sm font-semibold text-white">{score.permission}</dd>
          </div>
          <div>
            <dt className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Grade
            </dt>
            <dd className="mt-2 text-sm font-semibold text-white">{score.grade}</dd>
          </div>
          <div>
            <dt className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Size
            </dt>
            <dd className="mt-2 text-sm font-semibold text-white">{score.sizePct}%</dd>
          </div>
        </dl>
      )}
      {score.paid && score.sentence && (
        <p className="mt-5 text-sm leading-6 text-zinc-300">{score.sentence}</p>
      )}
      {score.delayed && (
        <Link href="/pricing" className="mt-6 inline-flex text-sm font-medium text-white underline underline-offset-4">
          Unlock today on /pricing
        </Link>
      )}
    </section>
  );
}
