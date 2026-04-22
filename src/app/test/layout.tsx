import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { TEST_LAB_MODULES } from '@/lib/test-lab/constants';

import { TestLabStatusPill } from './_components/research-lab-ui';

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
    <main className="min-h-screen bg-zinc-950">
      <div className="mx-auto max-w-7xl px-6 py-10 sm:px-8 lg:px-10">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/80 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="border-b border-white/10 px-6 py-5 sm:px-8">
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.28em] text-amber-300">
                    Test Lab
                  </span>
                  <TestLabStatusPill status="research" />
                </div>
                <p className="mt-3 font-[family:var(--font-heading)] text-2xl font-semibold text-white">
                  Macro Bias Research Lab
                </p>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                  Private workspace for next-generation regime intelligence. Everything here is
                  isolated from live until we explicitly promote it.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/test"
                  className="inline-flex items-center rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/[0.06] hover:text-white"
                >
                  Overview
                </Link>
                {TEST_LAB_MODULES.slice(0, 4).map((module) => (
                  <Link
                    key={module.slug}
                    href={`/test/${module.slug}`}
                    className="inline-flex items-center rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    {module.title}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div className="px-6 py-8 sm:px-8">{children}</div>
        </div>
      </div>
    </main>
  );
}
