import { requireTestLabAccess } from '@/lib/test-lab/access';
import { getNewsLabPreview } from '@/lib/test-lab/news';

import {
  TestLabChecklist,
  TestLabLinkButton,
  TestLabMetricCard,
  TestLabPageHeader,
  TestLabStatusPill,
} from '../_components/research-lab-ui';

export const dynamic = 'force-dynamic';

function formatDirection(direction: string) {
  return direction.replaceAll('_', ' ');
}

export default async function TestNewsPage() {
  await requireTestLabAccess();
  const preview = await getNewsLabPreview();

  return (
    <div className="space-y-10">
      <TestLabPageHeader
        eyebrow="Disruption Layer"
        title="News"
        description="This module turns the morning headline set into a structured disruption layer. It does not replace the quant score. It asks a narrower question: does the news backdrop look normal enough that the historical pattern still deserves trust?"
        actions={
          <>
            <TestLabStatusPill status="experimental" />
            <TestLabLinkButton href="/test/confidence" label="Open Confidence" subtle />
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <TestLabMetricCard
          label="Pattern Validity"
          value={preview.patternValidity.toUpperCase()}
          subtext="Rule-based read on whether the headline set leaves the historical pattern intact, shaky, or broken."
        />
        <TestLabMetricCard
          label="Disruption Score"
          value={String(preview.disruptionScore)}
          subtext="Capped structured score built from event tags, severity, and directional impact."
        />
        <TestLabMetricCard
          label="Trust Adjustment"
          value={preview.trustAdjustment.replaceAll('_', ' ')}
          subtext="How aggressively the news layer should reduce confidence in the pattern."
        />
        <TestLabMetricCard
          label="Current Regime"
          value={preview.clusterContext.clusterLabel ?? 'n/a'}
          subtext="The active regime label this disruption layer is meant to sit alongside."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Structured Event Mix</p>
          <div className="mt-4 space-y-4">
            {preview.eventMix.length > 0 ? (
              preview.eventMix.map((event) => (
                <div key={event.eventType} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-[family:var(--font-heading)] text-lg font-semibold text-white">
                        {event.eventType.replaceAll('_', ' ')}
                      </p>
                      <p className="mt-2 text-sm text-zinc-400">
                        Direction: {formatDirection(event.direction)}
                      </p>
                    </div>
                    <span className="font-[family:var(--font-data)] text-sm text-zinc-300">
                      sev {event.averageSeverity.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-zinc-300">
                    Count: {event.count}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-zinc-400">No structured signals available.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Summary</p>
          <p className="mt-4 text-sm leading-7 text-zinc-300">{preview.summary}</p>
          <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Source</p>
            <p className="mt-2 text-sm text-zinc-300">{preview.source.replaceAll('_', ' ')}</p>
          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Architecture Rule</p>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              This layer is allowed to reduce trust in the pattern. It is not allowed to replace the quant score.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Headline Scan</p>
        <div className="mt-4 space-y-3">
          {preview.headlines.length > 0 ? (
            preview.headlines.map((headline) => (
              <div key={headline} className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-zinc-300">
                {headline}
              </div>
            ))
          ) : (
            <p className="text-sm text-zinc-400">No headlines available from the live feed or latest briefing fallback.</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
        <TestLabChecklist
          title="What This Module Adds"
          items={[
            'A separate news-state engine instead of letting headlines leak directly into the core score.',
            'A structured event taxonomy that can be reasoned about and improved over time.',
            'A direct path to the product-level question: can we still trust the pattern today?',
            'A bridge between the morning headline scan and the future daily research cockpit.',
          ]}
        />
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Next Iteration</p>
          <div className="mt-4 space-y-4 text-sm leading-7 text-zinc-300">
            <p>Add timestamp-aware freshness and decay rather than treating the whole morning scan as equally current.</p>
            <p>Measure historically which event types actually break the analog engine most often.</p>
            <p>Feed this into the trust stack and the future daily cockpit without ever letting it silently rewrite the core score.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
