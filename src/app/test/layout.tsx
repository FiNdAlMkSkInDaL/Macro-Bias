import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Test Lab',
  description: 'Private Macro Bias research environment.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function TestLabLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#050608] text-white">
      <div className="mx-auto max-w-6xl px-6 py-8 sm:px-8 lg:px-10">
        <div className="border-b border-white/10 pb-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Link
                href="/test"
                className="font-[family:var(--font-heading)] text-xl font-semibold tracking-[0.18em] text-white"
              >
                MACRO BIAS
              </Link>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center rounded-full border border-white/15 bg-white/[0.03] px-3 py-1 font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.3em] text-zinc-200">
                  Test Lab
                </span>
                <span className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.32em] text-zinc-500">
                  Private promotion workspace
                </span>
              </div>
            </div>

            <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-400">
              <Link href="/test/today" className="transition hover:text-white">
                Today Preview
              </Link>
              <Link href="/test/experiments" className="transition hover:text-white">
                Research Ledger
              </Link>
              <Link href="/test/live-vs-history" className="transition hover:text-white">
                Daily Cockpit
              </Link>
              <Link href="/test/regime-map" className="transition hover:text-white">
                Regime Map
              </Link>
              <Link href="/test/confidence" className="transition hover:text-white">
                Confidence
              </Link>
            </nav>
          </div>
        </div>
        <div className="pt-12">{children}</div>
      </div>
    </main>
  );
}
