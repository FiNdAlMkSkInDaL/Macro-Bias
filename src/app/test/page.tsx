import Link from 'next/link';

import { requireTestLabAccess } from '@/lib/test-lab/access';
import { TEST_LAB_MODULES } from '@/lib/test-lab/constants';

import {
  TestLabChecklist,
  TestLabLinkButton,
  TestLabMetricCard,
  TestLabModuleCard,
  TestLabPageHeader,
} from './_components/research-lab-ui';

export const dynamic = 'force-dynamic';

export default async function TestLabHomePage() {
  const user = await requireTestLabAccess();

  return (
    <div className="space-y-10">
      <TestLabPageHeader
        eyebrow="Private Research Environment"
        title="Build the next Macro Bias system without touching live"
        description={`Signed in as ${user.email}. This lab is where we harden the next generation of Macro Bias before any of it reaches the public product. The focus is regime intelligence, trust decomposition, transition logic, and research discipline.`}
        actions={
          <>
            <TestLabLinkButton href="/test/today" label="Open Today Preview" />
            <TestLabLinkButton href="/test/live-vs-history" label="Open Daily Cockpit" subtle />
            <TestLabLinkButton href="/test/experiments" label="View Research Ledger" subtle />
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <TestLabMetricCard
          label="Protected Surface"
          value="/test/*"
          subtext="Every research route lives under a private namespace isolated from live traffic."
        />
        <TestLabMetricCard
          label="Access Model"
          value="Allowlist"
          subtext="Restricted to your signed-in account only, enforced in middleware and server code."
        />
        <TestLabMetricCard
          label="Promotion Rule"
          value="Explicit"
          subtext="Nothing in the lab reaches live until we deliberately promote it."
        />
        <TestLabMetricCard
          label="Research Style"
          value="Walk-Forward"
          subtext="Every serious module should be judged with benchmarked, historically honest validation."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <TestLabChecklist
          title="What We Are Building"
          items={[
            'A historical regime map that places today in context instead of treating each day as isolated.',
            'A transition engine that estimates what usually comes next from the current state.',
            'A confidence stack that explains why the model should or should not be trusted today.',
            'A cross-sectional layer showing what tends to work inside a given regime.',
            'A separate news disruption engine that weakens trust without corrupting the core score.',
            'A research ledger so every model change is tracked, judged, and either promoted or rejected.',
          ]}
        />
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Immediate Build Order</p>
          <div className="mt-4 space-y-4">
            {[
              '1. Lock down private routing and layout.',
              '2. Stand up the regime-map and data-design surfaces.',
              '3. Layer in transition logic and confidence decomposition.',
              '4. Add cross-sectional effects and news disruption.',
              '5. Finish with model health, experiment tracking, and the daily cockpit.',
            ].map((item) => (
              <p key={item} className="text-sm leading-6 text-zinc-300">
                {item}
              </p>
            ))}
          </div>
          <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Ground Rule</p>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              If a feature looks impressive but cannot survive validation, benchmark comparison, and
              real operator use, it does not graduate.
            </p>
          </div>
        </div>
      </div>

      <section>
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Research Modules</p>
            <h2 className="mt-2 font-[family:var(--font-heading)] text-2xl font-semibold text-white">
              Internal workstreams
            </h2>
          </div>
          <Link href="/test/regime-map" className="text-sm font-medium text-zinc-300 hover:text-white">
            Start with the regime map
          </Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {TEST_LAB_MODULES.map((module) => (
            <TestLabModuleCard key={module.slug} module={module} />
          ))}
        </div>
      </section>
    </div>
  );
}
