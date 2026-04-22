import { requireTestLabAccess } from '@/lib/test-lab/access';
import { getExperimentsDashboardData } from '@/lib/test-lab/experiments';

import {
  TestLabChecklist,
  TestLabLinkButton,
  TestLabMetricCard,
  TestLabPageHeader,
  TestLabStatusPill,
} from '../_components/research-lab-ui';

export const dynamic = 'force-dynamic';

const STATUS_PILL_STYLE: Record<string, string> = {
  proposed: 'border-white/15 bg-white/5 text-zinc-300',
  running: 'border-sky-400/25 bg-sky-400/10 text-sky-300',
  candidate: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  promoted: 'border-violet-400/25 bg-violet-400/10 text-violet-300',
  rejected: 'border-rose-400/25 bg-rose-400/10 text-rose-300',
};

function formatStatus(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const PROMOTION_STYLE: Record<string, string> = {
  hold: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
  advance: 'border-sky-400/25 bg-sky-400/10 text-sky-300',
  promote: 'border-violet-400/25 bg-violet-400/10 text-violet-300',
  reject: 'border-rose-400/25 bg-rose-400/10 text-rose-300',
};

export default async function TestExperimentsPage() {
  await requireTestLabAccess();
  const data = await getExperimentsDashboardData();

  return (
    <div className="space-y-10">
      <TestLabPageHeader
        eyebrow="Research Discipline"
        title="Experiments"
        description="This is the research ledger for the lab. It turns the system from a set of dashboards into a process: every serious idea should have a hypothesis, scope, metrics, current status, and a clear next action."
        actions={
          <>
            <TestLabStatusPill status="candidate" />
            <TestLabLinkButton href="/test/live-vs-history" label="Open Daily Cockpit" subtle />
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-5">
        <TestLabMetricCard
          label="Total Experiments"
          value={String(data.experiments.length)}
          subtext="Research records covering the major lab modules built so far."
        />
        <TestLabMetricCard
          label="Running"
          value={String(data.statusCounts.running)}
          subtext="Live workstreams still being evaluated and improved."
        />
        <TestLabMetricCard
          label="Candidates"
          value={String(data.statusCounts.candidate)}
          subtext="Promising ideas that are not yet good enough to promote."
        />
        <TestLabMetricCard
          label="Promoted"
          value={String(data.statusCounts.promoted)}
          subtext="Research that has cleared the bar to graduate. None yet, by design."
        />
        <TestLabMetricCard
          label="Rejected"
          value={String(data.statusCounts.rejected)}
          subtext="Ideas we have explicitly ruled out. Also none yet, which will change over time."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <TestLabMetricCard
          label="Ledger Source"
          value={data.source === 'database' ? 'Database' : 'Seeded'}
          subtext="Whether the experiments page is currently reading from persisted rows or code-seeded fallbacks."
        />
        <TestLabMetricCard
          label="Artifact Rows"
          value={String(data.persistence.regimeArtifactsTable.rowCount)}
          subtext="Persisted regime artifacts currently stored in the test-lab table."
        />
        <TestLabMetricCard
          label="Experiment Rows"
          value={String(data.persistence.experimentsTable.rowCount)}
          subtext="Persisted experiment records currently stored in the test-lab table."
        />
        <TestLabMetricCard
          label="Promotion Ready"
          value={String(data.promotionCounts.promote)}
          subtext="Experiments that currently clear the bar to graduate. None should appear here lightly."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Research Ledger</p>
          <div className="mt-4 space-y-4">
            {data.experiments.map((experiment) => (
              <div key={experiment.id} className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-3xl">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="font-[family:var(--font-heading)] text-xl font-semibold text-white">
                        {experiment.title}
                      </p>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.22em] ${
                          STATUS_PILL_STYLE[experiment.status] ?? STATUS_PILL_STYLE.proposed
                        }`}
                      >
                        {formatStatus(experiment.status)}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.22em] ${
                          PROMOTION_STYLE[experiment.promotionRecommendation] ?? PROMOTION_STYLE.hold
                        }`}
                      >
                        {formatStatus(experiment.promotionRecommendation)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-zinc-300">{experiment.hypothesis}</p>
                  </div>
                  <div className="min-w-[180px] rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Model</p>
                    <p className="mt-2 font-[family:var(--font-data)] text-sm text-zinc-200">
                      {experiment.modelVersion}
                    </p>
                    <p className="mt-3 text-[11px] uppercase tracking-[0.22em] text-zinc-500">Outcome</p>
                    <p className="mt-2 text-sm text-zinc-300">{formatStatus(experiment.outcome)}</p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Evaluation Window</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">{experiment.evaluationWindow}</p>

                    <p className="mt-4 text-[11px] uppercase tracking-[0.22em] text-zinc-500">Changed Modules</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {experiment.changedModules.map((module) => (
                        <span key={module} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-zinc-300">
                          {module}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Metrics</p>
                    <div className="mt-2 space-y-2">
                      {experiment.metrics.map((metric) => (
                        <div key={metric.label} className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                          <span className="text-sm text-zinc-300">{metric.label}</span>
                          <span className="font-[family:var(--font-data)] text-sm text-white">{metric.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Evidence</p>
                    <div className="mt-2 space-y-2">
                      {experiment.evidence.map((item) => (
                        <div key={item} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-300">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Promotion Checklist</p>
                    <div className="mt-2 space-y-2">
                      {experiment.promotionChecklist.map((item) => (
                        <div key={item.label} className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                          <span className="text-sm text-zinc-300">{item.label}</span>
                          <span className={`text-xs font-medium uppercase tracking-[0.2em] ${item.done ? 'text-emerald-300' : 'text-zinc-500'}`}>
                            {item.done ? 'Done' : 'Open'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Notes</p>
                    <p className="mt-2 text-sm leading-7 text-zinc-300">{experiment.notes}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Next Action</p>
                    <p className="mt-2 text-sm leading-7 text-zinc-300">{experiment.nextAction}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <TestLabChecklist
            title="Promotion Framework"
            items={[
              'Hold: the idea is useful internally but still under-validated or too rough for promotion.',
              'Advance: the idea is worth deeper validation and hardening, but is not ready for live yet.',
              'Promote: the idea has enough evidence, stability, and product payoff to justify graduation.',
              'Reject: the idea should not continue unless new evidence changes the case.',
            ]}
          />
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Persistence Check</p>
            <div className="mt-4 space-y-4 text-sm leading-7 text-zinc-300">
              <p>Regime artifact table: {data.persistence.regimeArtifactsTable.available ? 'available' : 'missing'}.</p>
              <p>Experiments table: {data.persistence.experimentsTable.available ? 'available' : 'missing'}.</p>
              <p>Latest persisted regime artifact: {data.persistence.regimeArtifactsTable.latestCreatedAt ?? 'none yet'}.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
