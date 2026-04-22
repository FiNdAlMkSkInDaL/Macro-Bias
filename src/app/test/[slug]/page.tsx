import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTestLabAccess } from '@/lib/test-lab/access';
import { getTestLabModuleContent } from '@/lib/test-lab/content';
import {
  CURRENT_STOCKS_ANALOG_FEATURES,
  PROPOSED_REGIME_FEATURE_GROUPS,
  REGIME_MAP_FIRST_DATA_DELIVERABLES,
} from '@/lib/test-lab/research-data-design';

import {
  TestLabChecklist,
  TestLabLinkButton,
  TestLabPageHeader,
  TestLabStatusPill,
} from '../_components/research-lab-ui';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function TestLabModulePage({ params }: PageProps) {
  await requireTestLabAccess();

  const { slug } = await params;
  const module = getTestLabModuleContent(slug);

  if (!module) {
    notFound();
  }

  return (
    <div className="space-y-10">
      <TestLabPageHeader
        eyebrow={module.eyebrow}
        title={module.title}
        description={module.summary}
        actions={
          <>
            <div className="flex items-center">
              <TestLabStatusPill status={module.status} />
            </div>
            <TestLabLinkButton href="/test" label="Back to Lab" subtle />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Mission</p>
          <p className="mt-4 text-base leading-8 text-zinc-200">{module.mission}</p>

          <p className="mt-8 text-[11px] uppercase tracking-[0.26em] text-zinc-500">
            Why This Matters
          </p>
          <p className="mt-4 text-sm leading-7 text-zinc-300">{module.whyItMatters}</p>

          <div className="mt-8 rounded-2xl border border-white/10 bg-black/20 p-5">
            <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">
              Definition of Success
            </p>
            <p className="mt-3 text-sm leading-7 text-zinc-300">{module.success}</p>
          </div>
        </div>

        <TestLabChecklist title="First Sprint" items={module.firstSprint} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <TestLabChecklist title="Requirements" items={module.requirements} />
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Build Direction</p>
          <div className="mt-4 space-y-4 text-sm leading-7 text-zinc-300">
            <p>
              This page is the working brief for the module. As we implement the lab, each page
              will evolve from design intent into a functioning research surface with real data,
              diagnostics, and model outputs.
            </p>
            <p>
              The immediate standard is simple: every module must become both product-useful and
              quant-credible. If it only looks clever, it does not survive.
            </p>
            <p>
              When we wire the first live data into this module, we should keep the interface calm,
              make assumptions visible, and preserve the clean Macro Bias dashboard feel.
            </p>
          </div>
          <div className="mt-6">
            <Link href="/test/live-vs-history" className="text-sm font-medium text-white hover:text-zinc-300">
              See how this will plug into the daily cockpit
            </Link>
          </div>
        </div>
      </div>

      {module.slug === 'regime-map' ? (
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">
              Current Live Feature Inventory
            </p>
            <div className="mt-5 space-y-4">
              {CURRENT_STOCKS_ANALOG_FEATURES.map((feature) => (
                <div key={feature.key} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-[family:var(--font-heading)] text-lg font-semibold text-white">
                      {feature.label}
                    </p>
                    <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                      {feature.pillar}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">{feature.whyItExists}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <TestLabChecklist
              title="Proposed Feature Expansion"
              items={PROPOSED_REGIME_FEATURE_GROUPS.map(
                (group) => `${group.title}: ${group.description}`,
              )}
            />
            <TestLabChecklist
              title="First Data Deliverables"
              items={[...REGIME_MAP_FIRST_DATA_DELIVERABLES]}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
