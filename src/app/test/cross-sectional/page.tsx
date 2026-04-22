import { requireTestLabAccess } from '@/lib/test-lab/access';
import { getCrossSectionalPreviewData } from '@/lib/test-lab/cross-sectional';

import {
  TestLabChecklist,
  TestLabLinkButton,
  TestLabMetricCard,
  TestLabPageHeader,
  TestLabStatusPill,
} from '../_components/research-lab-ui';

export const dynamic = 'force-dynamic';

function formatSignedPercent(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export default async function TestCrossSectionalPage() {
  await requireTestLabAccess();
  const preview = await getCrossSectionalPreviewData();

  if (!preview) {
    return (
      <div className="space-y-8">
        <TestLabPageHeader
          eyebrow="What Works Here"
          title="Cross-Sectional"
          description="Cross-sectional summaries will appear once the current regime has enough historical sample depth."
          actions={<TestLabLinkButton href="/test" label="Back to Lab" subtle />}
        />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <TestLabPageHeader
        eyebrow="What Works Here"
        title="Cross-Sectional"
        description="This module translates the current regime label into relative leadership. It asks a practical question: inside a regime like this, what tends to beat its benchmark on the next session, and what tends to lag?"
        actions={
          <>
            <TestLabStatusPill status="research" />
            <TestLabLinkButton href="/test/regime-map" label="Inspect Regime Map" subtle />
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <TestLabMetricCard
          label="Current Regime"
          value={preview.clusterLabel}
          subtext="The active deterministic regime label driving this first cross-sectional read."
        />
        <TestLabMetricCard
          label="Source Snapshot"
          value={preview.sourceTradeDate}
          subtext="The latest persisted Macro Bias snapshot backing this preview."
        />
        <TestLabMetricCard
          label="Strongest Relative"
          value={preview.leadingLenses[0]?.label ?? 'n/a'}
          subtext="The best average next-session relative performer in this regime."
        />
        <TestLabMetricCard
          label="Weakest Relative"
          value={preview.laggingLenses[0]?.label ?? 'n/a'}
          subtext="The weakest average next-session relative performer in this regime."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">What Tends to Lead</p>
          <div className="mt-4 space-y-4">
            {preview.leadingLenses.map((lens) => (
              <div key={lens.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-[family:var(--font-heading)] text-lg font-semibold text-white">
                      {lens.label}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">{lens.summary}</p>
                  </div>
                  <span className="font-[family:var(--font-data)] text-sm text-emerald-300">
                    {formatSignedPercent(lens.averageExcessReturn)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-zinc-300">
                  <p>{lens.ticker}: {formatSignedPercent(lens.averageTickerReturn)}</p>
                  <p>{lens.benchmark}: {formatSignedPercent(lens.averageBenchmarkReturn)}</p>
                  <p>Excess: {formatSignedPercent(lens.averageExcessReturn)}</p>
                  <p>Samples: {lens.sampleCount}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">What Tends to Lag</p>
          <div className="mt-4 space-y-4">
            {preview.laggingLenses.map((lens) => (
              <div key={lens.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-[family:var(--font-heading)] text-lg font-semibold text-white">
                      {lens.label}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">{lens.summary}</p>
                  </div>
                  <span className="font-[family:var(--font-data)] text-sm text-rose-300">
                    {formatSignedPercent(lens.averageExcessReturn)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-zinc-300">
                  <p>{lens.ticker}: {formatSignedPercent(lens.averageTickerReturn)}</p>
                  <p>{lens.benchmark}: {formatSignedPercent(lens.averageBenchmarkReturn)}</p>
                  <p>Excess: {formatSignedPercent(lens.averageExcessReturn)}</p>
                  <p>Samples: {lens.sampleCount}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
        <TestLabChecklist
          title="What This Module Adds"
          items={[
            'A first regime-conditioned view of relative leadership rather than just index direction.',
            'A direct bridge from regime labels to practical expression ideas.',
            'Evidence for where Macro Bias should eventually talk about what tends to work inside a state.',
            'A stronger product story because the system now links macro state to cross-sectional behavior.',
          ]}
        />
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Next Iteration</p>
          <div className="mt-4 space-y-4 text-sm leading-7 text-zinc-300">
            <p>Add more explicit factor-style lenses once we have a stronger historical panel and a stable regime taxonomy.</p>
            <p>Move from simple next-session average excess returns into multi-horizon and confidence-aware spreads.</p>
            <p>Eventually tie this into the daily research cockpit so the regime label and the relative-expression layer live together.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
