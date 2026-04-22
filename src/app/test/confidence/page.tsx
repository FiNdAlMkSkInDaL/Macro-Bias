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

function formatPercent(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

function getTrustLabel(normalizedMagnitude: number, averageDistance: number, consensus3Day: number) {
  const composite =
    normalizedMagnitude * 0.35 +
    Math.max(0, 1 - averageDistance / 2) * 0.2 +
    consensus3Day * 0.25 +
    0.2;

  if (composite >= 0.72) {
    return 'Higher Trust';
  }

  if (composite >= 0.52) {
    return 'Mixed Trust';
  }

  return 'Reduced Trust';
}

export default async function TestConfidencePage() {
  await requireTestLabAccess();
  const matrix = await getRegimeResearchMatrix();
  const confidence = matrix?.confidencePreview ?? null;

  if (!matrix || !confidence) {
    return (
      <div className="space-y-8">
        <TestLabPageHeader
          eyebrow="Trust Stack"
          title="Confidence"
          description="Confidence diagnostics will appear once the shared research matrix is available."
          actions={<TestLabLinkButton href="/test" label="Back to Lab" subtle />}
        />
      </div>
    );
  }

  const trustLabel = getTrustLabel(
    confidence.signalStrength.normalizedMagnitude,
    confidence.analogAgreement.averageDistance,
    confidence.analogAgreement.directionConsensus3Day,
  );

  return (
    <div className="space-y-10">
      <TestLabPageHeader
        eyebrow="Trust Stack"
        title="Confidence"
        description="This first confidence prototype turns the shared regime research matrix into a measurable trust read. It is intentionally explicit about what it knows: signal magnitude, analog agreement, and how far the current state sits from the center of the reconstructed historical space."
        actions={
          <>
            <TestLabStatusPill status="candidate" />
            <TestLabLinkButton href="/test/regime-map" label="Inspect Regime Map" subtle />
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <TestLabMetricCard
          label="Overall Read"
          value={trustLabel}
          subtext="First-pass trust label from the current internal confidence logic."
        />
        <TestLabMetricCard
          label="Signal Magnitude"
          value={confidence.signalStrength.stateMagnitude.toFixed(3)}
          subtext="Distance of today from the center of the reconstructed state space."
        />
        <TestLabMetricCard
          label="Analog Distance"
          value={confidence.analogAgreement.averageDistance.toFixed(4)}
          subtext="Average distance across the top historical neighbors."
        />
        <TestLabMetricCard
          label="Cluster Concentration"
          value={formatPercent(confidence.analogAgreement.clusterConcentration)}
          subtext="Share of nearest analogs that belong to today’s assigned regime."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Confidence Stack</p>
          <div className="mt-4 space-y-4">
            {[
              {
                label: 'Signal strength',
                value: confidence.signalStrength.normalizedMagnitude,
                summary:
                  'How strongly the current state stands away from the center of the reconstructed historical universe.',
              },
              {
                label: 'Analog agreement (1D)',
                value: confidence.analogAgreement.directionConsensus1Day,
                summary:
                  'How tightly the nearest historical neighbors agree on next-session direction.',
              },
              {
                label: 'Analog agreement (3D)',
                value: confidence.analogAgreement.directionConsensus3Day,
                summary:
                  'How tightly the nearest historical neighbors agree on short multi-session direction.',
              },
              {
                label: 'Cluster concentration',
                value: confidence.analogAgreement.clusterConcentration,
                summary:
                  'How much the nearest analog set agrees with today’s assigned regime label rather than scattering across clusters.',
              },
              {
                label: 'Drift pressure',
                value: Math.min(
                  Math.sqrt(
                    confidence.driftPressure.featureXZScore ** 2 +
                      confidence.driftPressure.featureYZScore ** 2,
                  ) / 3,
                  1,
                ),
                summary:
                  'How far the current exploratory projection sits from the center, used here as a rough drift proxy until the real drift engine exists.',
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
          title="Why This Matters"
          items={[
            'The live product needs a trust language that is numerically grounded rather than hand-wavy.',
            'Confidence should explain when the score deserves to drive behavior and when it should fade into background context.',
            'This module creates the bridge from research outputs to future user-facing trust checks.',
            'The current version is intentionally simple and should be replaced later by a fuller trust decomposition including news, drift, and data health.',
          ]}
        />
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Next Iteration</p>
        <div className="mt-4 space-y-4 text-sm leading-7 text-zinc-300">
          <p>Replace the provisional trust label with a validated scoring framework tied to realized outcomes.</p>
          <p>Add real feature-stability and data-health inputs rather than using projection distance as a rough stand-in.</p>
          <p>Pull the future news-disruption engine into this stack as a separate trust reducer, not a score override.</p>
          <p>Backtest whether higher confidence actually maps to better realized outcomes before we let this drive the live product.</p>
        </div>
      </div>
    </div>
  );
}
