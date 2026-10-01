import Link from "next/link";

export function LockedBriefing() {
  return (
    <Link
      href="/pricing"
      className="mt-4 block border border-white/10 px-4 py-4"
    >
      <span aria-hidden="true" className="block max-w-xl space-y-2">
        <span className="block h-3 w-[88%] rounded-sm bg-zinc-600/80 blur-[3px]" />
        <span className="block h-3 w-[62%] rounded-sm bg-zinc-600/70 blur-[3px]" />
      </span>
      <span className="mt-4 inline-block text-sm text-zinc-200 underline decoration-zinc-600 underline-offset-4">
        Full briefing
      </span>
    </Link>
  );
}
