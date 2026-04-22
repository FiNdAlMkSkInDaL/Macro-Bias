import { requireTestLabAccess } from '@/lib/test-lab/access';
import { getTestLabPersistenceSummary } from '@/lib/test-lab/persistence';
import { getRegimeResearchMatrix } from '@/lib/test-lab/regime-map';

import {
  TestLabChecklist,
  TestLabLinkButton,
  TestLabMetricCard,
  TestLabPageHeader,
  TestLabStatusPill,
} from '../_components/research-lab-ui';

export const dynamic = 'force-dynamic';

function formatPercent(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

function getHealthLabel(cohesion: number, separation: number, windowAgreement: number | null) {
  const cohesionScore = cohesion <= 0.85 ? 1 : cohesion <= 1.15 ? 0.7 : 0.45;
  const separationScore = separation >= 1.15 ? 1 : separation >= 0.8 ? 0.7 : 0.4;
  const agreementScore = windowAgreement == null ? 0.55 : windowAgreement;
  const composite = cohesionScore * 0.35 + separationScore * 0.35 + agreementScore * 0.3;

  if (composite >= 0.78) {
    return 'Healthy';
  }

  if (composite >= 0.58) {
    return 'Watch';
  }

  return 'Fragile';
}

export default async function TestDataHealthPage() {
  await requireTestLabAccess();
  const [matrix, persistence] = await Promise.all([
    getRegimeResearchMatrix(),
    getTestLabPersistenceSummary(),
  ]);

  if (!matrix) {
    return (
      <div className="space-y-8">
        <TestLabPageHeader
          eyebrow="Model Integrity"
          title="Data Health"
          description="Diagnostics will appear once the shared regime matrix is available."
          actions={<TestLabLinkButton href="/test" label="Back to Lab" subtle />}
        />
      </div>
    );
  }

  const diagnostics = matrix.diagnostics;
  const healthLabel = getHealthLabel(
    diagnostics.clusterCohesion,
    diagnostics.nearestClusterSeparation,
    diagnostics.currentClusterWindowAgreement,
  );

  return (
    <div className="space-y-10">
      <TestLabPageHeader
        eyebrow="Model Integrity"
        title="Data Health"
        description="This is the first real health board for the research lab. It does not yet cover the full pipeline, but it already tells us something important: whether the current regime engine is coherent, separated, and reasonably stable when we perturb the historical window."
        actions={
          <>
            <TestLabStatusPill status="candidate" />
            <TestLabLinkButton href="/test/regime-map" label="Inspect Regime Map" subtle />
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <TestLabMetricCard
          label="Engine Read"
          value={healthLabel}
          subtext="A first-pass health label from clustering cohesion, separation, and window stability."
        />
        <TestLabMetricCard
          label="Cluster Cohesion"
          value={diagnostics.clusterCohesion.toFixed(4)}
          subtext="Lower is better. Measures how tightly sessions sit around their assigned cluster centroids."
        />
        <TestLabMetricCard
          label="Cluster Separation"
          value={diagnostics.nearestClusterSeparation.toFixed(4)}
          subtext="Higher is better. Measures the nearest centroid-to-centroid distance."
        />
        <TestLabMetricCard
          label="Window Agreement"
          value={
            diagnostics.currentClusterWindowAgreement == null
              ? 'n/a'
              : formatPercent(diagnostics.currentClusterWindowAgreement)
          }
          subtext="How often the current regime label survives rolling-window reruns."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <TestLabMetricCard
          label="Artifacts Table"
          value={persistence.regimeArtifactsTable.available ? 'Live' : 'Missing'}
          subtext="Whether persisted regime artifacts are available in the active Supabase project."
        />
        <TestLabMetricCard
          label="Artifacts Stored"
          value={String(persistence.regimeArtifactsTable.rowCount)}
          subtext="Number of cached regime artifacts currently available."
        />
        <TestLabMetricCard
          label="Experiments Stored"
          value={String(persistence.experimentsTable.rowCount)}
          subtext="Number of persisted experiment records available to the ledger."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Diagnostics</p>
          <div className="mt-4 space-y-4">
            {[
              {
                label: 'Cluster cohesion',
                value: Math.max(0, Math.min(1, 1 - diagnostics.clusterCohesion / 2)),
                summary:
                  'Tighter clusters are easier to interpret and usually less likely to be arbitrary.',
              },
              {
                label: 'Cluster separation',
                value: Math.max(0, Math.min(1, diagnostics.nearestClusterSeparation / 2)),
                summary:
                  'Well-separated clusters are less likely to be cosmetic partitions of the same state.',
              },
              {
                label: 'Current regime stability',
                value:
                  diagnostics.currentClusterWindowAgreement == null
                    ? 0
                    : diagnostics.currentClusterWindowAgreement,
                summary:
                  'If the current regime label falls apart under rolling-window reruns, we should not trust it much.',
              },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-[family:var(--font-heading)] text-lg font-semibold text-white">
                    {item.label}
                  </p>
                  <span className="font-[family:var(--font-data)] text-sm text-zinc-200">
                    {formatPercent(item.value)}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.max(item.value * 100, 4)}%` }} />
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-300">{item.summary}</p>
              </div>
            ))}
          </div>
        </div>

        <TestLabChecklist
          title="What This Still Does Not Cover"
          items={[
            'Raw data freshness and missingness checks are not wired into this page yet.',
            'We are measuring regime-engine stability, not full end-to-end model health.',
            'No benchmark comparison is shown here yet.',
            'No long-run hit-rate decay tracking is included yet.',
          ]}
        />
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Next Iteration</p>
        <div className="mt-4 space-y-4 text-sm leading-7 text-zinc-300">
          <p>Add feature-distribution drift and missing-data checks so this becomes a true data-health page rather than a clustering-health page.</p>
          <p>Persist diagnostics historically so we can see whether the regime engine is improving or decaying over time.</p>
          <p>Bring in benchmarked live-vs-history tracking so health can be judged against realized outcomes, not just geometry.</p>
        </div>
      </div>
    </div>
  );
}
