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

function formatSigned(value: number, decimals = 2) {
  return `${value > 0 ? '+' : ''}${value.toFixed(decimals)}`;
}

function ExploratoryRegimeMap({
  points,
}: {
  points: Array<{
    clusterId: string;
    clusterLabel: string;
    featureX: number;
    featureY: number;
    isLatest: boolean;
    tradeDate: string;
  }>;
}) {
  const clusterColors = ['#7dd3fc', '#34d399', '#fbbf24', '#f87171', '#c084fc'];
  const colorByCluster = new Map<string, string>();
  let colorIndex = 0;
  points.forEach((point) => {
    if (!colorByCluster.has(point.clusterId)) {
      colorByCluster.set(point.clusterId, clusterColors[colorIndex % clusterColors.length]);
      colorIndex += 1;
    }
  });

  const width = 720;
  const height = 420;
  const padding = 30;
  const xValues = points.map((point) => point.featureX);
  const yValues = points.map((point) => point.featureY);
  const minX = Math.min(...xValues, -1);
  const maxX = Math.max(...xValues, 1);
  const minY = Math.min(...yValues, -1);
  const maxY = Math.max(...yValues, 1);
  const xRange = maxX - minX || 1;
  const yRange = maxY - minY || 1;

  const scaleX = (value: number) =>
    padding + ((value - minX) / xRange) * (width - padding * 2);
  const scaleY = (value: number) =>
    height - padding - ((value - minY) / yRange) * (height - padding * 2);

  const axisX = scaleX(0);
  const axisY = scaleY(0);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">
            Exploratory Projection
          </p>
          <p className="mt-2 text-sm leading-6 text-zinc-300">
            Temporary two-axis view built from standardized live-model features. This is not the
            final clustering engine. It is an honest first map to help us inspect how the latest
            session sits inside the historical universe already stored in Macro Bias.
          </p>
        </div>
        <TestLabStatusPill status="research" />
      </div>
      <div className="mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-black/20 p-3">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[620px]">
          <line x1={padding} y1={axisY} x2={width - padding} y2={axisY} stroke="rgba(255,255,255,0.12)" />
          <line x1={axisX} y1={padding} x2={axisX} y2={height - padding} stroke="rgba(255,255,255,0.12)" />

          {points.map((point) => (
            <circle
              key={point.tradeDate}
              cx={scaleX(point.featureX)}
              cy={scaleY(point.featureY)}
              r={point.isLatest ? 6 : 3}
              fill={point.isLatest ? '#fbbf24' : colorByCluster.get(point.clusterId) ?? 'rgba(125,211,252,0.55)'}
              stroke={point.isLatest ? 'white' : 'none'}
            >
              <title>{`${point.tradeDate} | ${point.clusterLabel} | X ${formatSigned(point.featureX, 3)} | Y ${formatSigned(point.featureY, 3)}`}</title>
            </circle>
          ))}

          <text x={width - padding} y={axisY - 8} textAnchor="end" fill="rgba(255,255,255,0.55)" fontSize="11">
            richer risk appetite
          </text>
          <text x={axisX + 8} y={padding + 12} fill="rgba(255,255,255,0.55)" fontSize="11">
            higher stress
          </text>
          <text x={padding} y={height - padding + 18} fill="rgba(255,255,255,0.55)" fontSize="11">
            weaker risk appetite
          </text>
          <text x={axisX + 8} y={height - padding - 8} fill="rgba(255,255,255,0.55)" fontSize="11">
            calmer tape
          </text>
        </svg>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {[...colorByCluster.entries()].map(([clusterId, color]) => {
          const label = points.find((point) => point.clusterId === clusterId)?.clusterLabel ?? clusterId;

          return (
            <div key={clusterId} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-zinc-300">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function TestRegimeMapPage() {
  await requireTestLabAccess();
  const preview = await getRegimeResearchMatrix();

  if (!preview) {
    return (
      <div className="space-y-8">
        <TestLabPageHeader
          eyebrow="Historical Geometry"
          title="Regime Map"
          description="The first real module is waiting on a clean historical feature universe."
          actions={<TestLabLinkButton href="/test" label="Back to Lab" subtle />}
        />
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm leading-7 text-zinc-300">
          No regime-map preview data is available yet. The next requirement is a usable latest
          Macro Bias snapshot with historical price arrays inside `engine_inputs`.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <TestLabPageHeader
        eyebrow="Historical Geometry"
        title="Regime Map"
        description="This is the first real data-backed Research Lab module. It reconstructs a historical feature matrix from the latest persisted Macro Bias universe, then projects the sessions into an exploratory map so we can inspect the shape of the state space before formal clustering."
        actions={
          <>
            <TestLabStatusPill status="research" />
            <TestLabLinkButton href="/test" label="Back to Lab" subtle />
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-5">
        <TestLabMetricCard
          label="Source Snapshot"
          value={preview.sourceTradeDate}
          subtext="The latest persisted Macro Bias score row is the single source of truth for this prototype."
        />
        <TestLabMetricCard
          label="Coverage Start"
          value={preview.coverage.earliestTradeDate ?? 'n/a'}
          subtext="Earliest common session across the stored cross-asset universe."
        />
        <TestLabMetricCard
          label="Coverage End"
          value={preview.coverage.latestTradeDate ?? 'n/a'}
          subtext="Latest common session represented in the current historical universe."
        />
        <TestLabMetricCard
          label="Usable Sessions"
          value={String(preview.coverage.sessionCount)}
          subtext="Common sessions available for the first deterministic clustering pass."
        />
        <TestLabMetricCard
          label="Window Stability"
          value={
            preview.diagnostics.currentClusterWindowAgreement == null
              ? 'n/a'
              : `${(preview.diagnostics.currentClusterWindowAgreement * 100).toFixed(0)}%`
          }
          subtext="How often the current regime label survives rolling-window reruns."
        />
      </div>

      <ExploratoryRegimeMap points={preview.exploratoryPoints} />

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Current State Vector</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {preview.currentSnapshot ? (
              [
                ['SPY RSI', preview.currentSnapshot.spyRsi.toFixed(2)],
                ['Dealer Gamma', preview.currentSnapshot.gammaExposure.toFixed(2)],
                ['HYG / TLT', preview.currentSnapshot.hygTltRatio.toFixed(4)],
                ['CPER / GLD', preview.currentSnapshot.cperGldRatio.toFixed(4)],
                ['USO 5D Momentum', `${formatSigned(preview.currentSnapshot.usoMomentum)}%`],
                ['VIX Level', preview.currentSnapshot.vixLevel.toFixed(2)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">{label}</p>
                  <p className="mt-2 font-[family:var(--font-data)] text-xl font-semibold text-white">
                    {value}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-zinc-400">Current snapshot unavailable.</p>
            )}
          </div>
        </div>

        <TestLabChecklist
          title="What This Prototype Gives Us"
          items={[
            'A real historical feature matrix reconstructed from live persisted Macro Bias inputs.',
            'A current six-factor state vector that stays tied to the production analog engine.',
            'A deterministic first clustering pass so the lab can reason in actual regime labels.',
            'Nearest-neighbor diagnostics so we can inspect whether the current state actually has coherent historical company.',
            'A repeatable foundation for the next step: stability tests, stored artifacts, and stronger regime taxonomy.',
          ]}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Feature Summary</p>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.02]">
                  {['Feature', 'Mean', 'Std Dev', 'Min', 'Max'].map((header) => (
                    <th key={header} className="px-4 py-3 text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {preview.featureSummaries.map((summary) => (
                  <tr key={summary.key}>
                    <td className="px-4 py-3 text-zinc-200">{summary.label}</td>
                    <td className="px-4 py-3 font-[family:var(--font-data)] text-zinc-300">{summary.mean}</td>
                    <td className="px-4 py-3 font-[family:var(--font-data)] text-zinc-300">{summary.standardDeviation}</td>
                    <td className="px-4 py-3 font-[family:var(--font-data)] text-zinc-300">{summary.min}</td>
                    <td className="px-4 py-3 font-[family:var(--font-data)] text-zinc-300">{summary.max}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Closest Historical Neighbors</p>
          <div className="mt-4 space-y-3">
            {preview.nearestAnalogs.map((entry) => (
              <div key={entry.snapshot.tradeDate} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-[family:var(--font-heading)] text-lg font-semibold text-white">
                    {entry.snapshot.tradeDate}
                  </p>
                  <span className="font-[family:var(--font-data)] text-sm text-zinc-300">
                    dist {entry.distance.toFixed(4)}
                  </span>
                </div>
                <p className="mt-2 text-xs uppercase tracking-[0.2em] text-zinc-500">{entry.snapshot.clusterLabel}</p>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-zinc-300">
                  <p>1D: {formatSigned(entry.snapshot.spyForward1DayReturn)}%</p>
                  <p>3D: {formatSigned(entry.snapshot.spyForward3DayReturn)}%</p>
                  <p>X: {formatSigned(entry.snapshot.featureX, 3)}</p>
                  <p>Y: {formatSigned(entry.snapshot.featureY, 3)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Regime Clusters</p>
          <div className="mt-4 space-y-3">
            {preview.clusterSummaries.map((cluster) => (
              <div key={cluster.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-[family:var(--font-heading)] text-lg font-semibold text-white">
                      {cluster.label}
                    </p>
                    <p className="mt-1 text-sm text-zinc-400">{cluster.description}</p>
                  </div>
                  <span className="font-[family:var(--font-data)] text-sm text-zinc-300">
                    {cluster.sampleCount} sessions
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-zinc-300">
                  <p>Avg 1D: {formatSigned(cluster.averageForward1DayReturn)}%</p>
                  <p>Avg 3D: {formatSigned(cluster.averageForward3DayReturn)}%</p>
                  <p>Centroid X: {formatSigned(cluster.centroidX, 3)}</p>
                  <p>Centroid Y: {formatSigned(cluster.centroidY, 3)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Next Build Steps</p>
          <div className="mt-4 space-y-4 text-sm leading-7 text-zinc-300">
            <p>Score cluster stability across windows instead of trusting one deterministic pass on faith.</p>
            <p>Compare this k-means baseline against alternative clustering methods and judge whether the taxonomy is actually robust.</p>
            <p>Store derived regime artifacts separately instead of recomputing from the live snapshot every request.</p>
            <p>Add representative analog narratives for each cluster once the labels are stable enough to deserve words.</p>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Current Analog Read</p>
          <div className="mt-4 space-y-4 text-sm leading-7 text-zinc-300">
            {preview.confidencePreview ? (
              <>
                <p>
                  Top-neighbor 1-day direction consensus is{' '}
                  <span className="font-[family:var(--font-data)] text-white">
                    {(preview.confidencePreview.analogAgreement.directionConsensus1Day * 100).toFixed(0)}%
                  </span>
                  , with average neighbor distance{' '}
                  <span className="font-[family:var(--font-data)] text-white">
                    {preview.confidencePreview.analogAgreement.averageDistance.toFixed(4)}
                  </span>
                  .
                </p>
                <p>
                  Today belongs to{' '}
                  <span className="font-[family:var(--font-data)] text-white">
                    {preview.confidencePreview.clusterFit.currentClusterLabel}
                  </span>
                  , and the distance from that cluster centroid is{' '}
                  <span className="font-[family:var(--font-data)] text-white">
                    {preview.confidencePreview.clusterFit.currentClusterDistance.toFixed(4)}
                  </span>
                  .
                </p>
              </>
            ) : (
              <p>Confidence preview unavailable.</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Recent Feature Snapshots</p>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02]">
                {[
                  'Trade Date',
                  'SPY RSI',
                  'Gamma',
                  'HYG/TLT',
                  'CPER/GLD',
                  'USO 5D',
                  'VIX',
                  'Fwd 1D',
                  'Fwd 3D',
                ].map((header) => (
                  <th key={header} className="px-4 py-3 text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {preview.recentSnapshots.map((snapshot) => (
                <tr key={snapshot.tradeDate}>
                  <td className="px-4 py-3 text-zinc-200">{snapshot.tradeDate}</td>
                  <td className="px-4 py-3 font-[family:var(--font-data)] text-zinc-300">{snapshot.spyRsi.toFixed(2)}</td>
                  <td className="px-4 py-3 font-[family:var(--font-data)] text-zinc-300">{snapshot.gammaExposure.toFixed(2)}</td>
                  <td className="px-4 py-3 font-[family:var(--font-data)] text-zinc-300">{snapshot.hygTltRatio.toFixed(4)}</td>
                  <td className="px-4 py-3 font-[family:var(--font-data)] text-zinc-300">{snapshot.cperGldRatio.toFixed(4)}</td>
                  <td className="px-4 py-3 font-[family:var(--font-data)] text-zinc-300">{formatSigned(snapshot.usoMomentum)}%</td>
                  <td className="px-4 py-3 font-[family:var(--font-data)] text-zinc-300">{snapshot.vixLevel.toFixed(2)}</td>
                  <td className="px-4 py-3 font-[family:var(--font-data)] text-zinc-300">{formatSigned(snapshot.spyForward1DayReturn)}%</td>
                  <td className="px-4 py-3 font-[family:var(--font-data)] text-zinc-300">{formatSigned(snapshot.spyForward3DayReturn)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
