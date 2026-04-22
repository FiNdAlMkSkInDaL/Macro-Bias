import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { fetchMorningNews } from '@/lib/market-data/fetch-morning-news';

import { getRegimeResearchMatrix } from './regime-map';

type NewsDirection = 'risk_off' | 'risk_on' | 'mixed' | 'neutral';
type NewsEventType =
  | 'geopolitical_escalation'
  | 'policy_surprise'
  | 'liquidity_stress'
  | 'credit_event'
  | 'commodity_supply_shock'
  | 'trade_sanctions_escalation'
  | 'deescalation_relief'
  | 'routine_macro';

type NewsRule = {
  direction: NewsDirection;
  eventType: NewsEventType;
  explanation: string;
  pattern: RegExp;
  severity: 1 | 2 | 3;
};

export type StructuredHeadlineSignal = {
  direction: NewsDirection;
  eventType: NewsEventType;
  explanation: string;
  headline: string;
  severity: 1 | 2 | 3;
};

export type NewsLabPreview = {
  clusterContext: {
    clusterLabel: string | null;
    currentTradeDate: string | null;
  };
  disruptionScore: number;
  eventMix: Array<{
    averageSeverity: number;
    count: number;
    direction: NewsDirection;
    eventType: NewsEventType;
  }>;
  headlines: string[];
  patternValidity: 'intact' | 'shaky' | 'broken';
  signals: StructuredHeadlineSignal[];
  source: 'live_morning_news' | 'latest_briefing' | 'none';
  summary: string;
  trustAdjustment: 'none' | 'reduced' | 'heavily_reduced';
};

const NEWS_RULES: NewsRule[] = [
  {
    eventType: 'geopolitical_escalation',
    direction: 'risk_off',
    severity: 3,
    pattern: /\b(war|invasion|act of war|missile|strike|blockade|airstrike|military escalation|troops|nuclear)\b/i,
    explanation: 'Military or geopolitical escalation can quickly invalidate historical analogs.',
  },
  {
    eventType: 'liquidity_stress',
    direction: 'risk_off',
    severity: 3,
    pattern: /\b(flash crash|circuit breaker|halted trading|market halt|liquidity crisis|funding stress|repo stress)\b/i,
    explanation: 'Liquidity stress can break normal market structure quickly.',
  },
  {
    eventType: 'credit_event',
    direction: 'risk_off',
    severity: 3,
    pattern: /\b(default|debt crisis|bank collapse|bank run|credit crisis|downgrade shock)\b/i,
    explanation: 'Credit-system stress is a strong reason to distrust routine historical comparisons.',
  },
  {
    eventType: 'policy_surprise',
    direction: 'mixed',
    severity: 3,
    pattern: /\b(emergency meeting|emergency cut|emergency hike|surprise cut|surprise hike|unscheduled policy)\b/i,
    explanation: 'Unscheduled policy action can rapidly reprice the entire tape.',
  },
  {
    eventType: 'commodity_supply_shock',
    direction: 'mixed',
    severity: 2,
    pattern: /\b(oil shock|energy crisis|supply disruption|shipping disruption|pipeline attack|opec.*emergency|opec.*surprise)\b/i,
    explanation: 'Supply shocks change inflation, commodity, and risk dynamics quickly.',
  },
  {
    eventType: 'trade_sanctions_escalation',
    direction: 'risk_off',
    severity: 2,
    pattern: /\b(sanctions announced|sanctions expanded|embargo|new tariffs|tariff escalation|export controls)\b/i,
    explanation: 'Fresh sanctions or tariff escalation can change the macro setup enough to reduce trust.',
  },
  {
    eventType: 'deescalation_relief',
    direction: 'risk_on',
    severity: 2,
    pattern: /\b(ceasefire|truce|peace talks|de-escalation|sanctions relief|talks resume|agreement reached)\b/i,
    explanation: 'De-escalation headlines can restore or improve risk appetite if they are credible.',
  },
  {
    eventType: 'routine_macro',
    direction: 'neutral',
    severity: 1,
    pattern: /\b(cpi|payrolls|fed speakers|treasury auction|earnings|guidance|rate cut expectations|inflation data)\b/i,
    explanation: 'Routine macro or scheduled event coverage is usually not enough on its own to break the pattern.',
  },
] as const;

function roundTo(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function classifyHeadline(headline: string): StructuredHeadlineSignal[] {
  const matches = NEWS_RULES.filter((rule) => rule.pattern.test(headline)).map((rule) => ({
    headline,
    eventType: rule.eventType,
    direction: rule.direction,
    severity: rule.severity,
    explanation: rule.explanation,
  }));

  return matches.length > 0
    ? matches
    : [
        {
          headline,
          eventType: 'routine_macro',
          direction: 'neutral',
          severity: 1,
          explanation: 'No explicit disruption pattern matched; treating as routine market context for now.',
        },
      ];
}

function summarizeSignals(signals: StructuredHeadlineSignal[]) {
  const severeSignals = signals.filter((signal) => signal.severity >= 2 && signal.eventType !== 'routine_macro');

  if (severeSignals.length === 0) {
    return 'The headline set looks routine. Nothing here obviously breaks the historical pattern on its own.';
  }

  const lead = severeSignals[0];
  return `${lead.eventType.replaceAll('_', ' ')} is the dominant disruption theme, so the pattern should be trusted less until the tape shows it can absorb the news.`;
}

function buildEventMix(signals: StructuredHeadlineSignal[]) {
  const buckets = new Map<
    NewsEventType,
    { count: number; direction: NewsDirection; totalSeverity: number }
  >();

  for (const signal of signals) {
    const existing = buckets.get(signal.eventType);

    if (existing) {
      existing.count += 1;
      existing.totalSeverity += signal.severity;
      continue;
    }

    buckets.set(signal.eventType, {
      count: 1,
      direction: signal.direction,
      totalSeverity: signal.severity,
    });
  }

  return [...buckets.entries()]
    .map(([eventType, summary]) => ({
      eventType,
      direction: summary.direction,
      count: summary.count,
      averageSeverity: roundTo(summary.totalSeverity / summary.count, 2),
    }))
    .sort((left, right) => right.averageSeverity - left.averageSeverity || right.count - left.count);
}

function buildDisruptionScore(signals: StructuredHeadlineSignal[]) {
  const weightedSeverity = signals.reduce((total, signal) => {
    const directionWeight =
      signal.direction === 'neutral' ? 0.6 : signal.direction === 'mixed' ? 0.85 : 1;

    return total + signal.severity * directionWeight;
  }, 0);

  return Math.min(100, Math.round(weightedSeverity * 7));
}

function getPatternValidity(score: number): NewsLabPreview['patternValidity'] {
  if (score >= 50) {
    return 'broken';
  }

  if (score >= 24) {
    return 'shaky';
  }

  return 'intact';
}

function getTrustAdjustment(score: number): NewsLabPreview['trustAdjustment'] {
  if (score >= 50) {
    return 'heavily_reduced';
  }

  if (score >= 24) {
    return 'reduced';
  }

  return 'none';
}

async function getLatestBriefingHeadlines() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('daily_macro_briefings')
    .select('trade_date, news_headlines')
    .order('trade_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return null;
  }

  const headlines = Array.isArray(data?.news_headlines)
    ? data.news_headlines.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];

  if (headlines.length === 0) {
    return null;
  }

  return headlines;
}

async function getHeadlines() {
  try {
    const liveHeadlines = await fetchMorningNews();

    if (liveHeadlines.length > 0) {
      return {
        headlines: liveHeadlines,
        source: 'live_morning_news' as const,
      };
    }
  } catch {
    // Fall back to latest persisted briefing headlines.
  }

  const briefingHeadlines = await getLatestBriefingHeadlines();

  if (briefingHeadlines && briefingHeadlines.length > 0) {
    return {
      headlines: briefingHeadlines,
      source: 'latest_briefing' as const,
    };
  }

  return {
    headlines: [] as string[],
    source: 'none' as const,
  };
}

export async function getNewsLabPreview(): Promise<NewsLabPreview> {
  const [matrix, headlinePayload] = await Promise.all([
    getRegimeResearchMatrix(),
    getHeadlines(),
  ]);

  const signals = headlinePayload.headlines.flatMap((headline) => classifyHeadline(headline));
  const disruptionScore = buildDisruptionScore(signals);

  return {
    source: headlinePayload.source,
    headlines: headlinePayload.headlines,
    signals,
    eventMix: buildEventMix(signals),
    disruptionScore,
    patternValidity: getPatternValidity(disruptionScore),
    trustAdjustment: getTrustAdjustment(disruptionScore),
    summary: summarizeSignals(signals),
    clusterContext: {
      clusterLabel: matrix?.currentSnapshot?.clusterLabel ?? null,
      currentTradeDate: matrix?.currentSnapshot?.tradeDate ?? null,
    },
  };
}
