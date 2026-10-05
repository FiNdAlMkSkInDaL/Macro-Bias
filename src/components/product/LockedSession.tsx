import Link from 'next/link';

export function LockedSession({ assetHref }: { assetHref: string }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
        Latest session
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">Read the full current session with Pro</h1>
      <p className="mt-4 max-w-xl text-base leading-7 text-zinc-400">
        Published scores and market history are public. Pro adds the current briefing, reliability grade, size hint, and decision context.
      </p>
      <div className="mt-8 flex flex-wrap gap-4 text-sm">
        <Link href="/pricing" className="bg-white px-4 py-2 font-semibold text-black">
          Explore Pro
        </Link>
        <Link href={assetHref} className="border border-white/15 px-4 py-2 text-zinc-200">
          Browse readings
        </Link>
      </div>
    </main>
  );
}
