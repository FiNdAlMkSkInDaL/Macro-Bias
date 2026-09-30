import Link from 'next/link';

export function LockedSession({ assetHref }: { assetHref: string }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
        Latest session
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">This session is on the paid plan</h1>
      <p className="mt-4 max-w-xl text-base leading-7 text-zinc-400">
        The latest score, grade, and size hint stay off the public page. The previous session is on the score page.
      </p>
      <div className="mt-8 flex flex-wrap gap-4 text-sm">
        <Link href="/pricing" className="bg-white px-4 py-2 font-semibold text-black">
          Pricing
        </Link>
        <Link href={assetHref} className="border border-white/15 px-4 py-2 text-zinc-200">
          Previous score
        </Link>
      </div>
    </main>
  );
}
