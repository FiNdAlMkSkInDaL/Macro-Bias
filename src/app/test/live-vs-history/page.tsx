import { requireTestLabAccess } from '@/lib/test-lab/access';
import { getLiveVsHistoryCockpitData } from '@/lib/test-lab/live-vs-history';
import { buildPromotedTrustCheck } from '@/lib/test-lab/trust-check';

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

export default async function TestLiveVsHistoryPage() {
  await requireTestLabAccess();
  const cockpit = await getLiveVsHistoryCockpitData();
  const regime = cockpit.regime;
  const currentRegimeSnapshot = regime?.currentSnapshot ?? null;

  const currentTransition =
    regime == null || currentRegimeSnapshot == null
      ? null
      : regime.transitionSummaries.find(
          (summary) => summary.currentClusterId === currentRegimeSnapshot.clusterId,
        ) ?? null;
  const confidence = regime?.confidencePreview ?? null;
  const promotedTrustCheck = buildPromotedTrustCheck(cockpit);

  return (
    <div className="space-y-10">
      <TestLabPageHeader
        eyebrow="Daily Research Cockpit"
        title="Live vs History"
        description="This is the internal synthesis page. It pulls together the live Macro Bias score, the current regime label, transition tendencies, cross-sectional effects, disruption state, and basic health diagnostics into one morning operating view."
        actions={
          <>
            <TestLabStatusPill status="experimental" />
            <TestLabLinkButton href="/test/today" label="Open Today Preview" subtle />
            <TestLabLinkButton href="/test/regime-map" label="Open Regime Map" subtle />
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-5">
        <TestLabMetricCard
          label="Score"
          value={
            cockpit.bias ? `${cockpit.bias.biasLabel.replaceAll('_', ' ')} (${cockpit.bias.score > 0 ? '+' : ''}${cockpit.bias.score})` : 'n/a'
          }
          subtext="The live Macro Bias score from the latest persisted snapshot."
        />
        <TestLabMetricCard
          label="Current Regime"
          value={cockpit.regime?.currentSnapshot?.clusterLabel ?? 'n/a'}
          subtext="The deterministic regime assignment from the research engine."
        />
        <TestLabMetricCard
          label="Pattern Validity"
          value={cockpit.news.patternValidity.toUpperCase()}
          subtext="The separate news-disruption layer’s read on whether the pattern still deserves trust."
        />
        <TestLabMetricCard
          label="Likely Next"
          value={currentTransition?.nextClusterLabel ?? 'n/a'}
          subtext="Most frequent next regime from the current regime in the current sample."
        />
        <TestLabMetricCard
          label="Cross-Sectional Lead"
          value={cockpit.crossSectional?.leadingLenses[0]?.label ?? 'n/a'}
          subtext="The strongest relative lens inside the current regime."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Bottom Line</p>
          <div className="mt-4 space-y-4 text-sm leading-7 text-zinc-300">
            <p>{promotedTrustCheck.summary}</p>
            <p>{promotedTrustCheck.reason}</p>
            {cockpit.crossSectional?.leadingLenses[0] ? (
              <p>
                Inside this regime, the strongest relative behavior is currently{' '}
                <span className="font-[family:var(--font-data)] text-white">
                  {cockpit.crossSectional.leadingLenses[0].label}
                </span>
                {' '}with average excess return of{' '}
                <span className="font-[family:var(--font-data)] text-white">
                  {formatSignedPercent(cockpit.crossSectional.leadingLenses[0].averageExcessReturn)}
                </span>
                .
              </p>
            ) : null}
            {currentTransition ? (
              <p>
                Historically, this regime most often transitions into{' '}
                <span className="font-[family:var(--font-data)] text-white">
                  {currentTransition.nextClusterLabel}
                </span>
                {' '}with transition share of{' '}
                <span className="font-[family:var(--font-data)] text-white">
                  {formatPercent(currentTransition.transitionShare)}
                </span>
                .
              </p>
            ) : null}
          </div>
        </div>

        <TestLabChecklist
          title="How To Read This Page"
          items={[
            'Start with the score and current regime to understand the baseline state.',
            'Use pattern validity and the promoted trust check to decide how much weight the system deserves today.',
            'Use likely-next and cross-sectional lead to think about expression, not just direction.',
            'Use the health metrics to decide whether the regime engine itself is behaving coherently.',
          ]}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Trust Stack</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">3D Analog Consensus</p>
              <p className="mt-2 font-[family:var(--font-data)] text-2xl font-semibold text-white">
                {confidence ? formatPercent(confidence.analogAgreement.directionConsensus3Day) : 'n/a'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Cluster Concentration</p>
              <p className="mt-2 font-[family:var(--font-data)] text-2xl font-semibold text-white">
                {confidence ? formatPercent(confidence.analogAgreement.clusterConcentration) : 'n/a'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Window Agreement</p>
              <p className="mt-2 font-[family:var(--font-data)] text-2xl font-semibold text-white">
                {cockpit.health?.currentClusterWindowAgreement != null
                  ? formatPercent(cockpit.health.currentClusterWindowAgreement)
                  : 'n/a'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">News Adjustment</p>
              <p className="mt-2 font-[family:var(--font-data)] text-2xl font-semibold text-white">
                {cockpit.news.trustAdjustment.replaceAll('_', ' ')}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">News Disruption</p>
          <div className="mt-4 space-y-4 text-sm leading-7 text-zinc-300">
            <p>{cockpit.news.summary}</p>
            {cockpit.briefing ? (
              <p>
                Latest briefing override state:{' '}
                <span className="font-[family:var(--font-data)] text-white">
                  {cockpit.briefing.isOverrideActive ? 'override active' : 'no override'}
                </span>
                .
              </p>
            ) : null}
          </div>
          <div className="mt-5 space-y-3">
            {cockpit.news.eventMix.slice(0, 3).map((event) => (
              <div key={event.eventType} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-medium text-white">{event.eventType.replaceAll('_', ' ')}</p>
                  <span className="font-[family:var(--font-data)] text-sm text-zinc-300">
                    sev {event.averageSeverity.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Cross-Sectional Read</p>
          <div className="mt-4 space-y-3">
            {cockpit.crossSectional?.leadingLenses.map((lens) => (
              <div key={lens.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-medium text-white">{lens.label}</p>
                  <span className="font-[family:var(--font-data)] text-sm text-emerald-300">
                    {formatSignedPercent(lens.averageExcessReturn)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-zinc-400">{lens.summary}</p>
              </div>
            )) ?? <p className="text-sm text-zinc-400">No cross-sectional summary available.</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Health Snapshot</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Cohesion</p>
              <p className="mt-2 font-[family:var(--font-data)] text-2xl font-semibold text-white">
                {cockpit.health?.clusterCohesion.toFixed(4) ?? 'n/a'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Separation</p>
              <p className="mt-2 font-[family:var(--font-data)] text-2xl font-semibold text-white">
                {cockpit.health?.nearestClusterSeparation.toFixed(4) ?? 'n/a'}
              </p>
            </div>
          </div>
          {cockpit.bias ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Live Tape Snapshot</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-zinc-300">
                {cockpit.bias.tickerMoves.slice(0, 6).map((move) => (
                  <p key={move.ticker}>
                    {move.ticker}: {formatSignedPercent(move.percentChange)}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
