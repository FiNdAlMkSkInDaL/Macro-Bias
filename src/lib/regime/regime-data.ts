import "server-only";

import { cache } from "react";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { BiasLabel } from "@/lib/macro-bias/types";

// ----- Regime slug ↔ BiasLabel mapping -----

export type RegimeSlug =
  | "risk-on"
  | "risk-off"
  | "neutral"
  | "extreme-risk-on"
  | "extreme-risk-off";

const SLUG_TO_LABEL: Record<RegimeSlug, BiasLabel> = {
  "risk-on": "RISK_ON",
  "risk-off": "RISK_OFF",
  neutral: "NEUTRAL",
  "extreme-risk-on": "EXTREME_RISK_ON",
  "extreme-risk-off": "EXTREME_RISK_OFF",
};

const LABEL_TO_SLUG: Record<BiasLabel, RegimeSlug> = {
  RISK_ON: "risk-on",
  RISK_OFF: "risk-off",
  NEUTRAL: "neutral",
  EXTREME_RISK_ON: "extreme-risk-on",
  EXTREME_RISK_OFF: "extreme-risk-off",
};

export const ALL_REGIME_SLUGS: readonly RegimeSlug[] = [
  "extreme-risk-on",
  "risk-on",
  "neutral",
  "risk-off",
  "extreme-risk-off",
] as const;

export function isValidRegimeSlug(value: string): value is RegimeSlug {
  return value in SLUG_TO_LABEL;
}

export function regimeSlugToLabel(slug: RegimeSlug): BiasLabel {
  return SLUG_TO_LABEL[slug];
}

export function regimeLabelToSlug(label: BiasLabel): RegimeSlug {
  return LABEL_TO_SLUG[label];
}

export function formatDisplayLabel(label: string) {
  return label.replace(/_/g, " ");
}

export function formatSignedScore(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}

// ----- Regime colors -----

export function getRegimeAccentClass(label: string) {
  switch (label) {
    case "EXTREME_RISK_ON":
      return "text-emerald-300";
    case "RISK_ON":
      return "text-green-400";
    case "EXTREME_RISK_OFF":
      return "text-red-400";
    case "RISK_OFF":
      return "text-orange-400";
    default:
      return "text-amber-400";
  }
}

export function getRegimeBorderClass(label: string) {
  switch (label) {
    case "EXTREME_RISK_ON":
      return "border-emerald-500/30";
    case "RISK_ON":
      return "border-green-500/30";
    case "EXTREME_RISK_OFF":
      return "border-red-500/30";
    case "RISK_OFF":
      return "border-orange-500/30";
    default:
      return "border-amber-500/30";
  }
}

export function getRegimeGradientClass(label: string) {
  switch (label) {
    case "EXTREME_RISK_ON":
      return "from-emerald-500/10";
    case "RISK_ON":
      return "from-green-500/10";
    case "EXTREME_RISK_OFF":
      return "from-red-500/10";
    case "RISK_OFF":
      return "from-orange-500/10";
    default:
      return "from-amber-500/10";
  }
}

// ----- Regime stats data types -----

export type RegimeBriefingRow = {
  briefing_date: string;
  quant_score: number;
  bias_label: string;
  is_override_active: boolean;
  generated_at: string;
};

export type RegimeStats = {
  label: BiasLabel;
  slug: RegimeSlug;
  displayName: string;
  occurrenceCount: number;
  lastSeenDate: string | null;
  avgScore: number;
  minScore: number;
  maxScore: number;
  overrideCount: number;
  recentBriefings: RegimeBriefingRow[];
};

export type RegimeOverview = {
  currentRegime: RegimeStats | null;
  allRegimes: RegimeStats[];
  totalBriefings: number;
};

// ----- Data fetching -----

type RawBriefingRow = {
  briefing_date: string;
  quant_score: number;
  bias_label: string;
  is_override_active: boolean;
  generated_at: string;
};

function deduplicateByDate(rows: RawBriefingRow[]): RawBriefingRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.briefing_date)) return false;
    seen.add(row.briefing_date);
    return true;
  });
}

function computeStatsForLabel(
  label: BiasLabel,
  allRows: RawBriefingRow[],
): RegimeStats {
  const slug = LABEL_TO_SLUG[label];
  const rows = allRows.filter((r) => r.bias_label === label);
  const scores = rows.map((r) => r.quant_score);

  return {
    label,
    slug,
    displayName: formatDisplayLabel(label),
    occurrenceCount: rows.length,
    lastSeenDate: rows.length > 0 ? rows[0].briefing_date : null,
    avgScore:
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0,
    minScore: scores.length > 0 ? Math.min(...scores) : 0,
    maxScore: scores.length > 0 ? Math.max(...scores) : 0,
    overrideCount: rows.filter((r) => r.is_override_active).length,
    recentBriefings: rows.slice(0, 10).map((r) => ({
      briefing_date: r.briefing_date,
      quant_score: r.quant_score,
      bias_label: r.bias_label,
      is_override_active: r.is_override_active,
      generated_at: r.generated_at,
    })),
  };
}

export const getRegimeStats = cache(
  async (slug: RegimeSlug): Promise<RegimeStats | null> => {
    const label = SLUG_TO_LABEL[slug];
    const supabase = createSupabaseAdminClient();

    const { data, error } = await supabase
      .from("daily_market_briefings")
      .select("briefing_date, quant_score, bias_label, is_override_active, generated_at")
      .order("briefing_date", { ascending: false });

    if (error) {
      throw new Error(`Failed to load regime data: ${error.message}`);
    }

    const allRows = deduplicateByDate((data as RawBriefingRow[] | null) ?? []);
    const stats = computeStatsForLabel(label, allRows);

    return stats;
  },
);

export const getRegimeOverview = cache(async (): Promise<RegimeOverview> => {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("daily_market_briefings")
    .select("briefing_date, quant_score, bias_label, is_override_active, generated_at")
    .order("briefing_date", { ascending: false });

  if (error) {
    throw new Error(`Failed to load regime overview: ${error.message}`);
  }

  const allRows = deduplicateByDate((data as RawBriefingRow[] | null) ?? []);

  const labels: BiasLabel[] = [
    "EXTREME_RISK_ON",
    "RISK_ON",
    "NEUTRAL",
    "RISK_OFF",
    "EXTREME_RISK_OFF",
  ];

  const allRegimes = labels.map((label) => computeStatsForLabel(label, allRows));
  const currentLabel = allRows.length > 0 ? (allRows[0].bias_label as BiasLabel) : null;
  const currentRegime = currentLabel
    ? allRegimes.find((r) => r.label === currentLabel) ?? null
    : null;

  return {
    currentRegime,
    allRegimes,
    totalBriefings: allRows.length,
  };
});
