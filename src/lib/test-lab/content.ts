import { TEST_LAB_MODULES } from './constants';

const MODULE_CONTENT = {
  'regime-map': {
    eyebrow: 'Historical Geometry',
    mission:
      'Turn the market history inside Macro Bias into a visual map of recurring macro states, then place today inside that map with honest nearest-neighbor context.',
    whyItMatters:
      'This is the flagship research surface. If we can show that today belongs to a stable family of historical sessions, the whole product becomes more coherent, more defensible, and much more impressive.',
    firstSprint: [
      'Audit the current feature set already feeding the Macro Bias score.',
      'Design a normalized historical feature snapshot table for daily sessions.',
      'Prototype a baseline embedding using PCA or UMAP for internal evaluation.',
      'Compare a few clustering approaches and judge stability rather than aesthetics.',
      'Render a first internal map with cluster-level summaries and nearest analogs.',
    ],
    requirements: [
      'No lookahead in the feature matrix.',
      'Cluster labels must be interpretable enough to explain to a human.',
      'We should measure cluster stability across rolling windows.',
      'Today’s placement needs confidence, not just coordinates.',
    ],
    success:
      'A stable regime atlas that lets us say what kind of market this is and what historical neighborhood it belongs to.',
  },
  transitions: {
    eyebrow: 'State Dynamics',
    mission:
      'Model what tends to happen next from each regime so Macro Bias can reason about persistence, decay, and reversal rather than only the current snapshot.',
    whyItMatters:
      'The regime map says where we are. The transition engine says what usually comes next. That makes the system feel much more like a serious forecasting platform.',
    firstSprint: [
      'Build a clean transition matrix from regime labels.',
      'Estimate one-day and short-horizon next-state probabilities.',
      'Pair transitions with forward returns, realized volatility, and drawdown summaries.',
      'Highlight persistence-heavy and unstable states.',
      'Design the first internal transition board with plain-language summaries.',
    ],
    requirements: [
      'Transition summaries must be sample-aware.',
      'Forward metrics should be separated by horizon.',
      'We should distinguish stable regimes from transitional or noisy ones.',
      'Outputs must be understandable at a glance.',
    ],
    success:
      'A transition layer that gives us honest probabilities about what typically follows the current state.',
  },
  confidence: {
    eyebrow: 'Trust Stack',
    mission:
      'Break trust into measurable pieces so the system can explain not only the read, but how much confidence deserves to sit behind it.',
    whyItMatters:
      'This is the bridge between raw model output and real product usefulness. Readers need to know when the score is strong, weak, or being disrupted.',
    firstSprint: [
      'Define confidence components such as signal strength, analog agreement, and feature stability.',
      'Design a quantitative scoring formula for each component.',
      'Stress test whether higher confidence actually maps to better realized performance.',
      'Build the first trust-stack view for the current session.',
      'Identify where news disruption belongs in the trust stack.',
    ],
    requirements: [
      'Every sub-score must be numerically grounded.',
      'The stack must be explainable in plain English later.',
      'Confidence should be auditable historically, not just live.',
      'Trust should remain separate from the core score itself.',
    ],
    success:
      'A trust system that explains when to lean on Macro Bias and when to treat it as background context only.',
  },
  'cross-sectional': {
    eyebrow: 'What Works Here',
    mission:
      'Translate regimes into relative opportunity by showing what types of assets or styles tend to outperform inside a given state.',
    whyItMatters:
      'This pushes Macro Bias beyond index direction and toward something that feels much more like real desk thinking.',
    firstSprint: [
      'Define the first cross-sectional universes to study.',
      'Build a historical panel of regime-conditioned relative returns.',
      'Estimate stable winners, losers, and spread behavior by state.',
      'Filter out weak or under-sampled relationships.',
      'Design a clean board that highlights what tends to work and what tends to fail.',
    ],
    requirements: [
      'No cherry-picked subgroup stories.',
      'Minimum sample thresholds before surfacing a relationship.',
      'Confidence intervals or other uncertainty framing should be visible.',
      'This must help actionability without becoming cluttered.',
    ],
    success:
      'A cross-sectional layer that makes the system more useful to actual traders and more impressive to quants.',
  },
  news: {
    eyebrow: 'Disruption Layer',
    mission:
      'Measure when news makes the historical analog engine less trustworthy while keeping the core quant score intact.',
    whyItMatters:
      'This is the clean answer to the problem we have already felt in the email product: some days the score is fine, but the setup is no longer trustworthy.',
    firstSprint: [
      'Define a structured macro-news event taxonomy.',
      'Create a simple morning headline ingestion path for test mode.',
      'Tag event type, direction, and severity.',
      'Map news disruption into pattern-validity and trust effects.',
      'Build the first internal news-disruption view alongside the trust stack.',
    ],
    requirements: [
      'News should not directly replace the quant score.',
      'The event taxonomy should be explicit and auditable.',
      'Disruption should decay over time unless refreshed.',
      'The module must help explain broken-pattern days clearly.',
    ],
    success:
      'A separate trust override engine that improves realism without turning the model discretionary.',
  },
  'data-health': {
    eyebrow: 'Model Integrity',
    mission:
      'Track whether the system’s assumptions, features, and analog quality are deteriorating before we quietly trust a weakening model.',
    whyItMatters:
      'This is one of the clearest markers of a serious quant workflow. Real research systems monitor their own reliability.',
    firstSprint: [
      'Define the first set of drift metrics.',
      'Measure feature distribution drift and analog quality decay.',
      'Track live-vs-backtest gaps where possible.',
      'Surface missing-data and data-freshness warnings.',
      'Build the first health board for internal review.',
    ],
    requirements: [
      'Health metrics must be tied to real decisions.',
      'Alerts should stay sparse and meaningful.',
      'The dashboard should distinguish data problems from model problems.',
      'We should be able to compare health over time.',
    ],
    success:
      'A health system that tells us when the model deserves recalibration, caution, or rollback.',
  },
  experiments: {
    eyebrow: 'Research Discipline',
    mission:
      'Track hypotheses, model versions, evaluation windows, metrics, and conclusions so research becomes a real process instead of a memory game.',
    whyItMatters:
      'This is where the project starts to feel institutional. It makes every future improvement more believable.',
    firstSprint: [
      'Define the experiment schema and statuses.',
      'Design a minimal internal ledger UI.',
      'Decide what metadata every serious experiment must carry.',
      'Add compare-ready fields for benchmark and baseline evaluation.',
      'Create the first seeded experiment records for upcoming lab work.',
    ],
    requirements: [
      'Every experiment must have a hypothesis and outcome.',
      'We should separate active exploration from promotion candidates.',
      'The ledger must be lightweight enough to use every time.',
      'Artifacts and metrics should be linkable later.',
    ],
    success:
      'A research log that makes model development orderly, inspectable, and credible.',
  },
  'live-vs-history': {
    eyebrow: 'Daily Research Cockpit',
    mission:
      'Bring together today’s state, historical analogs, trust, news disruption, and cross-sectional expectations into a single internal morning read.',
    whyItMatters:
      'This is the future internal cockpit. It should eventually become the one place where we assess whether the live product is seeing the market clearly.',
    firstSprint: [
      'Define the minimum set of daily panels the cockpit needs.',
      'Prototype a current-state view using existing live data where possible.',
      'Reserve spaces for regime, transitions, trust, and news-disruption modules.',
      'Design for clarity over density.',
      'Make this page the integration point as the lab matures.',
    ],
    requirements: [
      'The page must stay digestible despite pulling from many systems.',
      'Every panel should answer one clear question.',
      'This should become useful before every module is perfect.',
      'Live-vs-history comparison must stay honest about uncertainty.',
    ],
    success:
      'A private decision cockpit that lets us judge both the current market and the quality of the model reading it.',
  },
} as const;

export function getTestLabModuleContent(slug: string) {
  const module = TEST_LAB_MODULES.find((entry) => entry.slug === slug);
  const content = MODULE_CONTENT[slug as keyof typeof MODULE_CONTENT];

  if (!module || !content) {
    return null;
  }

  return {
    ...module,
    ...content,
  };
}
