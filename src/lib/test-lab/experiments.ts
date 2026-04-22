import 'server-only';

import {
  getTestLabPersistenceSummary,
  loadPersistedExperiments,
  seedExperimentsIfTableExists,
} from './persistence';

export type ExperimentStatus = 'proposed' | 'running' | 'candidate' | 'promoted' | 'rejected';
export type ExperimentOutcome = 'pending' | 'promising' | 'mixed' | 'not_ready' | 'promoted';
export type PromotionRecommendation = 'hold' | 'advance' | 'promote' | 'reject';

export type ResearchExperiment = {
  changedModules: string[];
  createdAt: string;
  evaluationWindow: string;
  evidence: string[];
  hypothesis: string;
  id: string;
  metrics: Array<{
    label: string;
    value: string;
  }>;
  modelVersion: string;
  nextAction: string;
  notes: string;
  outcome: ExperimentOutcome;
  owner: string;
  promotionChecklist: Array<{
    done: boolean;
    label: string;
  }>;
  promotionRecommendation: PromotionRecommendation;
  status: ExperimentStatus;
  title: string;
};

export type ExperimentsDashboardData = {
  experiments: ResearchExperiment[];
  persistence: Awaited<ReturnType<typeof getTestLabPersistenceSummary>>;
  promotionCounts: Record<PromotionRecommendation, number>;
  source: 'database' | 'seeded';
  statusCounts: Record<ExperimentStatus, number>;
};

const SEEDED_EXPERIMENTS: ResearchExperiment[] = [
  {
    id: 'exp-001-regime-clustering-baseline',
    title: 'Deterministic Regime Clustering Baseline',
    createdAt: '2026-04-22',
    owner: 'finphillips21@gmail.com',
    status: 'running',
    outcome: 'promising',
    modelVersion: 'test-regime-kmeans-v1',
    evaluationWindow: '10y historical analog universe from latest persisted snapshot',
    changedModules: ['regime-map', 'transitions', 'confidence', 'data-health'],
    hypothesis:
      'A deterministic clustering pass over the six-factor analog space will give us more usable internal structure than the earlier exploratory projection alone.',
    metrics: [
      { label: 'Clusters', value: '5' },
      { label: 'Diagnostics', value: 'cohesion + separation + rolling-window agreement' },
      { label: 'Current state support', value: 'cluster-aware nearest analogs live' },
    ],
    evidence: [
      'Shared clustering layer is live across regime map, transitions, confidence, and data health.',
      'Rolling-window stability and separation diagnostics are available.',
    ],
    promotionChecklist: [
      { label: 'Artifacts persisted', done: true },
      { label: 'Alternate clustering comparison complete', done: false },
      { label: 'Stability judged acceptable', done: false },
      { label: 'Promotion case written', done: false },
    ],
    promotionRecommendation: 'advance',
    notes:
      'The baseline is now powering multiple lab surfaces. The next question is not whether it works at all, but whether it remains stable enough under alternate windows and alternate clustering methods.',
    nextAction:
      'Compare against at least one alternate clustering configuration and score promotion readiness after that comparison.',
  },
  {
    id: 'exp-002-cross-sectional-regime-effects',
    title: 'Cross-Sectional Effects by Regime',
    createdAt: '2026-04-22',
    owner: 'finphillips21@gmail.com',
    status: 'running',
    outcome: 'promising',
    modelVersion: 'test-cross-sectional-v1',
    evaluationWindow: 'Next-session relative returns conditioned on current regime label',
    changedModules: ['cross-sectional', 'live-vs-history'],
    hypothesis:
      'Once the regime label is stable enough, simple relative lenses such as **QQQ** vs **SPY** and **HYG** vs **TLT** will show meaningful differences across states.',
    metrics: [
      { label: 'Lens count', value: '7' },
      { label: 'Output', value: 'leaders + laggards by current regime' },
      { label: 'Use case', value: 'expression layer for the cockpit' },
    ],
    evidence: [
      'Cross-sectional page is live and wired into the cockpit.',
      'Relative lenses are conditioned on the active regime label.',
    ],
    promotionChecklist: [
      { label: 'Sample thresholds acceptable', done: true },
      { label: 'Factor-style extensions added', done: false },
      { label: 'Stability across alternate windows tested', done: false },
      { label: 'Live product payoff is clear', done: true },
    ],
    promotionRecommendation: 'advance',
    notes:
      'This is already useful product-wise, but it still needs stronger validation and possibly more factor-style lenses before we should trust it as an investment-grade decision layer.',
    nextAction:
      'Add more explicit factor-style lenses and evaluate whether the spreads remain stable across alternate windows.',
  },
  {
    id: 'exp-003-news-disruption-layer',
    title: 'Structured News Disruption Layer',
    createdAt: '2026-04-22',
    owner: 'finphillips21@gmail.com',
    status: 'candidate',
    outcome: 'mixed',
    modelVersion: 'test-news-override-v1',
    evaluationWindow: 'Live morning-news feed plus latest briefing fallback',
    changedModules: ['news', 'confidence', 'live-vs-history'],
    hypothesis:
      'A rules-based event taxonomy can reduce trust in broken-pattern days without contaminating the core quant score.',
    metrics: [
      { label: 'Event types', value: '8' },
      { label: 'Outputs', value: 'pattern validity + disruption score + trust adjustment' },
      { label: 'Architecture rule', value: 'reduces trust only, never rewrites score' },
    ],
    evidence: [
      'Structured taxonomy exists and is visible in /test/news.',
      'The disruption layer is referenced in the cockpit and trust framing.',
    ],
    promotionChecklist: [
      { label: 'Live news source working', done: true },
      { label: 'Historical override backtest complete', done: false },
      { label: 'Severity weighting validated', done: false },
      { label: 'Safe to influence live trust language', done: false },
    ],
    promotionRecommendation: 'hold',
    notes:
      'Architecturally this is exactly what we want. The open question is whether the taxonomy is rich enough and whether the disruption scoring aligns with genuinely broken-pattern days historically.',
    nextAction:
      'Backtest disruption categories against known override-style sessions and refine severity weighting.',
  },
  {
    id: 'exp-004-daily-research-cockpit',
    title: 'Daily Research Cockpit Synthesis',
    createdAt: '2026-04-22',
    owner: 'finphillips21@gmail.com',
    status: 'candidate',
    outcome: 'promising',
    modelVersion: 'test-cockpit-v1',
    evaluationWindow: 'Current-day synthesis only',
    changedModules: ['live-vs-history'],
    hypothesis:
      'One coherent internal morning cockpit is more useful than hopping across several disconnected research pages.',
    metrics: [
      { label: 'Inputs', value: 'score + regime + transitions + trust + news + cross-sectional + health' },
      { label: 'Page goal', value: 'one internal morning operating view' },
      { label: 'Current state', value: 'live in /test/live-vs-history' },
    ],
    evidence: [
      'The cockpit synthesizes all major lab modules into one internal morning read.',
      'The page is already useful as the default internal starting point.',
    ],
    promotionChecklist: [
      { label: 'Daily workflow fit confirmed', done: true },
      { label: 'Archive/history view added', done: false },
      { label: 'Language refined after use', done: false },
      { label: 'Promotion target defined', done: false },
    ],
    promotionRecommendation: 'advance',
    notes:
      'The cockpit is already the right synthesis surface. It now needs refinement of the decision language and, later, historical archiving so we can compare prior internal reads with what actually happened.',
    nextAction:
      'Refine decision language, add archive/history hooks, and use the cockpit as the default daily internal starting point.',
  },
  {
    id: 'exp-005-live-trust-check-candidate',
    title: 'Live Trust Check Promotion Candidate',
    createdAt: '2026-04-22',
    owner: 'finphillips21@gmail.com',
    status: 'candidate',
    outcome: 'promising',
    modelVersion: 'test-trust-check-v1',
    evaluationWindow: 'Current-day synthesis plus supporting regime and news diagnostics',
    changedModules: ['confidence', 'news', 'live-vs-history'],
    hypothesis:
      'A slimmed-down trust layer can bring the research lab into the live product without clutter, by answering one question clearly: does the score deserve trust today?',
    metrics: [
      { label: 'Target surface', value: '/today + daily email + premium briefing header' },
      { label: 'Primary output', value: 'Pattern intact / shaky / broken' },
      { label: 'UX rule', value: 'one headline, one reason, a few supporting factors' },
    ],
    evidence: [
      'A dedicated /test/today preview now shows the live-style trust-check card in context.',
      'The cockpit now uses the same trust-check adapter that would power a live rollout.',
    ],
    promotionChecklist: [
      { label: 'Clean live-style preview exists', done: true },
      { label: 'Language feels calm and user-facing', done: true },
      { label: 'Historical trust thresholds reviewed', done: false },
      { label: 'Ready for live verification pass', done: false },
    ],
    promotionRecommendation: 'advance',
    notes:
      'This is the cleanest bridge from research sophistication to user-facing value. The remaining work is verification and threshold tuning, not feature invention.',
    nextAction:
      'Verify the preview in /test/today across a few real sessions, then decide whether to wire it into the live /today surface and email.',
  },
] as const;

export async function getExperimentsDashboardData(): Promise<ExperimentsDashboardData> {
  await seedExperimentsIfTableExists([...SEEDED_EXPERIMENTS]);
  const persistedExperiments = await loadPersistedExperiments<ResearchExperiment>();
  const source = persistedExperiments.length > 0 ? 'database' : 'seeded';
  const experiments = (persistedExperiments.length > 0 ? persistedExperiments : [...SEEDED_EXPERIMENTS]).sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt),
  );
  const persistence = await getTestLabPersistenceSummary();

  const statusCounts = experiments.reduce<Record<ExperimentStatus, number>>(
    (acc, experiment) => {
      acc[experiment.status] = (acc[experiment.status] ?? 0) + 1;
      return acc;
    },
    {
      proposed: 0,
      running: 0,
      candidate: 0,
      promoted: 0,
      rejected: 0,
    },
  );

  const promotionCounts = experiments.reduce<Record<PromotionRecommendation, number>>(
    (acc, experiment) => {
      acc[experiment.promotionRecommendation] =
        (acc[experiment.promotionRecommendation] ?? 0) + 1;
      return acc;
    },
    {
      hold: 0,
      advance: 0,
      promote: 0,
      reject: 0,
    },
  );

  return {
    experiments,
    source,
    persistence,
    statusCounts,
    promotionCounts,
  };
}
