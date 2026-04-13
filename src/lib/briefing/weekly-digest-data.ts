import 'server-only';

import { createSupabaseAdminClient } from '../supabase/admin';

export type WeeklyBriefingRow = {
  briefing_date: string;
  trade_date: string;
  quant_score: number;
  bias_label: string;
  is_override_active: boolean;
  brief_content: string;
  news_summary: string;
};

export type WeeklyDigestData = {
  briefings: WeeklyBriefingRow[];
  weekStart: string;
  weekEnd: string;
  avgScore: number;
  trendDirection: 'improving' | 'deteriorating' | 'flat';
  dominantRegime: string;
  overrideCount: number;
  sessionCount: number;
};

/**
 * Get the Monday and Friday of the previous trading week relative to a reference date.
 * If the reference is Monday, "previous week" means the Mon-Fri before that Monday.
 */
export function getPreviousTradingWeekRange(referenceDate: Date): { monday: string; friday: string } {
  const ref = new Date(
    Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()),
  );

  // Walk back to the most recent Friday (or before)
  const dayOfWeek = ref.getUTCDay(); // 0=Sun, 1=Mon, ...
  const daysBackToFriday = dayOfWeek === 0 ? 2 : dayOfWeek === 6 ? 1 : dayOfWeek + 2;
  const friday = new Date(ref.getTime() - daysBackToFriday * 86_400_000);
  const monday = new Date(friday.getTime() - 4 * 86_400_000);

  return {
    monday: monday.toISOString().slice(0, 10),
    friday: friday.toISOString().slice(0, 10),
  };
}

function computeTrend(briefings: WeeklyBriefingRow[]): WeeklyDigestData['trendDirection'] {
  if (briefings.length < 2) return 'flat';

  const sorted = [...briefings].sort(
    (a, b) => a.briefing_date.localeCompare(b.briefing_date),
  );
  const firstHalf = sorted.slice(0, Math.ceil(sorted.length / 2));
  const secondHalf = sorted.slice(Math.floor(sorted.length / 2));

  const firstAvg = firstHalf.reduce((s, b) => s + b.quant_score, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((s, b) => s + b.quant_score, 0) / secondHalf.length;
  const delta = secondAvg - firstAvg;

  if (delta > 5) return 'improving';
  if (delta < -5) return 'deteriorating';
  return 'flat';
}

function computeDominantRegime(briefings: WeeklyBriefingRow[]): string {
  const counts = new Map<string, number>();

  for (const b of briefings) {
    counts.set(b.bias_label, (counts.get(b.bias_label) ?? 0) + 1);
  }

  let max = 0;
  let dominant = 'NEUTRAL';

  for (const [label, count] of counts) {
    if (count > max) {
      max = count;
      dominant = label;
    }
  }

  return dominant;
}

export async function getWeeklyDigestData(referenceDate: Date = new Date()): Promise<WeeklyDigestData | null> {
  const { monday, friday } = getPreviousTradingWeekRange(referenceDate);
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from('daily_market_briefings')
    .select(
      'briefing_date, trade_date, quant_score, bias_label, is_override_active, brief_content, news_summary',
    )
    .gte('briefing_date', monday)
    .lte('briefing_date', friday)
    .order('briefing_date', { ascending: true });

  if (error) {
    throw new Error(`Failed to load weekly digest briefings: ${error.message}`);
  }

  const rows = (data as WeeklyBriefingRow[] | null) ?? [];

  // Deduplicate by briefing_date (keep first = latest due to ordering)
  const seen = new Set<string>();
  const briefings = rows.filter((r) => {
    if (seen.has(r.briefing_date)) return false;
    seen.add(r.briefing_date);
    return true;
  });

  if (briefings.length === 0) return null;

  const scores = briefings.map((b) => b.quant_score);
  const avgScore = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const overrideCount = briefings.filter((b) => b.is_override_active).length;

  return {
    briefings,
    weekStart: monday,
    weekEnd: friday,
    avgScore,
    trendDirection: computeTrend(briefings),
    dominantRegime: computeDominantRegime(briefings),
    overrideCount,
    sessionCount: briefings.length,
  };
}
