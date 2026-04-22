import { requireTestLabAccess } from '@/lib/test-lab/access';
import { getRegimeResearchMatrix } from '@/lib/test-lab/regime-map';

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

function formatPercent(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

export default async function TestTransitionsPage() {
  await requireTestLabAccess();
  const matrix = await getRegimeResearchMatrix();

  if (!matrix) {
    return (
      <div className="space-y-8">
        <TestLabPageHeader
          eyebrow="State Dynamics"
          title="Transitions"
          description="Transition analysis will appear once the regime research matrix is available."
          actions={<TestLabLinkButton href="/test" label="Back to Lab" subtle />}
        />
      </div>
    );
  }

  const currentBucket =
    matrix.currentSnapshot == null
      ? null
      : matrix.transitionSummaries.find(
          (summary) => summary.currentClusterId === matrix.currentSnapshot!.clusterId,
        ) ?? null;

  return (
    <div className="space-y-10">
      <TestLabPageHeader
        eyebrow="State Dynamics"
        title="Transitions"
        description="This first transition prototype groups the reconstructed regime space into simple state buckets and summarizes what historically followed those states. It is intentionally plain for now: sample-aware, readable, and tied directly to the shared regime matrix."
        actions={
          <>
            <TestLabStatusPill status="research" />
            <TestLabLinkButton href="/test/regime-map" label="Open Regime Map" subtle />
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <TestLabMetricCard
          label="Observed Transitions"
          value={String(matrix.transitionSummaries.length)}
          subtext="Cluster-to-cluster transitions observed in the current historical sample."
        />
        <TestLabMetricCard
          label="Current Regime"
          value={matrix.currentSnapshot?.clusterLabel ?? 'n/a'}
          subtext="The deterministic regime assignment for the latest session."
        />
        <TestLabMetricCard
          label="Most Likely Next"
          value={currentBucket?.nextClusterLabel ?? 'n/a'}
          subtext="Most frequent next regime from the current regime label in this first pass."
        />
        <TestLabMetricCard
          label="Transition Share"
          value={currentBucket ? formatPercent(currentBucket.transitionShare) : 'n/a'}
          subtext="Share of observed transitions from the current regime that land in the top next state."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Bucket Outcome Table</p>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.02]">
                  {['From', 'To', 'Share', 'Samples', 'Avg 1D', 'Avg 3D'].map((header) => (
                    <th key={header} className="px-4 py-3 text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {matrix.transitionSummaries.map((summary) => (
                  <tr key={`${summary.currentClusterId}-${summary.nextClusterId}`}>
                    <td className="px-4 py-3 text-zinc-200">{summary.currentClusterLabel}</td>
                    <td className="px-4 py-3 text-zinc-300">{summary.nextClusterLabel}</td>
                    <td className="px-4 py-3 font-[family:var(--font-data)] text-zinc-300">{formatPercent(summary.transitionShare)}</td>
                    <td className="px-4 py-3 font-[family:var(--font-data)] text-zinc-300">{summary.sampleCount}</td>
                    <td className="px-4 py-3 font-[family:var(--font-data)] text-zinc-300">{formatSignedPercent(summary.averageForward1DayReturn)}</td>
                    <td className="px-4 py-3 font-[family:var(--font-data)] text-zinc-300">{formatSignedPercent(summary.averageForward3DayReturn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <TestLabChecklist
          title="What This Page Is Doing"
          items={[
            'Using the shared regime matrix instead of inventing a separate transition dataset.',
            'Using actual cluster-to-cluster transitions instead of the earlier quadrant proxy.',
            'Surfacing sample counts alongside forward returns so we do not overread thin states.',
            'Giving us a first honest answer to the question: what tends to follow a regime like this?',
          ]}
        />
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Next Iteration</p>
        <div className="mt-4 space-y-4 text-sm leading-7 text-zinc-300">
          <p>Add persistence and self-transition framing so we can distinguish sticky regimes from unstable ones.</p>
          <p>Add regime persistence, instability, and transition-likelihood views rather than only average forward returns.</p>
          <p>Break outcomes out by horizon and volatility profile so this becomes operationally useful instead of just descriptive.</p>
        </div>
      </div>
    </div>
  );
}
