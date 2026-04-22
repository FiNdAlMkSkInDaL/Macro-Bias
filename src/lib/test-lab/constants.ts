export const TEST_LAB_EMAIL_ALLOWLIST = ['finphillips21@gmail.com'] as const;

export function isTestLabAllowedEmail(email: string | null | undefined) {
  if (!email) {
    return false;
  }

  return TEST_LAB_EMAIL_ALLOWLIST.includes(email.toLowerCase() as (typeof TEST_LAB_EMAIL_ALLOWLIST)[number]);
}

export const TEST_LAB_MODULES = [
  {
    slug: 'regime-map',
    title: 'Regime Map',
    status: 'research',
    summary:
      'Map historical sessions into interpretable macro states and place today inside that geometry.',
    outcome: 'Historical clustering, analog families, and visual regime positioning.',
  },
  {
    slug: 'transitions',
    title: 'Transitions',
    status: 'research',
    summary:
      'Estimate what tends to happen next from each regime, including persistence and reversal tendencies.',
    outcome: 'Transition matrix, next-state probabilities, and forward outcome summaries.',
  },
  {
    slug: 'confidence',
    title: 'Confidence',
    status: 'candidate',
    summary:
      'Break trust into measurable components such as signal strength, analog agreement, and disruption.',
    outcome: 'Confidence decomposition and a numerically grounded trust stack.',
  },
  {
    slug: 'cross-sectional',
    title: 'Cross-Sectional',
    status: 'research',
    summary:
      'Surface what tends to work inside a regime across sectors, factors, and other relative spreads.',
    outcome: 'Regime-conditioned winners, losers, and spread summaries.',
  },
  {
    slug: 'news',
    title: 'News',
    status: 'experimental',
    summary:
      'Measure when fresh macro news breaks the analog engine without polluting the core score.',
    outcome: 'Structured news disruption layer and pattern-validity diagnostics.',
  },
  {
    slug: 'data-health',
    title: 'Data Health',
    status: 'candidate',
    summary:
      'Watch drift, data freshness, analog quality, and model deterioration before the product lies to us.',
    outcome: 'Model-health alerts, drift monitors, and reliability warnings.',
  },
  {
    slug: 'experiments',
    title: 'Experiments',
    status: 'candidate',
    summary:
      'Track every serious idea with a hypothesis, version, metrics, and promotion decision.',
    outcome: 'A proper research ledger with evidence, not memory.',
  },
  {
    slug: 'live-vs-history',
    title: 'Live vs History',
    status: 'experimental',
    summary:
      'Bring together today’s state, analogs, trust, news disruption, and expected cross-sectional behavior.',
    outcome: 'A private daily research cockpit for internal use.',
  },
] as const;

export type TestLabModule = (typeof TEST_LAB_MODULES)[number];
